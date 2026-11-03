'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarOff, Images, Loader2, Trash2, Upload, X } from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { uploadMidiaCampanha } from '@/lib/queries/campanhas'
import type { Recorrente } from '@/lib/queries/recorrentes'
import { IMAGENS_MAX, ROTULO_RECORRENTE, cabemNaJanela, hojeSaoPaulo, type TipoRecorrente } from '@/lib/mensageria/recorrentes'
import { Ajuda, TextoComVariaveis, formatarDataHora } from './comum'

/**
 * Aba Campanhas (03/11/2026): os três cards de disparo recorrente. Ligado = dispara sozinho na programação.
 * Desenho: docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md
 * Visual nas cores mestre entra na Tarefa 12 do plano; aqui é a estrutura.
 */

/** Ilustrações dos cards (03/11, enviadas pelo dono). Nunca compraram ainda não tem a sua. */
const ILUSTRACAO_CARD: Partial<Record<TipoRecorrente, string>> = {
  recuperacao: '/ilustracoes/campanhas/recuperacao.jpg',
  promocoes: '/ilustracoes/campanhas/promocoes.jpg',
}

const DIAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const DIAS_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
/** Teto padrão da plataforma (0190) — a tela não lê o teto da loja; serve para "cabem ~N". */
const TETO_PADRAO = 150

type Patch = Record<string, unknown>

