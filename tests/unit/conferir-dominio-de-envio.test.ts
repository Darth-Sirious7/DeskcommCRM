/**
 * `conferirDominioDeEnvio` (#3441) — a ACTION.
 *
 * O que este arquivo prova:
 *
 *   1. as PORTAS, na ordem das actions irmãs (marca, conta Resend): sem sessão,
 *      papel mínimo `admin`, organização ativa e segundo fator. Quem nem tem o
 *      papel recebe `forbidden_role`, e o MFA não é cobrado de quem já seria
 *      barrado antes — cobrar seria pedir um esforço que não resolve nada;
 *   2. a entrada é validada ANTES de qualquer consulta: Server Action é endpoint
 *      público e o tipo do parâmetro não chega ao servidor;
 *   3. o resultado da camada de DNS atravessa intacto, e o `dominio_invalido`
 *      DELA (o que só ela sabe decidir) volta com as frases de motivo;
 *   4. exceção inesperada não derruba Configurações: vira recusa com log.
 *
 * A coleta de DNS é mockada: aqui se mede a action, não o DNS — a régua de cada
 * registro é `lib/email/dominio-de-envio.test.ts`, e a coleta é
 * `lib/email/dominio-de-envio-dns.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { conferirNoDns, loggerError } = vi.hoisted(() => ({
  conferirNoDns: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/email/dominio-de-envio-dns", () => ({ conferirDominioDeEnvio: conferirNoDns }));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
  mfaEmDivida: vi.fn(),
}));
vi.mock("@/lib/auth/pode-administrar-empresa", () => ({ podeAdministrarEmpresa: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: vi.fn(() => false) }));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerError, warn: vi.fn(), info: vi.fn() } }));

import { conferirDominioDeEnvio } from "@/app/actions/settings/conferirDominioDeEnvio";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { supportWriteError } from "@/lib/impersonate/support";

const DIAGNOSTICO = {
  dominio: "lojadaana.com",
  registros: [],
  bloqueios: [],
  avisos: [],
  prontoParaEnviar: true,
  conferidoEm: "2026-10-26T12:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Porta ABERTA por padrão: cada teste de porta fecha só o que mede.
  vi.mocked(loadAuthUser).mockResolvedValue({ id: "user-1", support: null } as never);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: "org-1", role: "admin" } as never);
  vi.mocked(podeAdministrarEmpresa).mockReturnValue(true);
  vi.mocked(mfaEmDivida).mockResolvedValue(false);
  vi.mocked(supportWriteError).mockReturnValue(false as never);
  conferirNoDns.mockResolvedValue({ ok: true, diagnostico: DIAGNOSTICO });
});

describe("conferirDominioDeEnvio — portas", () => {
  it("sem sessão recusa sem consultar o DNS", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue(null as never);
    expect(await conferirDominioDeEnvio("lojadaana.com")).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(conferirNoDns).not.toHaveBeenCalled();
  });

  it("sessão de suporte não escreve nem consulta por procuração", async () => {
    vi.mocked(supportWriteError).mockReturnValue({ ok: false } as never);
    expect(await conferirDominioDeEnvio("lojadaana.com")).toEqual({
      ok: false,
      error: "forbidden_role",
    });
    expect(conferirNoDns).not.toHaveBeenCalled();
  });

  it("sem organização ativa recusa", async () => {
    vi.mocked(resolveActiveOrg).mockResolvedValue(null as never);
    expect(await conferirDominioDeEnvio("lojadaana.com")).toEqual({
      ok: false,
      error: "forbidden_tenant",
    });
    expect(conferirNoDns).not.toHaveBeenCalled();
  });

  it("quem não administra a empresa recebe `forbidden_role` e o MFA nem é cobrado", async () => {
    vi.mocked(podeAdministrarEmpresa).mockReturnValue(false);
    expect(await conferirDominioDeEnvio("lojadaana.com")).toEqual({
      ok: false,
      error: "forbidden_role",
    });
    expect(mfaEmDivida).not.toHaveBeenCalled();
    expect(conferirNoDns).not.toHaveBeenCalled();
  });

  it("admin com segundo fator em dívida é barrado antes da consulta", async () => {
    vi.mocked(mfaEmDivida).mockResolvedValue(true);
    expect(await conferirDominioDeEnvio("lojadaana.com")).toEqual({
      ok: false,
      error: "mfa_required",
    });
    expect(conferirNoDns).not.toHaveBeenCalled();
  });
});

describe("conferirDominioDeEnvio — entrada e resultado", () => {
  it("entrada curta ou de tipo errado é recusada antes de qualquer consulta", async () => {
    for (const entrada of ["", "  ", "ab", 42 as unknown as string, null as unknown as string]) {
      expect(await conferirDominioDeEnvio(entrada), String(entrada)).toEqual({
        ok: false,
        error: "validation_failed",
      });
    }
    expect(conferirNoDns).not.toHaveBeenCalled();
  });

  it("apara a entrada antes de consultar", async () => {
    await conferirDominioDeEnvio("  lojadaana.com  ");
    expect(conferirNoDns).toHaveBeenCalledWith("lojadaana.com");
  });

  it("devolve o diagnóstico da camada de DNS intacto", async () => {
    expect(await conferirDominioDeEnvio("lojadaana.com")).toEqual({
      ok: true,
      diagnostico: DIAGNOSTICO,
    });
  });

  it("`dominio_invalido` decide-se na camada de DNS e volta com as frases de motivo", async () => {
    conferirNoDns.mockResolvedValue({
      ok: false,
      motivo: "dominio_invalido",
      bloqueios: ["Isso não é um domínio: use o nome, como lojadaana.com."],
    });
    expect(await conferirDominioDeEnvio("localhost")).toEqual({
      ok: false,
      error: "dominio_invalido",
      bloqueios: ["Isso não é um domínio: use o nome, como lojadaana.com."],
    });
  });

  it("exceção inesperada vira recusa com log, não tela quebrada", async () => {
    conferirNoDns.mockRejectedValue(new Error("resolvedor sumiu"));
    expect(await conferirDominioDeEnvio("lojadaana.com")).toEqual({
      ok: false,
      error: "dominio_invalido",
    });
    expect(loggerError).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(loggerError).mock.calls)).toContain("resolvedor sumiu");
  });
});
