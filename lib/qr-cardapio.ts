/**
 * Etiquetas de QR Code do cardápio — o material que o dono imprime e cola nas
 * mesas para o cliente escanear com a câmera do celular.
 *
 * Só regra pura aqui (URL, modelos de folha, paginação). A geração da imagem do
 * QR e o desenho da folha ficam no componente, que é client-side.
 */

export type ModeloEtiqueta = 'adesivo' | 'cartao' | 'cartaz'

export interface ModeloInfo {
  id: ModeloEtiqueta
  label: string
  descricao: string
  /** Quantas etiquetas cabem em uma folha A4. */
  porPagina: number
  colunas: number
  /** Lado do QR impresso, em mm — a folha usa mm para sair no tamanho real. */
  qrMm: number
}

export const MODELOS_ETIQUETA: ModeloInfo[] = [
  {
    id: 'adesivo',
    label: 'Adesivo',
    descricao: '6 por folha · QR de 42 mm — para colar direto no tampo da mesa.',
    // 8 por folha não cabia: com logo, título, mesa e frase o conteúdo
    // transbordava a célula e invadia a etiqueta de baixo.
    porPagina: 6,
    colunas: 2,
    qrMm: 42,
  },
  {
    id: 'cartao',
    label: 'Cartão de mesa',
    descricao: '4 por folha · QR de 65 mm — para display de acrílico ou porta-guardanapo.',
    porPagina: 4,
    colunas: 2,
    qrMm: 65,
  },
  {
    id: 'cartaz',
    label: 'Cartaz',
    descricao: '1 por folha · QR de 110 mm — para balcão, parede ou vitrine.',
    porPagina: 1,
    colunas: 1,
    qrMm: 110,
  },
]

export function modeloEtiqueta(id: ModeloEtiqueta): ModeloInfo {
  return MODELOS_ETIQUETA.find((m) => m.id === id) ?? MODELOS_ETIQUETA[0]
}

/** Limite de etiquetas por impressão — evita mandar 5 mil folhas por engano. */
export const MAX_ETIQUETAS = 200

export interface Etiqueta {
  /** Chave estável para o React (índice na folha). */
  id: string
  /** Nome da mesa impresso na etiqueta, ou null quando a folha é genérica. */
  mesa: string | null
  /**
   * QR e link DESTA etiqueta. O QR do cardápio é um só para a loja inteira, então essas
   * duas ficam vazias e a folha usa o valor compartilhado. O QR de MESA é diferente em
   * cada mesa (token próprio, revogável) — aí cada etiqueta traz o seu.
   */
  qrDataUrl?: string | null
  url?: string
}

export interface EntradaEtiquetas {
  /** Mesas selecionadas. Vazio = etiquetas sem identificação. */
  mesas: string[]
  /** Cópias de cada etiqueta (ou total de etiquetas, quando não há mesa). */
  quantidade: number
}

/**
 * Monta a lista de etiquetas a imprimir.
 *
 * Com mesas selecionadas, cada mesa vira `quantidade` etiquetas (o dono
 * costuma querer uma por lado da mesa). Sem mesa, sai `quantidade` etiquetas
 * genéricas — o QR é o mesmo em todas, o nome da mesa é só identificação
 * visual do material impresso.
 */
export function montarEtiquetas({ mesas, quantidade }: EntradaEtiquetas): Etiqueta[] {
  const copias = Math.max(1, Math.floor(quantidade) || 1)
  const lista: Etiqueta[] = []
  if (mesas.length > 0) {
    for (const mesa of mesas) {
      for (let i = 0; i < copias; i++) lista.push({ id: `${mesa}-${i}`, mesa })
    }
  } else {
    for (let i = 0; i < copias; i++) lista.push({ id: `generica-${i}`, mesa: null })
  }
  return lista.slice(0, MAX_ETIQUETAS)
}

/** Quebra as etiquetas em folhas A4 conforme o modelo escolhido. */
export function paginarEtiquetas(etiquetas: Etiqueta[], porPagina: number): Etiqueta[][] {
  const cap = Math.max(1, porPagina)
  const paginas: Etiqueta[][] = []
  for (let i = 0; i < etiquetas.length; i += cap) paginas.push(etiquetas.slice(i, i + cap))
  return paginas
}

/** URL pública do cardápio da loja — o destino do QR. */
export function urlCardapio(origem: string, slug: string): string {
  const base = origem.replace(/\/+$/, '')
  return `${base}/loja/${slug}`
}

/** Nome de arquivo do PNG baixado (sem caracteres que o Windows recusa). */
export function nomeArquivoQr(slug: string): string {
  const limpo = slug.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return `qrcode-cardapio-${limpo || 'loja'}.png`
}

/**
 * Rótulo impresso da mesa. Lojas costumam cadastrar a mesa só como número
 * ("01", "7") — sozinho no papel isso não diz nada, então ganha o prefixo.
 */
export function rotuloMesa(nome: string): string {
  const limpo = nome.trim()
  return /^\d+$/.test(limpo) ? `Mesa ${limpo}` : limpo
}
