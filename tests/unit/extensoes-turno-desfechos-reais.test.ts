import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

/**
 * Executa os nós REAIS do host com falhas dirigidas nas bordas. Não importa o
 * runtime inteiro, não copia sua implementação e não inicia banco ou canal.
 */
function noReal(caminho: string, aceita: (no: ts.Node, fonte: ts.SourceFile) => boolean) {
  const fonte = ts.createSourceFile(caminho, readFileSync(caminho, "utf8"), ts.ScriptTarget.Latest, true);
  let encontrado: ts.Node | undefined;
  const visitar = (no: ts.Node) => {
    if (aceita(no, fonte)) encontrado = no;
    if (!encontrado) ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  if (!encontrado) throw new Error(`Nó real ausente em ${caminho}`);
  return encontrado.getText(fonte).replace(/^export /, "");
}

function compilar(codigo: string) {
  return ts.transpileModule(codigo, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

const passagemReal = noReal("lib/agent-engine/agent/human-handoff.ts",
  (no) => ts.isFunctionDeclaration(no) && no.name?.text === "gravarPassagemComRecibo");
const envioReal = noReal("lib/agent-engine/agent/gancho-de-extensao.ts",
  (no) => ts.isFunctionDeclaration(no) && no.name?.text === "enviarTextoSemModelo");
const callbackReal = noReal("lib/agent-engine/agent/inbound-turn.ts",
  (no, fonte) => ts.isPropertyAssignment(no) && no.name.getText(fonte) === "passarParaHumano" && ts.isArrowFunction(no.initializer));
const coletaReal = noReal("lib/agent-engine/agent/inbound-turn.ts",
  (no, fonte) => ts.isPropertyAssignment(no) && no.name.getText(fonte) === "enviar" &&
    ts.isArrowFunction(no.initializer) && no.initializer.getText(fonte).includes("enviarTextoSemModelo"));

async function gravar(opts: { falha?: RegExp; rollbackFalha?: boolean; repetido?: boolean; registroFalha?: boolean } = {}) {
  const erroConsulta = new Error("Query read timeout");
  const erroRollback = new Error("rollback incerto");
  const query = vi.fn(async (sql: string) => {
    if (sql === "rollback" && opts.rollbackFalha) throw erroRollback;
    if (opts.falha?.test(sql)) throw erroConsulta;
    return { rows: [{ msg: opts.repetido ? "tentativa-1" : null }] };
  });
  const release = vi.fn();
  const registrarPassagem = vi.fn(async () => opts.registroFalha
    ? { gravada: false, erro: "insert não confirmado" }
    : { gravada: true });
  const log = { info: vi.fn(), warn: vi.fn() };
  const executar = runInNewContext(`${compilar(passagemReal)}; gravarPassagemComRecibo`, {
    Error, registrarPassagem, CHAVE_DO_RECIBO_DA_PASSAGEM: "passagem_verificacao_manual",
  }) as (db: unknown, ids: unknown, nova: unknown, chave: string, logger: unknown) => Promise<void>;
  // O best effort continua resolvendo; não transformar falha da informação em retry geral.
  await expect(executar({ connect: async () => ({ query, release }) },
    { tenantId: "org-sintetica", conversationId: "conversa-sintetica" }, {}, "tentativa-1", log)).resolves.toBeUndefined();
  expect(release).toHaveBeenCalledTimes(1);
  return { query, release, registrarPassagem, log, erroConsulta, erroRollback };
}

describe("a transação real da passagem não devolve cliente incerto ao pool", () => {
  it("commit saudável reutiliza o cliente", async () => {
    const r = await gravar();
    expect(r.query).toHaveBeenCalledWith("commit");
    expect(r.release.mock.calls[0]?.[0]).toBeUndefined();
    expect(r.registrarPassagem).toHaveBeenCalledTimes(1);
    expect(r.log.warn).not.toHaveBeenCalled();
  });

  it("recibo repetido com rollback saudável não duplica e reutiliza", async () => {
    const r = await gravar({ repetido: true });
    expect(r.query).toHaveBeenCalledWith("rollback");
    expect(r.registrarPassagem).not.toHaveBeenCalled();
    expect(r.release.mock.calls[0]?.[0]).toBeUndefined();
    expect(r.log.warn).not.toHaveBeenCalled();
  });

  it.each([/^begin$/, /advisory/, /^update conversations/, /^commit$/])(
    "erro de query %s descarta mesmo quando rollback responde", async (falha) => {
      const r = await gravar({ falha });
      expect(r.query).toHaveBeenCalledWith("rollback");
      expect(r.release.mock.calls[0]?.[0]).toBe(r.erroConsulta);
      expect(r.log.warn).toHaveBeenCalledTimes(1);
    },
  );

  it("timeout de query e rollback incerto descartam uma única vez", async () => {
    const r = await gravar({ falha: /advisory/, rollbackFalha: true });
    expect(r.release.mock.calls[0]?.[0]).toBe(r.erroConsulta);
    expect(r.log.warn).toHaveBeenCalledTimes(1);
  });

  it("rollback do recibo repetido que falha também descarta", async () => {
    const r = await gravar({ repetido: true, rollbackFalha: true });
    expect(r.release.mock.calls[0]?.[0]).toBe(r.erroRollback);
    expect(r.registrarPassagem).not.toHaveBeenCalled();
  });

  it("registro que absorveu falha de INSERT não libera conexão como saudável", async () => {
    const r = await gravar({ registroFalha: true });
    expect(r.query).toHaveBeenCalledWith("rollback");
    expect(r.release.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(r.log.warn).toHaveBeenCalledTimes(1);
  });
});

async function passar(kind: string) {
  let aviso: unknown;
  const canal = { send: vi.fn(async () => ({ kind, idempotencyKey: "chave", messageId: "mensagem" })) };
  const callbacks = runInNewContext(compilar(`${envioReal}\nconst callbacks = {${coletaReal},${callbackReal}};`) +
    "; callbacks", {
    runBeforeSend: async (args: { body: string; send(body: string): Promise<unknown> }) => kind === "vetoed"
      ? { status: "vetoed", code: "messaging_window_closed" }
      : { status: "sent", outcome: await args.send(args.body), trace: [] },
    erroCurto: () => "erro_sintetico", pool: {}, runLog: { warn() {}, info() {} },
    tenantId: "org-sintetica", leadId: "contato-sintetico",
    input: { conversationId: "conversa-sintetica", channelSessionId: "canal-sintetico" },
    liveJob: () => ({ id: "job-sintetico" }), agentConfig: null, liveChannel: () => canal,
    optedOutThisTurn: false, clock: () => new Date("2026-10-26T12:00:00Z"),
    performHumanHandoff: async (_db: unknown, _ids: unknown, opts: { avisoAoLead: unknown }) => { aviso = opts.avisoAoLead; },
  }) as { enviar(texto: string): Promise<boolean>; passarParaHumano(args: unknown): Promise<void> };
  // A fila conserva a custódia da coleta: não devolver à IA nem repetir envio.
  expect(await callbacks.enviar("Pergunta sintética.")).toBe(["sent", "already_sent", "queued"].includes(kind));
  expect(canal.send).toHaveBeenCalledTimes(kind === "vetoed" ? 0 : 1);
  canal.send.mockClear();
  await callbacks.passarParaHumano({ campos: { categoria: "patologia" }, aviso: "Passando para a equipe.", idempotencia: "tentativa-1" });
  expect(canal.send).toHaveBeenCalledTimes(kind === "vetoed" ? 0 : 1);
  return aviso;
}

describe("o helper e o callback reais preservam o fato do aviso", () => {
  it.each(["sent", "already_sent"])("%s chega à passagem como aviso entregue", async (kind) => {
    expect(await passar(kind)).toEqual({ avisado: true });
  });

  it("queued mantém custódia e chega à passagem como ainda não avisado", async () => {
    expect(await passar("queued")).toEqual({
      avisado: false, porque: "na_fila_canal_fora", motivoCodigo: "na_fila_canal_fora",
    });
  });

  it.each(["blocked", "failed", "unavailable", "vetoed"])("%s não afirma entrega nem repete envio", async (kind) => {
    expect(await passar(kind)).toMatchObject({ avisado: false });
  });
});
