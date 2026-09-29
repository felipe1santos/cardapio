// Tipos do ticket-canvas.js para a pré-visualização do painel (Next/TypeScript).
export interface OpcoesDesenho {
  larguraMm: number
  larguraPontos?: number | null
  tamanhoFonte?: 'grande' | 'media' | 'pequena'
  logo?: HTMLImageElement | null
  imprimirLogo?: boolean
  /** Intensidade da impressora (Calibrar impressora): limiar do preto e branco. */
  intensidade?: 'normal' | 'escura' | 'mais_escura'
  /** 1 bit (padrão): preto e branco de verdade, como sai no papel. */
  umBit?: boolean
}
export interface DocumentoTicket {
  versao: number
  modelo: string
  blocos: object[]
  [k: string]: unknown
}
declare const TicketMenuzia: {
  desenhar(canvas: HTMLCanvasElement, doc: DocumentoTicket, o: OpcoesDesenho): { largura: number; altura: number }
  bitsDoCanvas(canvas: HTMLCanvasElement): { bits: Uint8Array; largura: number; altura: number; porLinha: number }
  carregarRecursos(baseFontes: string): Promise<object>
  carregarImagem(url: string | null): Promise<HTMLImageElement | null>
  larguraEmPontos(larguraMm: number, larguraPontos?: number | null): number
  RECURSOS: { fontes: { familia: string; peso: string; arquivo: string }[] }
  INTENSIDADES: Record<'normal' | 'escura' | 'mais_escura', number>
  ESCALA_FONTE: Record<'grande' | 'media' | 'pequena', number>
  ICONE_DA_FORMA: Record<string, string>
}
export default TicketMenuzia
