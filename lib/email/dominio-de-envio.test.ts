/**
 * O DIAGNÓSTICO DO DOMÍNIO DE ENVIO (#3441), na camada PURA.
 *
 * O que este arquivo prova, caso a caso — sem rede, sem banco, sem relógio:
 *
 *   1. `dominioDeEndereco` aceita domínio E endereço de remetente, e recusa o que
 *      não é nome de máquina (esquema, espaço, IP, rótulo com hífen na ponta);
 *   2. o TXT é lido por REGISTRO, com os pedaços de 255 bytes COLADOS — o DKIM da
 *      Resend chega partido, e emendar pedaços de registros diferentes produziria
 *      uma chave que não existe;
 *   3. SPF: um registro e com `all` é `ok`; dois é `conflitante` (RFC 7208 §3.2);
 *      sem `all` e `?all` são `atencao`; nada é `ausente` e o texto DIZ onde
 *      procurar; a raiz serve de reserva para quem publica fora de `send.`;
 *   4. DKIM: chave presente é `ok`; `p=` vazio é `conflitante` (é assim que se
 *      revoga); nada é `ausente` com o nome do seletor na mensagem;
 *   5. MX de retorno: presente é `ok`, `null MX` é `conflitante`, nada é `ausente`;
 *   6. DMARC: `p=reject`/`quarantine` é `ok`; `p=none` e `pct<100` são `atencao`;
 *      sem `p=` e dois registros são `conflitante`; nada é `ausente` e o esperado
 *      já vem com `rua=`;
 *   7. o veredito: qualquer `ausente`/`conflitante` bloqueia, `atencao` não, e o
 *      texto de cada linha é o que a tela mostra — `conferidoEm` vem de fora.
 */
import { describe, expect, it } from "vitest";

import {
  diagnosticarDominioDeEnvio,
  dominioDeEndereco,
  lerPoliticaDmarc,
  textosDosRegistros,
  type RespostasDns,
} from "@/lib/email/dominio-de-envio";

const AGORA = "2026-10-26T12:00:00.000Z";
const DOMINIO = "lojadaana.com";

/** O conjunto COMPLETO e correto — cada teste estraga só o que quer medir. */
function respostasBoas(sobrescreve: Partial<RespostasDns> = {}): RespostasDns {
  return {
    raizTxt: [],
    envioTxt: [["v=spf1 include:amazonses.com ~all"]],
    envioMx: ["10 feedback-smtp.us-east-1.amazonses.com"],
    dkimTxt: [["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7"]],
    dmarcTxt: [["v=DMARC1; p=quarantine; rua=mailto:dmarc@lojadaana.com"]],
    ...sobrescreve,
  };
}

function linha(respostas: RespostasDns, tipo: "spf" | "dkim" | "mx" | "dmarc") {
  const diag = diagnosticarDominioDeEnvio(DOMINIO, respostas, AGORA);
  const achado = diag?.registros.find((r) => r.tipo === tipo);
  if (!achado) throw new Error(`registro ${tipo} ausente do diagnóstico`);
  return achado;
}

describe("dominioDeEndereco", () => {
  it("aceita o domínio e o endereço de remetente, normalizados", () => {
    expect(dominioDeEndereco("lojadaana.com")).toBe("lojadaana.com");
    expect(dominioDeEndereco("  LOJA DA ANA ")).toBeNull(); // espaço é recusa
    expect(dominioDeEndereco("  LojaDaAna.COM  ")).toBe("lojadaana.com");
    expect(dominioDeEndereco("lojadaana.com.")).toBe("lojadaana.com");
    expect(dominioDeEndereco("contato@lojadaana.com")).toBe("lojadaana.com");
    expect(dominioDeEndereco("  Contato@LojaDaAna.COM ")).toBe("lojadaana.com");
    expect(dominioDeEndereco("no-reply@send.lojadaana.com")).toBe("send.lojadaana.com");
  });

  it("recusa o que não é nome de máquina", () => {
    for (const entrada of [
      "",
      "   ",
      null,
      undefined,
      "localhost",
      "send",
      "https://lojadaana.com",
      "lojadaana.com/path",
      "loj a.com",
      "-lojadaana.com",
      "lojadaana-.com",
      "loja_da_ana.com",
      "lojadaana..com",
      "192.168.0.1",
      "lojadaana.c",
      "a@b@lojadaana.com",
      "@lojadaana.com",
      "contato@",
      "lojadaana.com:8080",
    ]) {
      expect(dominioDeEndereco(entrada), String(entrada)).toBeNull();
    }
  });
});

