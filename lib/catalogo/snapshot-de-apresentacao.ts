import type { Pool, PoolClient, QueryResultRow } from "pg";
import { z } from "zod";

import type { JobClaim } from "@/lib/agent-engine/queue/claim";
import { audioPertenceAoProduto, presentationKindSchema } from "@/lib/catalogo/apresentacao";
import { fotoPertenceAoProduto } from "@/lib/catalogo/fotos";
import { prepareCatalogPresentationPayloads } from "@/lib/catalogo/preparo-de-apresentacao";
import {
  catalogPresentationSelectionSchema,
  planCatalogPresentation,
  type CatalogPresentationPlan,
  type CatalogPresentationPlanFailure,
  type ResolvedCatalogPresentation,
} from "@/lib/catalogo/plano-de-apresentacao";

export const CHAVE_DO_SNAPSHOT_DA_APRESENTACAO = "catalog_presentation_snapshot";

const messageBaseSchema = z.object({
  product_id: z.string().uuid(),
  product_code: z.string().min(1),
});

const presentationMessageSchema = z.discriminatedUnion("kind", [
  messageBaseSchema.extend({
    kind: z.literal("text"),
    purpose: z.enum(["presentation", "title"]),
    text: z.string(),
  }),
  messageBaseSchema.extend({
    kind: z.literal("audio"),
    storage_path: z.string().min(1),
    mime: z.string().min(1),
  }),
  messageBaseSchema.extend({
    kind: z.literal("image"),
    storage_path: z.string().min(1),
    position: z.number().int().nonnegative(),
  }),
  messageBaseSchema.extend({
    kind: z.literal("price"),
    price_cents: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
]);

const catalogPresentationPlanSchema = z.object({
  items: z.array(
    messageBaseSchema.extend({
      product_name: z.string(),
      messages: z.array(presentationMessageSchema),
      physical_message_count: z.number().int().nonnegative(),
    }),
  ),
  physical_message_count: z.number().int().nonnegative(),
});

export const catalogPresentationSnapshotSchema = z
  .object({
    schema_version: z.literal(1),
    ordered_product_codes: z.array(z.string().min(1)).min(1),
    plan: catalogPresentationPlanSchema,
  })
  .strict();

export type CatalogPresentationSnapshot = z.infer<typeof catalogPresentationSnapshotSchema>;

interface ResolvedRow extends QueryResultRow {
  product_id: string;
  product_code: string;
  product_name: string;
  price_cents: string | number;
  currency: string;
  photo_storage_paths: string[];
  presentation_id: string | null;
  presentation_enabled: boolean | null;
  presentation_kind: string | null;
  presentation_title: string | null;
  presentation_text_content: string | null;
  presentation_use_catalog_photos: boolean | null;
  presentation_show_price: boolean | null;
  presentation_audio_storage_path: string | null;
  presentation_audio_mime: string | null;
}

interface LockedJobRow extends QueryResultRow {
  payload: Record<string, unknown>;
}

export type CatalogPresentationResolutionFailure =
  | CatalogPresentationPlanFailure
  | { code: "unsafe_media_reference"; product_code: string; media_kind: "audio" | "image" }
  | { code: "invalid_catalog_row"; product_code: string };

export type CatalogPresentationSnapshotResult =
  | { ok: true; snapshot: CatalogPresentationSnapshot; reused: boolean }
  | { ok: false; error: CatalogPresentationResolutionFailure };

export class CatalogPresentationLeaseLostError extends Error {
  constructor() {
    super("catalog_presentation_job_lease_lost");
    this.name = "CatalogPresentationLeaseLostError";
  }
}

export class CatalogPresentationSnapshotConflictError extends Error {
  constructor() {
    super("catalog_presentation_snapshot_conflict");
    this.name = "CatalogPresentationSnapshotConflictError";
  }
}

export class CatalogPresentationSnapshotInvalidError extends Error {
  constructor() {
    super("catalog_presentation_snapshot_invalid");
    this.name = "CatalogPresentationSnapshotInvalidError";
  }
}

const LOCK_JOB_SQL = `select payload
  from public.job_queue
 where id = $1
   and organization_id = $2
   and status = 'running'
   and locked_by = $3
   and locked_at = $4::timestamptz
 for update`;

const RESOLVE_PRODUCTS_SQL = `select
    p.id as product_id,
    p.codigo as product_code,
    p.nome as product_name,
    p.preco_cents as price_cents,
    p.moeda as currency,
    p.fotos as photo_storage_paths,
    a.id as presentation_id,
    a.enabled as presentation_enabled,
    a.kind as presentation_kind,
    a.title as presentation_title,
    a.text_content as presentation_text_content,
    a.use_catalog_photos as presentation_use_catalog_photos,
    a.show_price as presentation_show_price,
    a.audio_storage_path as presentation_audio_storage_path,
    a.audio_mime as presentation_audio_mime
  from public.catalog_products p
  left join public.catalog_product_presentations a
    on a.organization_id = p.organization_id
   and a.catalog_product_id = p.id
 where p.organization_id = $1
   and p.ativo
   and p.codigo = any($2::text[])
 order by p.codigo, p.id`;

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function snapshotIsCoherent(
  snapshot: CatalogPresentationSnapshot,
  organizationId: string,
): boolean {
  if (
    !arraysEqual(
      snapshot.ordered_product_codes,
      snapshot.plan.items.map((item) => item.product_code),
    )
  ) {
    return false;
  }
  if (!prepareCatalogPresentationPayloads(snapshot.plan).ok) return false;

  return snapshot.plan.items.every((item) =>
    item.messages.every((message) => {
      if (message.kind === "image") {
        return fotoPertenceAoProduto(message.storage_path, organizationId, item.product_id);
      }
      if (message.kind === "audio") {
        return audioPertenceAoProduto(message.storage_path, organizationId, item.product_id);
      }
      return true;
    }),
  );
}

function normalizeSelection(
  productCodes: readonly string[],
): { ok: true; productCodes: string[] } | { ok: false; error: CatalogPresentationPlanFailure } {
  const normalized = productCodes.map((code) => code.trim());
  const seen = new Set<string>();
  for (const code of normalized) {
    if (seen.has(code)) {
      return { ok: false, error: { code: "duplicate_product_code", product_code: code } };
    }
    seen.add(code);
  }
  const parsed = catalogPresentationSelectionSchema.safeParse({ product_codes: normalized });
  return parsed.success
    ? { ok: true, productCodes: parsed.data.product_codes }
    : { ok: false, error: { code: "invalid_selection" } };
}

function resolvedItem(
  row: ResolvedRow,
  organizationId: string,
):
  | { ok: true; item: ResolvedCatalogPresentation }
  | { ok: false; error: CatalogPresentationResolutionFailure } {
  const priceCents =
    typeof row.price_cents === "number" ? row.price_cents : Number(row.price_cents);
  if (!Number.isSafeInteger(priceCents) || priceCents < 0 || !/^[A-Z]{3}$/.test(row.currency)) {
    return { ok: false, error: { code: "invalid_catalog_row", product_code: row.product_code } };
  }

  const photos = row.photo_storage_paths ?? [];
  if (photos.some((path) => !fotoPertenceAoProduto(path, organizationId, row.product_id))) {
    return {
      ok: false,
      error: {
        code: "unsafe_media_reference",
        product_code: row.product_code,
        media_kind: "image",
      },
    };
  }
  if (
    row.presentation_audio_storage_path !== null &&
    !audioPertenceAoProduto(row.presentation_audio_storage_path, organizationId, row.product_id)
  ) {
    return {
      ok: false,
      error: {
        code: "unsafe_media_reference",
        product_code: row.product_code,
        media_kind: "audio",
      },
    };
  }

  const kind = presentationKindSchema.safeParse(row.presentation_kind);
  const presentation =
    row.presentation_id === null || !kind.success
      ? null
      : {
          enabled: row.presentation_enabled === true,
          kind: kind.data,
          title: row.presentation_title,
          text_content: row.presentation_text_content,
          use_catalog_photos: row.presentation_use_catalog_photos === true,
          show_price: row.presentation_show_price === true,
          audio_storage_path: row.presentation_audio_storage_path,
          audio_mime: row.presentation_audio_mime,
        };

  return {
    ok: true,
    item: {
      product_id: row.product_id,
      product_code: row.product_code,
      product_name: row.product_name,
      price_cents: priceCents,
      currency: row.currency,
      photo_storage_paths: photos,
      presentation,
    },
  };
}

async function rollback(client: PoolClient, cause: unknown): Promise<void> {
  try {
    await client.query("rollback");
  } catch (rollbackError) {
    if (cause instanceof Error && rollbackError instanceof Error) {
      cause.message += `; rollback falhou: ${rollbackError.message}`;
    }
  }
}

/**
 * Resolve a seleção dentro do tenant e congela o plano no job que detém o
 * lease. A trava da linha é o mutex: duas resoluções do mesmo job nunca podem
 * sobrescrever uma à outra, e reaper/complete só avançam depois do commit.
 */
export async function resolveAndSnapshotCatalogPresentation(
  pool: Pool,
  input: {
    organizationId: string;
    jobId: string;
    claim: JobClaim;
    orderedProductCodes: readonly string[];
  },
): Promise<CatalogPresentationSnapshotResult> {
  const selection = normalizeSelection(input.orderedProductCodes);
  if (!selection.ok) return selection;

  const client = await pool.connect();
  let transactionError: Error | undefined;
  try {
    await client.query("begin");
    const locked = await client.query<LockedJobRow>(LOCK_JOB_SQL, [
      input.jobId,
      input.organizationId,
      input.claim.worker_id,
      input.claim.acquired_at,
    ]);
    const job = locked.rows[0];
    if (!job) throw new CatalogPresentationLeaseLostError();

    const current = job.payload?.[CHAVE_DO_SNAPSHOT_DA_APRESENTACAO];
    if (current !== undefined) {
      const parsed = catalogPresentationSnapshotSchema.safeParse(current);
      if (!parsed.success || !snapshotIsCoherent(parsed.data, input.organizationId)) {
        throw new CatalogPresentationSnapshotInvalidError();
      }
      if (!arraysEqual(parsed.data.ordered_product_codes, selection.productCodes)) {
        throw new CatalogPresentationSnapshotConflictError();
      }
      await client.query("commit");
      return { ok: true, snapshot: parsed.data, reused: true };
    }

    const resolved = await client.query<ResolvedRow>(RESOLVE_PRODUCTS_SQL, [
      input.organizationId,
      selection.productCodes,
    ]);
    const items: ResolvedCatalogPresentation[] = [];
    for (const row of resolved.rows) {
      const converted = resolvedItem(row, input.organizationId);
      if (!converted.ok) {
        await client.query("rollback");
        return converted;
      }
      items.push(converted.item);
    }

    const planned = planCatalogPresentation({
      ordered_product_codes: selection.productCodes,
      resolved_items: items,
    });
    if (!planned.ok) {
      await client.query("rollback");
      return planned;
    }

    const snapshot: CatalogPresentationSnapshot = {
      schema_version: 1,
      ordered_product_codes: selection.productCodes,
      plan: planned.plan,
    };
    const written = await client.query(
      `update public.job_queue
          set payload = jsonb_set(payload, array[$5::text], $6::jsonb, true)
        where id = $1
          and organization_id = $2
          and status = 'running'
          and locked_by = $3
          and locked_at = $4::timestamptz
          and not (payload ? $5)
      returning id`,
      [
        input.jobId,
        input.organizationId,
        input.claim.worker_id,
        input.claim.acquired_at,
        CHAVE_DO_SNAPSHOT_DA_APRESENTACAO,
        JSON.stringify(snapshot),
      ],
    );
    if (written.rowCount !== 1) throw new CatalogPresentationLeaseLostError();

    await client.query("commit");
    return { ok: true, snapshot, reused: false };
  } catch (error) {
    transactionError = error instanceof Error ? error : new Error(String(error));
    await rollback(client, error);
    throw error;
  } finally {
    client.release(transactionError);
  }
}
