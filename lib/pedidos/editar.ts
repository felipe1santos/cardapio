import type { SupabaseClient } from '@supabase/supabase-js'
import { canalDoPedido, precificarLinhas, type LinhaPedidoGravada, type NovoPedidoItemInput } from '@/lib/queries/pedidos'
import { resolverFrete, type EnderecoFrete } from '@/lib/frete'
import { calcularDesconto } from '@/lib/fidelidade-regras'
import { gravarCoordenadasDoPedido } from '@/lib/mapa/coordenadas-pedidos'
import { registrarAuditoria } from '@/lib/auditoria'
import { devolverPix } from '@/lib/pagamentos/pix-online'
import type { Aprovacao } from '@/lib/financeiro/caixa'
import { enviarWhatsapp, formatarTelefoneWhatsapp } from '@/lib/whatsapp'
import { decidirMensagem, normalizarConfig, renderizar, textoPadraoDaEtapa, tipoAutomatico } from '@/lib/mensagens-automaticas'
import { corridaAtivaDoPedido } from '@/lib/entregas/queries'
import { pedidoEditavel } from '@/lib/pedido-editavel'
import { daPedido, erroPagamentoPdv, lerPagamentoPdv, paraPedido, rotuloForma, type PagamentoPdv } from '@/lib/pdv-pagamento'
import {
  ajustarTroco, aplicarMudancasItens, decisaoPagoOnline, textoClienteAlterado, totalDoPedido,
  type AlteracaoPedido, type EdicaoRegistro, type EscolhaPagoOnline, type MudancasItens,
} from '@/lib/pedido-edicao-regras'

/**
 * Edição de um pedido já criado (18/10/2026) — UMA rota para o painel (lápis), para "Aplicar" uma solicitação do
 * cliente e, depois, para a IA. Server-only (service_role). Regras em lib/pedido-editavel.ts e
 * lib/pedido-edicao-regras.ts; decisões em docs/superpowers/specs/2026-10-18-edicao-pedido-decisoes.md.
 *
 *  1. editável? (status + motoboy + Lalamove + saiu p/ entrega)          — lib/pedido-editavel
 *  2. itens novos reprecificados pelo servidor (precificarLinhas, o da vitrine)
 *  3. endereço novo → frete pela mesma regra (resolverFrete) + frete grátis acima de X; fora da área = erro
 *  4. cupom: pedido mínimo revalidado; abaixo dele o cupom sai (uso devolvido) e vira uma mudança
 *  5. total, troco; pago online → estorno parcial / diferença na entrega (decisaoPagoOnline), senão bloqueia
 *  6. grava: itens (cancelado_em / qtd / obs / novos), pedido (totais, endereço, pagamento, histórico `edicoes` com as
 *     alterações ESTRUTURADAS, reimprimir), auditoria, WhatsApp ao cliente (mensagem automática "alterado").
 *     A observação do cliente NÃO é tocada (Bloco A, 19/10): o bloco "PEDIDO ALTERADO" da comanda é gerado do
 *     histórico na hora de imprimir (lib/queries/impressao.ts); KDS, painel e card leem `edicoes`.
 */
export interface EdicaoPedido {
  itens?: MudancasItens & { adicionar?: NovoPedidoItemInput[] }
  endereco?: { rua: string; numero: string; complemento?: string; bairro: string; cep?: string; cidade?: string; referencia?: string }
  pagamento?: PagamentoPdv
  pagoOnline?: { escolha: EscolhaPagoOnline; aprovacao?: Aprovacao }
  reimprimir?: boolean
}

export class EdicaoError extends Error {
  readonly status: number
  readonly codigo?: string
  readonly precisa?: EscolhaPagoOnline
  constructor(mensagem: string, status = 400, extra: { codigo?: string; precisa?: EscolhaPagoOnline } = {}) { super(mensagem); this.name = 'EdicaoError'; this.status = status; this.codigo = extra.codigo; this.precisa = extra.precisa }
}

interface Linha { id: string; item_id: string | null; nome: string; preco_unitario: number; quantidade: number; observacao: string; tamanho_nome: string; cancelado_em: string | null }
const c2 = (v: number) => Math.round(v * 100) / 100

