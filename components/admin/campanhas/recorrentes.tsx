'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Lightbulb, Loader2, Settings2, Trash2, Upload, X } from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { uploadMidiaCampanha } from '@/lib/queries/campanhas'
import type { Recorrente } from '@/lib/queries/recorrentes'
import { IMAGENS_MAX, ROTULO_RECORRENTE, TIPOS_RECORRENTES, cabemNaJanela, pendenciasDoCard, type ImagemCard, type TipoRecorrente } from '@/lib/mensageria/recorrentes'
import { formatarReal } from '@/lib/moeda'
import { Ajuda, formatarDataHora } from './comum'

/**
 * Aba Campanhas (03/11/2026): os três cards de disparo recorrente. Ligado = dispara sozinho na programação.
 * Layout: imagem inteira no topo, faixa de cor do card, resumo em texto e toggle. Configurar abre o modal grande
 * (mensagens, imagens com mensagem própria, dias e horário). Não há "pular hoje": para parar, desliga-se o card.
 * Desenho: docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md
 */

/** Ilustração de cada card (pasta public/ilustracoes/campanhas). */
const ILUSTRACAO: Record<TipoRecorrente, string> = {
  recuperacao: '/ilustracoes/campanhas/recuperacao.jpg',
  nunca_compraram: '/ilustracoes/campanhas/disparos-programados.jpg',
  promocoes: '/ilustracoes/campanhas/promocoes.jpg',
}

/** Cor do card, tirada da ilustração: faixa do topo e toggle ligado. */
const COR: Record<TipoRecorrente, string> = {
  recuperacao: '#2563eb',
  nunca_compraram: '#db2777',
  promocoes: '#7c3aed',
}

const DIAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const DIAS_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
/** Teto padrão da plataforma (0190) — a tela não lê o teto da loja; serve para "cabem ~N". */
const TETO_PADRAO = 150

type Patch = Record<string, unknown>
type OnPatch = (tipo: TipoRecorrente, body: Patch, aviso?: string) => Promise<boolean>

/** "Todos os dias", "nenhum dia", ou "seg, qua e sex". */
function textoDias(dias: number[]): string {
  if (dias.length === 0) return 'nenhum dia'
  if (dias.length === 7) return 'todos os dias'
  const nomes = DIAS_NOME.filter((_, i) => dias.includes(i)).map((n) => n.slice(0, 3))
  return nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
}

