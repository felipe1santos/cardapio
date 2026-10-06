// Tipos do recibo-antigo-canvas.js (prévia da comanda do Assistente antigo).
declare const ReciboAntigo: {
  desenhar(canvas: HTMLCanvasElement, textoMarcado: string, o: { larguraMm: number; colunas?: number; fonteMaior?: boolean; logo?: HTMLImageElement | null; familia?: string; umBit?: boolean }): { largura: number; altura: number; base: number; colunas: number }
  colsParaFonte(tamanho: string | null | undefined, largura: number): number
  lerOperacoes(texto: string): { tipo: string; f: string[] }[]
  CONSOLAS: { avanco: number; linha: number; topoMaiuscula: number; avancoFonte: number }
}
export default ReciboAntigo