export async function editarPedido(admin: SupabaseClient, p: {
  restauranteId: string
  pedidoId: string
  por: { id: string | null; nome: string }
  origem: 'painel' | 'solicitacao' | 'ia'
  /** Solicitação do cliente: por onde ele pediu (robô ou IA) — só para o rótulo do histórico. */
  via?: 'robo' | 'ia' | null
  edicao: EdicaoPedido
}): Promise<{ numero: number; total: number; mudancas: string[]; diferencaAReceber: number | null }> {
  const { restauranteId, pedidoId, edicao } = p
  const { data: ped, error } = await admin.from('pedidos')
    .select('id, numero, status, tipo, canal, origem, origem_canal, entregador_id, saiu_para_entrega_em, cliente_nome, cliente_telefone, forma_pagamento, cartao_tipo, troco_para, pago, pagamento_online, subtotal, taxa_entrega, desconto, total, observacao, edicoes, diferenca_a_receber, cupom_codigo, recompensa_id, agendado_para, pizza_calculo_preco:restaurantes!inner ( pizza_calculo_preco, frete_gratis_acima, nome, mensagens_status, evolution_instance ), endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep, endereco_cidade, endereco_referencia, pedido_itens ( id, item_id, nome, preco_unitario, quantidade, observacao, tamanho_nome, cancelado_em )')
    .eq('id', pedidoId).eq('restaurante_id', restauranteId).maybeSingle()
  if (error) throw error
  if (!ped) throw new EdicaoError('Pedido não encontrado nesta loja.', 404)
  const loja = (Array.isArray(ped.pizza_calculo_preco) ? ped.pizza_calculo_preco[0] : ped.pizza_calculo_preco) as { pizza_calculo_preco: string | null; frete_gratis_acima: number | null; nome: string; mensagens_status: unknown; evolution_instance: string | null } | null

  // 1. editável?
  const corrida = await corridaAtivaDoPedido(admin, pedidoId).catch(() => null)
  const ok = pedidoEditavel({ status: ped.status, canal: ped.canal, entregadorId: ped.entregador_id, saiuParaEntregaEm: ped.saiu_para_entrega_em, origemCanal: ped.origem_canal }, !!corrida)
  if (!ok.ok) throw new EdicaoError(ok.texto, 409, { codigo: ok.motivo })

  const mudancas: string[] = []
  const alteracoes: AlteracaoPedido[] = []
  const atuais = ((ped.pedido_itens ?? []) as Linha[]).filter((i) => !i.cancelado_em).map((i) => ({ id: i.id, nome: i.nome, precoUnitario: Number(i.preco_unitario), quantidade: i.quantidade, observacao: i.observacao ?? '', tamanhoNome: i.tamanho_nome || undefined }))

  // 2. itens novos pelo mesmo preço da vitrine
  let novasLinhas: LinhaPedidoGravada[] = []
  if (edicao.itens?.adicionar?.length) {
    const canal = canalDoPedido({ origem: ped.origem as 'cardapio' | 'pdv', canal: ped.canal as 'delivery' | 'mesa' | 'balcao' })
    try {
      novasLinhas = await precificarLinhas(admin, restauranteId, { itens: edicao.itens.adicionar, origem: 'pdv' }, { referenciaItens: ped.agendado_para ? new Date(ped.agendado_para) : undefined, canal, pizzaCalculoPreco: loja?.pizza_calculo_preco })
    } catch (e) { throw new EdicaoError((e as Error).message, 400) }
  }
  const itens = aplicarMudancasItens(atuais, edicao.itens ?? {}, novasLinhas.map((l) => ({ nome: l.nome, precoUnitario: l.preco_unitario, quantidade: l.quantidade, tamanhoNome: l.tamanho_nome || undefined })))
  mudancas.push(...itens.textos)
  alteracoes.push(...itens.alteracoes)
  const subtotal = itens.subtotal

  // 3. endereço / frete
  let taxaEntrega = Number(ped.taxa_entrega)
  const endereco = edicao.endereco
  const enderecoMudou = !!endereco && (
    endereco.rua !== ped.endereco_rua || endereco.numero !== ped.endereco_numero || (endereco.complemento ?? '') !== (ped.endereco_complemento ?? '') ||
    endereco.bairro !== ped.endereco_bairro || (endereco.cep ?? '') !== (ped.endereco_cep ?? '') || (endereco.cidade ?? '') !== (ped.endereco_cidade ?? '') || (endereco.referencia ?? '') !== (ped.endereco_referencia ?? ''))
  if (ped.tipo === 'entrega' && (enderecoMudou || subtotal !== Number(ped.subtotal))) {
    const alvo: EnderecoFrete = endereco ? { cep: endereco.cep, rua: endereco.rua, numero: endereco.numero, bairro: endereco.bairro, cidade: endereco.cidade } : { cep: ped.endereco_cep ?? undefined, rua: ped.endereco_rua ?? undefined, numero: ped.endereco_numero ?? undefined, bairro: ped.endereco_bairro ?? undefined, cidade: ped.endereco_cidade ?? undefined }
    const frete = await resolverFrete(admin, restauranteId, alvo)
    if (!frete.entregavel) throw new EdicaoError(frete.motivo || 'Endereço fora da área de entrega da loja.', 400, { codigo: 'fora_da_area' })
    let taxa = frete.taxa
    const minimo = loja?.frete_gratis_acima === null || loja?.frete_gratis_acima === undefined ? null : Number(loja.frete_gratis_acima)
    if (taxa > 0 && minimo !== null && minimo > 0 && subtotal >= minimo) taxa = 0
    if (enderecoMudou) {
      const para = `${endereco!.rua}, ${endereco!.numero}${endereco!.bairro ? ` · ${endereco!.bairro}` : ''}`
      const de = `${ped.endereco_rua ?? ''}, ${ped.endereco_numero ?? ''}${ped.endereco_bairro ? ` · ${ped.endereco_bairro}` : ''}`
      mudancas.push(`Endereço: ${para}`); alteracoes.push({ tipo: 'endereco', de, para })
    }
    // Cupom de entrega grátis continua zerando a taxa.
    if (taxa !== taxaEntrega) { alteracoes.push({ tipo: 'taxa', de: taxaEntrega, para: taxa }); taxaEntrega = taxa; mudancas.push(`Taxa de entrega: R$ ${taxa.toFixed(2).replace('.', ',')}`) }
  }

  // 4. cupom: pedido mínimo
  let desconto = Number(ped.desconto ?? 0)
  let cupomRemovido = false
  if (ped.cupom_codigo) {
    const { data: cupom } = await admin.from('cupons').select('id, codigo, tipo, valor, valor_minimo_pedido').eq('restaurante_id', restauranteId).eq('codigo', ped.cupom_codigo).maybeSingle()
    if (cupom) {
      const minimo = cupom.valor_minimo_pedido === null || cupom.valor_minimo_pedido === undefined ? null : Number(cupom.valor_minimo_pedido)
      if (minimo !== null && subtotal < minimo) {
        cupomRemovido = true; desconto = 0
        mudancas.push(`Cupom ${cupom.codigo} removido (pedido mínimo R$ ${minimo.toFixed(2).replace('.', ',')})`)
        alteracoes.push({ tipo: 'cupom', de: String(cupom.codigo), para: null })
      } else {
        const d = calcularDesconto(cupom.tipo, cupom.valor === null ? null : Number(cupom.valor), subtotal, taxaEntrega)
        desconto = d.descontoSubtotal
        if (d.zeraFrete) taxaEntrega = 0
      }
    }
  }

  // 5. total, troco, pagamento, pago online
  const total = totalDoPedido(subtotal, taxaEntrega, desconto)
  let formaPagamento = ped.forma_pagamento as string
  let cartaoTipo = (ped.cartao_tipo as string | null) ?? null
  let trocoPara = ped.troco_para === null ? null : Number(ped.troco_para)
  if (edicao.pagamento) {
    if (ped.pago && ped.pagamento_online) throw new EdicaoError('Pedido pago online: a forma de pagamento não muda.', 409)
    const pg = lerPagamentoPdv(edicao.pagamento)
    if (!pg) throw new EdicaoError('Escolha a forma de pagamento.', 400)
    const erroPg = erroPagamentoPdv(pg, total)
    if (erroPg) throw new EdicaoError(erroPg, 400)
    const novo = paraPedido(pg)
    const antes = daPedido(ped.forma_pagamento as string, cartaoTipo, trocoPara)
    if (novo.forma_pagamento !== formaPagamento || novo.cartao_tipo !== cartaoTipo || (novo.troco_para ?? null) !== (trocoPara ?? null)) {
      const deRotulo = antes ? rotuloForma(ped.forma_pagamento as string, cartaoTipo) : '—'
      const paraRotulo = `${rotuloForma(novo.forma_pagamento, novo.cartao_tipo)}${novo.troco_para ? ` (troco p/ R$ ${novo.troco_para.toFixed(2).replace('.', ',')})` : ''}`
      mudancas.push(`Pagamento: ${deRotulo} → ${paraRotulo}`); alteracoes.push({ tipo: 'pagamento', de: deRotulo, para: paraRotulo })
      formaPagamento = novo.forma_pagamento; cartaoTipo = novo.cartao_tipo; trocoPara = novo.troco_para ?? null
    }
  }
  const troco = ajustarTroco(formaPagamento, ped.pago === true, trocoPara, total)
  trocoPara = troco.trocoPara
  if (troco.texto) { mudancas.push(troco.texto); alteracoes.push({ tipo: 'troco', de: Number(ped.troco_para), para: null }) }

  if (mudancas.length === 0) throw new EdicaoError('Nada mudou no pedido.', 400, { codigo: 'sem_mudanca' })

  const decisao = decisaoPagoOnline({ pago: ped.pago === true, pagamentoOnline: ped.pagamento_online === true, totalAntigo: Number(ped.total), totalNovo: total, escolha: edicao.pagoOnline?.escolha ?? null, jaAReceber: ped.diferenca_a_receber === null ? null : Number(ped.diferenca_a_receber) })
  if (!decisao.ok) throw new EdicaoError(decisao.texto, 409, { codigo: 'pago_online', precisa: decisao.precisa })
  let diferencaAReceber: number | null = ped.diferenca_a_receber === null || ped.diferenca_a_receber === undefined ? null : Number(ped.diferenca_a_receber)
  if (decisao.acao === 'diferenca_entrega') { diferencaAReceber = decisao.valor; mudancas.push(`Diferença de R$ ${decisao.valor.toFixed(2).replace('.', ',')} a receber na entrega`); alteracoes.push({ tipo: 'diferenca', para: decisao.valor }) }
  if (decisao.acao === 'estorno_parcial') {
    if (!edicao.pagoOnline?.aprovacao) throw new EdicaoError('O estorno precisa da aprovação de um gerente (PIN).', 409, { codigo: 'aprovacao_necessaria', precisa: 'estorno_parcial' })
    const { data: pg } = await admin.from('pagamentos_online').select('id').eq('restaurante_id', restauranteId).eq('pedido_id', pedidoId).in('status', ['pago', 'devolvido_parcial']).order('criado_em', { ascending: false }).limit(1).maybeSingle()
    if (!pg) throw new EdicaoError('Pagamento online do pedido não encontrado para estornar.', 409)
    const r = await devolverPix(admin, { restauranteId, pagamentoId: pg.id as string, solicitante: { id: p.por.id ?? '', nome: p.por.nome }, aprovacao: edicao.pagoOnline.aprovacao, motivo: `Edição do pedido #${ped.numero}: ${mudancas.join(' · ')}`.slice(0, 300), valorCentavos: Math.round(decisao.valor * 100) })
    if (!r.ok) throw new EdicaoError(r.erro, r.status, { codigo: 'estorno' })
    mudancas.push(`Estorno de R$ ${decisao.valor.toFixed(2).replace('.', ',')} pelo Mercado Pago`); alteracoes.push({ tipo: 'estorno', para: decisao.valor })
    diferencaAReceber = null
  }
  if (decisao.acao === 'nada' && ped.pago && ped.pagamento_online && diferencaAReceber && c2(total - (Number(ped.total) - diferencaAReceber)) <= 0) diferencaAReceber = null

  // 6. grava
  const agora = new Date().toISOString()
  for (const id of itens.cancelar) {
    const { error: e } = await admin.from('pedido_itens').update({ cancelado_em: agora, cancelado_motivo: 'edicao', cancelado_por_nome: p.por.nome }).eq('id', id).eq('pedido_id', pedidoId)
    if (e) throw e
  }
  for (const a of itens.atualizar) {
    const { error: e } = await admin.from('pedido_itens').update({ ...(a.quantidade !== undefined ? { quantidade: a.quantidade } : {}), ...(a.observacao !== undefined ? { observacao: a.observacao } : {}) }).eq('id', a.id).eq('pedido_id', pedidoId)
    if (e) throw e
  }
  if (novasLinhas.length) {
    // Ids das linhas novas entram no histórico (o card e o painel marcam o item como "adicionado").
    const { data: inseridas, error: e } = await admin.from('pedido_itens').insert(novasLinhas.map((l) => ({ ...l, pedido_id: pedidoId }))).select('id')
    if (e) throw e
    const adicionadas = alteracoes.filter((a): a is Extract<AlteracaoPedido, { tipo: 'item_adicionado' }> => a.tipo === 'item_adicionado')
    ;((inseridas ?? []) as { id: string }[]).forEach((l, i) => { if (adicionadas[i]) adicionadas[i].itemId = l.id })
  }
  if (cupomRemovido && ped.cupom_codigo) {
    const { data: cupom } = await admin.from('cupons').select('id').eq('restaurante_id', restauranteId).eq('codigo', ped.cupom_codigo).maybeSingle()
    if (cupom) {
      await admin.rpc('cupom_devolver_uso', { p_cupom_id: cupom.id, p_restaurante_id: restauranteId }).then(() => {}, () => {})
      await admin.from('cupom_usos').delete().eq('cupom_id', cupom.id).eq('pedido_id', pedidoId).then(() => {}, () => {})
    }
  }
  const registro: EdicaoRegistro = { em: agora, por: p.por.nome, origem: p.origem, ...(p.via ? { via: p.via } : {}), mudancas, alteracoes }
  const edicoes = [...((Array.isArray(ped.edicoes) ? ped.edicoes : []) as EdicaoRegistro[]), registro].slice(-20)
  const patch: Record<string, unknown> = {
    subtotal, taxa_entrega: taxaEntrega, desconto, total, forma_pagamento: formaPagamento, cartao_tipo: cartaoTipo, troco_para: formaPagamento === 'dinheiro' ? trocoPara : null,
    editado_em: agora, editado_por_nome: p.por.nome, edicoes, diferenca_a_receber: diferencaAReceber,
    ...(cupomRemovido ? { cupom_codigo: null } : {}),
    ...(edicao.reimprimir ? { reimprimir: true } : {}),
    ...(enderecoMudou && endereco ? { endereco_rua: endereco.rua, endereco_numero: endereco.numero, endereco_complemento: endereco.complemento ?? '', endereco_bairro: endereco.bairro, endereco_cep: endereco.cep ?? '', endereco_cidade: endereco.cidade ?? '', endereco_referencia: endereco.referencia ?? '', entrega_latitude: null, entrega_longitude: null } : {}),
  }
  // Guarda de status: ninguém despachou no meio do caminho.
  const { data: gravado, error: eGrava } = await admin.from('pedidos').update(patch).eq('id', pedidoId).eq('restaurante_id', restauranteId).in('status', ['recebido', 'preparando', 'pronto']).is('entregador_id', null).select('id')
  if (eGrava) throw eGrava
  if (!gravado?.length) throw new EdicaoError('O pedido mudou de situação enquanto você editava (saiu para entrega). Nada foi alterado.', 409)
  if (enderecoMudou && ped.tipo === 'entrega') void gravarCoordenadasDoPedido(admin, restauranteId, pedidoId)

  await registrarAuditoria(admin, { restauranteId, usuarioId: p.por.id, usuarioNome: p.por.nome, acao: 'pedido.editado', entidade: 'pedido', entidadeId: pedidoId, dados: { numero: ped.numero, origem: p.origem, mudancas, total_antes: Number(ped.total), total_depois: total, reimprimir: !!edicao.reimprimir } }).catch(() => {})

  // WhatsApp ao cliente (mensagem automática "alterado"; respeita a configuração da loja).
  try {
    const numero = formatarTelefoneWhatsapp(ped.cliente_telefone ?? '')
    if (numero && loja?.evolution_instance) {
      const cfg = normalizarConfig(loja.mensagens_status)
      const d = decidirMensagem(cfg, 'alterado', tipoAutomatico(ped.canal ?? 'delivery', ped.tipo))
      if (d.sai) {
        const vars = { nome: (ped.cliente_nome ?? '').trim().split(/\s+/)[0] ?? '', numero: String(ped.numero), loja: loja.nome, tipo: ped.tipo === 'retirada' ? 'retirada' : 'entrega', horario: '', total: `R$ ${total.toFixed(2).replace('.', ',')}`, mudancas: mudancas.map((m) => `• ${m}`).join('\n') }
        const texto = d.texto ? renderizar(d.texto, vars) : (textoPadraoDaEtapa('alterado', vars) ?? textoClienteAlterado(ped.numero, mudancas, total, diferencaAReceber))
        await enviarWhatsapp(numero, texto, loja.evolution_instance, { admin, origem: 'automatico', restauranteId })
      }
    }
  } catch (e) { console.error('[editar pedido] aviso ao cliente:', (e as Error).message) }

  return { numero: ped.numero, total, mudancas, diferencaAReceber }
}
