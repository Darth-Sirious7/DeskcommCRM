import { describe, expect, it } from "vitest";

import { corpoDoAvisoDeMensagem, montarPayloadDeInbound, pushDeveMostrarBandeja, truncar } from "./push_payload";

describe("push_payload", () => {
  it("trunca corpo longo", () => {
    expect(truncar("a".repeat(141)).endsWith("…")).toBe(true);
    expect(truncar("oi").length).toBe(2);
  });

  it("monta título com marca e href da conversa", () => {
    const p = montarPayloadDeInbound({
      brand: "Clínica",
      conversationId: "c1",
      preview: "olá",
    });
    expect(p.title).toBe("Nova mensagem");
    expect(p.href).toBe("/app/inbox?id=c1");
    expect(p.tag).toBe("msg:c1");
    expect(p.body).toBe("olá");
  });

  it("usa o nome do contato no título quando informado", () => {
    const p = montarPayloadDeInbound({
      brand: "Clínica",
      conversationId: "c1",
      preview: "olá",
      contactName: "Maria",
    });
    expect(p.title).toBe("Maria");
  });

  it("só mostra bandeja via push quando nenhum cliente está visível", () => {
    expect(pushDeveMostrarBandeja(0)).toBe(true);
    expect(pushDeveMostrarBandeja(1)).toBe(false);
  });

  it("repassa o corpo sem prévia declarado pelo produtor", () => {
    const p = montarPayloadDeInbound({ brand: "x", conversationId: "c1", preview: "olá", corpoSemPrevia: "Nova mensagem" });
    expect(p.corpoSemPrevia).toBe("Nova mensagem");
  });
});

describe("corpoDoAvisoDeMensagem", () => {
  it("texto: a prévia truncada no corpo e 'Nova mensagem' sem prévia", () => {
    expect(corpoDoAvisoDeMensagem("text", "  olá  ")).toEqual({ body: "olá", corpoSemPrevia: "Nova mensagem" });
    expect(corpoDoAvisoDeMensagem("text", "a".repeat(200)).body.endsWith("…")).toBe(true);
  });

  it("texto vazio vira 'Nova mensagem'", () => {
    expect(corpoDoAvisoDeMensagem("text", "   ")).toEqual({ body: "Nova mensagem", corpoSemPrevia: "Nova mensagem" });
    expect(corpoDoAvisoDeMensagem("text", null).body).toBe("Nova mensagem");
  });

  it.each([
    ["audio", "Áudio"],
    ["image", "Imagem"],
    ["video", "Vídeo"],
    ["document", "Documento"],
    ["sticker", "Figurinha"],
    ["location", "Localização compartilhada"],
    ["contact", "Contato"],
  ])("%s diz o tipo nos dois campos, nunca 'Mídia' nem a legenda", (tipo, rotulo) => {
    expect(corpoDoAvisoDeMensagem(tipo, "legenda da foto")).toEqual({ body: rotulo, corpoSemPrevia: rotulo });
  });

  it.each(["template", "desconhecido"])("%s vira 'Nova mensagem'", (tipo) => {
    expect(corpoDoAvisoDeMensagem(tipo, "x")).toEqual({ body: "Nova mensagem", corpoSemPrevia: "Nova mensagem" });
  });
});
