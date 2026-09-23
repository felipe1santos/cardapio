'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRealtimeComFallback } from '@/lib/realtime-fallback'
import QRCode from 'qrcode'
import { Bike, Clock, Package, Truck, Users, ClipboardCheck, Phone, User, MapPin, Plus, Wallet, Zap, RefreshCw, Volume2, VolumeX, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { avisoDePedidosParados, pedidoParado, tempoParado } from '@/lib/pedido-parado'
import { TopBar } from '@/components/layout/topbar'
import { CartaoNumero, TONS_PAINEL, type TomPainel } from '@/components/admin/cartao-numero'
import { ICONES } from '@/lib/icones-painel'
import { mascararTelefoneBR, telefoneCompleto } from '@/lib/telefone'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RouteMap } from '@/components/maps/route-map'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { notificarPedido } from '@/lib/notificar'
import { invalidarCotacaoNexta, useCotacoesNexta, type CotacaoNextaEstado } from '@/lib/nexta-cotacao-cache'
import { motivoRejeicaoTexto, nextaEntregaAtiva, nextaEventoTexto } from '@/lib/nexta-eventos'
import { listarNextaEntregas, type NextaEntregaLinha } from '@/lib/queries/nexta'
import {
  atribuirEntregador,
  atribuirEntregadorEmLote,
  atualizarPerfilEntregador,
  buscarDespachoAberto,
  criarEntregador,
  definirStatusEntregador,
  definirDespachoAberto,
  enderecoCompletoPedido,
  enviarFotoEntregador,
  listarEntregadores,
  listarPedidosConcluidos,
  listarPedidosLogistica,
  listarResumoCaixa,
  marcarPedidoEntregue,
  registrarFechamentoCaixa,
  type Entregador,
  type Pedido,
  type ResumoCaixa,
  type StatusEntregador,
} from '@/lib/queries/pedidos'
import { cancelarPedidoRequest } from '@/lib/cancelamento'
import { atualizarConfigLoja, buscarFluxoLoja } from '@/lib/queries/ajustes'

type Tab = 'despacho' | 'concluidos' | 'entregadores'

/**
 * Coluna visível abaixo de `lg`. No desktop as duas aparecem lado a lado; no celular
 * viram abas, pra não empilhar duas listas longas numa tela só.
 */
type ColunaMobile = 'prontos' | 'rota'

/** Chave do localStorage que lembra se o operador recolheu os cards de resumo. */
const RESUMO_KEY = 'menuzia:logistica:resumo'

const TABS: { id: Tab; label: string }[] = [
  { id: 'despacho', label: 'Despacho' },
  { id: 'concluidos', label: 'Concluídos' },
  { id: 'entregadores', label: 'Entregadores' },
]

/**
 * Aba do query param (`?tab=`), pra deep-link e pra não perder o lugar num refresh.
 * Lida só depois da montagem — ler `window` no estado inicial quebraria a hidratação.
 */
function tabDaUrl(): Tab | null {
  const valor = new URLSearchParams(window.location.search).get('tab')
  return TABS.some((t) => t.id === valor) ? (valor as Tab) : null
}

function inicioDoDiaISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
}