describe("textosDosRegistros", () => {
  it("cola os pedaços do MESMO registro e descarta vazios", () => {
    expect(
      textosDosRegistros([
        ["v=DKIM1; k=rsa; ", "p=MIGfMA0GCSqGSIb3", "DQEBAQUAA4GNADCBiQKBgQC7"],
        ["   "],
        ["v=DMARC1; p=none"],
      ]),
    ).toEqual(["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7", "v=DMARC1; p=none"]);
  });

  it("respostas vazias ou tortas não lançam", () => {
    expect(textosDosRegistros(undefined)).toEqual([]);
    expect(textosDosRegistros([])).toEqual([]);
    expect(textosDosRegistros([[], ["  "]] as string[][])).toEqual([]);
  });
});

describe("SPF", () => {
  it("um registro com `all` no subdomínio de envio é ok", () => {
    expect(linha(respostasBoas(), "spf")).toMatchObject({
      nome: "send.lojadaana.com",
      estado: "ok",
      encontrado: "v=spf1 include:amazonses.com ~all",
      problema: null,
    });
  });

  it("`-all` (hardfail) também é ok", () => {
    const r = linha(respostasBoas({ envioTxt: [["v=spf1 include:amazonses.com -all"]] }), "spf");
    expect(r.estado).toBe("ok");
  });

  it("dois registros SPF são conflitantes — a norma manda descartar os dois", () => {
    const r = linha(
      respostasBoas({
        envioTxt: [["v=spf1 include:amazonses.com ~all"], ["v=spf1 include:outro.com ~all"]],
      }),
      "spf",
    );
    expect(r.estado).toBe("conflitante");
    expect(r.problema).toContain("RFC 7208");
  });

  it("sem `all` ou com `?all` é aviso, não bloqueio", () => {
    for (const registro of ["v=spf1 include:amazonses.com", "v=spf1 include:amazonses.com ?all", "v=spf1 all"]) {
      const r = linha(respostasBoas({ envioTxt: [[registro]] }), "spf");
      expect(r.estado, registro).toBe("atencao");
      expect(r.problema, registro).toBeTruthy();
    }
  });

  it("ausente diz os DOIS nomes onde procurou", () => {
    const r = linha(respostasBoas({ envioTxt: [], raizTxt: [] }), "spf");
    expect(r.estado).toBe("ausente");
    expect(r.problema).toContain("send.lojadaana.com");
    expect(r.problema).toContain("lojadaana.com");
    expect(r.esperado).toContain("include:amazonses.com");
  });

  it("a raiz serve de reserva para quem publica fora do subdomínio de envio", () => {
    const r = linha(
      respostasBoas({ envioTxt: [], raizTxt: [["v=spf1 include:_spf.google.com ~all"]] }),
      "spf",
    );
    expect(r.nome).toBe("lojadaana.com");
    expect(r.estado).toBe("ok");
    expect(r.encontrado).toContain("_spf.google.com");
  });

  it("o subdomínio de envio tem precedência sobre a raiz", () => {
    const r = linha(
      respostasBoas({
        envioTxt: [["v=spf1 include:amazonses.com ~all"]],
        raizTxt: [["v=spf1 include:outro.com ~all"]],
      }),
      "spf",
    );
    expect(r.nome).toBe("send.lojadaana.com");
    expect(r.encontrado).toContain("amazonses.com");
  });
});

