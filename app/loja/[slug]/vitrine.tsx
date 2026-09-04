'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UtensilsCrossed, CreditCard, Banknote, Pencil, Truck, MapPin, Phone, ChevronDown, Gift, Ticket, Percent, Clock } from 'lucide-react'
import { normalizarBairro } from '@/lib/frete'
import { calcularDesconto, diasSemanaTexto, premioLabelCampanha, fracaoProgresso } from '@/lib/fidelidade-regras'
import type { CupomVitrine, FidelidadeCliente, RecompensaDisponivel } from '@/lib/queries/fidelidade'
import { getVitrineSupabase } from '@/lib/supabase/vitrine'
import {
  buscarRestaurantePorSlug,
  listarBairrosVitrine,
  lojaTemRaioVitrine,
  listarCardapioPublico,
  listarOrderBumpsPublico,
  type GrupoComItens,
  type ItemCardapio,
  type PizzaSabor,
  type LayoutCardapio,
  type RestauranteVitrine,
} from '@/lib/queries/cardapio'
import type { ClientePerfil, EnderecoCliente } from '@/lib/queries/clientes'
import type { PedidoCliente } from '@/lib/queries/pedidos'
import { mascararTelefoneBR, telefoneCompleto } from '@/lib/telefone'
import { capitalizarTexto } from '@/lib/texto'
import { assinaturaPremios, premioDeBoasVindas, type PremioBoasVindas } from '@/lib/premio-boas-vindas'
import { resolverPaleta } from '@/lib/paletas'
import { TAMANHOS_CAPA, srcSetCapa } from '@/lib/imagem'
import {
  listarTamanhosPadraoPizza,
  listarBordasPizza,
  listarMassasPizza,
  type TamanhoPadraoPizza,
  type BordaPizza,
  type MassaPizza,
} from '@/lib/queries/pizza'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CartLine {
  key: string
  itemId: string
  name: string
  imagemUrl: string | null
  qty: number
  unit: number
  addons: { nome: string; preco: number }[]
  obs: string
  tamanhoNome: string
  saborNome: string
  bordaNome: string
  massaNome: string
}

interface ToastItem {
  id: string
  message: string
}

type Tab = 'home' | 'cart' | 'pedidos' | 'cupons'
/** 0 = Resumo do pedido (só no desktop), 1 = Pagamento, 2 = Endereço, 3 = Revisar. */
type CheckoutStep = 0 | 1 | 2 | 3

const ENDERECO_VAZIO: EnderecoCliente = { rua: '', numero: '', complemento: '', bairro: '', cep: '', cidade: '', referencia: '' }

// Cores vivas e sólidas, alinhadas ao Kanban (laranja recebido, azul preparando,
// verde pronto/entregue, azul claro em rota, vermelho cancelado).
const STATUS_PEDIDO_INFO: Record<string, { label: string; cls: string }> = {
  recebido: { label: 'Recebido', cls: 'bg-[#F97316] text-white' },
  preparando: { label: 'Preparando', cls: 'bg-[#024A7D] text-white' },
  pronto: { label: 'Pronto', cls: 'bg-[#16A34A] text-white' },
  em_rota: { label: 'Saiu para entrega', cls: 'bg-[#3B82F6] text-white' },
  entregue: { label: 'Entregue', cls: 'bg-[#15803D] text-white' },
  cancelado: { label: 'Cancelado', cls: 'bg-[#ef4444] text-white' },
}

const PEDIDO_ATIVO = new Set(['recebido', 'preparando', 'pronto', 'em_rota'])

