'use client'

import type { CSSProperties, ReactNode } from 'react'
import { Banknote, ChevronRight, Clock, CreditCard, Globe, Monitor, QrCode, Receipt, UtensilsCrossed, Bell } from 'lucide-react'
import type { Pedido } from '@/lib/queries/pedidos'
import { corTempoPedido, textoTempoPedido } from '@/lib/tempo-pedido'
import { formatarReal } from '@/lib/moeda'
import { nomeLimpo } from '@/lib/nome-item'
import { IconePix } from '@/components/icones/origens'
import { iconesDoTipo, itensDoCard, logoDaOrigem, pagamentoDoCard, type AcaoCard } from '@/lib/kanban-card'

/**
 * Card novo do Kanban (13/10/2026, só "Novidades em teste"; modelo aprovado pelo dono). SÓ visual: abrir o painel,
 * aceitar, pronto, despachar, entregue, tempo real e alarme continuam nas mesmas funções da página.
 *  - Linha 1: nº · CLIENTE · NOVO … ícones do tipo · tempo.   Linha 2: itens … valor + pagamento · logo da origem.
 *  - Setinha no canto direito (aparece ao passar o mouse; sempre visível no toque) = botão de etapa do card antigo.
 *  - Clicar em qualquer outro lugar abre o painel do pedido.
 */
export const FONTE_CARD: CSSProperties = { fontFamily: '"DM Sans", system-ui, sans-serif' }
/** Negrito do modelo (exceção à regra dos 600, só no visual novo — lib/peso-fonte.test.ts). */
export const NEGRITO = 'font-bold'

const COR_ACAO: Record<AcaoCard, { cor: string; rotulo: string }> = {
  aceitar: { cor: '#0688D4', rotulo: 'Aceitar' },
  pronto: { cor: '#059669', rotulo: 'Pronto' },
  entregue: { cor: '#059669', rotulo: 'Entregue' },
  saiu: { cor: '#1F2329', rotulo: 'Saiu p/ entrega' },
  despachar: { cor: '#0B78D0', rotulo: 'Despachar' },
}

/** "0:12" até 1 h (como o modelo); depois "2 horas". */
export function tempoDoCard(ms: number): string {
  const seg = Math.max(0, Math.floor(ms / 1000))
  if (seg >= 3600) return textoTempoPedido(ms)
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`
}

export function EtiquetaNumero({ numero, grande }: { numero: number; grande?: boolean }) {
  return (
    <span className={`inline-flex flex-shrink-0 items-center bg-[#1F2329] px-[6px] font-bold leading-[20px] text-white tabular-nums ${grande ? 'text-[16px] leading-[24px]' : 'text-[13px]'}`}>
      #{numero}
    </span>
  )
}

export function IconesDoTipo({ pedido }: { pedido: Pedido }) {
  return (
    <span className="inline-flex items-center gap-[6px]" data-testid="card-tipo">
      {iconesDoTipo(pedido).map((i) => (
        <span key={i.emoji} className="text-[17px] leading-none" role="img" aria-label={i.rotulo} title={i.rotulo}>{i.emoji}</span>
      ))}
    </span>
  )
}

/** Logo da origem sem fundo (no card verde não pode aparecer quadrado branco). */
export function LogoOrigemPedido({ pedido, altura = 36 }: { pedido: Pedido; altura?: number }) {
  const l = logoDaOrigem(pedido)
  const neutro = l.neutro === 'pdv' ? Monitor : l.neutro === 'mesa' ? UtensilsCrossed : l.neutro === 'qrcode' ? QrCode : l.neutro === 'outros' ? Globe : null
  return (
    <span className="relative inline-flex flex-shrink-0 items-center justify-center self-center" style={{ height: altura, width: altura + 8 }} title={`Origem: ${l.rotulo}`} aria-label={`Origem: ${l.rotulo}`} role="img" data-testid="card-origem" data-origem={l.rotulo}>
      {l.arquivo ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo local pequeno (SVG/PNG em public/origens), sem otimização
        <img src={l.arquivo} alt="" className="max-h-full max-w-full object-contain" style={{ height: l.arquivo.endsWith('.png') ? altura - 6 : altura - 8 }} draggable={false} />
      ) : neutro ? (
        <span className="inline-flex h-full w-full items-center justify-center text-[#4B5563]"><Icone Comp={neutro} /></span>
      ) : (
        <span className="border border-current px-1 text-[10px] font-bold uppercase leading-[14px] text-[#4B5563]">{l.rotulo}</span>
      )}
      {l.selo === 'sino' && (
        <span className="absolute -bottom-[2px] right-[2px] inline-flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[#7E22CE] text-white"><Bell className="h-[9px] w-[9px]" strokeWidth={3} aria-hidden /></span>
      )}
    </span>
  )
}
function Icone({ Comp }: { Comp: typeof Monitor }) { return <Comp className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden /> }

