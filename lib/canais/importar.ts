import type { SupabaseClient } from '@supabase/supabase-js'
import { avisarPainelPedidoNovo } from '@/lib/push/painel-pedidos'
import { registrarAuditoria } from '@/lib/auditoria'
import type { Canal, ItemExterno, PedidoExterno } from './tipos'

/**
 * Grava o pedido do app como pedido Menuzia (0207). Idempotente por (canal, externo_id): o app pode reentregar o mesmo
 * evento e o cron pode cruzar com o webhook — só o primeiro grava; os outros recebem o pedido já existente.
 *
 * Decisões (19/10): preço e nome vêm do APP (o cliente já viu/pagou lá) — nada é recalculado pelo nosso cardápio;
 * o vínculo com o item Menuzia (canal_itens_vinculo, por externalCode) só preenche `pedido_itens.item_id` para KDS e
 * relatórios. Pago no app → pago = true (pagamento_online = false: não é o Mercado Pago da loja). Entregador do app →
 * entrega_sem_entregador não se aplica: o pedido fica "pronto" até o app levar (statusParaApp manda READY_FOR_PICKUP).
 */
export interface ResultadoImportacao { pedidoId: string; numero: number; novo: boolean; semVinculo: string[] }

export async function importarPedidoExterno(admin: SupabaseClient, restauranteId: string, p: PedidoExterno): Promise<ResultadoImportacao> {
  // 1. já existe?
  const { data: ja } = await admin.from('pedidos_externos').select('pedido_id, pedidos ( numero )').eq('canal', p.canal).eq('externo_id', p.externoId).maybeSingle()
  if (ja?.pedido_id) {
    const numero = Number((ja as unknown as { pedidos?: { numero?: number } | { numero?: number }[] }).pedidos && (Array.isArray((ja as { pedidos?: unknown }).pedidos) ? ((ja as { pedidos: { numero?: number }[] }).pedidos[0]?.numero) : ((ja as { pedidos: { numero?: number } }).pedidos.numero))) || 0
    return { pedidoId: ja.pedido_id as string, numero, novo: false, semVinculo: [] }
  }
  // 2. reserva a chave (quem perder a corrida sai aqui com 23505)
  const { data: reserva, error: eRes } = await admin.from('pedidos_externos').insert({
    restaurante_id: restauranteId, canal: p.canal, externo_id: p.externoId, display_id: p.displayId, status_externo: 'CREATED', bruto: p.bruto ?? null,
  }).select('id').single()
  if (eRes) {
    if (eRes.code === '23505') {
      const { data: outra } = await admin.from('pedidos_externos').select('pedido_id, pedidos ( numero )').eq('canal', p.canal).eq('externo_id', p.externoId).maybeSingle()
      if (outra?.pedido_id) return { pedidoId: outra.pedido_id as string, numero: 0, novo: false, semVinculo: [] }
    }
    throw eRes
  }
  // 3. vínculos de itens (externalCode → item do cardápio)
  const codigos = [...new Set(p.itens.map((i) => i.codigoExterno).filter((c): c is string => !!c))]
  const vinculo = new Map<string, string | null>()
  if (codigos.length) {
    const { data: vs } = await admin.from('canal_itens_vinculo').select('codigo_externo, item_id').eq('restaurante_id', restauranteId).eq('canal', p.canal).in('codigo_externo', codigos)
    for (const v of vs ?? []) vinculo.set(v.codigo_externo as string, (v.item_id as string | null) ?? null)
    // Open Delivery: externalCode é o NOSSO item id quando o cardápio foi exportado por nós.
    const semVinculo = codigos.filter((c) => !vinculo.has(c) && /^[0-9a-f-]{36}$/i.test(c))
    if (semVinculo.length) {
      const { data: nossos } = await admin.from('itens_cardapio').select('id').eq('restaurante_id', restauranteId).in('id', semVinculo)
      for (const n of nossos ?? []) vinculo.set(n.id as string, n.id as string)
    }
    // Registra o que foi visto (a tela de vínculo lista o que ainda não tem item Menuzia).
    await admin.from('canal_itens_vinculo').upsert(codigos.map((c) => ({
      restaurante_id: restauranteId, canal: p.canal, codigo_externo: c, nome_externo: p.itens.find((i) => i.codigoExterno === c)?.nome ?? '', item_id: vinculo.get(c) ?? null, visto_em: new Date().toISOString(),
    })), { onConflict: 'restaurante_id,canal,codigo_externo', ignoreDuplicates: false }).select('codigo_externo')
  }
  // 4. pedido
  const observacao = [p.observacao, `Pedido ${p.canal === 'ifood' ? 'iFood' : p.canal === 'keeta' ? 'Keeta' : '99Food'} #${p.displayId}`, p.entregaPor === 'app' ? 'Entrega pelo entregador do app' : ''].filter(Boolean).join(' · ')
  const linha: Record<string, unknown> = {
    restaurante_id: restauranteId, origem: 'cardapio', canal: 'delivery', origem_canal: p.canal,
    origem_detalhe: { meio: 'app', app: p.canal, externoId: p.externoId, displayId: p.displayId, entregaPor: p.entregaPor, pagamento: p.pagamento.descricao },
    tipo: p.tipo, status: 'recebido',
    cliente_nome: p.cliente.nome.slice(0, 120), cliente_telefone: p.cliente.telefone.slice(0, 20), telefone_verificado: true,
    forma_pagamento: p.pagamento.forma, troco_para: p.pagamento.trocoPara, pago: p.pagamento.prepago, pagamento_online: false,
    subtotal: p.subtotal, taxa_entrega: p.taxaEntrega, desconto: p.desconto, total: p.total,
    observacao: observacao.slice(0, 500), agendado_para: p.agendadoPara,
    endereco_rua: p.endereco?.rua ?? '', endereco_numero: p.endereco?.numero ?? '', endereco_complemento: p.endereco?.complemento ?? '', endereco_bairro: p.endereco?.bairro ?? '',
    endereco_cep: p.endereco?.cep ?? '', endereco_cidade: p.endereco?.cidade ?? '', endereco_referencia: p.endereco?.referencia ?? '',
    entrega_latitude: p.endereco?.latitude ?? null, entrega_longitude: p.endereco?.longitude ?? null,
  }
  const { data: ped, error } = await admin.from('pedidos').insert(linha).select('id, numero').single()
  if (error) {
    await admin.from('pedidos_externos').delete().eq('id', reserva.id)
    throw error
  }
  const itens = p.itens.map((i) => ({
    pedido_id: ped.id, item_id: (i.codigoExterno && vinculo.get(i.codigoExterno)) || null, nome: i.nome.slice(0, 160), preco_unitario: i.precoUnitario, quantidade: i.quantidade,
    observacao: i.observacao.slice(0, 300), complementos: i.complementos.map((c) => ({ nome: c.nome, preco: c.preco, quantidade: c.quantidade })),
  }))
  if (itens.length) {
    const { error: eItens } = await admin.from('pedido_itens').insert(itens)
    if (eItens) console.error('[canais] itens do pedido externo', eItens.message)
  }
  await admin.from('pedidos_externos').update({ pedido_id: ped.id, atualizado_em: new Date().toISOString() }).eq('id', reserva.id)
  await registrarAuditoria(admin, { restauranteId, usuarioNome: 'Sistema', acao: 'canal.pedido_importado', entidade: 'pedido', entidadeId: ped.id as string, dados: { canal: p.canal, externoId: p.externoId, displayId: p.displayId, total: p.total } }).catch(() => null)
  avisarPainelPedidoNovo(admin, restauranteId, { id: ped.id as string, numero: ped.numero as number, canal: p.tipo }).catch(() => null)
  const semVinculo = codigos.filter((c) => !vinculo.get(c))
  return { pedidoId: ped.id as string, numero: ped.numero as number, novo: true, semVinculo }
}

