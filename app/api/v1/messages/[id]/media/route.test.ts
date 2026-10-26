/**
 * GET /api/v1/messages/{id}/media?baixar=1 — o nome original ao BAIXAR (#2613).
 *
 * O relato da issue fecha com um critério que o PR anterior deixou declarado
 * como "não verificado": *"Avaliar o fluxo de nomeação do arquivo ao baixar,
 * preservando o nome original quando disponível"*. Até aqui o cartão mostrava
 * `Relatorio_Vendas_Outubro.xlsx` mas o arquivo salvo pelo navegador chegava
 * como `{uuid}.xlsx` — o nome existia no banco e morria na última etapa.
 *
 * O que este arquivo mede, e por quê:
 *
 *  (A) `?baixar=1` + nome guardado → a URL assinada sai com `download`, que é
 *      o que faz o Storage responder `Content-Disposition: attachment` com o
 *      nome. Sem o terceiro argumento, o Storage devolve o basename canônico.
 *  (B) `?baixar=1` SEM nome guardado → NENHUM nome é inventado: a assinatura
 *      continua com dois argumentos. Anexo antigo (ou canal que não manda
 *      `filename`) não vira `documento.pdf` na cara do atendente.
 *  (C) sem `?baixar=1` → a rota segue 302 como sempre: o cartão abre o PDF em
 *      aba nova, e o preview não é sequestrado pelo download.
 *  (D) janela do worker (bytes ainda não persistidos) → o proxy devolve
 *      `Content-Disposition` com `filename` (fallback ASCII) e `filename*`
 *      (RFC 5987), que é o único par que nomeia acento corretamente.
 *
 * O caminho de produção é o da rota: `createClient` → RLS → `maybeSingle`, e
 * `createAdminClient` → `storage.from(bucket).createSignedUrl`. Só o adapter
 * do canal é dublado em (D) — ele é quem busca os bytes.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ orgAtivaDaApi: vi.fn() }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/messaging/media/voice-transcode", () => ({
  ConversorOcupado: class extends Error {},
  TETO_REPRODUCAO_BYTES: 1024,
  paraReproducaoAac: vi.fn(),
}));
vi.mock("@/lib/channels", async () => {
  const actual = await vi.importActual<typeof import("@/lib/channels")>("@/lib/channels");
  return {
    ...actual,
    getAdapter: vi.fn(),
    // O ref da sessão é só o endereço do canal; o adapter é quem busca os bytes.
    resolveSessionRef: vi.fn(() => ({ provider: "waha", sessionName: "sessao-de-teste" })),
  };
});

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { orgAtivaDaApi } from "@/lib/auth/require-role";
import { loadAuthUser } from "@/lib/auth/server";
import { getAdapter } from "@/lib/channels";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { GET } from "./route";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const MENSAGEM = "55555555-5555-4555-8555-555555555555";
const SESSAO = "66666666-6666-4666-8666-666666666666";
const NOME = "Relatorio_Vendas_Outubro.xlsx";

type Linha = {
  id: string;
  organization_id: string;
  media_url: string | null;
  media_mime: string | null;
  media_size_bytes: number | null;
  media_storage_path: string | null;
  metadata: Record<string, unknown> | null;
  channel_session_id: string | null;
};

/** O que foi pedido ao Storage — o único lugar onde o nome pode virar download. */
const ASSINATURAS: Array<{ bucket: string; path: string; ttl: number; opcoes?: unknown }> = [];

let MENSAGENS: Linha[] = [];

function linha(over: Partial<Linha> = {}): Linha {
  return {
    id: MENSAGEM,
    organization_id: ORG_ID,
    media_url: null,
    media_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    media_size_bytes: 2048,
    media_storage_path: `${ORG_ID}/conv/${MENSAGEM}.xlsx`,
    metadata: null,
    channel_session_id: SESSAO,
    ...over,
  };
}

function consultaDeMensagens() {
  const filtros: Array<[string, unknown]> = [];
  const q = {
    select: () => q,
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor]);
      return q;
    },
    maybeSingle: async () => ({
      data:
        MENSAGENS.find((m) =>
          filtros.every(
            ([c, v]) => (m as unknown as Record<string, unknown>)[c] === v,
          ),
        ) ?? null,
      error: null,
    }),
  };
  return q;
}

