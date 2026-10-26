/**
 * O motor que anda a cadência — chamado pelo cron `cadencia-worker`, minuto a
 * minuto (mesma cadência do `campaign-worker`). Separado da rota HTTP para o
 * teste exercitar a REGRA sem montar request/auth, mesmo padrão de
 * `recover-stuck-messages`.
 *
 * ═══ O que este worker SABE fazer hoje ═══
 *  - `email`: renderiza variáveis do lead, embute pixel de abertura e link de
 *    descadastro, envia pelo transporte único da instalação (`lib/email/roteador`).
 *  - `espera`: avança `dias úteis` preservando a hora.
 *  - `ramo`: só a condição `abriu` é real (lê `aberturas`/`ultimo_email_em`).
 *    `clicou`/`respondeu` NÃO têm fonte de dado ainda (exigiriam reescrever
 *    links e um webhook de resposta) — o ramo aguarda o prazo (`dentroDeDias`)
 *    e cai em "não", nunca em "sim": é a resposta honesta de quem não tem o
 *    sinal, não uma mentira otimista.
 *  - `tarefa`: cria em `crm_tasks` e registra na timeline do negócio.
 *  - `whatsapp`: AINDA NÃO ENVIA. Mandar mensagem fora do pipeline de
 *    anti-banimento (throttle, janela, STOP) seria arriscar a conexão do
 *    cliente — decisão deliberada de não improvisar isso aqui. A inscrição
 *    PARA com `motivo_parada='falha'`, visível na aba Atividade, em vez de
 *    pular o passo em silêncio.
 *
 * `configuracao.paradas.ganhoOuPerdido` é a única parada automática hoje
 * (lê `crm_leads.status`). `respondeu`/`bounce` exigem infra que não existe
 * (webhook de resposta / de bounce do provedor) — mesmo motivo do ramo acima.
 *
 * ═══ Teto diário de envio (migration 0431) ═══
 * O transporte de e-mail é ÚNICO por instalação (`lib/email/roteador.ts`) —
 * a MESMA caixa/conta leva o volume de TODAS as organizações do clone, e
 * provedor de e-mail trava/bane quem manda volume alto de uma vez. Antes de
 * CADA envio o worker checa `CADENCIA_LIMITE_EMAILS_POR_DIA` (padrão 60,
 * `lib/env.ts`) por `checkRateLimit` (Upstash Redis, janela fixa de 24h —
 * o mesmo mecanismo do resto do produto, nenhuma tabela nova). Passado o
 * teto, a inscrição NÃO falha nem soma `tentativas` (não é erro do lead nem
 * da cadência) — só é adiada, reconferida em 1h, com um evento
 * `limite_diario_atingido` na timeline pra quem opera ver O PORQUÊ do atraso
 * em vez de achar que o envio travou sem motivo.
 */
import { avancarDiasUteis } from "./dias-uteis";
import { passoParaExecutar, primeiroDoLado, proximoIrmao } from "./proximo-passo";
import { renderizarComLead } from "./renderizar";
import { signCadenciaLink } from "./token";
import type { Cadencia, Passo } from "./tipos";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { sendEmail } from "@/lib/email/roteador";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

const LOTE = 50;
/** Trava otimista: quem reivindica a linha é dono por isso — cobre a duração de um tick lento. */
const JANELA_DE_TRAVA_MS = 3 * 60 * 1000;

/**
 * Bucket ÚNICO (sem sufixo de organização) — de propósito: é a MESMA caixa de
 * e-mail que leva o volume de toda a instalação, então o teto tem que ser
 * medido no agregado, não por organização.
 */
const BUCKET_TETO_DIARIO_DE_EMAIL = "cadencia-email-diario";
const JANELA_DO_TETO_DIARIO_SEG = 24 * 60 * 60;
/** Quantos minutos até reconferir depois que o teto bateu — não martela a cada minuto, nem faz o lead esperar até amanhã sem checar de novo. */
const MINUTOS_DE_ESPERA_POR_TETO = 60;

