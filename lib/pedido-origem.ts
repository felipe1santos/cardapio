/**
 * Como a cozinha e o Kanban identificam de onde veio o pedido.
 *
 * Antes desta função a tela olhava só `origem === 'pdv'` e escrevia "PDV · Mesa 4".
 * Pedido de mesa não vem do PDV: vem do painel do garçom, é outro posto de trabalho e
 * outro fluxo. Com salão e balcão escritos igual, a cozinha não distingue "o garçom
 * lançou para a mesa 4" de "o caixa registrou uma venda de balcão" — e é justamente
 * isso que decide para onde o prato vai.
 *
 * Puro de propósito: o rótulo é o mesmo no Kanban, no portal da cozinha e nos testes.
 */

export interface PedidoParaRotulo {
  /** 'delivery' | 'mesa' | 'balcao'. Ausente = dado antigo, tratado como delivery. */
  canal?: string | null
  origem?: string | null
  mesa?: string | null
  /** Funcionário que lançou (garçom, no salão). */
  criadoPorNome?: string | null
  /** Número da comanda (0072): a cozinha e o caixa falam da mesma conta mesmo depois de transferir. */
  comandaNumero?: number | null
  /** Senha do balcão (0082). */
  comandaSenha?: number | null
  /** 'entrega' no balcão = entrega manual pelo card preto (0094). */
  tipo?: string | null
  /** De onde saiu o lançamento de mesa (0094): 'pdv' | 'salao'. Null = pedido antigo (salão). */
  lancadoVia?: string | null
}

export type TomOrigem = 'salao' | 'balcao' | 'delivery'

export interface RotuloOrigem {
  /** Texto curto da etiqueta, ex.: "Salão · Mesa 4". Null = não mostra etiqueta. */
  texto: string | null
  /** Quem lançou, quando faz diferença para a cozinha saber. */
  responsavel: string | null
  tom: TomOrigem
  /** Posto que lançou, para a etiqueta curta: PDV (caixa), Salão (garçom) ou Delivery. */
  posto: 'PDV' | 'Salão' | 'Delivery'
}

export function rotuloOrigemPedido(pedido: PedidoParaRotulo): RotuloOrigem {
  // `canal` é o discriminador confiável (0058); `origem` fica como reserva para pedido
  // gravado antes dela existir.
  const canal = pedido.canal ?? (pedido.origem === 'pdv' ? (pedido.mesa ? 'mesa' : 'balcao') : 'delivery')

  if (canal === 'mesa') {
    // Mesa lançada pelo caixa (PDV) ou pelo garçom (salão); pedido antigo = salão.
    const posto = pedido.lancadoVia === 'pdv' ? 'PDV' : 'Salão'
    return {
      texto: `${posto} · ${rotuloDaMesa(pedido.mesa)}${pedido.comandaNumero ? ` · Comanda ${pedido.comandaNumero}` : ''}`,
      responsavel: pedido.criadoPorNome?.trim() || null,
      tom: 'salao',
      posto,
    }
  }
  if (canal === 'balcao') {
    const texto = pedido.tipo === 'entrega'
      ? `PDV · Entrega manual${pedido.comandaSenha ? ` · Senha ${pedido.comandaSenha}` : ''}`
      : `PDV · Balcão${pedido.comandaSenha ? ` · Senha ${pedido.comandaSenha}` : ''}`
    return { texto, responsavel: pedido.criadoPorNome?.trim() || null, tom: 'balcao', posto: 'PDV' }
  }
  return { texto: null, responsavel: null, tom: 'delivery', posto: 'Delivery' }
}

/**
 * Lojas cadastram a mesa só como número ("4", "07"). Sozinho na tela da cozinha isso
 * pode ser confundido com número de pedido, então ganha o prefixo.
 */
export function rotuloDaMesa(nome: string | null | undefined): string {
  const limpo = (nome ?? '').trim()
  if (!limpo) return 'Mesa'
  return /^\d+$/.test(limpo) ? `Mesa ${limpo}` : limpo
}
