'use client'

import { useState, type RefObject } from 'react'
import { Bike, MapPin, MapPinned, Phone, ReceiptText, UserRound, Wallet } from 'lucide-react'
import { Flutuante, ModalCentral } from '@/components/ui/flutuante'
import type { Pedido } from '@/lib/queries/pedidos'
import { formatarReal } from '@/lib/moeda'
import { mascararTelefoneBR } from '@/lib/telefone'
import { rotuloForma, statusAReceber, trocoLevar } from '@/lib/pdv-pagamento'
import { EditorPagamento } from '@/components/pedidos/editor-pagamento'
import { textoStatusLalamove, type EntregaProvedorLinha } from '@/lib/entregas/lalamove-status'

/**
 * "Mais informações" do card (redesign 18/10): um menu pequeno sobre o card — Usuário · Destino · Pagamento ·
 * Pedidos — e cada opção abre um modal no centro da tela só com aquela informação. Dados do próprio `Pedido`
 * que o Kanban já tem; nada novo é consultado.
 */
export type AbaInfo = 'usuario' | 'destino' | 'pagamento' | 'pedidos'
/** Ícones DEFINITIVOS do menu (18/10): quadradinho tingido + ícone; a mesma cor no título do modal. */
const ABAS: { id: AbaInfo; rotulo: string; descricao: string; Icone: typeof UserRound; cor: string; fundo: string }[] = [
  { id: 'usuario', rotulo: 'Usuário', descricao: 'Nome, telefone e endereço', Icone: UserRound, cor: '#184F95', fundo: '#E1EDF7' },
  { id: 'destino', rotulo: 'Destino', descricao: 'Endereço da entrega', Icone: MapPinned, cor: '#7E22CE', fundo: '#F3E8FF' },
  { id: 'pagamento', rotulo: 'Pagamento', descricao: 'Forma, situação e valor', Icone: Wallet, cor: '#15803D', fundo: '#DCFCE7' },
  { id: 'pedidos', rotulo: 'Pedidos', descricao: 'Itens, adicionais e observações', Icone: ReceiptText, cor: '#C2410C', fundo: '#FFEDD5' },
]
const hora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null)
const LINHA = 'flex justify-between gap-4 py-2 text-[13.5px]'
const ROTULO = 'flex-shrink-0 text-[#6B7280]'
const VALOR = 'min-w-0 text-right font-semibold text-[#1F2937]'

