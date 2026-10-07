'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PedidoItem } from '@/lib/queries/pedidos'
import type { FichaPreparo } from '@/lib/queries/fichas'
import { descricaoEmTextoPuro } from '@/lib/descricao-rica'

/**
 * Peças da tela da cozinha (KDS) redesenhada em 2026-09-30: preferências do aparelho
 * (som, limites do cronômetro, filtro), tela cheia + tela sempre acesa, cabeçalho
 * compacto, item do pedido legível de longe (com marcar como feito) e o "Como fazer".
 */

// ─── Preferências do aparelho (localStorage) ─────────────────────────────────

export type FiltroKds = 'todos' | 'mesa' | 'entrega' | 'retirada'
export interface PrefsKds { som: boolean; atencaoMin: number; atrasoMin: number; filtro: FiltroKds }
const PADRAO: PrefsKds = { som: true, atencaoMin: 10, atrasoMin: 20, filtro: 'todos' }

export function usePrefsKds(token: string) {
  const chave = `cozinha:prefs:${token}`
  const [prefs, setPrefs] = useState<PrefsKds>(PADRAO)
  useEffect(() => {
    try { const s = localStorage.getItem(chave); if (s) setPrefs({ ...PADRAO, ...JSON.parse(s) }) } catch { /* sem storage */ }
  }, [chave])
  const mudar = useCallback((p: Partial<PrefsKds>) => {
    setPrefs((prev) => {
      const novo = { ...prev, ...p }
      try { localStorage.setItem(chave, JSON.stringify(novo)) } catch { /* sem storage */ }
      return novo
    })
  }, [chave])
  return [prefs, mudar] as const
}

/** Cor do cronômetro: normal → atenção (amarelo) → atrasado (vermelho). */
export function corDoTempo(ms: number, prefs: Pick<PrefsKds, 'atencaoMin' | 'atrasoMin'>): 'normal' | 'atencao' | 'atraso' {
  const min = ms / 60000
  if (min >= prefs.atrasoMin) return 'atraso'
  if (min >= prefs.atencaoMin) return 'atencao'
  return 'normal'
}

export function filtrar<T extends { tipo: string; canal?: string | null; mesa?: string | null }>(pedidos: T[], filtro: FiltroKds): T[] {
  if (filtro === 'todos') return pedidos
  if (filtro === 'mesa') return pedidos.filter((p) => p.canal === 'mesa' || !!p.mesa)
  if (filtro === 'retirada') return pedidos.filter((p) => p.tipo === 'retirada' && p.canal !== 'mesa' && !p.mesa)
  return pedidos.filter((p) => p.tipo === 'entrega')
}

// ─── Itens marcados como feitos (por pedido, no aparelho) ────────────────────

export function useItensFeitos(token: string) {
  const chave = `cozinha:feitos:${token}`
  const [feitos, setFeitos] = useState<Record<string, string[]>>({})
  useEffect(() => { try { const s = localStorage.getItem(chave); if (s) setFeitos(JSON.parse(s)) } catch { /* */ } }, [chave])
  const alternar = useCallback((pedidoId: string, itemId: string) => {
    setFeitos((prev) => {
      const atual = new Set(prev[pedidoId] ?? [])
      if (atual.has(itemId)) atual.delete(itemId); else atual.add(itemId)
      const novo = { ...prev, [pedidoId]: [...atual] }
      try { localStorage.setItem(chave, JSON.stringify(novo)) } catch { /* */ }
      return novo
    })
  }, [chave])
  return [feitos, alternar] as const
}

// ─── Tela cheia + tela sempre acesa ──────────────────────────────────────────

export function useTelaCheiaEAcesa() {
  const [cheia, setCheia] = useState(false)
  const lock = useRef<{ release: () => Promise<void> } | null>(null)
  useEffect(() => {
    const aoMudar = () => setCheia(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', aoMudar)
    return () => document.removeEventListener('fullscreenchange', aoMudar)
  }, [])
  // Wake Lock: pede de novo sempre que a aba volta a ficar visível (o navegador solta).
  useEffect(() => {
    const pedir = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
        if (wl && document.visibilityState === 'visible') lock.current = await wl.request('screen')
      } catch { /* sem suporte ou negado */ }
    }
    void pedir()
    const aoVoltar = () => { if (document.visibilityState === 'visible') void pedir() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { document.removeEventListener('visibilitychange', aoVoltar); void lock.current?.release().catch(() => {}) }
  }, [])
  const alternar = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch { /* bloqueado */ }
  }, [])
  return { cheia, alternar }
}

// ─── Desfazer (toast) ─────────────────────────────────────────────────────────

export function Desfazer({ texto, onDesfazer, onFim }: { texto: string; onDesfazer: () => void; onFim: () => void }) {
  useEffect(() => { const t = setTimeout(onFim, 6000); return () => clearTimeout(t) }, [onFim, texto])
  return (
    <div role="status" data-testid="kds-desfazer" className="fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-4 rounded-full border border-[#2A3547] bg-[#1F2937] px-5 py-3 text-[15px] font-semibold text-white shadow-2xl">
      {texto}
      <button type="button" onClick={onDesfazer} className="rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold uppercase tracking-wide text-[#111827]">Desfazer</button>
    </div>
  )
}

