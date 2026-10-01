import type { SupabaseClient } from '@supabase/supabase-js'
import { telefoneWhatsapp } from '@/lib/telefone-br'
import { buscarPedidoParaNotificacao, type Pedido, type StatusPedido } from '@/lib/queries/pedidos'
import { concluirSaida, registrarSaida } from '@/lib/mensageria/historico'
import { textoAgendado } from '@/lib/agendamento'

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
      // Agendado (0121): confirma o horário escolhido; o resto do fluxo segue igual.
      if (pedido.agendadoPara) {
        const quando = textoAgendado(pedido.agendadoPara)
        const canal = pedido.tipo === 'retirada' ? 'retirada' : 'entrega'
        return `🗓️ Recebemos seu pedido agendado *#${pedido.numero}* para *${quando}* (${canal}). A loja começa a preparar perto do horário 🙌`
      }
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
 * Registro no histórico da central de atendimento (0107): de onde a mensagem saiu.
 * `textoExibido` substitui o texto no histórico quando ele não pode aparecer (código de
 * verificação). Sem `restauranteId`, a loja é achada pela instância.
 */
export interface RegistroHistorico {
  /** Cliente do banco com permissão de servidor (quem chama já tem). */
  admin: SupabaseClient
  origem: 'automatico' | 'disparo'
  restauranteId?: string
  textoExibido?: string
}

async function enviarTextoComId(numero: string, texto: string, instance: string): Promise<{ ok: boolean; id: string | null }> {
  // Suíte local com provedor simulado (as DUAS variáveis; produção não tem nenhuma).
  if (process.env.WHATSAPP_PROVEDOR === 'simulado' && process.env.WHATSAPP_SIMULADO_ARQUIVO) {
    const { provedorAtual } = await import('@/lib/mensageria/provedor')
    const r = await provedorAtual().enviarTexto(instance, numero, texto)
    return { ok: r.ok, id: r.ok ? r.idExterno : null }
  }
  const url = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  if (!url || !apiKey) {
    console.warn('[whatsapp] EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados — notificação não enviada.')
    return { ok: false, id: null }
  }

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/message/sendText/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ number: numero, text: texto }),
      // Sem prazo, uma instância travada segurava a rota /notificar (e o "Salvando…" do
      // painel) até o proxy cortar com 502/504.
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.error('[whatsapp] Evolution API respondeu', res.status, await res.text())
      return { ok: false, id: null }
    }
    // O id da mensagem (key.id) reconhece o eco no webhook; sem ele, o hash do texto.
    const corpo = await res.json().catch(() => null) as { key?: { id?: unknown } } | null
    return { ok: true, id: typeof corpo?.key?.id === 'string' ? corpo.key.id : null }
  } catch (err) {
    console.error('[whatsapp] falha ao enviar mensagem', err)
    return { ok: false, id: null }
  }
}

/** Envia uma mensagem de texto via Evolution API, usando a instância (WhatsApp) do restaurante. Retorna se o envio foi bem-sucedido. */
export async function enviarWhatsapp(numero: string, texto: string, instance: string, registro?: RegistroHistorico): Promise<boolean> {
  let saida: { mensagemId: string } | null = null
  const admin = registro?.admin ?? null
  if (registro && admin) {
    try {
      let restauranteId = registro.restauranteId ?? null
      if (!restauranteId) {
        const { data } = await admin.from('restaurantes').select('id').eq('evolution_instance', instance).maybeSingle()
        restauranteId = (data?.id as string | undefined) ?? null
      }
      if (restauranteId) {
        saida = await registrarSaida(admin, { restauranteId, telefone: numero, texto, textoExibido: registro.textoExibido, origem: registro.origem })
      }
    } catch {
      saida = null // histórico é melhor esforço
    }
  }
  const r = await enviarTextoComId(numero, texto, instance)
  if (saida && admin) {
    await concluirSaida(admin, saida.mensagemId, r.ok, r.id, r.ok ? null : 'falha no envio')
  }
  return r.ok
}

/** Busca o pedido, monta a mensagem apropriada para o status e envia via WhatsApp. Best-effort. */
/**
 * O que aconteceu com o aviso. Os chamadores antigos ignoram o retorno; a saída
 * sem entregador usa para dizer ao operador se o cliente foi mesmo avisado.
 */
export type ResultadoNotificacao = 'enviada' | 'falhou' | 'sem_whatsapp' | 'sem_telefone' | 'sem_pedido' | 'sem_mensagem'

/**
 * Gancho do push (0127). Registrado só no servidor (instrumentation.ts → lib/push/gancho.ts): este
 * arquivo também chega ao navegador (via lib/queries/clientes), e o motor do push usa sharp e
 * web-push, que não existem lá.
 */
type GanchoPushStatus = (admin: SupabaseClient, pedidoId: string, status: StatusPedido) => Promise<unknown>
// Em globalThis: o instrumentation.ts é outro bundle (outra cópia deste módulo) no mesmo processo.
const GANCHO = '__menuziaGanchoPushStatus'
export function registrarGanchoPushStatus(g: GanchoPushStatus) {
  ;(globalThis as Record<string, unknown>)[GANCHO] = g
}
function ganchoPushStatus(admin: SupabaseClient, pedidoId: string, status: StatusPedido): Promise<unknown> {
  const g = (globalThis as Record<string, unknown>)[GANCHO] as GanchoPushStatus | undefined
  return g ? g(admin, pedidoId, status) : Promise.resolve(null)
}

/**
 * Avisa o cliente da mudança de status: WhatsApp (abaixo) e, em paralelo, push do app do
 * cardápio (0127) para quem ativou as notificações. O push nunca muda o resultado do WhatsApp
 * nem derruba o fluxo.
 */
export async function notificarPedido(admin: SupabaseClient, pedidoId: string, status: StatusPedido): Promise<ResultadoNotificacao> {
  const [resultado] = await Promise.all([
    notificarPedidoWhatsapp(admin, pedidoId, status),
    ganchoPushStatus(admin, pedidoId, status).catch((e) => {
      console.error('[push] status do pedido:', (e as Error).message?.slice(0, 160))
      return null
    }),
  ])
  return resultado
}

async function notificarPedidoWhatsapp(admin: SupabaseClient, pedidoId: string, status: StatusPedido): Promise<ResultadoNotificacao> {
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

  return (await enviarWhatsapp(numero, texto, evolutionInstance, { admin, origem: 'automatico' })) ? 'enviada' : 'falhou'
}

/** Envia imagem com legenda (caption) via Evolution API. */
export async function enviarMidia(numero: string, imagemUrl: string, legenda: string, instance: string): Promise<boolean> {
  const url = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  if (!url || !apiKey) return false
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/message/sendMedia/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ number: numero, mediatype: 'image', media: imagemUrl, caption: legenda }),
    })
    if (!res.ok) { console.error('[whatsapp] sendMedia respondeu', res.status, await res.text()); return false }
    return true
  } catch (err) {
    console.error('[whatsapp] falha ao enviar mídia', err)
    return false
  }
}

/** Envia áudio PTT (mensagem de voz) via Evolution API. */
export async function enviarAudioPtt(numero: string, audioUrl: string, instance: string): Promise<boolean> {
  const url = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  if (!url || !apiKey) return false
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/message/sendWhatsAppAudio/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ number: numero, audio: audioUrl }),
    })
    if (!res.ok) { console.error('[whatsapp] sendWhatsAppAudio respondeu', res.status, await res.text()); return false }
    return true
  } catch (err) {
    console.error('[whatsapp] falha ao enviar áudio PTT', err)
    return false
  }
}
