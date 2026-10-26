/**
 * GET /api/v1/ai/turn-traces — o traço do turno do agente (issue #3201).
 *
 * ═══ Por que esta rota existe ══════════════════════════════════════════════
 *
 * A 0721 (fatia 1 da #2869) fez o turno gravar UMA linha por execução em
 * `agent_turn_traces`, e a revisão daquele PR deixou duas coisas combinadas: uma
 * poda e **um leitor**. Até aqui o traço era escrito e não tinha quem o lesse —
 * a própria issue diz que, sem leitor, "não guarde o que ninguém lê" não é uma
 * regra, é uma frase.
 *
 * Esta é a fatia 2: o expurgo (`fn_expurgar_traco_do_turno_vencido`, 0778, pelo
 * cron `data-retention`) e este leitor, na MESMA entrega. A tela que consome
 * esta rota é a fatia seguinte; o que a issue pede desta é o mínimo verificável,
 * e ele está aqui: ler o que ficou, da organização da sessão, e DIZER quando não
 * há nada em vez de devolver uma lista muda.
 *
 * ═══ A janela: a mesma da poda, de propósito ═══════════════════════════════
 *
 * O prazo de retenção do traço é `AI_TELEMETRY_RETENTION_DAYS` — o knob que o
 * cron já usa para as quatro tabelas de telemetria da IA (0587), com piso de
 * 100 dias. Aqui ele é lido pelo MESMO `interpretarRetencao`, e é ele que
 * define até onde esta rota consegue olhar.
 *
 * Isso não é detalhe de implementação, é o que fecha o buraco da issue: se a
 * rota parasse em 90 dias por conta própria, tudo o que a poda guarda entre 90 e
 * 400 dias seria dado que ninguém consegue ler — exatamente o defeito que esta
 * fatia existe para não repetir. Pedir uma janela mais velha que a retenção é
 * TRUNCADO para o limite do que existe, e a resposta DIZ que truncou
 * (`truncado_pela_retencao`): a ausência de linhas tem duas leituras ("o agente
 * não rodou" × "aquilo já foi expurgado") e quem lê não pode ter que adivinhar
 * qual é — a mesma doutrina do runbook de custo e cota, §4.1.
 *
 * ═══ PII: metadados do turno, nunca texto de mensagem ══════════════════════
 *
 * A projeção é a da tabela da 0721: ferramentas chamadas, estado, tokens,
 * custo, latência, ids de agente/conversa/contato e o erro TRUNCADO em 300
 * caracteres. Corpo de mensagem, texto de cliente e trecho de conhecimento não
 * estão nesta tabela e não entram por aqui (`COLUNAS_DO_TRACO` é fechada e um
 * teste a trava).
 *
 * Auth: cookie session, `manager`+ — o mesmo nível de `/api/v1/ai/runs`, que é a
 * tela irmã ("o que aconteceu, e por que falhou"). A RLS da 0721 isola por
 * organização; o `eq` explícito é a segunda barreira, não a única.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  RETENCAO_TELEMETRIA_DE_IA_DIAS_PADRAO,
  RETENCAO_TELEMETRIA_DE_IA_DIAS_PISO,
  interpretarRetencao,
} from "@/lib/retencao/politica";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Janela padrão da tela: uma semana de turnos é o que se investiga no dia a dia. */
export const JANELA_PADRAO_DIAS = 7;

/** Teto de linhas por resposta — o mesmo tamanho de página de `/ai/runs`. */
export const LIMITE_MAXIMO = 200;
const LIMITE_PADRAO = 50;

const DIA = 86_400_000;
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A projeção do leitor. Fechada e nomeada por extenso porque é ela que responde
 * "que dado pessoal esta rota expõe": são os metadados do turno, nada de corpo
 * de mensagem. `select *` aqui traria a próxima coluna que alguém acrescentar
 * sem pensar em PII.
 */
export const COLUNAS_DO_TRACO = [
  "id",
  "job_id",
  "preview_run_id",
  "conversation_id",
  "contact_id",
  "agent_id",
  "agent_version_id",
  "is_dry_run",
  "status",
  "abort_reason",
  "error_code",
  "error_message",
  "provider",
  "model",
  "messages_sent",
  "historico_mensagens",
  "tokens_in",
  "tokens_out",
  "cost_cents",
  "latency_ms",
  "skills",
  "ferramentas",
  "ferramentas_truncadas",
  "kb_sources",
  "created_at",
].join(", ");

const filtrosDaQuery = z.object({
  conversation_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  /** O turno real é chaveado por `job_id` — é o link com a fila e com `llm_calls`. */
  job_id: z.string().uuid().optional(),
  status: z.enum(["completed", "failed", "aborted"]).optional(),
  /** `real` = turno de verdade; `previa` = execução de teste (`is_dry_run`). */
  tipo: z.enum(["real", "previa"]).optional(),
  desde: z.string().regex(DIA_RE).optional(),
  ate: z.string().regex(DIA_RE).optional(),
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_PADRAO),
});

/** Por que a resposta veio sem nenhum traço. Nunca `null` em silêncio. */
export type MotivoDoVazio = "nenhum_turno_na_janela" | "purgado_pela_retencao";

export interface JanelaDaLeitura {
  de: Date;
  ate: Date;
  dias: number;
  /** A janela pedida começava antes do que a retenção guarda, e foi cortada. */
  truncada: boolean;
}

function inicioDoDiaUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function diaIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A janela efetiva da leitura — pura, sem banco e sem relógio implícito (o
 * `agora` entra por parâmetro), pelo mesmo motivo de `interpretarRetencao`: a
 * regra do corte é o que os testes medem, e ela não pode depender de quando o
 * teste roda.
 *
 * O corte é o MESMO da poda (`now() - retenção`): é isto que garante que o
 * expurgo nunca apaga o que o leitor mostra. Um dia de folga em qualquer das
 * pontas abriria a janela em que o leitor pede uma linha que já não existe.
 */
export function janelaDaLeitura(
  q: { desde?: string; ate?: string },
  retencaoDias: number,
  agora: Date = new Date(),
): JanelaDaLeitura {
  const hoje = inicioDoDiaUtc(agora);
  const ate = q.ate === undefined ? hoje : inicioDoDiaUtc(new Date(`${q.ate}T00:00:00.000Z`));
  const pedido =
    q.desde === undefined
      ? new Date(ate.getTime() - (JANELA_PADRAO_DIAS - 1) * DIA)
      : inicioDoDiaUtc(new Date(`${q.desde}T00:00:00.000Z`));
  const maisVelhoPossivel = new Date(hoje.getTime() - retencaoDias * DIA);
  const truncada = pedido.getTime() < maisVelhoPossivel.getTime();
  const de = truncada ? maisVelhoPossivel : pedido;
  // Janela invertida (o `ate` cai antes do limite da retenção): uma resposta com
  // intervalo negativo mentiria sobre o que foi lido. Vira um dia só.
  const efetiva = de.getTime() > ate.getTime() ? ate : de;
  const dias = Math.round((ate.getTime() - efetiva.getTime()) / DIA) + 1;
  return { de: efetiva, ate, dias, truncada };
}

interface LinhaDoTraco {
  id: string;
  created_at: string;
  status: string;
  is_dry_run: boolean;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("manager", { requestId, resource: "ai_turn_traces" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const filtros = filtrosDaQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!filtros.success) {
    return fail("invalid_query", t("filtros inválidos"), 422, {
      requestId,
      details: filtros.error.issues,
    });
  }
  const { conversation_id, contact_id, job_id, status, tipo, desde, ate, limite } = filtros.data;

  // Um knob, dois leitores: o expurgo (cron) e esta rota. Ler o MESMO
  // `interpretarRetencao` é o que impede os dois de divergirem — o dia em que a
  // retenção for menor que a janela da tela, é aqui que o corte aparece.
  const retencao = interpretarRetencao(env.AI_TELEMETRY_RETENTION_DAYS, {
    chave: "AI_TELEMETRY_RETENTION_DAYS",
    padrao: RETENCAO_TELEMETRIA_DE_IA_DIAS_PADRAO,
    piso: RETENCAO_TELEMETRIA_DE_IA_DIAS_PISO,
  });
  const janela = janelaDaLeitura({ desde, ate }, retencao.dias);
  const fimDaJanela = new Date(janela.ate.getTime() + DIA - 1);

  const db = await createClient();
  let consulta = db
    .from("agent_turn_traces")
    .select(COLUNAS_DO_TRACO)
    // A organização vem da SESSÃO (o portão já a resolveu contra as memberships),
    // nunca de um filtro do pedido. A RLS da 0721 isola igual; isto é a segunda.
    .eq("organization_id", authz.org.orgId)
    .gte("created_at", janela.de.toISOString())
    .lte("created_at", fimDaJanela.toISOString())
    .order("created_at", { ascending: false })
    .limit(limite);

  if (conversation_id !== undefined) consulta = consulta.eq("conversation_id", conversation_id);
  if (contact_id !== undefined) consulta = consulta.eq("contact_id", contact_id);
  if (job_id !== undefined) consulta = consulta.eq("job_id", job_id);
  if (status !== undefined) consulta = consulta.eq("status", status);
  if (tipo !== undefined) consulta = consulta.eq("is_dry_run", tipo === "previa");

  const { data, error } = await consulta;
  if (error) return fail("query_failed", error.message, 500, { requestId });

  // `as unknown as`: `agent_turn_traces` ainda não está em `database.types.ts`
  // (a 0721 não regenerou os tipos), então o PostgREST devolve o union de erro
  // da tabela desconhecida. O cast estrito falha de propósito — e é o lembrete
  // de que este `select` está preso à projeção nominal acima, não ao schema.
  const tracos = (data ?? []) as unknown as LinhaDoTraco[];

  // O contrário do silêncio: lista vazia sempre vem com o porquê. A tela (fatia
  // seguinte) escreve a frase; a rota não inventa prosa traduzível.
  const motivoDoVazio: MotivoDoVazio | null =
    tracos.length > 0
      ? null
      : janela.truncada
        ? "purgado_pela_retencao"
        : "nenhum_turno_na_janela";

  return ok(
    {
      tracos,
      total: tracos.length,
      janela: { de: diaIso(janela.de), ate: diaIso(janela.ate), dias: janela.dias },
      retencao_dias: retencao.dias,
      truncado_pela_retencao: janela.truncada,
      motivo_do_vazio: motivoDoVazio,
    },
    { requestId },
  );
}
