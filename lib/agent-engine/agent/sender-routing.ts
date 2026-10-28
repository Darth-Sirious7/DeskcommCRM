import type pg from "pg";
import { senderRoutesSchema, telefoneDoRemetente } from "@/lib/ai/agents/sender-routes";
import type { LoadedRouter } from "./router-config";

/** Identidade do cadastro vinculado à conversa, nunca inferida do texto/prompt. */
export async function agentePorRemetente(
  db: Pick<pg.Pool, "query">,
  input: {
    tenantId: string;
    conversationId: string;
    channelSessionId: string;
  },
  router: LoadedRouter,
): Promise<{ agentId: string | null; reserved: Set<string> }> {
  const parsed = senderRoutesSchema.safeParse(router.senderRoutes ?? []);
  if (!parsed.success) throw new Error("sender_routes_invalid");
  const routes = parsed.data;
  const reserved = new Set(routes.map((r) => r.agent_id));
  if (!routes.length) return { agentId: null, reserved };
  if (!router.fallbackAgentId || reserved.has(router.fallbackAgentId))
    throw new Error("sender_routes_require_public_fallback");
  const { rows } = await db.query<{ phone_number: string | null }>(
    `select ct.phone_number from conversations cv
     join contacts ct on ct.organization_id=cv.organization_id and ct.id=cv.contact_id
     where cv.organization_id=$1 and cv.id=$2 and cv.channel_session_id=$3
       and cv.channel='whatsapp' and not cv.is_group and not ct.is_anonymized`,
    [input.tenantId, input.conversationId, input.channelSessionId],
  );
  const phone = telefoneDoRemetente(rows[0]?.phone_number);
  return { agentId: routes.find((r) => r.phone === phone)?.agent_id ?? null, reserved };
}