/** Etiqueta da forma de pagamento. No card verde, sem fundo (só a borda). */
export function EtiquetaPagamento({ pedido, novo }: { pedido: Pedido; novo?: boolean }) {
  const pg = pagamentoDoCard(pedido)
  const icone: ReactNode = pg.icone === 'dinheiro' ? <Banknote className="h-[13px] w-[13px]" aria-hidden />
    : pg.icone === 'pix' ? <IconePix className="h-[12px] w-[12px]" />
    : pg.icone === 'cartao' ? <CreditCard className="h-[13px] w-[13px]" aria-hidden />
    : pg.icone === 'conta' ? <Receipt className="h-[13px] w-[13px]" aria-hidden />
    // eslint-disable-next-line @next/next/no-img-element -- logo local do Mercado Pago
    : <img src="/origens/mercado-pago.svg" alt="" className="h-[13px] w-[13px]" />
  return (
    <span className={`card-kanban-pagamento inline-flex min-w-0 max-w-[170px] items-center gap-[5px] whitespace-nowrap border px-[6px] py-[1px] text-[11px] font-semibold leading-[16px] text-[#166534] ${novo ? 'border-[#8FD0A8] bg-transparent' : 'border-[#BFE5CC] bg-[#E7F6EC]'}`} title={pg.texto} data-testid="card-pagamento">
      <span className="flex-shrink-0">{icone}</span><span className="min-w-0 truncate">{pg.texto}</span>
    </span>
  )
}