export function Recorrentes({ restauranteId, onToast }: { restauranteId: string | null; onToast: (tom: 'ok' | 'erro', t: string) => void }) {
  const [cards, setCards] = useState<Recorrente[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [estimativas, setEstimativas] = useState<Partial<Record<TipoRecorrente, number | null>>>({})
  const [galeria, setGaleria] = useState<TipoRecorrente | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    const r = await fetch('/api/admin/campanhas/recorrentes', { cache: 'no-store' }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    if (!r || !r.ok) { setErro(j?.error ?? 'Não foi possível carregar os cards.'); setCards(null); return }
    setCards(j as Recorrente[])
    // Estimativa de público: uma consulta por card, só ao abrir a tela.
    for (const c of j as Recorrente[]) {
      fetch(`/api/admin/campanhas/recorrentes/${c.tipo}/estimativa`, { cache: 'no-store' })
        .then((e) => (e.ok ? e.json() : null))
        .then((v) => setEstimativas((s) => ({ ...s, [c.tipo]: typeof v?.pessoas === 'number' ? v.pessoas : null })))
        .catch(() => setEstimativas((s) => ({ ...s, [c.tipo]: null })))
    }
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  const patch = useCallback(async (tipo: TipoRecorrente, body: Patch, aviso = 'Salvo.'): Promise<boolean> => {
    const r = await fetch(`/api/admin/campanhas/recorrentes/${tipo}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    if (!r || !r.ok) { onToast('erro', j?.error ?? 'Não foi possível salvar.'); return false }
    setCards((lista) => (lista ?? []).map((c) => (c.tipo === tipo ? (j as Recorrente) : c)))
    onToast('ok', aviso)
    return true
  }, [onToast])

  if (erro) {
    return (
      <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]" data-testid="recorrentes-erro">
        {erro} <button type="button" className="ml-2 font-semibold underline" onClick={() => void carregar()}>Tentar de novo</button>
      </div>
    )
  }
  if (!cards) {
    return (
      <div className="grid gap-4 lg:grid-cols-3" data-testid="recorrentes-carregando" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="h-[520px] animate-pulse rounded-[8px] border border-[#e5e7eb] bg-white" />)}
      </div>
    )
  }
  const aberto = galeria ? cards.find((c) => c.tipo === galeria) ?? null : null
  return (
    <div className="space-y-4" data-testid="recorrentes">
      <p className="text-[12.5px] text-[#5b6472]">
        Três campanhas que rodam sozinhas: ligou, o sistema dispara nos dias e horário programados, para quem já falou com a loja no
        WhatsApp, com pelo menos 1 minuto entre mensagens e no máximo uma mensagem por pessoa a cada 2 dias.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {cards.map((c) => (
          <CardRecorrente key={c.tipo} card={c} estimativa={estimativas[c.tipo]} onPatch={patch} onGaleria={() => setGaleria(c.tipo)} />
        ))}
      </div>
      {aberto && <Galeria card={aberto} restauranteId={restauranteId} onPatch={patch} onFechar={() => setGaleria(null)} onToast={onToast} />}
    </div>
  )
}

function CardRecorrente({ card, estimativa, onPatch, onGaleria }: {
  card: Recorrente
  estimativa: number | null | undefined
  onPatch: (tipo: TipoRecorrente, body: Patch, aviso?: string) => Promise<boolean>
  onGaleria: () => void
}) {
  const rotulo = ROTULO_RECORRENTE[card.tipo]
  const [mensagem, setMensagem] = useState(card.mensagem)
  const [hora, setHora] = useState(card.hora)
  const [fim, setFim] = useState(card.janelaFim)
  const [ocupado, setOcupado] = useState(false)
  // Texto vindo do servidor (outro PATCH devolveu o card): acompanha sem perder o que está sendo digitado.
  const ultimoServidor = useRef(card.mensagem)
  if (ultimoServidor.current !== card.mensagem) { ultimoServidor.current = card.mensagem; if (mensagem !== card.mensagem) setMensagem(card.mensagem) }

  const hoje = hojeSaoPaulo()
  const puladoHoje = card.pularAte === hoje
  const cabem = cabemNaJanela(card.hora, card.janelaFim, TETO_PADRAO)
  const proxima = card.ativa && card.proximoDisparoEm ? formatarDataHora(card.proximoDisparoEm, false) : null

  const agir = async (body: Patch, aviso?: string) => { setOcupado(true); try { await onPatch(card.tipo, body, aviso) } finally { setOcupado(false) } }
  const salvarTexto = () => { if (mensagem !== card.mensagem) void agir({ mensagem, incluirLink: card.incluirLink }) }
  const salvarHora = () => { if (hora !== card.hora || fim !== card.janelaFim) void agir({ hora, janelaFim: fim }) }
  const alternarDia = (d: number) => {
    const dias = card.diasSemana.includes(d) ? card.diasSemana.filter((x) => x !== d) : [...card.diasSemana, d].sort((a, b) => a - b)
    void agir({ diasSemana: dias })
  }

  return (
    <section className="campanha-cartao flex flex-col overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-white" data-testid={`card-${card.tipo}`} data-ativa={card.ativa ? '1' : '0'} data-destaque={card.ativa ? '' : undefined}>
      {/* Ilustração do card (pasta public/ilustracoes/campanhas). Sem ilustração: faixa azul com o nome e o estado. */}
      {ILUSTRACAO_CARD[card.tipo] ? (
        <div className="flex aspect-[16/9] items-center justify-center overflow-hidden bg-[#eef3fb]" data-bordo="ilustracao">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ILUSTRACAO_CARD[card.tipo]} alt="" width={640} height={360} loading="lazy" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="relative flex aspect-[16/7] items-end bg-[#112f6b] px-4 pb-3" data-bordo>
          <div className="min-w-0">
            <h3 className="text-[18px] font-semibold text-white">{rotulo.nome}</h3>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 px-4 pt-3">
        {ILUSTRACAO_CARD[card.tipo] && <h3 className="text-[17px] font-semibold text-[#112f6b]">{rotulo.nome}</h3>}
        <span className={`inline-block rounded-[4px] px-2 py-[2px] text-[11px] font-semibold uppercase tracking-[0.04em] ${card.ativa ? 'bg-[#f6bd28] text-[#1f2937]' : 'bg-[#eef0f3] text-[#374151]'}`}>
          {card.ativa ? 'Ligado' : 'Desligado'}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="text-[12.5px] text-[#5b6472]">{rotulo.publico}</p>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="rounded-[4px] bg-[#e0f2fe] px-2 py-[3px] font-semibold text-[#0369a1]" data-testid={`estimativa-${card.tipo}`}>
            {estimativa === undefined ? 'Contando…' : estimativa === null ? 'Público indisponível' : `${estimativa} ${estimativa === 1 ? 'pessoa' : 'pessoas'} hoje`}
          </span>
          <span className="text-[#5b6472]">cabem ~{cabem} por rodada</span>
          <Ajuda texto="Com 60–150 s entre mensagens, a janela escolhida comporta este tanto. Amplie o horário final para alcançar mais pessoas por dia." />
        </div>

        <button type="button" onClick={onGaleria} className="inline-flex h-10 items-center justify-center gap-2 rounded-[5px] border border-[#d6dae1] bg-white px-3 text-[13px] font-semibold text-[#374151] hover:border-[#f6bd28] hover:bg-[#f6bd28] hover:text-[#1f2937]" data-testid={`galeria-${card.tipo}`}>
          <Images className="h-4 w-4" /> Galeria · {card.imagens.length}/{IMAGENS_MAX} {card.imagens.length ? `· próxima: ${(card.imagemIndice % card.imagens.length) + 1}ª` : ''}
        </button>

        <div>
          <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Dias</p>
          <div className="flex gap-1" role="group" aria-label="Dias da semana">
            {DIAS.map((d, i) => (
              <button key={i} type="button" onClick={() => alternarDia(i)} disabled={ocupado} aria-pressed={card.diasSemana.includes(i)} aria-label={DIAS_NOME[i]}
                className={`h-9 w-9 rounded-[5px] border text-[12px] font-semibold ${card.diasSemana.includes(i) ? 'border-[#0688d4] bg-[#0688d4] text-white' : 'border-[#d6dae1] bg-white text-[#5b6472]'}`}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Começa
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} onBlur={salvarHora} className="campanha-data mt-1 w-full" data-testid={`hora-${card.tipo}`} />
          </label>
          <label className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Termina
            <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} onBlur={salvarHora} className="campanha-data mt-1 w-full" data-testid={`fim-${card.tipo}`} />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[#6b7280]">
            Mensagem <span className="font-normal normal-case tracking-normal">{mensagem.length}/4096</span>
          </span>
          <textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} onBlur={salvarTexto} rows={4} maxLength={4096}
            className="w-full rounded-[5px] border border-[#d6dae1] px-3 py-2 text-[13px] text-[#1f2937] focus:border-[#0688d4] focus:outline-none" data-testid={`mensagem-${card.tipo}`} />
          <span className="mt-1 block text-[11.5px] text-[#6b7280]">Variáveis: {'{nome}'}, {'{loja}'}, {'{link}'}{card.tipo === 'recuperacao' ? ', {ultimo_item}' : ''}. O rodapé “Responda SAIR” vai sempre.</span>
        </label>
        <div className="rounded-[5px] bg-[#f6f7f9] px-3 py-2 text-[12.5px] text-[#374151]"><TextoComVariaveis texto={mensagem} /></div>

        <p className="text-[12.5px] text-[#5b6472]" data-testid={`rodada-${card.tipo}`}>
          {card.desligadoMotivo
            ? <span className="inline-flex items-start gap-1.5 rounded-[5px] border border-[#ea1d2c] bg-[#fdecee] px-2.5 py-1.5 font-semibold text-[#b91c1c]"><AlertTriangle className="mt-[1px] h-3.5 w-3.5 flex-shrink-0 text-[#ea1d2c]" /> Desligado pelo freio ({card.desligadoMotivo === 'erro_alto' ? 'muitos erros' : 'muitos pedidos de SAIR'}). Revise a mensagem antes de religar.</span>
            : card.ultimaRodadaMotivo === 'sem_publico'
              ? <span className="inline-block rounded-[4px] bg-[#fff1d6] px-2 py-[3px] font-semibold text-[#1f2937]">Última rodada {formatarDataHora(card.ultimaRodadaEm, false)}: sem público.</span>
            : card.ultimaRodadaMotivo === 'atrasado'
              ? <span className="inline-block rounded-[4px] bg-[#fff1d6] px-2 py-[3px] font-semibold text-[#1f2937]">{formatarDataHora(card.ultimaRodadaEm, false)}: o horário já tinha passado, não disparou. Volta na próxima data programada.</span>
              : card.ultimaRodada && card.ultimaRodadaEm
                ? `Última rodada ${formatarDataHora(card.ultimaRodadaEm, false)}: ${card.ultimaRodada.enviados} de ${card.ultimaRodada.destinatarios} enviados${card.ultimaRodada.erros ? `, ${card.ultimaRodada.erros} com erro` : ''}.`
                : 'Nenhuma rodada ainda.'}
          {proxima && <span className="block">Próxima: {proxima}.</span>}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[#e5e7eb] px-4 py-3">
        <button type="button" role="switch" aria-checked={card.ativa} disabled={ocupado} onClick={() => void agir({ ativa: !card.ativa }, card.ativa ? 'Card desligado.' : 'Card ligado: dispara sozinho na programação.')}
          className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#1f2937]" data-testid={`toggle-${card.tipo}`}>
          <span className={`relative inline-block h-7 w-12 rounded-full border-2 transition-colors ${card.ativa ? 'border-[#f6bd28] bg-[#f6bd28]' : 'border-[#cbd2d9] bg-[#cbd2d9]'}`} aria-hidden>
            <span className={`absolute left-[2px] top-[2px] h-5 w-5 rounded-full shadow transition-transform motion-reduce:transition-none ${card.ativa ? 'translate-x-[20px] bg-[#112f6b]' : 'translate-x-0 bg-white'}`} />
          </span>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : card.ativa ? 'Ligado' : 'Desligado'}
        </button>
        <button type="button" disabled={ocupado || puladoHoje || !card.ativa} onClick={() => void agir({ pularHoje: true }, 'Hoje não dispara. Amanhã volta sozinho.')}
          className="inline-flex h-10 items-center gap-1.5 rounded-[5px] border border-[#112f6b] bg-white px-3 text-[12.5px] font-semibold text-[#112f6b] hover:border-[#f6bd28] hover:bg-[#f6bd28] hover:text-[#1f2937] disabled:opacity-50" data-testid={`pular-${card.tipo}`}>
          <CalendarOff className="h-4 w-4" /> {puladoHoje ? 'Pulado hoje' : 'Pular hoje'}
        </button>
      </div>
    </section>
  )
}

function Galeria({ card, restauranteId, onPatch, onFechar, onToast }: {
  card: Recorrente
  restauranteId: string | null
  onPatch: (tipo: TipoRecorrente, body: Patch, aviso?: string) => Promise<boolean>
  onFechar: () => void
  onToast: (tom: 'ok' | 'erro', t: string) => void
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [enviando, setEnviando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const proxima = card.imagens.length ? card.imagemIndice % card.imagens.length : -1

  async function subir(file: File | undefined) {
    if (!file || !restauranteId) return
    if (card.imagens.length >= IMAGENS_MAX) { onToast('erro', `Até ${IMAGENS_MAX} imagens por card.`); return }
    setEnviando(true)
    try {
      const url = await uploadMidiaCampanha(supabase, restauranteId, file, 'imagem')
      await onPatch(card.tipo, { imagens: [...card.imagens, url] }, 'Imagem adicionada.')
    } catch { onToast('erro', 'Não foi possível enviar a imagem.') } finally { setEnviando(false); if (inputRef.current) inputRef.current.value = '' }
  }
  const remover = (i: number) => void onPatch(card.tipo, { imagens: card.imagens.filter((_, k) => k !== i) }, 'Imagem removida.')

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onFechar} data-testid="galeria">
      <aside role="dialog" aria-label={`Galeria · ${ROTULO_RECORRENTE[card.tipo].nome}`} onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-[420px] flex-col bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-[#e5e7eb] px-4 py-3">
          <div>
            <h3 className="text-[15px] font-semibold text-[#1f2937]">Galeria</h3>
            <p className="text-[12px] text-[#5b6472]">{ROTULO_RECORRENTE[card.tipo].nome} · uma imagem por rodada, em rodízio</p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="grid h-9 w-9 place-items-center rounded-[5px] hover:bg-[#f6f7f9]"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
          {card.imagens.length === 0 && <p className="rounded-[5px] bg-[#f6f7f9] px-3 py-4 text-center text-[13px] text-[#5b6472]">Sem imagens: a mensagem sai só com texto.</p>}
          {card.imagens.map((url, i) => (
            <div key={url} className={`flex items-center gap-3 rounded-[6px] border p-2 ${i === proxima ? 'border-[#0688d4]' : 'border-[#e5e7eb]'}`} data-testid={`imagem-${i}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Imagem ${i + 1}`} width={64} height={64} loading="lazy" className="h-16 w-16 flex-shrink-0 rounded-[4px] object-cover" />
              <div className="min-w-0 flex-1 text-[12.5px]">
                <p className="font-semibold text-[#1f2937]">{i + 1}ª imagem</p>
                {i === proxima && <p className="text-[#0369a1]">Próxima a sair</p>}
              </div>
              <button type="button" onClick={() => remover(i)} aria-label={`Remover imagem ${i + 1}`} className="grid h-9 w-9 place-items-center rounded-[5px] text-[#b91c1c] hover:bg-[#fef2f2]"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <footer className="border-t border-[#e5e7eb] p-4">
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void subir(e.target.files?.[0])} data-testid="galeria-arquivo" />
          <button type="button" disabled={enviando || card.imagens.length >= IMAGENS_MAX} onClick={() => inputRef.current?.click()}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[5px] bg-[#0688d4] text-[13px] font-semibold text-white hover:bg-[#0570ae] disabled:opacity-50">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Adicionar imagem ({card.imagens.length}/{IMAGENS_MAX})
          </button>
        </footer>
      </aside>
    </div>
  )
}