export function Recorrentes({ restauranteId, onToast }: { restauranteId: string | null; onToast: (tom: 'ok' | 'erro', t: string) => void }) {
  const [cards, setCards] = useState<Recorrente[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [estimativas, setEstimativas] = useState<Partial<Record<TipoRecorrente, number | null>>>({})
  const [configurando, setConfigurando] = useState<TipoRecorrente | null>(null)
  const [resumo, setResumo] = useState<Resumo | null>(null)

  // Números do topo: uma leitura ao abrir e depois de cada mudança (sem polling — regra de custo).
  const carregarResumo = useCallback(() => {
    fetch('/api/admin/campanhas/recorrentes/resumo', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setResumo(j as Resumo | null))
      .catch(() => setResumo(null))
  }, [])

  const carregar = useCallback(async () => {
    setErro(null)
    const r = await fetch('/api/admin/campanhas/recorrentes', { cache: 'no-store' }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    if (!r || !r.ok) { setErro(j?.error ?? 'Não foi possível carregar os cards.'); setCards(null); return }
    setCards(j as Recorrente[])
    for (const c of j as Recorrente[]) {
      fetch(`/api/admin/campanhas/recorrentes/${c.tipo}/estimativa`, { cache: 'no-store' })
        .then((e) => (e.ok ? e.json() : null))
        .then((v) => setEstimativas((s) => ({ ...s, [c.tipo]: typeof v?.pessoas === 'number' ? v.pessoas : null })))
        .catch(() => setEstimativas((s) => ({ ...s, [c.tipo]: null })))
    }
  }, [])
  useEffect(() => { void carregar(); carregarResumo() }, [carregar, carregarResumo])

  const patch: OnPatch = useCallback(async (tipo, body, aviso = 'Salvo.') => {
    const r = await fetch(`/api/admin/campanhas/recorrentes/${tipo}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    if (!r || !r.ok) { onToast('erro', j?.error ?? 'Não foi possível salvar.'); return false }
    setCards((lista) => (lista ?? []).map((c) => (c.tipo === tipo ? (j as Recorrente) : c)))
    onToast('ok', aviso)
    carregarResumo()
    return true
  }, [onToast, carregarResumo])

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
        {[0, 1, 2].map((i) => <div key={i} className="h-[560px] animate-pulse rounded-[8px] border border-[#e5e7eb] bg-white" />)}
      </div>
    )
  }
  const alvo = configurando ? cards.find((c) => c.tipo === configurando) ?? null : null
  return (
    <div className="flex min-h-full flex-col gap-4" data-testid="recorrentes">
      <Topo resumo={resumo} />
      {/* Altura dos cards (03/11): a mesma da área do gráfico da Visão geral. */}
      <div className="grid items-stretch gap-4 lg:h-[560px] lg:grid-cols-3">
        {TIPOS_RECORRENTES.map((t) => {
          const c = cards.find((x) => x.tipo === t)
          return c ? <CardRecorrente key={t} card={c} estimativa={estimativas[t]} limiteHoje={resumo?.limite_hoje ?? null} onPatch={patch} onConfigurar={() => setConfigurando(t)} /> : null
        })}
      </div>
      {alvo && <ModalConfig card={alvo} restauranteId={restauranteId} onPatch={patch} onFechar={() => setConfigurando(null)} onToast={onToast} />}
    </div>
  )
}

interface Resumo {
  hoje_enviadas: number; hoje_enfileiradas: number; hoje_na_fila: number; limite_hoje: number; proximo_limite: number; dias_para_subir: number
  h16_enviadas: number; h16_perdidas: number; h16_pedidos: number; h16_receita: number
}

const TEXTO_TOPO = 'Três campanhas que rodam sozinhas: ligou, o sistema dispara nos dias e horário programados, para quem já falou com a loja no WhatsApp, com pelo menos 1 minuto entre mensagens e no máximo uma mensagem por pessoa a cada 2 dias. Todo disparo sai com imagem. Para proteger o número, o limite diário dos 3 cards juntos começa em 15 mensagens e sobe 5 a cada 5 dias.'

/** Topo da aba: lâmpada que abre/fecha a explicação; disparos de hoje x limite do aquecimento; últimas 16 h. */
function Topo({ resumo }: { resumo: Resumo | null }) {
  const [aberto, setAberto] = useState(false)
  const n = (v: number | undefined) => (resumo ? String(v ?? 0) : '—')
  return (
    <div className="space-y-2" data-testid="recorrentes-topo">
      <div className="flex flex-wrap items-stretch gap-2">
        <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-controls="recorrentes-explicacao" aria-label={aberto ? 'Fechar a explicação' : 'Como funcionam os cards'}
          className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[6px] bg-[#fdf1c7] text-[#92400e] hover:bg-[#f6bd28] hover:text-[#1f2937]" data-testid="lampada">
          <Lightbulb className="h-5 w-5" />
        </button>
        <div className="flex flex-wrap items-center gap-2 rounded-[6px] border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12.5px] text-[#374151]" data-testid="contador-hoje">
          <span className="font-semibold text-[#112f6b]">Disparos hoje: {n(resumo?.hoje_enviadas)} de {n(resumo?.limite_hoje)}</span>
          {resumo && resumo.hoje_na_fila > 0 && <span className="text-[#5b6472]">· {resumo.hoje_na_fila} na fila</span>}
          {resumo && <span className="text-[#5b6472]">· sobe para {resumo.proximo_limite} em {resumo.dias_para_subir} {resumo.dias_para_subir === 1 ? 'dia' : 'dias'}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[6px] border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12.5px] text-[#374151]" data-testid="contador-16h">
          <span className="font-semibold text-[#1f2937]">Últimas 16 h:</span>
          <span>enviadas <b className="text-[#15803d]">{n(resumo?.h16_enviadas)}</b></span>
          <span>perdidas <b className="text-[#b91c1c]">{n(resumo?.h16_perdidas)}</b></span>
          <span>pedidos <b className="text-[#112f6b]">{n(resumo?.h16_pedidos)}</b></span>
          <span>retorno <b className="text-[#112f6b]">{resumo ? formatarReal(Number(resumo.h16_receita)) : '—'}</b></span>
        </div>
      </div>
      {aberto && <p id="recorrentes-explicacao" className="rounded-[6px] bg-[#f4f7fc] px-3 py-2 text-[12.5px] text-[#374151]" data-testid="recorrentes-explicacao">{TEXTO_TOPO}</p>}
    </div>
  )
}

function CardRecorrente({ card, estimativa, limiteHoje, onPatch, onConfigurar }: {
  card: Recorrente
  estimativa: number | null | undefined
  /** Limite do aquecimento de hoje (3 cards juntos): o "cabem" nunca mostra mais que isso. */
  limiteHoje: number | null
  onPatch: OnPatch
  onConfigurar: () => void
}) {
  const rotulo = ROTULO_RECORRENTE[card.tipo]
  const [ocupado, setOcupado] = useState(false)
  const cabem = Math.min(cabemNaJanela(card.hora, card.janelaFim, TETO_PADRAO), limiteHoje ?? Number.POSITIVE_INFINITY)
  const proxima = card.ativa && card.proximoDisparoEm ? formatarDataHora(card.proximoDisparoEm, false) : null
  const pendencias = pendenciasDoCard(card)
  // Só liga com tudo pronto; desligar é sempre permitido.
  const travado = !card.ativa && pendencias.length > 0

  const agir = async (body: Patch, aviso?: string) => { setOcupado(true); try { await onPatch(card.tipo, body, aviso) } finally { setOcupado(false) } }

  return (
    <section className="campanha-cartao flex h-full flex-col overflow-hidden rounded-[8px] border border-[#e5e7eb] border-t-[6px] bg-white"
      style={{ borderTopColor: COR[card.tipo] }} data-testid={`card-${card.tipo}`} data-ativa={card.ativa ? '1' : '0'}>
      {/* Imagem inteira (sem corte), largura do card. */}
      <div className="flex h-[200px] items-center justify-center bg-[#f4f7fc] p-2" data-bordo="ilustracao">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ILUSTRACAO[card.tipo]} alt="" width={640} height={400} loading="lazy" className="h-full w-full object-contain" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[16px] font-semibold text-[#1f2937]">{rotulo.nome}</h3>
          {/* Ligado: verde (texto e fundo verde claro). Desligado: cinza. */}
          <span className={`rounded-[4px] px-2 py-[3px] text-[11px] font-semibold uppercase tracking-[0.04em] ${card.ativa ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#eef0f3] text-[#4b5563]'}`} data-testid={`status-${card.tipo}`}>
            {card.ativa ? 'Ligado' : 'Desligado'}
          </span>
        </div>
        <p className="text-[12.5px] text-[#5b6472]">{rotulo.publico}</p>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="rounded-[4px] bg-[#e0f2fe] px-2 py-[3px] font-semibold text-[#0369a1]" data-testid={`estimativa-${card.tipo}`}>
            {estimativa === undefined ? 'Contando…' : estimativa === null ? 'Público indisponível' : `${estimativa} ${estimativa === 1 ? 'pessoa' : 'pessoas'} hoje`}
          </span>
          <span className="text-[#5b6472]">cabem ~{cabem} por rodada</span>
          <Ajuda texto="O menor entre o que a janela comporta (60–150 s entre mensagens) e o limite de hoje do aquecimento do número (os 3 cards juntos)." />
        </div>

        <div className="space-y-1 text-[13px] text-[#374151]" data-testid={`resumo-${card.tipo}`}>
          <p><span className="font-semibold">Dias:</span> {textoDias(card.diasSemana)}</p>
          <p><span className="font-semibold">Horário:</span> das {card.hora} às {card.janelaFim}</p>
          <p><span className="font-semibold">Imagens:</span> {card.imagens.length}/{IMAGENS_MAX}{card.imagens.length ? ` · próxima: ${(card.imagemIndice % card.imagens.length) + 1}ª` : ''}</p>
        </div>

        <p className="text-[12.5px] text-[#5b6472]" data-testid={`rodada-${card.tipo}`}>
          {card.desligadoMotivo
            ? <span className="inline-flex items-start gap-1.5 rounded-[5px] border border-[#ea1d2c] bg-[#fdecee] px-2.5 py-1.5 font-semibold text-[#b91c1c]"><AlertTriangle className="mt-[1px] h-3.5 w-3.5 flex-shrink-0 text-[#ea1d2c]" /> Desligado pelo freio ({card.desligadoMotivo === 'erro_alto' ? 'muitos erros' : 'muitos pedidos de SAIR'}). Revise antes de religar.</span>
            : card.ultimaRodadaMotivo === 'sem_publico'
              ? <span>Última rodada {formatarDataHora(card.ultimaRodadaEm, false)}: sem público.</span>
              : card.ultimaRodadaMotivo === 'limite_dia'
                ? <span>{formatarDataHora(card.ultimaRodadaEm, false)}: limite de hoje atingido (aquecimento do número). Volta no próximo dia.</span>
              : card.ultimaRodadaMotivo === 'atrasado'
                ? <span>{formatarDataHora(card.ultimaRodadaEm, false)}: o horário já tinha passado, não disparou.</span>
                : card.ultimaRodada && card.ultimaRodadaEm
                  ? <span>Última rodada {formatarDataHora(card.ultimaRodadaEm, false)}: {card.ultimaRodada.enviados} de {card.ultimaRodada.destinatarios} enviados{card.ultimaRodada.erros ? `, ${card.ultimaRodada.erros} com erro` : ''}.</span>
                  : 'Nenhuma rodada ainda.'}
          {proxima && <span className="block">Próxima: {proxima}.</span>}
        </p>
        {travado && (
          <div className="rounded-[4px] bg-[#fff1d6] px-2.5 py-1.5 text-[12px] text-[#1f2937]" data-testid={`pendencias-${card.tipo}`}>
            <p className="font-semibold">Para ligar, falta:</p>
            <ul className="list-disc pl-4">{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[#e5e7eb] px-4 py-3">
        <button type="button" role="switch" aria-checked={card.ativa} disabled={ocupado || travado} title={travado ? `Para ligar: ${pendencias.join(' ')}` : undefined} onClick={() => void agir({ ativa: !card.ativa }, card.ativa ? 'Card desligado.' : 'Card ligado: dispara sozinho na programação.')}
          className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#1f2937] disabled:cursor-not-allowed disabled:opacity-60" data-testid={`toggle-${card.tipo}`}>
          <span className={`relative inline-block h-7 w-12 rounded-full border-2 transition-colors ${card.ativa ? '' : 'border-[#cbd2d9] bg-[#cbd2d9]'}`} style={card.ativa ? { backgroundColor: COR[card.tipo], borderColor: COR[card.tipo] } : undefined} aria-hidden>
            <span className={`absolute left-[2px] top-[2px] h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${card.ativa ? 'translate-x-[20px]' : 'translate-x-0'}`} />
          </span>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : card.ativa ? 'Ligado' : 'Desligado'}
        </button>
        <button type="button" onClick={onConfigurar} className="inline-flex h-10 items-center gap-1.5 rounded-[5px] border border-[#112f6b] bg-white px-3 text-[12.5px] font-semibold text-[#112f6b] hover:border-[#f6bd28] hover:bg-[#f6bd28] hover:text-[#1f2937]" data-testid={`configurar-${card.tipo}`}>
          <Settings2 className="h-4 w-4" /> Configurar
        </button>
      </div>
    </section>
  )
}

/** Modal grande no centro: ilustração à esquerda; à direita, tudo que o card guarda (editar ou só ver). */
function ModalConfig({ card, restauranteId, onPatch, onFechar, onToast }: {
  card: Recorrente
  restauranteId: string | null
  onPatch: OnPatch
  onFechar: () => void
  onToast: (tom: 'ok' | 'erro', t: string) => void
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const rotulo = ROTULO_RECORRENTE[card.tipo]
  const [mensagem, setMensagem] = useState(card.mensagem)
  const [incluirLink, setIncluirLink] = useState(card.incluirLink)
  const [imagens, setImagens] = useState<ImagemCard[]>(card.imagens)
  const [dias, setDias] = useState<number[]>(card.diasSemana)
  const [hora, setHora] = useState(card.hora)
  const [fim, setFim] = useState(card.janelaFim)
  const [salvando, setSalvando] = useState(false)
  const [enviandoImg, setEnviandoImg] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  async function subir(file: File | undefined) {
    if (!file || !restauranteId) return
    if (imagens.length >= IMAGENS_MAX) { onToast('erro', `Até ${IMAGENS_MAX} imagens por card.`); return }
    setEnviandoImg(true)
    try {
      const url = await uploadMidiaCampanha(supabase, restauranteId, file, 'imagem')
      setImagens((l) => [...l, { url, mensagem: '' }])
    } catch { onToast('erro', 'Não foi possível enviar a imagem.') } finally { setEnviandoImg(false); if (inputRef.current) inputRef.current.value = '' }
  }
  const trocarMensagemDaImagem = (i: number, texto: string) => setImagens((l) => l.map((x, k) => (k === i ? { ...x, mensagem: texto } : x)))
  const remover = (i: number) => setImagens((l) => l.filter((_, k) => k !== i))
  const alternarDia = (d: number) => setDias((l) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d].sort((a, b) => a - b)))

  async function salvar() {
    setErro(null)
    setSalvando(true)
    const ok = await onPatch(card.tipo, { mensagem, incluirLink, imagens, diasSemana: dias, hora, janelaFim: fim }, 'Configuração salva.')
    setSalvando(false)
    if (ok) onFechar()
    else setErro('Não foi possível salvar. Confira os campos e tente de novo.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onFechar} data-testid="modal-config">
      <div role="dialog" aria-modal="true" aria-label={`Configurar ${rotulo.nome}`} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-[10px] bg-white shadow-2xl lg:flex-row" style={{ borderTop: `6px solid ${COR[card.tipo]}` }}>
        {/* Ilustração do card, inteira. */}
        <div className="flex items-center justify-center bg-[#f4f7fc] p-4 lg:w-[360px] lg:flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ILUSTRACAO[card.tipo]} alt="" width={640} height={400} className="max-h-[320px] w-full object-contain" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-[#e5e7eb] px-5 py-3">
            <div>
              <h2 className="text-[17px] font-semibold text-[#1f2937]">{rotulo.nome}</h2>
              <p className="text-[12px] text-[#5b6472]">Cada imagem sai no seu dia do rodízio, com a mensagem dela.</p>
            </div>
            <button type="button" onClick={onFechar} aria-label="Fechar" className="grid h-9 w-9 place-items-center rounded-[5px] hover:bg-[#f6f7f9]"><X className="h-5 w-5" /></button>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <section>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Mensagem padrão</span>
                <textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={3} maxLength={4096} className="w-full rounded-[5px] border border-[#d6dae1] px-3 py-2 text-[13px] text-[#1f2937] focus:border-[#0688d4] focus:outline-none" data-testid="mensagem-padrao" />
              </label>
              <p className="mt-1 text-[11.5px] text-[#6b7280]">Usada quando a imagem não tem mensagem própria. Variáveis: {'{nome}'}, {'{loja}'}, {'{link}'}{card.tipo === 'recuperacao' ? ', {ultimo_item}' : ''}. O rodapé “Responda SAIR” vai sempre.</p>
              <label className="mt-2 flex items-center gap-2 text-[13px] text-[#374151]">
                <input type="checkbox" checked={incluirLink} onChange={(e) => setIncluirLink(e.target.checked)} /> Incluir link do cardápio
              </label>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Imagens ({imagens.length}/{IMAGENS_MAX}) — rodízio diário</span>
                <button type="button" disabled={enviandoImg || imagens.length >= IMAGENS_MAX} onClick={() => inputRef.current?.click()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[5px] bg-[#0688d4] px-3 text-[12.5px] font-semibold text-white hover:bg-[#0570ae] disabled:opacity-50">
                  {enviandoImg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Adicionar imagem
                </button>
                <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void subir(e.target.files?.[0])} data-testid="modal-arquivo" />
              </div>
              {imagens.length === 0 && <p className="rounded-[5px] bg-[#fff1d6] px-3 py-3 text-[13px] text-[#1f2937]">Sem imagem o card não liga. Adicione ao menos 1.</p>}
              <ul className="space-y-3">
                {imagens.map((img, i) => (
                  <li key={`${img.url}-${i}`} className="flex gap-3 rounded-[6px] border border-[#e5e7eb] p-3" data-testid={`modal-imagem-${i}`}>
                    <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-[4px] bg-[#f4f7fc]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt={`Imagem ${i + 1}`} width={96} height={96} loading="lazy" className="h-full w-full object-contain" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center justify-between text-[12.5px] font-semibold text-[#1f2937]">
                        <span>{i + 1}ª imagem {card.imagemIndice % Math.max(imagens.length, 1) === i && card.imagens.length ? <span className="ml-1 rounded-[3px] bg-[#e0f2fe] px-1.5 py-[1px] text-[11px] text-[#0369a1]">próxima</span> : null}</span>
                        <button type="button" onClick={() => remover(i)} aria-label={`Remover imagem ${i + 1}`} className="grid h-8 w-8 place-items-center rounded-[5px] text-[#b91c1c] hover:bg-[#fef2f2]"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <textarea value={img.mensagem} onChange={(e) => trocarMensagemDaImagem(i, e.target.value)} rows={2} maxLength={4096} placeholder="Mensagem desta imagem (vazio = usa a mensagem padrão)…"
                        className="w-full rounded-[5px] border border-[#d6dae1] px-2.5 py-1.5 text-[12.5px] text-[#1f2937] focus:border-[#0688d4] focus:outline-none" data-testid={`modal-msg-${i}`} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Dias de envio</p>
                <div className="flex gap-1" role="group" aria-label="Dias da semana">
                  {DIAS.map((d, i) => (
                    <button key={i} type="button" onClick={() => alternarDia(i)} aria-pressed={dias.includes(i)} aria-label={DIAS_NOME[i]}
                      className={`h-9 w-9 rounded-[5px] border text-[12px] font-semibold ${dias.includes(i) ? 'border-[#0688d4] bg-[#0688d4] text-white' : 'border-[#d6dae1] bg-white text-[#5b6472]'}`}>{d}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Começa
                  <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="campanha-data mt-1 w-full" data-testid="modal-hora" />
                </label>
                <label className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Termina
                  <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} className="campanha-data mt-1 w-full" data-testid="modal-fim" />
                </label>
              </div>
            </section>
            {erro && <p className="rounded-[5px] bg-[#fef2f2] px-3 py-2 text-[13px] font-semibold text-[#b91c1c]">{erro}</p>}
          </div>

          <footer className="flex justify-end gap-2 border-t border-[#e5e7eb] px-5 py-3">
            <button type="button" onClick={onFechar} className="h-10 rounded-[5px] border border-[#d6dae1] bg-white px-4 text-[13px] font-semibold text-[#374151] hover:bg-[#f6f7f9]">Cancelar</button>
            <button type="button" onClick={() => void salvar()} disabled={salvando} data-testid="salvar-config"
              className="inline-flex h-10 items-center gap-2 rounded-[5px] px-4 text-[13px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: COR[card.tipo] }}>
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}

