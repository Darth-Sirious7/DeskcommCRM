/**
 * A COLETA DE DNS do domínio de envio (#3441).
 *
 * O que este arquivo prova, com resolvedor FAKE (nenhuma consulta real):
 *
 *   1. as cinco perguntas são feitas nos nomes certos — `raiz`, `send.<d>`,
 *      `resend._domainkey.<d>` e `_dmarc.<d>` — porque um nome torto aqui faz a
 *      tela dizer "ausente" para um registro que está publicado;
 *   2. `ENOTFOUND` de UMA consulta não derruba as outras: é assim que um domínio
 *      recém-criado se parece, e a tela precisa dizer QUAL falta;
 *   3. o MX sai já formatado (`<prioridade> <host>`) e ORDENADO, sem o ponto
 *      final do FQDN — é o texto que vai para a tabela e para a frase do problema;
 *   4. domínio inválido não consulta NADA e devolve o motivo, com a frase que
 *      ensina o formato;
 *   5. a hora vem do injetor `agora`, então o carimbo `conferidoEm` é comparável.
 */
import { describe, expect, it, vi } from "vitest";

import {
  conferirDominioDeEnvio,
  respostasDnsDoDominio,
  type ResolvedorDns,
} from "@/lib/email/dominio-de-envio-dns";
import { diagnosticarDominioDeEnvio } from "@/lib/email/dominio-de-envio";

const DOMINIO = "lojadaana.com";
const AGORA = () => new Date("2026-10-26T12:00:00.000Z");

/** Um resolvedor de mentira, com o que cada nome responde e o que explode. */
function resolvedorFake(mapa: {
  txt?: Record<string, string[][]>;
  mx?: Record<string, { exchange: string; priority: number }[]>;
}): ResolvedorDns & { txtChamado: ReturnType<typeof vi.fn>; mxChamado: ReturnType<typeof vi.fn> } {
  const txtChamado = vi.fn(async (nome: string) => {
    const resposta = mapa.txt?.[nome];
    if (!resposta) throw Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" });
    return resposta;
  });
  const mxChamado = vi.fn(async (nome: string) => {
    const resposta = mapa.mx?.[nome];
    if (!resposta) throw Object.assign(new Error("queryMx ENODATA"), { code: "ENODATA" });
    return resposta;
  });
  return { txt: txtChamado, mx: mxChamado, txtChamado, mxChamado };
}

const MAPA_COMPLETO = {
  txt: {
    [DOMINIO]: [],
    [`send.${DOMINIO}`]: [["v=spf1 include:amazonses.com ~all"]],
    [`resend._domainkey.${DOMINIO}`]: [["v=DKIM1; k=rsa; ", "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7"]],
    [`_dmarc.${DOMINIO}`]: [["v=DMARC1; p=reject; rua=mailto:dmarc@lojadaana.com"]],
  },
  mx: {
    [`send.${DOMINIO}`]: [{ exchange: "feedback-smtp.us-east-1.amazonses.com.", priority: 10 }],
  },
};