describe("DKIM", () => {
  it("chave presente (mesmo partida em pedaços) é ok", () => {
    const r = linha(
      respostasBoas({
        dkimTxt: [["v=DKIM1; k=rsa; ", "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7"]],
      }),
      "dkim",
    );
    expect(r.nome).toBe("resend._domainkey.lojadaana.com");
    expect(r.estado).toBe("ok");
    expect(r.encontrado).toBe("v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7");
  });

  it("`p=` vazio é chave REVOGADA — conflitante, não ausente", () => {
    const r = linha(respostasBoas({ dkimTxt: [["v=DKIM1; k=rsa; p="]] }), "dkim");
    expect(r.estado).toBe("conflitante");
    expect(r.problema).toContain("REVOGA");
  });

  it("registro sem `p=` é conflitante", () => {
    const r = linha(respostasBoas({ dkimTxt: [["v=DKIM1; k=rsa"]] }), "dkim");
    expect(r.estado).toBe("conflitante");
  });

  it("ausente nomeia o seletor e avisa que outro provedor usa outro", () => {
    const r = linha(respostasBoas({ dkimTxt: [] }), "dkim");
    expect(r.estado).toBe("ausente");
    expect(r.problema).toContain("resend._domainkey.lojadaana.com");
    expect(r.problema).toContain("outro seletor");
  });
});

describe("MX de retorno", () => {
  it("presente é ok", () => {
    expect(linha(respostasBoas(), "mx")).toMatchObject({
      nome: "send.lojadaana.com",
      estado: "ok",
      encontrado: "10 feedback-smtp.us-east-1.amazonses.com",
    });
  });

  it("`null MX` é conflitante — o domínio se declara não-recebedor", () => {
    const r = linha(respostasBoas({ envioMx: ["."] }), "mx");
    expect(r.estado).toBe("conflitante");
    expect(r.problema).toContain("null MX");
  });

  it("ausente explica por que a supressão depende dele", () => {
    const r = linha(respostasBoas({ envioMx: [] }), "mx");
    expect(r.estado).toBe("ausente");
    expect(r.problema).toContain("supressão");
  });
});

describe("DMARC", () => {
  it("`p=quarantine` com `rua=` é ok", () => {
    expect(linha(respostasBoas(), "dmarc")).toMatchObject({ estado: "ok", problema: null });
  });

  it("`p=none` é aviso — cumpre publicar, mas não pede recusa", () => {
    const r = linha(respostasBoas({ dmarcTxt: [["v=DMARC1; p=none; rua=mailto:d@lojadaana.com"]] }), "dmarc");
    expect(r.estado).toBe("atencao");
    expect(r.problema).toContain("MONITORAMENTO");
  });

  it("`pct` abaixo de 100 é aviso, com o número na frase", () => {
    const r = linha(
      respostasBoas({ dmarcTxt: [["v=DMARC1; p=reject; pct=25; rua=mailto:d@lojadaana.com"]] }),
      "dmarc",
    );
    expect(r.estado).toBe("atencao");
    expect(r.problema).toContain("25%");
  });

  it("caixa alta nas tags não engana o leitor", () => {
    const r = linha(respostasBoas({ dmarcTxt: [["V=DMARC1; P=REJECT; RUA=mailto:d@lojadaana.com"]] }), "dmarc");
    expect(r.estado).toBe("ok");
  });

  it("sem `p=` é conflitante", () => {
    const r = linha(respostasBoas({ dmarcTxt: [["v=DMARC1; rua=mailto:d@lojadaana.com"]] }), "dmarc");
    expect(r.estado).toBe("conflitante");
    expect(r.problema).toContain("p=");
  });

  it("dois registros DMARC são conflitantes", () => {
    const r = linha(
      respostasBoas({ dmarcTxt: [["v=DMARC1; p=none"], ["v=DMARC1; p=reject"]] }),
      "dmarc",
    );
    expect(r.estado).toBe("conflitante");
  });

  it("ausente traz o registro de partida com `rua=` no campo do que publicar", () => {
    const r = linha(respostasBoas({ dmarcTxt: [] }), "dmarc");
    expect(r.estado).toBe("ausente");
    expect(r.esperado).toBe("v=DMARC1; p=none; rua=mailto:dmarc@lojadaana.com");
    expect(r.problema).toContain("Gmail");
  });
});

