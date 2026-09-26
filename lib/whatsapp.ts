import type { SupabaseClient } from '@supabase/supabase-js'
import { telefoneWhatsapp } from '@/lib/telefone-br'
import { buscarPedidoParaNotificacao, type Pedido, type StatusPedido } from '@/lib/queries/pedidos'
import { provedorAtual, logFalhaEnvio } from '@/lib/mensageria/provedor'
import { enfileirar, processarFila, estadoDoEnvio } from '@/lib/mensageria/fila'

const FORMA_PAGAMENTO_LABEL: Record<Pedido['formaPagamento'], string> = {
  pix: 'Pix',
  cartao: 'Cartão na entrega',
  dinheiro: 'Dinheiro',
}

function brl(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Telefone no formato da Evolution API (DDI + DDD + número, só dígitos).
 *
 * A regra mora em lib/telefone-br.ts: ela decide pelo COMPRIMENTO, e não pelo
 * prefixo, porque "começa com 55" também é o DDD de Santa Maria/RS.
 */
export function formatarTelefoneWhatsapp(telefone: string): string | null {
  return telefoneWhatsapp(telefone)
}

/** Resumo completo do pedido — enviado quando o pedido é ACEITO (recebido → preparando). */
export function montarResumoPedido(pedido: Pedido, restauranteNome: string): string {
  const linhas: string[] = []
  linhas.push(`✅ *Pedido #${pedido.numero} aceito!*`)
  if (restauranteNome) linhas.push(`_${restauranteNome} já está preparando seu pedido_`)
  linhas.push('')
  linhas.push('```')
  linhas.push(`PEDIDO #${pedido.numero}`)
  linhas.push('```')
  linhas.push('')
  linhas.push('*Itens:*')
  for (const item of pedido.itens) {
    const variacao = [item.tamanhoNome, item.saborNome].filter(Boolean).join(' - ')
    linhas.push(`*${item.quantidade}x ${item.nome}${variacao ? ` (${variacao})` : ''} — ${brl(item.precoUnitario)}*`)
    if (item.bordaNome) linhas.push(`   + Borda: ${item.bordaNome}`)
    if (item.massaNome) linhas.push(`   + Massa: ${item.massaNome}`)
    for (const c of item.complementos) linhas.push(`   + ${c.nome} (+${brl(c.preco)})`)
    if (item.observacao.trim()) linhas.push(`   _obs: ${item.observacao.trim()}_`)
  }
  linhas.push('')
  linhas.push(`*Subtotal: ${brl(pedido.subtotal)}*`)
  if (pedido.desconto > 0) linhas.push(`*Desconto: -${brl(pedido.desconto)}*`)
  if (pedido.tipo === 'entrega') linhas.push(`*Taxa de entrega: ${brl(pedido.taxaEntrega)}*`)
  linhas.push('```')
  linhas.push(`TOTAL: ${brl(pedido.total)}`)
  linhas.push('```')
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

/** Mensagens curtas de atualização de status (recebido, pronto, saiu para entrega). */
export function montarMensagemStatus(pedido: Pedido, status: StatusPedido): string | null {
  switch (status) {
    case 'recebido':
      return `📥 Recebemos seu pedido *#${pedido.numero}*! Aguarde a confirmação da loja 🙌`
    case 'pronto':
      return pedido.tipo === 'retirada'
        ? `✅ Seu pedido *#${pedido.numero}* está *pronto* para retirada!`
        : `✅ Seu pedido *#${pedido.numero}* está *pronto* e logo sairá para entrega!`
    case 'em_rota':
      return `🛵 Seu pedido *#${pedido.numero}* *saiu para entrega*! Chega rapidinho 🚀`
    case 'entregue':
      return `🎉 Pedido *#${pedido.numero}* entregue! Bom apetite 😋`
    default:
      return null
  }
}

/**
 * Envio direto (sem fila) pela interface de provedor — usado por campanhas, fidelidade e
 * código de verificação do checkout, que têm controle próprio. Log sem número completo
 * nem conteúdo (lib/mensageria). Os avisos de etapa do pedido NÃO passam por aqui: vão
 * pela fila, com idempotência (`notificarPedido`).
 */
export async function enviarWhatsapp(numero: string, texto: string, instance: string): Promise<boolean> {
  const r = await provedorAtual().enviarTexto(instance, numero, texto)
  if (!r.ok) logFalhaEnvio('texto', numero, r.erro)
  return r.ok
}

/**
 * O que aconteceu com o aviso. Os chamadores antigos ignoram o retorno; a saída
 * sem entregador usa para dizer ao operador se o cliente foi mesmo avisado.
 */
export type ResultadoNotificacao = 'enviada' | 'falhou' | 'sem_whatsapp' | 'sem_telefone' | 'sem_pedido' | 'sem_mensagem'

/**
 * Aviso de etapa do pedido (recebido, aceito, pronto, saiu, entregue), com os mesmos
 * textos de sempre, agora pela FILA (0102): chave `pedido:<id>:<etapa>` única por loja —
 * duplo clique, Kanban e cozinha ao mesmo tempo ou chamada repetida geram UM envio só.
 * Falha transitória do provedor volta sozinha para a fila com espera crescente (cron
 * /api/cron/whatsapp); aqui a tentativa é imediata.
 */
export async function notificarPedido(admin: SupabaseClient, pedidoId: string, status: StatusPedido): Promise<ResultadoNotificacao> {
  const dados = await buscarPedidoParaNotificacao(admin, pedidoId)
  if (!dados) return 'sem_pedido'

  const { pedido, restauranteNome, evolutionInstance } = dados
  if (!evolutionInstance) return 'sem_whatsapp'

  const numero = formatarTelefoneWhatsapp(pedido.clienteTelefone)
  if (!numero) return 'sem_telefone'

  const texto = status === 'preparando'
    ? montarResumoPedido(pedido, restauranteNome)
    : montarMensagemStatus(pedido, status)
  if (!texto) return 'sem_mensagem'

  const { data: loja } = await admin.from('pedidos').select('restaurante_id').eq('id', pedidoId).maybeSingle()
  if (!loja) return 'sem_pedido'
  const envio = await enfileirar(admin, {
    restauranteId: loja.restaurante_id as string,
    chave: `pedido:${pedidoId}:${status}`,
    tipo: 'aviso_pedido',
    telefone: numero,
    texto,
    pedidoId,
  })
  if (!envio) return 'falhou'
  if (envio.estado === 'enviado') return 'enviada'
  if (envio.novo) await processarFila(admin, { restauranteId: loja.restaurante_id as string, limite: 5 })
  return (await estadoDoEnvio(admin, envio.id)) === 'enviado' ? 'enviada' : 'falhou'
}

/** Envia imagem com legenda (campanhas). */
export async function enviarMidia(numero: string, imagemUrl: string, legenda: string, instance: string): Promise<boolean> {
  const r = await provedorAtual().enviarImagem(instance, numero, imagemUrl, legenda)
  if (!r.ok) logFalhaEnvio('imagem', numero, r.erro)
  return r.ok
}

/** Envia áudio PTT (mensagem de voz) — campanhas. */
export async function enviarAudioPtt(numero: string, audioUrl: string, instance: string): Promise<boolean> {
  const r = await provedorAtual().enviarAudio(instance, numero, audioUrl)
  if (!r.ok) logFalhaEnvio('áudio', numero, r.erro)
  return r.ok
}