describe("respostasDnsDoDominio", () => {
  it("pergunta nos cinco nomes do domínio de envio", async () => {
    const resolvedor = resolvedorFake(MAPA_COMPLETO);
    const respostas = await respostasDnsDoDominio(DOMINIO, resolvedor);

    expect(respostas).not.toBeNull();
    expect(resolvedor.txtChamado.mock.calls.map((c) => c[0])).toEqual([
      DOMINIO,
      `send.${DOMINIO}`,
      `resend._domainkey.${DOMINIO}`,
      `_dmarc.${DOMINIO}`,
    ]);
    expect(resolvedor.mxChamado.mock.calls.map((c) => c[0])).toEqual([`send.${DOMINIO}`]);
  });

  it("formata o MX com prioridade, sem o ponto final e em ordem", async () => {
    const resolvedor = resolvedorFake({
      ...MAPA_COMPLETO,
      mx: {
        [`send.${DOMINIO}`]: [
          { exchange: "feedback-smtp.us-east-1.amazonses.com.", priority: 20 },
          { exchange: "feedback-smtp.sa-east-1.amazonses.com.", priority: 10 },
        ],
      },
    });
    const respostas = await respostasDnsDoDominio(DOMINIO, resolvedor);
    expect(respostas!.envioMx).toEqual([
      "10 feedback-smtp.sa-east-1.amazonses.com",
      "20 feedback-smtp.us-east-1.amazonses.com",
    ]);
  });

  it("`ENOTFOUND` de uma consulta vira vazio e NÃO derruba as outras", async () => {
    const resolvedor = resolvedorFake({
      txt: {
        [`send.${DOMINIO}`]: [["v=spf1 include:amazonses.com ~all"]],
        [`resend._domainkey.${DOMINIO}`]: [["v=DKIM1; k=rsa; p=MIGf"]],
      },
      mx: MAPA_COMPLETO.mx,
    });
    const respostas = await respostasDnsDoDominio(DOMINIO, resolvedor);
    // A pergunta que não existe é a do DMARC — e é ELA que fica ausente.
    expect(respostas!.dmarcTxt).toEqual([]);
    expect(respostas!.envioTxt).toEqual([["v=spf1 include:amazonses.com ~all"]]);
    const diag = diagnosticarDominioDeEnvio(
      DOMINIO,
      respostas!,
      "2026-10-26T12:00:00.000Z",
    );
    expect(diag!.registros.find((r) => r.tipo === "dmarc")!.estado).toBe("ausente");
    expect(diag!.registros.find((r) => r.tipo === "spf")!.estado).toBe("ok");
  });

  it("domínio inválido não consulta nada", async () => {
    const resolvedor = resolvedorFake(MAPA_COMPLETO);
    expect(await respostasDnsDoDominio("localhost", resolvedor)).toBeNull();
    expect(resolvedor.txtChamado).not.toHaveBeenCalled();
    expect(resolvedor.mxChamado).not.toHaveBeenCalled();
  });
});

describe("conferirDominioDeEnvio", () => {
  it("domínio completo devolve o diagnóstico e o carimbo de hora injetado", async () => {
    const r = await conferirDominioDeEnvio(DOMINIO, {
      resolvedor: resolvedorFake(MAPA_COMPLETO),
      agora: AGORA,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagnostico.prontoParaEnviar).toBe(true);
    expect(r.diagnostico.conferidoEm).toBe("2026-10-26T12:00:00.000Z");
    expect(r.diagnostico.registros).toHaveLength(4);
  });

  it("aceita endereço de remetente — o campo da tela aceita os dois", async () => {
    const r = await conferirDominioDeEnvio(`contato@${DOMINIO}`, {
      resolvedor: resolvedorFake(MAPA_COMPLETO),
      agora: AGORA,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagnostico.dominio).toBe(DOMINIO);
  });

  it("domínio inválido devolve o motivo com a frase do formato, sem consultar", async () => {
    const resolvedor = resolvedorFake(MAPA_COMPLETO);
    const r = await conferirDominioDeEnvio("https://lojadaana.com", { resolvedor, agora: AGORA });
    expect(r).toMatchObject({ ok: false, motivo: "dominio_invalido" });
    if (r.ok) return;
    expect(r.bloqueios[0]).toContain("lojadaana.com");
    expect(resolvedor.txtChamado).not.toHaveBeenCalled();
  });

  it("DNS morto em todas as perguntas: quatro bloqueios, sem lançar", async () => {
    const r = await conferirDominioDeEnvio(DOMINIO, {
      resolvedor: resolvedorFake({}),
      agora: AGORA,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagnostico.prontoParaEnviar).toBe(false);
    expect(r.diagnostico.bloqueios).toHaveLength(4);
  });
});