export interface InscricaoRow {
  id: string;
  organization_id: string;
  cadence_id: string;
  lead_id: string;
  contact_id: string;
  passo_atual_id: string | null;
  ultimo_email_em: string | null;
  ultimo_email_passo_id: string | null;
  aberturas: number;
  emails_enviados: number;
  tentativas: number;
  inscrito_por: string | null;
}

export interface ResultadoDoTick {
  processadas: number;
  emailsEnviados: number;
  concluidas: number;
  paradas: number;
  falhas: number;
}

async function carregarCadencia(admin: Admin, cadenceId: string) {
  const { data } = await admin
    .from("email_cadences")
    .select("id, status, passos, configuracao")
    .eq("id", cadenceId)
    .maybeSingle();
  return data as { id: string; status: string; passos: Passo[]; configuracao: Cadencia["configuracao"] } | null;
}

/** `Re: <assunto>` — anda pra trás na árvore só até achar um assunto não vazio. Não é threading de verdade (sem In-Reply-To); é o prefixo visível. */
export function assuntoDaResposta(passos: Passo[], ultimoPassoId: string | null): string {
  if (!ultimoPassoId) return "Re:";
  const alvo = passoParaExecutar(passos, ultimoPassoId);
  const assunto = alvo && alvo.tipo === "email" ? alvo.assunto.trim() : "";
  return assunto ? `Re: ${assunto}` : "Re:";
}

function corpoEmHtml(texto: string): string {
  const escapado = texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escapado.replace(/\n/g, "<br>\n");
}

async function executarPassoEmail(
  admin: Admin,
  passo: Extract<Passo, { tipo: "email" }>,
  ctx: {
    inscricao: InscricaoRow;
    cadencia: NonNullable<Awaited<ReturnType<typeof carregarCadencia>>>;
    contato: { email: string; name: string | null };
    nomeDoVendedor: string | null;
    emailDoVendedor: string | null;
    requestId: string;
  },
): Promise<{ ok: boolean; erro?: string }> {
  const { inscricao, cadencia, contato, nomeDoVendedor, emailDoVendedor } = ctx;

  const assunto = passo.mesmaConversa
    ? assuntoDaResposta(cadencia.passos, inscricao.ultimo_email_passo_id)
    : renderizarComLead(passo.assunto, {
        nomeDoContato: contato.name,
        nomeDoVendedor,
        segmento: cadencia.configuracao.tagDoSegmento,
      });
  const corpoRenderizado = renderizarComLead(passo.corpo, {
    nomeDoContato: contato.name,
    nomeDoVendedor,
    segmento: cadencia.configuracao.tagDoSegmento,
  });

  const linkPixel = signCadenciaLink({
    enrollment_id: inscricao.id,
    organization_id: inscricao.organization_id,
    cadence_id: inscricao.cadence_id,
    lead_id: inscricao.lead_id,
    passo_id: passo.id,
  });
  const linkDescadastro = signCadenciaLink({
    enrollment_id: inscricao.id,
    organization_id: inscricao.organization_id,
    cadence_id: inscricao.cadence_id,
    lead_id: inscricao.lead_id,
    passo_id: passo.id,
  });
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const urlPixel = `${base}/api/v1/webhooks/cadencia-pixel/${linkPixel}`;
  const urlDescadastro = `${base}/api/v1/webhooks/cadencia-descadastro/${linkDescadastro}`;

  const html =
    `${corpoEmHtml(corpoRenderizado)}` +
    `<p style="margin-top:24px;font-size:11px;color:#888">` +
    `Não quer mais receber estes e-mails? <a href="${urlDescadastro}">Descadastrar</a></p>` +
    `<img src="${urlPixel}" width="1" height="1" alt="" style="display:none" />`;

  const resultado = await sendEmail({
    to: contato.email,
    subject: assunto || "(sem assunto)",
    html,
    text: `${corpoRenderizado}\n\n---\nNão quer mais receber estes e-mails? ${urlDescadastro}`,
    fromName: nomeDoVendedor ?? undefined,
    replyTo: emailDoVendedor ?? undefined,
    tags: [
      { name: "cadencia_id", value: inscricao.cadence_id },
      { name: "enrollment_id", value: inscricao.id },
    ],
  });

  if (!resultado.ok) {
    logger.error("[cadencia-worker] envio de e-mail falhou", {
      enrollment_id: inscricao.id,
      erro: resultado.error,
      via: resultado.via,
    });
    return { ok: false, erro: resultado.details ?? resultado.error ?? "send_failed" };
  }

  await admin.from("email_cadence_events").insert({
    organization_id: inscricao.organization_id,
    cadence_id: inscricao.cadence_id,
    enrollment_id: inscricao.id,
    lead_id: inscricao.lead_id,
    tipo: "email_enviado",
    passo_id: passo.id,
    metadata: { via: resultado.via },
  });

  return { ok: true };
}

