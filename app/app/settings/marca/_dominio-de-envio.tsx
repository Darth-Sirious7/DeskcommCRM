"use client";

/**
 * O CARD "DOMÍNIO DE ENVIO" das Configurações → Marca (#3441).
 *
 * ─── O que a pessoa faz aqui ────────────────────────────────────────────────
 *
 * Digita o domínio que assina os e-mails da organização (ou cola o endereço de
 * remetente, que traz o domínio junto) e clica em "Conferir". A resposta vem do
 * DNS PÚBLICO, não do painel do provedor: é o que o Gmail e o Yahoo leem.
 *
 * ─── Por que o resultado tem UMA linha por registro, e não um "ok/falhou" ───
 *
 * "Seu domínio está errado" não é acionável: o admin não tem como saber se falta
 * SPF, DKIM, MX de retorno ou DMARC, e cada um se conserta em um lugar diferente
 * do painel do registrador. Cada linha mostra o nome exato (copiável), o que o
 * DNS respondeu, o que deveria responder e o que aquele estado significa. Os
 * bloqueios e os avisos vêm separados porque a ordem de conserto é a dos
 * bloqueios — e `p=none` é aviso, não parede.
 *
 * ─── Por que a conferência é SERVER ACTION, e não `fetch` do navegador ───────
 *
 * Consultar DNS a partir do navegador é impossível (não há API de DNS no
 * browser) e um proxy nosso para isso viraria um oráculo aberto. A ação confere
 * o papel e o segundo fator antes de consultar.
 */
import { useState, useTransition } from "react";

import {
  conferirDominioDeEnvio,
  type ResultadoDaConferenciaDoDominio,
} from "@/app/actions/settings/conferirDominioDeEnvio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DiagnosticoDoDominioDeEnvio, EstadoDoRegistro, TipoDeRegistro } from "@/lib/email/dominio-de-envio";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

/**
 * Cada recusa vira uma frase que diz O QUE FAZER, como nos formulários irmãos.
 * `dominio_invalido` é a única que já traz a explicação do servidor — e ela vem
 * de `dominio-de-envio-dns.ts`, para não haver duas réguas do que é domínio.
 */
/** O que o `t()` recebe quando o código não está no mapa — nunca uma chave vazia. */
const ERRO_DESCONHECIDO = "Não foi possível conferir agora. Tente de novo em instantes.";

/**
 * O marcador do carimbo de hora. Fica em constante de MÓDULO porque a frase é um
 * literal do dicionário com um buraco: montar a chave por interpolação
 * (`t(`Conferido em ${x}`)`) sairia em português para quem escolheu espanhol.
 */
const MARCA_DE_QUANDO = "{quando}";

const ERRO_EM_PORTUGUES: Record<string, string> = {
  validation_failed: "Informe um domínio, como lojadaana.com.",
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  forbidden_tenant: "Você não tem nenhuma organização ativa. Aceite um convite ou contate o admin.",
  forbidden_role: "Só um administrador da organização pode conferir o domínio.",
  mfa_required: "Confirme o segundo fator nesta sessão e tente de novo.",
  dominio_invalido: "Informe um domínio, como lojadaana.com.",
};

const ROTULO_DO_TIPO: Record<TipoDeRegistro, string> = {
  spf: "SPF: quem pode entregar",
  dkim: "DKIM: assinatura da mensagem",
  mx: "MX de retorno: as voltas",
  dmarc: "DMARC: o que fazer quando falha",
};

const ROTULO_DO_ESTADO: Record<EstadoDoRegistro, string> = {
  ok: "Certo",
  atencao: "Atenção",
  ausente: "Ausente",
  conflitante: "Inválido",
};

/** A cor do selo por estado — `ausente` e `conflitante` são a mesma parede. */
const CLASSE_DO_ESTADO: Record<EstadoDoRegistro, string> = {
  ok: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  atencao: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  ausente: "border-destructive/40 text-destructive",
  conflitante: "border-destructive/40 text-destructive",
};

