/**
 * A COLETA DE DNS do domínio de envio (#3441).
 *
 * A régua de cada registro está em `dominio-de-envio.ts` (função pura). Aqui só
 * se pergunta ao DNS, se tolera a falha de cada pergunta isoladamente e se
 * carimba a hora — três coisas que a função pura não faz de propósito.
 *
 * ─── Por que a falha é POR CONSULTA, e não do conjunto ──────────────────────
 *
 * `ENOTFOUND`/`ENODATA` são a resposta NORMAL para "esse registro não existe" —
 * é assim que um domínio recém-criado se parece antes de publicar o DKIM. Se
 * uma consulta que falha derrubasse a conferência inteira, a tela não teria como
 * dizer QUAL registro falta, que é a única coisa útil que ela tem a dizer. Cada
 * pergunta que falha vira "vazio"; erro de rede/timeout também, porque o custo de
 * dizer "não encontrei" é uma segunda tentativa do operador, e o de estourar é
 * uma tela quebrada sem diagnóstico.
 *
 * ─── Por que o resolvedor é INJETÁVEL ───────────────────────────────────────
 *
 * Sem isso, o teste teria de falar com o DNS de verdade: lento, dependente de
 * rede e incapaz de reproduzir `null MX`, dois SPF e chave DKIM em pedaços.
 * Mesmo padrão de `lib/prospecting/site-fetch.ts` (`lookup` injetável).
 */
import { resolveMx, resolveTxt } from "node:dns/promises";

import {
  diagnosticarDominioDeEnvio,
  dominioDeEndereco,
  nomeDoDkim,
  nomeDoDmarc,
  nomeDoEnvio,
  type DiagnosticoDoDominioDeEnvio,
  type RespostasDns,
} from "@/lib/email/dominio-de-envio";

/** O mínimo que se pede do DNS: TXT e MX. Fake nos testes, `node:dns/promises` em produção. */
export interface ResolvedorDns {
  readonly txt: (nome: string) => Promise<readonly (readonly string[])[]>;
  readonly mx: (
    nome: string,
  ) => Promise<readonly { readonly exchange: string; readonly priority: number }[]>;
}

export const RESOLVEDOR_DO_SISTEMA: ResolvedorDns = {
  txt: (nome) => resolveTxt(nome),
  mx: (nome) => resolveMx(nome),
};

/**
 * Uma consulta, com a falha resolvida em vazio.
 *
 * Não loga: um domínio sem DKIM publicado produziria uma linha de log por
 * conferência, e "sem registro" não é incidente. Quem quiser o motivo cru tem o
 * teste e o resolvedor.
 */
async function tentar<T>(consulta: () => Promise<T>, vazio: T): Promise<T> {
  try {
    return await consulta();
  } catch {
    return vazio;
  }
}

/** As respostas de DNS dos cinco nomes que o domínio de envio usa. */
export async function respostasDnsDoDominio(
  entrada: string,
  resolvedor: ResolvedorDns = RESOLVEDOR_DO_SISTEMA,
): Promise<RespostasDns | null> {
  const dominio = dominioDeEndereco(entrada);
  if (!dominio) return null;
  const nomeEnvio = nomeDoEnvio(dominio);
  const [raizTxt, envioTxt, envioMx, dkimTxt, dmarcTxt] = await Promise.all([
    tentar(() => resolvedor.txt(dominio), []),
    tentar(() => resolvedor.txt(nomeEnvio), []),
    // O MX é devolvido como texto JÁ FORMATADO ("10 feedback-smtp..."), porque é
    // assim que a tela e o diagnóstico leem — e porque a prioridade sozinha não
    // diz nada a quem está olhando o registro.
    tentar(
      async () =>
        (await resolvedor.mx(nomeEnvio))
          .filter((r) => typeof r?.exchange === "string")
          .slice()
          .sort((a, b) => Number(a.priority) - Number(b.priority))
          .map((r) => `${Number(r.priority)} ${r.exchange.trim().replace(/\.$/, "")}`),
      [],
    ),
    tentar(() => resolvedor.txt(nomeDoDkim(dominio)), []),
    tentar(() => resolvedor.txt(nomeDoDmarc(dominio)), []),
  ]);
  return { raizTxt, envioTxt, envioMx, dkimTxt, dmarcTxt };
}

/** O desfecho de uma conferência pedida pela tela. */
export type ConferenciaDoDominioDeEnvio =
  | { readonly ok: true; readonly diagnostico: DiagnosticoDoDominioDeEnvio }
  /** A entrada não é domínio nem endereço de e-mail — nada foi consultado. */
  | { readonly ok: false; readonly motivo: "dominio_invalido"; readonly bloqueios: readonly string[] };

/**
 * Conferir o domínio de envio: coleta e julga, em uma chamada.
 *
 * A entrada pode vir como `lojadaana.com` ou `contato@lojadaana.com` — a tela tem
 * um campo só, e a segunda forma é o que a pessoa tem à mão (o remetente).
 */
export async function conferirDominioDeEnvio(
  entrada: string,
  opcoes: { readonly resolvedor?: ResolvedorDns; readonly agora?: () => Date } = {},
): Promise<ConferenciaDoDominioDeEnvio> {
  const respostas = await respostasDnsDoDominio(entrada, opcoes.resolvedor ?? RESOLVEDOR_DO_SISTEMA);
  const conferidoEm = (opcoes.agora ?? (() => new Date()))().toISOString();
  if (!respostas) {
    return {
      ok: false,
      motivo: "dominio_invalido",
      bloqueios: [
        "Isso não é um domínio: use o nome, como lojadaana.com (o endereço contato@lojadaana.com também serve).",
      ],
    };
  }
  const diagnostico = diagnosticarDominioDeEnvio(entrada, respostas, conferidoEm);
  if (!diagnostico) {
    return {
      ok: false,
      motivo: "dominio_invalido",
      bloqueios: [
        "Isso não é um domínio: use o nome, como lojadaana.com (o endereço contato@lojadaana.com também serve).",
      ],
    };
  }
  return { ok: true, diagnostico };
}