/** O que mudou nos itens de um pedido alterado no app. Casa por nome, um a um (o app não guarda o nosso id de item). Puro. */
export function diferencaDeItens(atuais: { id: string; nome: string; quantidade: number }[], novosDoApp: ItemExterno[]) {
  const restantes = [...novosDoApp]
  const cancelar: string[] = []
  const mudar: { id: string; quantidade: number }[] = []
  for (const a of atuais) {
    const i = restantes.findIndex((n) => n.nome.slice(0, 160) === a.nome)
    if (i < 0) { cancelar.push(a.id); continue }
    const [n] = restantes.splice(i, 1)
    if (n.quantidade !== a.quantidade) mudar.push({ id: a.id, quantidade: n.quantidade })
  }
  return { cancelar, mudar, novos: restantes }
}

/**
 * Pedido alterado no app depois de importado (iFood ORDER_PATCHED, 99Food orderPartialCancel): itens e valores passam a
 * ser os do app. Item que saiu é cancelado (cancelado_em), não apagado: mantém o histórico e o custo. Não mexe em status.
 */
export async function atualizarPedidoPeloApp(admin: SupabaseClient, restauranteId: string, p: PedidoExterno): Promise<boolean> {
  const { data: ext } = await admin.from('pedidos_externos').select('pedido_id').eq('canal', p.canal).eq('externo_id', p.externoId).eq('restaurante_id', restauranteId).maybeSingle()
  const pedidoId = ext?.pedido_id as string | undefined
  if (!pedidoId) return false
  const { data: atuais, error: eItens } = await admin.from('pedido_itens').select('id, nome, quantidade').eq('pedido_id', pedidoId).is('cancelado_em', null)
  if (eItens) throw eItens
  const dif = diferencaDeItens((atuais ?? []) as { id: string; nome: string; quantidade: number }[], p.itens)
  if (dif.cancelar.length) {
    const { error } = await admin.from('pedido_itens').update({ cancelado_em: new Date().toISOString(), cancelado_motivo: 'Alterado no app', cancelado_por_nome: 'Sistema' }).in('id', dif.cancelar)
    if (error) throw error
  }
  for (const m of dif.mudar) {
    const { error } = await admin.from('pedido_itens').update({ quantidade: m.quantidade }).eq('id', m.id)
    if (error) throw error
  }
  if (dif.novos.length) {
    const { error } = await admin.from('pedido_itens').insert(dif.novos.map((i) => ({
      pedido_id: pedidoId, item_id: null, nome: i.nome.slice(0, 160), preco_unitario: i.precoUnitario, quantidade: i.quantidade, observacao: i.observacao.slice(0, 300), complementos: i.complementos,
    })))
    if (error) throw error
  }
  const { data: ped } = await admin.from('pedidos').select('observacao').eq('id', pedidoId).maybeSingle()
  const aviso = 'Pedido alterado no app'
  const obs = String(ped?.observacao ?? '')
  const { error } = await admin.from('pedidos').update({
    subtotal: p.subtotal, taxa_entrega: p.taxaEntrega, desconto: p.desconto, total: p.total,
    observacao: (obs.includes(aviso) ? obs : [obs, aviso].filter(Boolean).join(' · ')).slice(0, 500),
  }).eq('id', pedidoId).eq('restaurante_id', restauranteId)
  if (error) throw error
  await registrarAuditoria(admin, { restauranteId, usuarioNome: 'Sistema', acao: 'canal.pedido_alterado', entidade: 'pedido', entidadeId: pedidoId, dados: { canal: p.canal, externoId: p.externoId, total: p.total, cancelados: dif.cancelar.length, mudados: dif.mudar.length, novos: dif.novos.length } }).catch(() => null)
  return true
}