/** true = leva pro "sim"; false = leva pro "não"; null = ainda não dá pra decidir (aguarda). */
export function avaliarRamo(
  passo: Extract<Passo, { tipo: "ramo" }>,
  inscricao: InscricaoRow,
  agora: Date,
): boolean | null {
  const desde = inscricao.ultimo_email_em ? new Date(inscricao.ultimo_email_em) : null;
  const prazoVenceu = desde
    ? agora.getTime() - desde.getTime() >= passo.condicao.dentroDeDias * 24 * 60 * 60 * 1000
    : true; // nunca houve e-mail: nada a esperar, decide já

  if (passo.condicao.tipo === "abriu") {
    if (inscricao.aberturas >= passo.condicao.vezes) return true;
    return prazoVenceu ? false : null;
  }
  // `clicou`/`respondeu`: sem fonte de dado ainda — nunca resolve pra "sim",
  // só aguarda o prazo e cai em "não" (ver o cabeçalho do arquivo).
  return prazoVenceu ? false : null;
}

/** Uma linha da fila, do claim até o desfecho. Nunca lança — falha vira `ultimo_erro` na própria linha. */
async function processarInscricao(admin: Admin, inscricao: InscricaoRow, agora: Date, requestId: string) {
  const cadencia = await carregarCadencia(admin, inscricao.cadence_id);
  if (!cadencia) {
    await liberarSemAvancar(admin, inscricao, agora, 60);
    return { desfecho: "adiada" as const };
  }
  if (cadencia.status !== "ativa") {
    // Pausada/rascunho: a inscrição continua ativa, só espera — o operador
    // decide quando reativar. Reconferir daqui a 1h evita martelar a cada minuto.
    await liberarSemAvancar(admin, inscricao, agora, 60);
    return { desfecho: "adiada" as const };
  }

  if (cadencia.configuracao.paradas.ganhoOuPerdido) {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("status")
      .eq("id", inscricao.lead_id)
      .maybeSingle();
    if (lead && (lead as { status: string }).status !== "open") {
      await pararInscricao(admin, inscricao, "ganho_ou_perdido");
      return { desfecho: "parada" as const };
    }
  }

  const passo = passoParaExecutar(cadencia.passos, inscricao.passo_atual_id);
  if (!passo) {
    await concluirInscricao(admin, inscricao);
    return { desfecho: "concluida" as const };
  }

  if (passo.tipo === "email") {
    const teto = await checkRateLimit(
      BUCKET_TETO_DIARIO_DE_EMAIL,
      env.CADENCIA_LIMITE_EMAILS_POR_DIA,
      JANELA_DO_TETO_DIARIO_SEG,
    );
    if (!teto.allowed) {
      await admin.from("email_cadence_events").insert({
        organization_id: inscricao.organization_id,
        cadence_id: inscricao.cadence_id,
        enrollment_id: inscricao.id,
        lead_id: inscricao.lead_id,
        tipo: "limite_diario_atingido",
        passo_id: passo.id,
        metadata: { limite: env.CADENCIA_LIMITE_EMAILS_POR_DIA, contagem: teto.count },
      });
      await liberarSemAvancar(admin, inscricao, agora, MINUTOS_DE_ESPERA_POR_TETO);
      return { desfecho: "adiada" as const };
    }

    const { data: contatoRow } = await admin
      .from("contacts")
      .select("email, name, display_name, is_anonymized")
      .eq("id", inscricao.contact_id)
      .maybeSingle();
    const contato = contatoRow as
      | { email: string | null; name: string | null; display_name: string | null; is_anonymized: boolean }
      | null;
    if (!contato || !contato.email || contato.is_anonymized) {
      await pararInscricao(admin, inscricao, "sem_email");
      return { desfecho: "parada" as const };
    }

    let nomeDoVendedor: string | null = null;
    let emailDoVendedor: string | null = null;
    const { data: leadRow } = await admin
      .from("crm_leads")
      .select("owner_user_id")
      .eq("id", inscricao.lead_id)
      .maybeSingle();
    const ownerId = (leadRow as { owner_user_id: string | null } | null)?.owner_user_id;
    if (ownerId) {
      try {
        const { data } = await admin.auth.admin.getUserById(ownerId);
        nomeDoVendedor = (data?.user?.user_metadata?.full_name as string | undefined) ?? null;
        emailDoVendedor = data?.user?.email ?? null;
      } catch {
        // Sem nome/e-mail do dono: o envio segue com o remetente padrão da instalação.
      }
    }

    const envio = await executarPassoEmail(admin, passo, {
      inscricao,
      cadencia,
      contato: { email: contato.email, name: nomeDoContato(contato) },
      nomeDoVendedor,
      emailDoVendedor,
      requestId,
    });

    if (!envio.ok) {
      await registrarTentativaFalha(admin, inscricao, envio.erro ?? "send_failed");
      return { desfecho: "falha" as const };
    }

    const proximo = proximoIrmao(cadencia.passos, passo.id);
    await avancar(admin, inscricao, {
      passoAtualId: proximo?.id ?? null,
      proximoEm: agora,
      extras: {
        ultimo_email_em: agora.toISOString(),
        ultimo_email_passo_id: passo.id,
        emails_enviados: inscricao.emails_enviados + 1,
        tentativas: 0,
      },
      concluirSeSemProximo: proximo === null,
    });
    return { desfecho: "email_enviado" as const };
  }

  if (passo.tipo === "espera") {
    const proximo = proximoIrmao(cadencia.passos, passo.id);
    await avancar(admin, inscricao, {
      passoAtualId: proximo?.id ?? null,
      proximoEm: avancarDiasUteis(agora, passo.diasUteis),
      concluirSeSemProximo: proximo === null,
    });
    return { desfecho: "avancou" as const };
  }

  if (passo.tipo === "tarefa") {
    await criarTarefaDoPasso(admin, passo, inscricao);
    const proximo = proximoIrmao(cadencia.passos, passo.id);
    await avancar(admin, inscricao, {
      passoAtualId: proximo?.id ?? null,
      proximoEm: agora,
      concluirSeSemProximo: proximo === null,
    });
    return { desfecho: "avancou" as const };
  }

  if (passo.tipo === "ramo") {
    const decisao = avaliarRamo(passo, inscricao, agora);
    if (decisao === null) {
      // Ainda dentro do prazo, sem sinal: reconfere em 15 min — nem martela a
      // cada minuto, nem deixa o lead esperando demais depois que o prazo vencer.
      await liberarSemAvancar(admin, inscricao, agora, 15);
      return { desfecho: "adiada" as const };
    }
    const lado = decisao ? "sim" : "nao";
    const proximo = primeiroDoLado(passo, lado);
    await admin.from("email_cadence_events").insert({
      organization_id: inscricao.organization_id,
      cadence_id: inscricao.cadence_id,
      enrollment_id: inscricao.id,
      lead_id: inscricao.lead_id,
      tipo: decisao ? "ramo_sim" : "ramo_nao",
      passo_id: passo.id,
    });
    await avancar(admin, inscricao, {
      passoAtualId: proximo?.id ?? null,
      proximoEm: agora,
      concluirSeSemProximo: proximo === null,
    });
    return { desfecho: "avancou" as const };
  }

  // passo.tipo === "whatsapp": ver o cabeçalho do arquivo.
  await pararInscricao(admin, inscricao, "falha", "Passo de WhatsApp ainda não é enviado pelo worker.");
  return { desfecho: "falha" as const };
}