// ─── Item do pedido ───────────────────────────────────────────────────────────

const SEM = /^(sem|s\/|tirar|retirar)\b/i

export function ItemKds({ item, feito, onAlternar, onComoFazer, grande = false }: { item: PedidoItem; feito: boolean; onAlternar?: () => void; onComoFazer?: () => void; grande?: boolean }) {
  return (
    <div data-testid="kds-item" data-feito={feito ? 'sim' : 'nao'} className={['rounded-[6px] border border-[#2A3547] bg-[#0F1726] p-3', feito ? 'opacity-55' : ''].join(' ')}>
      <div className="flex items-start gap-3">
        {onAlternar && (
          <button type="button" onClick={onAlternar} aria-label={feito ? 'Desmarcar item' : 'Marcar item como feito'} data-testid="kds-item-marcar"
            className={['mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-[6px] border-2 text-[18px] font-semibold', feito ? 'border-[#10B981] bg-[#10B981] text-white' : 'border-[#4B5563] text-transparent'].join(' ')}>✓</button>
        )}
        <button type="button" onClick={onComoFazer} disabled={!onComoFazer} className="min-w-0 flex-1 text-left disabled:cursor-default" data-testid="kds-item-abrir">
          <p className={[grande ? 'text-[24px]' : 'text-[19px]', 'font-semibold leading-tight text-white', feito ? 'line-through decoration-2' : ''].join(' ')}>
            <span className="mr-1 text-[#FBBF24]">{item.quantidade}×</span> {item.nome}
          </p>
          {(item.tamanhoNome || item.saborNome || item.bordaNome || item.massaNome) && (
            <p className="mt-0.5 text-[15px] font-semibold text-[#CBD5E1]">{[item.tamanhoNome, item.saborNome, item.bordaNome, item.massaNome].filter(Boolean).join(' · ')}</p>
          )}
          {item.descricao && <p className="mt-1 text-[14px] leading-snug text-[#A3ACBA]">{descricaoEmTextoPuro(item.descricao)}</p>}
          {item.complementos.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {item.complementos.map((c, i) => (
                SEM.test(c.nome)
                  ? <li key={i} className="text-[17px] font-semibold uppercase tracking-wide text-[#F87171]">{c.nome}</li>
                  : <li key={i} className="text-[16px] font-semibold text-[#6EE7B7]">+ {c.nome}</li>
              ))}
            </ul>
          )}
          {item.observacao && (
            <p className="mt-2 flex items-start gap-2 rounded-[6px] bg-[#7F1D1D]/50 px-2.5 py-1.5 text-[16px] font-semibold uppercase text-[#FECACA]" data-testid="kds-obs">
              <span aria-hidden>⚠️</span>{item.observacao}
            </p>
          )}
          {onComoFazer && <span className="mt-1.5 inline-block text-[12px] font-semibold uppercase tracking-wide text-[#7DD3FC]">Como fazer ›</span>}
        </button>
      </div>
    </div>
  )
}

// ─── "Como fazer" ─────────────────────────────────────────────────────────────

/** Ilustração própria (SVG simples nas cores do sistema): hambúrguer + caixa de entrega. */
function IlustracaoPreparo() {
  return (
    <svg viewBox="0 0 160 110" className="h-[92px] w-[134px]" aria-hidden>
      <rect x="92" y="48" width="56" height="44" rx="4" fill="#0688D4" />
      <path d="M92 60h56" stroke="#0570AE" strokeWidth="3" />
      <rect x="112" y="40" width="16" height="10" rx="2" fill="#0570AE" />
      <path d="M14 52c0-18 18-30 40-30s40 12 40 30z" fill="#F59E0B" />
      <circle cx="40" cy="36" r="2" fill="#FEF3C7" /><circle cx="56" cy="30" r="2" fill="#FEF3C7" /><circle cx="70" cy="38" r="2" fill="#FEF3C7" />
      <rect x="10" y="54" width="88" height="7" rx="3.5" fill="#10B981" />
      <rect x="12" y="62" width="84" height="10" rx="5" fill="#7C2D12" />
      <rect x="10" y="73" width="88" height="5" rx="2.5" fill="#FBBF24" />
      <path d="M14 80h80c0 8-8 14-18 14H32c-10 0-18-6-18-14z" fill="#F59E0B" />
    </svg>
  )
}

interface DadosFicha { nome: string; imagemUrl: string | null; ficha: FichaPreparo | null }

