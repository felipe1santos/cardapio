'use client'

import type { ReactNode } from 'react'
import { ArrowRight, Bell, Clock, Globe, Monitor, QrCode, Route, UtensilsCrossed } from 'lucide-react'
import type { Pedido } from '@/lib/queries/pedidos'
import { corTempoPedido, textoTempoPedido } from '@/lib/tempo-pedido'
import { formatarReal } from '@/lib/moeda'
import { nomeLimpo } from '@/lib/nome-item'
import { itensDoCard, logoDaOrigem } from '@/lib/kanban-card'
import { pagamentoV3, rotuloDaAcao, selosDoCard, type AcaoV3 } from '@/lib/kanban-v3'
import { ATRASO, FONTE_CENTRAL, SELO_POR_TOM } from '@/components/ui/tokens-central'

/**
 * Kanban v3 (15/10/2026, só "Novidades em teste"): card no padrão da central do WhatsApp. SÓ visual — aceitar, pronto,
 * despachar (o mesmo menu de motoboy), entregue, confirmar entrega, tempo real e alarme são as mesmas funções da página.
 *  1. #nº · NOME · NOVO · tempo       2. selo verde do tipo · selo azul (IA/bairro)
 *  3. até 2 itens (+N) · logo da origem   4. (tracejado) selo de pagamento · VALOR
 * (15/10, ajuste: card fino de 92px — tipo como ícone ao lado do nome, pagamento e valor na linha do último item, logo centralizado.)
 * Altura fixa. Sem botões: a seta (hover/foco; sempre no toque) faz a ação da etapa. Clicar no resto abre o painel.
 */

/** "0:40" no primeiro minuto (como o modelo), "12 min" até 1 h, depois "2 horas". */
export function tempoV3(ms: number): string {
  const seg = Math.max(0, Math.floor(ms / 1000))
  if (seg < 60) return `0:${String(seg).padStart(2, '0')}`
  if (seg < 3600) return `${Math.floor(seg / 60)} min`
  return textoTempoPedido(ms)
}

export function EtiquetaNumeroV3({ numero, grande }: { numero: number; grande?: boolean }) {
  return (
    <span className={`inline-flex flex-shrink-0 items-center rounded-[6px] bg-[#1F2937] font-extrabold tabular-nums text-white ${grande ? 'px-[8px] text-[15px] leading-[26px]' : 'px-[6px] text-[12.5px] leading-[22px]'}`}>
      #{numero}
    </span>
  )
}

export function SeloTexto({ classe, emoji, texto, testid, titulo }: { classe: string; emoji?: string | null; texto: string; testid?: string; titulo?: string }) {
  return (
    <span className={`${classe} min-w-0 max-w-full`} data-testid={testid} title={titulo ?? texto}>
      {emoji && <span aria-hidden className="flex-shrink-0">{emoji}</span>}
      <span className="min-w-0 truncate">{texto}</span>
    </span>
  )
}

/** Logo da origem (~34px; largos como o iFood ~56×30), de public/origens/. */
export function LogoOrigemV3({ pedido, tamanho = 34 }: { pedido: Pedido; tamanho?: number }) {
  const l = logoDaOrigem(pedido)
  const largo = l.arquivo?.includes('ifood')
  const Neutro = l.neutro === 'pdv' ? Monitor : l.neutro === 'mesa' ? UtensilsCrossed : l.neutro === 'qrcode' ? QrCode : l.neutro === 'outros' ? Globe : null
  const w = largo ? Math.round(tamanho * 1.65) : tamanho
  const h = largo ? Math.round(tamanho * 0.88) : tamanho
  return (
    <span className="relative inline-flex flex-shrink-0 items-center justify-center" style={{ width: w, height: h }}
      title={`Origem: ${l.rotulo}`} aria-label={`Origem: ${l.rotulo}`} role="img" data-testid="card-origem" data-origem={l.rotulo}>
      {l.arquivo ? (
        // eslint-disable-next-line @next/next/no-img-element -- logo local pequeno (SVG/PNG em public/origens)
        <img src={l.arquivo} alt="" draggable={false} className="max-h-full max-w-full object-contain" style={largo ? { width: w, height: h } : { width: tamanho * 0.82, height: tamanho * 0.82 }} />
      ) : Neutro ? (
        <Neutro className="text-[#4B5563]" style={{ width: tamanho * 0.56, height: tamanho * 0.56 }} strokeWidth={2} aria-hidden />
      ) : (
        <span className="px-1 text-[9.5px] font-bold uppercase leading-[12px] text-[#4B5563]">{l.rotulo}</span>
      )}
      {l.selo === 'sino' && (
        <span className="absolute -bottom-[3px] -right-[3px] inline-flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[#7E22CE] text-white"><Bell className="h-[9px] w-[9px]" strokeWidth={3} aria-hidden /></span>
      )}
    </span>
  )
}

