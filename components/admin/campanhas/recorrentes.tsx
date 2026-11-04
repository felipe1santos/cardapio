'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ImagePlus, Lightbulb, Loader2, Plus, Settings2, Trash2, X } from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { uploadMidiaCampanha } from '@/lib/queries/campanhas'
import type { AnuncioSalvo, Recorrente } from '@/lib/queries/recorrentes'
import {
  ANUNCIOS_MAX, COPIES_MAX, CORES_ANUNCIO, IMAGENS_MAX, IMAGENS_RECUPERACAO, ROTULO_RECORRENTE, TIPOS_RECORRENTES,
  cabemNaJanela, pendenciasDoCardV2, type Anuncio, type TipoRecorrente,
} from '@/lib/mensageria/recorrentes'
import { formatarReal } from '@/lib/moeda'
import { Ajuda, Confirmar, formatarDataHora } from './comum'
import { CopyVisual, EditorMensagem } from './editor-mensagem'
import { DiasSemana, SeletorPublicos, TagsPublicos } from './pecas-disparo'

/**
 * Aba Campanhas: os três cards de disparo recorrente (0245–0248). Ligado = dispara sozinho na programação.
 * - Recuperação: até 5 copies em rodízio e até 6 imagens (grade 3 × 2), uma agenda.
 * - Promoções: até 5 promoções, cada uma com foto, copy, dias e horário próprios.
 * - Disparo personalizado: até 5 anúncios, cada um com cor, público, copy, até 5 imagens em rodízio e agenda.
 * Todas as regras de proteção do número (aquecimento, 60–150 s, 2 dias por pessoa, janela 09:00–21:30) são do banco.
 */

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

/** Teto padrão da plataforma (0190) — a tela não lê o teto da loja; serve para "cabem ~N". */
const TETO_PADRAO = 150

type Patch = Record<string, unknown>
type OnPatch = (tipo: TipoRecorrente, body: Patch, aviso?: string) => Promise<boolean>
type OnAnuncios = (tipo: TipoRecorrente, anuncios: Anuncio[]) => Promise<boolean>
type OnToast = (tom: 'ok' | 'erro', t: string) => void

/** Copies válidas da Recuperação, na ordem do rodízio (sem copies novas, vale a mensagem antiga). */
function copiesDoCard(c: Recorrente): { lista: string[]; atual: number } {
  const lista = c.mensagens.filter((m) => m.trim())
  if (lista.length) return { lista, atual: c.mensagemIndice % lista.length }
  return { lista: c.mensagem.trim() ? [c.mensagem] : [], atual: 0 }
}

