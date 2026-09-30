/**
 * Resposta ao atendente quando o envio pela central não deu certo.
 *
 * 'incerto' é tempo esgotado depois de o provedor talvez ter aceitado: dizer "Tente de
 * novo" fazia o atendente reenviar e o cliente receber a mensagem em dobro (B9).
 */
export const ERRO_INCERTO_ATENDENTE = 'pode ter sido entregue'

export function mensagemFalhaAtendente(tipo: 'transitorio' | 'definitivo' | 'incerto'): string {
  if (tipo === 'incerto') return 'O WhatsApp demorou para responder e a mensagem pode ter sido enviada. Confira no celular da loja antes de mandar de novo.'
  return 'O WhatsApp não aceitou a mensagem. Tente de novo.'
}

/** Rótulo no balão da conversa para uma saída que não confirmou. */
export function rotuloSaidaNaoConfirmada(erro: string | null | undefined): string {
  return (erro ?? '').includes(ERRO_INCERTO_ATENDENTE) ? 'pode ter sido enviada' : 'não enviada'
}