async function criarTarefaDoPasso(
  admin: Admin,
  passo: Extract<Passo, { tipo: "tarefa" }>,
  inscricao: InscricaoRow,
) {
  const { data: leadRow } = await admin
    .from("crm_leads")
    .select("owner_user_id")
    .eq("id", inscricao.lead_id)
    .maybeSingle();
  const ownerId = (leadRow as { owner_user_id: string | null } | null)?.owner_user_id ?? inscricao.inscrito_por;

  const dueDate = avancarDiasUteis(new Date(), passo.prazoDias).toISOString();
  const { data: tarefa, error } = await admin
    .from("crm_tasks")
    .insert({
      organization_id: inscricao.organization_id,
      title: passo.titulo || "Tarefa da cadência",
      due_date: dueDate,
      priority: "medium",
      status: "pending",
      lead_id: inscricao.lead_id,
      contact_id: inscricao.contact_id,
      assigned_to: ownerId,
      created_by: inscricao.inscrito_por,
    })
    .select("id, title, due_date, priority, lead_id, contact_id")
    .single();

  if (error || !tarefa) {
    logger.error("[cadencia-worker] criação de tarefa falhou", { erro: error?.message, enrollment_id: inscricao.id });
    return;
  }

  await admin.from("email_cadence_events").insert({
    organization_id: inscricao.organization_id,
    cadence_id: inscricao.cadence_id,
    enrollment_id: inscricao.id,
    lead_id: inscricao.lead_id,
    tipo: "tarefa_criada",
    passo_id: passo.id,
    metadata: { task_id: (tarefa as { id: string }).id },
  });

  if (inscricao.inscrito_por) {
    const { registraAtividadeDaTarefa } = await import("@/lib/tarefas/atividade");
    await registraAtividadeDaTarefa(admin, {
      organizationId: inscricao.organization_id,
      tarefa: tarefa as never,
      tipo: "task_created",
      actorUserId: inscricao.inscrito_por,
    });
  }
}

