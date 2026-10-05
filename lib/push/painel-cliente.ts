/**
 * Assina o push do PAINEL neste aparelho (2026-10-04, 0146). Só depois que a permissão de
 * notificação já foi concedida (o pedido de permissão continua no clique do sino do menu): aqui
 * nada pergunta nada ao usuário. Sem chaves VAPID no servidor ou sem suporte: não faz nada.
 */
const ROTA = '/api/admin/pedidos/push-painel'

function chaveParaBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0))
}

export async function assinarPushPainel(): Promise<'assinado' | 'indisponivel' | 'sem_permissao' | 'falhou'> {
  try {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'indisponivel'
    if (Notification.permission !== 'granted') return 'sem_permissao'
    const cfg = (await fetch(ROTA, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as { disponivel?: boolean; chavePublica?: string } | null
    if (!cfg?.disponivel || !cfg.chavePublica) return 'indisponivel'
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(cfg.chavePublica) as BufferSource })
    const r = await fetch(ROTA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
    return r.ok ? 'assinado' : 'falhou'
  } catch {
    return 'falhou'
  }
}
