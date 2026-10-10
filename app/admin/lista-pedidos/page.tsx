'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRealtimeComFallback } from '@/lib/realtime-fallback'
import QRCode from 'qrcode'
import { Bike, Clock, Users, ClipboardCheck, Phone, User, MapPin, Plus, Wallet, Zap, RefreshCw, Volume2, VolumeX, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { Capacete } from '@/components/icones/capacete'
import { avisoDePedidosParados, pedidoParado, tempoParado } from '@/lib/pedido-parado'
import { TopBar } from '@/components/layout/topbar'
import { CartaoNumero, TONS_PAINEL, type TomPainel } from '@/components/admin/cartao-numero'
import { ICONES } from '@/lib/icones-painel'
import { mascararTelefoneBR, telefoneCompleto } from '@/lib/telefone'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RouteMap } from '@/components/maps/route-map'
import { buscarLojaNoMapa, type LojaDoMapa } from '@/lib/maps/loja-mapa'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { notificarPedido } from '@/lib/notificar'
import { nextaEntregaAtiva, nextaEventoTexto } from '@/lib/nexta-eventos'
import { listarNextaEntregas, type NextaEntregaLinha } from '@/lib/queries/nexta'
import {
  atualizarPerfilEntregador,
  criarEntregador,
  definirStatusEntregador,
  enderecoCompletoPedido,
  enviarFotoEntregador,
  listarEntregadores,
  listarPedidosConcluidos,
  listarPedidosLogistica,
  entregarPedidoEmRota,
  type Entregador,
  type Pedido,
  type StatusEntregador,
} from '@/lib/queries/pedidos'
import { cancelarPedidoRequest } from '@/lib/cancelamento'
import { CaixaTurnoGaveta } from '@/components/logistica/caixa-turno'
import { AcessoEntregador, DinheiroComMotoboys } from '@/components/logistica/motoboy-financeiro'
import { buscarFluxoLoja } from '@/lib/queries/ajustes'
import { formatarReal } from '@/lib/moeda'
import { AlertaTroco } from '@/components/pedidos/info-pagamento'
import { rotuloForma } from '@/lib/pdv-pagamento'
import { PainelPedido } from '@/components/pedidos/painel-pedido'
import { solicitarReimpressao } from '@/lib/queries/impressao'
import { useCoordenadasPedidos } from '@/lib/mapa/cliente'

type Tab = 'pedidos' | 'entregadores'
type Periodo = 'hoje' | 'ontem' | '7dias' | 'personalizado'

/** Chave do localStorage que lembra se o operador recolheu os cards de resumo. */
const RESUMO_KEY = 'menuzia:logistica:resumo'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pedidos', label: 'Pedidos' },
  { id: 'entregadores', label: 'Entregadores' },
]

/**
 * Aba do query param (`?tab=`), pra deep-link e pra não perder o lugar num refresh.
 * Lida só depois da montagem — ler `window` no estado inicial quebraria a hidratação.
 */
function tabDaUrl(): Tab | null {
  const valor = new URLSearchParams(window.location.search).get('tab')
  // Links antigos da Logística (?tab=despacho / ?tab=concluidos) caem na aba Pedidos.
  if (valor === 'entregadores') return 'entregadores'
  return valor ? 'pedidos' : null
}

function inicioDoDiaISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
}

/** Período da lista de finalizados (item 58): [desde, até) no horário local. */
function intervaloDoPeriodo(p: Periodo, de: string, ate: string): { desde: string; ate?: string } | null {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const dia = (n: number) => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d.toISOString() }
  if (p === 'hoje') return { desde: dia(0) }
  if (p === 'ontem') return { desde: dia(-1), ate: dia(0) }
  if (p === '7dias') return { desde: dia(-6) }
  if (!de) return null
  const ini = new Date(`${de}T00:00:00`)
  const fim = ate ? new Date(`${ate}T00:00:00`) : new Date(ini)
  fim.setDate(fim.getDate() + 1)
  return Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime()) ? null : { desde: ini.toISOString(), ate: fim.toISOString() }
}
const ROTULO_PERIODO: Record<Periodo, string> = { hoje: 'Hoje', ontem: 'Ontem', '7dias': 'Últimos 7 dias', personalizado: 'Personalizado' }

// Milhar com ponto ("R$ 4.088,00"): função única do painel, ver lib/moeda.ts.
const brl = formatarReal


const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

function tempoRelativo(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora mesmo'
  if (min === 1) return 'há 1 min'
  if (min < 60) return `há ${min} min`
  return `há ${Math.floor(min / 60)}h`
}

function endereco(p: Pedido) {
  // A referência entra aqui porque é aqui que o operador lê o endereço antes de
  // despachar — é o dado que evita a ligação "não achei a casa".
  const partes = [p.enderecoBairro, p.enderecoRua && `${p.enderecoRua}, ${p.enderecoNumero}`, p.enderecoReferencia].filter(Boolean)
  return partes.join(' · ') || 'Entrega'
}


// Painel do lojista Nexta — não tem deep link por entrega (o id que eles usam na UI deles
// é interno e nunca chega até nós), então o atalho abre o monitor geral.
const NEXTA_PAINEL_URL = 'https://nexta-est.flutterflow.app/monitor'

/** Etapas mostradas na timeline do card "Com o Nexta", na ordem do ciclo. */
const TIMELINE_NEXTA: { status: string; label: string }[] = [
  { status: 'PENDING', label: 'Aguardando aceite' },
  { status: 'ACCEPTED', label: 'Aceito' },
  { status: 'PICKUP_ONGOING', label: 'Indo coletar' },
  { status: 'ARRIVED_AT_MERCHANT', label: 'Na loja' },
]

/**
 * Alerta sonoro dos marcos do Nexta. Mesmo padrão de Web Audio do Kanban
 * (`playNewOrderSound`), com timbres distintos por tipo de evento:
 * subindo = entregador vindo buscar; descendo = deu problema.
 */
function playNextaSound(tipo: 'indo_coletar' | 'aviso' | 'erro') {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    const beep = (freq: number, start: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + 0.25)
    }
    const notas: Record<typeof tipo, [number, number]> = {
      indo_coletar: [660, 990], // sobe: o motoboy está vindo
      aviso: [880, 880],
      erro: [660, 440], // desce: rejeição/cancelamento
    }
    const [a, b] = notas[tipo]
    beep(a, 0)
    beep(b, 0.18)
    setTimeout(() => ctx.close(), 600)
  } catch {
    /* navegador sem suporte a Web Audio — silencioso */
  }
}

/* ── Peças da tela ─────────────────────────────────────────────────────────
   Mesmo vocabulário do Dashboard: cartão branco de borda fina, cabeçalho
   branco com ícone em bolha colorida (a cor diz o assunto, não pinta o bloco
   inteiro) e estados vazios com uma frase que diz o que fazer. */

