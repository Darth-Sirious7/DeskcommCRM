"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, auditForOrganizations } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { headers } from "next/headers";

/**
 * Sair de todos os dispositivos também encerra os avisos de todos eles: as
 * inscrições de push da pessoa (em todas as organizações) são apagadas antes
 * das sessões. O `user_id` vem de `getUser()`; o admin client é preciso porque
 * as inscrições de outras organizações não são alcançáveis pela sessão. Falha
 * nesse passo não impede a saída.
 */
export async function signOutEverywhere(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");

  if (user) await apagarInscricoesDePush(user.id, requestId);

  await supabase.auth.signOut({ scope: "global" });

  if (user) {
    await audit({
      action: "auth.logout",
      actorUserId: user.id,
      requestId,
      metadata: { scope: "global" },
    });
  }
  redirect("/login");
}

async function apagarInscricoesDePush(userId: string, requestId: string | null): Promise<void> {
  const { data, error } = await createAdminClient()
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .select("organization_id");
  if (error) {
    logger.warn("push_subscriptions_signout_global_failed", { detail: error.message });
    return;
  }
  const linhas = (data ?? []) as Array<{ organization_id: string }>;
  if (linhas.length === 0) return;
  await auditForOrganizations(
    {
      action: "notification_prefs.push_subscription_removed",
      actorUserId: userId,
      requestId,
      resourceType: "push_subscription",
      bypassedRls: true,
      metadata: { channel: "web_push", escopo: "todos_os_aparelhos", removidas: linhas.length },
    },
    [...new Set(linhas.map((l) => l.organization_id))],
  );
}
