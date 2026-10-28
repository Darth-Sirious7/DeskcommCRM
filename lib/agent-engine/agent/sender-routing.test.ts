import { describe, expect, it, vi } from "vitest";
import { agentePorRemetente } from "./sender-routing";
import { senderRoutesSchema, telefoneDoRemetente } from "@/lib/ai/agents/sender-routes";
import type { LoadedRouter } from "./router-config";

const interno = "11111111-1111-4111-8111-111111111111";
const publico = "22222222-2222-4222-8222-222222222222";
const router = {
  fallbackAgentId: publico,
  senderRoutes: [{ phone: "+5511999998888", agent_id: interno }],
} as LoadedRouter;
const input = { tenantId: "org-a", conversationId: "conv-a", channelSessionId: "canal-a" };

describe("roteamento determinístico por remetente", () => {
  it("normaliza apenas a apresentação, sem aproximar identidades", () => {
    expect(telefoneDoRemetente("+55 (11) 99999-8888")).toBe("+5511999998888");
    expect(telefoneDoRemetente("sou a secretaria +5511999998888")).toBeNull();
    expect(telefoneDoRemetente("5511999998888@lid")).toBeNull();
    expect(telefoneDoRemetente("551199998888")).not.toBe("+5511999998888");
  });
  it("recusa duplicatas após normalização e referências inválidas", () => {
    expect(
      senderRoutesSchema.safeParse([
        { phone: "+55 (11) 99999-8888", agent_id: interno },
        { phone: "+5511999998888", agent_id: publico },
      ]).success,
    ).toBe(false);
    expect(
      senderRoutesSchema.safeParse([{ phone: "+5511999998888", agent_id: "inventado" }]).success,
    ).toBe(false);
  });
  it("escolhe só pelo contato da conversa e filtra empresa e canal", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ phone_number: "+55 (11) 99999-8888" }] });
    const out = await agentePorRemetente({ query }, input, router);
    expect(out.agentId).toBe(interno);
    expect(query.mock.calls[0]?.[1]).toEqual(["org-a", "conv-a", "canal-a"]);
    expect(query.mock.calls[0]?.[0]).toContain("ct.organization_id=cv.organization_id");
    expect(query.mock.calls[0]?.[0]).toContain("not cv.is_group");
  });
  it("sem vínculo, número diferente ou nulo não seleciona o interno", async () => {
    for (const rows of [[], [{ phone_number: "+5511888887777" }], [{ phone_number: null }]]) {
      const out = await agentePorRemetente(
        { query: vi.fn().mockResolvedValue({ rows }) },
        input,
        router,
      );
      expect(out.agentId).toBeNull();
      expect(out.reserved.has(interno)).toBe(true);
    }
  });
  it("falha fechada com configuração inválida ou fallback interno", async () => {
    const db = { query: vi.fn() };
    await expect(
      agentePorRemetente(db, input, { ...router, fallbackAgentId: interno }),
    ).rejects.toThrow("public_fallback");
    await expect(
      agentePorRemetente(db, input, { ...router, senderRoutes: "errado" }),
    ).rejects.toThrow("invalid");
    expect(db.query).not.toHaveBeenCalled();
  });
});
