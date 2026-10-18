import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import {
  CatalogPresentationLeaseLostError,
  CatalogPresentationSnapshotConflictError,
  CatalogPresentationSnapshotInvalidError,
  CHAVE_DO_SNAPSHOT_DA_APRESENTACAO,
  resolveAndSnapshotCatalogPresentation,
} from "@/lib/catalogo/snapshot-de-apresentacao";

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const JOB = "bbbbbbbb-0000-4000-8000-000000000001";
const PRODUCT = "cccccccc-0000-4000-8000-000000000001";
const CLAIM = { worker_id: "worker-a", acquired_at: "2026-10-15 12:34:56.123456+00" };

function productRow(code = "APTO-A") {
  return {
    product_id: PRODUCT,
    product_code: code,
    product_name: "Apartamento A",
    price_cents: "90000000",
    currency: "BRL",
    photo_storage_paths: [`${ORG}/${PRODUCT}/11111111-2222-4333-8444-555555555555.jpg`],
    presentation_id: "dddddddd-0000-4000-8000-000000000001",
    presentation_enabled: true,
    presentation_kind: "text",
    presentation_title: null,
    presentation_text_content: "Perto do metrô.",
    presentation_use_catalog_photos: true,
    presentation_show_price: true,
    presentation_audio_storage_path: null,
    presentation_audio_mime: null,
  };
}

function fixture(
  options: { payload?: Record<string, unknown>; lockFound?: boolean; updateFound?: boolean } = {},
) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  let releasedWith: Error | undefined;
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql === "begin" || sql === "commit" || sql === "rollback")
        return { rows: [], rowCount: null };
      if (sql.includes("from public.job_queue") && sql.includes("for update")) {
        return {
          rows:
            options.lockFound === false
              ? []
              : [{ payload: options.payload ?? { service_boundary: { revision: 1 } } }],
          rowCount: options.lockFound === false ? 0 : 1,
        };
      }
      if (sql.includes("from public.catalog_products"))
        return { rows: [productRow()], rowCount: 1 };
      if (sql.includes("update public.job_queue")) {
        return options.updateFound === false
          ? { rows: [], rowCount: 0 }
          : { rows: [{ id: JOB }], rowCount: 1 };
      }
      throw new Error(`consulta inesperada: ${sql}`);
    },
    release(error?: Error) {
      releasedWith = error;
    },
  };
  return {
    pool: {
      async connect() {
        return client;
      },
    } as unknown as Pool,
    calls,
    releasedWith: () => releasedWith,
  };
}

const input = {
  organizationId: ORG,
  jobId: JOB,
  claim: CLAIM,
  sendsAlreadyCounted: 2,
  orderedProductCodes: ["APTO-A"],
};

