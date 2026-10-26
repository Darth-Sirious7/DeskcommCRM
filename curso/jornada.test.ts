import { describe, expect, it } from "vitest";
import { Nicho, validarJornadas } from "./jornada";

const cena = { id: "chegada", titulo: "Chegada", cliente: "Pergunta", operacao: "Equipe atende", valor: "Contexto disponível", captura: "foto" };
const historia = { id: "consulta", titulo: "Consulta", empresa: "Empresa fictícia", contexto: "Exemplo", resultado: "Atendimento", tipo: "roteiro-demonstrativo", nota: "Dados fictícios", dependencias: "Canal configurado", montagem: [{ modulo: "inbox", licao: "ler", porque: "Ver a conversa" }], cenas: [cena] };
const nicho = { id: "clinicas", titulo: "Clínicas", resumo: "Atendimento", jornadas: [historia] };
const modulos = [{ id: "inbox", licoes: [{ id: "ler" }] }];
const capturas = { foto: { foto: "fotos/foto.png", destaques: [] } };

describe("contrato das jornadas", () => {
  it("aceita conteúdo válido e catálogo vazio durante a montagem", () => {
    expect(Nicho.parse(nicho).id).toBe("clinicas");
    expect(() => validarJornadas([nicho], modulos, capturas)).not.toThrow();
    expect(() => validarJornadas([], modulos, capturas)).not.toThrow();
  });
  it("recusa campos desconhecidos, ids inseguros e histórias sem cenas", () => {
    expect(Nicho.safeParse({ ...nicho, privado: "segredo" }).success).toBe(false);
    expect(Nicho.safeParse({ ...nicho, id: "clinicas.<script>" }).success).toBe(false);
    expect(Nicho.safeParse({ ...nicho, jornadas: [{ ...historia, cenas: [] }] }).success).toBe(false);
  });
  it("recusa ids repetidos em cada escopo", () => {
    expect(() => validarJornadas([nicho, nicho], modulos, capturas)).toThrow(/repetid/);
    expect(() => validarJornadas([{ ...nicho, jornadas: [historia, historia] }], modulos, capturas)).toThrow(/repetid/);
    expect(() => validarJornadas([{ ...nicho, jornadas: [{ ...historia, cenas: [cena, cena] }] }], modulos, capturas)).toThrow(/repetid/);
  });
  it("recusa referência de lição ausente", () => {
    expect(() => validarJornadas([nicho], [], capturas)).toThrow(/lição/);
    expect(() => validarJornadas([nicho], [{ id: "inbox", licoes: [] }], capturas)).toThrow(/lição/);
  });
  it("recusa foto ausente, URL externa e chave herdada", () => {
    expect(() => validarJornadas([nicho], modulos, {})).toThrow(/foto/);
    expect(() => validarJornadas([nicho], modulos, { foto: { foto: "https://example.com/foto.png" } })).toThrow(/foto/);
    expect(() => validarJornadas([{ ...nicho, jornadas: [{ ...historia, cenas: [{ ...cena, captura: "constructor" }] }] }], modulos, capturas)).toThrow(/foto/);
  });
});

// Exerce o renderer estático com dados de teste, sem publicar uma história falsa.
import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";

describe("apresentação estática", () => {
  it("recupera hashes inválidos, monta links de lição e indexa histórias", async () => {
    document.body.innerHTML = '<main id="teste"></main>';
    const vista = document.getElementById("teste")!;
    const criar = new Function(readFileSync(path.join(process.cwd(), "curso/site/demonstracoes.js"), "utf8") + ";return window.criarDemonstracoes;")();
    const dados = { nichos: [nicho], modulos: [{ id: "inbox", titulo: "Inbox", licoes: [{ id: "ler", titulo: "Ler conversa" }] }], capturas };
    const demo = criar({ dados, vista, esc: (s: string) => s, figura: () => '<figure>Foto anotada</figure>', legenda: () => '<ol>Legenda</ol>' });
    expect(demo.reconhecer("m.inbox")).toBeNull();
    expect(demo.reconhecer("demo.clinicas.consulta.nao-existe")).toEqual({ tipo: "acao" });
    expect(demo.reconhecer("acao.clinicas.excesso")).toEqual({ tipo: "acao" });
    const r = demo.reconhecer("demo.clinicas.consulta.chegada");
    vista.innerHTML = demo.render(r);
    demo.posRender(r);
    expect(vista.textContent).toContain("O cliente");
    expect(vista.textContent).toContain("Na operação");
    expect(vista.textContent).toContain("Por que ajuda");
    expect(vista.querySelector('a[aria-current="step"]')).not.toBeNull();
    expect(demo.entradasBusca().map((e: { titulo: string }) => e.titulo)).toEqual(["Clínicas", "Consulta"]);
    vista.innerHTML = demo.render(demo.reconhecer("montagem.clinicas.consulta"));
    expect(vista.querySelector('a[href="#l.inbox.ler"]')).not.toBeNull();
    // Fallback de tela cheia mantém um controle de saída mesmo após renderizar outra cena.
    vista.innerHTML = demo.render(r);
    const tela = vista.querySelector('[data-demo="tela"]') as HTMLButtonElement;
    tela.click();
    expect(document.body.classList.contains("demo-tela-cheia")).toBe(true);
    vista.innerHTML = demo.render(r); demo.posRender(r);
    expect(vista.querySelector('[data-demo="tela"]')?.textContent).toBe("Sair da tela cheia");
    demo.posRender(null);
    expect(document.body.classList.contains("demo-tela-cheia")).toBe(false);
    // Mensagens de clipboard são explícitas nos dois resultados.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    (vista.querySelector('[data-demo="copiar"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(vista.querySelector('[role="status"]')?.textContent).toBe("Link copiado.");
    writeText.mockRejectedValue(new Error("bloqueado"));
    (vista.querySelector('[data-demo="copiar"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(vista.querySelector('[role="status"]')?.textContent).toContain("Não foi possível copiar");
  });
});
