'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AlertTriangle, Minus, Plus, Search, Trash2 } from 'lucide-react'
import { ModalCentral } from '@/components/ui/flutuante'
import { ConfigurarItem, precoUnitarioPdv, type EstadoConfig, type LinhaConfigurada } from '@/components/pdv/configurar-item'
import { AprovacaoPin, type AprovacaoDada } from '@/components/financeiro/apoio'
import { listarGrupos, listarItens, type ItemCardapio } from '@/lib/queries/cardapio'
import { buscarRegraPrecoPizza, listarBordasPizza, listarMassasPizza, listarTamanhosPadraoPizza, type BordaPizza, type MassaPizza, type TamanhoPadraoPizza } from '@/lib/queries/pizza'
import type { RegraPrecoPizza } from '@/lib/pizza-preco'
import { massasParaEscolha } from '@/lib/massa-padrao'
import { itensNaOrdemDoCardapio } from '@/lib/ordem-cardapio'
import type { NovoPedidoItemInput, Pedido } from '@/lib/queries/pedidos'
import { atalhosTroco, daPedido, ESCOLHAS_PDV, ROTULO_ESCOLHA, type EscolhaPdv } from '@/lib/pdv-pagamento'
import { pedidoEditavel } from '@/lib/pedido-editavel'
import type { EntregaProvedorLinha } from '@/lib/entregas/lalamove-status'
import { formatarReal } from '@/lib/moeda'

/**
 * "Editar pedido" (18/10): janela central com abas Itens · Endereço · Pagamento. Tudo que a loja mexe aqui vai numa
 * chamada só para POST /api/admin/pedidos/[id]/editar, que recalcula no servidor (preço da vitrine, frete, cupom,
 * troco) e devolve o novo total. Pago online: o servidor responde o que precisa (estorno parcial com PIN ou "receber
 * a diferença na entrega") e a janela pede a escolha antes de salvar. Mesmo visual do redesign (cantos retos, azul
 * #184F95 no destaque).
 */
const AZUL = '#184F95'
const BOTAO = 'inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[2px] px-3 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARIO = `${BOTAO} bg-[#0688D4] text-white hover:bg-[#0570AE]`
const SECUNDARIO = `${BOTAO} border border-[#D1D5DB] bg-white text-[#1F2937] hover:bg-[#E5E7EB]`
const CAMPO = 'h-[36px] w-full rounded-[2px] border border-[#D1D5DB] bg-white px-2.5 text-[13px] text-[#1F2937] outline-none focus:border-[#0688D4]'
const ABA = (ativa: boolean) => `h-[36px] border-b-2 px-3 text-[13px] font-semibold ${ativa ? 'border-[#0688D4] text-[#0688D4]' : 'border-transparent text-[#6B7280] hover:text-[#1F2937]'}`
type Aba = 'itens' | 'endereco' | 'pagamento'

interface LinhaAtual { id: string; nome: string; precoUnitario: number; quantidade: number; quantidadeOriginal: number; observacao: string; observacaoOriginal: string; tamanhoNome: string; removida: boolean }
interface LinhaNova { uid: string; item: ItemCardapio; entrada: NovoPedidoItemInput; precoUnitario: number; descricao: string }

function needsSelector(item: ItemCardapio): boolean {
  return item.tipoItem === 'pizza' || item.tamanhos.length > 0 || item.grupos.length > 0
}