describe("lerPoliticaDmarc", () => {
  it("lê política, pct, relatório e alinhamento", () => {
    expect(lerPoliticaDmarc("v=DMARC1; p=reject; pct=50; rua=mailto:a@b.com; adkim=s")).toEqual({
      politica: "reject",
      pct: 50,
      temRelatorio: true,
      alinhamentoEstrito: true,
    });
  });

  it("política desconhecida e pct fora da faixa viram ausência de valor, sem lançar", () => {
    expect(lerPoliticaDmarc("v=DMARC1; p=banana; pct=999")).toEqual({
      politica: null,
      pct: null,
      temRelatorio: false,
      alinhamentoEstrito: false,
    });
  });
});

describe("diagnosticarDominioDeEnvio (veredito)", () => {
  it("domínio completo: pronto para enviar, sem bloqueio nem aviso", () => {
    const diag = diagnosticarDominioDeEnvio(DOMINIO, respostasBoas(), AGORA);
    expect(diag).not.toBeNull();
    expect(diag!.prontoParaEnviar).toBe(true);
    expect(diag!.bloqueios).toEqual([]);
    expect(diag!.avisos).toEqual([]);
    expect(diag!.conferidoEm).toBe(AGORA);
    expect(diag!.dominio).toBe(DOMINIO);
    // A ordem é a da tela: quem pode entregar, assinatura, voltas, política.
    expect(diag!.registros.map((r) => r.tipo)).toEqual(["spf", "dkim", "mx", "dmarc"]);
  });

  it("um registro ausente BLOQUEIA o veredito e vira frase em bloqueios", () => {
    const diag = diagnosticarDominioDeEnvio(DOMINIO, respostasBoas({ dkimTxt: [] }), AGORA);
    expect(diag!.prontoParaEnviar).toBe(false);
    expect(diag!.bloqueios).toHaveLength(1);
    expect(diag!.bloqueios[0]).toContain("resend._domainkey.lojadaana.com");
  });

  it("`p=none` não bloqueia — vira aviso", () => {
    const diag = diagnosticarDominioDeEnvio(
      DOMINIO,
      respostasBoas({ dmarcTxt: [["v=DMARC1; p=none; rua=mailto:d@lojadaana.com"]] }),
      AGORA,
    );
    expect(diag!.prontoParaEnviar).toBe(true);
    expect(diag!.avisos).toHaveLength(1);
  });

  it("DMARC sem `rua=` gera aviso mesmo quando a política está ok", () => {
    const diag = diagnosticarDominioDeEnvio(
      DOMINIO,
      respostasBoas({ dmarcTxt: [["v=DMARC1; p=reject"]] }),
      AGORA,
    );
    expect(diag!.prontoParaEnviar).toBe(true);
    expect(diag!.avisos.some((a) => a.includes("rua="))).toBe(true);
  });

  it("alinhamento estrito gera aviso de encaminhamento", () => {
    const diag = diagnosticarDominioDeEnvio(
      DOMINIO,
      respostasBoas({ dmarcTxt: [["v=DMARC1; p=reject; adkim=s; rua=mailto:d@lojadaana.com"]] }),
      AGORA,
    );
    expect(diag!.avisos.some((a) => a.includes("ESTRITO"))).toBe(true);
  });

  it("entrada que não é domínio devolve null", () => {
    expect(diagnosticarDominioDeEnvio("localhost", respostasBoas(), AGORA)).toBeNull();
    expect(diagnosticarDominioDeEnvio("", respostasBoas(), AGORA)).toBeNull();
  });

  it("DNS vazio de tudo não lança: são quatro bloqueios, um por pergunta", () => {
    const diag = diagnosticarDominioDeEnvio(
      DOMINIO,
      { raizTxt: [], envioTxt: [], envioMx: [], dkimTxt: [], dmarcTxt: [] },
      AGORA,
    );
    expect(diag!.prontoParaEnviar).toBe(false);
    expect(diag!.bloqueios).toHaveLength(4);
  });

  it("aceita endereço de remetente na entrada, como a tela entrega", () => {
    const diag = diagnosticarDominioDeEnvio("contato@lojadaana.com", respostasBoas(), AGORA);
    expect(diag!.dominio).toBe(DOMINIO);
  });
});
