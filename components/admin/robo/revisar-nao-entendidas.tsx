'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, Check, ChevronLeft, ChevronRight, EyeOff, Loader2, ShoppingBag, Sparkles, X } from 'lucide-react'
import type { Assunto } from '@/lib/robo-auto/classificador'
import { conflitosDaPalavra, type AcaoAprender, type Sugestao } from '@/lib/robo-auto/aprender'

/**
 * "Mensagens que o robô não entendeu" (refeito em 16/10/2026): um card compacto com o número e [Revisar]; o modal mostra
 * uma mensagem por vez, com a anterior como contexto, a sugestão já marcada e 4 ações. Teclado: ← → navega, 1–4 escolhe
 * a ação, Enter confirma (Ctrl+Enter dentro da resposta), Esc fecha.
 */
export interface ItemRevisao {
  id: string; texto: string; exemplo: string | null; vezes: number; ultima_em: string; contexto: string | null; sugestao: Sugestao | null; palavras: string[]
}

const ACOES: { id: AcaoAprender; rotulo: string; icone: React.ReactNode; explica: string }[] = [
  { id: 'robo', rotulo: 'Robô responde', icone: <Bot className="h-[15px] w-[15px]" />, explica: 'Escolha o assunto e toque em 1 a 3 palavras que mostram isso. Elas viram palavra-chave do robô.' },
  { id: 'ia', rotulo: 'IA responde', icone: <Sparkles className="h-[15px] w-[15px]" />, explica: 'Escreva a resposta que o CLIENTE vai receber (ex.: Não, só refrigerante e água). Não escreva instruções para a IA.' },
  { id: 'pedido', rotulo: 'É pedido', icone: <ShoppingBag className="h-[15px] w-[15px]" />, explica: 'Pedido escrito parecido vai direto para o Agente de IA (sem a IA ligada, para o atendente).' },
  { id: 'ignorar', rotulo: 'Ignorar', icone: <EyeOff className="h-[15px] w-[15px]" />, explica: 'Não pede nada ("ah", "pode deixar", "ok"). Sai da lista.' },
]

/** Resposta que parece instrução para a IA ("o cliente", "você precisa", "atender"…) e não a frase que o cliente vai ler. */
export function pareceInstrucao(texto: string): boolean {
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return /\b(o cliente|ao cliente|voce precisa|voce deve|atender|responda|diga que|fale que|informe que)\b/.test(t)
}

