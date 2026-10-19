import { FalhaPedido, type CodigoFalhaPedido } from './pedido'

/**
 * Falha ao fechar/criar o pedido → texto HUMANO para o cliente (19/10/2026, auditoria da Ponto 400: "Não consegui
 * fechar o pedido: A loja não está aceitando retirada agora." foi direto ao cliente). Puro. Toda falha sem saída vai
 * ao atendente (conversa amarela) com o resumo do que o cliente queria.
 */
export interface FalhaHumana {
  codigo: CodigoFalhaPedido | 'item' | 'outro'
  texto: string
  atendente: boolean
  /** O que vai na central como motivo (só com atendente). */
  resumo?: string
  /** Trocar o tipo do pedido em andamento (retirada ↔ entrega) para a próxima pergunta seguir. */
  ajustarTipo?: 'entrega' | 'retirada'
  /** 19/10 (dono): loja fechada não recebe pedido — o rascunho em andamento é descartado. */
  limparRascunho?: boolean
}

export function falhaDoPedido(err: unknown, loja: { aceitaEntrega: boolean; aceitaRetirada: boolean; proximaAbertura: string | null }, resumoDoPedido?: string | null): FalhaHumana {
  const codigo: CodigoFalhaPedido | 'item' | 'outro' = err instanceof FalhaPedido ? err.codigo : /indispon|esgotad|pausad|não está no cardápio|nao esta no cardapio/i.test((err as Error)?.message ?? '') ? 'item' : 'outro'
  const chamar = (texto: string, motivo: string): FalhaHumana => ({ codigo, texto, atendente: true, resumo: `${motivo}${resumoDoPedido ? ` — ${resumoDoPedido}` : ''}` })
  switch (codigo) {
    case 'sem_retirada':
      return loja.aceitaEntrega
        ? { codigo, texto: 'No momento estamos só com entrega 🛵 Posso mandar pro seu endereço?', atendente: false, ajustarTipo: 'entrega' }
        : chamar('Agora não estamos pegando pedidos por aqui 😕 Já chamei alguém da loja para te ajudar, só um instante 🙏', 'Retirada e entrega desligadas')
    case 'sem_entrega':
      return loja.aceitaRetirada
        ? { codigo, texto: 'No momento estamos só com retirada no balcão 🛍️ Quer retirar?', atendente: false, ajustarTipo: 'retirada' }
        : chamar('Agora não estamos pegando pedidos por aqui 😕 Já chamei alguém da loja para te ajudar, só um instante 🙏', 'Retirada e entrega desligadas')
    case 'fechada':
      return { codigo, texto: `A loja está fechada agora 😕${loja.proximaAbertura ? ` ${loja.proximaAbertura}.` : ''}\n\nPor isso não consigo anotar seu pedido agora. Assim que abrirmos, é só me chamar por aqui que eu anoto na hora!`, atendente: false, limparRascunho: true }
    case 'fora_da_area':
      return chamar('Esse endereço fica fora da nossa área de entrega 😕 Já chamei alguém da loja para ver o que dá pra fazer, só um instante 🙏', 'Fora da área de entrega')
    case 'item':
      return { codigo, texto: 'Um item do pedido acabou de ficar indisponível 😕 Quer trocar por outro do cardápio? Me fala qual.', atendente: false }
    default:
      return chamar('Tive um problema para fechar o pedido aqui 😕 Já chamei alguém da loja para continuar com você, só um instante 🙏', 'Falha ao fechar o pedido pela IA')
  }
}
