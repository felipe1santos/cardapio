import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarPedidoParaNotificacao, type Pedido, type StatusPedido } from '@/lib/queries/pedidos'

const FORMA_PAGAMENTO_LABEL: Record<Pedido['formaPagamento'], string> = {
  pix: 'Pix',
  cartao: 'Cartão na entrega',
  dinheiro: 'Dinheiro',
}

function brl(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Converte o telefone digitado no checkout para o formato esperado pela Evolution API (DDI + DDD + número, só dígitos). */
export function formatarTelefoneWhatsapp(telefone: string): string | null {
  const digitos = telefone.replace(/\D/g, '')
  if (digitos.length < 10) return null
  return digitos.startsWith('55') ? digitos : `55${digitos}`
}

/** Resumo completo do pedido — enviado na primeira notificação (pedido recebido/aceito). */
export function montarResumoPedido(pedido: Pedido, restauranteNome: string): string {
  const linhas: string[] = []
  linhas.push(`✅ *Pedido #${pedido.numero} confirmado!*`)
  if (restauranteNome) linhas.push(`_${restauranteNome}_`)
  linhas.push('')
  linhas.push('🛍️ *Itens:*')
  for (const item of pedido.itens) {
    linhas.push(`${item.quantidade}x ${item.nome}`)
    for (const c of item.complementos) linhas.push(`   + ${c.nome}`)
    if (item.observacao.trim()) linhas.push(`   _obs: ${item.observacao.trim()}_`)
  }
  linhas.push('')
  linhas.push(`*Subtotal:* ${brl(pedido.subtotal)}`)
  if (pedido.tipo === 'entrega') linhas.push(`*Taxa de entrega:* ${brl(pedido.taxaEntrega)}`)
  linhas.push(`*Total: ${brl(pedido.total)}*`)
  linhas.push('')

  let pagamento = `💳 *Pagamento:* ${FORMA_PAGAMENTO_LABEL[pedido.formaPagamento]}`
  if (pedido.formaPagamento === 'dinheiro' && pedido.trocoPara) pagamento += ` (troco para ${brl(pedido.trocoPara)})`
  linhas.push(pagamento)

  if (pedido.tipo === 'retirada') {
    linhas.push('🏠 *Retirada no balcão*')
  } else {
    const endereco = [
      `${pedido.enderecoRua}, ${pedido.enderecoNumero}`,
      pedido.enderecoComplemento,
      pedido.enderecoBairro,
    ].filter(Boolean).join(' - ')
    linhas.push(`📍 *Entrega:* ${endereco}`)
  }

  linhas.push('')
  linhas.push('Vamos te avisando por aqui a cada etapa do seu pedido 🙌')
  return linhas.join('\n')
}

/** Mensagens curtas de atualização de status (preparando, pronto, saiu para entrega). */
export function montarMensagemStatus(pedido: Pedido, status: StatusPedido): string | null {
  switch (status) {
    case 'preparando':
      return `👨‍🍳 Seu pedido *#${pedido.numero}* está sendo *preparado*!`
    case 'pronto':
      return pedido.tipo === 'retirada'
        ? `✅ Seu pedido *#${pedido.numero}* está *pronto* para retirada!`
        : `✅ Seu pedido *#${pedido.numero}* está *pronto* e logo sairá para entrega!`
    case 'em_rota':
      return `🛵 Seu pedido *#${pedido.numero}* *saiu para entrega*! Chega rapidinho 🚀`
    default:
      return null
  }
}

/** Envia uma mensagem de texto via Evolution API. Falha silenciosamente (best-effort) se não configurada. */
export async function enviarWhatsapp(numero: string, texto: string): Promise<void> {
  const url = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_INSTANCE
  if (!url || !apiKey || !instance) {
    console.warn('[whatsapp] EVOLUTION_API_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCE não configurados — notificação não enviada.')
    return
  }

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/message/sendText/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ number: numero, text: texto }),
    })
    if (!res.ok) console.error('[whatsapp] Evolution API respondeu', res.status, await res.text())
  } catch (err) {
    console.error('[whatsapp] falha ao enviar mensagem', err)
  }
}

/** Busca o pedido, monta a mensagem apropriada para o status e envia via WhatsApp. Best-effort. */
export async function notificarPedido(admin: SupabaseClient, pedidoId: string, status: StatusPedido): Promise<void> {
  const dados = await buscarPedidoParaNotificacao(admin, pedidoId)
  if (!dados) return

  const { pedido, restauranteNome } = dados
  const numero = formatarTelefoneWhatsapp(pedido.clienteTelefone)
  if (!numero) return

  const texto = status === 'recebido'
    ? montarResumoPedido(pedido, restauranteNome)
    : montarMensagemStatus(pedido, status)
  if (!texto) return

  await enviarWhatsapp(numero, texto)
}