export function CardPedidoKanban({
  pedido, agora, selecionado, novo, somBloqueado, onAbrir, acao, onAcao, renderDespachar,
}: {
  pedido: Pedido
  agora: number
  selecionado: boolean
  /** Recebido e ainda não aceito: verde, piscando, com a etiqueta NOVO. */
  novo: boolean
  /** Som bloqueado pelo navegador: pisca em vermelho (mesma regra do card antigo). */
  somBloqueado: boolean
  onAbrir: () => void
  acao: AcaoCard | null
  onAcao: () => void
  /** "Despachar": o mesmo menu do card antigo, com a setinha como gatilho. */
  renderDespachar?: (seta: { className: string; children: ReactNode }) => ReactNode
}) {
  const p = pedido
  const idade = agora - new Date(p.criadoEm).getTime()
  const tom = corTempoPedido(idade)
  const corTexto = novo ? 'text-[#0F2A1A]' : 'text-[#111827]'
  const corTempo = tom === 'atraso' ? 'text-[#C42B1C]' : tom === 'atencao' ? 'text-[#B45309]' : corTexto
  const { linhas, resto } = itensDoCard(p.itens)
  const a = acao ? COR_ACAO[acao] : null
  const seta = a ? {
    className: 'absolute inset-y-0 right-0 z-10 flex w-[16px] bg-black/[0.05] items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688D4] [@media(hover:none)]:w-[24px] [@media(hover:none)]:opacity-100',
    children: <ChevronRight className="h-[16px] w-[16px]" strokeWidth={3} style={{ color: a.cor }} aria-hidden />,
  } : null
  const abrir = () => onAbrir()

  return (
    <div
      data-testid={`pedido-${p.numero}`}
      data-card-novo="1"
      data-novo={novo ? '1' : undefined}
      data-selecionado={selecionado ? '1' : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={selecionado}
      aria-label={`Pedido #${p.numero}: abrir o pedido`}
      onClick={abrir}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrir() } }}
      style={FONTE_CARD}
      className={[
        'card-kanban group relative h-[100px] cursor-pointer select-none overflow-hidden rounded-none px-[14px] pb-[10px] pt-[6px] outline-none transition-[box-shadow] [@media(hover:none)]:pr-[28px]',
        novo
          ? 'card-kanban-novo border border-[#1F9D55] bg-[#C9EFD7] shadow-[inset_0_0_0_1px_#1F9D55,0_8px_20px_rgba(21,128,61,.22),0_2px_4px_rgba(21,128,61,.12)]'
          : 'border border-[#D1D5DB] bg-[#F3F4F6] shadow-[0_8px_20px_rgba(17,24,39,.10),0_2px_4px_rgba(17,24,39,.06)]',
        selecionado ? 'outline outline-2 outline-offset-2 outline-[#0688D4]' : 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0688D4]',
        somBloqueado ? 'animate-pulse ring-4 ring-[#DC2626]' : '',
        corTexto,
      ].join(' ')}
    >
      {/* Linha 1 (altura fixa: o nome é que encurta com "…") */}
      <div className="flex h-[28px] items-center gap-[8px]">
        <EtiquetaNumero numero={p.numero} />
        <span className="min-w-0 flex-1 truncate text-[16px] font-bold uppercase leading-[20px]" title={p.clienteNome || undefined}>{p.clienteNome || 'Cliente'}</span>
        {novo && <span className="flex-shrink-0 bg-[#15803D] px-[6px] text-[11px] font-bold uppercase leading-[18px] tracking-wide text-white" data-testid="card-novo">Novo</span>}
        {p.agendadoPara && (
          <span className="flex-shrink-0 border border-[#0369A1] px-[5px] text-[11px] font-semibold leading-[16px] text-[#0369A1]">
            Agendado {new Date(p.agendadoPara).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <span className="ml-auto flex flex-shrink-0 items-center gap-[10px]">
          <IconesDoTipo pedido={p} />
          <span className={`inline-flex items-center gap-[4px] text-[15px] font-bold tabular-nums ${corTempo}`} title="Tempo desde que o pedido chegou" data-testid="card-tempo" data-tom={tom}>
            <Clock className="h-[15px] w-[15px]" strokeWidth={2.5} aria-hidden /> {tempoDoCard(idade)}
          </span>
        </span>
      </div>
      <div className={`mb-[8px] mt-[4px] h-px ${novo ? 'bg-[#9ED8B4]' : 'bg-[#E2E4E8]'}`} />
      {/* Linha 2: sempre 2 linhas de itens (até 2 itens; com mais, o 1º e "+N itens" — o resto abrindo o pedido) */}
      <div className="flex h-[42px] items-center gap-[12px]">
        <ul className="min-w-0 flex-1 space-y-[2px] text-[14px] leading-[19px]" data-testid="card-itens">
          {linhas.map((l) => (
            <li key={l.id} className="truncate"><b className="font-bold tabular-nums">{l.quantidade}x</b> {nomeLimpo(l.nome)}</li>
          ))}
          {resto > 0 && <li className="text-[13px] font-semibold opacity-75">+{resto} {resto === 1 ? 'item' : 'itens'}</li>}
        </ul>
        {/* Valor + pagamento + logo (em card estreito o logo diminui e a etiqueta corta com "…": app/globals.css) */}
        <div className="flex flex-shrink-0 items-center gap-[12px]">
          <div className="flex min-w-0 flex-col items-end gap-[4px]">
            <span className="text-[15px] font-bold tabular-nums text-[#0B4A2A]" data-testid="card-preco">{formatarReal(p.total)}</span>
            <EtiquetaPagamento pedido={p} novo={novo} />
          </div>
          <LogoOrigemPedido pedido={p} />
        </div>
      </div>
      {/* Setinha de avançar (o botão de etapa de antes) */}
      {a && seta && (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {acao === 'despachar' && renderDespachar
            ? renderDespachar(seta)
            : (
              <button type="button" className={seta.className} onClick={onAcao} aria-label={`${a.rotulo}: pedido #${p.numero}`} title={a.rotulo} data-testid="card-etapa" data-acao={acao}>
                {seta.children}
              </button>
            )}
        </span>
      )}
    </div>
  )
}
