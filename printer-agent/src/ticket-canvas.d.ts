// Tipos do ticket-canvas.js para a pré-visualização do painel (Next/TypeScript).
export interface OpcoesDesenho {
  larguraMm: number
  larguraPontos?: number | null
  tamanhoFonte?: 'grande' | 'media' | 'pequena'
  logo?: HTMLImageElement
}
export interface DocumentoTicket {
  versao: number
  modelo: string
  blocos: object[]
  [k: string]: unknown
}
declare const TicketMenuzia: {
  desenhar(canvas: HTMLCanvasElement, doc: DocumentoTicket, o: OpcoesDesenho): { largura: number; altura: number }
  carregarRecursos(baseFontes: string, urlLogo: string): Promise<{ logo: HTMLImageElement }>
  larguraEmPontos(larguraMm: number, larguraPontos?: number | null): number
  RECURSOS: { fontes: { familia: string; peso: string; arquivo: string }[]; logo: string }
  ESCALA_FONTE: Record<'grande' | 'media' | 'pequena', number>
}
export default TicketMenuzia