export function EditarPedidoModal({ pedido: p, corrida, supabase, restauranteId, onFechar, onSalvo }: {
  pedido: Pedido
  corrida?: EntregaProvedorLinha | null
  supabase: SupabaseClient
  restauranteId: string
  onFechar: () => void
  onSalvo: (r: { numero: number; total: number; mudancas: string[] }) => void
}) {
  const editavel = pedidoEditavel({ status: p.status, canal: p.canal, entregadorId: p.entregadorId, saiuParaEntregaEm: p.saiuParaEntregaEm, origemCanal: p.origemCanal }, !!corrida && ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP'].includes(corrida.status))
  const [aba, setAba] = useState<Aba>('itens')
  const [linhas, setLinhas] = useState<LinhaAtual[]>(() => p.itens.map((i) => ({ id: i.id, nome: i.nome, precoUnitario: i.precoUnitario, quantidade: i.quantidade, quantidadeOriginal: i.quantidade, observacao: i.observacao ?? '', observacaoOriginal: i.observacao ?? '', tamanhoNome: i.tamanhoNome, removida: false })))
  const [novas, setNovas] = useState<LinhaNova[]>([])
  const [endereco, setEndereco] = useState({ rua: p.enderecoRua, numero: p.enderecoNumero, complemento: p.enderecoComplemento ?? '', bairro: p.enderecoBairro, cep: p.enderecoCep ?? '', cidade: p.enderecoCidade ?? '', referencia: p.enderecoReferencia ?? '' })
  const pagAtual = daPedido(p.formaPagamento, p.cartaoTipo, p.trocoPara)
  const [escolhaPag, setEscolhaPag] = useState<EscolhaPdv | null>(pagAtual?.escolha ?? null)
  const [trocoTxt, setTrocoTxt] = useState(pagAtual?.trocoPara ? String(pagAtual.trocoPara) : '')
  const [reimprimir, setReimprimir] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Pago online: o servidor pediu uma decisão (estorno parcial com PIN / diferença na entrega).
  const [pagoOnline, setPagoOnline] = useState<{ precisa: 'estorno_parcial' | 'diferenca_entrega'; texto: string; pixOnline?: boolean } | null>(null)
  const [erroPin, setErroPin] = useState<string | null>(null)

  // Catálogo (só ao adicionar item): o mesmo do PDV.
  const [catalogo, setCatalogo] = useState<{ itens: ItemCardapio[]; tamanhosPizza: TamanhoPadraoPizza[]; bordasPizza: BordaPizza[]; massasPizza: MassaPizza[]; regraPizza: RegraPrecoPizza } | null>(null)
  const [adicionando, setAdicionando] = useState(false)
  const [busca, setBusca] = useState('')
  const [seletor, setSeletor] = useState<EstadoConfig | null>(null)
  useEffect(() => {
    if (!adicionando || catalogo) return
    let vivo = true
    Promise.all([listarItens(supabase, restauranteId), listarGrupos(supabase, restauranteId), listarTamanhosPadraoPizza(supabase, restauranteId), listarBordasPizza(supabase, restauranteId), listarMassasPizza(supabase, restauranteId), buscarRegraPrecoPizza(supabase, restauranteId).catch(() => 'media' as RegraPrecoPizza)])
      .then(([itens, grupos, tamanhosPizza, bordasPizza, massasPizza, regraPizza]) => { if (vivo) setCatalogo({ itens: itensNaOrdemDoCardapio(grupos, itens).filter((i) => i.status === 'disponivel'), tamanhosPizza, bordasPizza, massasPizza: massasParaEscolha(massasPizza), regraPizza }) })
      .catch(() => { if (vivo) setErro('Não foi possível carregar o cardápio.') })
    return () => { vivo = false }
  }, [adicionando, catalogo, supabase, restauranteId])

  const filtrados = useMemo(() => {
    if (!catalogo) return []
    const q = busca.trim().toLowerCase()
    return (q ? catalogo.itens.filter((i) => i.nome.toLowerCase().includes(q)) : catalogo.itens).slice(0, 40)
  }, [catalogo, busca])

  function adicionarDireto(item: ItemCardapio, linha: LinhaConfigurada, quantidade: number) {
    const cat = catalogo!
    const precoUnitario = precoUnitarioPdv(item, linha, { tamanhosPizza: cat.tamanhosPizza, bordasPizza: cat.bordasPizza, massasPizza: cat.massasPizza, regraPizza: cat.regraPizza })
    const descricao = [linha.tamanhoNome, linha.saborNome, linha.bordaNome && `borda ${linha.bordaNome}`, linha.massaNome && `massa ${linha.massaNome}`, ...linha.complementos].filter(Boolean).join(' · ')
    setNovas((prev) => [...prev, { uid: crypto.randomUUID(), item, precoUnitario, descricao, entrada: { itemId: item.id, quantidade, observacao: linha.observacao, complementos: linha.complementos, tamanhoNome: linha.tamanhoNome || undefined, saborNome: linha.saborNome || undefined, bordaNome: linha.bordaNome || undefined, massaNome: linha.massaNome || undefined } }])
    setSeletor(null); setAdicionando(false); setBusca('')
  }
  function escolherItem(item: ItemCardapio) {
    if (needsSelector(item)) { setSeletor({ item, tamanhoNome: '', saborNome: '', bordaId: '', massaId: '', complementosSelecionados: {}, observacao: '' }); return }
    adicionarDireto(item, { tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos: [], observacao: '' }, 1)
  }

  // Prévia (o servidor é quem manda): subtotal com as mudanças.
  const subtotalPrevia = useMemo(() => Math.round((linhas.filter((l) => !l.removida).reduce((s, l) => s + l.precoUnitario * l.quantidade, 0) + novas.reduce((s, n) => s + n.precoUnitario * n.entrada.quantidade, 0)) * 100) / 100, [linhas, novas])
  const totalPrevia = Math.max(0, Math.round((subtotalPrevia + p.taxaEntrega - p.desconto) * 100) / 100)
  const mudancasPrevia = useMemo(() => {
    const t: string[] = []
    for (const l of linhas) {
      if (l.removida) t.push(`−${l.quantidadeOriginal}× ${l.nome}`)
      else { if (l.quantidade !== l.quantidadeOriginal) t.push(`${l.nome}: ${l.quantidadeOriginal}× → ${l.quantidade}×`); if (l.observacao.trim() !== l.observacaoOriginal.trim()) t.push(`${l.nome}: obs.`) }
    }
    for (const n of novas) t.push(`+${n.entrada.quantidade}× ${n.item.nome}`)
    const e = endereco
    if (p.tipo === 'entrega' && (e.rua !== p.enderecoRua || e.numero !== p.enderecoNumero || e.complemento !== (p.enderecoComplemento ?? '') || e.bairro !== p.enderecoBairro || e.cep !== (p.enderecoCep ?? '') || e.cidade !== (p.enderecoCidade ?? '') || e.referencia !== (p.enderecoReferencia ?? ''))) t.push('Endereço')
    const trocoNovo = escolhaPag === 'dinheiro' && trocoTxt.trim() ? Number(trocoTxt.replace(',', '.')) : null
    if (escolhaPag && (escolhaPag !== pagAtual?.escolha || (trocoNovo ?? null) !== (pagAtual?.trocoPara ?? null))) t.push(`Pagamento: ${ROTULO_ESCOLHA[escolhaPag]}`)
    return t
  }, [linhas, novas, endereco, escolhaPag, trocoTxt, p, pagAtual])

  async function salvar(extra: { escolha?: 'estorno_parcial' | 'diferenca_entrega' | 'diferenca_pix'; aprovacao?: AprovacaoDada } = {}) {
    if (salvando) return
    setSalvando(true); setErro(null); setErroPin(null)
    const trocoNovo = escolhaPag === 'dinheiro' && trocoTxt.trim() ? Number(trocoTxt.replace(',', '.')) : null
    const pagMudou = escolhaPag && (escolhaPag !== pagAtual?.escolha || (trocoNovo ?? null) !== (pagAtual?.trocoPara ?? null))
    const corpo = {
      itens: {
        adicionar: novas.map((n) => n.entrada),
        remover: linhas.filter((l) => l.removida).map((l) => l.id),
        quantidade: linhas.filter((l) => !l.removida && l.quantidade !== l.quantidadeOriginal).map((l) => ({ itemId: l.id, quantidade: l.quantidade })),
        observacao: linhas.filter((l) => !l.removida && l.observacao.trim() !== l.observacaoOriginal.trim()).map((l) => ({ itemId: l.id, observacao: l.observacao.trim() })),
      },
      ...(p.tipo === 'entrega' ? { endereco } : {}),
      ...(pagMudou && p.canal !== 'mesa' ? { pagamento: { escolha: escolhaPag, trocoPara: trocoNovo } } : {}),
      ...(extra.escolha ? { pagoOnline: { escolha: extra.escolha, aprovacao: extra.aprovacao } } : {}),
      reimprimir,
    }
    const r = await fetch(`/api/admin/pedidos/${p.id}/editar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null)
    const j = (await r?.json().catch(() => ({}))) as { error?: string; codigo?: string; precisa?: 'estorno_parcial' | 'diferenca_entrega'; pixOnline?: boolean; numero?: number; total?: number; mudancas?: string[] }
    setSalvando(false)
    if (!r) return setErro('Sem conexão com o servidor.')
    if (r.ok) { onSalvo({ numero: j.numero!, total: j.total!, mudancas: j.mudancas ?? [] }); return }
    if (j.codigo === 'pago_online' && j.precisa) { setPagoOnline({ precisa: j.precisa, texto: j.error ?? '', pixOnline: j.pixOnline === true }); return }
    if (j.codigo === 'aprovacao_necessaria') { setPagoOnline({ precisa: 'estorno_parcial', texto: j.error ?? '' }); return }
    if (extra.aprovacao) { setErroPin(j.error ?? 'Não aprovado.'); return }
    setErro(j.error ?? 'Não foi possível salvar.')
  }

  const temMudanca = mudancasPrevia.length > 0
  return (
    <ModalCentral aberto onFechar={onFechar} titulo={`Editar pedido #${p.numero}`} subtitulo={p.clienteNome || undefined} largura={640} testid="editar-pedido" classeCorpo="px-0">
      {!editavel.ok ? (
        <p className="m-5 flex items-start gap-2 rounded-[2px] border border-[#FCD34D] bg-[#FEF3C7] px-3 py-2.5 text-[13px] font-medium text-[#92400E]" data-testid="editar-bloqueado"><AlertTriangle className="mt-[2px] h-4 w-4 flex-shrink-0" aria-hidden /> {editavel.texto}</p>
      ) : (
        <>
          <div className="flex border-b border-[#E5E7EB] px-3" role="tablist">
            <button type="button" role="tab" aria-selected={aba === 'itens'} className={ABA(aba === 'itens')} onClick={() => setAba('itens')} data-testid="editar-aba-itens">Itens</button>
            {p.tipo === 'entrega' && <button type="button" role="tab" aria-selected={aba === 'endereco'} className={ABA(aba === 'endereco')} onClick={() => setAba('endereco')} data-testid="editar-aba-endereco">Endereço</button>}
            {p.canal !== 'mesa' && !(p.pago && p.pagamentoOnline) && <button type="button" role="tab" aria-selected={aba === 'pagamento'} className={ABA(aba === 'pagamento')} onClick={() => setAba('pagamento')} data-testid="editar-aba-pagamento">Pagamento</button>}
          </div>

          <div className="px-4 py-3 sm:px-5">
            {aba === 'itens' && (
              <div className="space-y-2" data-testid="editar-itens">
                {linhas.map((l) => (
                  <div key={l.id} className={`rounded-[2px] border px-3 py-2 ${l.removida ? 'border-[#FCA5A5] bg-[#FEF2F2]' : 'border-[#E5E7EB] bg-white'}`} data-testid={`editar-linha-${l.id}`}>
                    <div className="flex items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-[13.5px] font-semibold ${l.removida ? 'text-[#B91C1C] line-through' : 'text-[#1F2937]'}`}>{l.nome}{l.tamanhoNome ? ` · ${l.tamanhoNome}` : ''}</span>
                      <span className="text-[12.5px] tabular-nums text-[#6B7280]">{formatarReal(l.precoUnitario)}</span>
                      {!l.removida && (
                        <span className="inline-flex items-center rounded-[2px] border border-[#D1D5DB]">
                          <button type="button" className="grid h-[30px] w-[30px] place-items-center hover:bg-[#E5E7EB]" aria-label="Menos um" onClick={() => setLinhas((prev) => prev.map((x) => (x.id === l.id ? (x.quantidade <= 1 ? { ...x, removida: true } : { ...x, quantidade: x.quantidade - 1 }) : x)))} data-testid="editar-menos"><Minus className="h-3.5 w-3.5" /></button>
                          <span className="w-[28px] text-center text-[13px] font-semibold tabular-nums">{l.quantidade}</span>
                          <button type="button" className="grid h-[30px] w-[30px] place-items-center hover:bg-[#E5E7EB]" aria-label="Mais um" onClick={() => setLinhas((prev) => prev.map((x) => (x.id === l.id ? { ...x, quantidade: Math.min(999, x.quantidade + 1) } : x)))} data-testid="editar-mais"><Plus className="h-3.5 w-3.5" /></button>
                        </span>
                      )}
                      <button type="button" className={`grid h-[30px] w-[30px] place-items-center rounded-[2px] ${l.removida ? 'text-[#15803D] hover:bg-[#DCFCE7]' : 'text-[#B91C1C] hover:bg-[#FEE2E2]'}`} aria-label={l.removida ? 'Desfazer remoção' : 'Remover item'} title={l.removida ? 'Desfazer' : 'Remover'} onClick={() => setLinhas((prev) => prev.map((x) => (x.id === l.id ? { ...x, removida: !x.removida, quantidade: x.removida ? x.quantidadeOriginal : x.quantidade } : x)))} data-testid="editar-remover">{l.removida ? <Plus className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}</button>
                    </div>
                    {!l.removida && <input value={l.observacao} onChange={(e) => setLinhas((prev) => prev.map((x) => (x.id === l.id ? { ...x, observacao: e.target.value.slice(0, 300) } : x)))} placeholder="Observação do item (ex.: sem cebola)" className={`${CAMPO} mt-1.5 h-[32px] text-[12.5px]`} data-testid="editar-obs" />}
                  </div>
                ))}
                {novas.map((n) => (
                  <div key={n.uid} className="rounded-[2px] border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2" data-testid="editar-nova">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[#15803D]">+ {n.entrada.quantidade}× {n.item.nome}</span>
                      <span className="text-[12.5px] tabular-nums text-[#6B7280]">{formatarReal(n.precoUnitario)}</span>
                      <button type="button" className="grid h-[30px] w-[30px] place-items-center rounded-[2px] text-[#B91C1C] hover:bg-[#FEE2E2]" aria-label="Tirar" onClick={() => setNovas((prev) => prev.filter((x) => x.uid !== n.uid))}><Trash2 className="h-4 w-4" /></button>
                    </div>
                    {(n.descricao || n.entrada.observacao) && <p className="mt-0.5 text-[12px] text-[#4B5563]">{[n.descricao, n.entrada.observacao && `obs.: ${n.entrada.observacao}`].filter(Boolean).join(' · ')}</p>}
                  </div>
                ))}
                {adicionando ? (
                  <div className="rounded-[2px] border border-[#E5E7EB] p-2" data-testid="editar-adicionar">
                    <label className="flex h-[36px] items-center gap-2 rounded-[2px] border border-[#D1D5DB] bg-white px-2.5"><Search className="h-4 w-4 text-[#9CA3AF]" aria-hidden /><input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no cardápio…" className="w-full border-0 bg-transparent p-0 text-[13px] outline-none" data-testid="editar-busca" /></label>
                    <div className="mt-2 max-h-[240px] overflow-y-auto">
                      {!catalogo ? <p className="px-2 py-3 text-[12.5px] text-[#6B7280]">Carregando o cardápio…</p> : filtrados.length === 0 ? <p className="px-2 py-3 text-[12.5px] text-[#6B7280]">Nada encontrado.</p> : filtrados.map((i) => (
                        <button key={i.id} type="button" onClick={() => escolherItem(i)} className="flex w-full items-center justify-between gap-2 rounded-[2px] px-2 py-2 text-left hover:bg-[#F3F4F6]" data-testid={`editar-item-${i.id}`}>
                          <span className="min-w-0 truncate text-[13px] font-medium text-[#1F2937]">{i.nome}</span>
                          <span className="text-[12.5px] tabular-nums text-[#6B7280]">{formatarReal(i.promocaoPreco ?? i.preco)}</span>
                        </button>
                      ))}
                    </div>
                    <button type="button" className={`${SECUNDARIO} mt-2`} onClick={() => { setAdicionando(false); setBusca('') }}>Fechar</button>
                  </div>
                ) : (
                  <button type="button" className={SECUNDARIO} onClick={() => setAdicionando(true)} data-testid="editar-adicionar-item"><Plus className="h-4 w-4" aria-hidden /> Adicionar item</button>
                )}
              </div>
            )}

            {aba === 'endereco' && (
              <div className="grid grid-cols-2 gap-2" data-testid="editar-endereco">
                <label className="col-span-2 text-[12px] font-semibold text-[#374151]">Rua<input value={endereco.rua} onChange={(e) => setEndereco({ ...endereco, rua: e.target.value })} className={`${CAMPO} mt-1`} data-testid="editar-rua" /></label>
                <label className="text-[12px] font-semibold text-[#374151]">Número<input value={endereco.numero} onChange={(e) => setEndereco({ ...endereco, numero: e.target.value })} className={`${CAMPO} mt-1`} data-testid="editar-numero" /></label>
                <label className="text-[12px] font-semibold text-[#374151]">Complemento<input value={endereco.complemento} onChange={(e) => setEndereco({ ...endereco, complemento: e.target.value })} className={`${CAMPO} mt-1`} /></label>
                <label className="text-[12px] font-semibold text-[#374151]">Bairro<input value={endereco.bairro} onChange={(e) => setEndereco({ ...endereco, bairro: e.target.value })} className={`${CAMPO} mt-1`} data-testid="editar-bairro" /></label>
                <label className="text-[12px] font-semibold text-[#374151]">CEP<input value={endereco.cep} onChange={(e) => setEndereco({ ...endereco, cep: e.target.value.replace(/\D/g, '').slice(0, 8) })} inputMode="numeric" className={`${CAMPO} mt-1`} /></label>
                <label className="text-[12px] font-semibold text-[#374151]">Cidade<input value={endereco.cidade} onChange={(e) => setEndereco({ ...endereco, cidade: e.target.value })} className={`${CAMPO} mt-1`} /></label>
                <label className="text-[12px] font-semibold text-[#374151]">Referência<input value={endereco.referencia} onChange={(e) => setEndereco({ ...endereco, referencia: e.target.value })} className={`${CAMPO} mt-1`} /></label>
                <p className="col-span-2 text-[12px] text-[#6B7280]">A taxa de entrega é recalculada pela regra da loja ao salvar; endereço fora da área é recusado.</p>
              </div>
            )}

            {aba === 'pagamento' && (
              <div className="space-y-2" data-testid="editar-pagamento">
                <div className="grid grid-cols-2 gap-2">
                  {ESCOLHAS_PDV.map((f) => (
                    <button key={f} type="button" aria-pressed={escolhaPag === f} onClick={() => { setEscolhaPag(f); if (f !== 'dinheiro') setTrocoTxt('') }} className={`h-[40px] rounded-[2px] border px-2 text-[13px] font-semibold ${escolhaPag === f ? 'border-[#0688D4] bg-[#E0F2FE] text-[#0369A1]' : 'border-[#D1D5DB] bg-white text-[#1F2937]'}`} data-testid={`editar-pag-${f}`}>{ROTULO_ESCOLHA[f]}</button>
                  ))}
                </div>
                {escolhaPag === 'dinheiro' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] text-[#6B7280]">Troco para</span>
                    {atalhosTroco(totalPrevia).map((v) => <button key={v} type="button" onClick={() => setTrocoTxt(String(v))} className="h-[32px] rounded-[2px] border border-[#D1D5DB] bg-white px-2.5 text-[12.5px] font-semibold">R$ {v}</button>)}
                    <input inputMode="decimal" placeholder="sem troco" value={trocoTxt} onChange={(e) => setTrocoTxt(e.target.value.replace(/[^\d.,]/g, '').slice(0, 9))} className={`${CAMPO} w-[110px]`} data-testid="editar-troco" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Rodapé: prévia, decisão de pago online, reimprimir, salvar */}
          <div className="space-y-2 border-t border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 sm:px-5" data-testid="editar-rodape">
            <div className="flex items-start justify-between gap-3 text-[12.5px]">
              <span className="min-w-0 text-[#4B5563]">{temMudanca ? mudancasPrevia.join(' · ') : 'Nenhuma mudança ainda.'}</span>
              <span className="flex-shrink-0 text-right">Novo total (prévia) <b className="tabular-nums text-[#15803D]" data-testid="editar-total-previa">{formatarReal(totalPrevia)}</b></span>
            </div>
            {p.pago && p.pagamentoOnline && <p className="text-[12px] text-[#6B7280]">Pago online: se o total mudar, o servidor pede o estorno parcial (PIN) ou como receber a diferença (Pix no WhatsApp ou na entrega).</p>}
            {pagoOnline && (
              <div className="rounded-[2px] border border-[#FCD34D] bg-[#FEF3C7] p-3 text-[12.5px] text-[#92400E]" data-testid="editar-pago-online">
                <p className="font-semibold">{pagoOnline.texto}</p>
                {pagoOnline.precisa === 'diferenca_entrega' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {/* Fase 3 (19/10): Pix só da diferença pelo WhatsApp (só com o Pix online da loja ativo). */}
                    {pagoOnline.pixOnline && <button type="button" className={PRIMARIO} disabled={salvando} onClick={() => void salvar({ escolha: 'diferenca_pix' })} data-testid="editar-diferenca-pix">Cobrar por Pix no WhatsApp e salvar</button>}
                    <button type="button" className={pagoOnline.pixOnline ? SECUNDARIO : PRIMARIO} disabled={salvando} onClick={() => void salvar({ escolha: 'diferenca_entrega' })} data-testid="editar-diferenca-entrega">Receber a diferença na entrega e salvar</button>
                  </div>
                ) : (
                  <div className="mt-2 rounded-[2px] bg-white p-2 text-[#1F2937]">
                    <AprovacaoPin titulo="Estorno parcial pelo Mercado Pago — PIN de um gerente" erro={erroPin} ocupado={salvando} onCancelar={() => setPagoOnline(null)} onConfirmar={(a) => void salvar({ escolha: 'estorno_parcial', aprovacao: a })} />
                  </div>
                )}
              </div>
            )}
            {erro && <p className="text-[12.5px] font-medium text-[#B91C1C]" data-testid="editar-erro">{erro}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[12.5px] text-[#1F2937]"><input type="checkbox" checked={reimprimir} onChange={(e) => setReimprimir(e.target.checked)} data-testid="editar-reimprimir" /> Reimprimir comanda</label>
              <div className="flex gap-2">
                <button type="button" className={SECUNDARIO} onClick={onFechar} disabled={salvando}>Cancelar</button>
                <button type="button" className={PRIMARIO} disabled={salvando || !temMudanca || !!pagoOnline} onClick={() => void salvar()} data-testid="editar-salvar" style={{ backgroundColor: AZUL }}>{salvando ? 'Salvando…' : 'Salvar alterações'}</button>
              </div>
            </div>
          </div>
        </>
      )}
      {seletor && catalogo && (
        <ConfigurarItem state={seletor} catalogo={{ tamanhosPizza: catalogo.tamanhosPizza, bordasPizza: catalogo.bordasPizza, massasPizza: catalogo.massasPizza, regraPizza: catalogo.regraPizza }}
          onChange={(patch) => setSeletor((prev) => (prev ? { ...prev, ...patch } : prev))} onCancel={() => setSeletor(null)} onConfirm={(linha, quantidade) => adicionarDireto(seletor.item, linha, quantidade)} />
      )}
    </ModalCentral>
  )
}
