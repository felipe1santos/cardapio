import type { NovoPedidoInput, TipoPedido, FormaPagamento, NovoPedidoItemInput } from './pedidos'

/**
 * Tradução do corpo que chega da vitrine para o que `criarPedido` aceita.
 *
 * A rota pública repassava o corpo inteiro. Isso deixava o navegador escolher `origem`
 * (e `'pdv'` pula as checagens de canal de venda), `comandaId`, `mesa` e, depois da
 * 0058, `canal` — que é justamente a fronteira entre o delivery e o salão na RLS.
 *
 * Aqui nada é copiado por espalhamento: cada campo é lido um a um. Campo interno no
 * corpo não é ignorado em silêncio — é recusado, porque nenhum cliente honesto manda
 * isso e engolir calado esconderia tentativa de abuso.
 */

/** Campos que só o servidor decide. Presença no corpo público = 422. */
export const CAMPOS_INTERNOS = [
  'origem',
  'canal',
  'mesa',
  'mesaId',
  'comandaId',
  'comanda_id',
  'restauranteId',
  'restaurante_id',
  'criadoPor',
  'criado_por',
  'status',
  'pago',
  'numero',
  'telefoneVerificado',
  'chaveIdempotencia',
  'criadoPorNome',
] as const

export interface ResultadoWhitelist {
  ok: boolean
  /** Campos internos encontrados no corpo. Vazio quando `ok`. */
  recusados: string[]
  input?: NovoPedidoInput
}

function texto(valor: unknown, limite = 200): string {
  return typeof valor === 'string' ? valor.slice(0, limite) : ''
}

/**
 * Monta a entrada do pedido público.
 *
 * `taxaEntrega` é aceito e descartado: a vitrine em produção manda esse campo
 * (vitrine.tsx), então recusá-lo quebraria o checkout de quem estiver com uma aba
 * antiga aberta. O servidor já o ignorava — `resolverFrete` recalcula tudo.
 */
export function montarPedidoPublico(bruto: unknown): ResultadoWhitelist {
  if (!bruto || typeof bruto !== 'object') return { ok: false, recusados: [] }
  const corpo = bruto as Record<string, unknown>

  const recusados = CAMPOS_INTERNOS.filter((campo) => corpo[campo] !== undefined)
  if (recusados.length > 0) return { ok: false, recusados }

  const cliente = (corpo.cliente ?? {}) as Record<string, unknown>
  const endereco = (corpo.endereco ?? {}) as Record<string, unknown>

  const input: NovoPedidoInput = {
    tipo: (corpo.tipo === 'retirada' ? 'retirada' : 'entrega') as TipoPedido,
    cliente: { nome: texto(cliente.nome, 120), telefone: texto(cliente.telefone, 30) },
    endereco: {
      rua: texto(endereco.rua),
      numero: texto(endereco.numero, 20),
      complemento: texto(endereco.complemento),
      bairro: texto(endereco.bairro, 120),
      cep: texto(endereco.cep, 20),
      cidade: texto(endereco.cidade, 120),
      referencia: texto(endereco.referencia),
    },
    pagamento: texto(corpo.pagamento, 30) as FormaPagamento,
    trocoPara: typeof corpo.trocoPara === 'number' ? corpo.trocoPara : null,
    itens: Array.isArray(corpo.itens) ? (corpo.itens as NovoPedidoItemInput[]) : [],
    // Origem é do servidor. O pedido público é sempre da vitrine.
    origem: 'cardapio',
  }

  if (typeof corpo.cupomCodigo === 'string') input.cupomCodigo = corpo.cupomCodigo.slice(0, 60)
  if (typeof corpo.recompensaId === 'string') input.recompensaId = corpo.recompensaId

  return { ok: true, recusados: [], input }
}
