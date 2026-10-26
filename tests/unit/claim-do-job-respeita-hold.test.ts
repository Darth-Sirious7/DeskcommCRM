import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { claimJobs, faltaParaOProximoJob } from "@/lib/agent-engine/queue/queue";

/**
 * Guarda do contrato entre o claim e o relógio, sem fingir que o dublê executa
 * SQL. A semântica por canal/motivo roda contra Postgres no invariante irmão.
 * Se apenas o claim filtrar holds, o relógio continua vendo trabalho vencido e
 * o worker gira no intervalo curto até o tick de cinco minutos do watchdog.
 */
async function consultas(): Promise<{ claim: string; relogio: string }> {
  const chamadas: string[] = [];
  const client = {
    query: async (sql: string) => {
      chamadas.push(sql);
      return { rows: /count\(\*\)/i.test(sql) ? [{ n: 0 }] : [], rowCount: 0 };
    },
    release: () => undefined,
  };
  const pool = {
    connect: async () => client,
    query: async (sql: string) => {
      chamadas.push(sql);
      return { rows: [{ falta_ms: null }], rowCount: 1 };
    },
  } as unknown as Pool;
  await claimJobs(pool, { workerId: "worker-de-teste", maxConcurrency: 1 });
  await faltaParaOProximoJob(pool);
  return {
    claim: chamadas.find((sql) => /with dedup/i.test(sql)) ?? "",
    relogio: chamadas.find((sql) => /as falta_ms/i.test(sql)) ?? "",
  };
}

describe("a fila respeita o hold antes do tick do watchdog (#2327)", () => {
  it("o claim considera a saúde do canal ANTES de escolher um job por contato", async () => {
    const { claim } = await consultas();
    const dedup = claim.slice(0, claim.indexOf("order by coalesce"));
    expect(dedup).toContain("channel_session_health");
    expect(dedup).toContain("health_hold_reason");
    expect(dedup).toContain("go_live");
    expect(dedup).toContain("followup_turn");
  });

  it("o relógio aplica a mesma regra para não girar em job vencido sob hold", async () => {
    const { claim, relogio } = await consultas();
    const regra = (sql: string) => sql.match(/\(j\.kind not in[\s\S]*?\n\s*\)\)/)?.[0];
    expect(regra(claim), "o claim não tem a regra de elegibilidade por canal").toBeDefined();
    expect(regra(relogio), "o relógio não tem a regra de elegibilidade por canal").toBe(regra(claim));
  });

  it("ambas as consultas resolvem a conversa pelo tenant e contato, sem cast do payload", async () => {
    const { claim, relogio } = await consultas();
    for (const sql of [claim, relogio]) {
      expect(sql).toContain("c.organization_id = j.organization_id");
      expect(sql).toContain("c.contact_id = j.contact_id");
      expect(sql).toContain("c.id::text = j.payload #>> '{service_boundary,conversation_id}'");
      expect(sql).toContain("s.organization_id = j.organization_id");
      expect(sql).not.toMatch(/payload[^\n]*::uuid/);
    }
  });
});