async function avancar(
  admin: Admin,
  inscricao: InscricaoRow,
  args: {
    passoAtualId: string | null;
    proximoEm: Date;
    extras?: Record<string, unknown>;
    concluirSeSemProximo: boolean;
  },
) {
  if (args.concluirSeSemProximo && args.passoAtualId === null) {
    await concluirInscricao(admin, inscricao);
    return;
  }
  await admin
    .from("email_cadence_enrollments")
    .update({
      passo_atual_id: args.passoAtualId,
      proximo_em: args.proximoEm.toISOString(),
      processando_ate: null,
      updated_at: new Date().toISOString(),
      ...args.extras,
    })
    .eq("id", inscricao.id)
    .eq("organization_id", inscricao.organization_id);
}

async function concluirInscricao(admin: Admin, inscricao: InscricaoRow) {
  const agora = new Date().toISOString();
  await admin
    .from("email_cadence_enrollments")
    .update({ status: "concluida", concluida_em: agora, processando_ate: null, updated_at: agora })
    .eq("id", inscricao.id)
    .eq("organization_id", inscricao.organization_id);
  await admin.from("email_cadence_events").insert({
    organization_id: inscricao.organization_id,
    cadence_id: inscricao.cadence_id,
    enrollment_id: inscricao.id,
    lead_id: inscricao.lead_id,
    tipo: "concluida",
  });
}

async function pararInscricao(
  admin: Admin,
  inscricao: InscricaoRow,
  motivo: "sem_email" | "ganho_ou_perdido" | "falha",
  erro?: string,
) {
  const agora = new Date().toISOString();
  await admin
    .from("email_cadence_enrollments")
    .update({
      status: "parada",
      motivo_parada: motivo,
      parada_em: agora,
      processando_ate: null,
      updated_at: agora,
      ...(erro ? { ultimo_erro: erro } : {}),
    })
    .eq("id", inscricao.id)
    .eq("organization_id", inscricao.organization_id);
  await admin.from("email_cadence_events").insert({
    organization_id: inscricao.organization_id,
    cadence_id: inscricao.cadence_id,
    enrollment_id: inscricao.id,
    lead_id: inscricao.lead_id,
    tipo: "parada",
    metadata: erro ? { motivo, erro } : { motivo },
  });
}

