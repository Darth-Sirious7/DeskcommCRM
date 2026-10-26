"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
type Negocio = { id: string; title: string; status: string };
type Inscricao = { id: string; status: string; motivo_parada: string | null; emails_enviados: number; aberturas: number; rastreio_consentido: boolean; ultimo_erro: string | null; created_at: string; crm_leads: { title: string } | null };
export function Atividade({ id, ativa }: { id: string; ativa: boolean }) {
  const t = useT();
  const [linhas, setLinhas] = useState<Inscricao[]>([]);
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [termo, setTermo] = useState("");
  const [leadId, setLeadId] = useState("");
  const [consentido, setConsentido] = useState(false);
  const [erro, setErro] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/cadencias/${id}/inscricoes?limit=200`);
      if (!res.ok) throw new Error();
      const corpo = await res.json() as { data: Inscricao[] };
      setLinhas(corpo.data); setErro(false);
    } catch { setErro(true); }
  }, [id]);
  useEffect(() => {
    let vivo = true;
    void fetch(`/api/v1/cadencias/${id}/inscricoes?limit=200`).then(async (res) => {
      if (!res.ok) throw new Error();
      const corpo = await res.json() as { data: Inscricao[] };
      if (vivo) { setLinhas(corpo.data); setErro(false); }
    }).catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [id]);
  async function buscar() {
    setOcupado(true);
    try {
      const res = await fetch(`/api/v1/cadencias/negocios?q=${encodeURIComponent(termo)}`);
      if (!res.ok) throw new Error();
      const corpo = await res.json() as { data: Negocio[] };
      setNegocios(corpo.data); setLeadId("");
    } catch { toast.error(t("Não foi possível buscar os negócios.")); }
    finally { setOcupado(false); }
  }
  async function inscrever() {
    if (!leadId) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/v1/cadencias/${id}/inscricoes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: leadId, rastreio_consentido: consentido }) });
      if (!res.ok) { const corpo = await res.json() as { error?: { message?: string } }; toast.error(corpo.error?.message ?? t("Não foi possível inscrever o negócio.")); return; }
      setLeadId(""); setConsentido(false); await carregar(); toast.success(t("Inscrição criada."));
    } catch { toast.error(t("Não foi possível inscrever o negócio.")); }
    finally { setOcupado(false); }
  }
  async function retirar(inscricaoId: string) {
    setOcupado(true);
    try {
      const res = await fetch(`/api/v1/cadencias/${id}/inscricoes/${inscricaoId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await carregar();
    } catch { toast.error(t("Não foi possível retirar a inscrição.")); }
    finally { setOcupado(false); }
  }
  return <div className="w-full space-y-5 overflow-y-auto p-6">
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">{t("Inscrever negócio")}</h2>
      {!ativa && <p className="text-sm text-text-muted">{t("Ative a cadência para aceitar novas inscrições.")}</p>}
      <div className="flex gap-2"><Input aria-label={t("Buscar negócio pelo título")} value={termo} onChange={(e) => setTermo(e.target.value)} /><Button variant="outline" onClick={() => void buscar()} disabled={ocupado}>{t("Buscar")}</Button></div>
      <Label htmlFor="negocio-cadencia">{t("Negócio")}</Label>
      <select id="negocio-cadencia" value={leadId} onChange={(e) => setLeadId(e.target.value)} className="w-full rounded-md border border-border bg-surface p-2"><option value="">{t("Selecione um negócio")}</option>{negocios.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</select>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consentido} onChange={(e) => setConsentido(e.target.checked)} /><span>{t("O destinatário autorizou o rastreio de abertura. Sem esta autorização, os e-mails não incluem pixel e os ramos de abertura não recebem sinal.")}</span></label>
      <Button disabled={!ativa || !leadId || ocupado} onClick={() => void inscrever()}>{t("Inscrever")}</Button>
    </Card>
    <div className="flex items-center justify-between"><h2 className="font-semibold">{t("Inscrições e atividade")}</h2><Button variant="outline" disabled={ocupado} onClick={() => void carregar()}>{t("Atualizar")}</Button></div>
    {erro ? <p role="alert">{t("Não foi possível carregar as inscrições.")}</p> : linhas.length === 0 ? <p className="text-sm text-text-muted">{t("Nenhuma inscrição nesta cadência.")}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{[t("Negócio"), t("Estado"), t("Enviados"), t("Aberturas"), t("Ações")].map((rotulo) => <th key={rotulo} className="p-2">{rotulo}</th>)}</tr></thead><tbody>{linhas.map((l) => <tr key={l.id} className="border-t border-border"><td className="p-2">{l.crm_leads?.title ?? t("Negócio indisponível")}</td><td className="p-2">{t(l.status)}{l.motivo_parada && <span className="block text-xs text-text-muted">{t(l.motivo_parada)}</span>}{l.ultimo_erro && <span className="block text-xs text-destructive">{t("O passo falhou. Confira a configuração antes de continuar.")}</span>}</td><td className="p-2 tabular-nums">{l.emails_enviados}</td><td className="p-2 tabular-nums">{l.rastreio_consentido ? l.aberturas : t("Sem autorização")}</td><td className="p-2">{l.status === "ativa" && <Button variant="outline" size="sm" disabled={ocupado} onClick={() => void retirar(l.id)}>{t("Retirar")}</Button>}</td></tr>)}</tbody></table></div>}
    {linhas.length === 200 && <p className="text-xs text-text-muted">{t("Mostrando as 200 inscrições mais recentes.")}</p>}
    <p className="text-xs text-text-muted">{t("Aberturas podem incluir buscas automáticas do provedor. Este módulo não mede cliques, respostas ou devoluções.")}</p>
  </div>;
}
