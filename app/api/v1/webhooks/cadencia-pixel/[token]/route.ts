/**
 * GET /api/v1/webhooks/cadencia-pixel/:token — o pixel de rastreio de abertura.
 *
 * Quem carrega esta URL é o CLIENTE DE E-MAIL do lead, renderizando um `<img>`
 * de 1×1 — nunca um usuário autenticado do CRM. Por isso mora em
 * `app/api/v1/webhooks/` (`lib/auth/public-paths.ts` já cobre o prefixo
 * inteiro, sem entrada nova) e a autenticidade vem do token assinado
 * (`lib/cadencias/token.ts`), não de sessão nem de bearer.
 *
 * SEMPRE devolve o gif, mesmo com token inválido/inscrição já concluída — um
 * pixel de e-mail que responde 4xx quebra a exibição da imagem em alguns
 * clientes e delata ao remetente que algo é dinâmico. O efeito (ou a ausência
 * dele) só é observável no banco, nunca na resposta HTTP.
 *
 * Contagem, não booleano: `fn_cadencia_registrar_abertura` (migration 0429)
 * soma `aberturas` numa instrução atômica — é essa coluna que alimenta a tela
 * de leads quentes e a condição de ramo "abriu N vezes".
 */
import type { NextRequest } from "next/server";

import { verifyCadenciaLink } from "@/lib/cadencias/token";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// GIF transparente 1x1, o menor payload que todo cliente de e-mail reconhece.
const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7",
  "base64",
);

function respostaDoPixel(): Response {
  return new Response(PIXEL_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL_GIF.length),
      // Todo cliente de e-mail deve buscar de novo a cada abertura — um cache
      // de dias esconderia a 2ª, 3ª... abertura do MESMO destinatário.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const payload = verifyCadenciaLink(token);
  if (!payload) return respostaDoPixel();

  const admin = createAdminClient();
  try {
    const { error: rpcErro } = await admin.rpc("fn_cadencia_registrar_abertura", {
      p_enrollment_id: payload.enrollment_id,
      p_organization_id: payload.organization_id,
    });
    if (rpcErro) {
      logger.error("[cadencia-pixel] incremento falhou", {
        error: rpcErro.message,
        enrollment_id: payload.enrollment_id,
      });
      return respostaDoPixel();
    }

    // A LINHA DO TEMPO permite mais de um "aberto" por inscrição de propósito
    // (`tests/e2e`/schema não têm índice único em `tipo`) — é assim que a aba
    // Atividade mostra "abriu às 10h02, abriu de novo às 14h30...".
    await admin.from("email_cadence_events").insert({
      organization_id: payload.organization_id,
      cadence_id: payload.cadence_id,
      enrollment_id: payload.enrollment_id,
      lead_id: payload.lead_id,
      tipo: "aberto",
      passo_id: payload.passo_id,
    });
  } catch (err) {
    // Falha aqui NUNCA pode aparecer pro cliente de e-mail — o pixel é
    // invisível por natureza. O log é a única rede.
    logger.error("[cadencia-pixel] falhou", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return respostaDoPixel();
}