const brl = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`
const PAY_LABEL: Record<string, string> = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' }


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

/**
 * Chip de cotação do Nexta no card do pedido. Falhar em cotar não pode atrapalhar o
 * despacho próprio: vira um chip cinza discreto com o motivo no tooltip.
 */
function ChipNexta({ estado }: { estado: CotacaoNextaEstado | undefined }) {
  if (!estado || estado.status === 'carregando') {
    return (
      <span className="inline-flex animate-pulse items-center gap-1.5 rounded-menuzia bg-page px-2 py-0.5 text-[11px] font-semibold text-text-subtle">
        <Zap className="h-3 w-3" /> Cotando Nexta…
      </span>
    )
  }
  if (estado.status === 'erro') {
    return (
      <span
        title={estado.erro}
        className="inline-flex cursor-help items-center gap-1.5 rounded-menuzia bg-page px-2 py-0.5 text-[11px] font-semibold text-text-subtle"
      >
        <Zap className="h-3 w-3" /> Nexta indisponível
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-menuzia bg-price-bg px-2 py-0.5 text-[11px] font-semibold text-price-text">
      <Zap className="h-3 w-3" strokeWidth={2.5} /> Nexta {brl(estado.preco)}
      {estado.etaColetaMin !== null && (
        <span className="font-medium text-text-subtle">· coleta ~{Math.round(estado.etaColetaMin)} min</span>
      )}
    </span>
  )
}

/** Primeira opção do dropdown "Atribuir entregador": o Nexta, como um entregador virtual. */
function OpcaoNexta({ rotulo, detalhe, onClick, disabled }: { rotulo: string; detalhe: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-2 rounded-menuzia border-l-2 border-l-primary px-3 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page disabled:opacity-60"
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <Zap className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} /> {rotulo}
      </span>
      <span className="text-xs text-text-subtle">{detalhe}</span>
    </button>
  )
}

/** Preço + ETA de uma cotação, no lado direito da opção do dropdown. */
function detalheCotacao(cotacao: CotacaoNextaEstado | undefined): React.ReactNode {
  if (cotacao?.status === 'ok') {
    return (
      <>
        <span className="font-bold text-price-text">{brl(cotacao.preco)}</span>
        {cotacao.etaColetaMin !== null && ` · coleta ~${Math.round(cotacao.etaColetaMin)} min`}
      </>
    )
  }
  return cotacao?.status === 'erro' ? 'sem cotação' : 'cotando…'
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
          <h3 className="truncate text-[14px] font-bold text-[var(--adm-texto-forte)]">{titulo}</h3>
          {contador !== undefined && (
            <span className="rounded-full bg-[#f1f2f4] px-2 py-[1px] text-[11px] font-bold text-[var(--adm-texto-medio)]">{contador}</span>
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
      className="flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white"
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
        <span className="text-[14px] font-bold tabular-nums">#{order.numero}</span>
        <span className="truncate text-[13.5px] font-semibold text-[var(--adm-texto)]">{order.clienteNome || 'Cliente'}</span>
        {selo}
        <span className="text-[11px] text-[var(--adm-texto-suave)]">{tempoRelativo(order.criadoEm)}</span>
      </div>
      <div className="mt-1 flex items-start gap-1.5 text-[12.5px] text-[var(--adm-texto-medio)]">
        <MapPin className="mt-[2px] h-3.5 w-3.5 flex-shrink-0 text-[var(--adm-texto-suave)]" />
        <span>{endereco(order)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={order.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{PAY_LABEL[order.formaPagamento]}</Badge>
        {order.formaPagamento === 'dinheiro' && order.trocoPara !== null && <Badge tone="paused">Troco para {brl(order.trocoPara)}</Badge>}
        <span className="text-[13.5px] font-bold tabular-nums text-price-text">{brl(order.total)}</span>
        {extra}
      </div>
    </>
  )
}

/** Opções "meus entregadores" dos menus de atribuir, com foto e carga atual. */
function ListaEntregadoresMenu({ entregadores, onEscolher }: { entregadores: Entregador[]; onEscolher: (id: string) => void }) {
  if (entregadores.length === 0) {
    return <div className="px-3 py-2.5 text-[12px] text-[var(--adm-texto-suave)]">Nenhum entregador disponível agora</div>
  }
  return (
    <>
      {entregadores.map((driver) => (
        <button
          key={driver.id}
          onClick={() => onEscolher(driver.id)}
          className="flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left text-[13px] font-medium text-[var(--adm-texto)] hover:bg-[var(--adm-superficie-2)]"
        >
          <Avatar nome={driver.nome} fotoUrl={driver.fotoUrl} tamanho={26} />
          <span className="min-w-0 flex-1 truncate">{driver.nome}</span>
          <span className={`text-[11px] font-semibold ${driver.emRota ? 'text-[#9333EA]' : 'text-[var(--adm-texto-suave)]'}`}>
            {driver.emRota ? `${driver.emRota} em rota` : 'livre'}
          </span>
        </button>
      ))}
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
            <p className="truncate text-[14px] font-bold text-[var(--adm-texto)]">{driver.nome}</p>
            <select
              value={driver.status}
              disabled={mudandoStatus}
              onChange={(e) => onStatus(e.target.value as StatusEntregador)}
              aria-label={`Situação de ${driver.nome}`}
              className="flex-shrink-0 cursor-pointer rounded-full border-0 py-1 pl-2.5 pr-6 text-[11px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-[var(--adm-azul)]"
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

export default function LogisticaPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [orders, setOrders] = useState<Pedido[]>([])
  const [concluidos, setConcluidos] = useState<Pedido[]>([])
  const [drivers, setDrivers] = useState<Entregador[]>([])
  const [despachoAberto, setDespachoAberto] = useState(false)
  const [assigning, setAssigning] = useState<string | null>(null)
  /** Altura aproximada do menu de atribuir — usada só pra decidir o lado da abertura. */
  const ALTURA_MENU_ATRIBUIR = 200
  /** true quando o menu de atribuir precisa abrir pra cima por falta de espaço embaixo. */
  const [assignAcima, setAssignAcima] = useState(false)
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

  const [tab, setTab] = useState<Tab>('despacho')
  const [colunaMobile, setColunaMobile] = useState<ColunaMobile>('prontos')
  // Começa visível sempre: o valor salvo só entra depois da montagem, senão o primeiro
  // render do servidor e o do cliente divergem e a hidratação quebra.
  const [resumoVisivel, setResumoVisivel] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAssigning, setBulkAssigning] = useState(false)

  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'entregue' | 'cancelado'>('todos')
  const [filtroValorMin, setFiltroValorMin] = useState('')
  const [filtroValorMax, setFiltroValorMax] = useState('')

  const [novoDriver, setNovoDriver] = useState({ nome: '', telefone: '', veiculo: '', placa: '' })
  const [statusMudando, setStatusMudando] = useState<string | null>(null)
  // Entrega sem entregador (0079). null enquanto a config não chegou.
  const [semEntregador, setSemEntregador] = useState<boolean | null>(null)
  const [confirmandoModo, setConfirmandoModo] = useState(false)
  const [salvandoModo, setSalvandoModo] = useState(false)
  const [addingDriver, setAddingDriver] = useState(false)
  const [addDriverOpen, setAddDriverOpen] = useState(false)

  const [resumo, setResumo] = useState<ResumoCaixa[]>([])
  const [declarado, setDeclarado] = useState<Record<string, string>>({})

  const [nextaAtivo, setNextaAtivo] = useState(false)
  const [nextaEntregas, setNextaEntregas] = useState<NextaEntregaLinha[]>([])
  const [nextaBusy, setNextaBusy] = useState<string | null>(null)
  const [cancelandoNexta, setCancelandoNexta] = useState<string | null>(null)
  const [somNexta, setSomNexta] = useState(false)
  // Status já visto por entrega — é a comparação com ele que decide se toca o som.
  const statusNextaVisto = useRef<Map<string, string>>(new Map())

  const refetch = useCallback(
    async (id: string) => {
      try {
        const [pedidos, entregadores, finalizados, aberto, entregasNexta] = await Promise.all([
          listarPedidosLogistica(supabase, id),
          listarEntregadores(supabase, id),
          listarPedidosConcluidos(supabase, id, inicioDoDiaISO()),
          buscarDespachoAberto(supabase, id),
          // Janela curta: além das entregas em andamento, precisamos das recém-recusadas
          // pra avisar o lojista por que aquele pedido voltou pra fila.
          listarNextaEntregas(supabase, id, new Date(Date.now() - 12 * 3600 * 1000).toISOString()).catch(() => []),
        ])
        setOrders(pedidos)
        setDrivers(entregadores)
        setConcluidos(finalizados)
        setDespachoAberto(aberto)
        setNextaEntregas(entregasNexta)
      } catch {
        setError('Não foi possível carregar a logística.')
      }
    },
    [supabase]
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
    if (proxima === 'despacho') url.searchParams.delete('tab')
    else url.searchParams.set('tab', proxima)
    // replaceState em vez de router.push: trocar de aba não merece entrada no histórico
    // e não pode remontar a página (mataria o realtime e as cotações em cache).
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

  const available = drivers.filter((d) => d.status === 'online')
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

  /**
   * Última tentativa recusada/cancelada de cada pedido que voltou pra fila. Sem isso o
   * pedido reaparece no despacho sem explicação nenhuma.
   */
  const falhasNexta = useMemo(() => {
    const mapa = new Map<string, NextaEntregaLinha>()
    for (const e of nextaEntregas) {
      if (e.status !== 'REJECTED' && e.status !== 'CANCELLED') continue
      if (nextaPorPedido.has(e.pedidoId)) continue // já tem tentativa nova rodando
      const atual = mapa.get(e.pedidoId)
      if (!atual || e.atualizadoEm > atual.atualizadoEm) mapa.set(e.pedidoId, e)
    }
    return mapa
  }, [nextaEntregas, nextaPorPedido])

  /** Fila de despacho de verdade: tira quem já está com o Nexta (tem seção própria). */
  const unassigned = useMemo(() => unassignedTodos.filter((o) => !nextaPorPedido.has(o.id)), [unassignedTodos, nextaPorPedido])

  // Cotações só dos pedidos que estão de fato esperando despacho, e só quando o lojista
  // está olhando pra eles — não faz sentido cotar em segundo plano na aba Concluídos.
  const idsParaCotar = useMemo(() => (tab === 'despacho' ? unassigned.map((o) => o.id) : []), [tab, unassigned])
  const cotacoesNexta = useCotacoesNexta(idsParaCotar, nextaAtivo)

  /** Soma das cotações dos pedidos marcados — o custo do despacho em lote pelo Nexta. */
  const totalNextaSelecionado = useMemo(() => {
    let total = 0
    let cotados = 0
    for (const id of selected) {
      const c = cotacoesNexta[id]
      if (c?.status === 'ok') {
        total += c.preco
        cotados++
      }
    }
    return { total, cotados }
  }, [selected, cotacoesNexta])

  // Pedido que saiu da fila (foi pro Nexta, ou um motoboy pegou pelo app) não pode
  // continuar marcado: o despacho em lote tentaria atribuí-lo de novo.
  useEffect(() => {
    setSelected((prev) => {
      const validos = new Set(unassigned.map((o) => o.id))
      if ([...prev].every((id) => validos.has(id))) return prev
      return new Set([...prev].filter((id) => validos.has(id)))
    })
  }, [unassigned])

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

  /** Manda um pedido pro Nexta. O servidor recota na hora — o preço do chip é só vitrine. */
  async function despacharNexta(orderId: string): Promise<boolean> {
    setAssigning(null)
    setNextaBusy(orderId)
    setError(null)
    try {
      const res = await fetch('/api/admin/nexta/despachar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId: orderId }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Falha ao enviar ao Nexta.')
      invalidarCotacaoNexta(orderId)
      if (restauranteId) await refetch(restauranteId)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o pedido ao Nexta.')
      return false
    } finally {
      setNextaBusy(null)
    }
  }

  /** Despacho em lote: 1 corrida por pedido, sequencial. Sucesso parcial é reportado. */
  async function despacharNextaEmLote() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setBulkAssigning(false)
    setNextaBusy('lote')
    setError(null)
    const falhas: string[] = []
    for (const id of ids) {
      try {
        const res = await fetch('/api/admin/nexta/despachar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pedidoId: id }),
        })
        if (!res.ok) throw new Error()
        invalidarCotacaoNexta(id)
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      } catch {
        falhas.push(orders.find((o) => o.id === id)?.numero.toString() ?? id)
      }
    }
    setNextaBusy(null)
    if (falhas.length > 0) setError(`Não foi possível enviar ao Nexta: pedido(s) #${falhas.join(', #')}. Os demais foram enviados.`)
    if (restauranteId) await refetch(restauranteId)
  }

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
  const locationDriverStops = locationDriver
    ? orders
        .filter((o) => o.entregadorId === locationDriver.id && o.status === 'em_rota')
        .map((o, i) => ({ id: o.id, numero: i + 1, address: enderecoCompletoPedido(o) }))
    : []

  const concluidosFiltrados = useMemo(() => {
    const busca = filtroBusca.trim().toLowerCase()
    const min = filtroValorMin.trim() === '' ? null : Number(filtroValorMin.replace(/\./g, '').replace(',', '.'))
    const max = filtroValorMax.trim() === '' ? null : Number(filtroValorMax.replace(/\./g, '').replace(',', '.'))
    return concluidos.filter((o) => {
      if (filtroStatus !== 'todos' && o.status !== filtroStatus) return false
      if (busca && !(o.clienteNome.toLowerCase().includes(busca) || o.enderecoBairro.toLowerCase().includes(busca))) return false
      if (min !== null && Number.isFinite(min) && o.total < min) return false
      if (max !== null && Number.isFinite(max) && o.total > max) return false
      return true
    })
  }, [concluidos, filtroBusca, filtroStatus, filtroValorMin, filtroValorMax])

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

  async function assign(orderId: string, driverId: string) {
    setAssigning(null)
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, entregadorId: driverId, status: 'em_rota' } : o)))
    setSelected((prev) => {
      if (!prev.has(orderId)) return prev
      const next = new Set(prev)
      next.delete(orderId)
      return next
    })
    try {
      await atribuirEntregador(supabase, orderId, driverId)
      notificarPedido(orderId, 'em_rota')
    } catch {
      setError('Não foi possível atribuir o entregador.')
      if (restauranteId) refetch(restauranteId)
    }
  }

  function toggleSelect(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  async function assignBulk(driverId: string) {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setBulkAssigning(false)
    setOrders((prev) => prev.map((o) => (ids.includes(o.id) ? { ...o, entregadorId: driverId, status: 'em_rota' } : o)))
    setSelected(new Set())
    try {
      await atribuirEntregadorEmLote(supabase, ids, driverId)
      for (const id of ids) notificarPedido(id, 'em_rota')
    } catch {
      setError('Não foi possível atribuir os pedidos selecionados.')
      if (restauranteId) refetch(restauranteId)
    }
  }

  async function deliver(orderId: string) {
    setOrders((prev) => prev.filter((o) => o.id !== orderId))
    try {
      await marcarPedidoEntregue(supabase, orderId)
      notificarPedido(orderId, 'entregue')
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

  async function toggleDespacho() {
    if (!restauranteId) return
    const next = !despachoAberto
    setDespachoAberto(next)
    try {
      await definirDespachoAberto(supabase, restauranteId, next)
    } catch {
      setDespachoAberto(!next)
      setError('Não foi possível alterar o despacho aberto.')
    }
  }

  /**
   * Liga/desliga a entrega sem entregador. Ligar com entrega na rua esconderia
   * esses pedidos (a tela vira só o aviso do modo), então é bloqueado até eles
   * serem concluídos.
   */
  async function mudarModoEntrega(ligar: boolean) {
    if (!restauranteId) return
    if (ligar && (inRoute.length > 0 || comNexta.length > 0)) {
      setError(`Há ${inRoute.length + comNexta.length} entrega(s) em rota. Conclua antes de passar a entregar sem entregador.`)
      setConfirmandoModo(false)
      return
    }
    setSalvandoModo(true)
    try {
      await atualizarConfigLoja(supabase, restauranteId, { entregaSemEntregador: ligar })
      setSemEntregador(ligar)
      setConfirmandoModo(false)
    } catch {
      setError('Não foi possível mudar o modo de entrega.')
    } finally {
      setSalvandoModo(false)
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

  async function openClosing() {
    if (!restauranteId) return
    try {
      setResumo(await listarResumoCaixa(supabase, restauranteId))
    } catch {
      setError('Não foi possível calcular o caixa.')
    }
    setClosingOpen(true)
  }

  async function saveClosing(r: ResumoCaixa) {
    if (!restauranteId) return
    const valor = Number((declarado[r.entregadorId] ?? '').replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(valor)) return
    try {
      await registrarFechamentoCaixa(supabase, restauranteId, r.entregadorId, r.valorEsperado, r.trocoLevado, valor)
      setResumo(await listarResumoCaixa(supabase, restauranteId))
      setDeclarado((prev) => ({ ...prev, [r.entregadorId]: '' }))
    } catch {
      setError('Não foi possível registrar o fechamento.')
    }
  }

  if (loading) {
    return (
      <>
        <TopBar title="Logística" breadcrumb="Logística › Despacho de entregas" />
        <div className="flex flex-1 items-center justify-center p-5 text-sm text-text-subtle">Carregando logística…</div>
      </>
    )
  }

  if (semEntregador) {
    return (
      <>
        <TopBar title="Logística" breadcrumb="Logística › Entrega sem entregador" />
        <div className="flex flex-1 flex-col items-center overflow-y-auto p-5">
          {error && (
            <div className="mb-4 w-full max-w-[640px] rounded-[6px] border-[0.8px] border-danger bg-danger-bg px-3.5 py-2.5 text-[12.8px] font-semibold text-danger">{error}</div>
          )}
          <section className="w-full max-w-[640px] rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: TONS_PAINEL.verde.fundo, color: TONS_PAINEL.verde.cor }}>
                <Bike className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-[16px] font-bold text-[var(--adm-texto)]">Você está entregando sem entregador</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--adm-texto-medio)]">
                  Os pedidos de entrega saem direto do <b>Painel de Pedidos</b>. Quando o pedido estiver pronto, toque em{' '}
                  <b>“Saiu p/ entrega”</b>: o cliente recebe no WhatsApp que o pedido saiu e o pedido é concluído.
                </p>
              </div>
            </div>
            <ul className="mt-5 space-y-2 border-t border-[var(--adm-borda)] pt-4 text-[12.8px] text-[var(--adm-texto-medio)]">
              <li>• Não há cadastro de motoboy, rota nem rastreio.</li>
              <li>• Não existe a etapa “entregue”: ninguém confirma a entrega, então o pedido fecha na saída.</li>
              <li>• Fidelidade e relatórios contam o pedido normalmente.</li>
            </ul>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href="/admin/pedidos" className="inline-flex items-center rounded-[4px] bg-[var(--adm-azul)] px-4 py-2 text-[12.8px] font-semibold text-white hover:brightness-95">
                Ir para o Painel de Pedidos
              </a>
              <Button variant="outline" onClick={() => mudarModoEntrega(false)} disabled={salvandoModo}>
                {salvandoModo ? 'Salvando…' : 'Voltar a usar entregadores'}
              </Button>
            </div>
          </section>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar title="Logística" breadcrumb="Logística › Despacho de entregas" />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5">
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
          <div className="grid flex-shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
            <CartaoNumero
              icone={ICONES.entregador}
              tom="verde"
              rotulo="Entregadores disponíveis"
              valor={available.length}
              detalhe={`de ${drivers.length} cadastrado${drivers.length === 1 ? '' : 's'}`}
            />
            <CartaoNumero
              icone={ICONES.pedidos}
              tom="laranja"
              rotulo="Aguardando despacho"
              valor={unassigned.length}
              detalhe={unassigned.length ? 'prontos na cozinha' : 'nada parado'}
            />
            <CartaoNumero
              icone={ICONES.logistica}
              tom="roxo"
              rotulo="Em rota agora"
              valor={inRoute.length + comNexta.length}
              detalhe={comNexta.length ? `${comNexta.length} com o Nexta` : 'com seus entregadores'}
            />
            <CartaoNumero
              icone={ICONES.concluido}
              tom="azul"
              rotulo="Entregues hoje"
              valor={concluidos.filter((o) => o.status === 'entregue').length}
              detalhe={brl(concluidos.filter((o) => o.status === 'entregue').reduce((s, o) => s + o.total, 0))}
            />
          </div>
        )}

        {/* Abas em linha, sublinhado na cor de marca — o mesmo desenho das tabelas
            do Dashboard, sem o bloco vermelho de antes. */}
        <div className="flex flex-shrink-0 items-end justify-between gap-3 border-b border-[var(--adm-borda)]">
          <div className="flex gap-1 max-lg:overflow-x-auto max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden" role="tablist">
            {TABS.map((t) => {
              const contador = t.id === 'concluidos' ? concluidos.length : t.id === 'entregadores' ? drivers.length : unassigned.length
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
                      className={`min-w-[20px] rounded-full px-1.5 py-[1px] text-center text-[11px] font-bold ${
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
          {semEntregador === false && !confirmandoModo && (
            <button
              onClick={() => setConfirmandoModo(true)}
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-[var(--adm-borda)] bg-white px-2.5 py-1 text-[12px] font-medium text-[var(--adm-texto-medio)] transition-colors hover:border-[var(--adm-borda-forte)] hover:text-[var(--adm-texto)]"
              title="Para quem não quer cadastrar motoboy nem acompanhar rota"
            >
              <Bike className="h-3.5 w-3.5" /> Entregar sem entregador
            </button>
          )}
          {confirmandoModo && (
            <span className="inline-flex flex-wrap items-center gap-2 rounded-[4px] border border-[#fcd34d] bg-warn-bg px-2.5 py-1 text-[12px] text-[var(--adm-laranja)]">
              Pedido sai do Kanban e fecha, sem motoboy nem rota.
              <button onClick={() => mudarModoEntrega(true)} disabled={salvandoModo} className="font-bold underline-offset-2 hover:underline">
                {salvandoModo ? 'Salvando…' : 'Confirmar'}
              </button>
              <button onClick={() => setConfirmandoModo(false)} className="font-medium text-[var(--adm-texto-suave)] hover:underline">
                Cancelar
              </button>
            </span>
          )}
          <button
            onClick={alternarResumo}
            className="hidden flex-shrink-0 items-center gap-1 rounded-[4px] px-2 py-1 text-[12px] font-medium text-[var(--adm-texto-suave)] transition-colors hover:bg-[var(--adm-hover)] hover:text-[var(--adm-texto)] sm:inline-flex"
          >
            {resumoVisivel ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {resumoVisivel ? 'Ocultar resumo' : 'Mostrar resumo'}
          </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Entregadores */}
          {tab === 'entregadores' && (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
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
            <div className="grid flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto bg-[var(--adm-bg)] p-4 md:grid-cols-2 2xl:grid-cols-3">
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
            {tab === 'despacho' && (
            <>
            {/* Abaixo de lg as duas colunas viram abas — empilhar duas listas longas
                num celular esconde justamente o que o operador precisa alcançar. */}
            <div className="flex flex-shrink-0 gap-1 rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-1 lg:hidden">
              {([
                { id: 'prontos' as const, label: 'Prontos', contador: unassigned.length },
                { id: 'rota' as const, label: 'Em rota', contador: comNexta.length + inRoute.length },
              ]).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setColunaMobile(c.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-[4px] px-3 py-2 text-[13px] font-semibold transition-colors ${
                    colunaMobile === c.id ? 'bg-[var(--adm-azul-claro)] text-[var(--adm-azul-escuro)]' : 'text-[var(--adm-texto-suave)] hover:bg-[var(--adm-hover)]'
                  }`}
                >
                  {c.label}
                  <span className="rounded-full bg-white px-1.5 py-[1px] text-[11px] font-bold">{c.contador}</span>
                </button>
              ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-2 lg:gap-4">
            {/* Coluna da esquerda: onde o operador age. */}
            <div className={`min-h-0 flex-1 flex-col gap-4 overflow-y-auto ${colunaMobile === 'prontos' ? 'flex' : 'hidden'} lg:flex`}>
            <div className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
              <CabecalhoSecao
                fixo
                icone={<Package className="h-4 w-4" strokeWidth={2.2} />}
                tom="laranja"
                titulo="Prontos para despachar"
                contador={unassigned.length}
                descricao={
                  despachoAberto
                    ? 'Despacho aberto — os entregadores também podem pegar estes pedidos pelo app.'
                    : 'Escolha um entregador para cada pedido, ou selecione vários e atribua de uma vez.'
                }
                antes={
                  unassigned.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos"
                      checked={unassigned.every((o) => selected.has(o.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(unassigned.map((o) => o.id)) : new Set())}
                      className="h-4 w-4 rounded border-[var(--adm-borda-forte)] accent-[var(--adm-azul)]"
                    />
                  )
                }
                acoes={
                  <>
                    <button
                      onClick={toggleDespacho}
                      role="switch"
                      aria-checked={despachoAberto}
                      title={
                        despachoAberto
                          ? 'Fechar o despacho — os entregadores deixam de ver estes pedidos'
                          : 'Liberar os pedidos prontos para os entregadores pegarem no app'
                      }
                      className="inline-flex items-center gap-2 rounded-[4px] border border-[var(--adm-borda)] bg-white px-2.5 py-1.5 text-[12px] font-semibold text-[var(--adm-texto-medio)] transition-colors hover:border-[var(--adm-borda-forte)]"
                    >
                      <span className={`relative h-4 w-7 rounded-full transition-colors ${despachoAberto ? 'bg-[#10B981]' : 'bg-[#d1d5db]'}`}>
                        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${despachoAberto ? 'left-3.5' : 'left-0.5'}`} />
                      </span>
                      Despacho aberto
                    </button>
                    {selected.size > 0 && (
                      <div className="relative">
                        <Button variant="dispatch" onClick={() => setBulkAssigning((v) => !v)}>
                          Atribuir {selected.size}
                        </Button>
                        {bulkAssigning && (
                          <div className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-[260px] rounded-[6px] border border-[var(--adm-borda)] bg-white p-1 shadow-[var(--adm-sombra-md)]">
                            {nextaAtivo && (
                              <>
                                {/* Uma corrida por pedido: quem combina entregas é o próprio
                                    Nexta (mandamos canCombine), não a gente. */}
                                <OpcaoNexta
                                  rotulo={`Nexta — ${selected.size} corrida${selected.size > 1 ? 's' : ''}`}
                                  detalhe={
                                    totalNextaSelecionado.cotados === 0
                                      ? 'cotando…'
                                      : <>
                                          <span className="font-bold text-price-text">{brl(totalNextaSelecionado.total)}</span>
                                          {totalNextaSelecionado.cotados < selected.size && ` · ${totalNextaSelecionado.cotados} de ${selected.size} cotados`}
                                        </>
                                  }
                                  onClick={despacharNextaEmLote}
                                  disabled={nextaBusy !== null}
                                />
                                <div className="mt-1 border-t border-[var(--adm-borda)] px-3 pb-1 pt-2 text-[11px] font-semibold text-[var(--adm-texto-suave)]">
                                  Meus entregadores
                                </div>
                              </>
                            )}
                            <ListaEntregadoresMenu entregadores={available} onEscolher={assignBulk} />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                }
              />
              <div className="divide-y divide-[var(--adm-borda)]">
                {unassigned.length === 0 && (
                  <Vazio
                    icone={<Package className="h-5 w-5" />}
                    titulo="Nenhum pedido aguardando despacho"
                    texto="Assim que a cozinha marcar um pedido como pronto, ele aparece aqui."
                  />
                )}
                {unassigned.map((order) => (
                  <div
                    key={order.id}
                    className={`flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                      selected.has(order.id) ? 'bg-[var(--adm-azul-claro)]' : 'hover:bg-[var(--adm-superficie-2)]'
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar pedido ${order.numero}`}
                        checked={selected.has(order.id)}
                        onChange={() => toggleSelect(order.id)}
                        className="mt-1 h-4 w-4 flex-shrink-0 rounded border-[var(--adm-borda-forte)] accent-[var(--adm-azul)]"
                      />
                      <div className="min-w-0">
                        <ResumoPedido order={order} />
                        {nextaAtivo && (
                          <div className="mt-2">
                            <ChipNexta estado={cotacoesNexta[order.id]} />
                          </div>
                        )}
                        {/* Voltou pra fila por causa do Nexta: o lojista precisa saber por quê. */}
                        {falhasNexta.has(order.id) && (
                          <div className="mt-2 inline-flex items-center gap-1.5 rounded-[4px] bg-danger-bg px-2 py-1 text-[11px] font-semibold text-danger">
                            <Zap className="h-3 w-3" />
                            {falhasNexta.get(order.id)!.status === 'REJECTED'
                              ? `Nexta recusou: ${motivoRejeicaoTexto(falhasNexta.get(order.id)!.rejeicaoMotivo)}`
                              : 'Corrida do Nexta cancelada'}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="relative flex-shrink-0">
                      <Button
                        variant="dispatch"
                        className="min-h-[36px] w-full gap-1.5 px-4 text-[12px] sm:w-auto"
                        onClick={(e) => {
                          if (assigning === order.id) {
                            setAssigning(null)
                            return
                          }
                          // Num pedido no fim da coluna rolável o menu abriria pra baixo e
                          // ficaria cortado pela borda, escondendo os entregadores próprios.
                          // Medimos o espaço até o container que corta e viramos pra cima.
                          const btn = e.currentTarget
                          let limiteInferior = window.innerHeight
                          let ancestral: HTMLElement | null = btn.parentElement
                          while (ancestral) {
                            const oy = getComputedStyle(ancestral).overflowY
                            if (oy === 'auto' || oy === 'scroll') {
                              limiteInferior = ancestral.getBoundingClientRect().bottom
                              break
                            }
                            ancestral = ancestral.parentElement
                          }
                          setAssignAcima(limiteInferior - btn.getBoundingClientRect().bottom < ALTURA_MENU_ATRIBUIR)
                          setAssigning(order.id)
                        }}
                      >
                        <Bike className="h-4 w-4" /> Atribuir
                      </Button>
                      {assigning === order.id && (
                        <div
                          className={`absolute right-0 z-30 min-w-[260px] rounded-[6px] border border-[var(--adm-borda)] bg-white p-1 shadow-[var(--adm-sombra-md)] ${
                            assignAcima ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]'
                          }`}
                        >
                          {nextaAtivo && (
                            <>
                              <OpcaoNexta
                                rotulo="Nexta"
                                detalhe={detalheCotacao(cotacoesNexta[order.id])}
                                onClick={() => despacharNexta(order.id)}
                                disabled={nextaBusy !== null}
                              />
                              <div className="mt-1 border-t border-[var(--adm-borda)] px-3 pb-1 pt-2 text-[11px] font-semibold text-[var(--adm-texto-suave)]">
                                Meus entregadores
                              </div>
                            </>
                          )}
                          <ListaEntregadoresMenu entregadores={available} onEscolher={(id) => assign(order.id, id)} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            </div>

            {/* Coluna da direita: já despachados, só acompanhamento. */}
            <div className={`min-h-0 flex-1 flex-col gap-4 overflow-y-auto ${colunaMobile === 'rota' ? 'flex' : 'hidden'} lg:flex`}>
            {comNexta.length === 0 && inRoute.length === 0 && (
              <div className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
                <CabecalhoSecao icone={<Truck className="h-4 w-4" strokeWidth={2.2} />} tom="roxo" titulo="Em rota" contador={0} />
                <Vazio
                  icone={<Truck className="h-5 w-5" />}
                  titulo="Nenhum pedido em rota"
                  texto="Os pedidos que você despachar aparecem aqui até serem entregues."
                />
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
                icone={<Truck className="h-4 w-4" strokeWidth={2.2} />}
                tom="roxo"
                titulo="Em rota"
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
            </div>
            </>
            )}

            {tab === 'concluidos' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
              <CabecalhoSecao
                icone={<ClipboardCheck className="h-4 w-4" strokeWidth={2.2} />}
                tom="verde"
                titulo="Pedidos do dia"
                contador={filtrosAtivos ? concluidosFiltrados.length : concluidos.length}
                descricao={filtrosAtivos ? `${concluidosFiltrados.length} de ${concluidos.length} com os filtros aplicados` : 'Entregas e retiradas finalizadas ou canceladas hoje.'}
              />
              <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-[var(--adm-borda)] px-4 py-3">
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
              <div className="min-h-0 flex-1 divide-y divide-[var(--adm-borda)] overflow-y-auto">
                {concluidos.length === 0 && (
                  <Vazio icone={<ClipboardCheck className="h-5 w-5" />} titulo="Nenhum pedido finalizado hoje" texto="Pedidos entregues e cancelados aparecem aqui ao longo do dia." />
                )}
                {concluidos.length > 0 && concluidosFiltrados.length === 0 && (
                  <div className="p-6 text-center text-[13px] text-[var(--adm-texto-suave)]">Nenhum pedido encontrado com esses filtros</div>
                )}
                {concluidosFiltrados.map((order) => {
                  const entregue = order.status === 'entregue'
                  return (
                    // Uma linha por pedido: número, cliente, tipo, onde/quem, pagamento e valor.
                    <div key={order.id} className="flex items-center gap-3 px-4 py-2.5 text-[12.8px] hover:bg-[var(--adm-superficie-2)]">
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${entregue ? 'bg-[#10B981]' : 'bg-danger'}`} title={entregue ? 'Concluído' : 'Cancelado'} />
                      <span className="w-12 flex-shrink-0 font-bold tabular-nums">#{order.numero}</span>
                      <span className="w-[160px] flex-shrink-0 truncate font-semibold">{order.clienteNome || 'Cliente'}</span>
                      <span className="flex-shrink-0">
                        <Badge tone={order.tipo === 'entrega' ? 'alert' : 'paused'}>{order.tipo === 'entrega' ? 'Entrega' : 'Retirada'}</Badge>
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[var(--adm-texto-suave)]">
                        {order.tipo === 'entrega' ? `${endereco(order)} · ${driverName(order.entregadorId)}` : 'Retirada no balcão'}
                      </span>
                      {!entregue && <Badge tone="danger">Cancelado</Badge>}
                      <span className="hidden flex-shrink-0 sm:inline">
                        <Badge tone={order.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{PAY_LABEL[order.formaPagamento]}</Badge>
                      </span>
                      <span className="w-[84px] flex-shrink-0 text-right font-bold tabular-nums text-price-text">{brl(order.total)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            )}
          </section>
          )}
        </div>
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
            <h2 className="text-[15px] font-bold">Novo entregador</h2>
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
                <p className="truncate text-[14px] font-bold text-[var(--adm-texto)]">{novoDriver.nome.trim() || 'Nome do entregador'}</p>
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

      {/* Fechamento de caixa */}
      {closingOpen && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={() => setClosingOpen(false)} />}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[440px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          closingOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">Fechamento de caixa</h2>
            <p className="mt-0.5 text-xs text-text-subtle">Conferência entre o dinheiro esperado e o declarado por entregador.</p>
          </div>
          <button onClick={() => setClosingOpen(false)} className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          <p className="mb-4 text-xs leading-relaxed text-text-subtle">
            Valor esperado = soma dos pedidos pagos em dinheiro (em rota + entregues) de cada entregador. Informe o valor declarado ao
            final da rota para registrar a diferença.
          </p>
          {resumo.length === 0 && (
            <div className="rounded-menuzia border border-dashed border-border p-4 text-center text-xs text-text-subtle">
              Nenhum pedido em dinheiro atribuído a entregadores ainda.
            </div>
          )}
          {resumo.map((r) => {
            const valor = Number((declarado[r.entregadorId] ?? '').replace(/\./g, '').replace(',', '.'))
            const diff = Number.isFinite(valor) && (declarado[r.entregadorId] ?? '') !== '' ? valor - r.valorEsperado : null
            return (
              <div key={r.entregadorId} className="mb-3 rounded-menuzia border border-border p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{r.nome}</h4>
                  <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold text-text-subtle">{r.pedidos} pedido(s)</span>
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-text-subtle">Valor esperado</span><span className="font-medium">{brl(r.valorEsperado)}</span></div>
                  <div className="flex justify-between"><span className="text-text-subtle">Troco levado</span><span className="font-medium">{brl(r.trocoLevado)}</span></div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-text-subtle">Valor declarado</span>
                    <input
                      value={declarado[r.entregadorId] ?? ''}
                      onChange={(e) => setDeclarado((prev) => ({ ...prev, [r.entregadorId]: e.target.value }))}
                      placeholder="0,00"
                      className="w-28 rounded-menuzia border border-border px-2.5 py-1.5 text-right font-sans text-[13px] outline-none focus:border-primary"
                    />
                  </div>
                  {diff !== null && (
                    <div className="flex justify-between border-t border-border pt-1.5 font-bold">
                      <span>Diferença</span>
                      <span className={diff === 0 ? 'text-price-text' : 'text-danger'}>{diff < 0 ? '− ' : ''}{brl(Math.abs(diff))}</span>
                    </div>
                  )}
                </div>
                <Button variant="primary" className="mt-3 w-full" onClick={() => saveClosing(r)} disabled={(declarado[r.entregadorId] ?? '') === ''}>
                  Registrar fechamento
                </Button>
              </div>
            )
          })}
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={() => setClosingOpen(false)}>
            Fechar
          </Button>
        </div>
      </aside>

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
            <h2 className="text-[15px] font-bold">Acesso do entregador</h2>
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
        </div>
      </aside>

      {/* Localização do entregador */}
      {locationDriver && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#111827]/55 p-4" onClick={() => setLocationDriverId(null)}>
          <div className="flex h-[88vh] w-full max-w-4xl flex-col rounded-menuzia bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
              <div>
                <h2 className="text-[15px] font-bold">Localização — {locationDriver.nome}</h2>
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
                  origin={{ lat: locationDriver.localizacao.lat, lng: locationDriver.localizacao.lng }}
                  stops={locationDriverStops}
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
            <h2 className="text-[15px] font-bold">Perfil do entregador</h2>
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
              <div className="flex h-16 w-16 items-center justify-center rounded-menuzia border border-border bg-page text-xl font-bold text-text-subtle">
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
