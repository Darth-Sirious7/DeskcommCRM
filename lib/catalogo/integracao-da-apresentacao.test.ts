import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { ChannelAdapter, ChannelSendInput } from "@/lib/agent-engine/channel-adapter";
import type { runBeforeSend } from "@/lib/agent-engine/guardrails/before-send";
import type { reconcileAcceptedSend } from "@/lib/agent-engine/edge/crm/send-ledger";
import type { JobRow } from "@/lib/agent-engine/queue/queue";
import { prepareCatalogPresentationPayloads } from "./preparo-de-apresentacao";
import {
  CHAVE_DO_SNAPSHOT_DA_APRESENTACAO,
  resolveAndSnapshotCatalogPresentation,
} from "./snapshot-de-apresentacao";
import { resumePersistedCatalogPresentation } from "./retomada-de-apresentacao";

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const JOB = "bbbbbbbb-0000-4000-8000-000000000001";
const CONTACT = "cccccccc-0000-4000-8000-000000000001";
const CONVERSATION = "dddddddd-0000-4000-8000-000000000001";
const SESSION = "eeeeeeee-0000-4000-8000-000000000001";
const CLAIM = { worker_id: "worker-a", acquired_at: "2026-10-15T12:00:00.000Z" };

function fixture(outcomes: Array<"sent" | "queued"> = ["sent", "sent"]) {
  const events: string[] = [];
  const sends: ChannelSendInput[] = [];
  const reconciled: number[] = [];
  let payload: Record<string, unknown> = { existing: "kept" };
  let status = "running";
  let sendIndex = 0;
  const rows = ["B", "A"].map((code, index) => ({
    product_id: `ffffffff-0000-4000-8000-00000000000${index + 1}`,
    product_code: code,
    product_name: `Produto ${code}`,
    price_cents: "1000",
    currency: "BRL",
    photo_storage_paths: [],
    presentation_id: `99999999-0000-4000-8000-00000000000${index + 1}`,
    presentation_enabled: true,
    presentation_kind: "text",
    presentation_title: null,
    presentation_text_content: `Texto ${code}`,
    presentation_use_catalog_photos: false,
    presentation_show_price: false,
    presentation_audio_storage_path: null,
    presentation_audio_mime: null,
  }));
  const query = async (sql: string, values?: unknown[]) => {
    if (["begin", "commit", "rollback"].includes(sql)) {
      events.push(sql);
      return { rows: [], rowCount: null };
    }
    if (sql.includes("from public.job_queue") && sql.includes("for update")) {
      expect(values?.slice(0, 4)).toEqual([JOB, ORG, CLAIM.worker_id, CLAIM.acquired_at]);
      return { rows: [{ payload }], rowCount: 1 };
    }
    if (sql.includes("from public.catalog_products")) {
      expect(values).toEqual([ORG, ["A", "B"]]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("update public.job_queue")) {
      payload = { ...payload, [String(values?.[4])]: JSON.parse(String(values?.[5])) };
      events.push("snapshot-written");
      return { rows: [{ id: JOB }], rowCount: 1 };
    }
    if (sql.includes("select source, consent, is_anonymized")) {
      expect(values).toEqual([ORG, CONTACT]);
      return { rows: [{ source: "whatsapp", consent: {}, is_anonymized: false }], rowCount: 1 };
    }
    if (sql.includes("update job_queue")) {
      expect(values).toContain(JOB);
      status = "pending";
      events.push("job-requeued");
      return { rows: [{ id: JOB }], rowCount: 1 };
    }
    throw new Error(`unexpected_query: ${sql}`);
  };
  const pool = {
    connect: async () => ({ query, release: () => undefined }),
    query,
  } as unknown as Pool;
  const channel = {
    channel: "test",
    send: async (input: ChannelSendInput) => {
      events.push("channel-send");
      sends.push(input);
      const kind = outcomes[sendIndex++] ?? "sent";
      return { kind, idempotencyKey: `key-${input.seq}`, messageId: `message-${input.seq}` };
    },
  } as ChannelAdapter;
  const beforeSend = vi.fn(async (args: Parameters<typeof runBeforeSend>[0]) => ({
    status: "sent" as const,
    outcome: await args.send(args.body),
    trace: [],
  })) as unknown as typeof runBeforeSend;
  const reconcileMock = vi.fn(async (_pool: unknown, input: { seq: number }) =>
    reconciled.includes(input.seq),
  );
  const reconcile = reconcileMock as unknown as typeof reconcileAcceptedSend;
  const materialize = vi.fn(async (persisted: { snapshot: { plan: never } }) => {
    const prepared = prepareCatalogPresentationPayloads(persisted.snapshot.plan);
    if (!prepared.ok) throw new Error(prepared.error.code);
    return {
      ok: true as const,
      materialized: {
        physical_payload_count: prepared.prepared.physical_payload_count,
        payloads: prepared.prepared.payloads.map((entry) => ({ payload: entry })),
      },
    };
  });
  const job = (): JobRow => ({
    id: JOB,
    organization_id: ORG,
    contact_id: CONTACT,
    kind: "inbound_turn",
    source_event_id: null,
    payload,
    status: "running",
    priority: 100,
    run_after: new Date(),
    attempts: 1,
    max_attempts: 5,
    last_error: null,
    locked_by: CLAIM.worker_id,
    locked_at: new Date(CLAIM.acquired_at),
    claim_acquired_at: CLAIM.acquired_at,
    created_at: new Date(),
  });
  const resume = (maxSendsPerTurn = 10) =>
    resumePersistedCatalogPresentation(
      pool,
      job(),
      { workerId: CLAIM.worker_id },
      { conversationId: CONVERSATION, channelSessionId: SESSION },
      {
        channel,
        log: {} as never,
        maxSendsPerTurn,
        queuedRetryDelayMs: 30_000,
        respostaObsoletaTetoMs: 0,
        contracts: {
          beforeSend,
          reconcileAcceptedSend: reconcile,
          materialize: materialize as never,
          interruptedBeforeFirstItem: async () => false,
          interruptedBetweenItems: async () => false,
        },
      },
    );
  return {
    pool,
    job,
    resume,
    events,
    sends,
    reconciled,
    reconcileMock,
    beforeSend,
    materialize,
    status: () => status,
  };
}

async function snapshot(f: ReturnType<typeof fixture>, sendsAlreadyCounted = 0) {
  const result = await resolveAndSnapshotCatalogPresentation(f.pool, {
    organizationId: ORG,
    jobId: JOB,
    claim: CLAIM,
    sendsAlreadyCounted,
    orderedProductCodes: ["A", "B"],
  });
  if (!result.ok) throw new Error(result.error.code);
  return result;
}

describe("integração da seleção persistida com a disposição do worker", () => {
  it("commita o snapshot antes do canal e conclui na ordem e seq congeladas", async () => {
    const f = fixture();
    await snapshot(f, 2);
    expect(await f.resume()).toEqual({ handled: true, disposition: "completed" });
    expect(f.events.slice(0, 4)).toEqual(["begin", "snapshot-written", "commit", "channel-send"]);
    expect(f.job().payload).toHaveProperty(CHAVE_DO_SNAPSHOT_DA_APRESENTACAO);
    expect(f.job().payload.existing).toBe("kept");
    expect(f.sends.map((send) => [send.seq, send.body, send.tenantId, send.jobId])).toEqual([
      [3, "Produto A\n\nTexto A", ORG, JOB],
      [4, "Produto B\n\nTexto B", ORG, JOB],
    ]);
    expect(f.reconcileMock.mock.calls.map((call) => call[1].seq)).toEqual([3, 4]);
    expect(f.beforeSend).toHaveBeenCalledTimes(2);
  });

  it("queued preserva o snapshot e o mesmo job; replay reconcilia a seq sem duplicar", async () => {
    const f = fixture(["queued", "sent"]);
    await snapshot(f);
    const persisted = structuredClone(f.job().payload);
    expect(await f.resume()).toEqual({ handled: true, disposition: "settled" });
    expect(f.status()).toBe("pending");
    expect(f.job().payload).toEqual(persisted);
    expect(f.sends.map((send) => send.seq)).toEqual([1]);
    f.reconciled.push(1);
    expect(await f.resume()).toEqual({ handled: true, disposition: "completed" });
    expect(f.sends.map((send) => send.seq)).toEqual([1, 2]);
    expect(f.reconcileMock.mock.calls.map((call) => call[1].seq)).toEqual([1, 1, 2]);
  });

  it("teto insuficiente barra antes de ledger, guardrail ou canal", async () => {
    const f = fixture();
    await snapshot(f, 2);
    await expect(f.resume(3)).rejects.toThrow("catalog_presentation_max_sends_per_turn");
    expect(f.reconcileMock).not.toHaveBeenCalled();
    expect(f.beforeSend).not.toHaveBeenCalled();
    expect(f.sends).toEqual([]);
  });
});