describe("snapshot durável da apresentação do catálogo", () => {
  it("resolve pelo tenant e grava sem substituir o restante do payload", async () => {
    const f = fixture();
    const result = await resolveAndSnapshotCatalogPresentation(f.pool, input);

    expect(result).toMatchObject({ ok: true, reused: false });
    const lock = f.calls.find((call) => call.sql.includes("for update"));
    expect(lock?.values).toEqual([JOB, ORG, CLAIM.worker_id, CLAIM.acquired_at]);

    const resolution = f.calls.find((call) => call.sql.includes("from public.catalog_products"));
    expect(resolution?.sql).toContain("p.organization_id = $1");
    expect(resolution?.sql).toContain("a.organization_id = p.organization_id");
    expect(resolution?.values).toEqual([ORG, ["APTO-A"]]);

    const update = f.calls.find((call) => call.sql.includes("update public.job_queue"));
    expect(update?.sql).toContain("jsonb_set(payload");
    expect(update?.sql).toContain("not (payload ? $5)");
    expect(update?.values?.slice(0, 5)).toEqual([
      JOB,
      ORG,
      CLAIM.worker_id,
      CLAIM.acquired_at,
      CHAVE_DO_SNAPSHOT_DA_APRESENTACAO,
    ]);
    expect(JSON.parse(String(update?.values?.[5]))).toEqual(
      expect.objectContaining({
        schema_version: 1,
        sends_already_counted: 2,
        ordered_product_codes: ["APTO-A"],
      }),
    );
    expect(f.calls.at(-1)?.sql).toBe("commit");
    expect(f.releasedWith()).toBeUndefined();
  });

  it("reutiliza o snapshot sob a trava e não relê o catálogo", async () => {
    const first = fixture();
    const created = await resolveAndSnapshotCatalogPresentation(first.pool, input);
    if (!created.ok) throw new Error(created.error.code);
    const f = fixture({ payload: { [CHAVE_DO_SNAPSHOT_DA_APRESENTACAO]: created.snapshot } });

    const result = await resolveAndSnapshotCatalogPresentation(f.pool, input);

    expect(result).toEqual({ ok: true, snapshot: created.snapshot, reused: true });
    expect(f.calls.some((call) => call.sql.includes("from public.catalog_products"))).toBe(false);
    expect(f.calls.some((call) => call.sql.includes("update public.job_queue"))).toBe(false);
    expect(f.calls.at(-1)?.sql).toBe("commit");

    const changedOffset = fixture({
      payload: { [CHAVE_DO_SNAPSHOT_DA_APRESENTACAO]: created.snapshot },
    });
    await expect(
      resolveAndSnapshotCatalogPresentation(changedOffset.pool, {
        ...input,
        sendsAlreadyCounted: 1,
      }),
    ).rejects.toBeInstanceOf(CatalogPresentationSnapshotConflictError);
  });

  it("não sobrescreve snapshot concorrente de outra seleção", async () => {
    const seed = fixture();
    const created = await resolveAndSnapshotCatalogPresentation(seed.pool, input);
    if (!created.ok) throw new Error(created.error.code);
    const f = fixture({ payload: { [CHAVE_DO_SNAPSHOT_DA_APRESENTACAO]: created.snapshot } });

    await expect(
      resolveAndSnapshotCatalogPresentation(f.pool, { ...input, orderedProductCodes: ["APTO-B"] }),
    ).rejects.toBeInstanceOf(CatalogPresentationSnapshotConflictError);
    expect(f.calls.at(-1)?.sql).toBe("rollback");
    expect(f.releasedWith()).toBeInstanceOf(CatalogPresentationSnapshotConflictError);
  });

  it("falha fechado se o snapshot persistido perdeu a coerência interna", async () => {
    const seed = fixture();
    const created = await resolveAndSnapshotCatalogPresentation(seed.pool, input);
    if (!created.ok) throw new Error(created.error.code);
    const corrupt = structuredClone(created.snapshot);
    corrupt.plan.items[0]!.product_code = "OUTRO";
    const f = fixture({ payload: { [CHAVE_DO_SNAPSHOT_DA_APRESENTACAO]: corrupt } });

    await expect(resolveAndSnapshotCatalogPresentation(f.pool, input)).rejects.toBeInstanceOf(
      CatalogPresentationSnapshotInvalidError,
    );
    expect(f.calls.some((call) => call.sql.includes("from public.catalog_products"))).toBe(false);
    expect(f.calls.some((call) => call.sql.includes("update public.job_queue"))).toBe(false);
  });

  it("falha fechado quando organização, dono ou instante do lease não casam", async () => {
    const f = fixture({ lockFound: false });

    await expect(resolveAndSnapshotCatalogPresentation(f.pool, input)).rejects.toBeInstanceOf(
      CatalogPresentationLeaseLostError,
    );
    expect(f.calls.some((call) => call.sql.includes("from public.catalog_products"))).toBe(false);
    expect(f.calls.at(-1)?.sql).toBe("rollback");
  });

  it("repete o CAS do lease ao persistir e faz rollback se ele não escrever", async () => {
    const f = fixture({ updateFound: false });

    await expect(resolveAndSnapshotCatalogPresentation(f.pool, input)).rejects.toBeInstanceOf(
      CatalogPresentationLeaseLostError,
    );

    const update = f.calls.find((call) => call.sql.includes("update public.job_queue"));
    expect(update?.sql).toContain("status = 'running'");
    expect(update?.sql).toContain("locked_by = $3");
    expect(update?.sql).toContain("locked_at = $4::timestamptz");
    expect(f.calls.at(-1)?.sql).toBe("rollback");
  });

  it("recusa caminho de mídia pertencente a outro tenant sem gravar snapshot", async () => {
    const f = fixture();
    const resolution = f.pool as unknown as {
      connect(): Promise<{ query(sql: string, values?: unknown[]): Promise<unknown> }>;
    };
    const client = await resolution.connect();
    const original = client.query.bind(client);
    client.query = async (sql: string, values?: unknown[]) => {
      if (sql.includes("from public.catalog_products")) {
        return {
          rows: [
            {
              ...productRow(),
              photo_storage_paths: [
                `eeeeeeee-0000-4000-8000-000000000001/${PRODUCT}/11111111-2222-4333-8444-555555555555.jpg`,
              ],
            },
          ],
          rowCount: 1,
        };
      }
      return original(sql, values);
    };

    const result = await resolveAndSnapshotCatalogPresentation(f.pool, input);

    expect(result).toEqual({
      ok: false,
      error: { code: "unsafe_media_reference", product_code: "APTO-A", media_kind: "image" },
    });
    expect(f.calls.some((call) => call.sql.includes("update public.job_queue"))).toBe(false);
  });
});
