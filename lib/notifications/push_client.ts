import { areAlertsEnabled, getPermission } from "./permission";
import { canalLigado } from "./prefs";
import { ensureNotifyServiceWorker } from "./service_worker";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Liga a inscrição Web Push depois da permissão. Sem VAPID no servidor, no-op. */
export async function syncPushSubscription(): Promise<void> {
  if (typeof window === "undefined") return;
  // A preferência é a fonte: `alerts.enabled` é espelho que `request()` regrava.
  if (getPermission() !== "granted" || !areAlertsEnabled() || !canalLigado("message", "push")) return;
  const reg = await ensureNotifyServiceWorker();
  if (!reg?.pushManager) return;

  const cfg = await fetch("/api/v1/notifications/push").then((r) => r.json()).catch(() => null);
  const publicKey = cfg?.data?.public_key as string | undefined;
  if (!cfg?.data?.enabled || !publicKey) return;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

  await fetch("/api/v1/notifications/push", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    }),
  });
}

/**
 * Encerra o push DESTE aparelho: o servidor esquece a inscrição e o navegador
 * cancela a dele. Chamado ao desligar os alertas de mensagem e ao sair — antes
 * da action de saída, porque o DELETE precisa do cookie que ela apaga.
 *
 * Nunca lança, e as duas etapas são independentes: a saída não pode depender
 * da rede, e o cancelamento sozinho já faz o próximo envio limpar a linha no
 * servidor (404/410). Não registra service worker: sair não deve instalar nada.
 */
export async function encerrarPushDesteAparelho(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  let sub: PushSubscription | null = null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    sub = (await reg?.pushManager?.getSubscription()) ?? null;
  } catch {
    return; // service worker inacessível: não há inscrição a encerrar
  }
  if (!sub) return;
  try {
    await fetch("/api/v1/notifications/push", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // sem rede: o cancelamento abaixo basta para a faxina do próximo envio
  }
  try {
    await sub.unsubscribe();
  } catch {
    // inscrição já inválida no navegador
  }
}