export function MenuMaisInfo({ ancora, aberto, onFechar, onEscolher, numero }: { ancora: RefObject<HTMLButtonElement | null>; aberto: boolean; onFechar: () => void; onEscolher: (a: AbaInfo) => void; numero: number }) {
  return (
    <Flutuante ancora={ancora} aberto={aberto} onFechar={onFechar} alinhar="inicio" largura={250} testid={`mais-info-menu-${numero}`} rotulo={`Mais informações do pedido #${numero}`} className="py-1">
      {ABAS.map(({ id, rotulo, descricao, Icone, cor, fundo }) => (
        <button key={id} type="button" role="menuitem" onClick={() => { onEscolher(id); onFechar() }} data-testid={`mais-info-${id}`}
          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#E5E7EB]">
          <span className="grid h-[30px] w-[30px] flex-shrink-0 place-items-center rounded-[4px]" style={{ background: fundo, color: cor }}><Icone className="h-[16px] w-[16px]" strokeWidth={2.2} aria-hidden /></span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold leading-[16px] text-[#1F2937]">{rotulo}</span>
            <span className="block truncate text-[11.5px] leading-[14px] text-[#6B7280]">{descricao}</span>
          </span>
        </button>
      ))}
    </Flutuante>
  )
}

export function ModalInfoPedido({ pedido: p, aba, corrida, onFechar, onPagamentoAlterado }: { pedido: Pedido; aba: AbaInfo; corrida?: EntregaProvedorLinha | null; onFechar: () => void; onPagamentoAlterado: () => void }) {
  const [editando, setEditando] = useState(false)
  const def = ABAS.find((a) => a.id === aba)!
  const tel = p.clienteTelefone.replace(/\D/g, '')
  const endereco = p.tipo === 'entrega' ? [`${p.enderecoRua}, ${p.enderecoNumero}`, p.enderecoComplemento, p.enderecoBairro, p.enderecoCidade, p.enderecoCep].filter(Boolean).join(' · ') : null
  const levar = !p.pago && p.formaPagamento === 'dinheiro' ? trocoLevar(p.total, p.trocoPara) : 0
  const mapa = endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.enderecoRua, p.enderecoNumero, p.enderecoBairro, p.enderecoCidade].filter(Boolean).join(', '))}` : null
  return (
    <ModalCentral aberto onFechar={onFechar} titulo={<span className="flex items-center gap-2"><span className="grid h-[28px] w-[28px] place-items-center rounded-[4px]" style={{ background: def.fundo, color: def.cor }}><def.Icone className="h-[16px] w-[16px]" strokeWidth={2.2} aria-hidden /></span> {def.rotulo} · pedido #{p.numero}</span>} largura={520} testid={`modal-info-${aba}`} classeCorpo="px-4 py-2 sm:px-5">
      {aba === 'usuario' && (
        <div className="divide-y divide-[#F3F4F6]" data-testid="info-usuario">
          <div className={LINHA}><span className={ROTULO}>Nome</span><span className={VALOR}>{p.clienteNome || '—'}</span></div>
          <div className={LINHA}><span className={ROTULO}>Telefone</span>
            {tel ? (
              <span className="flex items-center gap-3">
                <a href={`tel:${tel}`} className="inline-flex items-center gap-1 font-semibold text-[#0688D4] hover:underline"><Phone className="h-4 w-4" aria-hidden /> {mascararTelefoneBR(p.clienteTelefone)}</a>
                <a href={`https://wa.me/${tel.startsWith('55') ? tel : `55${tel}`}`} target="_blank" rel="noopener noreferrer" className="rounded-[2px] bg-[#DCFCE7] px-2 py-0.5 text-[12px] font-semibold text-[#15803D] hover:brightness-95">WhatsApp</a>
                {!p.telefoneVerificado && p.origem !== 'pdv' && <span className="rounded-[2px] bg-[#FEE2E2] px-1.5 py-0.5 text-[11px] font-semibold text-[#B91C1C]">não verificado</span>}
              </span>
            ) : <span className={VALOR}>—</span>}
          </div>
          {endereco && <div className={LINHA}><span className={ROTULO}>Endereço</span><span className={VALOR}>{endereco}</span></div>}
          {p.enderecoReferencia && <div className={LINHA}><span className={ROTULO}>Referência</span><span className={VALOR}>{p.enderecoReferencia}</span></div>}
          {p.observacao && <div className={LINHA}><span className={ROTULO}>Observação</span><span className={VALOR}>{p.observacao}</span></div>}
        </div>
      )}
      {aba === 'destino' && (
        <div className="divide-y divide-[#F3F4F6]" data-testid="info-destino">
          {p.tipo !== 'entrega' ? (
            <p className="py-3 text-[13.5px] text-[#4B5563]">{p.canal === 'mesa' ? `Pedido de mesa${p.mesa ? ` (${p.mesa})` : ''} — sem entrega.` : 'Retirada no balcão — sem entrega.'}</p>
          ) : (
            <>
              <div className={LINHA}><span className={ROTULO}>Endereço</span><span className={VALOR}>{p.enderecoRua}, {p.enderecoNumero}{p.enderecoComplemento ? ` · ${p.enderecoComplemento}` : ''}</span></div>
              <div className={LINHA}><span className={ROTULO}>Bairro</span><span className={VALOR}>{p.enderecoBairro || '—'}{p.enderecoCidade ? ` · ${p.enderecoCidade}` : ''}{p.enderecoCep ? ` · ${p.enderecoCep}` : ''}</span></div>
              {p.enderecoReferencia && <div className={LINHA}><span className={ROTULO}>Referência</span><span className={VALOR}>{p.enderecoReferencia}</span></div>}
              <div className={LINHA}><span className={ROTULO}>Taxa de entrega</span><span className={VALOR}>{p.taxaEntrega > 0 ? formatarReal(p.taxaEntrega) : 'Grátis'}</span></div>
              {corrida ? (
                <div className={LINHA}><span className={ROTULO}>Lalamove</span><span className={VALOR}>{textoStatusLalamove(corrida.status)}{corrida.motoristaNome ? ` · ${corrida.motoristaNome}` : ''}{corrida.shareLink && <> · <a href={corrida.shareLink} target="_blank" rel="noopener noreferrer" className="text-[#0688D4] underline">rastrear</a></>}</span></div>
              ) : (p.entregadorId || p.status === 'em_rota') ? (
                <div className={LINHA}><span className={ROTULO}>Motoboy</span><span className={`${VALOR} inline-flex items-center gap-1`}><Bike className="h-4 w-4 text-[#6B7280]" aria-hidden /> {p.entregadorNome ?? 'Sem motoboy'}</span></div>
              ) : null}
              {mapa && <div className="py-2"><a href={mapa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#0688D4] hover:underline" data-testid="info-mapa"><MapPin className="h-4 w-4" aria-hidden /> Abrir no mapa</a></div>}
            </>
          )}
        </div>
      )}
      {aba === 'pagamento' && (
        <div data-testid="info-pagamento">
          {p.canal === 'mesa' ? (
            <p className="py-3 text-[13.5px] text-[#4B5563]">Pagamento no fechamento da conta da mesa.</p>
          ) : editando ? (
            <div className="py-3"><EditorPagamento pedidoId={p.id} p={p} onCancelar={() => setEditando(false)} onFeito={() => { setEditando(false); onPagamentoAlterado() }} /></div>
          ) : (
            <div className="divide-y divide-[#F3F4F6]">
              <div className={LINHA}><span className={ROTULO}>Forma</span><span className={VALOR}>{rotuloForma(p.formaPagamento, p.cartaoTipo, p.pagamentoOnline)}</span></div>
              <div className={LINHA}><span className={ROTULO}>Situação</span>
                {p.pago ? <span className="font-semibold text-[#15803D]">Pago{p.pagamentoOnline ? ' pela vitrine' : ''}</span> : <span className="font-semibold text-[#92400E]">{statusAReceber(p.tipo)}</span>}
              </div>
              {p.pago && p.pagamentoOnline && <div className={LINHA}><span className={ROTULO}>Horário</span><span className={VALOR}>{hora(p.criadoEm)} (junto com o pedido)</span></div>}
              {!p.pago && p.status === 'entregue' && p.etapas?.entregue && <div className={LINHA}><span className={ROTULO}>Recebido na entrega</span><span className={VALOR}>{hora(p.etapas.entregue)}</span></div>}
              <div className={LINHA}><span className={ROTULO}>Valor da compra</span><span className={`${VALOR} text-[#15803D]`}>{formatarReal(p.total)}</span></div>
              {p.desconto > 0 && <div className={LINHA}><span className={ROTULO}>Desconto</span><span className={VALOR}>−{formatarReal(p.desconto)}</span></div>}
              {p.formaPagamento === 'dinheiro' && p.trocoPara ? <div className={LINHA}><span className={ROTULO}>Troco</span><span className={VALOR}>para {formatarReal(p.trocoPara)}{levar > 0 ? ` · levar ${formatarReal(levar)}` : ''}</span></div> : null}
              {p.status !== 'cancelado' && (
                <div className="py-3"><button type="button" onClick={() => setEditando(true)} className="text-[13px] font-semibold text-[#0688D4] underline" data-testid="info-alterar-pagamento">Alterar pagamento</button></div>
              )}
            </div>
          )}
        </div>
      )}
      {aba === 'pedidos' && (
        <ul className="divide-y divide-[#F3F4F6]" data-testid="info-pedidos">
          {p.itens.map((l) => (
            <li key={l.id} className="py-2">
              <div className="flex justify-between gap-3 text-[13.5px] text-[#1F2937]">
                <span className="min-w-0"><b>{l.quantidade}×</b> {l.nome}{l.tamanhoNome && <span className="text-[#6B7280]"> · {l.tamanhoNome}</span>}{l.saborNome && <span className="text-[#6B7280]"> · {l.saborNome}</span>}</span>
                <span className="flex-shrink-0 font-semibold tabular-nums text-[#15803D]">{formatarReal(l.precoUnitario * l.quantidade)}</span>
              </div>
              {(l.bordaNome || l.massaNome) && <div className="text-[12.5px] text-[#6B7280]">{[l.bordaNome, l.massaNome].filter(Boolean).join(', ')}</div>}
              {l.complementos.length > 0 && <div className="text-[12.5px] text-[#6B7280]">{l.complementos.map((c) => (c.preco > 0 ? `${c.nome} (+${formatarReal(c.preco)})` : c.nome)).join(', ')}</div>}
              {l.observacao && <div className="mt-0.5 text-[12.5px] font-semibold text-[#B91C1C]">Obs.: {l.observacao}</div>}
            </li>
          ))}
          {p.observacao && <li className="py-2 text-[12.5px] font-semibold text-[#B91C1C]">Observação do pedido: {p.observacao}</li>}
          <li className="space-y-1 py-2 text-[13px]">
            <div className="flex justify-between text-[#6B7280]"><span>Subtotal</span><span className="tabular-nums">{formatarReal(p.subtotal)}</span></div>
            {p.taxaEntrega > 0 && <div className="flex justify-between text-[#6B7280]"><span>Taxa de entrega</span><span className="tabular-nums">{formatarReal(p.taxaEntrega)}</span></div>}
            {p.desconto > 0 && <div className="flex justify-between text-[#6B7280]"><span>Desconto</span><span className="tabular-nums">−{formatarReal(p.desconto)}</span></div>}
            <div className="flex justify-between pt-1 text-[15px] font-semibold text-[#111827]"><span>Total</span><span className="tabular-nums text-[#15803D]">{formatarReal(p.total)}</span></div>
          </li>
        </ul>
      )}
    </ModalCentral>
  )
}