function CabecalhoSecao({
  icone,
  tom,
  titulo,
  contador,
  descricao,
  acoes,
  antes,
  fixo = false,
}: {
  icone: React.ReactNode
  tom: TomPainel
  titulo: string
  contador?: number
  descricao?: React.ReactNode
  acoes?: React.ReactNode
  /** Controle à esquerda do ícone (o "selecionar todos"). */
  antes?: React.ReactNode
  /** Gruda no topo da coluna rolável. */
  fixo?: boolean
}) {
  const t = TONS_PAINEL[tom]
  return (
    <div className={`flex-shrink-0 border-b border-[var(--adm-borda)] bg-white px-4 py-3 ${fixo ? 'sticky top-0 z-20 rounded-t-[6px]' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {antes}
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: t.fundo, color: t.cor }}>
            {icone}
          </span>
          <h3 className="truncate text-[14px] font-semibold text-[var(--adm-texto-forte)]">{titulo}</h3>
          {contador !== undefined && (
            <span className="rounded-full bg-[#f1f2f4] px-2 py-[1px] text-[11px] font-semibold text-[var(--adm-texto-medio)]">{contador}</span>
          )}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {descricao && <p className="mt-1.5 text-[12px] text-[var(--adm-texto-suave)]">{descricao}</p>}
    </div>
  )
}

function Vazio({ icone, titulo, texto }: { icone: React.ReactNode; titulo: string; texto: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
      <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-[#f1f2f4] text-[var(--adm-texto-suave)]">{icone}</span>
      <p className="text-[13.5px] font-semibold text-[var(--adm-texto)]">{titulo}</p>
      <p className="max-w-[320px] text-[12px] text-[var(--adm-texto-suave)]">{texto}</p>
    </div>
  )
}

/** Foto do entregador ou a inicial num círculo com cor estável pelo nome. */
const CORES_AVATAR = ['#A855F7', '#F97316', '#10B981', '#3B82F6', '#F59E0B', '#EF4444']
function Avatar({ nome, fotoUrl, tamanho = 40 }: { nome: string; fotoUrl: string | null; tamanho?: number }) {
  if (fotoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fotoUrl}
        alt={nome}
        loading="lazy"
        decoding="async"
        width={tamanho}
        height={tamanho}
        className="flex-shrink-0 rounded-full border border-[var(--adm-borda)] object-cover"
        style={{ width: tamanho, height: tamanho }}
      />
    )
  }
  const cor = CORES_AVATAR[[...nome].reduce((s, c) => s + c.charCodeAt(0), 0) % CORES_AVATAR.length]
  return (
    <span
      className="flex flex-shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: tamanho, height: tamanho, backgroundColor: cor, fontSize: Math.round(tamanho * 0.42) }}
      aria-hidden="true"
    >
      {nome.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** Número, cliente, endereço e pagamento de um pedido — igual em todas as listas. */
function ResumoPedido({ order, selo, extra }: { order: Pedido; selo?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold tabular-nums">#{order.numero}</span>
        <span className="truncate text-[13.5px] font-semibold text-[var(--adm-texto)]">{order.clienteNome || 'Cliente'}</span>
        {selo}
        <span className="text-[11px] text-[var(--adm-texto-suave)]">{tempoRelativo(order.criadoEm)}</span>
      </div>
      <div className="mt-1 flex items-start gap-1.5 text-[12.5px] text-[var(--adm-texto-medio)]">
        <MapPin className="mt-[2px] h-3.5 w-3.5 flex-shrink-0 text-[var(--adm-texto-suave)]" />
        <span>{endereco(order)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={order.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{rotuloForma(order.formaPagamento, order.cartaoTipo)}</Badge>
        {order.formaPagamento === 'dinheiro' && order.trocoPara !== null && <Badge tone="paused">Troco para {brl(order.trocoPara)}</Badge>}
        {!order.pago && <Badge tone="paused">{order.tipo === 'entrega' ? 'A receber' : 'A pagar'}</Badge>}
        <span className="text-[13.5px] font-semibold tabular-nums text-price-text">{brl(order.total)}</span>
        {extra}
      </div>
      <div className="mt-1.5"><AlertaTroco p={order} /></div>
    </>
  )
}

const TOM_STATUS: Record<StatusEntregador, { fundo: string; texto: string; ponto: string }> = {
  online: { fundo: '#DCFCE7', texto: '#15803D', ponto: '#10B981' },
  ocupado: { fundo: '#FFEDD5', texto: '#C2410C', ponto: '#F97316' },
  offline: { fundo: '#F1F2F4', texto: '#4B5563', ponto: '#9CA3AF' },
}

/**
 * Cartão do entregador: quem é, com o que roda, se está na rua e o que dá pra
 * fazer com ele — tudo com rótulo. Antes eram quatro ícones de 14px sem nome.
 */
function CartaoEntregador({
  driver,
  mudandoStatus,
  onStatus,
  onPerfil,
  onLocalizacao,
  onAcesso,
}: {
  driver: Entregador
  mudandoStatus: boolean
  onStatus: (s: StatusEntregador) => void
  onPerfil: () => void
  onLocalizacao: () => void
  onAcesso: () => void
}) {
  const tom = TOM_STATUS[driver.status]
  const veiculo = [driver.veiculo, driver.placa].filter(Boolean).join(' · ')
  const acao = 'inline-flex flex-1 items-center justify-center gap-1.5 rounded-[4px] border border-[var(--adm-borda)] bg-white px-2 py-2 text-[12px] font-semibold text-[var(--adm-texto-medio)] transition-colors hover:border-[var(--adm-azul)] hover:text-[var(--adm-azul)] disabled:cursor-not-allowed disabled:opacity-50'
  return (
    <div className="flex flex-col rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
      <div className="flex items-start gap-3 p-4">
        <div className="relative">
          <Avatar nome={driver.nome} fotoUrl={driver.fotoUrl} tamanho={44} />
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white"
            style={{ backgroundColor: driver.online ? '#10B981' : '#D1D5DB' }}
            title={driver.online ? 'Com o app aberto agora' : 'App fechado'}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[14px] font-semibold text-[var(--adm-texto)]">
              {driver.nome}
              {driver.desativado && <span className="ml-1.5 rounded-[3px] bg-danger-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger" data-testid="entregador-desativado">Desativado</span>}
            </p>
            <select
              value={driver.status}
              disabled={mudandoStatus}
              onChange={(e) => onStatus(e.target.value as StatusEntregador)}
              aria-label={`Situação de ${driver.nome}`}
              className="flex-shrink-0 cursor-pointer rounded-full border-0 py-1 pl-2.5 pr-6 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--adm-azul)]"
              style={{ backgroundColor: tom.fundo, color: tom.texto }}
            >
              <option value="online">Disponível</option>
              <option value="ocupado">Ocupado</option>
              <option value="offline">Offline</option>
            </select>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-[var(--adm-texto-suave)]">
            {veiculo || <span className="italic">Veículo não informado</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className={`font-semibold ${driver.emRota ? 'text-[#9333EA]' : 'text-[var(--adm-texto-medio)]'}`}>
              {driver.emRota ? `${driver.emRota} entrega${driver.emRota > 1 ? 's' : ''} em rota` : 'Sem entregas agora'}
            </span>
            {driver.telefone ? (
              <a href={`tel:${driver.telefone}`} className="inline-flex items-center gap-1 text-[var(--adm-texto-medio)] hover:text-[var(--adm-azul)]">
                <Phone className="h-3.5 w-3.5" /> {driver.telefone}
              </a>
            ) : (
              <span className="text-[var(--adm-texto-suave)]">Sem telefone</span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-auto flex gap-2 border-t border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] p-3">
        <button onClick={onAcesso} className={acao} title="Link e QR para o motoboy abrir o app sem senha">
          <ExternalLink className="h-3.5 w-3.5" /> Acesso
        </button>
        <button
          onClick={onLocalizacao}
          className={acao}
          title={driver.online ? 'Ver onde ele está agora' : driver.localizacao ? 'Ver a última localização conhecida' : 'Localização ainda não disponível'}
        >
          <MapPin className={`h-3.5 w-3.5 ${driver.online ? 'text-[#10B981]' : ''}`} /> Mapa
        </button>
        <button onClick={onPerfil} className={acao}>
          <User className="h-3.5 w-3.5" /> Editar
        </button>
      </div>
    </div>
  )
}

const CLASSE_CAMPO =
  'h-[38px] w-full rounded-[4px] border border-[var(--adm-borda)] bg-white px-2.5 font-sans text-[13px] outline-none transition-colors focus:border-[var(--adm-azul)]'

function CampoEntregador({ rotulo, obrigatorio, dica, children }: { rotulo: string; obrigatorio?: boolean; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-[var(--adm-texto-forte)]">
        {rotulo}
        {obrigatorio && <span className="text-danger"> *</span>}
      </span>
      {children}
      {dica && <span className="mt-1 block text-[11px] text-[var(--adm-texto-suave)]">{dica}</span>}
    </label>
  )
}

/**
 * "Pedidos" (item 58, antes "Logística"): indicadores do dia, a lista de pedidos finalizados
 * (entregues, retirados e cancelados) com busca, status, valor e período, e o detalhe ao clicar;
 * "Em rota agora" (marcar entregue / não entregue, Nexta) e a aba Entregadores de sempre. O
 * despacho saiu daqui para o Kanban (botão "Despachar" e despacho pelo card).
 */
export default function PedidosFinalizadosPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  // Onde a loja fica: o mapa do entregador abre nela (antes: Fortaleza fixo até a rota chegar).
  const [lojaMapa, setLojaMapa] = useState<LojaDoMapa>('carregando')
  useEffect(() => {
    if (!restauranteId) return
    let vivo = true
    void buscarLojaNoMapa(supabase, restauranteId).then((l) => { if (vivo) setLojaMapa(l) }).catch(() => { if (vivo) setLojaMapa(null) })
    return () => { vivo = false }
  }, [supabase, restauranteId])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [orders, setOrders] = useState<Pedido[]>([])
  const [concluidos, setConcluidos] = useState<Pedido[]>([])
  const [drivers, setDrivers] = useState<Entregador[]>([])
  const [closingOpen, setClosingOpen] = useState(false)

  const [linkDriver, setLinkDriver] = useState<Entregador | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [locationDriverId, setLocationDriverId] = useState<string | null>(null)
  const [profileDriverId, setProfileDriverId] = useState<string | null>(null)
  const [perfilForm, setPerfilForm] = useState({ nome: '', telefone: '', veiculo: '', placa: '', fotoUrl: '' })
  const [perfilSaving, setPerfilSaving] = useState(false)
  const [perfilSaved, setPerfilSaved] = useState(false)
  const [perfilError, setPerfilError] = useState<string | null>(null)
  const [uploadingFoto, setUploadingFoto] = useState(false)
  const fotoInputRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<Tab>('pedidos')
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [periodoDe, setPeriodoDe] = useState('')
  const [periodoAte, setPeriodoAte] = useState('')
  const [lista, setLista] = useState<Pedido[]>([])
  const [carregandoLista, setCarregandoLista] = useState(false)
  const [detalhe, setDetalhe] = useState<Pedido | null>(null)
  const [editandoPag, setEditandoPag] = useState(false)
  const [reimpEstado, setReimpEstado] = useState<'idle' | 'enviando' | 'ok' | 'erro'>('idle')
  // Começa visível sempre: o valor salvo só entra depois da montagem, senão o primeiro
  // render do servidor e o do cliente divergem e a hidratação quebra.
  const [resumoVisivel, setResumoVisivel] = useState(true)

  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'entregue' | 'cancelado'>('todos')
  const [filtroValorMin, setFiltroValorMin] = useState('')
  const [filtroValorMax, setFiltroValorMax] = useState('')

  const [novoDriver, setNovoDriver] = useState({ nome: '', telefone: '', veiculo: '', placa: '' })
  const [statusMudando, setStatusMudando] = useState<string | null>(null)
  // Entrega sem entregador (0079). null enquanto a config não chegou.
  const [semEntregador, setSemEntregador] = useState<boolean | null>(null)
  const [addingDriver, setAddingDriver] = useState(false)
  const [addDriverOpen, setAddDriverOpen] = useState(false)


  const [nextaAtivo, setNextaAtivo] = useState(false)
  const [nextaEntregas, setNextaEntregas] = useState<NextaEntregaLinha[]>([])
  const [nextaBusy, setNextaBusy] = useState<string | null>(null)
  const [cancelandoNexta, setCancelandoNexta] = useState<string | null>(null)
  const [somNexta, setSomNexta] = useState(false)
  // Status já visto por entrega — é a comparação com ele que decide se toca o som.
  const statusNextaVisto = useRef<Map<string, string>>(new Map())

  const refetchAgora = useCallback(
    async (id: string) => {
      try {
        const [pedidos, entregadores, finalizados, entregasNexta] = await Promise.all([
          listarPedidosLogistica(supabase, id),
          listarEntregadores(supabase, id),
          listarPedidosConcluidos(supabase, id, inicioDoDiaISO()),
          // Janela curta: além das entregas em andamento, precisamos das recém-recusadas
          // pra avisar o lojista por que aquele pedido voltou pra fila.
          listarNextaEntregas(supabase, id, new Date(Date.now() - 12 * 3600 * 1000).toISOString()).catch(() => []),
        ])
        setOrders(pedidos)
        setDrivers(entregadores)
        setConcluidos(finalizados)
        setNextaEntregas(entregasNexta)
      } catch {
        setError('Não foi possível carregar a logística.')
      }
    },
    [supabase]
  )

  // Rajada de eventos (heartbeat de cada motoboy a 30s, webhook do Nexta, a própria
  // atribuição) disparava uma recarga completa por evento, várias ao mesmo tempo — a
  // tela ficava lenta. Agora roda no máximo uma por vez e junta o que chegar no meio
  // numa única recarga ao final.
  const recarregando = useRef(false)
  const recargaPendente = useRef<string | null>(null)
  const refetch = useCallback(
    async (id: string): Promise<void> => {
      if (recarregando.current) {
        recargaPendente.current = id
        return
      }
      recarregando.current = true
      try {
        await refetchAgora(id)
      } finally {
        recarregando.current = false
        const proxima = recargaPendente.current
        recargaPendente.current = null
        if (proxima) void refetch(proxima)
      }
    },
    [refetchAgora]
  )

  useEffect(() => {
    let active = true
    ;(async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (!active) return
      if (!id) {
        setError('Não encontramos uma loja vinculada ao seu usuário.')
        setLoading(false)
        return
      }
      setRestauranteId(id)
      await Promise.all([
        refetch(id),
        buscarFluxoLoja(supabase, id)
          .then((f) => active && setSemEntregador(f.entregaSemEntregador))
          .catch(() => active && setSemEntregador(false)),
      ])
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [supabase, refetch])

  // Canal Realtime num effect próprio: o cleanup retornado por uma função
  // async nunca é chamado pelo React, então o canal ficava aberto pra sempre
  // a cada remontagem da página, vazando conexões Realtime ao longo do turno.
  // Eventos do Nexta chegam por webhook e viram UPDATE em `nexta_entregas` — é
  // assim que "entregador a caminho" aparece na tela sem ninguém dar refresh.
  const { intervaloMs } = useRealtimeComFallback({
    supabase,
    canal: restauranteId ? `logistica-${restauranteId}` : null,
    tabelas: useMemo(() => {
      const filtro = restauranteId ? `restaurante_id=eq.${restauranteId}` : undefined
      return [{ tabela: 'pedidos', filtro }, { tabela: 'entregadores', filtro }, { tabela: 'nexta_entregas', filtro }]
    }, [restauranteId]),
    aoEvento: useCallback(() => { if (restauranteId) refetch(restauranteId) }, [refetch, restauranteId]),
    aoSincronizar: useCallback(() => { if (restauranteId) refetch(restauranteId) }, [refetch, restauranteId]),
  })

  useEffect(() => {
    const inicial = tabDaUrl()
    if (inicial) setTab(inicial)
  }, [])

  // A config do Nexta mora numa tabela sem RLS pra `authenticated` (guarda o segredo),
  // então quem responde é o route handler.
  useEffect(() => {
    fetch('/api/admin/nexta/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: { ativo: boolean } | null } | null) => setNextaAtivo(Boolean(d?.config?.ativo)))
      .catch(() => setNextaAtivo(false))
  }, [])

  function irParaTab(proxima: Tab) {
    setTab(proxima)
    const url = new URL(window.location.href)
    if (proxima === 'pedidos') url.searchParams.delete('tab')
    else url.searchParams.set('tab', proxima)
    // replaceState em vez de router.push: trocar de aba não merece entrada no histórico
    // e não pode remontar a página (mataria o realtime).
    window.history.replaceState(null, '', url)
  }

  // Refetch periódico — "motoboy online" depende do horário atual, então precisa
  // recalcular mesmo sem eventos de realtime (ex.: motoboy fechou o app). Com o
  // canal saudável vira heartbeat; se ele cair, volta ao ritmo agressivo.
  useEffect(() => {
    if (!restauranteId) return
    const interval = setInterval(() => refetch(restauranteId), intervaloMs)
    return () => clearInterval(interval)
  }, [restauranteId, refetch, intervaloMs])

  const intervalo = useMemo(() => intervaloDoPeriodo(periodo, periodoDe, periodoAte), [periodo, periodoDe, periodoAte])
  useEffect(() => {
    if (!restauranteId) return
    if (periodo === 'hoje') { setLista(concluidos); return }
    if (!intervalo) { setLista([]); return }
    let vivo = true
    setCarregandoLista(true)
    listarPedidosConcluidos(supabase, restauranteId, intervalo.desde, intervalo.ate)
      .then((l) => { if (vivo) setLista(l) })
      .catch(() => { if (vivo) setError('Não foi possível carregar os pedidos do período.') })
      .finally(() => { if (vivo) setCarregandoLista(false) })
    return () => { vivo = false }
  }, [supabase, restauranteId, periodo, intervalo, concluidos])
  useEffect(() => { setReimpEstado('idle'); setEditandoPag(false) }, [detalhe?.id])

  const available = drivers.filter((d) => d.status === 'online' && !d.desativado)
  /** Prontos sem entregador próprio — inclui os que já foram mandados pro Nexta. */
  const unassignedTodos = useMemo(() => orders.filter((o) => o.status === 'pronto' && !o.entregadorId), [orders])
  const inRoute = orders.filter((o) => o.status === 'em_rota')
  // Pedido aberto há mais de 12h: um dia alguém não marcou "entregue" e ele ficou.
  const avisoParados = avisoDePedidosParados(orders, Date.now())

  // Entrega ativa do Nexta por pedido — é o que tira o pedido da fila de despacho.
  const nextaPorPedido = useMemo(() => {
    const mapa = new Map<string, NextaEntregaLinha>()
    for (const e of nextaEntregas) if (nextaEntregaAtiva(e.status)) mapa.set(e.pedidoId, e)
    return mapa
  }, [nextaEntregas])

  /** Pedidos "Com o Nexta": solicitados e ainda não coletados (depois disso viram "Em rota"). */
  const comNexta = useMemo(
    () => unassignedTodos.filter((o) => nextaPorPedido.has(o.id)),
    [unassignedTodos, nextaPorPedido]
  )

  useEffect(() => {
    setSomNexta(localStorage.getItem('menuzia:logistica-som') !== 'off')
  }, [])

  useEffect(() => {
    setResumoVisivel(localStorage.getItem(RESUMO_KEY) !== 'oculto')
  }, [])

  function alternarResumo() {
    setResumoVisivel((atual) => {
      const proximo = !atual
      localStorage.setItem(RESUMO_KEY, proximo ? 'visivel' : 'oculto')
      return proximo
    })
  }

  function alternarSomNexta() {
    setSomNexta((atual) => {
      const proximo = !atual
      localStorage.setItem('menuzia:logistica-som', proximo ? 'on' : 'off')
      return proximo
    })
  }

  // Som nos marcos do Nexta. Compara com o status já visto pra tocar uma vez por
  // transição — os eventos de movimento repetem sozinhos e apitariam sem parar.
  useEffect(() => {
    const vistos = statusNextaVisto.current
    const primeiraCarga = vistos.size === 0
    for (const e of nextaEntregas) {
      const antes = vistos.get(e.id)
      vistos.set(e.id, e.status)
      // Na primeira carga da página tudo é "novo" — apitar aqui seria só barulho.
      if (primeiraCarga || antes === undefined || antes === e.status || !somNexta) continue
      if (e.status === 'PICKUP_ONGOING') playNextaSound('indo_coletar')
      else if (e.status === 'ARRIVED_AT_MERCHANT' || e.status === 'RETURNING_TO_MERCHANT' || e.status === 'RETURNED_TO_MERCHANT') playNextaSound('aviso')
      else if (e.status === 'REJECTED' || e.status === 'CANCELLED') playNextaSound('erro')
    }
  }, [nextaEntregas, somNexta])

  async function cancelarNexta(orderId: string) {
    setNextaBusy(orderId)
    setCancelandoNexta(null)
    try {
      const res = await fetch('/api/admin/nexta/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId: orderId, reason: 'PROBLEM_AT_MERCHANT', action: 'CANCEL_DELIVERY' }),
      })
      const data = (await res.json()) as { error?: string; additionalCharges?: boolean }
      if (!res.ok) throw new Error(data.error ?? 'Falha ao cancelar no Nexta.')
      if (data.additionalCharges) setError('Corrida cancelada — o Nexta informou que este cancelamento tem cobrança adicional.')
      if (restauranteId) await refetch(restauranteId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cancelar no Nexta.')
    } finally {
      setNextaBusy(null)
    }
  }

  async function reconciliarNexta(orderId: string) {
    setNextaBusy(orderId)
    try {
      await fetch('/api/admin/nexta/reconciliar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId: orderId }),
      })
      if (restauranteId) await refetch(restauranteId)
    } catch {
      setError('Não foi possível atualizar a entrega no Nexta.')
    } finally {
      setNextaBusy(null)
    }
  }
  const locationDriver = drivers.find((d) => d.id === locationDriverId) ?? null
  const profileDriver = drivers.find((d) => d.id === profileDriverId) ?? null
  // Mapa da localização: coordenadas pelo servidor (gravadas no pedido), uma vez por pedido; o navegador nunca
  // geocodifica (docs/REGRAS-DE-CUSTO.md). Tudo memorizado: o mapa não re-renderiza com a página.
  const locationPedidos = useMemo(
    () => (locationDriver ? orders.filter((o) => o.entregadorId === locationDriver.id && o.status === 'em_rota') : []),
    [locationDriver, orders]
  )
  const locationCoords = useCoordenadasPedidos(useMemo(() => locationPedidos.map((o) => o.id), [locationPedidos]))
  const locationDriverStops = useMemo(() => locationPedidos.map((o, i) => {
    const c = locationCoords.get(o.id) ?? null
    return { id: o.id, numero: i + 1, address: enderecoCompletoPedido(o), lat: c?.lat ?? null, lng: c?.lng ?? null }
  }), [locationPedidos, locationCoords])
  const locationOrigem = useMemo(
    () => (locationDriver?.localizacao ? { lat: locationDriver.localizacao.lat, lng: locationDriver.localizacao.lng } : null),
    [locationDriver?.localizacao?.lat, locationDriver?.localizacao?.lng] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const concluidosFiltrados = useMemo(() => {
    const busca = filtroBusca.trim().toLowerCase()
    const min = filtroValorMin.trim() === '' ? null : Number(filtroValorMin.replace(/\./g, '').replace(',', '.'))
    const max = filtroValorMax.trim() === '' ? null : Number(filtroValorMax.replace(/\./g, '').replace(',', '.'))
    return lista.filter((o) => {
      if (filtroStatus !== 'todos' && o.status !== filtroStatus) return false
      if (busca && !(o.clienteNome.toLowerCase().includes(busca) || o.enderecoBairro.toLowerCase().includes(busca))) return false
      if (min !== null && Number.isFinite(min) && o.total < min) return false
      if (max !== null && Number.isFinite(max) && o.total > max) return false
      return true
    })
  }, [lista, filtroBusca, filtroStatus, filtroValorMin, filtroValorMax])

  const filtrosAtivos = filtroBusca !== '' || filtroStatus !== 'todos' || filtroValorMin !== '' || filtroValorMax !== ''

  function limparFiltros() {
    setFiltroBusca('')
    setFiltroStatus('todos')
    setFiltroValorMin('')
    setFiltroValorMax('')
  }

  function driverName(id: string | null) {
    if (!id) return '—'
    return drivers.find((d) => d.id === id)?.nome ?? '—'
  }

  function portalUrl(driver: Entregador) {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/entregador/${driver.token}`
  }

  useEffect(() => {
    if (!linkDriver) {
      setQrDataUrl(null)
      return
    }
    setLinkCopied(false)
    QRCode.toDataURL(portalUrl(linkDriver), { width: 240, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [linkDriver])

  async function copiarLink() {
    if (!linkDriver) return
    try {
      await navigator.clipboard.writeText(portalUrl(linkDriver))
      setLinkCopied(true)
    } catch {
      setLinkCopied(false)
    }
  }

  useEffect(() => {
    if (!profileDriver) return
    setPerfilForm({
      nome: profileDriver.nome,
      telefone: profileDriver.telefone,
      veiculo: profileDriver.veiculo,
      placa: profileDriver.placa,
      fotoUrl: profileDriver.fotoUrl ?? '',
    })
    setPerfilSaved(false)
    setPerfilError(null)
  }, [profileDriver])

  async function handleFotoPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !profileDriver || !restauranteId) return
    setUploadingFoto(true)
    setPerfilError(null)
    try {
      const url = await enviarFotoEntregador(supabase, restauranteId, profileDriver.id, file)
      setPerfilForm((f) => ({ ...f, fotoUrl: url }))
      setPerfilSaved(false)
    } catch {
      setPerfilError('Não foi possível enviar a foto.')
    } finally {
      setUploadingFoto(false)
    }
  }

  async function savePerfil() {
    if (!profileDriver || !restauranteId || !perfilForm.nome.trim()) return
    setPerfilSaving(true)
    setPerfilError(null)
    try {
      await atualizarPerfilEntregador(supabase, profileDriver.id, {
        nome: perfilForm.nome.trim(),
        telefone: perfilForm.telefone.trim(),
        veiculo: perfilForm.veiculo.trim(),
        placa: perfilForm.placa.trim(),
        fotoUrl: perfilForm.fotoUrl.trim() || null,
      })
      await refetch(restauranteId)
      setPerfilSaved(true)
    } catch {
      setPerfilError('Não foi possível salvar o perfil.')
    } finally {
      setPerfilSaving(false)
    }
  }

  async function deliver(orderId: string) {
    setOrders((prev) => prev.filter((o) => o.id !== orderId))
    try {
      // Já entregue pelo entregador: não avisa o cliente de novo.
      if (await entregarPedidoEmRota(supabase, orderId)) notificarPedido(orderId, 'entregue')
      if (restauranteId) refetch(restauranteId)
    } catch {
      setError('Não foi possível marcar como entregue.')
      if (restauranteId) refetch(restauranteId)
    }
  }

  async function naoEntregue(orderId: string) {
    setOrders((prev) => prev.filter((o) => o.id !== orderId))
    try {
      await cancelarPedidoRequest(orderId, 'nao_entregue', '')
      notificarPedido(orderId, 'cancelado')
      if (restauranteId) refetch(restauranteId)
    } catch {
      setError('Não foi possível marcar como não entregue.')
      if (restauranteId) refetch(restauranteId)
    }
  }

  function abrirNovoEntregador() {
    setNovoDriver({ nome: '', telefone: '', veiculo: '', placa: '' })
    setAddDriverOpen(true)
  }

  async function addDriver() {
    if (!restauranteId || !novoDriver.nome.trim()) return
    setAddingDriver(true)
    try {
      const nome = novoDriver.nome.trim()
      const telefone = novoDriver.telefone.trim()
      const veiculo = novoDriver.veiculo.trim()
      const placa = novoDriver.placa.trim()
      const criado = await criarEntregador(supabase, restauranteId, nome, telefone, { veiculo, placa })
      setAddDriverOpen(false)
      await refetch(restauranteId)
      // Próximo passo natural: mandar o acesso pro motoboy.
      setLinkDriver({
        id: criado.id,
        token: criado.token,
        nome,
        telefone,
        veiculo,
        placa,
        status: 'online',
        emRota: 0,
        online: false,
        localizacao: null,
        fotoUrl: null,
      })
    } catch {
      setError('Não foi possível cadastrar o entregador.')
    } finally {
      setAddingDriver(false)
    }
  }

  async function mudarStatus(id: string, status: StatusEntregador) {
    setStatusMudando(id)
    setDrivers((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)))
    try {
      await definirStatusEntregador(supabase, id, status)
    } catch {
      setError('Não foi possível mudar a situação do entregador.')
      if (restauranteId) refetch(restauranteId)
    } finally {
      setStatusMudando(null)
    }
  }

  // Turno de caixa (0114): a gaveta carrega e grava pela /api/admin/caixa.
  function openClosing() {
    setClosingOpen(true)
  }

  if (loading) {
    return (
      <>
        <TopBar title="Pedidos" breadcrumb="Pedidos finalizados e entregadores" />
        <div className="flex flex-1 items-center justify-center p-5 text-sm text-text-subtle">Carregando pedidos…</div>
      </>
    )
  }

  return (
    <>
      <TopBar title="Pedidos" breadcrumb="Pedidos finalizados e entregadores" />

      <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {semEntregador && (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2 rounded-[6px] border-[0.8px] border-[#fcd34d] bg-warn-bg px-3.5 py-2.5 text-[12.8px] text-[#92400E]" data-testid="aviso-sem-entregador">
            <Bike className="h-4 w-4 flex-shrink-0" /> A loja entrega <b>sem entregador</b>: o pedido sai pelo Painel de Pedidos (“Saiu p/ entrega”). Para voltar a usar entregadores: Painel de Pedidos › ⋯.
          </div>
        )}
        {error && (
          <div className="flex flex-shrink-0 items-center justify-between gap-3 rounded-[6px] border-[0.8px] border-danger bg-danger-bg px-3.5 py-2.5 text-[12.8px] font-semibold text-danger">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-[12px] font-semibold underline-offset-2 hover:underline">
              Dispensar
            </button>
          </div>
        )}

        {/* Entrega que ninguém fechou fica aqui para sempre e some do acompanhamento do
            cliente. O sistema não encerra nada sozinho — cobra (lib/pedido-parado.ts). */}
        {avisoParados && (
          <div role="status" className="flex flex-shrink-0 items-start gap-2 rounded-[6px] border-[0.8px] border-[#fcd34d] bg-warn-bg px-3.5 py-2.5 text-[12.8px] font-medium text-[var(--adm-laranja)]">
            <Clock className="mt-[1px] h-4 w-4 flex-shrink-0" strokeWidth={2.2} />
            <span>{avisoParados}</span>
          </div>
        )}

        {resumoVisivel && (
          <div className="grid flex-shrink-0 grid-cols-1 gap-3 sm:grid-cols-3" data-testid="indicadores-pedidos">
            <CartaoNumero
              icone={ICONES.concluido}
              tom="verde"
              rotulo="Entregues hoje"
              valor={concluidos.filter((o) => o.status === 'entregue').length}
              detalhe={brl(concluidos.filter((o) => o.status === 'entregue').reduce((s, o) => s + o.total, 0))}
            />
            <CartaoNumero
              icone={ICONES.logistica}
              tom="roxo"
              rotulo="Em rota agora"
              valor={inRoute.length + comNexta.length}
              detalhe={comNexta.length ? `${comNexta.length} com o Nexta` : 'com seus entregadores'}
            />
            <CartaoNumero
              icone={ICONES.entregador}
              tom="azul"
              rotulo="Entregadores disponíveis"
              valor={available.length}
              detalhe={`de ${drivers.length} cadastrado${drivers.length === 1 ? '' : 's'}`}
            />
          </div>
        )}

        {/* Abas em linha, sublinhado na cor de marca — o mesmo desenho das tabelas
            do Dashboard, sem o bloco vermelho de antes. */}
        <div className="flex flex-shrink-0 items-end justify-between gap-3 border-b border-[var(--adm-borda)]">
          <div className="flex gap-1 max-lg:overflow-x-auto max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden" role="tablist">
            {TABS.map((t) => {
              const contador = t.id === 'pedidos' ? lista.length : drivers.length
              const ativa = tab === t.id
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={ativa}
                  onClick={() => irParaTab(t.id)}
                  className={[
                    '-mb-px flex flex-shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 pb-2.5 pt-1.5 text-[13.5px] transition-colors',
                    ativa
                      ? 'border-[var(--adm-azul)] font-semibold text-[var(--adm-texto)]'
                      : 'border-transparent font-medium text-[var(--adm-texto-suave)] hover:text-[var(--adm-texto)]',
                  ].join(' ')}
                >
                  {t.label}
                  {contador > 0 && (
                    <span
                      className={`min-w-[20px] rounded-full px-1.5 py-[1px] text-center text-[11px] font-semibold ${
                        ativa ? 'bg-[var(--adm-azul)] text-white' : 'bg-[#f1f2f4] text-[var(--adm-texto-medio)]'
                      }`}
                    >
                      {contador}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="mb-1.5 flex flex-shrink-0 items-center gap-2">
          <button
            onClick={alternarResumo}
            className="hidden flex-shrink-0 items-center gap-1 rounded-[4px] px-2 py-1 text-[12px] font-medium text-[var(--adm-texto-suave)] transition-colors hover:bg-[var(--adm-hover)] hover:text-[var(--adm-texto)] sm:inline-flex"
          >
            {resumoVisivel ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {resumoVisivel ? 'Ocultar resumo' : 'Mostrar resumo'}
          </button>
          </div>
        </div>

        {/* Financeiro (0136): dinheiro com cada motoboy e troco a entregar no despacho. Só com o módulo ligado. */}
        <DinheiroComMotoboys compacto />
        <div className="flex flex-col">
          {/* Entregadores */}
          {tab === 'entregadores' && (
          <section className="flex flex-col rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
            <CabecalhoSecao
              icone={<Users className="h-4 w-4" strokeWidth={2.2} />}
              tom="cinza"
              titulo="Entregadores"
              contador={drivers.length}
              descricao="Cadastre a equipe, envie o link de acesso e acompanhe quem está na rua."
              acoes={
                <>
                  <Button variant="outline" onClick={openClosing} className="gap-1.5">
                    <Wallet className="h-4 w-4" /> Fechamento de caixa
                  </Button>
                  <Button variant="primary" onClick={abrirNovoEntregador} className="gap-1.5">
                    <Plus className="h-4 w-4" /> Novo entregador
                  </Button>
                </>
              }
            />
            <div className="grid auto-rows-min grid-cols-1 gap-3 bg-[var(--adm-bg)] p-4 md:grid-cols-2 2xl:grid-cols-3">
              {drivers.length === 0 && (
                <div className="col-span-full flex flex-col items-center gap-2 rounded-[6px] border border-dashed border-[var(--adm-borda-forte)] bg-white px-6 py-12 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F3E8FF] text-[#9333EA]">
                    <Bike className="h-6 w-6" />
                  </span>
                  <p className="text-[14px] font-semibold text-[var(--adm-texto)]">Nenhum entregador cadastrado</p>
                  <p className="max-w-[340px] text-[12.8px] text-[var(--adm-texto-suave)]">
                    Cadastre seu primeiro motoboy. Ele recebe um link para ver as entregas e compartilhar a localização — sem senha.
                  </p>
                  <Button variant="primary" className="mt-2 gap-1.5" onClick={abrirNovoEntregador}>
                    <Plus className="h-4 w-4" /> Cadastrar entregador
                  </Button>
                </div>
              )}
              {drivers.map((driver) => (
                <CartaoEntregador
                  key={driver.id}
                  driver={driver}
                  mudandoStatus={statusMudando === driver.id}
                  onStatus={(s) => mudarStatus(driver.id, s)}
                  onPerfil={() => setProfileDriverId(driver.id)}
                  onLocalizacao={() => setLocationDriverId(driver.id)}
                  onAcesso={() => setLinkDriver(driver)}
                />
              ))}
            </div>
          </section>
          )}

          {/* Pedidos */}
          {tab !== 'entregadores' && (
          <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            {tab === 'pedidos' && (
            <div className="flex flex-col gap-4" data-testid="aba-pedidos">
            <div className="flex flex-col gap-4" data-testid="em-rota-agora">
            {comNexta.length === 0 && inRoute.length === 0 && (
              <div className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
                <CabecalhoSecao icone={<Capacete className="h-4 w-4" strokeWidth={2.2} />} tom="roxo" titulo="Em rota agora" contador={0} descricao="Nenhum pedido na rua. Despache pelo Painel de Pedidos (botão Despachar ou no próprio card)." />
              </div>
            )}

            {/* Com o Nexta: solicitado, ainda não coletado. Depois da coleta vai pra "Em rota". */}
            {nextaAtivo && comNexta.length > 0 && (
              <div className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
                <CabecalhoSecao
                  fixo
                  icone={<Zap className="h-4 w-4" strokeWidth={2.2} />}
                  tom="azul"
                  titulo="Com o Nexta"
                  contador={comNexta.length}
                  descricao="O Nexta já foi chamado e avisado que está pronto para coleta."
                  acoes={
                    <button
                      onClick={alternarSomNexta}
                      title={somNexta ? 'Desligar o alerta sonoro do Nexta' : 'Ligar o alerta sonoro do Nexta'}
                      className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
                        somNexta
                          ? 'border-[var(--adm-azul)] bg-[var(--adm-azul-claro)] text-[var(--adm-azul-escuro)]'
                          : 'border-[var(--adm-borda)] bg-white text-[var(--adm-texto-medio)] hover:border-[var(--adm-borda-forte)]'
                      }`}
                    >
                      {somNexta ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} Som
                    </button>
                  }
                />
                <div className="divide-y divide-[var(--adm-borda)]">
                  {comNexta.map((order) => {
                    const entrega = nextaPorPedido.get(order.id)!
                    const etapaAtual = TIMELINE_NEXTA.findIndex((e) => e.status === entrega.status)
                    const ocupado = nextaBusy === order.id
                    return (
                      <div key={order.id} className="p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <ResumoPedido
                              order={order}
                              selo={
                                <>
                                  <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#E0F2FE] px-1.5 py-0.5 text-[11px] font-semibold text-[#0369A1]">
                                    <Zap className="h-3 w-3" /> Nexta
                                  </span>
                                  <Badge tone="alert">{nextaEventoTexto(entrega.status)}</Badge>
                                </>
                              }
                              extra={
                                entrega.preco !== null && (
                                  <span className="rounded-[4px] bg-price-bg px-1.5 py-0.5 text-[11px] font-semibold text-price-text">
                                    Corrida {brl(entrega.preco)}
                                  </span>
                                )
                              }
                            />

                            {/* Timeline compacta: cada etapa acesa até a atual. Etapa
                                desconhecida (enum novo) some com a timeline, não quebra. */}
                            {etapaAtual >= 0 && (
                              <div className="mt-2.5 flex items-center gap-1">
                                {TIMELINE_NEXTA.map((etapa, i) => (
                                  <div key={etapa.status} className="flex min-w-0 flex-1 flex-col gap-1">
                                    <span className={`h-1 rounded-full ${i <= etapaAtual ? 'bg-[var(--adm-azul)]' : 'bg-[#e5e7eb]'}`} />
                                    <span className={`truncate text-[10px] font-semibold ${i <= etapaAtual ? 'text-[var(--adm-azul-escuro)]' : 'text-[var(--adm-texto-suave)]'}`}>
                                      {etapa.label}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {entrega.entregadorNome && (
                              <div className="mt-2.5 flex items-center gap-2">
                                <Avatar nome={entrega.entregadorNome} fotoUrl={entrega.entregadorFotoUrl} tamanho={28} />
                                <span className="text-[13px] font-semibold">{entrega.entregadorNome}</span>
                                {entrega.entregadorTelefone && (
                                  <a href={`tel:${entrega.entregadorTelefone}`} className="inline-flex items-center gap-1 text-[12px] text-[var(--adm-azul)] hover:underline">
                                    <Phone className="h-3.5 w-3.5" /> {entrega.entregadorTelefone}
                                  </a>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-shrink-0 flex-wrap gap-2">
                            <Button variant="outline" onClick={() => reconciliarNexta(order.id)} disabled={ocupado} title="Buscar o status atual no Nexta">
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                            <a
                              href={NEXTA_PAINEL_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Abrir o painel do Nexta (código de coleta, ocorrências etc.)"
                              className="inline-flex items-center justify-center gap-1.5 rounded-menuzia border border-border bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-main hover:border-primary hover:text-primary"
                            >
                              <ExternalLink className="h-3.5 w-3.5" /> Nexta
                            </a>
                            {entrega.trackingUrl && (
                              <a
                                href={entrega.trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-1.5 rounded-menuzia border border-border bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-main hover:border-primary hover:text-primary"
                              >
                                Rastrear
                              </a>
                            )}
                            <Button variant="ghost" className="text-danger hover:bg-danger-bg" onClick={() => setCancelandoNexta(order.id)} disabled={ocupado}>
                              Cancelar
                            </Button>
                          </div>
                        </div>

                        {cancelandoNexta === order.id && (
                          <div className="mt-3 rounded-[6px] border border-danger bg-danger-bg p-3">
                            <p className="mb-2.5 text-[12px] font-medium text-danger">
                              Cancelar a corrida do pedido #{order.numero} no Nexta? Dependendo do estágio, o Nexta pode cobrar pelo
                              cancelamento — avisamos aqui se houver cobrança. O pedido volta para a fila de despacho.
                            </p>
                            <div className="flex gap-2">
                              <Button variant="secondary" onClick={() => setCancelandoNexta(null)}>
                                Voltar
                              </Button>
                              <Button variant="outline" className="border-danger text-danger hover:bg-white" onClick={() => cancelarNexta(order.id)} disabled={ocupado}>
                                {ocupado ? 'Cancelando…' : 'Cancelar corrida'}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {inRoute.length > 0 && (
            <div className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
              <CabecalhoSecao
                fixo
                icone={<Capacete className="h-4 w-4" strokeWidth={2.2} />}
                tom="roxo"
                titulo="Em rota agora"
                contador={inRoute.length}
                descricao="Já saíram com o entregador. Marque como entregue quando o cliente receber."
              />
              <div className="divide-y divide-[var(--adm-borda)]">
                {inRoute.map((order) => {
                  const parado = pedidoParado(order, Date.now())
                  const nexta = nextaPorPedido.get(order.id)
                  const motoboy = drivers.find((d) => d.id === order.entregadorId) ?? null
                  return (
                    <div
                      key={order.id}
                      className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${parado ? 'bg-danger-bg/40' : ''}`}
                    >
                      <div className="min-w-0">
                        <ResumoPedido
                          order={order}
                          selo={
                            parado ? (
                              <Badge tone="danger" title="Saiu há muito tempo e ninguém fechou. Marque entregue ou não entregue.">
                                Parado há {tempoParado(order.criadoEm, Date.now())}
                              </Badge>
                            ) : (
                              <Badge tone="preparing">Saiu para entrega</Badge>
                            )
                          }
                        />
                        {/* Entrega do Nexta não tem entregador próprio: quem aparece é o
                            motoboy que o webhook informou. */}
                        <div className="mt-2 flex items-center gap-2 text-[12.8px]">
                          {nexta ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-[#0369A1]">
                              <Zap className="h-3.5 w-3.5" /> Nexta{nexta.entregadorNome && ` · ${nexta.entregadorNome}`}
                            </span>
                          ) : (
                            <>
                              <Avatar nome={motoboy?.nome ?? '?'} fotoUrl={motoboy?.fotoUrl ?? null} tamanho={22} />
                              <span className="font-semibold text-[var(--adm-texto)]">{driverName(order.entregadorId)}</span>
                              {motoboy?.telefone && (
                                <a href={`tel:${motoboy.telefone}`} title={`Ligar para ${motoboy.telefone}`} className="text-[var(--adm-texto-suave)] hover:text-[var(--adm-azul)]">
                                  <Phone className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 gap-2">
                        <Button variant="success" className="min-h-[36px] flex-1 px-4 text-[12px] sm:flex-none" onClick={() => deliver(order.id)}>
                          Entregue
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-[36px] border-danger text-danger hover:bg-danger-bg"
                          onClick={() => naoEntregue(order.id)}
                        >
                          Não entregue
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            )}
            </div>
            <div className="flex flex-col rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white" data-testid="pedidos-finalizados">
              <CabecalhoSecao
                icone={<ClipboardCheck className="h-4 w-4" strokeWidth={2.2} />}
                tom="verde"
                titulo="Pedidos finalizados"
                contador={filtrosAtivos ? concluidosFiltrados.length : lista.length}
                descricao={filtrosAtivos ? `${concluidosFiltrados.length} de ${lista.length} com os filtros aplicados` : `Entregues, retirados e cancelados · ${ROTULO_PERIODO[periodo].toLowerCase()}`}
              />
              <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-[var(--adm-borda)] px-4 py-3">
                <select
                  value={periodo}
                  onChange={(e) => setPeriodo(e.target.value as Periodo)}
                  aria-label="Período"
                  data-testid="filtro-periodo"
                  className="h-[36px] rounded-[4px] border border-[var(--adm-borda)] bg-white px-2.5 font-sans text-[13px] outline-none focus:border-[var(--adm-azul)]"
                >
                  {(Object.keys(ROTULO_PERIODO) as Periodo[]).map((p) => <option key={p} value={p}>{ROTULO_PERIODO[p]}</option>)}
                </select>
                {periodo === 'personalizado' && (
                  <>
                    <input type="date" value={periodoDe} onChange={(e) => setPeriodoDe(e.target.value)} aria-label="De" data-testid="filtro-de" className="h-[36px] rounded-[4px] border border-[var(--adm-borda)] px-2 font-sans text-[13px]" />
                    <input type="date" value={periodoAte} min={periodoDe || undefined} onChange={(e) => setPeriodoAte(e.target.value)} aria-label="Até" data-testid="filtro-ate" className="h-[36px] rounded-[4px] border border-[var(--adm-borda)] px-2 font-sans text-[13px]" />
                  </>
                )}
                <input
                  value={filtroBusca}
                  onChange={(e) => setFiltroBusca(e.target.value)}
                  placeholder="Buscar por cliente ou bairro"
                  className="h-[36px] min-w-[180px] flex-1 rounded-[4px] border border-[var(--adm-borda)] px-2.5 font-sans text-[13px] outline-none focus:border-[var(--adm-azul)]"
                />
                <select
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}
                  className="h-[36px] rounded-[4px] border border-[var(--adm-borda)] bg-white px-2.5 font-sans text-[13px] outline-none focus:border-[var(--adm-azul)]"
                >
                  <option value="todos">Todos os status</option>
                  <option value="entregue">Concluído</option>
                  <option value="cancelado">Cancelado</option>
                </select>
                <input
                  value={filtroValorMin}
                  onChange={(e) => setFiltroValorMin(e.target.value)}
                  placeholder="Valor mín."
                  inputMode="decimal"
                  className="h-[36px] w-24 rounded-[4px] border border-[var(--adm-borda)] px-2.5 font-sans text-[13px] outline-none focus:border-[var(--adm-azul)]"
                />
                <input
                  value={filtroValorMax}
                  onChange={(e) => setFiltroValorMax(e.target.value)}
                  placeholder="Valor máx."
                  inputMode="decimal"
                  className="h-[36px] w-24 rounded-[4px] border border-[var(--adm-borda)] px-2.5 font-sans text-[13px] outline-none focus:border-[var(--adm-azul)]"
                />
                {filtrosAtivos && (
                  <button onClick={limparFiltros} className="text-[12px] font-semibold text-[var(--adm-azul)] hover:underline">
                    Limpar filtros
                  </button>
                )}
              </div>
              <div className="divide-y divide-[var(--adm-borda)]" data-testid="lista-finalizados">
                {carregandoLista && <p className="p-4 text-[13px] text-[var(--adm-texto-suave)]">Carregando…</p>}
                {!carregandoLista && lista.length === 0 && (
                  <Vazio icone={<ClipboardCheck className="h-5 w-5" />} titulo={periodo === 'personalizado' && !intervalo ? 'Escolha as datas' : 'Nenhum pedido finalizado no período'} texto="Pedidos entregues, retirados e cancelados aparecem aqui." />
                )}
                {lista.length > 0 && concluidosFiltrados.length === 0 && (
                  <div className="p-6 text-center text-[13px] text-[var(--adm-texto-suave)]">Nenhum pedido encontrado com esses filtros</div>
                )}
                {concluidosFiltrados.map((order) => {
                  const entregue = order.status === 'entregue'
                  return (
                    // Uma linha por pedido: número, cliente, tipo, onde/quem, pagamento e valor.
                    <button type="button" key={order.id} onClick={() => setDetalhe(detalhe?.id === order.id ? null : order)} aria-pressed={detalhe?.id === order.id}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[12.8px] hover:bg-[var(--adm-superficie-2)] ${detalhe?.id === order.id ? 'bg-[var(--adm-azul-claro)]' : ''}`} data-testid={`finalizado-${order.numero}`}>
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${entregue ? 'bg-[#10B981]' : 'bg-danger'}`} title={entregue ? 'Concluído' : 'Cancelado'} />
                      <span className="w-12 flex-shrink-0 font-semibold tabular-nums">#{order.numero}</span>
                      <span className="w-[160px] flex-shrink-0 truncate font-semibold">{order.clienteNome || 'Cliente'}</span>
                      <span className="flex-shrink-0">
                        <Badge tone={order.tipo === 'entrega' ? 'alert' : 'paused'}>{order.tipo === 'entrega' ? 'Entrega' : 'Retirada'}</Badge>
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[var(--adm-texto-suave)]">
                        {order.tipo === 'entrega' ? `${endereco(order)} · ${driverName(order.entregadorId)}` : 'Retirada no balcão'}
                      </span>
                      {!entregue && <Badge tone="danger">Cancelado</Badge>}
                      {entregue && order.entregueAutomatico && <Badge tone="alert" data-testid="selo-entregue-automatico">Entregue (automático)</Badge>}
                      <span className="hidden flex-shrink-0 sm:inline">
                        <Badge tone={order.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{rotuloForma(order.formaPagamento, order.cartaoTipo)}</Badge>
                      </span>
                      <span className="w-[84px] flex-shrink-0 text-right font-semibold tabular-nums text-price-text">{brl(order.total)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            </div>
            )}
          </section>
          )}
        </div>
      </div>

      {detalhe && (
        <PainelPedido
          pedido={detalhe}
          agora={Date.now()}
          onFechar={() => setDetalhe(null)}
          editandoPag={editandoPag}
          setEditandoPag={setEditandoPag}
          onPagamentoAlterado={() => { if (restauranteId) void refetch(restauranteId) }}
          reimpEstado={reimpEstado}
          onReimprimir={async () => { setReimpEstado('enviando'); try { await solicitarReimpressao(supabase, detalhe.id); setReimpEstado('ok') } catch { setReimpEstado('erro') } }}
          onCancelar={() => setError('Pedido finalizado não pode ser cancelado.')}
        />
      )}
      </div>

      {/* Novo entregador: gaveta com o cadastro completo. Ao salvar, já abre o
          link/QR de acesso — é a próxima coisa que o dono precisa mandar. */}
      {addDriverOpen && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={() => setAddDriverOpen(false)} />}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[420px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          addDriverOpen ? 'translate-x-0' : 'invisible translate-x-full',
        ].join(' ')}
        aria-hidden={!addDriverOpen}
      >
        <div className="flex items-center justify-between border-b border-[var(--adm-borda)] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Novo entregador</h2>
            <p className="mt-0.5 text-[12px] text-[var(--adm-texto-suave)]">Depois de salvar você recebe o link de acesso dele.</p>
          </div>
          <button onClick={() => setAddDriverOpen(false)} aria-label="Fechar" className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-[4px] text-lg text-[var(--adm-texto-suave)] hover:bg-[var(--adm-hover)]">
            ×
          </button>
        </div>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            void addDriver()
          }}
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <div className="flex items-center gap-3 rounded-[6px] bg-[var(--adm-superficie-2)] p-3">
              <Avatar nome={novoDriver.nome || '?'} fotoUrl={null} tamanho={44} />
              <div className="min-w-0 text-[12px] text-[var(--adm-texto-suave)]">
                <p className="truncate text-[14px] font-semibold text-[var(--adm-texto)]">{novoDriver.nome.trim() || 'Nome do entregador'}</p>
                {[novoDriver.veiculo, novoDriver.placa].filter(Boolean).join(' · ') || 'A foto pode ser enviada depois, em Editar.'}
              </div>
            </div>
            <CampoEntregador rotulo="Nome" obrigatorio>
              <input
                value={novoDriver.nome}
                onChange={(e) => setNovoDriver((d) => ({ ...d, nome: e.target.value }))}
                placeholder="Como a equipe chama ele"
                maxLength={60}
                className={CLASSE_CAMPO}
              />
            </CampoEntregador>
            <CampoEntregador rotulo="WhatsApp" dica="Usado para ligar e para mandar o link de acesso.">
              <input
                value={novoDriver.telefone}
                onChange={(e) => setNovoDriver((d) => ({ ...d, telefone: mascararTelefoneBR(e.target.value) }))}
                placeholder="(00) 00000-0000"
                inputMode="tel"
                className={CLASSE_CAMPO}
              />
            </CampoEntregador>
            <div className="grid grid-cols-[1fr_130px] gap-3">
              <CampoEntregador rotulo="Veículo">
                <input
                  value={novoDriver.veiculo}
                  onChange={(e) => setNovoDriver((d) => ({ ...d, veiculo: e.target.value }))}
                  placeholder="Ex.: Honda CG 160"
                  maxLength={40}
                  className={CLASSE_CAMPO}
                />
              </CampoEntregador>
              <CampoEntregador rotulo="Placa">
                <input
                  value={novoDriver.placa}
                  onChange={(e) => setNovoDriver((d) => ({ ...d, placa: e.target.value.toUpperCase() }))}
                  placeholder="ABC1D23"
                  maxLength={8}
                  className={`${CLASSE_CAMPO} uppercase`}
                />
              </CampoEntregador>
            </div>
            {novoDriver.telefone && !telefoneCompleto(novoDriver.telefone) && (
              <p className="text-[12px] text-[var(--adm-laranja)]">O telefone parece incompleto — confira o DDD e os dígitos.</p>
            )}
          </div>
          <div className="flex gap-2.5 border-t border-[var(--adm-borda)] px-5 py-3.5">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setAddDriverOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={addingDriver || !novoDriver.nome.trim()}>
              {addingDriver ? 'Salvando…' : 'Cadastrar'}
            </Button>
          </div>
        </form>
      </aside>

      {/* Fechamento de caixa — por turno (0114) */}
      <CaixaTurnoGaveta aberto={closingOpen} onFechar={() => setClosingOpen(false)} />

      {/* Acesso do entregador (link/QR) */}
      {linkDriver && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={() => setLinkDriver(null)} />}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[380px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          linkDriver ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Acesso do entregador</h2>
            <p className="mt-0.5 text-xs text-text-subtle">{linkDriver?.nome}</p>
          </div>
          <button onClick={() => setLinkDriver(null)} className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          <p className="mb-4 text-xs leading-relaxed text-text-subtle">
            Compartilhe esse QR code ou link com {linkDriver?.nome}. Ao abrir, o painel de entregas dele aparece direto — sem precisar
            de login ou senha.
          </p>
          {qrDataUrl && (
            <div className="mb-4 flex items-center justify-center rounded-menuzia border border-border p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR code de acesso do entregador" className="h-[240px] w-[240px]" />
            </div>
          )}
          {linkDriver && (
            <div className="mb-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Link de acesso</div>
              <div className="break-all rounded-menuzia border border-border bg-page px-2.5 py-2 text-[12px] text-text-main">{portalUrl(linkDriver)}</div>
            </div>
          )}
          <Button variant="primary" className="w-full" onClick={copiarLink}>
            {linkCopied ? 'Link copiado!' : 'Copiar link'}
          </Button>
          {linkDriver && (
            <AcessoEntregador
              key={linkDriver.id}
              id={linkDriver.id}
              nome={linkDriver.nome}
              desativado={linkDriver.desativado}
              temLogin={linkDriver.temLogin}
              onMudou={() => {
                // Link novo / desativado: o QR mostrado ficou velho — fecha e recarrega.
                setLinkDriver(null)
                if (restauranteId) void refetchAgora(restauranteId)
              }}
            />
          )}
        </div>
      </aside>

      {/* Localização do entregador */}
      {locationDriver && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#111827]/55 p-4" onClick={() => setLocationDriverId(null)}>
          <div className="flex h-[88vh] w-full max-w-4xl flex-col rounded-menuzia bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
              <div>
                <h2 className="text-[15px] font-semibold">Localização — {locationDriver.nome}</h2>
                {locationDriver.localizacao && (
                  <p className="mt-0.5 text-xs text-text-subtle">Atualizado {tempoRelativo(locationDriver.localizacao.atualizadaEm)}</p>
                )}
              </div>
              <button onClick={() => setLocationDriverId(null)} className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
                ×
              </button>
            </div>
            <div className="flex-1 p-4.5">
              {locationDriver.localizacao ? (
                <RouteMap
                  apiKey={MAPS_KEY}
                  origin={locationOrigem}
                  stops={locationDriverStops}
                  loja={lojaMapa}
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-menuzia border border-dashed border-border p-8 text-center text-sm text-text-subtle">
                  Localização ainda não disponível. O motoboy precisa abrir o link de acesso e permitir a localização no celular.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Perfil do entregador */}
      {profileDriverId && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={() => setProfileDriverId(null)} />}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[380px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          profileDriverId ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Perfil do entregador</h2>
            <p className="mt-0.5 text-xs text-text-subtle">{profileDriver?.nome}</p>
          </div>
          <button onClick={() => setProfileDriverId(null)} className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          {perfilError && (
            <div className="mb-3 rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{perfilError}</div>
          )}
          <div className="mb-4 flex items-center gap-3">
            {perfilForm.fotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={perfilForm.fotoUrl} alt="Foto do entregador" className="h-16 w-16 rounded-menuzia border border-border object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-menuzia border border-border bg-page text-xl font-semibold text-text-subtle">
                {perfilForm.nome.trim().charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <input ref={fotoInputRef} type="file" accept="image/*" className="hidden" onChange={handleFotoPick} />
            <div className="flex flex-col gap-1.5">
              <Button variant="outline" type="button" onClick={() => fotoInputRef.current?.click()} disabled={uploadingFoto}>
                {uploadingFoto ? 'Enviando…' : perfilForm.fotoUrl ? 'Trocar foto' : 'Enviar foto'}
              </Button>
              {perfilForm.fotoUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setPerfilForm((f) => ({ ...f, fotoUrl: '' }))
                    setPerfilSaved(false)
                  }}
                  className="text-[12px] text-text-subtle hover:text-danger"
                >
                  Remover
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome</label>
              <input
                value={perfilForm.nome}
                onChange={(e) => {
                  setPerfilForm((f) => ({ ...f, nome: e.target.value }))
                  setPerfilSaved(false)
                }}
                className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Telefone</label>
              <input
                value={perfilForm.telefone}
                onChange={(e) => {
                  setPerfilForm((f) => ({ ...f, telefone: e.target.value }))
                  setPerfilSaved(false)
                }}
                placeholder="(00) 00000-0000"
                className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Veículo</label>
              <input
                value={perfilForm.veiculo}
                onChange={(e) => {
                  setPerfilForm((f) => ({ ...f, veiculo: e.target.value }))
                  setPerfilSaved(false)
                }}
                placeholder="Ex: Honda CG 160"
                className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Placa</label>
              <input
                value={perfilForm.placa}
                onChange={(e) => {
                  setPerfilForm((f) => ({ ...f, placa: e.target.value.toUpperCase() }))
                  setPerfilSaved(false)
                }}
                placeholder="ABC-1234"
                className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4.5 py-3">
          {perfilSaved && !perfilSaving ? (
            <span className="text-[13px] font-medium text-status-ready">Alterações salvas.</span>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={savePerfil} disabled={perfilSaving || !perfilForm.nome.trim()}>
            {perfilSaving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </aside>
    </>
  )
}