/** Timeline vertical do acompanhamento do pedido, espelhando o status do Kanban/Logística. */
function PedidoTimeline({ status, tipo }: { status: string; tipo: string }) {
  const steps = tipo === 'retirada'
    ? [{ k: 'recebido', l: 'Pedido recebido' }, { k: 'preparando', l: 'Preparando seu pedido' }, { k: 'pronto', l: 'Pronto para retirada' }, { k: 'entregue', l: 'Retirado!' }]
    : [{ k: 'recebido', l: 'Pedido recebido' }, { k: 'preparando', l: 'Preparando seu pedido' }, { k: 'pronto', l: 'Pronto para despacho' }, { k: 'em_rota', l: 'Saiu para entrega' }, { k: 'entregue', l: 'Entregue!' }]
  const statusIdx = steps.findIndex((s) => s.k === status)
  return (
    <div className="mt-3 border-t border-border pt-3.5">
      {steps.map((step, i) => {
        const state = i < statusIdx ? 'done' : i === statusIdx ? 'active' : 'pending'
        return (
          <div key={step.k} className="relative flex gap-3.5 pb-5 last:pb-0">
            {i < steps.length - 1 && <span className={`absolute left-[11px] top-6 h-full w-0.5 ${state === 'done' ? 'bg-status-ready' : 'bg-border'}`} />}
            <span className={['z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2', state === 'done' ? 'border-status-ready bg-status-ready' : state === 'active' ? 'border-status-ready bg-status-ready' : 'border-border bg-white'].join(' ')}>
              {state !== 'pending' && <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>}
            </span>
            <div>
              <div className={`text-[13px] font-semibold ${state === 'pending' ? 'text-text-subtle' : 'text-text-main'}`}>{step.l}</div>
              {state === 'active' && <div className="mt-0.5 text-[12px] text-[var(--tema-primaria)]">Em andamento…</div>}
              {state === 'done' && <div className="mt-0.5 text-[12px] text-status-ready">Concluído</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const brl = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`

const formatarNota = (nota: number) => nota.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Motivo exato retornado pelo POST /cupom/validar quando o cupom exige sessão —
// casado por string pra oferecer o CTA de login em vez de erro genérico (Task 8).
const MOTIVO_LOGIN_CUPOM = 'Entre com seu telefone para usar este cupom.'

/** Rótulo curto do benefício de um cupom da vitrine ("10% de desconto", "Item grátis"…). */
function labelCupom(c: Pick<CupomVitrine, 'tipo' | 'valor' | 'itemNome'>): string {
  switch (c.tipo) {
    case 'item_gratis': return `${c.itemNome ?? 'Item'} grátis`
    case 'entrega_gratis': return 'Entrega grátis'
    case 'desconto_percentual': return `${c.valor ?? 0}% de desconto`
    default: return `${brl(c.valor ?? 0)} de desconto`
  }
}

/**
 * Som curto de sucesso ("moeda/conquista") via Web Audio API — sem asset externo.
 * Dois osciladores em acorde ascendente (~0.3s). Se o AudioContext estiver
 * bloqueado por falta de gesto do usuário, falha em silêncio.
 */
function tocarSomSucesso() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const t0 = ctx.currentTime
    // E5 e G5 levemente defasados: acorde alegre, curto, sem estridência.
    const notas: [number, number][] = [[659.25, 0], [783.99, 0.09]]
    for (const [freq, delay] of notas) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + delay)
      gain.gain.exponentialRampToValueAtTime(0.14, t0 + delay + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.3)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0 + delay)
      osc.stop(t0 + delay + 0.32)
    }
    window.setTimeout(() => { ctx.close().catch(() => {}) }, 800)
  } catch { /* AudioContext indisponível/bloqueado — segue sem som */ }
}

/** Logo oficial do Pix (Banco Central) simplificado. */
function PixIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="#32BCAD" aria-hidden>
      <path d="M11.917 11.71a2.046 2.046 0 0 1-1.454-.602l-2.1-2.1a.4.4 0 0 0-.551 0l-2.108 2.108a2.044 2.044 0 0 1-1.454.602h-.414l2.66 2.66c.83.83 2.177.83 3.007 0l2.667-2.668h-.253zM4.25 4.282c.55 0 1.066.214 1.454.602l2.108 2.108a.39.39 0 0 0 .552 0l2.1-2.1a2.044 2.044 0 0 1 1.453-.602h.253L9.503 1.623a2.127 2.127 0 0 0-3.007 0l-2.66 2.66h.414zM14.377 6.496l-1.612-1.612a.307.307 0 0 1-.114.023h-.733c-.379 0-.75.154-1.017.422l-2.1 2.1a1.005 1.005 0 0 1-1.425 0L5.268 5.32a1.448 1.448 0 0 0-1.018-.422h-.9a.306.306 0 0 1-.109-.021L1.623 6.496c-.83.83-.83 2.177 0 3.008l1.618 1.618a.305.305 0 0 1 .108-.022h.901c.38 0 .75-.153 1.018-.421L7.375 8.57a1.034 1.034 0 0 1 1.426 0l2.1 2.1c.267.268.638.421 1.017.421h.733c.04 0 .079.01.114.024l1.612-1.612c.83-.83.83-2.178 0-3.008" />
    </svg>
  )
}

/**
 * Encurta o texto de próxima abertura pra caber na pílula do cabeçalho:
 * "abre amanhã às 18:00" → "Amanhã 18:00", "abre sábado às 11:00" → "Sáb 11:00".
 */
function abreviarProximaAbertura(texto: string | null): string | null {
  if (!texto) return null
  const abreviacoes: Record<string, string> = {
    domingo: 'Dom', segunda: 'Seg', terça: 'Ter', quarta: 'Qua', quinta: 'Qui', sexta: 'Sex', sábado: 'Sáb',
  }
  const hora = texto.match(/(\d{1,2}:\d{2})/)?.[1] ?? ''
  if (/amanhã/i.test(texto)) return `Amanhã ${hora}`.trim()
  for (const [dia, curto] of Object.entries(abreviacoes)) {
    if (texto.includes(dia)) return `${curto} ${hora}`.trim()
  }
  return hora ? `Abre ${hora}` : texto.charAt(0).toUpperCase() + texto.slice(1)
}

function PriceTag({ price, originalPrice, hideDiscount = false }: { price: number; originalPrice?: number | null; hideDiscount?: boolean }) {
  if (originalPrice && !hideDiscount) {
    const off = Math.round((1 - price / originalPrice) * 100)
    // Em promoção: preço verde (fonte fina), valor antigo riscado e pill de % verde.
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-[15px] font-bold text-promo">{brl(price)}</span>
        <span className="text-[12px] font-normal text-text-subtle line-through">{brl(originalPrice)}</span>
        <span className="rounded bg-promo-bg px-1.5 py-0.5 text-[11px] font-bold text-promo">-{off}%</span>
      </span>
    )
  }
  // Sem desconto: preço neutro (não verde), fonte fina.
  return <span className="text-[15.5px] font-bold text-text-main">{brl(price)}</span>
}

/**
 * Cabeçalho de um grupo de escolhas dentro da ficha do produto (Tamanho, Sabor,
 * Adicionais…). Faixa cinza de ponta a ponta da sheet, com a regra do grupo, o
 * contador de selecionados e a etiqueta obrigatório/opcional — dá âncora visual
 * pra quem rola uma ficha longa e separa um grupo do outro.
 */
function GrupoHeader({ titulo, regra, obrigatorio, contador }: { titulo: string; regra?: string; obrigatorio: boolean; contador?: string }) {
  return (
    <div className="-mx-4.5 mb-2.5 flex items-start justify-between gap-2 border-y border-border bg-[#F9FAFB] px-4.5 py-2.5">
      <div className="min-w-0">
        <h3 className="text-[15px] font-bold leading-tight text-text-main">{titulo}</h3>
        {regra && <div className="mt-0.5 text-[12px] text-text-subtle">{regra}</div>}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {contador && <span className="rounded bg-border px-1.5 py-[3px] text-[10px] font-bold text-text-main">{contador}</span>}
        <span className={['rounded px-2 py-[3px] text-[10px] font-bold uppercase tracking-wide', obrigatorio ? 'bg-[#DC2626] text-white' : 'bg-[#F3F4F6] text-text-subtle'].join(' ')}>
          {obrigatorio ? 'Obrigatório' : 'Opcional'}
        </span>
      </div>
    </div>
  )
}

const TAG_STYLES: Record<string, { label: string; cls: string }> = {
  mais_pedido: { label: 'Mais pedido', cls: 'bg-amber-100 text-amber-700' },
  edicao_limitada: { label: 'Edição limitada', cls: 'bg-pink-100 text-pink-600' },
  novo: { label: 'Novo', cls: 'bg-sky-100 text-sky-700' },
  favorito: { label: 'Favorito da casa', cls: 'bg-purple-100 text-purple-700' },
  promocao: { label: 'Promoção', cls: 'bg-purple-100 text-purple-700' },
}

/**
 * Etiqueta que o item mostra na vitrine. Item com desconto ativo ganha a
 * etiqueta roxa de promoção mesmo quando o lojista não marcou nada no cadastro —
 * é o que faz a oferta ser vista na lista.
 */
export function tagDoItem(item: { tag: string | null; promocaoPreco: number | null }): string | null {
  return item.tag ?? (item.promocaoPreco !== null ? 'promocao' : null)
}

/** Pílula de etiqueta do item na vitrine (configurada no cadastro). */
function TagBadge({ tag }: { tag: string | null }) {
  if (!tag) return null
  const s = TAG_STYLES[tag]
  if (!s) return null
  return (
    <span className={`inline-block w-fit rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.cls}`}>
      {s.label}
    </span>
  )
}

/**
 * O que basta para desenhar a foto de um item. `imagemThumbUrl` é opcional
 * porque prêmios de fidelidade, cupons e linhas do carrinho carregam só a URL
 * cheia — nesses casos o fallback resolve.
 */
type FotoDeItem = { nome: string; imagemUrl: string | null; imagemThumbUrl?: string | null }

/**
 * Foto que aparece numa listagem. Usa a miniatura de 400 px; quando o item ainda
 * não tem uma (cadastro antigo), cai na full — que é o que sempre foi exibido.
 */
function urlDeListagem(item: FotoDeItem): string | null {
  return item.imagemThumbUrl ?? item.imagemUrl
}

function ProductThumb({ item, size = 96, fallbackIcon: FallbackIcon = UtensilsCrossed }: { item: FotoDeItem; size?: number; fallbackIcon?: typeof UtensilsCrossed }) {
  const src = urlDeListagem(item)
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={item.nome}
        // Thumb de listagem: só baixa quando chega perto da viewport. O cardápio
        // inteiro fica no DOM de uma vez, então sem isso o browser buscaria
        // todas as fotos no primeiro paint.
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        className="flex-shrink-0 rounded object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded border border-[#E5E7EB] bg-[#F3F4F6]"
      style={{ width: size, height: size }}
    >
      <FallbackIcon style={{ width: size * 0.4, height: size * 0.4 }} className="text-[#9CA3AF]" strokeWidth={1.75} />
    </div>
  )
}

/** Ícone de fallback do thumb de prêmio/cupom quando não há foto — "%" para descontos, caminhão pra frete grátis, talheres pra item. */
function iconePremio(tipo: 'item_gratis' | 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis'): typeof UtensilsCrossed {
  if (tipo === 'desconto_percentual' || tipo === 'desconto_valor') return Percent
  if (tipo === 'entrega_gratis') return Truck
  return UtensilsCrossed
}

/**
 * Foto de produto. `prioritaria` só é usada quando a imagem é o próprio LCP da
 * página (a colagem que substitui o banner da loja quando ela não tem capa);
 * em qualquer listagem o padrão é lazy.
 */
function ProductImage({ item, className = '', prioritaria = false }: { item: FotoDeItem; className?: string; prioritaria?: boolean }) {
  // Prioritária = está substituindo a capa da loja, ocupando a largura toda:
  // aí vale a full. Nos cards de listagem, a miniatura basta.
  const src = prioritaria ? item.imagemUrl : urlDeListagem(item)
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={item.nome}
        loading={prioritaria ? 'eager' : 'lazy'}
        decoding="async"
        {...(prioritaria ? { fetchPriority: 'high' as const } : {})}
        className={`object-cover ${className}`}
      />
    )
  }
  return (
    <div className={`flex items-center justify-center bg-[#F3F4F6] ${className}`}>
      <UtensilsCrossed className="h-1/3 w-1/3 text-[#9CA3AF]" strokeWidth={1.75} />
    </div>
  )
}

function ProductCard({ item, onClick, className = '', compact = false }: { item: ItemCardapio; onClick: () => void; className?: string; compact?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col overflow-hidden rounded-md border border-border bg-white text-left shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] ${className}`}
    >
      <div className={`relative ${compact ? 'aspect-square' : 'aspect-[4/3]'} w-full overflow-hidden rounded-t-md`}>
        <ProductImage item={item} className="h-full w-full transition-transform duration-300 group-hover:scale-105" />
        {/* Etiqueta sobre a foto (não acima do nome) */}
        {tagDoItem(item) && (
          <span className="absolute left-2.5 top-2.5 shadow-sm">
            <TagBadge tag={tagDoItem(item)} />
          </span>
        )}
        {item.maisVendido && (
          <span className={`absolute left-2.5 ${tagDoItem(item) ? 'top-9' : 'top-2.5'} rounded bg-pink-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-pink-600 shadow-sm`}>Mais vendido</span>
        )}
      </div>
      <div className={compact ? 'flex flex-col gap-0.5 p-2.5' : 'flex flex-1 flex-col gap-1 p-3'}>
        <div className={`${compact ? 'line-clamp-1' : 'line-clamp-2'} text-[14px] font-bold leading-snug text-text-main`}>{item.nome}</div>
        {item.descricao && !compact && (
          <p className="line-clamp-2 text-[12px] leading-relaxed text-text-subtle">{item.descricao}</p>
        )}
        <div className={compact ? 'pt-0.5' : 'pt-1'}>
          <PriceTag price={item.promocaoPreco ?? item.preco} originalPrice={item.promocaoPreco ? item.preco : null} />
        </div>
      </div>
    </button>
  )
}

function ProductListRow({ item, onClick, imagemGrande = false }: { item: ItemCardapio; onClick: () => void; imagemGrande?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-border bg-white px-3 py-3 text-left transition-colors last:border-none hover:bg-[#F9FAFB] active:bg-[#F3F4F6]"
    >
      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-[14px] font-bold leading-snug text-text-main">{item.nome}</div>
        {item.descricao && (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-text-subtle">{item.descricao}</p>
        )}
        <div className="mt-1.5">
          <PriceTag price={item.promocaoPreco ?? item.preco} originalPrice={item.promocaoPreco ? item.preco : null} />
        </div>
      </div>
      <div className="relative flex-shrink-0">
        <ProductThumb item={item} size={imagemGrande ? 100 : 76} />
        {/* Etiqueta sobre a foto (não acima do nome) */}
        {tagDoItem(item) && (
          <span className="absolute left-1 top-1 shadow-sm">
            <TagBadge tag={tagDoItem(item)} />
          </span>
        )}
        {item.maisVendido && (
          <span className={`absolute left-1 ${tagDoItem(item) ? 'bottom-1' : 'top-1'} rounded bg-pink-100 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-pink-600 shadow-sm`}>Mais vendido</span>
        )}
      </div>
    </button>
  )
}

function ItemsGrid({ items, layout, onSelect, imagemGrande = false }: { items: ItemCardapio[]; layout: LayoutCardapio; onSelect: (item: ItemCardapio) => void; imagemGrande?: boolean }) {
  if (layout === 'lista') {
    return (
      <div className="overflow-hidden rounded border border-border bg-white">
        {items.map((item) => (
          <ProductListRow key={item.id} item={item} onClick={() => onSelect(item)} imagemGrande={imagemGrande} />
        ))}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4 xl:grid-cols-4">
      {items.map((item) => (
        <ProductCard key={item.id} item={item} onClick={() => onSelect(item)} />
      ))}
    </div>
  )
}

/**
 * Seletor de bairro com busca e lista completa. Digitar filtra os bairros
 * atendidos (sem diferenciar acento/caixa); a setinha à direita abre a lista
 * inteira pra quem prefere só tocar e escolher. Em modo estrito (lista
 * fechada) só um bairro da lista vale como válido.
 */
function BairroAutocomplete({ value, onChange, opcoes, estrito, compacto }: {
  value: string
  onChange: (v: string) => void
  opcoes: string[]
  estrito: boolean
  compacto?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [mostrarTodos, setMostrarTodos] = useState(false)
  const alvo = normalizarBairro(value)
  const filtradas = alvo ? opcoes.filter((b) => normalizarBairro(b).includes(alvo)) : opcoes
  const exato = opcoes.some((b) => normalizarBairro(b) === alvo)
  // Sem match pro que foi digitado → mostra a lista inteira (melhor do que "nada").
  const semMatch = alvo !== '' && filtradas.length === 0
  const lista = mostrarTodos || semMatch ? opcoes : filtradas

  function selecionar(b: string) {
    onChange(b)
    setAberto(false)
    setMostrarTodos(false)
  }

  const inputCls = compacto
    ? 'w-full rounded border border-border p-2.5 pr-10 font-sans text-sm outline-none focus:border-[var(--tema-primaria)]'
    : 'w-full rounded-md border border-border p-3 pr-11 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]'

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setAberto(true); setMostrarTodos(false) }}
        onFocus={() => setAberto(true)}
        onBlur={() => { window.setTimeout(() => { setAberto(false); setMostrarTodos(false) }, 150) }}
        placeholder="Digite ou toque na seta"
        autoComplete="off"
        className={inputCls}
      />
      {/* Setinha: abre/fecha a lista completa de bairros atendidos. pointerdown
          com preventDefault pra não roubar o foco do input (evita corrida com o blur). */}
      <button
        type="button"
        aria-label="Ver lista de bairros atendidos"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => { setMostrarTodos(true); setAberto((a) => !a) }}
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-text-subtle hover:text-text-main"
      >
        <ChevronDown className={['h-5 w-5 transition-transform', aberto ? 'rotate-180' : ''].join(' ')} strokeWidth={2.2} />
      </button>
      {aberto && lista.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[240px] overflow-y-auto rounded-md border border-border bg-white shadow-lg">
          <div className="sticky top-0 border-b border-border bg-[#F9FAFB] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
            {/* Fora do modo estrito a loja também entrega por raio: um bairro que
                não está na lista continua válido, e chamar isso de "não
                encontrado" fazia o cliente achar que estava barrado. */}
            {!semMatch ? 'Bairros atendidos' : estrito ? 'Bairro não encontrado — veja os atendidos' : 'Não está na lista — seguimos pela distância'}
          </div>
          {lista.map((b) => {
            const selecionado = normalizarBairro(b) === alvo
            return (
              <button
                key={b}
                type="button"
                onPointerDown={(e) => { e.preventDefault(); selecionar(b) }}
                onClick={() => selecionar(b)}
                className={['block w-full px-3 py-2.5 text-left text-[14px] hover:bg-[#F3F4F6]', selecionado ? 'bg-[#F0F9FF] font-semibold text-[var(--tema-primaria)]' : ''].join(' ')}
              >
                {b}
              </button>
            )
          })}
        </div>
      )}
      {estrito && value.trim() !== '' && !exato && !aberto && (
        <p className="mt-1.5 text-[12px] font-medium text-danger">
          Não achamos esse bairro.{' '}
          <button type="button" onClick={() => { setMostrarTodos(true); setAberto(true) }} className="underline">
            Toque aqui pra ver os bairros atendidos
          </button>
        </p>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Corpo da vitrine. Recebe do servidor o restaurante já resolvido — é o que
 * permite pintar o cabeçalho (capa, logo, nome, status) na primeira renderização
 * em vez de esperar a query de `restaurantes` voltar.
 */
export default function Vitrine({ slug, restauranteInicial }: { slug: string; restauranteInicial: RestauranteVitrine }) {
  const supabase = useMemo(() => getVitrineSupabase(), [])

  // ── Data ──────────────────────────────────────────────────────────────────
  // O cabeçalho já veio pronto do servidor: nada de estado de carregamento pra ele.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restaurante, setRestaurante] = useState<RestauranteVitrine | null>(restauranteInicial)
  const [groups, setGroups] = useState<GrupoComItens[]>([])
  const [bairros, setBairros] = useState<{ bairro: string; taxa: number }[]>([])
  const [temRaio, setTemRaio] = useState(false)
  const [orderBumps, setOrderBumps] = useState<ItemCardapio[]>([])
  const [tamanhosPizza, setTamanhosPizza] = useState<TamanhoPadraoPizza[]>([])
  const [bordasPizza, setBordasPizza] = useState<BordaPizza[]>([])
  const [massasPizza, setMassasPizza] = useState<MassaPizza[]>([])

  // Contador de refresh: incrementado quando a aba volta ao foco, para que
  // alterações feitas no admin (item pausado, destaque removido) apareçam sem
  // o cliente precisar recarregar a página na mão.
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const isRefresh = refreshTick > 0
    async function load() {
      if (!isRefresh) setLoading(true)
      setError(null)
      try {
        // A loja já veio do servidor, então o cardápio parte junto com tudo o
        // mais em vez de esperar uma query de `restaurantes` que bloqueava as
        // outras sete — era essa fila que mais atrasava o primeiro paint.
        const loja = restauranteInicial
        const [cardapio, taxasBairro, temRaioLoja, bumps, tamanhosPizzaData, bordasData, massasData, lojaAtual] =
          await Promise.all([
            listarCardapioPublico(supabase, loja.id),
            listarBairrosVitrine(supabase, loja.id),
            lojaTemRaioVitrine(supabase, loja.id),
            listarOrderBumpsPublico(supabase, loja.id, loja.orderBumpMax),
            listarTamanhosPadraoPizza(supabase, loja.id),
            listarBordasPizza(supabase, loja.id),
            listarMassasPizza(supabase, loja.id),
            // Revalida a loja em paralelo: o HTML pode ter sido servido de cache
            // e "aberto/fechado" muda com o relógio.
            isRefresh ? buscarRestaurantePorSlug(supabase, slug) : Promise.resolve(null),
          ])
        if (cancelled) return
        if (lojaAtual) setRestaurante(lojaAtual)
        setGroups(cardapio)
        setBairros(taxasBairro)
        setTemRaio(temRaioLoja)
        setOrderBumps(bumps)
        setTamanhosPizza(tamanhosPizzaData)
        setBordasPizza(bordasData)
        setMassasPizza(massasData)
      } catch {
        // Num refresh silencioso mantemos o cardápio já carregado na tela.
        if (!cancelled && !isRefresh) setError('Não foi possível carregar o cardápio agora. Tente novamente em instantes.')
      } finally {
        if (!cancelled && !isRefresh) setLoading(false)
      }
    }
    if (slug) load()
    return () => { cancelled = true }
  }, [supabase, slug, refreshTick, restauranteInicial])

  // Revalida o cardápio quando a aba volta a ficar visível (no máximo 1x a cada 30s).
  useEffect(() => {
    let ultimo = Date.now()
    function aoVoltar() {
      if (document.visibilityState !== 'visible') return
      const agora = Date.now()
      if (agora - ultimo < 30_000) return
      ultimo = agora
      setRefreshTick((t) => t + 1)
    }
    document.addEventListener('visibilitychange', aoVoltar)
    window.addEventListener('focus', aoVoltar)
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar)
      window.removeEventListener('focus', aoVoltar)
    }
  }, [])

  // ── Tracking pixel injection ───────────────────────────────────────────────
  useEffect(() => {
    if (!restaurante) return
    const { facebookPixelId: pixelId, googleTagId: tagId } = restaurante
    const scripts: HTMLScriptElement[] = []
    if (pixelId) {
      const s = document.createElement('script')
      s.id = 'fb-pixel'
      s.innerHTML = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`
      document.head.appendChild(s)
      scripts.push(s)
    }
    if (tagId) {
      const s = document.createElement('script')
      s.id = 'google-tag'
      s.async = true
      s.src = `https://www.googletagmanager.com/gtag/js?id=${tagId}`
      document.head.appendChild(s)
      scripts.push(s)
      const s2 = document.createElement('script')
      s2.id = 'google-tag-init'
      s2.innerHTML = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${tagId}');`
      document.head.appendChild(s2)
      scripts.push(s2)
    }
    return () => scripts.forEach((el) => el.parentNode?.removeChild(el))
  }, [restaurante])

  // ── Derived ───────────────────────────────────────────────────────────────
  const allItems = useMemo(() => groups.flatMap((g) => g.itens), [groups])
  const promoItems = useMemo(() => allItems.filter((item) => item.promocaoPreco !== null), [allItems])
  // Destaques respeitam só o que a loja marcou explicitamente como "Item em
  // destaque" no admin. Sem fallback: se o dono desmarca o último item, a seção
  // some — antes ela reaparecia com o primeiro item de cada grupo, o que fazia
  // parecer que desmarcar não tinha efeito nenhum.
  const destaques = useMemo(
    () => allItems.filter((item) => item.maisVendido).slice(0, 12),
    [allItems],
  )
  const collageImages = useMemo(() => allItems.filter((item) => item.imagemUrl).slice(0, 3), [allItems])

  // ── Navigation ────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('home')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)

  useEffect(() => {
    if (!activeCategory && groups.length > 0) setActiveCategory(groups[0].nome)
  }, [groups, activeCategory])

  // ── Cart ──────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartLine[]>([])
  // A sacola só passa a ser gravada depois de restaurada — senão o `[]` inicial
  // sobrescreveria o carrinho salvo antes de o efeito de leitura rodar.
  const [cartRestaurado, setCartRestaurado] = useState(false)

  /**
   * Sacola guardada no aparelho.
   *
   * Ela vivia só na memória: qualquer recarga (o "puxar pra baixo" do Android,
   * o navegador descartando a aba, o cliente saindo e voltando) apagava o
   * pedido inteiro e a compra morria ali. O prazo de 24h evita ressuscitar uma
   * sacola de dias atrás, com preços e itens que provavelmente mudaram.
   */
  useEffect(() => {
    if (!slug) return
    try {
      const raw = localStorage.getItem(`menuzia_carrinho_${slug}`)
      if (raw) {
        const salvo = JSON.parse(raw) as { em?: number; linhas?: CartLine[] }
        const fresco = typeof salvo.em === 'number' && Date.now() - salvo.em < 24 * 60 * 60 * 1000
        if (fresco && Array.isArray(salvo.linhas) && salvo.linhas.length > 0) setCart(salvo.linhas)
      }
    } catch { /* dado inválido: começa com a sacola vazia */ }
    setCartRestaurado(true)
  }, [slug])

  useEffect(() => {
    if (!slug || !cartRestaurado) return
    try {
      if (cart.length === 0) localStorage.removeItem(`menuzia_carrinho_${slug}`)
      else localStorage.setItem(`menuzia_carrinho_${slug}`, JSON.stringify({ em: Date.now(), linhas: cart }))
    } catch { /* quota/navegação privada */ }
  }, [slug, cart, cartRestaurado])

  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0)
  const subtotal = cart.reduce((sum, l) => sum + l.unit * l.qty, 0)

  // ── Cupom / prêmio de fidelidade (hoisted: fee/total dependem do desconto) ──
  const [fidelidade, setFidelidade] = useState<FidelidadeCliente | null>(null)
  // Bump força re-fetch da fidelidade (ex.: pedido acabou de virar "entregue", ou retry manual).
  const [fidelidadeVersao, setFidelidadeVersao] = useState(0)
  // Fetch falhou sem nenhum dado em mãos ainda — aba Cupons mostra erro + botão de retry.
  const [fidelidadeErro, setFidelidadeErro] = useState(false)
  // Botão Cupons do bottom nav piscando (3x) após ganhar progresso/prêmio.
  const [cuponsPiscando, setCuponsPiscando] = useState(false)
  // Benefício anunciado no modal de boas-vindas (null = nada a anunciar agora).
  const [premioModal, setPremioModal] = useState<PremioBoasVindas | null>(null)
  const [cupomCodigoInput, setCupomCodigoInput] = useState('')
  const [cupomValidando, setCupomValidando] = useState(false)
  const [cupomErro, setCupomErro] = useState<string | null>(null)
  // Cupom aprovado pelo POST /cupom/validar (shape da resposta da Task 8).
  const [cupomAplicado, setCupomAplicado] = useState<{
    codigo: string
    tipo: 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis' | 'item_gratis'
    valor: number | null
    descricao: string
    itemNome?: string
  } | null>(null)
  // Prêmio de fidelidade escolhido na aba Cupons (exclusivo com cupomAplicado).
  const [recompensaSelecionada, setRecompensaSelecionada] = useState<RecompensaDisponivel | null>(null)

  // Benefício ativo (prêmio tem prioridade — os dois nunca coexistem, ver handlers).
  const beneficio = recompensaSelecionada
    ? { tipo: recompensaSelecionada.premioTipo, valor: recompensaSelecionada.premioValor, itemNome: recompensaSelecionada.premioItemNome }
    : cupomAplicado
      ? { tipo: cupomAplicado.tipo, valor: cupomAplicado.valor, itemNome: cupomAplicado.itemNome }
      : null

  // PREVIEW do desconto no client — mesma regra do servidor (calcularDesconto:
  // nunca negativo, nunca maior que o subtotal; entrega_gratis zera o frete;
  // item_gratis não desconta em R$). O servidor recalcula tudo e é a autoridade.
  const { descontoSubtotal: desconto, zeraFrete } = beneficio
    ? calcularDesconto(beneficio.tipo, beneficio.valor, subtotal, 0)
    : { descontoSubtotal: 0, zeraFrete: false }

  // ── Checkout form state (hoisted so fee can access endereco) ───────────────
  // ── Canal do pedido: entrega ou retirada ──────────────────────────────────
  // A vitrine só sabia vender entrega. Loja que não tem entregador (ou que só
  // atende no balcão) ligava a retirada em Ajustes › Entrega e passa a oferecer
  // a escolha aqui. Quando só um canal está ligado, não há escolha a fazer: o
  // checkout usa esse e não mostra o seletor.
  const aceitaEntrega = restaurante?.aceitaEntrega ?? true
  const aceitaRetirada = restaurante?.aceitaRetirada ?? false
  const [tipoPedido, setTipoPedido] = useState<'entrega' | 'retirada'>('entrega')

  // A loja pode desligar a entrega depois que a aba já estava aberta — mantém o
  // tipo escolhido dentro do que ela aceita.
  useEffect(() => {
    if (tipoPedido === 'entrega' && !aceitaEntrega && aceitaRetirada) setTipoPedido('retirada')
    if (tipoPedido === 'retirada' && !aceitaRetirada && aceitaEntrega) setTipoPedido('entrega')
  }, [tipoPedido, aceitaEntrega, aceitaRetirada])

  // A cidade mora DENTRO do endereço. Ela já viveu numa variável separada, e
  // qualquer caminho que preenchesse o endereço sem passar pelo CEP (perfil
  // salvo, endereço do último pedido) deixava a cidade vazia — o geocode do
  // frete recebia "Rua X, 100, Bairro" e o Google resolvia a rua em outro
  // município. Junto do endereço, ela não tem como se perder no caminho.
  const [endereco, setEndereco] = useState<EnderecoCliente>(ENDERECO_VAZIO)
  const [cepBuscando, setCepBuscando] = useState(false)
  // CEP retornou bairro que a loja não atende (lista fechada) — orienta a escolher da lista.
  const [cepSemBairro, setCepSemBairro] = useState(false)
  // Endereço veio salvo (último pedido neste aparelho ou perfil logado): o checkout
  // mostra um resumo com "Trocar endereço" em vez do formulário aberto.
  const [enderecoSalvoOrigem, setEnderecoSalvoOrigem] = useState(false)
  const [mostrarFormEndereco, setMostrarFormEndereco] = useState(false)

  // Frete resolvido pelo servidor: bairro tem prioridade; senão faixa de raio; senão taxa padrão.
  const [freteCalc, setFreteCalc] = useState<{ taxa: number; entregavel: boolean; fonte: 'bairro' | 'raio' | 'padrao'; distanciaKm: number | null; motivo?: string } | null>(null)
  const [freteStatus, setFreteStatus] = useState<'idle' | 'calculando' | 'ok' | 'erro'>('idle')

  // Fallback instantâneo por bairro enquanto o servidor responde (ou se ele falhar).
  const feeFallback = useMemo(() => {
    const alvo = normalizarBairro(endereco.bairro)
    const match = bairros.find((b) => normalizarBairro(b.bairro) === alvo)
    if (match) return match.taxa
    if (bairros.length > 0 && !temRaio) return 0 // lista fechada: fora da lista não há frete
    return restaurante?.taxaEntregaPadrao ?? 0
  }, [restaurante, bairros, temRaio, endereco.bairro])

  const entregavel = freteCalc ? freteCalc.entregavel : true

  // Lista fechada: a loja cadastrou bairros e não usa raio — só entrega nos bairros da lista.
  const listaFechada = bairros.length > 0 && !temRaio
  const bairroValido =
    !listaFechada || bairros.some((b) => normalizarBairro(b.bairro) === normalizarBairro(endereco.bairro))

  // Entrega grátis quando o subtotal atinge o mínimo configurado pela loja.
  const freteGratisMinimo = restaurante?.freteGratisAcima ?? null
  const freteGratisAtivo = freteGratisMinimo !== null && freteGratisMinimo > 0
  const ganhouFreteGratis = freteGratisAtivo && subtotal >= freteGratisMinimo

  const feeBase = freteCalc ? (freteCalc.entregavel ? freteCalc.taxa : 0) : feeFallback
  // Cupom/prêmio de entrega grátis zera a taxa por cima do gatilho por subtotal.
  // Retirada não tem frete nenhum.
  const fee = tipoPedido === 'retirada' || ganhouFreteGratis || zeraFrete ? 0 : feeBase

  /**
   * O que escrever na linha "Taxa de entrega". Um número só aparece quando ele
   * é verdade: endereço em branco, cálculo em andamento, endereço fora da área
   * e falha de rede têm cada um o seu texto. `null` = mostra o valor em R$.
   */
  const freteRotulo: string | null =
    tipoPedido === 'retirada'
      ? null
      : ganhouFreteGratis || zeraFrete
        ? null
        : freteStatus === 'idle'
          ? 'A calcular'
          : freteStatus === 'calculando'
            ? 'Calculando…'
            : freteStatus === 'erro'
              ? 'Confirmaremos com você'
              : freteCalc && !freteCalc.entregavel
                ? 'Fora da área'
                : null

  // O total só soma a taxa quando ela é um valor confirmado (`freteRotulo` nulo).
  // Somar o palpite enquanto a linha diz "A calcular" deixava a conta sem fechar
  // na tela: subtotal 14 + "a calcular" = total 17.
  const total = Math.max(0, subtotal - desconto) + (cart.length && !freteRotulo ? fee : 0)

  // Autopreenche rua/bairro/cidade ao digitar o CEP (ViaCEP).
  // `alvo` escolhe qual endereço recebe o preenchimento: o do checkout (padrão)
  // ou o endereço salvo do modal "Minha conta".
  async function autofillCep(cepRaw: string, alvo: 'checkout' | 'conta' = 'checkout') {
    const cep = cepRaw.replace(/\D/g, '')
    if (cep.length !== 8) return
    setCepBuscando(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
      const data = await res.json()
      if (!data.erro) {
        const bairroCep = String(data.bairro || '')
        // Usa a grafia cadastrada pela loja quando o bairro do CEP é atendido.
        const m = bairroCep ? bairros.find((b) => normalizarBairro(b.bairro) === normalizarBairro(bairroCep)) : undefined
        const semMatch = listaFechada && bairroCep !== '' && !m
        const aplicar = (a: EnderecoCliente): EnderecoCliente => ({
          ...a,
          rua: data.logradouro || a.rua,
          // Sem match na lista fechada: limpa pra forçar a escolha na lista.
          bairro: m ? m.bairro : semMatch ? '' : bairroCep || a.bairro,
          cidade: String(data.localidade || '') || a.cidade,
        })
        if (alvo === 'conta') setContaEndereco(aplicar)
        else setEndereco(aplicar)
        setCepSemBairro(semMatch)
      }
    } catch {
      /* mantém o que o cliente já digitou */
    } finally {
      setCepBuscando(false)
    }
  }

  // Recalcula o frete (servidor) quando o endereço muda — com debounce.
  // O status é explícito porque o resumo precisa distinguir "ainda não sei"
  // de "não deu pra calcular" de "R$ 0,00 de verdade". Antes tudo virava um
  // `null` silencioso e o cliente lia "Taxa de entrega R$ 0,00" num endereço
  // que a loja nem atende.
  useEffect(() => {
    if (!slug || tipoPedido !== 'entrega') { setFreteCalc(null); setFreteStatus('idle'); return }
    const cep = endereco.cep.replace(/\D/g, '')
    const temBase = cep.length === 8 || endereco.bairro.trim() !== ''
    if (!temBase) { setFreteCalc(null); setFreteStatus('idle'); return }
    let cancel = false
    setFreteStatus('calculando')
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/loja/${slug}/frete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cep, rua: endereco.rua, numero: endereco.numero, bairro: endereco.bairro, cidade: endereco.cidade }),
        })
        if (!res.ok) { if (!cancel) { setFreteCalc(null); setFreteStatus('erro') } return }
        const data = await res.json()
        if (!cancel) { setFreteCalc(data); setFreteStatus('ok') }
      } catch {
        if (!cancel) { setFreteCalc(null); setFreteStatus('erro') }
      }
    }, 600)
    return () => { cancel = true; clearTimeout(t) }
  }, [slug, tipoPedido, endereco.cep, endereco.bairro, endereco.rua, endereco.numero, endereco.cidade])

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<ToastItem[]>([])
  function showToast(message: string) {
    const id = Date.now().toString()
    setToasts((prev) => [...prev, { id, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2600)
  }

  // ── Calculadora de frete (CEP) — usada no checkout ─────────────────────────
  const [freteOpen, setFreteOpen] = useState(false)
  const [freteCep, setFreteCep] = useState('')
  const [freteLoading, setFreteLoading] = useState(false)
  const [freteError, setFreteError] = useState<string | null>(null)
  const [freteResult, setFreteResult] = useState<{ rua: string; bairro: string; cidade: string; taxa: number } | null>(null)

  async function calcularFrete() {
    const cepLimpo = freteCep.replace(/\D/g, '')
    if (cepLimpo.length !== 8) {
      setFreteError('Digite um CEP válido (8 dígitos).')
      return
    }
    setFreteLoading(true)
    setFreteError(null)
    setFreteResult(null)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`)
      const data = await res.json()
      if (data.erro) {
        setFreteError('CEP não encontrado.')
        return
      }
      const rua = (data.logradouro as string) || ''
      const bairro = (data.bairro as string) || ''
      const cidade = (data.localidade as string) || ''
      // A taxa vem do servidor (mesma regra do checkout: bairro/raio/padrão e
      // menor valor) — nada de recalcular no cliente com regra própria.
      const freteRes = await fetch(`/api/loja/${slug}/frete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cep: cepLimpo, rua, bairro, cidade }),
      })
      if (!freteRes.ok) {
        setFreteError('Não foi possível calcular o frete agora. Tente novamente.')
        return
      }
      const decisao = (await freteRes.json()) as { entregavel: boolean; taxa: number; motivo?: string }
      if (!decisao.entregavel) {
        setFreteError(decisao.motivo || 'A loja não entrega nesse endereço.')
        return
      }
      setFreteResult({ rua, bairro, cidade, taxa: decisao.taxa })
    } catch {
      setFreteError('Não foi possível consultar o CEP agora. Tente novamente.')
    } finally {
      setFreteLoading(false)
    }
  }

  function usarEnderecoDoFrete() {
    if (!freteResult) return
    setEndereco((prev) => ({
      ...prev,
      rua: freteResult.rua || prev.rua,
      bairro: freteResult.bairro || prev.bairro,
      cep: freteCep.replace(/\D/g, ''),
    }))
    setFreteOpen(false)
    showToast('Endereço preenchido! Confira no checkout.')
  }

  // ── Tema de cores (definido pelo admin em Ajustes → Aparência) ────────────
  const paleta = resolverPaleta(restaurante?.corTema ?? 'azul')

  // ── Conta do cliente (login por código enviado via WhatsApp) ───────────────
  const [clienteSessao, setClienteSessao] = useState<{ telefone: string; token: string } | null>(null)
  const [perfilCliente, setPerfilCliente] = useState<ClientePerfil | null>(null)
  const [contaOpen, setContaOpen] = useState(false)
  const [contaStep, setContaStep] = useState<'telefone' | 'codigo'>('telefone')
  const [contaTelefone, setContaTelefone] = useState('')
  const [contaCodigo, setContaCodigo] = useState('')
  const [contaNome, setContaNome] = useState('')
  const [contaEndereco, setContaEndereco] = useState<EnderecoCliente>(ENDERECO_VAZIO)
  const [contaLoading, setContaLoading] = useState(false)
  const [contaError, setContaError] = useState<string | null>(null)
  const [contaSaved, setContaSaved] = useState(false)
  const [contaEditando, setContaEditando] = useState(false)

  // Restaura sessão salva no navegador. Mesmo quem saiu da conta tem o último
  // telefone guardado: o campo de login já vem preenchido na próxima visita, que
  // é o único dado que o cliente precisa digitar pra voltar.
  useEffect(() => {
    if (!slug) return
    try {
      const raw = localStorage.getItem(`menuzia_cliente_${slug}`)
      if (raw) {
        const sessao = JSON.parse(raw)
        if (sessao?.telefone && sessao?.token) setClienteSessao(sessao)
      }
      const ultimo = localStorage.getItem(`menuzia_telefone_${slug}`)
      if (ultimo) setContaTelefone(mascararTelefoneBR(ultimo))
    } catch { /* sessão inválida, ignora */ }
  }, [slug])

  /**
   * Completa a cidade com a da loja quando o endereço não traz uma.
   *
   * A loja é local: quase todo cliente mora na mesma cidade dela, e a cidade é
   * o que o geocode do frete precisa pra não confundir ruas homônimas de
   * municípios vizinhos. Aplicado em TODA origem de endereço (perfil, último
   * pedido do aparelho) — um efeito separado só cobriria a primeira delas.
   */
  const cidadeDaLoja = restaurante?.cidade?.trim() ?? ''
  const comCidadePadrao = useCallback(
    (e: EnderecoCliente): EnderecoCliente => (e.cidade.trim() ? e : { ...e, cidade: cidadeDaLoja }),
    [cidadeDaLoja]
  )

  // Lembra o último endereço confirmado neste aparelho: pré-preenche o checkout
  // mesmo sem conta (o perfil logado, quando carregar, sobrescreve).
  useEffect(() => {
    if (!slug) return
    try {
      const raw = localStorage.getItem(`menuzia_endereco_${slug}`)
      if (!raw) return
      const salvo = JSON.parse(raw)
      if (salvo?.endereco?.rua || salvo?.endereco?.bairro) {
        // `salvo.cidade` é o formato antigo (cidade fora do endereço) — ainda
        // existe no aparelho de quem pediu antes desta versão.
        const cidadeSalva = salvo.endereco?.cidade || salvo.cidade || ''
        setEndereco((a) => (a.rua || a.bairro ? a : comCidadePadrao({ ...ENDERECO_VAZIO, ...salvo.endereco, cidade: cidadeSalva })))
        setEnderecoSalvoOrigem(true)
      }
      if (salvo?.nome || salvo?.telefone) {
        setCliente((c) => ({ nome: c.nome || salvo.nome || '', telefone: c.telefone || salvo.telefone || '' }))
      }
    } catch { /* dado inválido, ignora */ }
  }, [slug, comCidadePadrao])

  // Carrega o perfil salvo e pré-preenche o checkout.
  useEffect(() => {
    if (!clienteSessao || !slug) return
    let cancelled = false
    fetch(`/api/loja/${slug}/conta?telefone=${encodeURIComponent(clienteSessao.telefone)}&token=${encodeURIComponent(clienteSessao.token)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ClientePerfil | null) => {
        if (cancelled) return
        if (!data) {
          localStorage.removeItem(`menuzia_cliente_${slug}`)
          setClienteSessao(null)
          return
        }
        setPerfilCliente(data)
        setContaNome(data.nome)
        setContaEndereco(comCidadePadrao(data.endereco))
        setContaEditando(!data.nome && !data.endereco.rua)
        setCliente((c) => ({ nome: data.nome || c.nome, telefone: data.telefone }))
        if (data.endereco.rua || data.endereco.bairro) {
          setEndereco(comCidadePadrao(data.endereco))
          setEnderecoSalvoOrigem(true)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [clienteSessao, slug, comCidadePadrao])

  // Chave do snapshot de fidelidade neste aparelho — por loja e por telefone, pra não
  // misturar o progresso de contas diferentes usadas no mesmo device (ou visitante anônimo).
  function snapshotKey() {
    return `menuzia_fidelidade_${slug}_${clienteSessao?.telefone ?? 'anon'}`
  }

  // ── Fidelidade: missões, prêmios prontos e cupons públicos da loja ────────
  // Sem sessão a API devolve só os cupons públicos (comportamento esperado, não erro).
  useEffect(() => {
    if (!slug) return
    let cancelled = false
    const qs = clienteSessao
      ? `?telefone=${encodeURIComponent(clienteSessao.telefone)}&token=${encodeURIComponent(clienteSessao.token)}`
      : ''
    fetch(`/api/loja/${slug}/fidelidade${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: FidelidadeCliente | null) => {
        if (cancelled) return
        if (!data) {
          // Resposta não-ok: só vira erro pra aba Cupons se ainda não há nada em mãos.
          if (!fidelidade) setFidelidadeErro(true)
          return
        }
        setFidelidade(data)
        setFidelidadeErro(false)

        // Benefício ativo aparece num modal na primeira visita: o banner amarelo
        // no meio da lista era rolado direto por boa parte dos clientes.
        const premio = premioDeBoasVindas(data)
        if (premio) {
          const chavePremio = `menuzia_premio_visto_${slug}_${clienteSessao?.telefone ?? 'anon'}`
          try {
            if (localStorage.getItem(chavePremio) !== assinaturaPremios(data)) setPremioModal(premio)
          } catch {
            setPremioModal(premio)
          }
        }

        if (!clienteSessao) return
        // Comemoração (som + piscar do botão Cupons): compara com o snapshot salvo
        // neste aparelho — progresso maior ou prêmio novo desde a última visita.
        const chave = snapshotKey()
        const atual = {
          recompensas: data.recompensas.map((r) => r.id),
          progresso: Object.fromEntries(data.campanhas.map((c) => [c.campanha.id, c.progresso])) as Record<
            string,
            { progressoValor: number; progressoQtd: number; ciclosCompletados: number }
          >,
        }
        try {
          const raw = localStorage.getItem(chave)
          if (raw) {
            const snap = JSON.parse(raw) as typeof atual
            const recompensaNova = atual.recompensas.some((id) => !(snap.recompensas ?? []).includes(id))
            const progressoMaior = Object.entries(atual.progresso).some(([id, p]) => {
              const s = snap.progresso?.[id]
              if (!s) return false
              return p.progressoValor > s.progressoValor || p.progressoQtd > s.progressoQtd || p.ciclosCompletados > s.ciclosCompletados
            })
            if (recompensaNova || progressoMaior) {
              tocarSomSucesso()
              setCuponsPiscando(true)
              window.setTimeout(() => setCuponsPiscando(false), 2200) // 3 iterações de 0.7s
            }
          }
        } catch { /* snapshot corrompido — só regrava abaixo */ }
        try { localStorage.setItem(chave, JSON.stringify(atual)) } catch { /* quota/navegação privada */ }
      })
      .catch(() => {
        // Falha de rede: acessório, a vitrine segue sem — mas sinaliza erro se ainda não há dados.
        if (!cancelled && !fidelidade) setFidelidadeErro(true)
      })
    return () => { cancelled = true }
    // fidelidade/snapshotKey são lidos só pra checagem pontual — incluí-los reprovocaria o fetch a cada resposta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, clienteSessao, fidelidadeVersao])

  /** Fecha o modal de prêmio e marca este conjunto como visto neste aparelho. */
  function fecharPremioModal() {
    setPremioModal(null)
    try {
      localStorage.setItem(`menuzia_premio_visto_${slug}_${clienteSessao?.telefone ?? 'anon'}`, assinaturaPremios(fidelidade))
    } catch { /* navegação privada: o modal volta na próxima visita, e tudo bem */ }
  }

  /** Valida o código digitado no servidor, com o subtotal atual do carrinho. */
  async function validarCupomCheckout(codigoBruto?: string) {
    const codigo = (codigoBruto ?? cupomCodigoInput).trim().toUpperCase().replace(/\s+/g, '')
    if (!codigo) { setCupomErro('Digite o código do cupom.'); return }
    setCupomValidando(true)
    setCupomErro(null)
    try {
      const res = await fetch(`/api/loja/${slug}/cupom/validar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, telefone: clienteSessao?.telefone, token: clienteSessao?.token, subtotal }),
      })
      const data = await res.json()
      if (data.ok && data.cupom) {
        setCupomAplicado(data.cupom)
        setRecompensaSelecionada(null) // exclusivos: cupom OU prêmio, nunca os dois
        setCupomCodigoInput(data.cupom.codigo)
      } else {
        setCupomAplicado(null)
        setCupomErro(data.motivo ?? data.error ?? 'Não foi possível validar o cupom.')
      }
    } catch {
      setCupomErro('Não foi possível validar o cupom agora. Tente novamente.')
    } finally {
      setCupomValidando(false)
    }
  }

  function removerBeneficio() {
    setCupomAplicado(null)
    setRecompensaSelecionada(null)
    setCupomCodigoInput('')
    setCupomErro(null)
  }

  /** Aba Cupons → "USAR NO PEDIDO": guarda o prêmio e leva pro carrinho. */
  function usarRecompensa(r: RecompensaDisponivel) {
    if (!r.podeResgatarHoje) return
    setRecompensaSelecionada(r)
    setCupomAplicado(null)
    setCupomCodigoInput('')
    setCupomErro(null)
    setTab('cart')
    showToast('Prêmio selecionado! Finalize o pedido para resgatar.')
  }

  /** Aba Cupons → "APLICAR": preenche o código pro checkout e leva pro carrinho. */
  function aplicarCupomDaAba(codigo: string) {
    setRecompensaSelecionada(null)
    setCupomAplicado(null)
    setCupomErro(null)
    setCupomCodigoInput(codigo)
    setTab('cart')
    showToast(`Cupom ${codigo} pronto pra aplicar no checkout.`)
    // Com itens na sacola já dá pra validar de imediato (o chip aparece no checkout).
    if (cart.length > 0) void validarCupomCheckout(codigo)
  }

  async function enviarCodigoConta() {
    setContaLoading(true)
    setContaError(null)
    try {
      const res = await fetch(`/api/loja/${slug}/conta/codigo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: contaTelefone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível enviar o código.')

      // Fallback: WhatsApp da loja offline — o servidor já logou o cliente sem
      // confirmar o código. Entra direto, sem o passo de digitar o código.
      if (data.fallback) {
        localStorage.setItem(`menuzia_cliente_${slug}`, JSON.stringify({ telefone: data.telefone, token: data.token }))
        localStorage.setItem(`menuzia_telefone_${slug}`, data.telefone)
        setClienteSessao({ telefone: data.telefone, token: data.token })
        setPerfilCliente(data)
        setContaNome(data.nome)
        setContaEndereco(data.endereco)
        setContaEditando(!data.nome && !data.endereco.rua)
        showToast('Não deu pra confirmar pelo WhatsApp agora — você já pode finalizar o pedido.')
        return
      }

      setContaStep('codigo')
    } catch (err) {
      setContaError(err instanceof Error ? err.message : 'Não foi possível enviar o código.')
    } finally {
      setContaLoading(false)
    }
  }

  async function confirmarCodigoConta() {
    setContaLoading(true)
    setContaError(null)
    try {
      const res = await fetch(`/api/loja/${slug}/conta/verificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: contaTelefone, codigo: contaCodigo }),
      })
      const data: ClientePerfil & { error?: string } = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Código inválido.')
      localStorage.setItem(`menuzia_cliente_${slug}`, JSON.stringify({ telefone: data.telefone, token: data.token }))
      localStorage.setItem(`menuzia_telefone_${slug}`, data.telefone)
      setClienteSessao({ telefone: data.telefone, token: data.token })
      setPerfilCliente(data)
      setContaNome(data.nome)
      setContaEndereco(data.endereco)
      setContaEditando(!data.nome && !data.endereco.rua)
      setContaCodigo('')
    } catch (err) {
      setContaError(err instanceof Error ? err.message : 'Código inválido.')
    } finally {
      setContaLoading(false)
    }
  }

  async function salvarPerfilConta() {
    if (!clienteSessao) return
    setContaLoading(true)
    setContaError(null)
    setContaSaved(false)
    try {
      const res = await fetch(`/api/loja/${slug}/conta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: clienteSessao.telefone, token: clienteSessao.token, nome: contaNome, endereco: contaEndereco }),
      })
      const data: ClientePerfil & { error?: string } = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível salvar.')
      setPerfilCliente(data)
      setCliente((c) => ({ nome: data.nome, telefone: data.telefone || c.telefone }))
      setEndereco(comCidadePadrao(data.endereco))
      setContaSaved(true)
      setContaEditando(false)
    } catch (err) {
      setContaError(err instanceof Error ? err.message : 'Não foi possível salvar.')
    } finally {
      setContaLoading(false)
    }
  }

  function cancelarEdicaoConta() {
    if (!perfilCliente) return
    setContaNome(perfilCliente.nome)
    setContaEndereco(perfilCliente.endereco)
    setContaError(null)
    setContaEditando(false)
  }

  function sairConta() {
    if (!slug) return
    removerBeneficio() // prêmio/cupom é da conta que está saindo — não pode ficar selecionado
    localStorage.removeItem(`menuzia_cliente_${slug}`)
    setClienteSessao(null)
    setPerfilCliente(null)
    setContaStep('telefone')
    setContaTelefone('')
    setContaCodigo('')
    setContaNome('')
    setContaEndereco(ENDERECO_VAZIO)
    setContaEditando(false)
    setContaSaved(false)
  }

  // ── Product sheet ─────────────────────────────────────────────────────────
  const [productSheet, setProductSheet] = useState<ItemCardapio | null>(null)
  // Quando preenchido, o sheet está editando uma linha existente do carrinho.
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  // grupoId → (complementoId → quantidade). Grupos sem "permite quantidade" usam sempre 1.
  const [groupSelections, setGroupSelections] = useState<Map<string, Map<string, number>>>(new Map())
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set())
  const [obs, setObs] = useState('')
  const [selectedTamanhoId, setSelectedTamanhoId] = useState<string | null>(null)
  const [selectedTamanhoPizzaId, setSelectedTamanhoPizzaId] = useState<string | null>(null)
  const [selectedSaborId, setSelectedSaborId] = useState<string | null>(null)
  const [selectedBordaId, setSelectedBordaId] = useState<string | null>(null)
  const [selectedMassaId, setSelectedMassaId] = useState<string | null>(null)

  function openProduct(item: ItemCardapio) {
    setProductSheet(item)
    setEditingLineKey(null)
    setQty(1)
    setGroupSelections(new Map())
    setSelectedAddons(new Set())
    setObs('')
    setSelectedTamanhoId(item.tamanhos[0]?.id ?? null)
    setSelectedTamanhoPizzaId(tamanhosPizza[0]?.id ?? null)
    setSelectedSaborId(item.sabores.find((s) => s.status === 'disponivel')?.id ?? null)
    setSelectedBordaId(null)
    setSelectedMassaId(null)
  }

  function closeProductSheet() {
    setProductSheet(null)
    setEditingLineKey(null)
  }

  /** Reabre o sheet do produto pré-preenchido com as escolhas de uma linha do carrinho. */
  function editCartLine(line: CartLine) {
    const item = allItems.find((i) => i.id === line.itemId)
    if (!item) { showToast('Esse item não está mais disponível para edição.'); return }
    setProductSheet(item)
    setEditingLineKey(line.key)
    setQty(line.qty)
    setObs(line.obs)

    // Complementos: casa por nome consumindo cada ocorrência uma única vez,
    // pra não duplicar quando o mesmo nome existe em um grupo E como avulso.
    const restantes = new Map<string, number>()
    for (const a of line.addons) restantes.set(a.nome, (restantes.get(a.nome) ?? 0) + 1)
    const consumir = (nome: string) => {
      const n = restantes.get(nome) ?? 0
      if (n <= 0) return false
      restantes.set(nome, n - 1)
      return true
    }
    const sel = new Map<string, Map<string, number>>()
    for (const g of item.grupos) {
      const qtds = new Map<string, number>()
      for (const c of g.complementos) {
        let n = 0
        while (consumir(c.nome)) n++
        if (n > 0) qtds.set(c.id, n)
      }
      if (qtds.size > 0) sel.set(g.id, qtds)
    }
    setGroupSelections(sel)

    const avulsos = new Set<string>()
    for (const c of item.complementos) if (consumir(c.nome)) avulsos.add(c.nome)
    setSelectedAddons(avulsos)

    setSelectedTamanhoId(item.tamanhos.find((t) => t.nome === line.tamanhoNome)?.id ?? item.tamanhos[0]?.id ?? null)
    if (item.tipoItem === 'pizza') {
      setSelectedTamanhoPizzaId(tamanhosPizza.find((t) => t.nome === line.tamanhoNome)?.id ?? tamanhosPizza[0]?.id ?? null)
      setSelectedSaborId(item.sabores.find((s) => s.nome === line.saborNome)?.id ?? item.sabores.find((s) => s.status === 'disponivel')?.id ?? null)
    } else {
      setSelectedTamanhoPizzaId(tamanhosPizza[0]?.id ?? null)
      setSelectedSaborId(item.sabores.find((s) => s.status === 'disponivel')?.id ?? null)
    }
    setSelectedBordaId(bordasPizza.find((b) => b.nome === line.bordaNome)?.id ?? null)
    setSelectedMassaId(massasPizza.find((m) => m.nome === line.massaNome)?.id ?? null)

    // Se o cardápio mudou desde que o item foi adicionado (tamanho renomeado,
    // sabor esgotado…), avisa em vez de trocar a escolha em silêncio.
    const tamanhoSumiu = item.tipoItem !== 'pizza' && !!line.tamanhoNome && item.tamanhos.length > 0 && !item.tamanhos.some((t) => t.nome === line.tamanhoNome)
    const saborSumiu = item.tipoItem === 'pizza' && !!line.saborNome && !item.sabores.some((s) => s.nome === line.saborNome && s.status === 'disponivel')
    if (tamanhoSumiu || saborSumiu) showToast('O cardápio mudou — confira as opções antes de salvar.')
  }

  /** Soma das quantidades escolhidas num grupo. */
  const totalGrupo = (sel: Map<string, number> | undefined) => [...(sel?.values() ?? [])].reduce((s, n) => s + n, 0)

  function selectRadio(grupoId: string, compId: string) {
    setGroupSelections((prev) => { const next = new Map(prev); next.set(grupoId, new Map([[compId, 1]])); return next })
  }

  function toggleCheckbox(grupoId: string, compId: string, maxEscolhas: number) {
    setGroupSelections((prev) => {
      const next = new Map(prev)
      const cur = new Map(next.get(grupoId) ?? [])
      if (cur.has(compId)) cur.delete(compId)
      else if (maxEscolhas === 0 || totalGrupo(cur) < maxEscolhas) cur.set(compId, 1)
      next.set(grupoId, cur)
      return next
    })
  }

  /** Stepper − / + de um complemento (grupos com "permite quantidade"). */
  function changeCompQty(grupoId: string, compId: string, delta: number, maxEscolhas: number) {
    setGroupSelections((prev) => {
      const next = new Map(prev)
      const cur = new Map(next.get(grupoId) ?? [])
      const atual = cur.get(compId) ?? 0
      if (delta > 0 && maxEscolhas !== 0 && totalGrupo(cur) >= maxEscolhas) return prev
      const novo = atual + delta
      if (novo <= 0) cur.delete(compId)
      else cur.set(compId, novo)
      next.set(grupoId, cur)
      return next
    })
  }

  function toggleAddon(nome: string) {
    setSelectedAddons((prev) => { const next = new Set(prev); if (next.has(nome)) next.delete(nome); else next.add(nome); return next })
  }

  const gruposValidos = useMemo(() => {
    if (!productSheet) return true
    if (productSheet.tamanhos.length > 0 && !selectedTamanhoId) return false
    if (productSheet.tipoItem === 'pizza' && (!selectedTamanhoPizzaId || !selectedSaborId)) return false
    return productSheet.grupos.every((g) => {
      if (!g.obrigatorio) return true
      return totalGrupo(groupSelections.get(g.id)) >= g.minEscolhas
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSheet, groupSelections, selectedTamanhoId, selectedTamanhoPizzaId, selectedSaborId])

  const addonsTotal = useMemo(() => {
    if (!productSheet) return 0
    let sum = 0
    for (const grupo of productSheet.grupos) {
      const sel = groupSelections.get(grupo.id) ?? new Map<string, number>()
      for (const [compId, qtd] of sel) {
        const comp = grupo.complementos.find((c) => c.id === compId)
        if (comp) sum += comp.preco * qtd
      }
    }
    for (const comp of productSheet.complementos) {
      if (selectedAddons.has(comp.nome)) sum += comp.preco
    }
    return sum
  }, [productSheet, groupSelections, selectedAddons])

  const selectedTamanho = productSheet?.tamanhos.find((t) => t.id === selectedTamanhoId) ?? null
  const selectedSabor = productSheet?.sabores.find((s) => s.id === selectedSaborId) ?? null
  const selectedBorda = bordasPizza.find((b) => b.id === selectedBordaId) ?? null
  const selectedMassa = massasPizza.find((m) => m.id === selectedMassaId) ?? null
  const precoSaborTamanho = selectedSabor?.precos.find((p) => p.tamanhoPadraoId === selectedTamanhoPizzaId)?.preco ?? 0

  const basePrice = productSheet
    ? productSheet.tipoItem === 'pizza'
      ? precoSaborTamanho + (selectedBorda?.preco ?? 0) + (selectedMassa?.preco ?? 0)
      : selectedTamanho
      ? selectedTamanho.preco
      : productSheet.promocaoPreco ?? productSheet.preco
    : 0
  const unitPrice = basePrice + addonsTotal

  function addToCart() {
    if (!productSheet || !gruposValidos) return
    const addonsList: { nome: string; preco: number }[] = []
    for (const grupo of productSheet.grupos) {
      const sel = groupSelections.get(grupo.id) ?? new Map<string, number>()
      for (const [compId, qtd] of sel) {
        const comp = grupo.complementos.find((c) => c.id === compId)
        // Uma entrada por unidade — o servidor e o recibo somam cada ocorrência.
        if (comp) for (let i = 0; i < qtd; i++) addonsList.push({ nome: comp.nome, preco: comp.preco })
      }
    }
    for (const comp of productSheet.complementos) {
      if (selectedAddons.has(comp.nome)) addonsList.push({ nome: comp.nome, preco: comp.preco })
    }
    const novaLinha: CartLine = {
      key: editingLineKey ?? `${productSheet.id}-${Date.now()}`,
      itemId: productSheet.id,
      name: productSheet.nome,
      imagemUrl: productSheet.imagemUrl,
      qty,
      unit: unitPrice,
      addons: addonsList,
      obs,
      tamanhoNome: productSheet.tipoItem === 'pizza' ? (tamanhosPizza.find((t) => t.id === selectedTamanhoPizzaId)?.nome ?? '') : selectedTamanho?.nome ?? '',
      saborNome: selectedSabor?.nome ?? '',
      bordaNome: selectedBorda?.nome ?? '',
      massaNome: selectedMassa?.nome ?? '',
    }
    if (editingLineKey) {
      setCart((prev) => prev.map((l) => (l.key === editingLineKey ? novaLinha : l)))
      showToast(`${productSheet.nome} atualizado!`)
    } else {
      // Cliente permanece no cardápio pra continuar adicionando; a barra
      // flutuante inferior leva pro carrinho quando ele quiser.
      setCart((prev) => [...prev, novaLinha])
      showToast(`${productSheet.nome} adicionado!`)
    }
    closeProductSheet()
  }

  // ── Order bump quick-add ──────────────────────────────────────────────────
  function quickAddOrderBump(item: ItemCardapio) {
    if (item.grupos.some((g) => g.obrigatorio)) {
      openProduct(item)
      return
    }
    setCart((prev) => {
      const existingIdx = prev.findIndex((l) => l.itemId === item.id && l.addons.length === 0)
      if (existingIdx >= 0) {
        return prev.map((l, i) => (i === existingIdx ? { ...l, qty: l.qty + 1 } : l))
      }
      return [
        ...prev,
        {
          key: `bump-${item.id}-${Date.now()}`,
          itemId: item.id,
          name: item.nome,
          imagemUrl: item.imagemUrl,
          qty: 1,
          unit: item.promocaoPreco ?? item.preco,
          addons: [],
          obs: '',
          tamanhoNome: '',
          saborNome: '',
          bordaNome: '',
          massaNome: '',
        },
      ]
    })
    showToast(`${item.nome} adicionado!`)
  }

  function changeLineQty(key: string, delta: number) {
    setCart((prev) =>
      prev.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0)
    )
  }

  // ── Checkout ──────────────────────────────────────────────────────────────
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>(1)
  // Primeiro passo do fluxo aberto: 0 no desktop (resumo) e 1 no mobile (a aba
  // carrinho já é o resumo). Define até onde o botão voltar (←) recua.
  const [checkoutMinStep, setCheckoutMinStep] = useState<CheckoutStep>(1)
  const [payMethod, setPayMethod] = useState('Pix')
  const [changeFor, setChangeFor] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  // Confirmação pós-pedido + link wa.me para o cliente avisar a loja (conversa
  // bidirecional reduz risco de bloqueio dos disparos da loja).
  const [confirmacaoAberta, setConfirmacaoAberta] = useState(false)
  // Guarda de saída do botão voltar — ver "Botão voltar do celular" mais abaixo.
  const [saidaAberta, setSaidaAberta] = useState(false)
  const [pedidoWa, setPedidoWa] = useState<string | null>(null)
  const [cliente, setCliente] = useState({ nome: '', telefone: '' })
  const [pedidoDetalhe, setPedidoDetalhe] = useState<PedidoCliente | null>(null)

  // ── Lock background scroll while a full-screen overlay is open ────────────
  useEffect(() => {
    const open = !!productSheet || checkoutOpen || freteOpen || contaOpen || infoOpen || !!pedidoDetalhe || confirmacaoAberta || saidaAberta || !!premioModal
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [productSheet, checkoutOpen, freteOpen, contaOpen, infoOpen, pedidoDetalhe, confirmacaoAberta, saidaAberta, premioModal])

  // ── Histórico de pedidos do cliente logado ────────────────────────────────
  const [meusPedidos, setMeusPedidos] = useState<PedidoCliente[]>([])
  const [pedidosLoading, setPedidosLoading] = useState(false)

  useEffect(() => {
    if (tab !== 'pedidos' || !clienteSessao) { setMeusPedidos([]); return }
    let active = true
    // Hidrata do cache local (salvo no celular do cliente) pra consulta imediata/offline.
    try {
      const cached = localStorage.getItem(`menuzia_pedidos_${slug}`)
      if (cached && active) setMeusPedidos(JSON.parse(cached) as PedidoCliente[])
    } catch { /* cache corrompido — ignora */ }
    const load = async (showSpinner: boolean) => {
      if (showSpinner && active) setPedidosLoading(true)
      try {
        const res = await fetch(`/api/loja/${slug}/conta/pedidos?telefone=${encodeURIComponent(clienteSessao.telefone)}&token=${encodeURIComponent(clienteSessao.token)}`)
        if (res.ok && active) {
          const data = (await res.json()) as PedidoCliente[]
          setMeusPedidos(data)
          // Salva no celular pra consultar sempre que quiser.
          try { localStorage.setItem(`menuzia_pedidos_${slug}`, JSON.stringify(data)) } catch { /* quota/privado */ }
        }
      } catch { /* mantém lista atual (cache) */ }
      finally { if (active) setPedidosLoading(false) }
    }
    load(true)
    const interval = setInterval(() => load(false), 8000)
    return () => { active = false; clearInterval(interval) }
  }, [tab, clienteSessao, slug])

  // Mantém o modal de detalhe sincronizado com os dados mais recentes (status ao vivo).
  useEffect(() => {
    setPedidoDetalhe((prev) => (prev ? meusPedidos.find((p) => p.id === prev.id) ?? prev : null))
  }, [meusPedidos])

  // Pedido que VIROU "entregue" no polling → re-busca a fidelidade (o pedido
  // acabou de contar pra campanha: progresso/prêmio podem ter mudado agora).
  const statusPedidosRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const anterior = statusPedidosRef.current
    const atual = new Map<string, string>()
    let entregou = false
    for (const p of meusPedidos) {
      atual.set(p.id, p.status)
      const antes = anterior.get(p.id)
      if (antes && antes !== 'entregue' && p.status === 'entregue') entregou = true
    }
    statusPedidosRef.current = atual
    if (entregou) setFidelidadeVersao((v) => v + 1)
  }, [meusPedidos])

  const PAY_MAP: Record<string, 'pix' | 'cartao' | 'dinheiro'> = {
    Pix: 'pix',
    'Cartão na entrega': 'cartao',
    Dinheiro: 'dinheiro',
  }

  function parseMoney(value: string): number | null {
    const n = Number(value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.').trim())
    return Number.isFinite(n) && n > 0 ? n : null
  }

  /** Telefone da loja em formato wa.me (só dígitos, com DDI 55). '' se inválido. */
  function numeroWaLoja(): string {
    const d = (restaurante?.telefone ?? '').replace(/\D/g, '')
    if (d.length < 10) return ''
    return d.startsWith('55') ? d : `55${d}`
  }

  /** Mensagem que o cliente envia pro WhatsApp da loja com o resumo do pedido. */
  function montarAvisoLoja(): string {
    const linhas: string[] = ['Acabei de fazer um pedido agora mesmo! 🛎️', '']
    for (const l of cart) {
      const variacao = [l.tamanhoNome, l.saborNome].filter(Boolean).join(' - ')
      linhas.push(`• ${l.qty}x ${l.name}${variacao ? ` (${variacao})` : ''}`)
      const contagem = new Map<string, number>()
      for (const a of l.addons) contagem.set(a.nome, (contagem.get(a.nome) ?? 0) + 1)
      for (const [nome, qtd] of contagem) linhas.push(`   + ${qtd > 1 ? `${qtd}x ` : ''}${nome}`)
      if (l.obs?.trim()) linhas.push(`   obs: ${l.obs.trim()}`)
    }
    linhas.push('')
    if (desconto > 0) linhas.push(`Desconto${cupomAplicado ? ` (cupom ${cupomAplicado.codigo})` : ' (prêmio fidelidade)'}: -${brl(desconto)}`)
    if (beneficio?.tipo === 'item_gratis') linhas.push(`Item grátis: ${beneficio.itemNome ?? 'prêmio'}`)
    linhas.push(`Total: ${brl(total)}`)
    linhas.push(`Pagamento: ${payMethod}`)
    linhas.push(tipoPedido === 'retirada' ? 'Retirada no local' : 'Entrega')
    if (cliente.nome.trim()) linhas.push(`Cliente: ${cliente.nome.trim()}`)
    return linhas.join('\n')
  }

  async function submitOrder() {
    setSubmitting(true)
    setCheckoutError(null)
    try {
      const payload = {
        tipo: tipoPedido,
        cliente: { nome: cliente.nome.trim(), telefone: clienteSessao?.telefone ?? cliente.telefone.trim() },
        // Retirada não tem endereço: mandar o do último pedido de entrega
        // sujaria a comanda com um endereço que ninguém vai usar.
        endereco: tipoPedido === 'retirada' ? ENDERECO_VAZIO : endereco,
        pagamento: PAY_MAP[payMethod] ?? 'pix',
        trocoPara: payMethod === 'Dinheiro' ? parseMoney(changeFor) : null,
        taxaEntrega: fee,
        itens: cart.map((l) => ({
          itemId: l.itemId,
          quantidade: l.qty,
          observacao: l.obs,
          complementos: l.addons.map((a) => a.nome),
          tamanhoNome: l.tamanhoNome || undefined,
          saborNome: l.saborNome || undefined,
          bordaNome: l.bordaNome || undefined,
          massaNome: l.massaNome || undefined,
        })),
        // Cupom OU prêmio — mutuamente exclusivos; o servidor valida e recalcula
        // o desconto (o preview do client nunca é enviado).
        cupomCodigo: recompensaSelecionada ? undefined : cupomAplicado?.codigo,
        recompensaId: recompensaSelecionada?.id,
      }
      const res = await fetch(`/api/loja/${slug}/pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível enviar o pedido.')
      // Endereço confirmado: guarda no aparelho e no perfil (se logado) pra
      // próxima compra já vir preenchida.
      try {
        // Numa retirada o `endereco` do estado é o que sobrou de antes (ou nada):
        // não vale sobrescrever o endereço bom que o aparelho já guardava.
        if (tipoPedido === 'entrega') {
          localStorage.setItem(
            `menuzia_endereco_${slug}`,
            JSON.stringify({ endereco, nome: cliente.nome.trim(), telefone: (clienteSessao?.telefone ?? cliente.telefone).trim() })
          )
        }
      } catch { /* quota/navegação privada */ }
      if (clienteSessao) {
        // Numa retirada o perfil guarda só o nome — o endereço que ele já tinha
        // fica como está, senão um pedido de balcão apagaria o endereço de casa.
        const enderecoPerfil = tipoPedido === 'entrega' ? endereco : (perfilCliente?.endereco ?? contaEndereco)
        fetch(`/api/loja/${slug}/conta`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telefone: clienteSessao.telefone, token: clienteSessao.token, nome: cliente.nome.trim() || contaNome, endereco: enderecoPerfil }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((perfil: ClientePerfil | null) => {
            if (!perfil) return
            setPerfilCliente(perfil)
            setContaNome(perfil.nome)
            setContaEndereco(perfil.endereco)
          })
          .catch(() => { /* melhor esforço — o pedido já foi */ })
      }
      // Monta o link de aviso pro WhatsApp da loja ANTES de limpar o carrinho.
      const numero = numeroWaLoja()
      setPedidoWa(numero ? `https://wa.me/${numero}?text=${encodeURIComponent(montarAvisoLoja())}` : null)
      setConfirmacaoAberta(true)
      setCheckoutOpen(false)
      setCart([])
      // Benefício consumido pelo pedido: limpa e re-busca a fidelidade (prêmio
      // resgatado some da lista de disponíveis).
      removerBeneficio()
      setFidelidadeVersao((v) => v + 1)
      setTab('pedidos')
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Não foi possível enviar o pedido.')
    } finally {
      setSubmitting(false)
    }
  }

  function checkoutNext() {
    if (!restaurante?.lojaAberta) {
      setCheckoutError('A loja está fechada no momento. Tente novamente durante o horário de funcionamento.')
      return
    }
    // Dá pra esvaziar a sacola pelas linhas do resumo — não deixa seguir vazio.
    if (checkoutStep === 0 && cart.length === 0) {
      setCheckoutError('Sua sacola está vazia.')
      return
    }
    if (checkoutStep === 2) {
      if (!cliente.nome.trim()) {
        setCheckoutError('Informe seu nome para continuar.')
        return
      }
      // Retirada não tem endereço: o passo 2 pede só o nome.
      if (tipoPedido === 'entrega') {
        if (!endereco.rua.trim() || !endereco.numero.trim() || !endereco.bairro.trim()) {
          setCheckoutError('Preencha rua, número e bairro para continuar.')
          return
        }
        if (listaFechada && !bairroValido) {
          setCheckoutError('Escolha um bairro da lista de bairros atendidos pela loja.')
          return
        }
        if (!entregavel) {
          setCheckoutError(freteCalc?.motivo || 'Não entregamos nesse endereço.')
          return
        }
      }
    }
    setCheckoutError(null)
    if (checkoutStep < 3) { setCheckoutStep((s) => (s + 1) as CheckoutStep); return }
    submitOrder()
  }

  function checkoutBack() {
    if (checkoutStep > checkoutMinStep) { setCheckoutError(null); setCheckoutStep((s) => (s - 1) as CheckoutStep); return }
    setCheckoutOpen(false)
  }

  // ── Botão voltar do celular ───────────────────────────────────────────────
  //
  // A vitrine é uma página só: abrir produto, sacola, checkout e acompanhamento
  // nunca tocava no histórico. O resultado é que o voltar do Android jogava o
  // cliente PRA FORA do cardápio em um toque, de qualquer ponto da compra.
  //
  // A solução é uma entrada-sentinela: empurramos uma no histórico e, a cada
  // "voltar", consumimos ela para fechar a camada de cima e empurramos outra no
  // lugar. Assim cada toque desce um nível — sem precisar contar profundidade
  // nem espelhar estado na URL, que é onde esse tipo de código costuma quebrar.
  //
  // Na raiz (cardápio aberto, nada por cima) o voltar não sai: abre a confirmação.
  const saindoRef = useRef(false)

  /** Fecha a camada mais alta. Devolve false quando já estamos na raiz. */
  const fecharCamadaDoTopo = (): boolean => {
    if (saidaAberta) { setSaidaAberta(false); return true }
    if (premioModal) { fecharPremioModal(); return true }
    if (confirmacaoAberta) { setConfirmacaoAberta(false); return true }
    if (productSheet) { closeProductSheet(); return true }
    if (checkoutOpen) { checkoutBack(); return true }
    if (pedidoDetalhe) { setPedidoDetalhe(null); return true }
    if (freteOpen) { setFreteOpen(false); return true }
    if (contaOpen) { setContaOpen(false); return true }
    if (infoOpen) { setInfoOpen(false); return true }
    if (searchOpen) { setSearchOpen(false); return true }
    if (tab !== 'home') { setTab('home'); return true }
    return false
  }
  // O listener é recriado a cada render pra enxergar o estado atual das camadas;
  // a ref evita prender um closure velho dentro do addEventListener.
  const fecharTopoRef = useRef(fecharCamadaDoTopo)
  fecharTopoRef.current = fecharCamadaDoTopo

  useEffect(() => {
    const marcar = () => window.history.pushState({ menuziaVitrine: true }, '')

    // A sentinela NÃO pode ser plantada no carregamento. O Chrome tem uma
    // "history manipulation intervention": entradas que a página cria antes de
    // receber qualquer interação do usuário são marcadas como puláveis, e o
    // voltar passa por cima delas — foi exatamente o que aconteceu no teste,
    // o primeiro voltar saía do site como se nada tivesse sido empurrado.
    // Depois do primeiro toque a ativação fica "grudada" no documento e todos
    // os pushes seguintes (inclusive os do handler abaixo) valem.
    //
    // Efeito colateral aceitável: quem abriu o cardápio e não tocou em nada
    // ainda sai com um voltar. Não há pedido em risco nesse estado, e prender
    // alguém que nem interagiu seria hostil.
    let armado = false
    const armar = () => {
      if (armado) return
      armado = true
      marcar()
    }

    const aoVoltar = () => {
      // Sem sentinela plantada não há nada nosso pra consumir; e saída
      // autorizada pelo próprio cliente deixa o navegador seguir.
      if (!armado || saindoRef.current) return
      const fechou = fecharTopoRef.current()
      marcar()
      if (!fechou) setSaidaAberta(true)
    }

    // Num celular lento o cliente costuma tocar/rolar ANTES do JS hidratar —
    // esse toque não passa pelo listener abaixo, mas deixa a ativação registrada
    // no documento. Se ela já existe, dá pra plantar a sentinela na hora.
    // (`userActivation` é do Chrome/Edge, que é onde o problema aparece.)
    if (navigator.userActivation?.hasBeenActive) armar()

    window.addEventListener('pointerdown', armar, true)
    window.addEventListener('keydown', armar, true)
    window.addEventListener('popstate', aoVoltar)
    return () => {
      window.removeEventListener('pointerdown', armar, true)
      window.removeEventListener('keydown', armar, true)
      window.removeEventListener('popstate', aoVoltar)
    }
  }, [])

  /** "Sair mesmo assim": libera a guarda e sai de verdade. */
  function sairDaVitrine() {
    setSaidaAberta(false)
    saindoRef.current = true
    // -2 = a sentinela MAIS a entrada da própria vitrine. Um -1 só desfaria a
    // sentinela e devolveria o cliente pra mesma página — ele acharia que o
    // botão não funcionou.
    window.history.go(-2)
    // Cardápio aberto direto num link (sem histórico anterior): não há pra onde
    // ir e a navegação não acontece. Rearma a guarda pra ela não ficar
    // desligada no resto da sessão.
    window.setTimeout(() => { saindoRef.current = false }, 1000)
  }

  // ── Blocos reutilizados no carrinho (aba mobile + painel lateral desktop) ──
  // Numa retirada não existe frete pra ficar grátis — o banner só confunde.
  const freteGratisBanner = freteGratisAtivo && cart.length > 0 && tipoPedido === 'entrega' ? (
    ganhouFreteGratis ? (
      <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-[#16A34A]/30 bg-[#DCFCE7] px-3.5 py-3">
        <Truck className="h-5 w-5 flex-shrink-0 text-[#16A34A]" strokeWidth={2} />
        <span className="text-[13px] font-bold text-[#16A34A]">Você ganhou entrega grátis neste pedido! 🎉</span>
      </div>
    ) : (
      <div className="mb-4 rounded-lg border border-[#16A34A]/30 bg-[#F0FDF4] px-3.5 py-3">
        <div className="flex items-center gap-2.5">
          <Truck className="h-5 w-5 flex-shrink-0 text-[#16A34A]" strokeWidth={2} />
          <span className="text-[13px] font-semibold text-[#16A34A]">Entrega grátis para pedidos acima de {brl(freteGratisMinimo ?? 0)}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#DCFCE7]">
          <div className="h-full rounded-full bg-[#16A34A] transition-all duration-300" style={{ width: `${Math.min(100, (subtotal / (freteGratisMinimo || 1)) * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-[12px] font-medium text-[#15803D]">Faltam {brl(Math.max(0, (freteGratisMinimo ?? 0) - subtotal))} para ganhar a entrega grátis.</p>
      </div>
    )
  ) : null

  /**
   * "Como você quer receber?" — só aparece quando a loja aceita os dois canais.
   * Com um canal só não há decisão a tomar, e um seletor de uma opção só é ruído
   * entre o cliente e o botão de finalizar.
   */
  const canalSelector = aceitaEntrega && aceitaRetirada ? (
    <div className="mb-4">
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-subtle">Como você quer receber?</div>
      <div className="grid grid-cols-2 gap-2">
        {([
          { id: 'entrega' as const, titulo: 'Entrega', desc: 'A gente leva até você' },
          { id: 'retirada' as const, titulo: 'Retirada', desc: 'Você retira no local' },
        ]).map((op) => (
          <button
            key={op.id}
            onClick={() => setTipoPedido(op.id)}
            className={[
              'rounded-lg border p-3 text-left transition-all active:scale-[0.98]',
              tipoPedido === op.id
                ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]/5'
                : 'border-border bg-white hover:border-[var(--tema-primaria)]/40',
            ].join(' ')}
            aria-pressed={tipoPedido === op.id}
          >
            <div className={['text-[14px] font-bold', tipoPedido === op.id ? 'text-[var(--tema-primaria)]' : 'text-text-main'].join(' ')}>{op.titulo}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-text-subtle">{op.desc}</div>
          </button>
        ))}
      </div>
    </div>
  ) : null

  // Linha do frete nos quatro resumos (sacola mobile, painel desktop, resumo do
  // checkout e revisão). `freteRotulo` só é null quando o número é confiável —
  // é o que impede o "R$ 0,00" aparecer como se fosse entrega grátis.
  const rotuloLinhaFrete = tipoPedido === 'retirada' ? 'Retirada no balcão' : 'Taxa de entrega'
  const valorLinhaFrete = freteRotulo ? (
    <span className="text-text-subtle">{freteRotulo}</span>
  ) : fee === 0 ? (
    <span className="font-bold text-[#16A34A]">{tipoPedido === 'retirada' ? 'Sem taxa' : 'Grátis'}</span>
  ) : (
    <span className="text-text-subtle">{brl(fee)}</span>
  )

  // Chip do benefício ativo (cupom ou prêmio) — sacola mobile + painel desktop.
  const beneficioBanner = (recompensaSelecionada || cupomAplicado) ? (
    <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-[#16A34A]/30 bg-[#F0FDF4] px-3.5 py-3">
      <Gift className="h-5 w-5 flex-shrink-0 text-[#16A34A]" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-bold text-[#15803D]">
          {recompensaSelecionada
            ? `Prêmio: ${premioLabelCampanha({ premioTipo: recompensaSelecionada.premioTipo, premioValor: recompensaSelecionada.premioValor }, recompensaSelecionada.premioItemNome)}`
            : `Cupom ${cupomAplicado?.codigo}`}
        </div>
        <div className="truncate text-[12px] text-[#15803D]/80">
          {beneficio?.tipo === 'item_gratis'
            ? `Item grátis: ${beneficio.itemNome ?? 'prêmio'}`
            : beneficio?.tipo === 'entrega_gratis'
              ? 'Entrega grátis neste pedido'
              : beneficio?.tipo === 'desconto_percentual'
                ? `${beneficio.valor ?? 0}% de desconto (-${brl(desconto)})`
                : `Desconto de ${brl(desconto)}`}
        </div>
      </div>
      <button onClick={removerBeneficio} aria-label="Remover cupom ou prêmio" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white text-[13px] text-text-subtle shadow-sm transition-colors hover:text-danger">✕</button>
    </div>
  ) : null

  // Order bumps — "Peça também" (aba carrinho mobile + resumo do checkout desktop).
  const orderBumpsBlock = orderBumps.length > 0 ? (
    <div className="mb-5">
      <h3 className="mb-3 text-[15px] font-bold tracking-tight">Peça também</h3>
      <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-wrap">
        {orderBumps.map((item) => (
          <button
            key={item.id}
            onClick={() => quickAddOrderBump(item)}
            className="group flex w-[132px] flex-shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-white transition-all duration-150 hover:border-[var(--tema-primaria)] hover:shadow-lg active:scale-[0.97]"
          >
            <div className="h-[88px] w-full overflow-hidden">
              <ProductThumb item={item} size={132} />
            </div>
            <div className="flex flex-1 flex-col p-2.5">
              <div className="line-clamp-2 min-h-[34px] text-[12px] font-semibold leading-snug text-text-main">{item.nome}</div>
              <div className="mt-1 text-[12px] font-bold text-[#16A34A]">{brl(item.promocaoPreco ?? item.preco)}</div>
              <div className="mt-2 rounded bg-[var(--tema-primaria)] py-1.5 text-center text-[11px] font-bold tracking-wide text-white transition-colors group-hover:bg-[var(--tema-dark)]">
                + Adicionar
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  ) : null

  // ── Contagens de fidelidade (banner de resgate + badge do ícone Cupons) ───
  const premiosProntosHoje = fidelidade?.recompensas.filter((r) => r.podeResgatarHoje).length ?? 0
  const recompensasDisponiveis = fidelidade?.recompensas.length ?? 0
  const cuponsPublicosCount = fidelidade?.cuponsPublicos.length ?? 0
  // Texto agregado do banner amarelo (UM retângulo só, singular/plural correto).
  const bannerResgateTexto = (() => {
    const partes: string[] = []
    if (premiosProntosHoje > 0) partes.push(`${premiosProntosHoje} ${premiosProntosHoje === 1 ? 'prêmio' : 'prêmios'}`)
    if (cuponsPublicosCount > 0) partes.push(`${cuponsPublicosCount} ${cuponsPublicosCount === 1 ? 'cupom' : 'cupons'}`)
    return partes.length > 0 ? `Você tem ${partes.join(' e ')} pra resgatar →` : null
  })()

  /** Linha do carrinho — clicável pra editar (complementos, observação, quantidade). */
  const renderCartLine = (line: CartLine, hasBorder: boolean) => (
    <div key={line.key} className={['flex items-start gap-3 p-3.5', hasBorder ? 'border-b border-border' : ''].join(' ')}>
      <button onClick={() => editCartLine(line)} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-label={`Editar ${line.name}`}>
        <div className="h-[84px] w-[84px] flex-shrink-0 overflow-hidden rounded-md border border-border">
          <ProductThumb item={{ nome: line.name, imagemUrl: line.imagemUrl }} size={84} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <span className="min-w-0 text-[15px] font-bold leading-snug">{line.name}</span>
            <Pencil className="mt-0.5 h-3 w-3 flex-shrink-0 text-text-subtle/60" strokeWidth={2} />
          </div>
          {(line.tamanhoNome || line.saborNome) && (
            <div className="mt-0.5 truncate text-[12.5px] font-medium text-text-subtle">
              {[line.tamanhoNome, line.saborNome].filter(Boolean).join(' · ')}
            </div>
          )}
          {(line.bordaNome || line.massaNome) && (
            <div className="mt-0.5 truncate text-[12.5px] text-text-subtle">{[line.bordaNome, line.massaNome].filter(Boolean).join(', ')}</div>
          )}
          {line.addons.length > 0 && (
            <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-text-subtle">
              {(() => {
                const contagem = new Map<string, number>()
                for (const a of line.addons) contagem.set(a.nome, (contagem.get(a.nome) ?? 0) + 1)
                return [...contagem].map(([nome, qtd]) => (qtd > 1 ? `${qtd}x ${nome}` : nome)).join(', ')
              })()}
            </div>
          )}
          {line.obs && <div className="mt-0.5 truncate text-[12px] italic text-text-subtle">&ldquo;{line.obs}&rdquo;</div>}
          <div className="mt-1.5 text-[15px] font-bold text-promo">{brl(line.unit * line.qty)}</div>
        </div>
      </button>
      <div className="flex flex-shrink-0 items-center rounded-md border border-border bg-white">
        <button onClick={() => changeLineQty(line.key, -1)} className="flex h-[38px] w-[38px] items-center justify-center text-xl font-semibold text-[var(--tema-primaria)] hover:bg-[#F3F4F6] active:bg-border">−</button>
        <span className="w-[28px] text-center text-[14px] font-bold">{line.qty}</span>
        <button onClick={() => changeLineQty(line.key, 1)} className="flex h-[38px] w-[38px] items-center justify-center text-xl font-semibold text-[var(--tema-primaria)] hover:bg-[#F3F4F6] active:bg-border">+</button>
      </div>
    </div>
  )

  // ── Erro ───────────────────────────────────────────────────────────────────
  // Não há mais tela de "carregando" cobrindo tudo: o restaurante chega pronto do
  // servidor, então capa, logo, nome e status pintam já na primeira renderização.
  // Só a área do cardápio espera as queries — ver `cardapioCarregando` abaixo.
  if (error || !restaurante) {
    return (
      <div className="font-loja flex min-h-dvh items-center justify-center bg-[#F3F4F6] p-6">
        <div className="max-w-sm rounded border border-border bg-white p-5 text-center">
          <h1 className="text-sm font-bold text-danger">Loja indisponível</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-text-subtle">{error}</p>
        </div>
      </div>
    )
  }

  const storeName = restaurante.nome

  // Menor taxa de entrega da loja — a informação que o cliente procura primeiro
  // ao abrir "Sobre a loja" ("de quanto sai daqui?").
  const menorTaxaEntrega = bairros.length > 0
    ? Math.min(restaurante.taxaEntregaPadrao, ...bairros.map((b) => b.taxa))
    : restaurante.taxaEntregaPadrao

  // Horário de funcionamento resumido numa pílula: aberta mostra até quando
  // atende; fechada mostra quando volta. Sem grade configurada, some.
  const horarioTexto = restaurante.lojaAberta
    ? restaurante.fechamentoHoraTexto
      ? `Até ${restaurante.fechamentoHoraTexto}`
      : null
    : abreviarProximaAbertura(restaurante.proximaAberturaTexto)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="font-loja min-h-dvh bg-[#F3F4F6] text-text-main"
      style={{ '--tema-primaria': paleta.primaria, '--tema-dark': paleta.dark, '--tema-light': paleta.light, '--tema-from': paleta.from } as React.CSSProperties}
    >
      <style>{`@keyframes toast-pop-top{from{opacity:0;transform:translateY(-10px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes cupons-piscar{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.15)}}`}</style>

      {/* ── Desktop top nav ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 hidden border-b border-border bg-white lg:block">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-2 px-8">
          <div className="flex items-center gap-2.5 font-extrabold tracking-tight">
            {restaurante.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={restaurante.logoUrl} alt={storeName} loading="eager" decoding="async" width={32} height={32} className="h-8 w-8 rounded object-cover" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded bg-gradient-to-br from-[var(--tema-primaria)] to-[var(--tema-dark)] text-sm font-extrabold text-white">
                {storeName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-[15px]">{storeName}</span>
          </div>
          <nav className="ml-6 flex items-center gap-1">
            {([
              { id: 'home' as Tab, label: 'Cardápio' },
              { id: 'pedidos' as Tab, label: 'Pedidos' },
              { id: 'cupons' as Tab, label: 'Cupons' },
            ] as const).map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={['inline-flex items-center gap-1.5 rounded px-3.5 py-2 text-[13px] font-semibold transition-colors', tab === item.id ? 'bg-[#F3F4F6] text-[var(--tema-primaria)]' : 'text-text-subtle hover:text-text-main'].join(' ')}
              >
                {item.label}
                {/* Badge: prêmios de fidelidade prontos pra resgatar */}
                {item.id === 'cupons' && recompensasDisponiveis > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#EF4444] px-1 text-[10px] font-bold leading-none text-white">
                    {recompensasDisponiveis}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <button
            onClick={() => setTab('cart')}
            className={['ml-auto flex items-center gap-2.5 rounded border px-4 py-2 text-[13px] font-bold transition-colors', tab === 'cart' ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)] text-white' : 'border-border bg-white text-text-main hover:border-[var(--tema-primaria)]'].join(' ')}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96C5 16.1 6.9 18 9 18h12v-2H9.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63H19c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z" /></svg>
            Sacola
            {cartCount > 0 && <span className="rounded bg-white/20 px-1.5 py-0.5 text-[11px]">{cartCount}</span>}
            {cartCount > 0 && <span>{brl(total)}</span>}
          </button>
        </div>
      </header>

      <div className="relative mx-auto min-h-dvh max-w-[600px] bg-[#F3F4F6] pb-24 lg:max-w-[1280px] lg:pb-16">

        {/* ── HOME header: cover banner + profile + search + category nav ── */}
        {tab === 'home' && (
          <>
            {/* Cover banner — no desktop ganha uma faixa colorida (cor do tema da loja) atrás
                e uma moldura branca ao redor, tipo vitrine premium; no mobile fica como sempre foi. */}
            <div className="relative">
              <div className="absolute inset-x-0 top-0 hidden h-44 bg-gradient-to-br from-[var(--tema-from)] via-[var(--tema-primaria)] to-[var(--tema-dark)] lg:block" />
              <div className="relative lg:mx-8 lg:mt-10 lg:rounded-menuzia lg:bg-white lg:p-1.5 lg:shadow-md">
                <div className="relative z-0 h-28 w-full overflow-hidden sm:h-40 lg:h-80 lg:rounded-menuzia">
                  {restaurante.bannerUrl ? (
                    // Capa da loja: é o LCP da vitrine — carrega cedo e com prioridade alta.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={restaurante.bannerUrl}
                      // Celular estreito baixa a variante de 800 px; o desktop
                      // continua na de 1600 px. Loja sem a variante cai no src.
                      {...(srcSetCapa(restaurante.bannerUrl, restaurante.bannerMobileUrl) ? { srcSet: srcSetCapa(restaurante.bannerUrl, restaurante.bannerMobileUrl), sizes: TAMANHOS_CAPA } : {})}
                      alt={storeName}
                      loading="eager"
                      decoding="async"
                      fetchPriority="high"
                      className="h-full w-full object-cover"
                    />
                  ) : collageImages[0] ? (
                    <ProductImage item={collageImages[0]} className="h-full w-full" prioritaria />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-[var(--tema-from)] via-[var(--tema-primaria)] to-[var(--tema-dark)]" />
                  )}
                </div>
              </div>
            </div>

            {/* Barra única da loja: logo + nome/status + busca/info (de ponta a ponta) */}
            <div className="relative z-10 px-3 sm:px-4 lg:px-8">
              {/* Logo grande e o texto do lado ocupando a mesma altura: nome,
                  status, tempo/nota e endereço somam a altura da logo. */}
              <div className="-mt-8 flex items-center gap-3 rounded-md border border-border bg-white p-2.5 shadow-md sm:-mt-10 sm:gap-4 sm:p-3.5">
                <div className="h-[88px] w-[88px] flex-shrink-0 overflow-hidden rounded-md bg-[#F3F4F6] sm:h-[96px] sm:w-[96px] lg:h-[108px] lg:w-[108px]">
                  {restaurante.logoUrl ? (
                    // Logo da loja fica acima da dobra em todos os breakpoints: sem lazy.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={restaurante.logoUrl} alt={storeName} loading="eager" decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--tema-primaria)] to-[var(--tema-dark)] text-2xl font-extrabold text-white sm:text-3xl">
                      {storeName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-[17px] font-extrabold leading-tight tracking-tight text-text-main sm:text-[22px] lg:text-[26px]">{storeName}</h1>
                  {/* Uma pílula por linha de informação: com tudo na mesma
                      linha, tempo de entrega e nota saíam da tela no celular. */}
                  <div className="mt-1 flex items-center gap-1.5">
                    {restaurante.lojaAberta ? (
                      <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded bg-price-bg px-2 py-[3px] text-[11px] font-bold text-promo sm:text-[12px]">
                        <span className="h-1.5 w-1.5 rounded-full bg-promo" /> Aberta
                      </span>
                    ) : (
                      <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded bg-danger-bg px-2 py-[3px] text-[11px] font-bold text-[#B91C1C] sm:text-[12px]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#B91C1C]" /> Fechada
                      </span>
                    )}
                    {horarioTexto && (
                      <span className="inline-flex min-w-0 items-center gap-1 rounded bg-petrol-bg px-2 py-[3px] text-[11px] font-semibold text-petrol sm:text-[12px]">
                        <Clock className="h-3 w-3 flex-shrink-0" strokeWidth={2.5} />
                        <span className="truncate">{horarioTexto}</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11.5px] font-semibold text-petrol sm:text-[12.5px]">
                    <span className="inline-flex flex-shrink-0 items-center gap-1">
                      <Truck className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2.5} /> 30–45 min
                    </span>
                    {restaurante.avaliacaoNota !== null && restaurante.avaliacaoQtd !== null && (
                      <span className="inline-flex flex-shrink-0 items-center gap-1">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 flex-shrink-0 fill-petrol"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                        {formatarNota(restaurante.avaliacaoNota)}
                        <span className="font-medium text-text-subtle">({restaurante.avaliacaoQtd})</span>
                      </span>
                    )}
                  </div>
                  {(restaurante.bairro || restaurante.cidade) && (
                    <p className="mt-1 truncate text-[11.5px] font-medium text-text-subtle sm:text-[12.5px]">
                      📍 {capitalizarTexto([restaurante.bairro, restaurante.cidade].filter(Boolean).join(', '))}
                    </p>
                  )}
                </div>
                {/* Empilhados no celular: lado a lado eles comiam a largura do
                    nome da loja e cortavam o texto. */}
                <div className="flex flex-shrink-0 flex-col items-center gap-1.5 sm:flex-row sm:gap-2">
                  <button
                    onClick={() => setSearchOpen((v) => !v)}
                    className="flex h-9 w-9 items-center justify-center rounded-md bg-[#F3F4F6] transition-colors hover:bg-border sm:h-10 sm:w-10"
                    aria-label="Buscar no cardápio"
                  >
                    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] flex-shrink-0 fill-text-subtle/70">
                      <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 119.5 5a4.5 4.5 0 010 9z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setInfoOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-md bg-[#F3F4F6] transition-colors hover:bg-border sm:h-10 sm:w-10"
                    aria-label="Informações da loja"
                  >
                    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] flex-shrink-0 fill-text-subtle/70">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {restaurante.bannerPromocionalUrl && (
              <div className="mx-4 mt-3 lg:mx-8">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={restaurante.bannerPromocionalUrl}
                  alt="Promoção"
                  // Fica logo abaixo do hero: quando está visível o browser baixa
                  // na hora; quando não está, deixa de concorrer com o LCP.
                  loading="lazy"
                  decoding="async"
                  className="h-28 w-full rounded-md border border-border object-cover sm:h-36"
                />
              </div>
            )}

            {/* Search (colapsável) — só ocupa espaço quando aberta */}
            {searchOpen && (
              <div className="mx-4 mt-3 lg:mx-8">
                <div className="flex items-center gap-2.5 rounded-md bg-white px-4 py-3 shadow-sm">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] flex-shrink-0 fill-text-subtle/60">
                    <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 119.5 5a4.5 4.5 0 010 9z" />
                  </svg>
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar no cardápio…"
                    className="w-full border-none bg-transparent font-sans text-sm text-text-main outline-none placeholder:text-text-subtle"
                  />
                  <button onClick={() => { setSearch(''); setSearchOpen(false) }} className="text-text-subtle hover:text-text-main">×</button>
                </div>
              </div>
            )}

            {/* Duas colunas no desktop: cardápio à esquerda + sacola fixa à direita */}
            <div className="lg:flex lg:items-start lg:gap-8 lg:px-8">
            <div className="min-w-0 flex-1">
            {/* Category nav */}
            <div className="sticky top-0 z-10 mt-2 flex gap-2 overflow-x-auto bg-[#F3F4F6] px-4 py-2 [scrollbar-width:none] lg:top-16 lg:px-0">
              {promoItems.length > 0 && (
                <button
                  onClick={() => setActiveCategory('__promos__')}
                  className={['flex-shrink-0 whitespace-nowrap rounded border px-3.5 py-1.5 text-[13px] font-semibold transition-colors', activeCategory === '__promos__' ? 'border-promo bg-promo text-white shadow-sm' : 'border-border bg-white text-text-subtle hover:border-promo hover:text-promo'].join(' ')}
                >
                  🏷️ Promoções
                </button>
              )}
              {groups.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => { setActiveCategory(cat.nome); document.getElementById(`sec-${cat.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                  className={['flex-shrink-0 whitespace-nowrap rounded border px-3.5 py-1.5 text-[13px] font-semibold transition-colors', activeCategory === cat.nome ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)] text-white' : 'border-border bg-white text-text-subtle hover:border-[var(--tema-primaria)] hover:text-[var(--tema-primaria)]'].join(' ')}
                >
                  {cat.nome}
                </button>
              ))}
            </div>

            {/* Banner ÚNICO de resgate: prêmios prontos hoje + cupons públicos da loja */}
            {bannerResgateTexto && activeCategory !== '__promos__' && !search.trim() && (
              <div className="px-4 pt-3 lg:px-0">
                <button
                  onClick={() => setTab('cupons')}
                  className="animate-resgate flex w-full items-center gap-3 rounded-md border border-warn bg-warn-bg px-3.5 py-3 text-left shadow-sm transition-all hover:shadow-md active:scale-[0.99]"
                >
                  <span className="text-[20px] leading-none">🎁</span>
                  <span className="flex-1 text-[13px] font-bold text-[#92400E]">{bannerResgateTexto}</span>
                </button>
              </div>
            )}

            {/* Destaques */}
            {destaques.length > 0 && activeCategory !== '__promos__' && !search.trim() && (
              <div className="px-4 pb-1 pt-3 lg:px-0">
                <h2 className="mb-2.5 text-[17px] font-bold tracking-tight">Destaques</h2>
                <div className="flex items-start gap-3 overflow-x-auto pb-1 [scrollbar-width:none] lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible xl:grid-cols-4">
                  {destaques.map((item) => (
                    <ProductCard key={item.id} item={item} onClick={() => openProduct(item)} className="w-[120px] flex-shrink-0 lg:w-auto" compact />
                  ))}
                </div>
              </div>
            )}

            {/* Promo filter view */}
            {activeCategory === '__promos__' && (
              <div className="px-4 pb-1 pt-4 lg:px-0">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-[17px] font-bold tracking-tight">Promoções</h2>
                  <span className="rounded bg-promo px-2 py-0.5 text-[11px] font-bold text-white">{promoItems.length} itens</span>
                </div>
                <ItemsGrid items={promoItems} layout={restaurante.layoutCardapio} onSelect={openProduct} imagemGrande={restaurante.imagemGrande} />
              </div>
            )}

            {/* Cardápio ainda a caminho: o cabeçalho acima já está pintado. */}
            {loading && (
              <div className="px-4 py-16 text-center text-sm text-text-subtle lg:px-0">Carregando cardápio…</div>
            )}

            {/* Regular categories (or search results) */}
            {!loading && activeCategory !== '__promos__' &&
              (search.trim()
                ? groups.map((g) => ({ ...g, itens: g.itens.filter((i) => i.nome.toLowerCase().includes(search.toLowerCase())) })).filter((g) => g.itens.length > 0)
                : groups
              ).map((cat) => (
                <div key={cat.id} id={`sec-${cat.id}`} className="px-4 pb-1 pt-4 lg:px-0">
                  <h2 className="mb-3 text-[17px] font-bold tracking-tight">{cat.nome}</h2>
                  <ItemsGrid items={cat.itens} layout={restaurante.layoutCardapio} onSelect={openProduct} imagemGrande={restaurante.imagemGrande} />
                </div>
              ))}
            {search.trim() && groups.every((g) => !g.itens.some((i) => i.nome.toLowerCase().includes(search.toLowerCase()))) && (
              <div className="px-4 py-16 text-center text-sm text-text-subtle lg:px-0">Nenhum item encontrado para &ldquo;{search}&rdquo;.</div>
            )}
            </div>

            {/* Sacola fixa à direita (desktop) */}
            <aside className="hidden w-[380px] flex-shrink-0 lg:block">
              <div className="sticky top-20 pt-4">
                <div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
                    <span className="text-[15px] font-bold">Sua sacola</span>
                    {cartCount > 0 && (
                      <span className="rounded-full bg-[var(--tema-primaria)] px-2.5 py-0.5 text-[11px] font-bold text-white">
                        {cartCount} {cartCount === 1 ? 'item' : 'itens'}
                      </span>
                    )}
                  </div>
                  {cart.length === 0 ? (
                    <div className="px-4 py-12 text-center">
                      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F3F4F6] text-2xl">🛍️</div>
                      <p className="text-[13px] font-semibold text-text-main">Sua sacola está vazia</p>
                      <p className="mt-1 text-[12px] text-text-subtle">Adicione itens do cardápio ao lado.</p>
                    </div>
                  ) : (
                    <>
                      <div className="max-h-[34vh] overflow-y-auto">
                        {cart.map((line, i) => renderCartLine(line, i < cart.length - 1))}
                      </div>
                      <div className="border-t border-border p-4">
                        {canalSelector}
                        {freteGratisBanner}
                        {beneficioBanner}
                        <div className="mb-3 space-y-1.5 text-[13px]">
                          <div className="flex items-center justify-between text-text-subtle"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
                          {desconto > 0 && (
                            <div className="flex items-center justify-between font-semibold text-[#16A34A]"><span>Desconto</span><span>-{brl(desconto)}</span></div>
                          )}
                          <div className="flex items-center justify-between">
                            <span className="text-text-subtle">{rotuloLinhaFrete}</span>
                            {valorLinhaFrete}
                          </div>
                          <div className="flex items-center justify-between pt-1 text-[15px] font-bold"><span>Total</span><span className="text-[#16A34A]">{brl(total)}</span></div>
                        </div>
                        {tipoPedido === 'entrega' && (
                        <button
                          onClick={() => setFreteOpen(true)}
                          className="mb-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 py-2.5 text-[12px] font-bold text-text-main transition-all hover:border-[var(--tema-primaria)] hover:text-[var(--tema-primaria)] active:scale-[0.98]"
                        >
                          <Truck className="h-4 w-4" strokeWidth={2} />
                          Calcular taxa de entrega
                        </button>
                        )}
                        {!restaurante.lojaAberta && (
                          <p className="mb-2.5 rounded-lg bg-danger-bg px-3 py-2 text-center text-[12px] font-semibold text-danger">
                            Loja fechada no momento{restaurante.proximaAberturaTexto ? ` — ${restaurante.proximaAberturaTexto}` : ' — não é possível finalizar o pedido'}.
                          </p>
                        )}
                        <button
                          disabled={!restaurante.lojaAberta}
                          onClick={() => {
                            if (!clienteSessao) { setContaOpen(true); showToast('Entre com seu telefone para finalizar o pedido.'); return }
                            // Desktop entra pelo resumo (step 0) — inclui o "Peça também".
                            setCheckoutOpen(true); setCheckoutMinStep(0); setCheckoutStep(0); setCheckoutError(null)
                          }}
                          className="flex w-full items-center justify-between rounded-lg bg-[#16A34A] px-4 py-3.5 text-[14px] font-bold text-white shadow-sm transition-all hover:bg-[#15803D] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span>Continuar para pagamento</span>
                          <span>{brl(total)}</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </aside>
            </div>
          </>
        )}

        {/* ── CART header: minimal ── */}
        {tab === 'cart' && (
          <div className="flex h-16 items-center gap-3 border-b border-border bg-white px-4 lg:hidden">
            {/* Logo junto do nome: no meio do checkout o cliente precisa ver de
                qual loja é a sacola, não só ler. */}
            <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-[#F3F4F6]">
              {restaurante.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={restaurante.logoUrl} alt={storeName} loading="eager" decoding="async" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--tema-primaria)] to-[var(--tema-dark)] text-sm font-extrabold text-white">
                  {storeName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Sua sacola</div>
              <div className="truncate text-[14px] font-bold">{storeName}</div>
            </div>
            <button
              onClick={() => setTab('home')}
              className="flex flex-shrink-0 items-center gap-1.5 rounded border border-border bg-white px-3 py-2 text-[12px] font-semibold text-text-subtle transition-colors hover:border-[var(--tema-primaria)] hover:text-[var(--tema-primaria)] active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" /></svg>
              Continuar comprando
            </button>
          </div>
        )}

        {tab === 'pedidos' && (
          <div className="flex h-14 items-center border-b border-border bg-white px-4 lg:hidden">
            <h2 className="text-base font-bold">Meus pedidos</h2>
          </div>
        )}
        {tab === 'cupons' && (
          <div className="flex h-14 items-center border-b border-border bg-white px-4 lg:hidden">
            <h2 className="text-base font-bold">Cupons</h2>
          </div>
        )}

        {/* ── CART tab ──────────────────────────────────────────────────── */}
        {tab === 'cart' && (
          <div className="px-4 pt-4 lg:px-8 lg:pt-8">
            {cart.length === 0 ? (
              <div className="py-20 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-3xl">🛍️</div>
                <p className="font-semibold text-text-main">Sua sacola está vazia</p>
                <p className="mt-1 text-[13px] text-text-subtle">Escolha seus itens favoritos no cardápio.</p>
                <button onClick={() => setTab('home')} className="mt-5 rounded-lg bg-[var(--tema-primaria)] px-6 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-[var(--tema-dark)] active:scale-[0.98]">
                  Ver cardápio
                </button>
              </div>
            ) : (
              <div className="lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-6">
                <div>
                  <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-text-subtle">
                    {cartCount} item{cartCount !== 1 ? 's' : ''} no carrinho
                  </p>

                  {/* Lines */}
                  <div className="mb-5 overflow-hidden rounded-lg border border-border bg-white">
                    {cart.map((line, i) => renderCartLine(line, i < cart.length - 1))}
                  </div>

                  {/* Order bumps — "Peça também" */}
                  {orderBumpsBlock}
                </div>

                <div className="lg:sticky lg:top-24">
                  {canalSelector}
                  {freteGratisBanner}
                  {beneficioBanner}

                  {/* Summary */}
                  <div className="mb-4 overflow-hidden rounded-lg border border-border bg-white">
                    <div className="flex items-center justify-between px-4 py-3 text-[13px] text-text-subtle">
                      <span>Subtotal</span><span>{brl(subtotal)}</span>
                    </div>
                    {desconto > 0 && (
                      <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[13px] font-semibold text-[#16A34A]">
                        <span>Desconto</span><span>-{brl(desconto)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[13px]">
                      <span className="text-text-subtle">{rotuloLinhaFrete}</span>
                      {valorLinhaFrete}
                    </div>
                    <div className="flex items-center justify-between border-t border-border px-4 py-3.5 text-[15px] font-bold">
                      <span>Total</span><span className="text-[#16A34A]">{brl(total)}</span>
                    </div>
                  </div>
                  {tipoPedido === 'entrega' && (
                    <button
                      onClick={() => setFreteOpen(true)}
                      className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-white px-5 py-3 text-[13px] font-bold text-text-main transition-all hover:border-[var(--tema-primaria)] hover:text-[var(--tema-primaria)] active:scale-[0.98]"
                    >
                      <Truck className="h-[18px] w-[18px]" strokeWidth={2} />
                      Calcular taxa de entrega
                    </button>
                  )}

                  <button
                    onClick={() => setTab('home')}
                    className="flex w-full items-center justify-center rounded-lg border-2 border-[var(--tema-primaria)] bg-white px-5 py-3 text-[14px] font-bold text-[var(--tema-primaria)] transition-all hover:bg-[var(--tema-light)] active:scale-[0.98]"
                  >
                    Continuar comprando
                  </button>
                  {!restaurante.lojaAberta && (
                    <p className="mt-2.5 rounded-lg bg-danger-bg px-3 py-2 text-center text-[12px] font-semibold text-danger">
                      Loja fechada no momento{restaurante.proximaAberturaTexto ? ` — ${restaurante.proximaAberturaTexto}` : ' — não é possível finalizar o pedido'}.
                    </p>
                  )}
                  <button
                    disabled={!restaurante.lojaAberta}
                    onClick={() => {
                      if (!clienteSessao) { setContaOpen(true); showToast('Entre com seu telefone para finalizar o pedido.'); return }
                      // Mobile: a aba carrinho já é o resumo — entra direto no pagamento.
                      setCheckoutOpen(true); setCheckoutMinStep(1); setCheckoutStep(1); setCheckoutError(null)
                    }}
                    className="mt-2.5 flex w-full items-center justify-between rounded-lg bg-[#16A34A] px-5 py-4 text-[15px] font-bold text-white shadow-sm transition-all hover:bg-[#15803D] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>Continuar para pagamento</span>
                    <span>{brl(total)}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PEDIDOS tab ───────────────────────────────────────────────── */}
        {tab === 'pedidos' && (
          <div className="px-4 pt-6 lg:mx-auto lg:max-w-2xl lg:px-8 lg:pt-10">
            {!clienteSessao ? (
              <div className="py-16 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-3xl">🔒</div>
                <p className="font-semibold text-text-main">Entre para ver seus pedidos</p>
                <p className="mx-auto mt-1 max-w-[260px] text-[13px] text-text-subtle">Confirme seu telefone para acompanhar o status e o histórico dos seus pedidos nesta loja.</p>
                <button onClick={() => setContaOpen(true)} className="mt-5 rounded bg-[var(--tema-primaria)] px-6 py-2.5 text-sm font-bold text-white hover:bg-[var(--tema-dark)]">
                  Entrar com WhatsApp
                </button>
              </div>
            ) : pedidosLoading && meusPedidos.length === 0 ? (
              <div className="py-20 text-center text-[13px] text-text-subtle">Carregando seus pedidos…</div>
            ) : meusPedidos.length === 0 ? (
              <div className="py-20 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-3xl">📦</div>
                <p className="font-semibold text-text-main">Nenhum pedido ainda</p>
                <p className="mt-1 text-[13px] text-text-subtle">Quando você finalizar um pedido, o acompanhamento aparece aqui.</p>
                <button onClick={() => setTab('home')} className="mt-5 rounded bg-[var(--tema-primaria)] px-6 py-2.5 text-sm font-bold text-white hover:bg-[var(--tema-dark)]">
                  Ver cardápio
                </button>
              </div>
            ) : (
              <div className="space-y-4 pb-4">
                {meusPedidos.map((p) => {
                  const info = STATUS_PEDIDO_INFO[p.status] ?? { label: p.status, cls: 'bg-[#F3F4F6] text-text-subtle' }
                  const ativo = PEDIDO_ATIVO.has(p.status)
                  const data = new Date(p.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                  const resumo = p.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', ')
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPedidoDetalhe(p)}
                      className="block w-full overflow-hidden rounded border border-border bg-white text-left transition-shadow hover:shadow-md active:scale-[0.99]"
                    >
                      <div className="flex items-start justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <div className="text-[15px] font-bold">Pedido #{p.numero}</div>
                          <div className="mt-0.5 text-[12px] text-text-subtle">{data} · {p.tipo === 'retirada' ? 'Retirada' : 'Entrega'}</div>
                        </div>
                        <span className={['flex-shrink-0 rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide', info.cls].join(' ')}>{info.label}</span>
                      </div>
                      <div className="border-t border-border px-4 py-3">
                        <p className="line-clamp-2 text-[13px] text-text-subtle">{resumo}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-[12px] font-semibold text-[var(--tema-primaria)]">Ver detalhes →</span>
                          <span className="text-[15px] font-bold text-[#16A34A]">{brl(p.total)}</span>
                        </div>
                      </div>
                      {ativo && <div className="px-4 pb-4"><PedidoTimeline status={p.status} tipo={p.tipo} /></div>}
                      {p.status === 'cancelado' && (
                        <div className="border-t border-danger/30 bg-danger-bg px-4 py-2.5 text-[12px] font-medium text-danger">Este pedido foi cancelado.</div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Modal: detalhes do pedido ─────────────────────────────────── */}
        {pedidoDetalhe && (() => {
          const p = pedidoDetalhe
          const info = STATUS_PEDIDO_INFO[p.status] ?? { label: p.status, cls: 'bg-[#F3F4F6] text-text-subtle' }
          const ativo = PEDIDO_ATIVO.has(p.status)
          const pontos = Math.max(0, Math.floor(p.subtotal))
          const waDigits = (restaurante?.telefone ?? '').replace(/\D/g, '')
          const waLink = waDigits
            ? `https://wa.me/${waDigits.length <= 11 ? '55' + waDigits : waDigits}?text=${encodeURIComponent(`Olá! Sobre meu pedido #${p.numero}`)}`
            : null
          return (
            <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={() => setPedidoDetalhe(null)}>
              <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <h2 className="text-[17px] font-bold text-text-main">Detalhes do pedido</h2>
                  <button onClick={() => setPedidoDetalhe(null)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F3F4F6] text-[15px] text-text-subtle transition-colors hover:bg-border">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className={['rounded px-2.5 py-1 text-[12px] font-bold uppercase tracking-wide', info.cls].join(' ')}>{info.label}</span>
                    <span className="text-[12px] text-text-subtle">
                      {new Date(p.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {ativo && <div className="mt-4"><PedidoTimeline status={p.status} tipo={p.tipo} /></div>}
                  {p.status === 'cancelado' && (
                    <div className="mt-4 rounded bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger">Este pedido foi cancelado.</div>
                  )}

                  <div className="my-4 border-t border-border" />
                  <h3 className="text-[15px] font-bold text-text-main">Pedido N° {p.numero}</h3>

                  <ul className="mt-3 space-y-3">
                    {p.itens.map((i, idx) => {
                      const variacao = [i.tamanhoNome, i.saborNome].filter(Boolean).join(' - ')
                      return (
                        <li key={idx} className="flex gap-3 border-b border-border pb-3 last:border-none">
                          <span className="flex h-7 min-w-[30px] items-center justify-center rounded border border-border px-1.5 text-[12px] font-bold text-text-main">{i.quantidade}x</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-semibold text-text-main">{i.nome}</p>
                            {(variacao || i.descricao) && (
                              <p className="mt-0.5 text-[12px] leading-relaxed text-text-subtle">{[variacao, i.descricao].filter(Boolean).join(' · ')}</p>
                            )}
                            {i.complementos.length > 0 && (
                              <p className="mt-0.5 text-[12px] text-text-subtle">+ {i.complementos.join(', ')}</p>
                            )}
                            {i.observacao && (
                              <p className="mt-1 text-[12px] font-semibold uppercase text-text-main">OBS: {i.observacao}</p>
                            )}
                          </div>
                          <span className="flex-shrink-0 text-[14px] font-bold text-text-main">{brl(i.precoUnitario * i.quantidade)}</span>
                        </li>
                      )
                    })}
                  </ul>
                  {p.observacao && (
                    <p className="mt-2 rounded bg-[#F3F4F6] px-3 py-2 text-[12px] font-medium text-text-main">OBS do pedido: {p.observacao}</p>
                  )}

                  <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-[14px]">
                    <div className="flex justify-between text-text-subtle"><span>Subtotal</span><span>{brl(p.subtotal)}</span></div>
                    {p.desconto > 0 && (
                      <div className="flex justify-between text-[#16A34A]"><span>Desconto</span><span>-{brl(p.desconto)}</span></div>
                    )}
                    {p.tipo === 'entrega' && (
                      <div className="flex justify-between text-text-subtle"><span>Taxa de entrega</span><span>{brl(p.taxaEntrega)}</span></div>
                    )}
                    <div className="flex justify-between text-[15px] font-bold text-text-main"><span>Total</span><span>{brl(p.total)}</span></div>
                    <div className="flex justify-between pt-1 text-[13px] font-semibold text-[#16A34A]"><span>Pontuação deste pedido</span><span>{pontos} pontos</span></div>
                  </div>
                </div>

                {waLink && (
                  <div className="border-t border-border p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-2 rounded bg-[var(--tema-primaria)] py-3.5 text-[13px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-[var(--tema-dark)]"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                        <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
                      </svg>
                      Falar com o estabelecimento
                    </a>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* ── CUPONS tab ────────────────────────────────────────────────── */}
        {tab === 'cupons' && (() => {
          if (!fidelidade) {
            if (fidelidadeErro) {
              return (
                <div className="flex flex-col items-center gap-3 py-20 text-center">
                  <div className="text-[13px] text-text-subtle">Não conseguimos carregar seus cupons.</div>
                  <button
                    onClick={() => { setFidelidadeErro(false); setFidelidadeVersao((v) => v + 1) }}
                    className="rounded-md border border-border bg-white px-4 py-2 text-[12px] font-bold uppercase tracking-wide text-text-main shadow-sm transition-colors hover:border-[var(--tema-primaria)]"
                  >
                    Tentar de novo
                  </button>
                </div>
              )
            }
            return <div className="py-20 text-center text-[13px] text-text-subtle">Carregando cupons…</div>
          }
          const recompensas = fidelidade.recompensas
          const missoes = fidelidade.campanhas
          const cuponsLoja = fidelidade.cuponsPublicos
          const nadaParaMostrar = recompensas.length === 0 && missoes.length === 0 && cuponsLoja.length === 0
          return (
            <div className="space-y-6 px-4 pb-8 pt-5 lg:mx-auto lg:max-w-2xl lg:px-8 lg:pt-10">
              {/* Não logado: cupons públicos aparecem, progresso exige sessão */}
              {!clienteSessao && (
                <button
                  onClick={() => setContaOpen(true)}
                  className="flex w-full items-center gap-3.5 rounded-md border border-border bg-white p-4 text-left shadow-sm transition-all hover:border-[var(--tema-primaria)] active:scale-[0.99]"
                >
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[var(--tema-light)]">
                    <Gift className="h-5 w-5 text-[var(--tema-primaria)]" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold text-text-main">Entre pra ver seu progresso</span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-text-subtle">Confirme seu telefone e acompanhe suas missões e prêmios de fidelidade nesta loja.</span>
                  </span>
                  <span className="flex-shrink-0 text-text-subtle">→</span>
                </button>
              )}

              {/* Prêmios prontos pra resgatar */}
              {recompensas.length > 0 && (
                <section>
                  <h2 className="mb-2.5 text-[17px] font-bold tracking-tight">Prêmios prontos 🎁</h2>
                  <div className="space-y-3">
                    {recompensas.map((r) => {
                      const label = premioLabelCampanha({ premioTipo: r.premioTipo, premioValor: r.premioValor }, r.premioItemNome)
                      const diasTexto = r.diasSemanaResgate.length > 0 ? diasSemanaTexto(r.diasSemanaResgate) : null
                      return (
                        <div key={r.id} className="overflow-hidden rounded-md border border-[#16A34A]/40 bg-white shadow-sm">
                          <div className="flex items-start gap-3.5 p-3.5">
                            <ProductThumb item={{ nome: r.premioItemNome ?? r.campanhaNome, imagemUrl: r.premioItemImagemUrl ?? null }} size={112} fallbackIcon={iconePremio(r.premioTipo)} />
                            <div className="min-w-0 flex-1">
                              <span className="inline-block rounded bg-[#DCFCE7] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#16A34A]">Prêmio desbloqueado</span>
                              <div className="mt-1.5 text-[15px] font-bold leading-snug text-text-main first-letter:uppercase">{label}</div>
                              <div className="mt-0.5 text-[12px] text-text-subtle">{r.campanhaNome}</div>
                              {diasTexto && <div className="mt-1 text-[12px] font-medium text-text-subtle">Resgate {diasTexto}</div>}
                            </div>
                          </div>
                          <div className="px-3.5 pb-3.5">
                            <button
                              onClick={() => usarRecompensa(r)}
                              disabled={!r.podeResgatarHoje}
                              className={['w-full rounded py-3 text-[12px] font-bold uppercase tracking-wide transition-all', r.podeResgatarHoje ? 'bg-[#16A34A] text-white hover:bg-[#15803D] active:scale-[0.99]' : 'cursor-not-allowed bg-[#F3F4F6] text-text-subtle'].join(' ')}
                            >
                              Usar no pedido
                            </button>
                            {!r.podeResgatarHoje && diasTexto && (
                              <p className="mt-2 rounded border border-warn bg-warn-bg px-2.5 py-1.5 text-[12px] font-medium text-[#92400E]">
                                Hoje não é dia de resgate — este prêmio vale {diasTexto}.
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {/* Missões em andamento (campanhas de fidelidade) */}
              {missoes.length > 0 && (
                <section>
                  <h2 className="mb-2.5 text-[17px] font-bold tracking-tight">Suas missões</h2>
                  <div className="space-y-3">
                    {missoes.map(({ campanha, progresso, resumo }) => {
                      const label = premioLabelCampanha(campanha, campanha.premioItemNome)
                      const progressoTexto = campanha.tipoMeta === 'valor_gasto'
                        ? `${brl(progresso.progressoValor)} / ${brl(campanha.metaValor ?? 0)}`
                        : `${fracaoProgresso(campanha, progresso)} ${campanha.tipoMeta === 'qtd_pedidos' ? 'pedidos' : 'itens'}`
                      const diasContam = campanha.diasSemanaContam.length > 0 ? diasSemanaTexto(campanha.diasSemanaContam) : null
                      return (
                        <div key={campanha.id} className="rounded-md border border-border bg-white p-3.5 shadow-sm">
                          <div className="flex items-start gap-3">
                            <ProductThumb item={{ nome: campanha.premioItemNome ?? campanha.nome, imagemUrl: campanha.premioItemImagemUrl ?? null }} size={56} fallbackIcon={iconePremio(campanha.premioTipo)} />
                            <div className="min-w-0 flex-1">
                              <div className="text-[14px] font-bold leading-snug text-text-main">{campanha.nome}</div>
                              <div className="mt-0.5 text-[12px] text-text-subtle">Prêmio: {label}</div>
                            </div>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#F3F4F6]">
                            <div className="h-full rounded-full bg-[#10B981] transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, resumo.percentual))}%` }} />
                          </div>
                          <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
                            <span className="font-bold text-[#10B981]">{progressoTexto}</span>
                            <span className="font-medium text-text-subtle">{resumo.faltaTexto}</span>
                          </div>
                          {diasContam && <p className="mt-1.5 text-[11px] text-text-subtle">Contam pedidos feitos {diasContam}.</p>}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {/* Cupons públicos da loja */}
              {cuponsLoja.length > 0 && (
                <section>
                  <h2 className="mb-2.5 flex items-center gap-2 text-[17px] font-bold tracking-tight">
                    <Ticket className="h-[19px] w-[19px] text-[var(--tema-primaria)]" strokeWidth={2} />
                    Cupons da loja
                  </h2>
                  <div className="space-y-3">
                    {cuponsLoja.map((c) => (
                      <div key={c.id} className="rounded-md border border-border bg-white p-3.5 shadow-sm">
                        <div className="flex items-center gap-3">
                          <ProductThumb item={{ nome: c.itemNome ?? labelCupom(c), imagemUrl: c.itemImagemUrl ?? null }} size={48} fallbackIcon={iconePremio(c.tipo)} />
                          <span className="flex-shrink-0 rounded border border-dashed border-[var(--tema-primaria)] bg-[var(--tema-light)] px-2.5 py-1.5 text-[13px] font-extrabold tracking-widest text-[var(--tema-primaria)]">{c.codigo}</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-bold text-text-main">{labelCupom(c)}</div>
                            {c.descricao && <div className="mt-0.5 truncate text-[12px] text-text-subtle">{c.descricao}</div>}
                            {(c.valorMinimoPedido != null || c.validadeFim) && (
                              <div className="mt-0.5 text-[11px] text-text-subtle">
                                {[
                                  c.valorMinimoPedido != null ? `Pedido mínimo ${brl(c.valorMinimoPedido)}` : null,
                                  c.validadeFim ? `Válido até ${new Date(`${c.validadeFim}T12:00:00`).toLocaleDateString('pt-BR')}` : null,
                                ].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => aplicarCupomDaAba(c.codigo)}
                          className="mt-3 w-full rounded border border-[var(--tema-primaria)] py-2.5 text-[12px] font-bold uppercase tracking-wide text-[var(--tema-primaria)] transition-colors hover:bg-[var(--tema-light)] active:scale-[0.99]"
                        >
                          Aplicar
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Estado vazio */}
              {nadaParaMostrar && (
                <div className="rounded border border-dashed border-border py-16 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-3xl">🏷️</div>
                  <p className="font-semibold text-text-main">Nenhum cupom por aqui ainda</p>
                  <p className="mx-auto mt-1.5 max-w-[260px] text-[13px] leading-relaxed text-text-subtle">
                    Quando a loja criar cupons ou campanhas de fidelidade, eles aparecem aqui.
                  </p>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Floating cart bar (mobile only) ──────────────────────────── */}
        {cartCount > 0 && tab !== 'cart' && (
          <button
            onClick={() => setTab('cart')}
            className="fixed inset-x-0 bottom-[78px] z-30 mx-auto flex w-[calc(100%-2rem)] max-w-[568px] items-center justify-between rounded-md bg-[#111827] px-4 py-3.5 text-white shadow-lg lg:hidden"
          >
            <span className="flex items-center gap-2.5 text-sm font-bold">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[12px] font-bold">{cartCount}</span>
              Ver sacola
            </span>
            <span className="text-sm font-bold">{brl(total)}</span>
          </button>
        )}

        {/* ── Bottom nav (mobile only) ─────────────────────────────────── */}
        <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[600px] border-t border-border bg-white pb-[max(env(safe-area-inset-bottom),6px)] pt-1 shadow-[0_-4px_20px_rgba(0,0,0,0.07)] lg:hidden">
          <div className="flex">
            {([
              { id: 'home' as Tab, label: 'Home', onClick: () => setTab('home'), active: tab === 'home', icon: <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current"><path d="M12 3.1 2.5 11.4a1 1 0 0 0 .66 1.75H4.5V20a1 1 0 0 0 1 1h3.75a1 1 0 0 0 1-1v-4.25h3.5V20a1 1 0 0 0 1 1h3.75a1 1 0 0 0 1-1v-6.85h1.34a1 1 0 0 0 .66-1.75L12 3.1z" /></svg> },
              { id: 'pedidos' as Tab, label: 'Pedidos', onClick: () => setTab('pedidos'), active: tab === 'pedidos', icon: <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current"><path d="M9 2a1 1 0 0 0-1 1v1H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V3a1 1 0 0 0-1-1H9zm1 2h4v1h-4V4zM8 11h8v1.8H8V11zm0 4h8v1.8H8V15z" /></svg> },
              { id: 'cupons' as Tab, label: 'Cupons', onClick: () => setTab('cupons'), active: tab === 'cupons', icon: <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current"><path d="M3.4 5.25h17.2c.66 0 1.15.5 1.15 1.13v3.03a1.1 1.1 0 0 1-.72 1.03 2 2 0 0 0 0 3.12c.44.17.72.57.72 1.03v3.03c0 .63-.5 1.13-1.15 1.13H3.4c-.66 0-1.15-.5-1.15-1.13v-3.03c0-.46.28-.86.72-1.03a2 2 0 0 0 0-3.12 1.1 1.1 0 0 1-.72-1.03V6.38c0-.63.5-1.13 1.15-1.13zM15.6 7.4v2.05h1.5V7.4h-1.5zm0 4.05v2.05h1.5v-2.05h-1.5zm0 4.05v2.1h1.5v-2.1h-1.5z" /></svg> },
              {
                id: 'perfil' as const,
                label: perfilCliente ? 'Perfil' : 'Entrar',
                onClick: () => setContaOpen(true),
                active: contaOpen,
                icon: perfilCliente ? (
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--tema-primaria)] text-[11px] font-bold text-white">
                    {(perfilCliente.nome || perfilCliente.telefone).charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.42 0-8 2.24-8 5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-2.76-3.58-5-8-5z" /></svg>
                ),
              },
            ] as const).map((item) => (
              <button
                key={item.id}
                onClick={item.onClick}
                // Piscar 3x quando o cliente ganhou progresso/prêmio de fidelidade.
                style={item.id === 'cupons' && cuponsPiscando ? { animation: 'cupons-piscar 0.7s ease-in-out 3' } : undefined}
                className={['relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors', item.active ? 'text-[var(--tema-primaria)]' : 'text-text-subtle hover:text-text-main'].join(' ')}
              >
                <span className="relative">
                  {item.icon}
                  {/* Badge: quantidade de prêmios disponíveis pra resgatar */}
                  {item.id === 'cupons' && recompensasDisponiveis > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#EF4444] px-1 text-[9px] font-bold leading-none text-white">
                      {recompensasDisponiveis}
                    </span>
                  )}
                </span>
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      </div>

      {/* ── Guarda de saída: o voltar na raiz pergunta antes de largar a loja ── */}
      {saidaAberta && (
        <>
          <div className="fixed inset-0 z-[80] bg-[#111827]/60" onClick={() => setSaidaAberta(false)} />
          <div className="fixed inset-x-0 bottom-0 z-[80] mx-auto w-full max-w-[600px] rounded-t-2xl bg-white p-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] shadow-2xl">
            <h2 className="text-center text-lg font-bold text-text-main">Sair do cardápio?</h2>
            <p className="mx-auto mt-1.5 max-w-[320px] text-center text-[13px] leading-relaxed text-text-subtle">
              {cartCount > 0
                ? `Você tem ${cartCount} ${cartCount === 1 ? 'item' : 'itens'} na sacola. Guardamos tudo neste aparelho, mas o pedido ainda não foi enviado.`
                : `Você ainda não finalizou nenhum pedido em ${restaurante?.nome ?? 'nossa loja'}.`}
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                onClick={() => setSaidaAberta(false)}
                className="w-full rounded-lg bg-[var(--tema-primaria)] px-5 py-3.5 text-[15px] font-bold text-white transition-colors hover:bg-[var(--tema-dark)] active:scale-[0.99]"
              >
                {cartCount > 0 ? 'Continuar meu pedido' : 'Continuar no cardápio'}
              </button>
              <button
                onClick={sairDaVitrine}
                className="w-full rounded-lg border border-border px-5 py-3 text-[14px] font-semibold text-text-subtle transition-colors hover:bg-page"
              >
                Sair mesmo assim
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Confirmação pós-pedido + aviso pra loja no WhatsApp ───────── */}
      {confirmacaoAberta && (
        <>
          <div className="fixed inset-0 z-[60] bg-[#111827]/60" onClick={() => setConfirmacaoAberta(false)} />
          <div className="fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-[600px] rounded-t-2xl bg-white p-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] shadow-2xl">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#DCFCE7]">
              <svg viewBox="0 0 24 24" className="h-7 w-7 fill-[#16A34A]"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
            </div>
            <h2 className="text-center text-lg font-bold text-text-main">Pedido enviado!</h2>
            <p className="mx-auto mt-1 max-w-[300px] text-center text-[13px] text-text-subtle">
              A loja já recebeu seu pedido. Acompanhe o status na aba Pedidos.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {pedidoWa && (
                <a
                  href={pedidoWa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] py-3.5 text-[14px] font-bold text-white transition-transform active:scale-[0.99]"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01c-1.52 0-3.01-.41-4.3-1.18l-.31-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.36c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.42-.14 0-.31-.02-.48-.02-.16 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z" /></svg>
                  Avisar a loja no WhatsApp
                </a>
              )}
              <button
                onClick={() => setConfirmacaoAberta(false)}
                className="rounded-xl bg-[var(--tema-primaria)] py-3.5 text-[14px] font-bold text-white transition-transform active:scale-[0.99]"
              >
                Acompanhar pedido
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Product sheet overlay ─────────────────────────────────────── */}
      {productSheet && <div className="fixed inset-0 z-40 bg-[#111827]/60" onClick={closeProductSheet} />}
      <div className={['fixed inset-y-0 left-1/2 z-50 flex h-dvh w-full max-w-[600px] -translate-x-1/2 flex-col overflow-hidden bg-white transition-all duration-300 lg:inset-y-auto lg:bottom-auto lg:top-1/2 lg:h-auto lg:max-h-[85vh] lg:max-w-[520px] lg:-translate-y-1/2 lg:rounded', productSheet ? 'translate-y-0 lg:opacity-100 lg:scale-100' : 'translate-y-full lg:opacity-0 lg:scale-95 lg:pointer-events-none'].join(' ')}>
        {productSheet && (
          <>
            <button onClick={closeProductSheet} className="absolute right-3.5 top-3 z-10 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/90 text-xl font-light shadow-md">×</button>
            <div className="flex-1 overflow-y-auto">
              {productSheet.imagemUrl
                // O sheet só é montado depois do clique, então não concorre com o
                // carregamento inicial — aqui a foto é o conteúdo principal.
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={productSheet.imagemUrl} alt={productSheet.nome} loading="eager" decoding="async" fetchPriority="high" className="h-[42vh] w-full object-cover lg:h-[260px]" />
                : <div className="flex h-[42vh] items-center justify-center bg-[#F3F4F6] lg:h-[260px]"><UtensilsCrossed className="h-20 w-20 text-[#9CA3AF]" strokeWidth={1.5} /></div>
              }
              <div className="p-4.5">
                <h2 className="text-xl font-bold tracking-tight">{productSheet.nome}</h2>
                <p className="my-2 text-sm leading-relaxed text-text-subtle">{productSheet.descricao}</p>
                {productSheet.tipoItem !== 'pizza' && productSheet.tamanhos.length === 0 && (
                  <PriceTag price={productSheet.promocaoPreco ?? productSheet.preco} originalPrice={productSheet.promocaoPreco ? productSheet.preco : null} />
                )}

                {productSheet.tipoItem === 'pizza' && (
                  <div className="mt-1">
                    <GrupoHeader titulo="Tamanho" regra="Escolha 1" obrigatorio contador={selectedTamanhoPizzaId ? '1/1' : '0/1'} />
                    {tamanhosPizza.map((tamanho) => {
                      const isSelected = selectedTamanhoPizzaId === tamanho.id
                      return (
                        <button key={tamanho.id} onClick={() => setSelectedTamanhoPizzaId(tamanho.id)} className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left last:border-none">
                          <span className="flex-1 text-[14.5px] font-semibold">{tamanho.nome} <span className="font-normal text-text-subtle">({tamanho.fatias} fatias)</span></span>
                          <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2', isSelected ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]' : 'border-border'].join(' ')}>
                            {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                          </span>
                        </button>
                      )
                    })}

                    <div className="mt-5" />
                    <GrupoHeader titulo="Sabor" regra="Escolha 1" obrigatorio contador={selectedSaborId ? '1/1' : '0/1'} />
                    {productSheet.sabores.filter((s) => s.status === 'disponivel').map((sabor) => {
                      const isSelected = selectedSaborId === sabor.id
                      const preco = sabor.precos.find((p) => p.tamanhoPadraoId === selectedTamanhoPizzaId)?.preco ?? 0
                      return (
                        <button key={sabor.id} onClick={() => setSelectedSaborId(sabor.id)} className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left last:border-none">
                          <div className="flex-1">
                            <div className="text-[14.5px] font-semibold leading-snug">{sabor.nome}</div>
                            {sabor.descricao && <div className="mt-0.5 text-[12px] leading-snug text-text-subtle">{sabor.descricao}</div>}
                          </div>
                          <span className="flex-shrink-0 text-[14px] font-bold text-promo">{brl(preco)}</span>
                          <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2', isSelected ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]' : 'border-border'].join(' ')}>
                            {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                          </span>
                        </button>
                      )
                    })}

                    {bordasPizza.length > 0 && (
                      <>
                        <div className="mb-2 mt-5 text-sm font-bold">Borda</div>
                        <button onClick={() => setSelectedBordaId(null)} className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left">
                          <span className="flex-1 text-[14.5px] font-semibold">Sem borda</span>
                          <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2', !selectedBordaId ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]' : 'border-border'].join(' ')}>
                            {!selectedBordaId && <span className="h-2 w-2 rounded-full bg-white" />}
                          </span>
                        </button>
                        {bordasPizza.map((borda) => {
                          const isSelected = selectedBordaId === borda.id
                          return (
                            <button key={borda.id} onClick={() => setSelectedBordaId(borda.id)} className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left last:border-none">
                              <span className="flex-1 text-[14.5px] font-semibold">{borda.nome}</span>
                              <span className="flex-shrink-0 text-[14px] font-bold text-promo">+ {brl(borda.preco)}</span>
                              <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2', isSelected ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]' : 'border-border'].join(' ')}>
                                {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                              </span>
                            </button>
                          )
                        })}
                      </>
                    )}

                    {massasPizza.length > 0 && (
                      <>
                        <div className="mb-2 mt-5 text-sm font-bold">Massa</div>
                        <button onClick={() => setSelectedMassaId(null)} className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left">
                          <span className="flex-1 text-sm font-medium">Massa tradicional</span>
                          <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2', !selectedMassaId ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]' : 'border-border'].join(' ')}>
                            {!selectedMassaId && <span className="h-2 w-2 rounded-full bg-white" />}
                          </span>
                        </button>
                        {massasPizza.map((massa) => {
                          const isSelected = selectedMassaId === massa.id
                          return (
                            <button key={massa.id} onClick={() => setSelectedMassaId(massa.id)} className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left last:border-none">
                              <span className="flex-1 text-sm font-medium">{massa.nome}</span>
                              <span className="flex-shrink-0 text-[14px] font-bold text-promo">+ {brl(massa.preco)}</span>
                              <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2', isSelected ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]' : 'border-border'].join(' ')}>
                                {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                              </span>
                            </button>
                          )
                        })}
                      </>
                    )}
                  </div>
                )}

                {productSheet.tamanhos.length > 0 && (
                  <div className="mt-1">
                    <GrupoHeader titulo="Tamanho" regra="Escolha 1" obrigatorio contador={selectedTamanhoId ? '1/1' : '0/1'} />
                    {productSheet.tamanhos.map((tamanho) => {
                      const isSelected = selectedTamanhoId === tamanho.id
                      return (
                        <button key={tamanho.id} onClick={() => setSelectedTamanhoId(tamanho.id)} className="flex w-full items-center gap-3 border-b border-border py-3 text-left last:border-none">
                          <span className="flex-1 text-[14.5px] font-semibold">{tamanho.nome}</span>
                          <span className="text-[14px] font-bold text-promo">{brl(tamanho.preco)}</span>
                          <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2', isSelected ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]' : 'border-border'].join(' ')}>
                            {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {productSheet.grupos.map((grupo) => {
                  const sel = groupSelections.get(grupo.id) ?? new Map<string, number>()
                  const totalSel = totalGrupo(sel)
                  const isRadio = grupo.maxEscolhas === 1 && !grupo.permiteQuantidade
                  const comStepper = grupo.permiteQuantidade && !isRadio
                  const showError = grupo.obrigatorio && totalSel > 0 && totalSel < grupo.minEscolhas
                  return (
                    <div key={grupo.id} className="mt-5">
                      <GrupoHeader
                        titulo={grupo.nome}
                        regra={
                          grupo.obrigatorio
                            ? grupo.maxEscolhas === 0 ? `No mínimo ${grupo.minEscolhas}` : grupo.minEscolhas === grupo.maxEscolhas ? `Escolha ${grupo.minEscolhas}` : `Escolha ${grupo.minEscolhas}–${grupo.maxEscolhas}`
                            : grupo.maxEscolhas === 0 ? 'Quantos quiser' : grupo.maxEscolhas === 1 ? 'Opcional' : `Até ${grupo.maxEscolhas}`
                        }
                        obrigatorio={grupo.obrigatorio}
                        contador={grupo.maxEscolhas > 0 ? `${totalSel}/${grupo.maxEscolhas}` : totalSel > 0 ? `${totalSel}` : undefined}
                      />
                      {grupo.complementos.map((comp) => {
                        const qtdSel = sel.get(comp.id) ?? 0
                        const isSelected = qtdSel > 0
                        const conteudo = (
                          <>
                            {comp.imagemUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={comp.imagemUrl} alt={comp.nome} loading="lazy" decoding="async" width={56} height={56} className="h-14 w-14 flex-shrink-0 rounded border border-border object-cover" />
                            )}
                            <span className="min-w-0 flex-1 text-[14.5px] font-semibold leading-snug">{comp.nome}</span>
                            {comp.preco > 0
                              ? <span className="flex-shrink-0 text-[14px] font-bold text-promo">+ {brl(comp.preco)}</span>
                              : <span className="flex-shrink-0 rounded bg-promo-bg px-1.5 py-0.5 text-[11px] font-bold text-promo">Grátis</span>
                            }
                          </>
                        )
                        if (comStepper) {
                          const podeMais = grupo.maxEscolhas === 0 || totalSel < grupo.maxEscolhas
                          return (
                            <div key={comp.id} className="flex w-full items-center gap-3 border-b border-border py-2.5 last:border-none">
                              {conteudo}
                              <div className="flex flex-shrink-0 items-center rounded border border-border">
                                <button onClick={() => changeCompQty(grupo.id, comp.id, -1, grupo.maxEscolhas)} disabled={qtdSel === 0} className="flex h-[34px] w-[34px] items-center justify-center text-lg font-semibold text-[var(--tema-primaria)] disabled:text-border">−</button>
                                <span className={['w-[24px] text-center text-[14px] font-bold', isSelected ? 'text-text-main' : 'text-text-subtle/50'].join(' ')}>{qtdSel}</span>
                                <button onClick={() => changeCompQty(grupo.id, comp.id, 1, grupo.maxEscolhas)} disabled={!podeMais} className="flex h-[34px] w-[34px] items-center justify-center text-lg font-semibold text-[var(--tema-primaria)] disabled:text-border">+</button>
                              </div>
                            </div>
                          )
                        }
                        return (
                          <button key={comp.id} onClick={() => isRadio ? selectRadio(grupo.id, comp.id) : toggleCheckbox(grupo.id, comp.id, grupo.maxEscolhas)} className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left last:border-none">
                            {conteudo}
                            {isRadio ? (
                              <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2', isSelected ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]' : 'border-border'].join(' ')}>
                                {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                              </span>
                            ) : (
                              <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2', isSelected ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]' : 'border-border'].join(' ')}>
                                {isSelected && <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>}
                              </span>
                            )}
                          </button>
                        )
                      })}
                      {showError && (
                        <div className="mt-1.5 rounded border border-danger/30 bg-danger-bg px-2.5 py-1.5 text-[11px] font-medium text-danger">
                          Selecione ao menos {grupo.minEscolhas} item{grupo.minEscolhas > 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  )
                })}

                {productSheet.complementos.length > 0 && (
                  <div className="mt-5">
                    <GrupoHeader titulo="Adicionais" regra="Quantos quiser" obrigatorio={false} contador={selectedAddons.size > 0 ? `${selectedAddons.size}` : undefined} />
                    {productSheet.complementos.map((addon) => (
                      <button key={addon.id} onClick={() => toggleAddon(addon.nome)} className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left last:border-none">
                        {addon.imagemUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={addon.imagemUrl} alt={addon.nome} loading="lazy" decoding="async" width={56} height={56} className="h-14 w-14 flex-shrink-0 rounded border border-border object-cover" />
                        )}
                        <span className="min-w-0 flex-1 text-[14.5px] font-semibold leading-snug">{addon.nome}</span>
                        {addon.preco > 0
                          ? <span className="flex-shrink-0 text-[14px] font-bold text-promo">+ {brl(addon.preco)}</span>
                          : <span className="flex-shrink-0 rounded bg-promo-bg px-1.5 py-0.5 text-[11px] font-bold text-promo">Grátis</span>
                        }
                        <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2', selectedAddons.has(addon.nome) ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]' : 'border-border'].join(' ')}>
                          {selectedAddons.has(addon.nome) && <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-5">
                  <h3 className="mb-2.5 text-[15px] font-bold">Observações</h3>
                  <textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex: sem cebola, ponto da batata…" className="min-h-[60px] w-full resize-none rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[var(--tema-primaria)]" />
                </div>
              </div>
            </div>
            <div className="flex flex-shrink-0 flex-col gap-2 border-t border-border p-4.5 pb-[max(env(safe-area-inset-bottom),1.125rem)]">
              {!gruposValidos && <p className="text-center text-[11px] font-medium text-danger">Preencha todos os campos obrigatórios para continuar.</p>}
              <div className="flex items-center gap-3.5">
                <div className="flex items-center rounded border border-border">
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} className="flex h-[44px] w-[40px] items-center justify-center text-xl font-semibold text-[var(--tema-primaria)] disabled:text-border">−</button>
                  <span className="w-[34px] text-center text-[15px] font-bold">{qty}</span>
                  <button onClick={() => setQty((q) => q + 1)} className="flex h-[44px] w-[40px] items-center justify-center text-xl font-semibold text-[var(--tema-primaria)]">+</button>
                </div>
                <button
                  onClick={addToCart}
                  disabled={!gruposValidos}
                  className={['flex flex-1 items-center justify-between rounded-lg px-5 py-3.5 text-[15px] font-bold text-white transition-all', gruposValidos ? 'bg-[var(--tema-primaria)] shadow-sm hover:bg-[var(--tema-dark)] active:scale-[0.98]' : 'cursor-not-allowed bg-border'].join(' ')}
                >
                  <span>{editingLineKey ? 'Salvar alterações' : 'Adicionar'}</span>
                  <span>{brl(unitPrice * qty)}</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Checkout screen ───────────────────────────────────────────── */}
      <div className={`fixed inset-0 z-[60] overflow-y-auto bg-[#F3F4F6] transition-all duration-300 lg:flex lg:items-center lg:justify-center lg:overflow-hidden lg:bg-black/50 lg:p-6 lg:translate-x-0 ${checkoutOpen ? 'translate-x-0 lg:opacity-100' : 'translate-x-full lg:opacity-0 lg:pointer-events-none'}`}>
        <div className="mx-auto min-h-dvh max-w-[600px] bg-white pb-28 lg:min-h-0 lg:max-h-[85vh] lg:w-full lg:overflow-y-auto lg:rounded lg:pb-0 lg:shadow-2xl">
          <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-white px-3.5">
            <button onClick={checkoutBack} className="flex h-[34px] w-[34px] items-center justify-center rounded bg-[#F3F4F6] text-lg">←</button>
            <span className="text-base font-bold">{checkoutStep === 0 ? 'Resumo do pedido' : checkoutStep === 1 ? 'Pagamento' : checkoutStep === 2 ? (tipoPedido === 'retirada' ? 'Seus dados' : 'Endereço') : 'Revisar pedido'}</span>
          </div>
          <div className="flex gap-2 px-4 py-4">
            {(checkoutMinStep === 0 ? [0, 1, 2, 3] : [1, 2, 3]).map((step) => (
              <div key={step} className={`h-1 flex-1 rounded-full ${checkoutStep >= step ? 'bg-[var(--tema-primaria)]' : 'bg-border'}`} />
            ))}
          </div>

          {checkoutStep === 0 && (
            <div className="px-4 pb-5">
              {/* Itens da sacola — mesma renderização do painel lateral/aba carrinho */}
              <div className="mb-5 overflow-hidden rounded-lg border border-border bg-white">
                {cart.map((line, i) => renderCartLine(line, i < cart.length - 1))}
              </div>

              {/* Valores */}
              <div className="mb-5 rounded-lg border border-border bg-white p-4">
                <div className="flex justify-between py-1 text-[14px] text-text-subtle"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
                {desconto > 0 && (
                  <div className="flex justify-between py-1 text-[14px] font-semibold text-[#16A34A]">
                    <span>Desconto</span><span>-{brl(desconto)}</span>
                  </div>
                )}
                <div className="flex justify-between py-1 text-[14px]">
                  <span className="text-text-subtle">{rotuloLinhaFrete}</span>
                  {valorLinhaFrete}
                </div>
                <div className="mt-2 flex justify-between border-t border-border pt-3 text-[18px] font-bold"><span>Total</span><span className="text-[#16A34A]">{brl(total)}</span></div>
              </div>

              {/* Order bumps — "Peça também" */}
              {orderBumpsBlock}
            </div>
          )}

          {checkoutStep === 1 && (
            <div className="px-4 pb-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Forma de pagamento</h3>
              {[
                {
                  id: 'Pix',
                  descricao: 'Pagamento instantâneo e seguro',
                  icon: <PixIcon className="h-6 w-6" />,
                  chip: 'bg-[#E7F7F5]',
                },
                {
                  id: 'Cartão na entrega',
                  descricao: 'Crédito ou débito na maquininha',
                  icon: <CreditCard className="h-6 w-6 text-[#1D4ED8]" strokeWidth={1.8} />,
                  chip: 'bg-[#E0EAFF]',
                },
                {
                  id: 'Dinheiro',
                  descricao: 'Pague em espécie na entrega',
                  icon: <Banknote className="h-6 w-6 text-[#16A34A]" strokeWidth={1.8} />,
                  chip: 'bg-[#DCFCE7]',
                },
              ].map((opt) => (
                <button key={opt.id} onClick={() => setPayMethod(opt.id)}
                  className={['mb-3 flex w-full items-center gap-3.5 rounded-lg border-2 p-4 text-left transition-all active:scale-[0.99]', payMethod === opt.id ? 'border-[var(--tema-primaria)] bg-[var(--tema-light)] shadow-sm' : 'border-border bg-white hover:border-text-subtle/40'].join(' ')}>
                  <span className={['flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg', opt.chip].join(' ')}>{opt.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-text-main">{opt.id}</span>
                    <span className="mt-0.5 block text-[12px] text-text-subtle">{opt.descricao}</span>
                  </span>
                  <span className={['flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border-2', payMethod === opt.id ? 'border-[var(--tema-primaria)] bg-[var(--tema-primaria)]' : 'border-border'].join(' ')}>
                    {payMethod === opt.id && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                </button>
              ))}
              {payMethod === 'Dinheiro' && (
                <div className="mt-1 rounded-lg border border-border bg-white p-4">
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-main">Troco para quanto?</label>
                  <p className="mb-2 text-[12px] text-text-subtle">Deixe em branco se não precisar de troco.</p>
                  <input value={changeFor} onChange={(e) => setChangeFor(e.target.value)} placeholder="Ex: 50,00" inputMode="decimal"
                    className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]" />
                </div>
              )}

              {/* Cupom ou prêmio de fidelidade */}
              <div className="mt-5 rounded-lg border border-border bg-white p-4">
                <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-text-subtle">Cupom ou prêmio</h3>
                {recompensaSelecionada || cupomAplicado ? (
                  <div className="flex items-center gap-2.5 rounded border border-[#16A34A]/40 bg-[#DCFCE7] px-3 py-2.5">
                    <Gift className="h-5 w-5 flex-shrink-0 text-[#16A34A]" strokeWidth={2} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-bold text-[#15803D]">
                        {recompensaSelecionada
                          ? `Prêmio: ${premioLabelCampanha({ premioTipo: recompensaSelecionada.premioTipo, premioValor: recompensaSelecionada.premioValor }, recompensaSelecionada.premioItemNome)}`
                          : `Cupom ${cupomAplicado?.codigo}`}
                      </div>
                      <div className="truncate text-[12px] text-[#15803D]/80">
                        {beneficio?.tipo === 'item_gratis'
                          ? `Item grátis: ${beneficio.itemNome ?? 'prêmio'}`
                          : beneficio?.tipo === 'entrega_gratis'
                            ? 'Entrega grátis neste pedido'
                            : `-${brl(desconto)} no pedido`}
                        {!recompensaSelecionada && cupomAplicado?.descricao ? ` · ${cupomAplicado.descricao}` : ''}
                      </div>
                    </div>
                    <button onClick={removerBeneficio} aria-label="Remover cupom ou prêmio" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white text-[13px] text-text-subtle shadow-sm transition-colors hover:text-danger">✕</button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <input
                        value={cupomCodigoInput}
                        onChange={(e) => { setCupomCodigoInput(e.target.value.toUpperCase()); setCupomErro(null) }}
                        placeholder="Código do cupom"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        className="w-full rounded-md border border-border p-3 font-sans text-[14px] font-bold uppercase tracking-widest outline-none placeholder:font-normal placeholder:normal-case placeholder:tracking-normal focus:border-[var(--tema-primaria)]"
                      />
                      <button
                        onClick={() => validarCupomCheckout()}
                        disabled={cupomValidando || !cupomCodigoInput.trim()}
                        className="flex-shrink-0 rounded-md bg-[var(--tema-primaria)] px-4 text-[12px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-[var(--tema-dark)] disabled:opacity-50"
                      >
                        {cupomValidando ? 'Validando…' : 'Aplicar'}
                      </button>
                    </div>
                    {cupomErro && (
                      <div className="mt-2 rounded border border-danger/30 bg-danger-bg px-2.5 py-2 text-[12px] font-medium text-danger">
                        {cupomErro}
                        {cupomErro === MOTIVO_LOGIN_CUPOM && (
                          <button
                            onClick={() => setContaOpen(true)}
                            className="mt-1.5 block w-full rounded bg-[var(--tema-primaria)] px-3 py-2 text-center text-[12px] font-bold text-white transition-colors hover:bg-[var(--tema-dark)]"
                          >
                            Entrar com meu telefone
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Resumo compacto pra ancorar a decisão */}
              <div className="mt-5 rounded-lg border border-border bg-white px-4 py-3.5">
                {desconto > 0 && (
                  <div className="mb-1.5 flex items-center justify-between text-[13px] font-semibold text-[#16A34A]">
                    <span>Desconto</span><span>-{brl(desconto)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-text-subtle">Total do pedido</span>
                  <span className="text-[16px] font-bold text-[#16A34A]">{brl(total)}</span>
                </div>
              </div>
            </div>
          )}

          {checkoutStep === 2 && (
            <div className="px-4 pb-5">
              <div className="rounded-lg border border-border bg-white p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Seus dados</h3>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex-1">
                    <label className="mb-1.5 block text-[13px] font-semibold text-text-main">Nome *</label>
                    <input value={cliente.nome} onChange={(e) => setCliente((c) => ({ ...c, nome: e.target.value }))} placeholder="Seu nome"
                      className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]" />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1.5 block text-[13px] font-semibold text-text-main">Telefone</label>
                    <input value={cliente.telefone} onChange={(e) => setCliente((c) => ({ ...c, telefone: mascararTelefoneBR(e.target.value) }))} placeholder="(00) 00000-0000" inputMode="tel" autoComplete="tel" maxLength={16}
                      className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]" />
                  </div>
                </div>
              </div>

              {/* Retirada não tem endereço de entrega: no lugar do formulário,
                  o cliente precisa saber ONDE buscar. */}
              {tipoPedido === 'retirada' && (
                <div className="mt-4 rounded-lg border border-border bg-white p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Retirada no local</h3>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6]">
                      <MapPin className="h-5 w-5 text-text-subtle" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0 text-[14px] leading-relaxed">
                      <div className="font-semibold text-text-main">{restaurante?.nome}</div>
                      <div className="text-text-subtle">
                        {restaurante?.endereco?.trim() || 'Confirme o endereço com a loja.'}
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 rounded border border-border bg-page/60 px-3 py-2.5 text-[12px] text-text-subtle">
                    Avisaremos quando o pedido estiver pronto para retirada. Não há taxa de entrega.
                  </p>
                </div>
              )}

              {/* Endereço salvo (último pedido/perfil): resumo com opção de trocar */}
              {tipoPedido === 'entrega' && (
              enderecoSalvoOrigem && !mostrarFormEndereco && endereco.rua && endereco.numero && endereco.bairro ? (
                <div className="mt-4 rounded-lg border border-border bg-white p-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Endereço de entrega</h3>
                  <div className="rounded-md border border-border bg-page/60 p-3">
                    <p className="text-[15px] font-semibold text-text-main">
                      {endereco.rua}, {endereco.numero}
                      {endereco.complemento ? ` · ${endereco.complemento}` : ''}
                    </p>
                    <p className="mt-0.5 text-[13px] text-text-subtle">
                      {endereco.bairro}
                      {endereco.cep ? ` · CEP ${endereco.cep}` : ''}
                    </p>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setMostrarFormEndereco(true)}
                      className="flex-1 rounded-md border border-border px-3 py-2.5 text-[13px] font-semibold text-text-main transition-colors hover:bg-page"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => {
                        setEndereco(comCidadePadrao(ENDERECO_VAZIO))
                        setCepSemBairro(false)
                        setMostrarFormEndereco(true)
                      }}
                      className="flex-1 rounded-md border border-[var(--tema-primaria)] px-3 py-2.5 text-[13px] font-semibold text-[var(--tema-primaria)] transition-colors hover:bg-[var(--tema-primaria)]/5"
                    >
                      Trocar endereço
                    </button>
                  </div>
                </div>
              ) : (
              <div className="mt-4 rounded-lg border border-border bg-white p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Endereço de entrega</h3>
                {/* CEP primeiro: ao preencher, busca rua/bairro/cidade sozinho */}
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-main">CEP</label>
                  <input
                    value={endereco.cep}
                    onChange={(e) => { const v = e.target.value; setEndereco((a) => ({ ...a, cep: v })); setCepSemBairro(false); autofillCep(v) }}
                    placeholder="00000-000"
                    inputMode="numeric"
                    className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]" />
                  <p className="mt-1.5 text-[12px] text-text-subtle">{cepBuscando ? 'Buscando endereço…' : 'Informe o CEP que preenchemos rua e bairro pra você.'}</p>
                </div>
                {/* Bairro logo abaixo do CEP: é o que decide o frete/área de entrega */}
                <div className="mt-3">
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-main">Bairro *</label>
                  {bairros.length > 0 ? (
                    <BairroAutocomplete
                      value={endereco.bairro}
                      onChange={(v) => { setEndereco((a) => ({ ...a, bairro: v })); setCepSemBairro(false) }}
                      opcoes={bairros.map((b) => b.bairro)}
                      estrito={listaFechada}
                    />
                  ) : (
                    <input value={endereco.bairro} onChange={(e) => setEndereco((a) => ({ ...a, bairro: e.target.value }))} placeholder="Bairro"
                      className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]" />
                  )}
                  {cepSemBairro && endereco.bairro.trim() === '' && (
                    <p className="mt-1.5 text-[12px] font-medium text-warn">
                      O bairro do seu CEP não está na lista da loja — toque na setinha acima e escolha o bairro mais próximo.
                    </p>
                  )}
                </div>
                <div className="mt-3 flex gap-3">
                  <div className="flex-[2]">
                    <label className="mb-1.5 block text-[13px] font-semibold text-text-main">Rua *</label>
                    <input value={endereco.rua} onChange={(e) => setEndereco((a) => ({ ...a, rua: e.target.value }))} placeholder="Nome da rua"
                      className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]" />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1.5 block text-[13px] font-semibold text-text-main">Número *</label>
                    <input value={endereco.numero} onChange={(e) => setEndereco((a) => ({ ...a, numero: e.target.value }))} placeholder="123" inputMode="numeric"
                      className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]" />
                  </div>
                </div>
                <div className="mt-3 flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1.5 block text-[13px] font-semibold text-text-main">Complemento</label>
                    <input value={endereco.complemento} onChange={(e) => setEndereco((a) => ({ ...a, complemento: e.target.value }))} placeholder="Apto, bloco"
                      className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]" />
                  </div>
                  {/* Cidade: já vem com a da loja, mas fica editável pra quem
                      mora na cidade vizinha. Ela é o que impede o cálculo de
                      distância de cair numa rua homônima de outro município. */}
                  <div className="flex-1">
                    <label className="mb-1.5 block text-[13px] font-semibold text-text-main">Cidade</label>
                    <input value={endereco.cidade} onChange={(e) => setEndereco((a) => ({ ...a, cidade: e.target.value }))} placeholder="Cidade"
                      className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-main">Ponto de referência</label>
                  <input value={endereco.referencia} onChange={(e) => setEndereco((a) => ({ ...a, referencia: e.target.value }))} placeholder="Ex: ao lado da padaria, portão azul"
                    className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]" />
                  <p className="mt-1.5 text-[12px] text-text-subtle">Opcional — ajuda quem vai entregar a achar você mais rápido.</p>
                </div>
              </div>
              ))}
              {/* Status do frete calculado */}
              {tipoPedido === 'entrega' && (endereco.bairro.trim() || endereco.cep.replace(/\D/g, '').length === 8) && (
                freteStatus === 'calculando' ? (
                  <div className="mt-3 rounded border border-border bg-page/60 px-3 py-2.5 text-[13px] text-text-subtle">Calculando a taxa de entrega…</div>
                ) : freteStatus === 'erro' ? (
                  <div className="mt-3 rounded border border-warn bg-warn-bg px-3 py-3">
                    <p className="text-[13px] font-semibold text-text-main">Não conseguimos calcular a taxa agora.</p>
                    <p className="mt-1 text-[12px] text-text-subtle">Você pode seguir com o pedido — a loja confirma o valor da entrega com você.</p>
                  </div>
                ) : entregavel ? (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded border border-price-bg bg-price-bg/40 px-3 py-2.5 text-[13px]">
                    <span className="font-medium text-text-main">
                      Frete{freteCalc?.fonte === 'raio' && freteCalc.distanciaKm != null ? ` · ~${freteCalc.distanciaKm} km` : ''}
                    </span>
                    <span className="font-bold text-price-text">{fee === 0 ? 'Grátis' : brl(fee)}</span>
                  </div>
                ) : (
                  <div className="mt-3 rounded border border-danger bg-danger/10 px-3 py-3">
                    <p className="text-[13px] font-semibold text-danger">{freteCalc?.motivo || 'A loja não entrega neste endereço.'}</p>
                    <p className="mt-1 text-[12px] text-text-subtle">Entre em contato com a loja para combinar a entrega.</p>
                    {restaurante?.telefone?.trim() && (
                      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-main">
                          <Phone className="h-4 w-4 flex-shrink-0" strokeWidth={2} />
                          {restaurante.telefone}
                        </span>
                        {numeroWaLoja() && (
                          <a
                            href={`https://wa.me/${numeroWaLoja()}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center gap-1.5 rounded bg-[#16A34A] px-3 py-2 text-[12px] font-bold text-white transition-colors hover:bg-[#15803D]"
                          >
                            Falar com a loja no WhatsApp
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          )}

          {checkoutStep === 3 && (
            <div className="px-4 pb-5">
              {/* Itens do pedido — com foto e detalhes, fáceis de conferir */}
              <div className="rounded-lg border border-border bg-white p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Seu pedido</h3>
                {cart.map((l, i) => (
                  <div key={l.key} className={['flex items-start gap-3 py-3', i < cart.length - 1 ? 'border-b border-border' : 'pb-1'].join(' ')}>
                    <div className="h-[48px] w-[48px] flex-shrink-0 overflow-hidden rounded-md">
                      <ProductThumb item={{ nome: l.name, imagemUrl: l.imagemUrl }} size={48} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold leading-snug">
                        {l.qty}× {l.name}
                        {(l.tamanhoNome || l.saborNome) && <span className="font-normal text-text-subtle"> · {[l.tamanhoNome, l.saborNome].filter(Boolean).join(' - ')}</span>}
                      </div>
                      {l.addons.length > 0 && (
                        <div className="mt-0.5 text-[13px] leading-snug text-text-subtle">
                          {(() => {
                            const contagem = new Map<string, number>()
                            for (const a of l.addons) contagem.set(a.nome, (contagem.get(a.nome) ?? 0) + 1)
                            return [...contagem].map(([nome, qtd]) => (qtd > 1 ? `${qtd}x ${nome}` : nome)).join(', ')
                          })()}
                        </div>
                      )}
                      {l.obs && <div className="mt-0.5 text-[13px] italic text-text-subtle">&ldquo;{l.obs}&rdquo;</div>}
                    </div>
                    <span className="flex-shrink-0 text-[15px] font-bold">{brl(l.unit * l.qty)}</span>
                  </div>
                ))}
              </div>

              {/* Valores */}
              <div className="mt-4 rounded-lg border border-border bg-white p-4">
                <div className="flex justify-between py-1 text-[14px] text-text-subtle"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
                {desconto > 0 && (
                  <div className="flex justify-between py-1 text-[14px] font-semibold text-[#16A34A]">
                    <span>Desconto{cupomAplicado ? ` (${cupomAplicado.codigo})` : ' (prêmio)'}</span><span>-{brl(desconto)}</span>
                  </div>
                )}
                {beneficio?.tipo === 'item_gratis' && (
                  <div className="flex justify-between py-1 text-[14px] font-semibold text-[#16A34A]">
                    <span>Item grátis</span><span className="truncate pl-3">{beneficio.itemNome ?? 'prêmio'}</span>
                  </div>
                )}
                <div className="flex justify-between py-1 text-[14px]">
                  <span className="text-text-subtle">{rotuloLinhaFrete}</span>
                  {valorLinhaFrete}
                </div>
                <div className="mt-2 flex justify-between border-t border-border pt-3 text-[18px] font-bold"><span>Total</span><span className="text-[#16A34A]">{brl(total)}</span></div>
              </div>

              {/* Entrega & pagamento */}
              <div className="mt-4 rounded-lg border border-border bg-white p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">
                  {tipoPedido === 'retirada' ? 'Retirada' : 'Entrega'} &amp; pagamento
                </h3>
                <div className="flex items-center gap-3.5 pb-3.5">
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6]"><MapPin className="h-[22px] w-[22px] text-text-subtle" strokeWidth={1.8} /></span>
                  {tipoPedido === 'retirada' ? (
                    <div className="min-w-0 text-[14px] leading-relaxed">
                      <div className="font-semibold">Retirar em {restaurante?.nome}</div>
                      <div className="text-text-subtle">{restaurante?.endereco?.trim() || 'Combine o local com a loja'}</div>
                    </div>
                  ) : (
                    <div className="min-w-0 text-[14px] leading-relaxed">
                      <div className="font-semibold">{endereco.rua}, {endereco.numero}{endereco.complemento && ` · ${endereco.complemento}`}</div>
                      <div className="text-text-subtle">{endereco.bairro || 'Entrega'} · ~30–45 min</div>
                      {endereco.referencia.trim() && <div className="text-text-subtle">Ref.: {endereco.referencia}</div>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3.5 border-t border-border pt-3.5">
                  <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6]">
                    {payMethod === 'Pix' ? <PixIcon className="h-[22px] w-[22px]" /> : payMethod === 'Dinheiro' ? <Banknote className="h-[22px] w-[22px] text-[#16A34A]" strokeWidth={1.8} /> : <CreditCard className="h-[22px] w-[22px] text-[#1D4ED8]" strokeWidth={1.8} />}
                  </span>
                  <div className="text-[14px]">
                    <div className="font-semibold">{payMethod}</div>
                    {payMethod === 'Dinheiro' && changeFor && <div className="text-text-subtle">Troco para R$ {changeFor}</div>}
                    {payMethod === 'Dinheiro' && !changeFor && <div className="text-text-subtle">Sem troco</div>}
                    {payMethod === 'Pix' && <div className="text-text-subtle">Pagamento instantâneo</div>}
                    {payMethod === 'Cartão na entrega' && <div className="text-text-subtle">Na maquininha, na entrega</div>}
                  </div>
                </div>
              </div>

              <p className="mt-4 text-center text-[13px] text-text-subtle">Confira os dados acima antes de confirmar o pedido. 😉</p>
            </div>
          )}

          <div className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-[600px] border-t border-border bg-white p-4 pb-[max(env(safe-area-inset-bottom),1rem)] lg:sticky lg:mx-0 lg:max-w-none lg:pb-4">
            {checkoutError && <div className="mb-2.5 rounded border border-danger bg-danger-bg px-3 py-2 text-[13px] font-medium text-danger">{checkoutError}</div>}
            <button onClick={checkoutNext} disabled={submitting}
              className={['flex w-full items-center justify-between rounded-lg px-5 py-4 text-[15px] font-bold text-white shadow-sm transition-all disabled:opacity-60 active:scale-[0.98]', checkoutStep === 3 ? 'bg-[#16A34A] hover:bg-[#15803D]' : 'bg-[var(--tema-primaria)] hover:bg-[var(--tema-dark)]'].join(' ')}>
              <span>{submitting ? 'Enviando…' : checkoutStep === 0 ? 'Ir para pagamento' : checkoutStep === 1 ? (tipoPedido === 'retirada' ? 'Continuar' : 'Ir para endereço') : checkoutStep === 2 ? 'Revisar pedido' : 'Fazer pedido'}</span>
              {(checkoutStep === 0 || checkoutStep === 3) && !submitting && <span>{brl(total)}</span>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Frete calculator overlay ──────────────────────────────────── */}
      {freteOpen && <div className="fixed inset-0 z-[64] bg-[#111827]/60" onClick={() => setFreteOpen(false)} />}
      {/* Modal centralizado também no celular: como sheet embaixo, o teclado
          subia junto do CEP e cobria o resultado do cálculo. */}
      <div className={['fixed left-1/2 top-1/2 z-[65] flex max-h-[86dvh] w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md bg-white shadow-2xl transition-all duration-200', freteOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'].join(' ')}>
        {freteOpen && (
          <>
            <div className="flex items-center justify-between border-b border-border p-4.5">
              <h2 className="text-base font-bold">Calcular frete</h2>
              <button onClick={() => setFreteOpen(false)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#F3F4F6] text-xl font-light">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4.5 pb-[max(env(safe-area-inset-bottom),1.125rem)]">
              <label className="mb-1.5 block text-xs font-semibold text-text-subtle">CEP</label>
              <div className="flex gap-2">
                <input
                  value={freteCep}
                  onChange={(e) => setFreteCep(e.target.value)}
                  placeholder="00000-000"
                  inputMode="numeric"
                  className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[var(--tema-primaria)]"
                />
                <button onClick={calcularFrete} disabled={freteLoading} className="flex-shrink-0 rounded bg-[var(--tema-primaria)] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[var(--tema-dark)] disabled:opacity-60">
                  {freteLoading ? '...' : 'Calcular'}
                </button>
              </div>
              {freteError && <p className="mt-2.5 text-[13px] font-medium text-danger">{freteError}</p>}
              {freteResult && (
                <div className="mt-4 rounded border border-border p-3.5">
                  <p className="text-sm font-semibold">{freteResult.rua || 'Endereço encontrado'}</p>
                  <p className="text-[13px] text-text-subtle">{freteResult.bairro}{freteResult.bairro && freteResult.cidade ? ' · ' : ''}{freteResult.cidade}</p>
                  <div className="mt-2.5 flex items-center justify-between rounded bg-[#DCFCE7] px-3 py-2">
                    <span className="text-[13px] font-semibold text-[#16A34A]">Taxa de entrega</span>
                    <span className="text-sm font-bold text-[#16A34A]">{ganhouFreteGratis ? 'Grátis' : brl(freteResult.taxa)}</span>
                  </div>
                  {freteGratisAtivo && !ganhouFreteGratis && (
                    <p className="mt-2 text-[12px] font-medium text-[#16A34A]">Pedidos acima de {brl(freteGratisMinimo ?? 0)} têm entrega grátis.</p>
                  )}
                  <button onClick={usarEnderecoDoFrete} className="mt-3 w-full rounded bg-[var(--tema-primaria)] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--tema-dark)]">
                    Usar este endereço no pedido
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Conta do cliente overlay ──────────────────────────────────── */}
      {contaOpen && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-[#111827]/60 p-4" onClick={() => setContaOpen(false)}>
          <div className="flex max-h-[88dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-md bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border p-4.5">
              <h2 className="text-base font-bold">Minha conta</h2>
              <button onClick={() => setContaOpen(false)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#F3F4F6] text-xl font-light">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4.5 pb-[max(env(safe-area-inset-bottom),1.125rem)]">
              {!perfilCliente ? (
                contaStep === 'telefone' ? (
                  <div className="py-1 text-center">
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--tema-light)]">
                      <Phone className="h-6 w-6 text-[var(--tema-primaria)]" strokeWidth={2} />
                    </div>
                    <h3 className="text-[17px] font-bold tracking-tight">Informe seu telefone</h3>
                    <p className="mx-auto mt-1 max-w-[300px] text-[13px] leading-relaxed text-text-subtle">
                      É com ele que a loja te reconhece: seus pedidos, endereço e cupons ficam salvos pra próxima vez.
                    </p>
                    <input
                      value={contaTelefone}
                      onChange={(e) => setContaTelefone(mascararTelefoneBR(e.target.value))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && telefoneCompleto(contaTelefone) && !contaLoading) void enviarCodigoConta() }}
                      placeholder="(00) 00000-0000"
                      inputMode="tel"
                      autoComplete="tel"
                      autoFocus
                      maxLength={16}
                      className="mt-4 w-full rounded border-2 border-border p-3 text-center font-sans text-[17px] font-bold tracking-wide outline-none focus:border-[var(--tema-primaria)]"
                    />
                    {contaError && <p className="mt-2.5 text-[13px] font-medium text-danger">{contaError}</p>}
                    <button onClick={enviarCodigoConta} disabled={contaLoading || !telefoneCompleto(contaTelefone)}
                      className="mt-4 w-full rounded bg-[var(--tema-primaria)] px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-[var(--tema-dark)] disabled:opacity-60">
                      {contaLoading ? 'Enviando…' : 'Continuar'}
                    </button>
                    <p className="mt-3 text-[12px] leading-relaxed text-text-subtle">
                      Enviamos um código pelo WhatsApp só pra confirmar que o número é seu.
                    </p>
                  </div>
                ) : (
                  <div className="py-1 text-center">
                    <h3 className="text-[17px] font-bold tracking-tight">Confirme o código</h3>
                    <p className="mx-auto mt-1 max-w-[300px] text-[13px] leading-relaxed text-text-subtle">
                      Enviamos 6 dígitos pelo WhatsApp para <span className="font-semibold text-text-main">{contaTelefone}</span>.
                    </p>
                    <input value={contaCodigo} onChange={(e) => setContaCodigo(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && contaCodigo.length === 6 && !contaLoading) void confirmarCodigoConta() }}
                      placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
                      className="mt-4 w-full rounded border-2 border-border p-3 text-center font-sans text-xl font-bold tracking-[0.5em] outline-none focus:border-[var(--tema-primaria)]" />
                    {contaError && <p className="mt-2.5 text-[13px] font-medium text-danger">{contaError}</p>}
                    <button onClick={confirmarCodigoConta} disabled={contaLoading || contaCodigo.length < 6}
                      className="mt-4 w-full rounded bg-[var(--tema-primaria)] px-4 py-3.5 text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-[var(--tema-dark)] disabled:opacity-60">
                      {contaLoading ? 'Confirmando…' : 'Confirmar código'}
                    </button>
                    <button onClick={() => { setContaStep('telefone'); setContaCodigo(''); setContaError(null) }} className="mt-3 w-full text-center text-[13px] font-semibold text-[var(--tema-primaria)]">
                      Trocar número / reenviar código
                    </button>
                  </div>
                )
              ) : contaEditando ? (
                <>
                  <div className="mb-4 flex items-center justify-between rounded border border-border p-3.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Telefone confirmado</p>
                      <p className="text-sm font-bold">{perfilCliente.telefone}</p>
                    </div>
                    <button onClick={sairConta} className="text-[13px] font-semibold text-danger">Sair</button>
                  </div>

                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Nome</label>
                  <input value={contaNome} onChange={(e) => setContaNome(e.target.value)} placeholder="Seu nome"
                    className="mb-3 w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[var(--tema-primaria)]" />

                  <h3 className="mb-2.5 mt-4 text-xs font-semibold uppercase tracking-wide text-text-subtle">Endereço salvo</h3>
                  {/* CEP primeiro: ao preencher, busca rua/bairro sozinho */}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-text-subtle">CEP</label>
                    <input
                      value={contaEndereco.cep}
                      onChange={(e) => { const v = e.target.value; setContaEndereco((a) => ({ ...a, cep: v })); setCepSemBairro(false); autofillCep(v, 'conta') }}
                      placeholder="00000-000"
                      inputMode="numeric"
                      className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[var(--tema-primaria)]" />
                    <p className="mt-1.5 text-[12px] text-text-subtle">{cepBuscando ? 'Buscando endereço…' : 'Informe o CEP que preenchemos rua e bairro pra você.'}</p>
                  </div>
                  <div className="mt-3 flex gap-3">
                    <div className="flex-[2]">
                      <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Rua</label>
                      <input value={contaEndereco.rua} onChange={(e) => setContaEndereco((a) => ({ ...a, rua: e.target.value }))} placeholder="Nome da rua"
                        className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[var(--tema-primaria)]" />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Número</label>
                      <input value={contaEndereco.numero} onChange={(e) => setContaEndereco((a) => ({ ...a, numero: e.target.value }))} placeholder="123"
                        className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[var(--tema-primaria)]" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Bairro</label>
                    {bairros.length > 0 ? (
                      <BairroAutocomplete
                        value={contaEndereco.bairro}
                        onChange={(v) => setContaEndereco((a) => ({ ...a, bairro: v }))}
                        opcoes={bairros.map((b) => b.bairro)}
                        estrito={listaFechada}
                        compacto
                      />
                    ) : (
                      <input value={contaEndereco.bairro} onChange={(e) => setContaEndereco((a) => ({ ...a, bairro: e.target.value }))} placeholder="Bairro"
                        className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[var(--tema-primaria)]" />
                    )}
                  </div>
                  <div className="mt-3 flex gap-3">
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Complemento</label>
                      <input value={contaEndereco.complemento} onChange={(e) => setContaEndereco((a) => ({ ...a, complemento: e.target.value }))} placeholder="Apto, bloco"
                        className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[var(--tema-primaria)]" />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Cidade</label>
                      <input value={contaEndereco.cidade} onChange={(e) => setContaEndereco((a) => ({ ...a, cidade: e.target.value }))} placeholder="Cidade"
                        className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[var(--tema-primaria)]" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Ponto de referência</label>
                    <input value={contaEndereco.referencia} onChange={(e) => setContaEndereco((a) => ({ ...a, referencia: e.target.value }))} placeholder="Ex: ao lado da padaria"
                      className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[var(--tema-primaria)]" />
                  </div>

                  {contaError && <p className="mt-2.5 text-[13px] font-medium text-danger">{contaError}</p>}
                  <button onClick={salvarPerfilConta} disabled={contaLoading}
                    className="mt-4 w-full rounded bg-[var(--tema-primaria)] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--tema-dark)] disabled:opacity-60">
                    {contaLoading ? 'Salvando…' : 'Salvar'}
                  </button>
                  {(perfilCliente.nome || perfilCliente.endereco.rua) && (
                    <button onClick={cancelarEdicaoConta} className="mt-2.5 w-full text-center text-[13px] font-semibold text-text-subtle">
                      Cancelar
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="mb-4 flex items-center justify-between rounded border border-border p-3.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Telefone confirmado</p>
                      <p className="text-sm font-bold">{perfilCliente.telefone}</p>
                    </div>
                    <button onClick={sairConta} className="text-[13px] font-semibold text-danger">Sair</button>
                  </div>

                  {contaSaved && <p className="mb-3 text-[13px] font-medium text-[#16A34A]">Dados salvos!</p>}

                  <div className="overflow-hidden rounded border border-border">
                    <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome</span>
                      <span className="text-sm font-semibold">{perfilCliente.nome || '—'}</span>
                    </div>
                    <div className="px-3.5 py-2.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Endereço</span>
                      <p className="mt-1 text-sm">
                        {perfilCliente.endereco.rua
                          ? `${perfilCliente.endereco.rua}, ${perfilCliente.endereco.numero}${perfilCliente.endereco.complemento ? ` · ${perfilCliente.endereco.complemento}` : ''}`
                          : '—'}
                      </p>
                      {(perfilCliente.endereco.bairro || perfilCliente.endereco.cep) && (
                        <p className="mt-0.5 text-[13px] text-text-subtle">
                          {perfilCliente.endereco.bairro}{perfilCliente.endereco.bairro && perfilCliente.endereco.cep ? ' · ' : ''}{perfilCliente.endereco.cep}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2.5">
                    <button
                      onClick={() => setContaOpen(false)}
                      className="flex-1 rounded bg-[var(--tema-primaria)] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--tema-dark)]"
                    >
                      Usar estes dados
                    </button>
                    <button
                      onClick={() => { setContaSaved(false); setContaEditando(true) }}
                      className="flex-1 rounded bg-[#F3F4F6] px-4 py-3 text-sm font-bold text-text-main transition-colors hover:bg-border"
                    >
                      Editar dados
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Informações da empresa (modal centralizado) ─────────────────── */}
      {infoOpen && (
        <>
          <div className="fixed inset-0 z-[64] bg-[#111827]/60" onClick={() => setInfoOpen(false)} />
          <div className="fixed inset-0 z-[65] flex items-center justify-center p-4">
            <div className="max-h-[85vh] w-full max-w-[420px] overflow-y-auto rounded-md bg-white">
              <div className="flex items-center justify-between border-b border-border p-4.5">
                <h2 className="text-base font-bold">Sobre {storeName}</h2>
                <button onClick={() => setInfoOpen(false)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#F3F4F6] text-xl font-light">×</button>
              </div>
              <div className="p-4.5">
                {/* Resumo em cartões: quem abre isso quer decidir "dá pra pedir
                    daqui?" — status, tempo e taxa vêm antes da lista de bairros. */}
                <div className="mb-4 grid grid-cols-2 gap-2">
                  <div className={['rounded-md border p-3', restaurante.lojaAberta ? 'border-promo/30 bg-promo-bg' : 'border-danger/30 bg-danger-bg'].join(' ')}>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-text-subtle">Agora</div>
                    <div className={['mt-0.5 text-[14px] font-bold', restaurante.lojaAberta ? 'text-promo' : 'text-[#B91C1C]'].join(' ')}>
                      {restaurante.lojaAberta ? 'Aberta' : 'Fechada'}
                    </div>
                    {horarioTexto && <div className="mt-0.5 text-[11.5px] font-medium text-text-subtle">{horarioTexto}</div>}
                  </div>
                  <div className="rounded-md border border-petrol/20 bg-petrol-bg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-text-subtle">Entrega em</div>
                    <div className="mt-0.5 text-[14px] font-bold text-petrol">30–45 min</div>
                    <div className="mt-0.5 text-[11.5px] font-medium text-text-subtle">
                      {restaurante.taxaEntregaPadrao > 0 ? `Taxa a partir de ${brl(menorTaxaEntrega)}` : 'Taxa a combinar'}
                    </div>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap gap-1.5">
                  {restaurante.aceitaEntrega && (
                    <span className="inline-flex items-center gap-1.5 rounded bg-[var(--tema-light)] px-2.5 py-1 text-[12px] font-semibold text-[var(--tema-primaria)]">
                      <Truck className="h-3.5 w-3.5" strokeWidth={2.5} /> Entrega
                    </span>
                  )}
                  {restaurante.aceitaRetirada && (
                    <span className="inline-flex items-center gap-1.5 rounded bg-[var(--tema-light)] px-2.5 py-1 text-[12px] font-semibold text-[var(--tema-primaria)]">
                      <MapPin className="h-3.5 w-3.5" strokeWidth={2.5} /> Retirada no balcão
                    </span>
                  )}
                  {freteGratisMinimo !== null && (
                    <span className="inline-flex items-center gap-1.5 rounded bg-promo-bg px-2.5 py-1 text-[12px] font-semibold text-promo">
                      Frete grátis acima de {brl(freteGratisMinimo)}
                    </span>
                  )}
                </div>

                {restaurante.endereco && (
                  <div className="mb-4 rounded-md border border-border p-3.5">
                    <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-text-subtle">Onde ficamos</h3>
                    <p className="text-[13.5px] font-semibold leading-snug text-text-main">{capitalizarTexto(restaurante.endereco)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurante.endereco)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-[var(--tema-primaria)]"
                      >
                        <MapPin className="h-3.5 w-3.5" strokeWidth={2.5} /> Ver no mapa
                      </a>
                      {restaurante.telefone && (
                        <a href={`tel:${restaurante.telefone.replace(/\D/g, '')}`} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-subtle">
                          <Phone className="h-3.5 w-3.5" strokeWidth={2.5} /> {mascararTelefoneBR(restaurante.telefone)}
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <h3 className="text-[10px] font-bold uppercase tracking-wide text-text-subtle">Taxa por bairro</h3>
                    {bairros.length > 6 && <span className="text-[11px] text-text-subtle">{bairros.length} bairros</span>}
                  </div>
                  {bairros.length > 0 ? (
                    <div className="max-h-[38vh] overflow-y-auto overscroll-contain rounded-md border border-border">
                      {bairros.map((b) => (
                        <div key={b.bairro} className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5 text-[13.5px] last:border-none">
                          <span className="min-w-0 truncate font-medium">{capitalizarTexto(b.bairro)}</span>
                          <span className={['flex-shrink-0 font-bold', b.taxa === 0 ? 'text-promo' : 'text-text-main'].join(' ')}>{b.taxa === 0 ? 'Grátis' : brl(b.taxa)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-3 border-t border-border bg-[#F9FAFB] px-3.5 py-2.5 text-[13.5px]">
                        <span className="text-text-subtle">Demais bairros</span>
                        <span className="font-bold">{brl(restaurante.taxaEntregaPadrao)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-md border border-border px-3.5 py-2.5 text-[13.5px] text-text-subtle">
                      Taxa única de entrega: <span className="font-bold text-text-main">{brl(restaurante.taxaEntregaPadrao)}</span>
                    </p>
                  )}
                  <button
                    onClick={() => { setInfoOpen(false); setFreteOpen(true) }}
                    className="mt-3 w-full rounded-md bg-[var(--tema-primaria)] px-4 py-3 text-[12px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-[var(--tema-dark)]"
                  >
                    Calcular taxa pelo meu CEP
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Prêmio de boas-vindas: o que o cliente já tem antes de comprar ── */}
      {premioModal && (
        <>
          <div className="fixed inset-0 z-[85] bg-[#111827]/70" onClick={fecharPremioModal} />
          <div className="fixed left-1/2 top-1/2 z-[86] w-[calc(100%-2.5rem)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="relative bg-gradient-to-br from-[var(--tema-primaria)] to-[var(--tema-dark)] px-5 pb-8 pt-7 text-center">
              <button
                onClick={fecharPremioModal}
                aria-label="Fechar"
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-lg font-light text-white"
              >
                ×
              </button>
              <span className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-[34px] leading-none">🎁</span>
              <h2 className="text-[19px] font-extrabold leading-tight text-white">{premioModal.titulo}</h2>
              <p className="mx-auto mt-1 max-w-[240px] text-[13px] leading-relaxed text-white/85">
                {premioModal.origem === 'fidelidade'
                  ? 'Você conquistou este prêmio nesta loja.'
                  : 'A loja liberou este cupom pra você usar hoje.'}
              </p>
            </div>

            <div className="-mt-4 rounded-t-lg bg-white px-5 pb-5 pt-5 text-center">
              <p className="text-[17px] font-extrabold leading-snug text-promo">{premioModal.descricao}</p>
              {premioModal.codigo && (
                <div className="mt-3 rounded-md border border-dashed border-[var(--tema-primaria)] bg-[var(--tema-light)] px-3 py-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-text-subtle">Código</div>
                  <div className="text-[17px] font-extrabold tracking-[0.18em] text-[var(--tema-primaria)]">{premioModal.codigo}</div>
                </div>
              )}
              <button
                onClick={() => { fecharPremioModal(); setTab('cupons') }}
                className="mt-4 w-full rounded-md bg-[var(--tema-primaria)] px-4 py-3.5 text-[13px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-[var(--tema-dark)] active:scale-[0.99]"
              >
                Ver meus prêmios
              </button>
              <button
                onClick={fecharPremioModal}
                className="mt-2 w-full py-2 text-[12.5px] font-semibold text-text-subtle"
              >
                Continuar no cardápio
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Toast container ───────────────────────────────────────────── */}
      <div className="pointer-events-none fixed right-3 top-3 z-[95] flex w-[min(260px,calc(100%-5rem))] flex-col items-end gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex w-full items-center gap-2 rounded-md bg-[#111827]/95 px-3 py-2 text-[12.5px] font-semibold text-white shadow-2xl backdrop-blur-sm"
            style={{ animation: 'toast-pop-top 0.25s ease-out both' }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 fill-status-ready">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
            <span className="line-clamp-1">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