export function CartaoNaoEntendidas({ rotulos, assuntos, agenteLigado, mostrar, onMudou }: {
  rotulos: Record<Assunto, string>; assuntos: Assunto[]; agenteLigado: boolean
  mostrar: (tipo: 'ok' | 'erro', texto: string) => void; onMudou: () => Promise<void> | void
}) {
  const [itens, setItens] = useState<ItemRevisao[] | null>(null)
  const [aberto, setAberto] = useState(false)
  const carregar = useCallback(async () => {
    const res = await fetch('/api/admin/whatsapp/autoatendimento/nao-entendidas', { cache: 'no-store' }).catch(() => null)
    setItens(res?.ok ? ((await res.json()).itens ?? []) : [])
  }, [])
  useEffect(() => { void carregar() }, [carregar])
  const n = itens?.length ?? 0
  return (
    <section className="fin-card flex flex-wrap items-center gap-[12px] px-[16px] py-[12px]" data-testid="robo-nao-entendidas">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-[#1C2B33]" data-testid="nao-entendidas-total">
          {itens === null ? 'Mensagens que o robô não entendeu…' : `${n} ${n === 1 ? 'mensagem' : 'mensagens'} que o robô não entendeu`}
        </p>
        <p className="text-[12.5px] text-[#465A69]">Últimos 30 dias. Revise uma por vez: a sugestão já vem marcada, é só confirmar.</p>
      </div>
      <button type="button" disabled={!n} onClick={() => setAberto(true)} data-testid="nao-entendidas-revisar"
        className="inline-flex h-[36px] items-center gap-[6px] rounded-[6px] bg-[#0688D4] px-[14px] text-[13px] font-semibold text-white hover:bg-[#0570AE] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0688D4]/40">
        Revisar
      </button>
      {aberto && itens && (
        <ModalRevisao itens={itens} rotulos={rotulos} assuntos={assuntos} agenteLigado={agenteLigado} mostrar={mostrar}
          onResolvido={(id) => setItens((l) => (l ?? []).filter((x) => x.id !== id))}
          onFechar={() => { setAberto(false); void carregar(); void onMudou() }} />
      )}
    </section>
  )
}

export function ModalRevisao({ itens, rotulos, assuntos, agenteLigado, mostrar, onResolvido, onFechar }: {
  itens: ItemRevisao[]; rotulos: Record<Assunto, string>; assuntos: Assunto[]; agenteLigado: boolean
  mostrar: (tipo: 'ok' | 'erro', texto: string) => void; onResolvido: (id: string) => void; onFechar: () => void
}) {
  const [i, setI] = useState(0)
  const item = itens[Math.min(i, itens.length - 1)]
  const sug = item?.sugestao
  // Escolha por mensagem (id), partindo SEMPRE da sugestão: o botão marcado ao abrir é o "sugerido" (16/10: antes um efeito
  // copiava a sugestão depois do primeiro desenho e o botão podia ficar no padrão "IA responde").
  const [escolhas, setEscolhas] = useState<Record<string, { acao?: AcaoAprender; assunto?: Assunto | ''; palavras?: string[]; resposta?: string }>>({})
  const minha = (item && escolhas[item.id]) || {}
  const acao: AcaoAprender = minha.acao ?? sug?.acao ?? 'ia'
  const assunto: Assunto | '' = minha.assunto ?? sug?.assunto ?? ''
  const palavras: string[] = minha.palavras ?? (sug?.palavras ?? []).filter((p) => item?.palavras.includes(p)).slice(0, 3)
  const resposta = minha.resposta ?? ''
  const mudar = useCallback((m: Partial<{ acao: AcaoAprender; assunto: Assunto | ''; palavras: string[]; resposta: string }>) => {
    if (!item) return
    setEscolhas((e) => ({ ...e, [item.id]: { ...e[item.id], ...m } }))
  }, [item])
  const setAcao = (a: AcaoAprender) => mudar({ acao: a })
  const setAssunto = (a: Assunto | '') => mudar({ assunto: a })
  const setPalavras = (f: (l: string[]) => string[]) => mudar({ palavras: f(palavras) })
  const setResposta = (r: string) => mudar({ resposta: r })
  const [salvando, setSalvando] = useState(false)
  const instrucao = acao === 'ia' && pareceInstrucao(resposta)

  const conflitos = useMemo(() => {
    if (acao !== 'robo' || !assunto || !palavras.length || !item) return null
    const outras = itens.filter((x) => x.id !== item.id).map((x) => x.exemplo || x.texto)
    const r = palavras.map((p) => conflitosDaPalavra(p, assunto, outras))
    return { frases: [...new Set(r.flatMap((x) => x.frases))].slice(0, 4), assuntos: [...new Set(r.flatMap((x) => x.outrosAssuntos))] }
  }, [acao, assunto, palavras, item, itens])

  const pode = !!item && !salvando && (acao === 'robo' ? !!assunto && palavras.length >= 1 : acao === 'ia' ? resposta.trim().length >= 2 && !instrucao : true)

  const confirmar = useCallback(async () => {
    if (!item || !pode) return
    setSalvando(true)
    const res = await fetch('/api/admin/whatsapp/autoatendimento/nao-entendidas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, acao, ...(acao === 'robo' ? { assunto, palavras } : {}), ...(acao === 'ia' ? { resposta } : {}) }),
    }).catch(() => null)
    setSalvando(false)
    if (!res?.ok) { mostrar('erro', (await res?.json().catch(() => null))?.error ?? 'Não foi possível salvar.'); return }
    onResolvido(item.id)
    if (itens.length <= 1) { mostrar('ok', 'Pronto! Nenhuma mensagem para revisar.'); onFechar() }
  }, [item, pode, acao, assunto, palavras, resposta, mostrar, onResolvido, itens.length, onFechar])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const naResposta = (e.target as HTMLElement)?.tagName === 'TEXTAREA'
      if (e.key === 'Escape') { onFechar(); return }
      if (e.key === 'Enter' && (!naResposta || e.ctrlKey || e.metaKey)) { e.preventDefault(); void confirmar(); return }
      if (naResposta || (e.target as HTMLElement)?.tagName === 'SELECT') return
      if (e.key === 'ArrowRight') setI((x) => Math.min(x + 1, itens.length - 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0))
      const k = ['1', '2', '3', '4'].indexOf(e.key)
      if (k >= 0) mudar({ acao: ACOES[k].id })
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [confirmar, onFechar, itens.length, mudar])

  if (!item || typeof document === 'undefined') return null
  const posicao = Math.min(i, itens.length - 1) + 1
  return createPortal(
    <div className="fin-meta fixed inset-0 z-[9000] flex items-center justify-center bg-[rgba(17,24,39,0.5)] p-[16px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div role="dialog" aria-modal="true" aria-label="Revisar mensagens que o robô não entendeu" data-testid="modal-revisar"
        className="flex max-h-[92dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-[12px] bg-white shadow-[0_20px_50px_rgba(17,24,39,0.25)]">
        <header className="flex items-center gap-[8px] border-b border-[#E5E7EB] px-[16px] py-[12px]">
          <p className="flex-1 text-[15px] font-semibold text-[#1C2B33]">Revisar mensagens <span className="ml-[6px] font-normal tabular-nums text-[#5B6472]" data-testid="revisar-contador">{posicao} de {itens.length}</span></p>
          <button type="button" aria-label="Anterior (←)" disabled={posicao <= 1} onClick={() => setI((x) => Math.max(x - 1, 0))} className="grid h-[32px] w-[32px] place-items-center rounded-[6px] text-[#4B5563] hover:bg-[#F3F4F6] disabled:opacity-40"><ChevronLeft className="h-[18px] w-[18px]" /></button>
          <button type="button" aria-label="Próxima (→)" disabled={posicao >= itens.length} onClick={() => setI((x) => Math.min(x + 1, itens.length - 1))} className="grid h-[32px] w-[32px] place-items-center rounded-[6px] text-[#4B5563] hover:bg-[#F3F4F6] disabled:opacity-40" data-testid="revisar-proxima"><ChevronRight className="h-[18px] w-[18px]" /></button>
          <button type="button" aria-label="Fechar (Esc)" onClick={onFechar} className="grid h-[32px] w-[32px] place-items-center rounded-[6px] text-[#4B5563] hover:bg-[#F3F4F6]"><X className="h-[18px] w-[18px]" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-[14px] overflow-y-auto px-[16px] py-[14px]">
          {item.contexto && <p className="rounded-[6px] bg-[#F3F4F6] px-[10px] py-[6px] text-[12.5px] text-[#4B5563]" data-testid="revisar-contexto">Antes: {item.contexto.length > 200 ? `${item.contexto.slice(0, 200)}…` : item.contexto}</p>}
          <div>
            <p className="text-[18px] font-semibold leading-snug text-[#111827]" data-testid="revisar-frase">“{item.exemplo || item.texto}”</p>
            <p className="mt-[2px] text-[12px] text-[#5B6472]">{item.vezes}× · última {new Date(item.ultima_em).toLocaleDateString('pt-BR')}</p>
          </div>

          <div role="radiogroup" aria-label="O que fazer" className="grid grid-cols-2 gap-[6px] sm:grid-cols-4">
            {ACOES.map((a, k) => {
              const ativo = acao === a.id
              return (
                <button key={a.id} type="button" role="radio" aria-checked={ativo} onClick={() => setAcao(a.id)} data-testid={`revisar-acao-${a.id}`}
                  className={`relative flex h-[44px] items-center justify-center gap-[6px] rounded-[8px] border px-[8px] text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0688D4]/40 ${ativo ? 'border-[#0688D4] bg-[#E0F2FE] text-[#0369A1]' : 'border-[#D1D5DB] bg-white text-[#374151] hover:bg-[#F9FAFB]'}`}>
                  {a.icone}{a.rotulo}<span className="sr-only"> (tecla {k + 1})</span>
                  {sug?.acao === a.id && <span className="absolute -top-[8px] right-[6px] rounded-full bg-[#FEF3C7] px-[6px] text-[10.5px] font-semibold text-[#92400E]">sugerido</span>}
                </button>
              )
            })}
          </div>
          <p className="text-[12.5px] text-[#465A69]">{ACOES.find((a) => a.id === acao)?.explica}</p>

          {acao === 'robo' && (
            <div className="space-y-[10px]">
              <label className="block text-[12.5px] font-semibold text-[#374151]">Assunto
                <select value={assunto} onChange={(e) => setAssunto(e.target.value as Assunto)} data-testid="revisar-assunto"
                  className="mt-[4px] block h-[38px] w-full rounded-[6px] border border-[#D1D5DB] bg-white px-[10px] text-[14px]">
                  <option value="">Escolha…</option>
                  {assuntos.map((a) => <option key={a} value={a}>{rotulos[a]}</option>)}
                </select>
              </label>
              <div>
                <p className="text-[12.5px] font-semibold text-[#374151]">Toque nas palavras que importam (até 3)</p>
                <div className="mt-[6px] flex flex-wrap gap-[6px]">
                  {item.palavras.map((p) => {
                    const sel = palavras.includes(p)
                    return (
                      <button key={p} type="button" aria-pressed={sel} data-testid={`revisar-palavra-${p}`}
                        onClick={() => setPalavras((l) => (sel ? l.filter((x) => x !== p) : l.length < 3 ? [...l, p] : l))}
                        className={`h-[32px] rounded-full border px-[12px] text-[13px] font-medium ${sel ? 'border-[#0688D4] bg-[#0688D4] text-white' : 'border-[#D1D5DB] bg-white text-[#374151] hover:bg-[#F3F4F6]'}`}>
                        {p}
                      </button>
                    )
                  })}
                  {!item.palavras.length && <p className="text-[12.5px] text-[#5B6472]">Esta mensagem não tem palavras para ensinar. Use IA responde ou Ignorar.</p>}
                </div>
              </div>
              {conflitos && (conflitos.frases.length > 0 || conflitos.assuntos.length > 0) && (
                <p className="rounded-[6px] border border-l-[3px] border-[#FCD34D] border-l-[#F59E0B] bg-[#FEF3C7] px-[10px] py-[8px] text-[12.5px] text-[#92400E]" data-testid="revisar-conflito">
                  {conflitos.assuntos.length > 0 && <>Atenção: essa palavra já é do assunto {conflitos.assuntos.map((a) => rotulos[a]).join(', ')}. </>}
                  {conflitos.frases.length > 0 && <>Essa palavra também vai pegar: {conflitos.frases.map((f) => `“${f}”`).join(', ')}.</>}
                </p>
              )}
            </div>
          )}
          {acao === 'ia' && (
            <div>
              <label className="block text-[12.5px] font-semibold text-[#374151]">Resposta certa
                <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} maxLength={600} rows={3} placeholder="Ex.: Não, só refrigerante e água." data-testid="revisar-resposta"
                  className="mt-[4px] block w-full rounded-[6px] border border-[#D1D5DB] px-[10px] py-[8px] text-[14px] focus:border-[#0688D4] focus:outline-none" />
              </label>
              {instrucao && <p className="mt-[4px] text-[12.5px] font-semibold text-[#B91C1C]" data-testid="revisar-instrucao">Isso parece uma instrução para a IA. Escreva a resposta como o cliente vai ler.</p>}
              {!agenteLigado && <p className="mt-[4px] text-[12px] text-[#5B6472]">Fica guardada no Conhecimento da loja; o Agente de IA usa quando estiver ligado.</p>}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-[8px] border-t border-[#E5E7EB] px-[16px] py-[12px]">
          <span className="mr-auto hidden text-[11.5px] text-[#5B6472] sm:block">← → navegar · 1–4 ação · Enter confirmar</span>
          <button type="button" disabled={!pode} onClick={() => void confirmar()} data-testid="revisar-confirmar"
            className="inline-flex h-[38px] items-center gap-[6px] rounded-[8px] bg-[#047857] px-[16px] text-[13px] font-semibold text-white hover:bg-[#065F46] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#047857]/40">
            {salvando ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : <Check className="h-[15px] w-[15px]" />} Confirmar
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
