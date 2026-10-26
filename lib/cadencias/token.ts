/**
 * Token assinado para os dois links públicos de uma cadência que vivem FORA da
 * sessão — o pixel de abertura e o descadastro. Quem clica ou carrega esses
 * links é o cliente de e-mail do LEAD, nunca um usuário autenticado do CRM, e
 * as duas rotas moram em `app/api/v1/webhooks/` (proxy público, como todo
 * webhook — ver `lib/auth/public-paths.ts`).
 *
 * Mesmo formato de `lib/auth/invite-token.ts` (HMAC-SHA256, `timingSafeEqual`,
 * `<body>.<sig>` base64url): stateless, não exige linha no banco pra existir,
 * e o segredo cai no mesmo fallback (`CADENCIA_TOKEN_SECRET` → `INTERNAL_SECRET`
 * → `dev-fallback`) para não crescer o `.env` de instalações que já têm um dos
 * dois segredos configurados.
 *
 * Sem `exp`: ao contrário de um convite, o pixel e o descadastro precisam valer
 * enquanto o e-mail existir na caixa do lead — que pode ser anos.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const SECRET = (): string =>
  process.env.CADENCIA_TOKEN_SECRET ?? process.env.INTERNAL_SECRET ?? "dev-fallback";

export interface CadenciaLinkPayload {
  enrollment_id: string;
  organization_id: string;
  cadence_id: string;
  lead_id: string;
  /** O passo de e-mail que gerou o link — o pixel soma na inscrição, não no passo, mas fica registrado no evento. */
  passo_id: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signCadenciaLink(payload: CadenciaLinkPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", SECRET()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyCadenciaLink(token: string): CadenciaLinkPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = b64url(createHmac("sha256", SECRET()).update(body).digest());
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  try {
    const json = Buffer.from(body, "base64url").toString("utf8");
    const parsed = z
      .object({
        enrollment_id: z.string().uuid(),
        organization_id: z.string().uuid(),
        cadence_id: z.string().uuid(),
        lead_id: z.string().uuid(),
        passo_id: z.string().min(1),
      })
      .safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