async function registrarTentativaFalha(admin: Admin, inscricao: InscricaoRow, erro: string) {
  const agora = new Date();
  const tentativas = inscricao.tentativas + 1;
  // Backoff simples: 5 min, 15 min, 45 min... até 3 tentativas, depois para de
  // vez — envio em dobro (reenviar cego pra sempre) é pior que registrar a falha
  // e deixar visível na Atividade.
  if (tentativas >= 3) {
    await pararInscricao(admin, inscricao, "falha", erro);
    return;
  }
  await admin
    .from("email_cadence_enrollments")
    .update({
      tentativas,
      ultimo_erro: erro,
      proximo_em: new Date(agora.getTime() + tentativas * 5 * 60 * 1000).toISOString(),
      processando_ate: null,
      updated_at: agora.toISOString(),
    })
    .eq("id", inscricao.id)
    .eq("organization_id", inscricao.organization_id);
  await admin.from("email_cadence_events").insert({
    organization_id: inscricao.organization_id,
    cadence_id: inscricao.cadence_id,
    enrollment_id: inscricao.id,
    lead_id: inscricao.lead_id,
    tipo: "email_falhou",
    metadata: { erro, tentativa: tentativas },
  });
}

async function liberarSemAvancar(admin: Admin, inscricao: InscricaoRow, agora: Date, minutos: number) {
  await admin
    .from("email_cadence_enrollments")
    .update({
      proximo_em: new Date(agora.getTime() + minutos * 60 * 1000).toISOString(),
      processando_ate: null,
    })
    .eq("id", inscricao.id)
    .eq("organization_id", inscricao.organization_id);
}

export async function processarCadencias(admin: Admin, agora: Date, requestId: string): Promise<ResultadoDoTick> {
  const { data: candidatas } = await admin
    .from("email_cadence_enrollments")
    .select(
      "id, organization_id, cadence_id, lead_id, contact_id, passo_atual_id, ultimo_email_em, ultimo_email_passo_id, aberturas, emails_enviados, tentativas, inscrito_por, processando_ate",
    )
    .eq("status", "ativa")
    .lte("proximo_em", agora.toISOString())
    .limit(LOTE);

  const resultado: ResultadoDoTick = { processadas: 0, emailsEnviados: 0, concluidas: 0, paradas: 0, falhas: 0 };
  for (const linha of (candidatas ?? []) as (InscricaoRow & { processando_ate: string | null })[]) {
    // Claim otimista: só processa se ninguém mais é dono da linha agora.
    const { data: reivindicada } = await admin
      .from("email_cadence_enrollments")
      .update({ processando_ate: new Date(agora.getTime() + JANELA_DE_TRAVA_MS).toISOString() })
      .eq("id", linha.id)
      .eq("status", "ativa")
      .or(`processando_ate.is.null,processando_ate.lt.${agora.toISOString()}`)
      .select("id")
      .maybeSingle();
    if (!reivindicada) continue; // outra rodada (ou instância) já pegou

    try {
      const desfecho = await processarInscricao(admin, linha, agora, requestId);
      resultado.processadas++;
      if (desfecho.desfecho === "email_enviado") resultado.emailsEnviados++;
      if (desfecho.desfecho === "concluida") resultado.concluidas++;
      if (desfecho.desfecho === "parada") resultado.paradas++;
      if (desfecho.desfecho === "falha") resultado.falhas++;
    } catch (err) {
      logger.error("[cadencia-worker] inscrição falhou", {
        enrollment_id: linha.id,
        erro: err instanceof Error ? err.message : String(err),
      });
      await registrarTentativaFalha(admin, linha, err instanceof Error ? err.message : String(err));
      resultado.falhas++;
    }
  }
  return resultado;
}
