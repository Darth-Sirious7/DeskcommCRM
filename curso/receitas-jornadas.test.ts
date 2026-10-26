import { describe, expect, it } from "vitest";
import { exigirBancoLocal, exigirHttpLocal } from "./seguranca";
import { exigirLanDaFonte } from "./preparar-fonte-loja";
import { chaveDaCena, idDaHistoria, lerHistorias, receitas } from "./receitas-jornadas";

describe("receitas reprodutíveis das jornadas", () => {
  it("cobre cada cena e sua foto exclusiva sem depender da saída ignorada", () => {
    const historias = lerHistorias();
    expect(receitas).toHaveLength(historias.length);
    const chaves: string[] = [], ids: string[] = [];
    for (const h of historias) {
      const r = receitas.find((x) => x.jornada === h.id)!;
      expect(r.cenas.map((c) => c.id)).toEqual(h.cenas.map((c) => c.id));
      expect(new Set(r.cenas.map((c) => c.superficie)).size).toBeGreaterThan(1);
      for (const c of h.cenas) {
        const chave = chaveDaCena(h.id, c.id);
        expect(c.captura).toBe(chave); chaves.push(chave);
      }
      for (let i = 1; i <= 6; i++) ids.push(idDaHistoria(h.id, i));
    }
    expect(chaves).toHaveLength(120);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("recusa destinos remotos e redirecionamento por parâmetros, sem expor URL", () => {
    for (const url of ["https://localhost", "http://localhost.evil.test", "http://user:secret@localhost", "http://localhost/?host=evil", "http://localhost/caminho", "http://10.0.2.2:5432", "http://hg-vps"]) {
      expect(() => exigirHttpLocal(url)).toThrow(/local/);
    }
    expect(exigirHttpLocal("http://127.0.0.1:3460")).toBe("http://127.0.0.1:3460");
    expect(() => exigirBancoLocal("postgres://localhost/db?host=remote")).toThrow();
  });
  it("a fonte só aceita IP LAN explícito, sem relaxar a cerca de administração local", () => {
    for (const host of [undefined, "localhost", "127.0.0.1", "8.8.8.8", "10.0.2.2.evil.test", "169.254.169.254", "172.32.0.1"]) {
      expect(() => exigirLanDaFonte(host)).toThrow();
    }
    expect(exigirLanDaFonte("10.0.2.2")).toBe("10.0.2.2");
    expect(exigirLanDaFonte("172.16.0.2")).toBe("172.16.0.2");
    expect(() => exigirBancoLocal("postgres://10.0.2.2/db")).toThrow();
  });
  it("permite importar o capturador e os helpers sem contas ou conexão", async () => {
    // Estes imports eram um leitor de contas e uma conexão eager; CI não tem nenhum dos dois.
    const capturador = await import("./capturar");
    const semente = await import("./semear-demonstracao");
    expect(capturador.medir).toBeTypeOf("function");
    expect(semente.semearBase).toBeTypeOf("function");
  });
});