/** Pedido externo ligado a um pedido Menuzia (para a sincronização de status e para o cancelamento vindo do app). */
export async function externoDoPedido(admin: SupabaseClient, pedidoId: string): Promise<{ id: string; canal: Canal; externoId: string; statusEnviado: string | null } | null> {
  const { data } = await admin.from('pedidos_externos').select('id, canal, externo_id, status_enviado').eq('pedido_id', pedidoId).maybeSingle()
  return data ? { id: data.id as string, canal: data.canal as Canal, externoId: data.externo_id as string, statusEnviado: (data.status_enviado as string | null) ?? null } : null
}

/** O app cancelou (CANCELLED): cancela o pedido aqui, sem mexer em pagamento (foi no app). Uma vez só. */
export async function cancelarPeloApp(admin: SupabaseClient, restauranteId: string, canal: Canal, externoId: string, motivo: string): Promise<boolean> {
  const { data: ext } = await admin.from('pedidos_externos').select('pedido_id').eq('canal', canal).eq('externo_id', externoId).maybeSingle()
  if (!ext?.pedido_id) return false
  const { data: mudou } = await admin.from('pedidos').update({
    status: 'cancelado', cancelado_motivo: 'outro', cancelado_observacao: `Cancelado no app (${motivo || 'sem motivo informado'})`.slice(0, 300), cancelado_por: 'sistema', cancelado_em: new Date().toISOString(), reimprimir: false,
  }).eq('id', ext.pedido_id).eq('restaurante_id', restauranteId).not('status', 'in', '("cancelado","entregue")').select('id').maybeSingle()
  await admin.from('pedidos_externos').update({ status_externo: 'CANCELLED', status_enviado: 'cancelado', atualizado_em: new Date().toISOString() }).eq('canal', canal).eq('externo_id', externoId)
  return !!mudou
}