/** Cor da seta: verde-escuro; azul no Despachar. */
const COR_SETA = (a: AcaoV3) => (a === 'despachar' ? '#0688D4' : '#047857')

export function CardPedidoV3({
  pedido, agora, selecionado, novo, somBloqueado, onAbrir, acao, onAcao, renderDespachar,
}: {
  pedido: Pedido
  agora: number
  selecionado: boolean
  /** Recebido e ainda não aceito: amarelo com faixa laranja e a etiqueta NOVO. */
  novo: boolean
  /** Som bloqueado pelo navegador: pisca em vermelho (mesma regra de antes). */
  somBloqueado: boolean
  onAbrir: () => void
  acao: AcaoV3 | null
  onAcao: () => void
  /** "Despachar": o mesmo menu de motoboy de hoje, com a seta como gatilho. */
  renderDespachar?: (seta: { className: string; children: ReactNode }) => ReactNode
}) {
  const p = pedido
  const idade = agora - new Date(p.criadoEm).getTime()
  const atrasado = corTempoPedido(idade) === 'atraso'
  const { linhas, resto } = itensDoCard(p.itens)
  const selos = selosDoCard(p)
  const pg = pagamentoV3(p)
  const rotulo = acao ? rotuloDaAcao(acao) : ''
  const seta = acao ? {
    className: [
      'card-v3-seta absolute right-[-14px] top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-white text-white',
      'h-[38px] w-[38px] shadow-[0_4px_12px_rgba(17,24,39,.28)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0688D4]',
      '[@media(hover:none)]:h-[32px] [@media(hover:none)]:w-[32px] [@media(hover:none)]:opacity-100',
    ].join(' '),
    children: (
      <span className="flex h-full w-full items-center justify-center rounded-full" style={{ backgroundColor: COR_SETA(acao) }}>
        {acao === 'despachar' ? <Route className="h-[16px] w-[16px]" strokeWidth={2.6} aria-hidden /> : <ArrowRight className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />}
      </span>
    ),
  } : null

  return (
    <div
      data-testid={`pedido-${p.numero}`}
      data-card-v3="1"
      data-novo={novo ? '1' : undefined}
      data-selecionado={selecionado ? '1' : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={selecionado}
      aria-label={`Pedido #${p.numero} de ${p.clienteNome || 'Cliente'}: abrir o pedido`}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onAbrir() } }}
      style={FONTE_CENTRAL}
      className={[
        // Card fino (15/10, pedido do dono): 2 linhas de conteúdo e o logo da origem centralizado na altura toda.
        'group relative flex h-[92px] cursor-pointer select-none flex-col rounded-[10px] border py-[10px] pl-[14px] pr-[16px] text-[#111827] outline-none transition-shadow duration-150',
        novo
          ? 'border-[#FCD34D] bg-[#FDE68A] shadow-[0_6px_18px_rgba(245,158,11,.28)] hover:shadow-[0_10px_24px_rgba(245,158,11,.36)]'
          : 'border-[#E5E7EB] bg-white shadow-[0_1px_3px_rgba(17,24,39,.08)] hover:shadow-[0_8px_20px_rgba(17,24,39,.14)]',
        selecionado ? 'outline outline-2 outline-offset-2 outline-[#0688D4]' : 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0688D4]',
        somBloqueado ? 'animate-pulse ring-4 ring-[#DC2626]' : '',
      ].join(' ')}
    >
      {novo && <span aria-hidden className="absolute inset-y-[-1px] left-[-1px] w-[5px] rounded-l-[10px] bg-[#F59E0B]" />}

      <div className="flex min-w-0 flex-col">
        {/* 1) nº · NOME · tipo (ícone) · NOVO · tempo */}
        <div className="flex h-[22px] min-w-0 items-center gap-[8px]">
          <EtiquetaNumeroV3 numero={p.numero} />
          <span className="min-w-[36px] truncate text-[15px] font-extrabold leading-[20px]" title={p.clienteNome || undefined}>{p.clienteNome || 'Cliente'}</span>
          <span className="inline-flex flex-shrink-0 items-center gap-[4px] text-[15px] leading-none" data-testid="card-tipo">
            <span role="img" aria-label={selos.tipo.texto} title={selos.tipo.texto} data-testid="card-selo-tipo" data-tipo={selos.tipo.texto}>{selos.tipo.emoji}</span>
            {p.origemCanal === 'whatsapp_ia' && <span role="img" aria-label="Anotado no WhatsApp" title="Anotado no WhatsApp" data-testid="card-selo-azul">✍️</span>}
            {p.agendadoPara && <span role="img" aria-label="Agendado" title={`Agendado para ${new Date(p.agendadoPara).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}>🗓️</span>}
          </span>
          <span className="ml-auto flex flex-shrink-0 items-center gap-[6px]">
            {novo && <span className="rounded-[6px] border border-[#F59E0B] bg-[#FFFBEB] px-[6px] text-[10.5px] font-extrabold uppercase leading-[16px] tracking-wide text-[#B45309]" data-testid="card-novo">Novo</span>}
            <span
              className={`inline-flex items-center gap-[4px] rounded-full text-[12.5px] font-bold tabular-nums ${atrasado ? `${ATRASO} px-[8px] py-[1px]` : novo ? 'text-[#92400E]' : 'text-[#4B5563]'}`}
              title="Tempo desde que o pedido chegou" data-testid="card-tempo" data-tom={corTempoPedido(idade)}
            >
              <Clock className="h-[13px] w-[13px]" strokeWidth={2.5} aria-hidden /> {tempoV3(idade)}
            </span>
          </span>
        </div>

        {/* 2) itens (até 2); na linha do último: "+N", pagamento e valor à direita */}
        <ul className="mt-[6px] space-y-[2px] pr-[42px] text-[13.5px] leading-[20px]" data-testid="card-itens">
          {linhas.map((l, i) => {
            const ultima = i === linhas.length - 1
            return (
              <li key={l.id} className="flex h-[21px] min-w-0 items-center gap-[6px]">
                <span className="min-w-0 truncate"><b className="font-extrabold tabular-nums">{l.quantidade}x</b> {nomeLimpo(l.nome)}</span>
                {ultima && resto > 0 && (
                  <span className={`flex-shrink-0 whitespace-nowrap text-[11.5px] font-semibold ${novo ? 'text-[#B45309]' : 'text-[#6B7280]'}`} data-testid="card-mais-itens">+{resto} {resto === 1 ? 'item' : 'itens'}</span>
                )}
                {ultima && (
                  <span className="ml-auto flex flex-shrink-0 items-center gap-[8px] pl-[4px]">
                    {/* Só o ícone da forma de pagamento (texto inteiro no tooltip e no painel), à esquerda do valor */}
                    <span className={`${SELO_POR_TOM[pg.tom]} flex-shrink-0 px-[5px]`} title={pg.texto} aria-label={pg.texto} role="img" data-testid="card-pagamento" data-texto={pg.texto}>{pg.emoji}</span>
                    <span className="flex-shrink-0 whitespace-nowrap text-[15.5px] font-extrabold tabular-nums" data-testid="card-preco">{formatarReal(p.total)}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {/* Logo da origem: sem fundo, centralizado na altura do card inteiro, fora do fluxo (não tira espaço do nome) */}
      <span className="pointer-events-none absolute right-[16px] top-1/2 flex -translate-y-1/2"><LogoOrigemV3 pedido={p} tamanho={28} /></span>

      {/* Seta da etapa (não abre o painel) */}
      {acao && seta && (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {acao === 'despachar' && renderDespachar
            ? renderDespachar(seta)
            : (
              <button type="button" className={seta.className} onClick={onAcao} aria-label={`${rotulo}: pedido #${p.numero}`} title={rotulo} data-testid="card-etapa" data-acao={acao}>
                {seta.children}
              </button>
            )}
        </span>
      )}
    </div>
  )
}