export function DominioDeEnvio({
  dominioInicial,
  idioma,
}: {
  /** O domínio que já se conhece da organização (do "responder para"), se houver. */
  readonly dominioInicial: string | null;
  readonly idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const [valor, setValor] = useState(dominioInicial ?? "");
  const [diagnostico, setDiagnostico] = useState<DiagnosticoDoDominioDeEnvio | null>(null);
  // O erro guarda o CÓDIGO (para a frase do dicionário) e, quando o servidor
  // manda uma explicação própria, o texto dela: `t()` nunca recebe variável.
  const [erro, setErro] = useState<{ codigo: string; frase: string | null } | null>(null);
  const [pendente, iniciar] = useTransition();

  function conferir(evento: React.FormEvent) {
    evento.preventDefault();
    iniciar(async () => {
      const resultado: ResultadoDaConferenciaDoDominio = await conferirDominioDeEnvio(valor);
      if (!resultado.ok) {
        setDiagnostico(null);
        // As frases de motivo do servidor já estão em português e são a
        // explicação mais precisa que existe (dizem o que digitar) — a do mapa
        // só entra quando ele não trouxe nenhuma.
        setErro({ codigo: resultado.error, frase: resultado.bloqueios?.[0] ?? null });
        return;
      }
      setErro(null);
      setDiagnostico(resultado.diagnostico);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Domínio de envio")}</CardTitle>
        <CardDescription>
          {t(
            "O domínio pelo qual saem os e-mails das automações e das campanhas. A conferência lê o DNS público e diz o que falta publicar.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={conferir}>
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <Label htmlFor="dominio-de-envio">{t("Domínio ou e-mail")}</Label>
            <Input
              id="dominio-de-envio"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="lojadaana.com"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" disabled={pendente || valor.trim().length < 3}>
            {pendente ? t("Conferindo…") : t("Conferir")}
          </Button>
        </form>

        {erro ? (
          <p className="text-sm text-destructive" role="alert">
            {erro.frase ?? t(ERRO_EM_PORTUGUES[erro.codigo] ?? ERRO_DESCONHECIDO)}
          </p>
        ) : null}

        {diagnostico ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={
                  diagnostico.prontoParaEnviar
                    ? CLASSE_DO_ESTADO.ok
                    : CLASSE_DO_ESTADO.conflitante
                }
              >
                {diagnostico.prontoParaEnviar ? t("Pronto para enviar") : t("Falta publicar")}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">{diagnostico.dominio}</span>
              <span className="text-xs text-muted-foreground">
                {t("Conferido em {quando}").replace(
                  MARCA_DE_QUANDO,
                  new Date(diagnostico.conferidoEm).toLocaleString(idioma),
                )}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">{t("Registro")}</th>
                    <th className="py-1 pr-3 font-medium">{t("Nome")}</th>
                    <th className="py-1 pr-3 font-medium">{t("Situação")}</th>
                    <th className="py-1 font-medium">{t("Encontrado")}</th>
                  </tr>
                </thead>
                <tbody>
                  {diagnostico.registros.map((registro) => (
                    <tr key={registro.tipo} className="border-t align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{t(ROTULO_DO_TIPO[registro.tipo])}</td>
                      <td className="py-2 pr-3 font-mono text-xs break-all">{registro.nome}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <Badge variant="outline" className={CLASSE_DO_ESTADO[registro.estado]}>
                          {t(ROTULO_DO_ESTADO[registro.estado])}
                        </Badge>
                      </td>
                      <td className="py-2 font-mono text-xs break-all">
                        {registro.encontrado ?? (
                          <span className="text-muted-foreground">
                            {t("Publicar")}: {registro.esperado}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {diagnostico.bloqueios.length > 0 ? (
              <section className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">{t("Bloqueios")}</h3>
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {diagnostico.bloqueios.map((frase) => (
                    <li key={frase}>{frase}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {diagnostico.avisos.length > 0 ? (
              <section className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">{t("Avisos")}</h3>
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {diagnostico.avisos.map((frase) => (
                    <li key={frase}>{frase}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