function adminFake() {
  const sessao = {
    select: () => sessao,
    eq: () => sessao,
    maybeSingle: async () => ({ data: { provider: "waha" }, error: null }),
  };
  return {
    from: () => sessao,
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number, opcoes?: unknown) => {
          ASSINATURAS.push({ bucket, path, ttl, opcoes });
          return {
            data: { signedUrl: `https://storage.test/signed/${path}?token=t` },
            error: null,
          };
        },
      }),
    },
  };
}

function url(consulta = ""): string {
  return `http://localhost/api/v1/messages/${MENSAGEM}/media${consulta}`;
}

const PARAMS = { params: Promise.resolve({ id: MENSAGEM }) };

beforeEach(() => {
  ASSINATURAS.length = 0;
  MENSAGENS = [];
  vi.mocked(createAdminClient).mockReturnValue(adminFake() as never);
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    from: () => consultaDeMensagens(),
  } as never);
  vi.mocked(loadAuthUser).mockResolvedValue({ id: USER_ID, idioma: "pt-BR" } as never);
  vi.mocked(orgAtivaDaApi).mockResolvedValue({
    ok: true,
    org: { orgId: ORG_ID, name: "Org", role: "agent" },
  } as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, limit: 30, count: 1 } as never);
});

describe("?baixar=1 com nome original guardado", () => {
  it("assina com `download` = nome original, para o arquivo chegar nomeado", async () => {
    MENSAGENS = [linha({ metadata: { media_filename: NOME } })];

    const res = await GET(new NextRequest(url("?baixar=1")), PARAMS);

    expect(res.status).toBe(302);
    expect(ASSINATURAS).toHaveLength(1);
    expect(ASSINATURAS[0]).toMatchObject({ bucket: "whatsapp-media", ttl: 3600 });
    expect(ASSINATURAS[0]?.opcoes).toEqual({ download: NOME });
  });

  it("nome com acento e espaço chega inteiro ao Storage", async () => {
    MENSAGENS = [
      linha({
        media_mime: "application/pdf",
        media_storage_path: `${ORG_ID}/conv/${MENSAGEM}.pdf`,
        metadata: { media_filename: "Orçamento Ação 2026.pdf" },
      }),
    ];

    await GET(new NextRequest(url("?baixar=1")), PARAMS);

    expect(ASSINATURAS[0]?.opcoes).toEqual({ download: "Orçamento Ação 2026.pdf" });
  });
});

describe("?baixar=1 sem nome original", () => {
  it("não inventa nome: assina sem `download`, como hoje", async () => {
    MENSAGENS = [linha({ metadata: null })];

    const res = await GET(new NextRequest(url("?baixar=1")), PARAMS);

    expect(res.status).toBe(302);
    expect(ASSINATURAS[0]?.opcoes).toBeUndefined();
  });

  it("metadata sem a chave (anexo antigo) também não vira nome", async () => {
    MENSAGENS = [linha({ metadata: { raw_type: "document" } })];

    await GET(new NextRequest(url("?baixar=1")), PARAMS);

    expect(ASSINATURAS[0]?.opcoes).toBeUndefined();
  });
});

describe("sem ?baixar=1", () => {
  it("segue 302 sem `download`: o cartão abre o PDF em vez de baixá-lo", async () => {
    MENSAGENS = [linha({ metadata: { media_filename: NOME } })];

    const res = await GET(new NextRequest(url()), PARAMS);

    expect(res.status).toBe(302);
    expect(ASSINATURAS[0]?.opcoes).toBeUndefined();
  });
});

describe("janela do worker (bytes ainda no canal)", () => {
  function semBytes(metadata: Record<string, unknown>) {
    MENSAGENS = [
      linha({
        media_storage_path: null,
        media_url: "https://canal.test/media/abc",
        metadata,
      }),
    ];
    vi.mocked(getAdapter).mockReturnValue({
      fetchInboundMedia: async () => ({
        buffer: Buffer.from("bytes-de-teste"),
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    } as never);
  }

  it("devolve Content-Disposition com filename e filename* (RFC 5987)", async () => {
    semBytes({ media_filename: "Relatório Ção.xlsx" });

    const res = await GET(new NextRequest(url("?baixar=1")), PARAMS);

    expect(res.status).toBe(200);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd.startsWith("attachment;")).toBe(true);
    expect(cd).toContain('filename="Relatorio Cao.xlsx"');
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent("Relatório Ção.xlsx")}`);
  });

  it("sem nome original, o proxy não inventa Content-Disposition", async () => {
    semBytes({ raw_type: "document" });

    const res = await GET(new NextRequest(url("?baixar=1")), PARAMS);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBeNull();
  });
});