export function Recorrentes({ restauranteId, onToast }: { restauranteId: string | null; onToast: OnToast }) {
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

  const contar = useCallback((tipo: TipoRecorrente) => {
    fetch(`/api/admin/campanhas/recorrentes/${tipo}/estimativa`, { cache: 'no-store' })
      .then((e) => (e.ok ? e.json() : null))
      .then((v) => setEstimativas((s) => ({ ...s, [tipo]: typeof v?.pessoas === 'number' ? v.pessoas : null })))
      .catch(() => setEstimativas((s) => ({ ...s, [tipo]: null })))
  }, [])

  const carregar = useCallback(async () => {
    setErro(null)
    const r = await fetch('/api/admin/campanhas/recorrentes', { cache: 'no-store' }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    if (!r || !r.ok) { setErro(j?.error ?? 'Não foi possível carregar os cards.'); setCards(null); return }
    setCards(j as Recorrente[])
    for (const c of j as Recorrente[]) contar(c.tipo)
  }, [contar])
  useEffect(() => { void carregar(); carregarResumo() }, [carregar, carregarResumo])

  const trocarCard = useCallback((novo: Recorrente) => setCards((lista) => (lista ?? []).map((c) => (c.tipo === novo.tipo ? novo : c))), [])

  const patch: OnPatch = useCallback(async (tipo, body, aviso = 'Salvo.') => {
    const r = await fetch(`/api/admin/campanhas/recorrentes/${tipo}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    if (!r || !r.ok) { onToast('erro', j?.error ?? 'Não foi possível salvar.'); return false }
    trocarCard(j as Recorrente)
    onToast('ok', aviso)
    carregarResumo()
    return true
  }, [onToast, carregarResumo, trocarCard])

  const salvarAnuncios: OnAnuncios = useCallback(async (tipo, anuncios) => {
    const r = await fetch(`/api/admin/campanhas/recorrentes/${tipo}/anuncios`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anuncios }) }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    if (!r || !r.ok) { onToast('erro', j?.error ?? 'Não foi possível salvar.'); return false }
    trocarCard(j as Recorrente)
    onToast('ok', 'Configuração salva.')
    contar(tipo)
    return true
  }, [onToast, trocarCard, contar])

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
        {[0, 1, 2].map((i) => <div key={i} className="h-[600px] animate-pulse rounded-[8px] border border-[#e5e7eb] bg-white" />)}
      </div>
    )
  }
  const alvo = configurando ? cards.find((c) => c.tipo === configurando) ?? null : null
  return (
    <div className="flex min-h-full flex-col gap-4" data-testid="recorrentes">
      <Topo resumo={resumo} />
      <div className="grid items-stretch gap-4 lg:h-[600px] lg:grid-cols-3">
        {TIPOS_RECORRENTES.map((t) => {
          const c = cards.find((x) => x.tipo === t)
          return c ? <CardRecorrente key={t} card={c} estimativa={estimativas[t]} limiteHoje={resumo?.limite_hoje ?? null} onPatch={patch} onConfigurar={() => setConfigurando(t)} /> : null
        })}
      </div>
      {alvo && alvo.tipo === 'recuperacao' && <ModalRecuperacao card={alvo} restauranteId={restauranteId} onPatch={patch} onFechar={() => setConfigurando(null)} onToast={onToast} />}
      {alvo && alvo.tipo !== 'recuperacao' && <ModalAnuncios card={alvo} restauranteId={restauranteId} onSalvar={salvarAnuncios} onFechar={() => setConfigurando(null)} onToast={onToast} />}
    </div>
  )
}

interface Resumo {
  hoje_enviadas: number; hoje_enfileiradas: number; hoje_na_fila: number; limite_hoje: number; proximo_limite: number; dias_para_subir: number
  h16_enviadas: number; h16_perdidas: number; h16_pedidos: number; h16_receita: number
}

const TEXTO_TOPO = 'Três campanhas que rodam sozinhas: ligou, o sistema dispara nos dias e horário programados, para quem já conversou com a loja no WhatsApp, com pelo menos 1 minuto entre mensagens e no máximo uma mensagem por pessoa a cada 2 dias. Todo disparo sai com imagem. Para proteger o número, o limite diário dos 3 cards juntos começa em 15 mensagens e sobe 5 a cada 5 dias.'

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

/** Foto que preenche o espaço sem esticar (corta as bordas, mantém a proporção). */
function Foto({ url, alt, className = '' }: { url: string; alt: string; className?: string }) {
  return (
    <span className={`block overflow-hidden rounded-[5px] bg-[#eef1f6] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
    </span>
  )
}

function textoMotivo(a: { ultimaRodadaMotivo: string | null; ultimaRodadaEm: string | null }): string | null {
  if (!a.ultimaRodadaEm || !a.ultimaRodadaMotivo) return null
  const quando = formatarDataHora(a.ultimaRodadaEm, false)
  if (a.ultimaRodadaMotivo === 'sem_publico') return `${quando}: sem público`
  if (a.ultimaRodadaMotivo === 'limite_dia') return `${quando}: limite do dia atingido`
  if (a.ultimaRodadaMotivo === 'atrasado') return `${quando}: horário já tinha passado`
  return `Último envio ${quando}`
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
  const pendencias = pendenciasDoCardV2(card.tipo, card)
  // Só liga com tudo pronto; desligar é sempre permitido.
  const travado = !card.ativa && pendencias.length > 0
  const agir = async (body: Patch, aviso?: string) => { setOcupado(true); try { await onPatch(card.tipo, body, aviso) } finally { setOcupado(false) } }

  return (
    <section className="campanha-cartao flex h-full min-h-[520px] flex-col overflow-hidden rounded-[8px] border border-[#e5e7eb] border-t-[6px] bg-white"
      style={{ borderTopColor: COR[card.tipo] }} data-testid={`card-${card.tipo}`} data-ativa={card.ativa ? '1' : '0'}>
      <div className="flex h-[120px] flex-shrink-0 items-center justify-center bg-[#f4f7fc] p-2" data-bordo="ilustracao">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ILUSTRACAO[card.tipo]} alt="" width={640} height={400} loading="lazy" className="h-full w-full object-contain" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[16px] font-semibold text-[#1f2937]">{rotulo.nome}</h3>
          <span className={`rounded-[4px] px-2 py-[3px] text-[11px] font-semibold uppercase tracking-[0.04em] ${card.ativa ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#eef0f3] text-[#4b5563]'}`} data-testid={`status-${card.tipo}`}>
            {card.ativa ? 'Ligado' : 'Desligado'}
          </span>
        </div>
        <p className="text-[12.5px] text-[#5b6472]">{rotulo.publico}</p>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="rounded-[4px] bg-[#e0f2fe] px-2 py-[3px] font-semibold text-[#0369a1]" data-testid={`estimativa-${card.tipo}`}>
            {estimativa === undefined ? 'Contando…' : estimativa === null ? 'Público indisponível' : `${estimativa} ${estimativa === 1 ? 'pessoa' : 'pessoas'} hoje`}
          </span>
          {card.tipo === 'recuperacao' && (
            <>
              <span className="text-[#5b6472]">cabem ~{Math.min(cabemNaJanela(card.hora, card.janelaFim, TETO_PADRAO), limiteHoje ?? Number.POSITIVE_INFINITY)} por rodada</span>
              <Ajuda texto="O menor entre o que a janela comporta (60–150 s entre mensagens) e o limite de hoje do aquecimento do número (os 3 cards juntos)." />
            </>
          )}
        </div>

        {card.tipo === 'recuperacao' ? <CorpoRecuperacao card={card} /> : <CorpoAnuncios card={card} />}

        {card.desligadoMotivo && (
          <p className="inline-flex items-start gap-1.5 rounded-[5px] border border-[#ea1d2c] bg-[#fdecee] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#b91c1c]" data-testid={`freio-${card.tipo}`}>
            <AlertTriangle className="mt-[1px] h-3.5 w-3.5 flex-shrink-0 text-[#ea1d2c]" /> Desligado pelo freio ({card.desligadoMotivo === 'erro_alto' ? 'muitos erros' : 'muitos pedidos de SAIR'}). Revise antes de religar.
          </p>
        )}
        {travado && (
          <div className="rounded-[4px] bg-[#fff1d6] px-2.5 py-1.5 text-[12px] text-[#1f2937]" data-testid={`pendencias-${card.tipo}`}>
            <p className="font-semibold">Para ligar, falta:</p>
            <ul className="list-disc pl-4">{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-[#e5e7eb] px-4 py-3">
        <button type="button" role="switch" aria-checked={card.ativa} disabled={ocupado || travado} title={travado ? `Para ligar: ${pendencias.join(' ')}` : undefined} onClick={() => void agir({ ativa: !card.ativa }, card.ativa ? 'Card desligado.' : 'Card ligado: dispara sozinho na programação.')}
          className="inline-flex min-h-[44px] items-center gap-2 text-[13px] font-semibold text-[#1f2937] disabled:cursor-not-allowed disabled:opacity-60" data-testid={`toggle-${card.tipo}`}>
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

/** Recuperação: grade de fotos 3 × 2, copy da vez e agenda. */
function CorpoRecuperacao({ card }: { card: Recorrente }) {
  const { lista, atual } = copiesDoCard(card)
  const proxImg = card.imagens.length ? card.imagemIndice % card.imagens.length : -1
  const proxima = card.ativa && card.proximoDisparoEm ? formatarDataHora(card.proximoDisparoEm, false) : null
  const motivo = textoMotivo(card)
  return (
    <div className="space-y-2.5" data-testid="resumo-recuperacao">
      <div className="grid grid-cols-3 gap-1.5" data-testid="grade-recuperacao">
        {Array.from({ length: IMAGENS_RECUPERACAO }, (_, i) => {
          const img = card.imagens[i]
          return img ? (
            <span key={i} className={`relative aspect-square ${i === proxImg ? 'ring-2 ring-[#112f6b] ring-offset-1' : ''} rounded-[5px]`}>
              <Foto url={img.url} alt={`Imagem ${i + 1}`} className="h-full w-full" />
              {i === proxImg && <span className="absolute bottom-1 left-1 rounded-[3px] bg-[#112f6b] px-1.5 py-[1px] text-[10px] font-semibold text-white">próxima</span>}
            </span>
          ) : <span key={i} className="aspect-square rounded-[5px] border border-dashed border-[#d6dae1] bg-[#fafbfc]" aria-hidden />
        })}
      </div>
      <div className="rounded-[5px] border border-[#e5e7eb] bg-[#fafbfc] px-2.5 py-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#6b7280]">
          {lista.length ? `Copy da vez · ${atual + 1} de ${lista.length}` : 'Sem copy'}
        </p>
        {lista.length > 0 && <CopyVisual texto={lista[atual]} className="line-clamp-3 text-[12.5px] leading-[19px] text-[#374151]" />}
      </div>
      <DiasSemana dias={card.diasSemana} mini testId="dias-recuperacao" />
      <p className="text-[12.5px] text-[#374151]"><span className="font-semibold">Horário:</span> das {card.hora} às {card.janelaFim}</p>
      <p className="text-[12px] text-[#5b6472]" data-testid="rodada-recuperacao">
        {card.ultimaRodadaMotivo === 'ok' && card.ultimaRodada && card.ultimaRodadaEm
          ? `Última rodada ${formatarDataHora(card.ultimaRodadaEm, false)}: ${card.ultimaRodada.enviados} de ${card.ultimaRodada.destinatarios} enviados${card.ultimaRodada.erros ? `, ${card.ultimaRodada.erros} com erro` : ''}.`
          : motivo ?? 'Nenhuma rodada ainda.'}
        {proxima && <span className="block">Próxima: {proxima}.</span>}
      </p>
    </div>
  )
}

/** Promoções e Disparo personalizado: lista dos anúncios com foto grande, dias e horário. */
function CorpoAnuncios({ card }: { card: Recorrente }) {
  const promo = card.tipo === 'promocoes'
  const nome = promo ? 'Promoção' : 'Anúncio'
  if (card.anuncios.length === 0) {
    return (
      <p className="rounded-[5px] border border-dashed border-[#d6dae1] px-3 py-4 text-center text-[12.5px] text-[#5b6472]" data-testid={`resumo-${card.tipo}`}>
        Nenhum{promo ? 'a promoção' : ' anúncio'} ainda. Clique em <b>Configurar</b> para criar até {ANUNCIOS_MAX}.
      </p>
    )
  }
  return (
    <ul className="space-y-2" data-testid={`resumo-${card.tipo}`}>
      {card.anuncios.map((a, i) => {
        const proxima = card.ativa && a.proximoDisparoEm ? formatarDataHora(a.proximoDisparoEm, false) : null
        const motivo = textoMotivo(a)
        const incompleto = !a.imagens.length || !a.mensagem.trim() || !a.diasSemana.length || (!promo && !a.publicos.length)
        return (
          <li key={a.id} className="space-y-2 rounded-[6px] border border-[#e5e7eb] p-2" style={promo ? undefined : { borderLeft: `4px solid ${a.cor}` }} data-testid={`item-${card.tipo}-${i}`}>
            <div className="flex gap-3">
            {a.imagens[0]
              ? <Foto url={a.imagens[0]} alt={a.nome || `${nome} ${i + 1}`} className={promo ? 'h-[96px] w-[96px] flex-shrink-0' : 'h-[80px] w-[80px] flex-shrink-0'} />
              : <span className={`grid flex-shrink-0 place-items-center rounded-[5px] border border-dashed border-[#d6dae1] text-[#9ca3af] ${promo ? 'h-[96px] w-[96px]' : 'h-[80px] w-[80px]'}`} aria-label="Sem imagem"><ImagePlus className="h-5 w-5" /></span>}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-[#1f2937]">
                {!promo && <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: a.cor }} aria-hidden />}
                <span className="truncate">{a.nome || `${nome} ${i + 1}`}</span>
                {!promo && a.imagens.length > 1 && <span className="flex-shrink-0 text-[11px] font-normal text-[#6b7280]">· {a.imagens.length} fotos</span>}
              </p>
              {!promo && a.publicos.length > 0 && <TagsPublicos publicos={a.publicos} max={2} />}
              <p className="text-[11.5px] text-[#5b6472]">
                {a.hora}–{a.janelaFim}
                {incompleto ? <span className="ml-1 font-semibold text-[#b45309]">· incompleto, não dispara</span> : proxima ? ` · próxima ${proxima}` : motivo ? ` · ${motivo}` : ''}
              </p>
            </div>
            </div>
            <DiasSemana dias={a.diasSemana} mini />
          </li>
        )
      })}
    </ul>
  )
}

// ── Modais ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Janela grande no centro, com faixa da cor do card, Esc fecha (perguntando se houver mudança). */
function Janela({ titulo, subtitulo, cor, onFechar, rodape, children, testId }: {
  titulo: string; subtitulo: string; cor: string; onFechar: () => void; rodape: React.ReactNode; children: React.ReactNode; testId: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Foco só ao abrir (onFechar muda quando a configuração fica "suja" e não pode roubar o foco do campo).
  useEffect(() => { ref.current?.focus() }, [])
  useEffect(() => {
    // Esc fecha, menos quando outra coisa já tratou (campo do link) ou há uma confirmação aberta por cima.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[data-testid="confirmar"]')) return
      onFechar()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4" onMouseDown={onFechar} data-testid={testId}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo} onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[10px] bg-white shadow-2xl outline-none" style={{ borderTop: `6px solid ${cor}` }}>
        <header className="flex items-center justify-between gap-3 border-b border-[#e5e7eb] px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-[#1f2937]">{titulo}</h2>
            <p className="text-[12px] text-[#5b6472]">{subtitulo}</p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[5px] hover:bg-[#f6f7f9]"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[#e5e7eb] px-5 py-3">{rodape}</footer>
      </div>
    </div>
  )
}

function Rotulo({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#6b7280]">{children}</span>
      {extra}
    </div>
  )
}

function Horario({ hora, fim, onHora, onFim, testId }: { hora: string; fim: string; onHora: (v: string) => void; onFim: (v: string) => void; testId: string }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="text-[12px] font-semibold text-[#5b6472]">Começa
        <input type="time" value={hora} onChange={(e) => onHora(e.target.value)} className="campanha-data mt-1 w-full" data-testid={`${testId}-hora`} />
      </label>
      <label className="text-[12px] font-semibold text-[#5b6472]">Termina
        <input type="time" value={fim} onChange={(e) => onFim(e.target.value)} className="campanha-data mt-1 w-full" data-testid={`${testId}-fim`} />
      </label>
      <p className="col-span-2 text-[11.5px] text-[#6b7280]">Mensagens só entre 09:00 e 21:30, com 1 a 2,5 minutos entre uma e outra.</p>
    </div>
  )
}

function BotoesRodape({ onCancelar, onSalvar, salvando, cor }: { onCancelar: () => void; onSalvar: () => void; salvando: boolean; cor: string }) {
  return (
    <>
      <button type="button" onClick={onCancelar} className="h-10 rounded-[5px] border border-[#d6dae1] bg-white px-4 text-[13px] font-semibold text-[#374151] hover:bg-[#f6f7f9]">Cancelar</button>
      <button type="button" onClick={onSalvar} disabled={salvando} data-testid="salvar-config"
        className="inline-flex h-10 items-center gap-2 rounded-[5px] px-5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: cor }}>
        {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
      </button>
    </>
  )
}

/** Envio de imagem para o Storage da campanha. */
function useSubirImagem(restauranteId: string | null, onToast: OnToast) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [enviando, setEnviando] = useState(false)
  const subir = useCallback(async (file: File | undefined): Promise<string | null> => {
    if (!file || !restauranteId) return null
    setEnviando(true)
    try { return await uploadMidiaCampanha(supabase, restauranteId, file, 'imagem') } catch { onToast('erro', 'Não foi possível enviar a imagem.'); return null } finally { setEnviando(false) }
  }, [supabase, restauranteId, onToast])
  return { subir, enviando }
}

/** Grade de fotos com espaços vazios; o primeiro vazio é o botão de adicionar. */
function GradeFotos({ urls, max, colunas, onAdicionar, onRemover, enviando, destaque, testId }: {
  urls: string[]; max: number; colunas: number; onAdicionar: (f: File | undefined) => void; onRemover: (i: number) => void; enviando: boolean; destaque?: number; testId: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }} data-testid={testId}>
      {Array.from({ length: max }, (_, i) => {
        const u = urls[i]
        if (u) {
          return (
            <div key={`${u}-${i}`} className={`group relative aspect-square rounded-[6px] ${destaque === i ? 'ring-2 ring-[#112f6b] ring-offset-2' : ''}`} data-testid={`${testId}-${i}`}>
              <Foto url={u} alt={`Imagem ${i + 1}`} className="h-full w-full" />
              <span className="absolute left-1 top-1 rounded-[3px] bg-black/60 px-1.5 py-[1px] text-[10.5px] font-semibold text-white">{i + 1}ª{destaque === i ? ' · próxima' : ''}</span>
              <button type="button" onClick={() => onRemover(i)} aria-label={`Remover imagem ${i + 1}`}
                className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-[4px] bg-white/95 text-[#b91c1c] shadow hover:bg-[#fef2f2]"><Trash2 className="h-4 w-4" /></button>
            </div>
          )
        }
        if (i === urls.length) {
          return (
            <button key={`novo-${i}`} type="button" disabled={enviando} onClick={() => input.current?.click()} data-testid={`${testId}-adicionar`}
              className="grid aspect-square place-items-center rounded-[6px] border-2 border-dashed border-[#9fb0d0] bg-[#f4f7fc] text-[12px] font-semibold text-[#112f6b] hover:border-[#112f6b] disabled:opacity-60">
              <span className="flex flex-col items-center gap-1">{enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}{enviando ? 'Enviando…' : 'Adicionar'}</span>
            </button>
          )
        }
        return <span key={`vazio-${i}`} className="aspect-square rounded-[6px] border border-dashed border-[#e1e4ea] bg-[#fafbfc]" aria-hidden />
      })}
      <input ref={input} type="file" accept="image/*" className="hidden" data-testid={`${testId}-arquivo`}
        onChange={(e) => { onAdicionar(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

/** Fecha perguntando antes se houver mudança não salva. */
function useFecharComCuidado(sujo: boolean, onFechar: () => void) {
  const [perguntando, setPerguntando] = useState(false)
  const fechar = useCallback(() => { if (sujo) setPerguntando(true); else onFechar() }, [sujo, onFechar])
  const confirmar = perguntando
    ? <Confirmar titulo="Descartar mudanças?" texto="Você mexeu na configuração e não salvou. Fechar agora perde essas mudanças." botao="Descartar" perigo onCancelar={() => setPerguntando(false)} onConfirmar={onFechar} />
    : null
  return { fechar, confirmar }
}

/** Recuperação: copies em rodízio (mostra a da vez), grade 3 × 2 de imagens, dias e horário. */
function ModalRecuperacao({ card, restauranteId, onPatch, onFechar, onToast }: {
  card: Recorrente; restauranteId: string | null; onPatch: OnPatch; onFechar: () => void; onToast: OnToast
}) {
  // Copies: as gravadas; sem nenhuma, aproveita a mensagem antiga e as mensagens das imagens (nada se perde).
  const inicial = useMemo(() => {
    const salvas = card.mensagens.filter((m) => m.trim())
    const base = salvas.length ? salvas : [...new Set([card.mensagem, ...card.imagens.map((i) => i.mensagem)].filter((m) => m.trim()))]
    return {
      copies: (base.length ? base : ['']).slice(0, COPIES_MAX),
      imagens: card.imagens.map((i) => i.url),
      dias: card.diasSemana, hora: card.hora, fim: card.janelaFim, incluirLink: card.incluirLink,
    }
  }, [card])
  const { atual } = copiesDoCard(card)
  const [copies, setCopies] = useState(inicial.copies)
  const [aberta, setAberta] = useState(Math.min(atual, inicial.copies.length - 1))
  const [imagens, setImagens] = useState(inicial.imagens)
  const [dias, setDias] = useState(inicial.dias)
  const [hora, setHora] = useState(inicial.hora)
  const [fim, setFim] = useState(inicial.fim)
  const [incluirLink, setIncluirLink] = useState(inicial.incluirLink)
  const [salvando, setSalvando] = useState(false)
  const { subir, enviando } = useSubirImagem(restauranteId, onToast)
  const sujo = JSON.stringify({ copies, imagens, dias, hora, fim, incluirLink }) !== JSON.stringify(inicial)
  const { fechar, confirmar } = useFecharComCuidado(sujo, onFechar)
  const cor = COR.recuperacao
  const proxImg = card.imagens.length ? card.imagemIndice % card.imagens.length : -1

  async function adicionar(f: File | undefined) {
    if (imagens.length >= IMAGENS_RECUPERACAO) return
    const url = await subir(f)
    if (url) setImagens((l) => [...l, url])
  }

  async function salvar() {
    const limpas = copies.filter((c) => c.trim())
    setSalvando(true)
    const ok = await onPatch('recuperacao', {
      mensagens: limpas, mensagem: limpas[0] ?? '', incluirLink,
      imagens: imagens.map((url) => ({ url, mensagem: '' })), diasSemana: dias, hora, janelaFim: fim,
    }, 'Configuração salva.')
    setSalvando(false)
    if (ok) onFechar()
  }

  return (
    <Janela titulo="Recuperação de clientes" subtitulo="Quem já pediu e está há 30 dias ou mais sem pedir. Copies e imagens se alternam a cada disparo." cor={cor} onFechar={fechar}
      rodape={<BotoesRodape onCancelar={fechar} onSalvar={() => void salvar()} salvando={salvando} cor={cor} />} testId="modal-config">
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-4">
          <div className="rounded-[8px] border border-[#c9d5ec] bg-[#f4f7fc] p-3" data-testid="copy-da-vez">
            <Rotulo>Copy da vez {card.mensagens.length || card.mensagem.trim() ? `· ${atual + 1}ª` : ''}</Rotulo>
            {copiesDoCard(card).lista.length
              ? <CopyVisual texto={copiesDoCard(card).lista[atual]} className="rounded-[6px] bg-white px-3 py-2 text-[13.5px] leading-[22px] text-[#1f2937] shadow-sm" />
              : <p className="text-[13px] text-[#5b6472]">Nenhuma copy salva ainda.</p>}
          </div>

          <div>
            <Rotulo extra={
              <button type="button" disabled={copies.length >= COPIES_MAX} onClick={() => { setCopies((l) => [...l, '']); setAberta(copies.length) }} data-testid="nova-copy"
                className="inline-flex h-9 items-center gap-1 rounded-[5px] border border-[#112f6b] px-3 text-[12px] font-semibold text-[#112f6b] hover:bg-[#eef2fa] disabled:opacity-50">
                <Plus className="h-4 w-4" /> Nova copy
              </button>
            }>Todas as copies ({copies.length}/{COPIES_MAX}) — alternam a cada disparo</Rotulo>
            <ol className="space-y-2">
              {copies.map((c, i) => (
                <li key={i} className={`rounded-[6px] border ${aberta === i ? 'border-[#112f6b]' : 'border-[#e5e7eb]'}`} data-testid={`copy-${i}`}>
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <button type="button" onClick={() => setAberta(i)} aria-expanded={aberta === i} className="flex min-h-[36px] min-w-0 flex-1 items-center gap-2 text-left">
                      <span className="text-[12.5px] font-semibold text-[#1f2937]">Copy {i + 1}</span>
                      {card.mensagens.length > 0 && i === atual && <span className="rounded-[3px] bg-[#112f6b] px-1.5 py-[1px] text-[10.5px] font-semibold text-white">da vez</span>}
                      {aberta !== i && (c.trim()
                        ? <CopyVisual texto={c.replace(/\s+/g, ' ')} className="line-clamp-1 min-w-0 flex-1 text-[12px] text-[#5b6472]" />
                        : <span className="text-[12px] text-[#6b7280]">vazia</span>)}
                    </button>
                    {copies.length > 1 && (
                      <button type="button" onClick={() => { setCopies((l) => l.filter((_, k) => k !== i)); setAberta(0) }} aria-label={`Remover copy ${i + 1}`}
                        className="grid h-9 w-9 place-items-center rounded-[5px] text-[#b91c1c] hover:bg-[#fef2f2]"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                  {aberta === i && (
                    <div className="px-3 pb-3">
                      <EditorMensagem valor={c} onChange={(t) => setCopies((l) => l.map((x, k) => (k === i ? t : x)))} rotulo={`Copy ${i + 1}`} testId={`copy-editor-${i}`} ultimoItem />
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <label className="mt-3 flex min-h-[36px] items-center gap-2 text-[13px] text-[#374151]">
              <input type="checkbox" checked={incluirLink} onChange={(e) => setIncluirLink(e.target.checked)} className="h-4 w-4" /> Incluir link do cardápio (se a copy não tiver, vai no fim)
            </label>
          </div>
        </section>

        <section className="space-y-5">
          <div>
            <Rotulo>Imagens ({imagens.length}/{IMAGENS_RECUPERACAO})</Rotulo>
            <GradeFotos urls={imagens} max={IMAGENS_RECUPERACAO} colunas={3} enviando={enviando} destaque={proxImg} testId="fotos-recuperacao"
              onAdicionar={(f) => void adicionar(f)} onRemover={(i) => setImagens((l) => l.filter((_, k) => k !== i))} />
            {imagens.length === 0 && <p className="mt-2 rounded-[5px] bg-[#fff1d6] px-3 py-2 text-[12.5px] text-[#1f2937]">Sem imagem o card não liga. Adicione ao menos 1.</p>}
          </div>
          <div>
            <Rotulo>Dias de envio</Rotulo>
            <DiasSemana dias={dias} onChange={setDias} testId="modal-dias" />
          </div>
          <div>
            <Rotulo>Horário</Rotulo>
            <Horario hora={hora} fim={fim} onHora={setHora} onFim={setFim} testId="modal" />
          </div>
        </section>
      </div>
      {confirmar}
    </Janela>
  )
}

interface AnuncioEdit extends Anuncio { chave: string }

let seq = 0
const novaChave = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`

function paraEdit(a: AnuncioSalvo): AnuncioEdit {
  return { chave: a.id, id: a.id, nome: a.nome, cor: a.cor, mensagem: a.mensagem, imagens: a.imagens, diasSemana: a.diasSemana, hora: a.hora, janelaFim: a.janelaFim, publicos: a.publicos }
}

/** O anúncio como vai para a API (sem a chave local da tela). */
function semChave(a: AnuncioEdit): Anuncio {
  return { id: a.id, nome: a.nome, cor: a.cor, mensagem: a.mensagem, imagens: a.imagens, diasSemana: a.diasSemana, hora: a.hora, janelaFim: a.janelaFim, publicos: a.publicos }
}

function faltaNoAnuncio(tipo: TipoRecorrente, a: Anuncio): string[] {
  const f: string[] = []
  if (!a.imagens.length) f.push('imagem')
  if (!a.mensagem.trim()) f.push('copy')
  if (!a.diasSemana.length) f.push('dia')
  if (tipo === 'nunca_compraram' && !a.publicos.length) f.push('público')
  return f
}

/** Promoções e Disparo personalizado: lista de até 5 à esquerda; o escolhido à direita, com tudo dele. */
function ModalAnuncios({ card, restauranteId, onSalvar, onFechar, onToast }: {
  card: Recorrente; restauranteId: string | null; onSalvar: OnAnuncios; onFechar: () => void; onToast: OnToast
}) {
  const promo = card.tipo === 'promocoes'
  const nome = promo ? 'Promoção' : 'Anúncio'
  const cor = COR[card.tipo]
  const inicial = useMemo(() => card.anuncios.map(paraEdit), [card])
  const [lista, setLista] = useState<AnuncioEdit[]>(inicial)
  const [sel, setSel] = useState(0)
  const [salvando, setSalvando] = useState(false)
  const [removendo, setRemovendo] = useState<number | null>(null)
  const [tamanhos, setTamanhos] = useState<Record<string, number> | null>(null)
  const { subir, enviando } = useSubirImagem(restauranteId, onToast)
  const sujo = JSON.stringify(lista.map(semChave)) !== JSON.stringify(inicial.map(semChave))
  const { fechar, confirmar } = useFecharComCuidado(sujo, onFechar)
  const atual = lista[sel] ?? null

  // Tamanho de cada público: uma leitura ao abrir (só no personalizado).
  useEffect(() => {
    if (promo) return
    let vivo = true
    fetch('/api/admin/campanhas/recorrentes/publicos', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setTamanhos(j && typeof j === 'object' ? (j as Record<string, number>) : {}) })
      .catch(() => { if (vivo) setTamanhos({}) })
    return () => { vivo = false }
  }, [promo])

  const mudar = (campos: Partial<Anuncio>) => setLista((l) => l.map((a, i) => (i === sel ? { ...a, ...campos } : a)))

  function criar() {
    if (lista.length >= ANUNCIOS_MAX) return
    const usadas = new Set(lista.map((a) => a.cor))
    const corLivre = CORES_ANUNCIO.find((c) => !usadas.has(c)) ?? CORES_ANUNCIO[lista.length % CORES_ANUNCIO.length]
    setLista((l) => [...l, { chave: novaChave(), nome: '', cor: corLivre, mensagem: ROTULO_RECORRENTE[card.tipo].mensagemPadrao, imagens: [], diasSemana: [], hora: '17:00', janelaFim: '19:00', publicos: [] }])
    setSel(lista.length)
  }

  function remover(i: number) {
    setLista((l) => l.filter((_, k) => k !== i))
    setSel((s) => Math.max(0, s >= i ? s - 1 : s))
    setRemovendo(null)
  }

  async function adicionarFoto(f: File | undefined) {
    if (!atual) return
    const url = await subir(f)
    if (!url) return
    mudar({ imagens: promo ? [url] : [...atual.imagens, url].slice(0, IMAGENS_MAX) })
  }

  async function salvar() {
    setSalvando(true)
    const ok = await onSalvar(card.tipo, lista.map(semChave))
    setSalvando(false)
    if (ok) onFechar()
  }

  const incompletos = lista.map((a, i) => ({ i, falta: faltaNoAnuncio(card.tipo, a) })).filter((x) => x.falta.length)

  return (
    <Janela titulo={ROTULO_RECORRENTE[card.tipo].nome} cor={cor} onFechar={fechar} testId="modal-config"
      subtitulo={promo ? 'Cada promoção tem a sua foto, copy, dias e horário. Promoções no mesmo dia saem no mesmo dia, para pessoas diferentes.' : 'Cada anúncio tem a sua cor, público, copy, até 5 imagens (alternam a cada disparo), dias e horário.'}
      rodape={
        <>
          {incompletos.length > 0 && (
            <p className="mr-auto text-[12px] text-[#92400e]" data-testid="aviso-incompletos">
              {incompletos.map((x) => `${lista[x.i].nome || `${nome} ${x.i + 1}`}: falta ${x.falta.join(', ')}`).join(' · ')} — {incompletos.length === 1 ? 'não dispara' : 'não disparam'} até completar.
            </p>
          )}
          <BotoesRodape onCancelar={fechar} onSalvar={() => void salvar()} salvando={salvando} cor={cor} />
        </>
      }>
      <div className="flex min-h-[520px] flex-col lg:flex-row">
        <nav className="flex gap-2 overflow-x-auto border-b border-[#e5e7eb] bg-[#fafbfc] p-3 lg:w-[270px] lg:flex-shrink-0 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r" aria-label={`${nome}s`}>
          {lista.map((a, i) => {
            const falta = faltaNoAnuncio(card.tipo, a)
            return (
              <button key={a.chave} type="button" onClick={() => setSel(i)} aria-current={i === sel ? 'true' : undefined} data-testid={`aba-anuncio-${i}`}
                className={`flex min-w-[200px] items-center gap-2.5 rounded-[6px] border p-2 text-left lg:min-w-0 ${i === sel ? 'border-[#112f6b] bg-white shadow-sm' : 'border-transparent hover:bg-white'}`}
                style={!promo ? { borderLeft: `4px solid ${a.cor}` } : undefined}>
                {a.imagens[0] ? <Foto url={a.imagens[0]} alt="" className="h-12 w-12 flex-shrink-0" /> : <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-[5px] border border-dashed border-[#d6dae1] text-[#9ca3af]"><ImagePlus className="h-4 w-4" /></span>}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-[#1f2937]">{a.nome || `${nome} ${i + 1}`}</span>
                  <span className={`block text-[11.5px] ${falta.length ? 'text-[#b45309]' : 'text-[#15803d]'}`}>{falta.length ? `Falta: ${falta.join(', ')}` : 'Pronto'}</span>
                </span>
              </button>
            )
          })}
          <button type="button" onClick={criar} disabled={lista.length >= ANUNCIOS_MAX} data-testid="novo-anuncio"
            className="flex min-h-[48px] min-w-[160px] items-center justify-center gap-1.5 rounded-[6px] border-2 border-dashed border-[#9fb0d0] px-3 text-[12.5px] font-semibold text-[#112f6b] hover:border-[#112f6b] hover:bg-white disabled:opacity-50 lg:min-w-0">
            <Plus className="h-4 w-4" /> {promo ? 'Nova promoção' : 'Novo anúncio'} ({lista.length}/{ANUNCIOS_MAX})
          </button>
        </nav>

        {!atual ? (
          <div className="grid flex-1 place-items-center p-8 text-center text-[13px] text-[#5b6472]">
            <p>Nenhum{promo ? 'a promoção' : ' anúncio'} ainda. Clique em <b>{promo ? 'Nova promoção' : 'Novo anúncio'}</b> para criar.</p>
          </div>
        ) : (
          <div key={atual.chave} className="grid min-w-0 flex-1 gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_340px]" data-testid="anuncio-form">
            <section className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[200px] flex-1 text-[12px] font-semibold text-[#5b6472]">Nome {promo ? 'da promoção' : 'do anúncio'} (só para você)
                  <input value={atual.nome} maxLength={60} onChange={(e) => mudar({ nome: e.target.value })} placeholder={`${nome} ${sel + 1}`} data-testid="anuncio-nome"
                    className="mt-1 block h-10 w-full rounded-[5px] border border-[#d6dae1] px-3 text-[13px] font-normal text-[#1f2937] focus:border-[#0688d4] focus:outline-none" />
                </label>
                <button type="button" onClick={() => setRemovendo(sel)} data-testid="remover-anuncio"
                  className="inline-flex h-10 items-center gap-1.5 rounded-[5px] border border-[#fecaca] px-3 text-[12.5px] font-semibold text-[#b91c1c] hover:bg-[#fef2f2]">
                  <Trash2 className="h-4 w-4" /> Excluir
                </button>
              </div>
              {!promo && (
                <div>
                  <Rotulo>Cor do anúncio</Rotulo>
                  <div className="flex gap-2" role="radiogroup" aria-label="Cor do anúncio">
                    {CORES_ANUNCIO.map((c) => {
                      const dono = lista.findIndex((a, i) => i !== sel && a.cor === c)
                      return (
                        <button key={c} type="button" role="radio" aria-checked={atual.cor === c} disabled={dono >= 0} onClick={() => mudar({ cor: c })}
                          aria-label={dono >= 0 ? `Cor em uso no ${lista[dono].nome || `anúncio ${dono + 1}`}` : `Cor ${c}`} title={dono >= 0 ? `Em uso no ${lista[dono].nome || `anúncio ${dono + 1}`}` : undefined}
                          className={`h-10 w-10 rounded-[6px] disabled:cursor-not-allowed disabled:opacity-30 ${atual.cor === c ? 'ring-2 ring-[#1f2937] ring-offset-2' : ''}`} style={{ backgroundColor: c }} />
                      )
                    })}
                  </div>
                </div>
              )}
              <div>
                <Rotulo>Copy</Rotulo>
                <EditorMensagem valor={atual.mensagem} onChange={(t) => mudar({ mensagem: t })} rotulo={`Copy ${nome.toLowerCase()} ${sel + 1}`} testId="anuncio-copy" linhas={5} />
              </div>
              {!promo && (
                <div>
                  <Rotulo>Público (pode escolher vários)</Rotulo>
                  <SeletorPublicos selecionados={atual.publicos} onChange={(p) => mudar({ publicos: p })} tamanhos={tamanhos} testId="publicos" />
                </div>
              )}
            </section>

            <section className="space-y-5">
              <div>
                <Rotulo>{promo ? 'Foto da promoção' : `Imagens (${atual.imagens.length}/${IMAGENS_MAX}) — alternam`}</Rotulo>
                <div className={promo ? 'max-w-[240px]' : undefined}>
                  <GradeFotos urls={atual.imagens} max={promo ? 1 : IMAGENS_MAX} colunas={promo ? 1 : 3} enviando={enviando} testId="fotos-anuncio"
                    onAdicionar={(f) => void adicionarFoto(f)} onRemover={(i) => mudar({ imagens: atual.imagens.filter((_, k) => k !== i) })} />
                </div>
              </div>
              <div>
                <Rotulo>Dias de envio</Rotulo>
                <DiasSemana dias={atual.diasSemana} onChange={(d) => mudar({ diasSemana: d })} testId="anuncio-dias" />
              </div>
              <div>
                <Rotulo>Horário</Rotulo>
                <Horario hora={atual.hora} fim={atual.janelaFim} onHora={(v) => mudar({ hora: v })} onFim={(v) => mudar({ janelaFim: v })} testId="anuncio" />
              </div>
            </section>
          </div>
        )}
      </div>
      {removendo !== null && (
        <Confirmar titulo={`Excluir ${nome.toLowerCase()}?`} texto={`"${lista[removendo]?.nome || `${nome} ${removendo + 1}`}" sai da lista. Só vale depois de Salvar.`} botao="Excluir" perigo
          onCancelar={() => setRemovendo(null)} onConfirmar={() => remover(removendo)} />
      )}
      {confirmar}
    </Janela>
  )
}