export function ComoFazerModal({ token, item, podeEditar = false, onFechar }: { token: string; item: PedidoItem; podeEditar?: boolean; onFechar: () => void }) {
  const [dados, setDados] = useState<DadosFicha | null>(null)
  const [erro, setErro] = useState(false)
  const [passo, setPasso] = useState(0)
  const [feitos, setFeitos] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (!item.itemId) { setDados({ nome: item.nome, imagemUrl: null, ficha: null }); return }
    fetch(`/api/cozinha/${token}/ficha/${item.itemId}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setDados, () => setErro(true))
  }, [token, item])
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar()
      if (e.key === 'ArrowRight') setPasso((p) => p + 1)
      if (e.key === 'ArrowLeft') setPasso((p) => Math.max(0, p - 1))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onFechar])
  const passos = dados?.ficha?.passos ?? []
  const atual = Math.min(passo, Math.max(0, passos.length - 1))
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3" role="dialog" aria-modal="true" data-testid="como-fazer">
      <div className="flex max-h-[96dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[10px] border border-[#2A3547] bg-[#111827] text-white shadow-2xl">
        <div className="flex items-center gap-4 border-b border-[#2A3547] px-5 py-3">
          {dados?.imagemUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={dados.imagemUrl} alt="" className="h-[84px] w-[84px] rounded-[8px] object-cover" />
            : <IlustracaoPreparo />}
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#7DD3FC]">Como fazer</p>
            <h2 className="truncate text-[28px] font-semibold leading-tight">{item.nome}</h2>
            {dados?.ficha?.tempoMin && <p className="text-[15px] font-semibold text-[#FBBF24]">⏱ {dados.ficha.tempoMin} min</p>}
          </div>
          {dados?.imagemUrl && <IlustracaoPreparo />}
          <button type="button" onClick={onFechar} aria-label="Fechar" className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-[26px] hover:bg-white/20">×</button>
        </div>
        <div className="grid flex-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <section>
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[#A3ACBA]">Este pedido</h3>
            <ItemKds item={item} feito={false} grande />
            {dados?.ficha && dados.ficha.ingredientes.length > 0 && (
              <>
                <h3 className="mb-2 mt-4 text-[13px] font-semibold uppercase tracking-wide text-[#A3ACBA]">Ingredientes</h3>
                <ul className="space-y-1" data-testid="como-fazer-ingredientes">
                  {dados.ficha.ingredientes.map((i, k) => (
                    <li key={k} className="flex justify-between gap-3 border-b border-[#2A3547] py-1.5 text-[18px]"><span className="font-semibold">{i.nome}</span><span className="text-[#CBD5E1]">{i.quantidade}</span></li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <section>
            {erro ? <p className="text-[16px] text-[#FCA5A5]">Não foi possível carregar a ficha.</p> : !dados ? <div className="h-40 animate-pulse rounded-[8px] bg-white/5" /> : !dados.ficha || passos.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-[#2A3547] p-6 text-center" data-testid="como-fazer-sem-ficha">
                <p className="text-[20px] font-semibold">Ficha de preparo ainda não cadastrada</p>
                <p className="mt-1 text-[15px] text-[#A3ACBA]">Siga o que o pedido pede, ao lado.</p>
                {podeEditar && <p className="mt-3 text-[14px] text-[#7DD3FC]">Para cadastrar: painel › Cardápio › editar o item › Exibição › Ficha de preparo.</p>}
              </div>
            ) : (
              <div data-testid="como-fazer-passos">
                <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[#A3ACBA]">Modo de preparo · passo {atual + 1} de {passos.length}</h3>
                <div className="rounded-[8px] border border-[#2A3547] bg-[#0F1726] p-5">
                  <div className="flex items-start gap-4">
                    <button type="button" onClick={() => setFeitos((f) => { const n = new Set(f); if (n.has(atual)) n.delete(atual); else n.add(atual); return n })}
                      className={['grid h-12 w-12 flex-shrink-0 place-items-center rounded-full border-2 text-[22px] font-semibold', feitos.has(atual) ? 'border-[#10B981] bg-[#10B981]' : 'border-[#4B5563]'].join(' ')}>{feitos.has(atual) ? '✓' : atual + 1}</button>
                    <p className={['text-[26px] font-semibold leading-snug', feitos.has(atual) ? 'text-[#A3ACBA] line-through' : ''].join(' ')}>{passos[atual].texto}</p>
                  </div>
                  {passos[atual].fotoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={passos[atual].fotoUrl!} alt="" className="mt-4 max-h-[260px] w-full rounded-[8px] object-cover" />
                  )}
                </div>
                <div className="mt-3 flex gap-3">
                  <button type="button" disabled={atual === 0} onClick={() => setPasso(Math.max(0, atual - 1))} className="flex-1 rounded-[8px] bg-white/10 py-4 text-[16px] font-semibold uppercase disabled:opacity-30">‹ Anterior</button>
                  <button type="button" disabled={atual >= passos.length - 1} onClick={() => setPasso(atual + 1)} className="flex-1 rounded-[8px] bg-[#0688D4] py-4 text-[16px] font-semibold uppercase disabled:opacity-30">Próximo ›</button>
                </div>
                <ol className="mt-4 space-y-1">
                  {passos.map((p, k) => (
                    <li key={k}><button type="button" onClick={() => setPasso(k)} className={['w-full truncate rounded-[6px] px-3 py-1.5 text-left text-[15px]', k === atual ? 'bg-white/10 font-semibold' : 'text-[#A3ACBA]', feitos.has(k) ? 'line-through' : ''].join(' ')}>{k + 1}. {p.texto}</button></li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
