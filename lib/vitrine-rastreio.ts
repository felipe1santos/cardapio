'use client'

import { limparRotulo, origemDoReferrer, type EventoCliente, type TipoEvento } from '@/lib/vitrine-eventos'

/**
 * Rastreador da vitrine: junta os eventos em fila e manda em lote para
 * /api/loja/[slug]/eventos.
 *
 * Regras de convivência com a vitrine:
 * - nunca lança, nunca espera: analytics não pode atrasar nem quebrar o pedido;
 * - storage pode não existir (aba anônima, iframe, bloqueio) — cai para ids
 *   em memória e continua funcionando naquela aba;
 * - ao esconder a aba o que sobrou sai por `sendBeacon`, que o navegador
 *   entrega mesmo com a página fechando.
 */

const CHAVE_VISITANTE = 'menuzia_visitante'
const CHAVE_SESSAO = 'menuzia_sessao'
const SESSAO_OCIOSA_MS = 30 * 60_000
const INTERVALO_ENVIO_MS = 4000

function novoId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '')
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  }
}

function lerOuCriar(storage: () => Storage, chave: string): string {
  try {
    const atual = storage().getItem(chave)
    if (atual) return atual
    const id = novoId()
    storage().setItem(chave, id)
    return id
  } catch {
    return novoId()
  }
}

/** Sessão: reaproveita a da aba enquanto não passar 30 min parada. */
function sessaoAtual(): { id: string; nova: boolean } {
  try {
    const bruto = sessionStorage.getItem(CHAVE_SESSAO)
    const salvo = bruto ? (JSON.parse(bruto) as { id: string; em: number }) : null
    const agora = Date.now()
    const nova = !salvo || agora - salvo.em > SESSAO_OCIOSA_MS
    const id = nova ? novoId() : salvo.id
    sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ id, em: agora }))
    return { id, nova }
  } catch {
    return { id: novoId(), nova: true }
  }
}

export interface Rastreador {
  registrar(tipo: TipoEvento, extra?: { itemId?: string | null; alvo?: string | null }): void
  encerrar(): void
}

export function criarRastreador(slug: string): Rastreador {
  const url = `/api/loja/${encodeURIComponent(slug)}/eventos`
  const visitanteId = lerOuCriar(() => localStorage, CHAVE_VISITANTE)
  let sessao = sessaoAtual()
  const fila: (EventoCliente & { em: number })[] = []

  const montarCorpo = () => {
    const agora = Date.now()
    const lote = fila.splice(0, fila.length).map(({ em, ...e }) => ({ ...e, idade: agora - em }))
    return JSON.stringify({ visitanteId, sessaoId: sessao.id, eventos: lote })
  }

  const enviar = (fechando: boolean) => {
    if (!fila.length) return
    const corpo = montarCorpo()
    try {
      if (fechando && navigator.sendBeacon?.(url, new Blob([corpo], { type: 'application/json' }))) return
      void fetch(url, { method: 'POST', body: corpo, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
    } catch {
      /* sem rede: o evento se perde, a vitrine segue */
    }
  }

  const registrar: Rastreador['registrar'] = (tipo, extra) => {
    // Voltou depois de 30 min parado: é outra visita, como o dono esperaria.
    const antes = sessao.id
    sessao = sessaoAtual()
    if (sessao.id !== antes && tipo !== 'visita') fila.push({ tipo: 'visita', origem: 'Direto', em: Date.now() })
    fila.push({ tipo, itemId: extra?.itemId ?? null, alvo: extra?.alvo ?? null, em: Date.now() })
    if (fila.length >= 40) enviar(false)
  }

  // A visita desta abertura. A origem vem do referrer ou do utm_source do link.
  try {
    const params = new URLSearchParams(window.location.search)
    fila.push({
      tipo: 'visita',
      origem: origemDoReferrer(document.referrer, window.location.hostname, params.get('utm_source')),
      em: Date.now(),
    })
  } catch {
    fila.push({ tipo: 'visita', origem: 'Direto', em: Date.now() })
  }

  const timer = window.setInterval(() => enviar(false), INTERVALO_ENVIO_MS)
  const aoEsconder = () => {
    if (document.visibilityState === 'hidden') enviar(true)
  }
  const aoSair = () => enviar(true)

  // Cada clique em algo clicável da vitrine. O rótulo preferido é o
  // `data-rastreio` explícito; senão o nome acessível ou o texto do botão.
  const aoClicar = (ev: MouseEvent) => {
    const alvo = (ev.target as Element | null)?.closest?.('[data-rastreio], button, a, [role="button"], [role="tab"]')
    if (!alvo) return
    const rotulo = limparRotulo(
      alvo.getAttribute('data-rastreio') || alvo.getAttribute('aria-label') || (alvo as HTMLElement).innerText || alvo.textContent,
    )
    if (rotulo) registrar('clique', { alvo: rotulo })
  }

  document.addEventListener('visibilitychange', aoEsconder)
  window.addEventListener('pagehide', aoSair)
  document.addEventListener('click', aoClicar, { capture: true })

  return {
    registrar,
    encerrar() {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', aoEsconder)
      window.removeEventListener('pagehide', aoSair)
      document.removeEventListener('click', aoClicar, { capture: true })
      enviar(true)
    },
  }
}
