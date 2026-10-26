"use server";

/**
 * CONFERIR O DOMÍNIO DE ENVIO DA ORGANIZAÇÃO (#3441).
 *
 * A ação que a tela chama quando o admin clica em "Conferir": recebe o domínio
 * (ou o endereço de remetente), consulta o DNS público e devolve o diagnóstico —
 * SPF, DKIM, MX de retorno e DMARC, com o veredito `prontoParaEnviar`.
 *
 * ─── Por que o gate é o mesmo da marca e da conta Resend ────────────────────
 *
 * A conferência em si é LEITURA, mas o dado é infraestrutura da empresa (quais
 * domínios ela usa para falar com clientes) e o custo é consulta de rede feita
 * por quem pediu. O papel mínimo é `admin`, e o segundo fator é cobrado na mesma
 * ordem das actions irmãs: papel primeiro, MFA depois — quem nem tem o papel
 * recebe `forbidden_role`, não uma cobrança de MFA que não resolveria nada.
 *
 * ─── Por que NÃO há auditoria ───────────────────────────────────────────────
 *
 * Nada é gravado: nenhuma linha, nenhum segredo, nenhum estado. A trilha existe
 * para responder "quem mudou o quê", e aqui não há mudança — só uma pergunta
 * feita ao DNS. Registrar cada conferência encheria a auditoria de ruído e
 * faria a pergunta certa ("quem conectou a conta?") ficar mais difícil.
 *
 * ─── O que esta ação NÃO faz ────────────────────────────────────────────────
 *
 * Não conecta nem verifica domínio na conta da Resend — isso exige a chave da
 * organização e mora na action da conta (`conectarContaResendDaOrganizacao`,
 * #3287). Aqui não circula segredo: a entrada é um nome de domínio e a saída é
 * uma tabela para a tela.
 */
import { z } from "zod";

import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { supportWriteError } from "@/lib/impersonate/support";
import {
  conferirDominioDeEnvio as conferirNoDns,
  type ConferenciaDoDominioDeEnvio,
} from "@/lib/email/dominio-de-envio-dns";
import type { DiagnosticoDoDominioDeEnvio } from "@/lib/email/dominio-de-envio";
import { logger } from "@/lib/logger";

export type ResultadoDaConferenciaDoDominio =
  | { ok: true; diagnostico: DiagnosticoDoDominioDeEnvio }
  | {
      ok: false;
      error:
        | "validation_failed"
        | "unauthenticated"
        | "forbidden_tenant"
        | "forbidden_role"
        | "mfa_required"
        | "dominio_invalido";
      /** Frases do motivo, quando ele tem o que explicar (domínio inválido). */
      bloqueios?: readonly string[];
    };

/**
 * 320 é o teto de um ENDEREÇO de e-mail (64 + 1 + 255), e a entrada aceita
 * endereço: recusar por tamanho aqui o que o campo aceita seria uma parede sem
 * motivo. Quem decide se é domínio é `dominioDeEndereco`, na camada pura.
 */
const entradaSchema = z.string().trim().min(3).max(320);

export async function conferirDominioDeEnvio(
  dominio: string,
): Promise<ResultadoDaConferenciaDoDominio> {
  // Server Action é endpoint público: o tipo do parâmetro não chega ao servidor.
  const entrada = entradaSchema.safeParse(dominio);
  if (!entrada.success) return { ok: false, error: "validation_failed" };

  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(user.support)) return { ok: false, error: "forbidden_role" };
  const org = await resolveActiveOrg(user);
  if (!org) return { ok: false, error: "forbidden_tenant" };
  if (!podeAdministrarEmpresa(user, org)) return { ok: false, error: "forbidden_role" };
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };

  let conferencia: ConferenciaDoDominioDeEnvio;
  try {
    conferencia = await conferirNoDns(entrada.data);
  } catch (err) {
    // A coleta engole falha de CADA consulta; o que sobra aqui é defeito de
    // programação ou resolvedor indisponível de um jeito inesperado. Falhar
    // fechado, com log, é melhor que derrubar a tela de Configurações.
    logger.error("[dominio-de-envio] a conferência do domínio falhou", {
      organization_id: org.orgId,
      detalhe: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "dominio_invalido" };
  }

  if (!conferencia.ok) {
    return { ok: false, error: conferencia.motivo, bloqueios: conferencia.bloqueios };
  }
  return { ok: true, diagnostico: conferencia.diagnostico };
}
