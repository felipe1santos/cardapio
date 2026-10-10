/**
 * "Avançado" da tela de Impressão (Alfa 1, 09/10) — regras puras.
 * Por impressora, a loja escolhe só Imagem (recomendado) ou Texto. O Windows não aparece: é a reserva
 * automática do Assistente quando o envio direto falha, e o suporte força pelo banco (envio = 'driver').
 */
export type ModoAvancado = 'imagem' | 'texto'
export type RespostaTeste = 'ok' | 'nao_saiu'

/** Pergunta "Saiu certinho?" depois do primeiro "Imprimir teste" desta impressora (ainda sem resposta). */
export function perguntarSaiuCertinho(p: { testeEnviado: boolean; resposta: RespostaTeste | null }): boolean {
  return p.testeEnviado && p.resposta === null
}

/** "Não saiu direito" numa impressora em Imagem: oferecer passar para Texto com um clique. */
export function sugerirTexto(p: { resposta: RespostaTeste | null; modo: ModoAvancado }): boolean {
  return p.resposta === 'nao_saiu' && p.modo === 'imagem'
}

/** Impressoras do Avançado: as da lista da tela e as que têm função, sem repetir. */
export function impressorasDoAvancado<T extends { id: string; naLista: boolean; funcoes: unknown[] }>(lista: T[]): T[] {
  return lista.filter((d) => d.naLista || d.funcoes.length > 0)
}
