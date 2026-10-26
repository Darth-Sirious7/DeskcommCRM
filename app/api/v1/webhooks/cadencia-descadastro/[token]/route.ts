/**
 * GET /api/v1/webhooks/cadencia-descadastro/:token — link de descadastro que
 * entra no fim de todo e-mail de cadência. Clicado pelo LEAD no navegador, sem
 * sessão — mesma classe de rota pública que o pixel (`../cadencia-pixel/`).
 *
 * LGPD: o pedido de saída é IRREVERSÍVEL por esta rota (não há "desfazer" —
 * reinscrever é gesto humano deliberado, via `POST .../inscricoes`). Para
 * cada cadência ATIVA em que este CONTATO esteja inscrito, para a inscrição
 * com `motivo_parada='descadastro'`. Suprime por CONTATO, não só pela
 * cadência que originou o clique: quem pediu para sair não quer receber de
 * NENHUMA outra sequência desta organização — `POST .../inscricoes` (a rota
 * de inscrição) recusa reinscrever um contato com descadastro registrado
 * (ver o comentário lá).
 *
 * Clique repetido (o lead abre o link de novo, ou dois cliques em abas
 * diferentes) é IDEMPOTENTE: só conta e audita a PRIMEIRA vez — o filtro
 * `.eq("status", "ativa")` no UPDATE garante que a segunda passada não
 * encontra linha para mudar.
 */
import type { NextRequest } from "next/server";

import { verifyCadenciaLink } from "@/lib/cadencias/token";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function paginaDeConfirmacao(mensagem: string): Response {
  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Descadastro</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;color:#1a1a1a;text-align:center}</style>
</head>
<body><p>${mensagem}</p></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const payload = verifyCadenciaLink(token);
  if (!payload) {
    return paginaDeConfirmacao("Link inválido ou expirado.");
  }

  const admin = createAdminClient();
  try {
    const { data: inscricao } = await admin
      .from("email_cadence_enrollments")
      .select("id, contact_id")
      .eq("id", payload.enrollment_id)
      .eq("organization_id", payload.organization_id)
      .maybeSingle();

    if (!inscricao) return paginaDeConfirmacao("Você já não recebe mais estes e-mails.");
    const { contact_id } = inscricao as { id: string; contact_id: string };

    // Suprime TODAS as inscrições ativas deste contato na organização, não só
    // a que originou o clique — ver o cabeçalho.
    const { data: paradas, error: updErro } = await admin
      .from("email_cadence_enrollments")
      .update({ status: "parada", motivo_parada: "descadastro", parada_em: new Date().toISOString() })
      .eq("organization_id", payload.organization_id)
      .eq("contact_id", contact_id)
      .eq("status", "ativa")
      .select("id, cadence_id, lead_id");

    if (updErro) {
      logger.error("[cadencia-descadastro] update falhou", { error: updErro.message });
      return paginaDeConfirmacao("Não foi possível processar agora. Tente de novo em alguns minutos.");
    }

    const linhas = (paradas ?? []) as { id: string; cadence_id: string; lead_id: string }[];
    if (linhas.length > 0) {
      await admin.from("email_cadence_events").insert(
        linhas.map((l) => ({
          organization_id: payload.organization_id,
          cadence_id: l.cadence_id,
          enrollment_id: l.id,
          lead_id: l.lead_id,
          tipo: "descadastrou" as const,
        })),
      );
    }

    return paginaDeConfirmacao("Você não vai mais receber estes e-mails. Obrigado.");
  } catch (err) {
    logger.error("[cadencia-descadastro] falhou", {
      error: err instanceof Error ? err.message : String(err),
    });
    return paginaDeConfirmacao("Não foi possível processar agora. Tente de novo em alguns minutos.");
  }
}
