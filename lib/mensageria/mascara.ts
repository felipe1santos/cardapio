/**
 * Máscara de telefone para log e para o painel: mantém DDI+DDD e os 4 últimos dígitos.
 *   5527999991234 → 5527*****1234
 * Log de erro nunca leva o número inteiro nem o conteúdo da mensagem.
 */
export function mascararTelefone(valor: string | null | undefined): string {
  const d = (valor ?? '').replace(/\D/g, '')
  if (d.length <= 6) return d ? '*'.repeat(d.length) : ''
  const inicio = d.length >= 12 ? 4 : 2
  return d.slice(0, inicio) + '*'.repeat(d.length - inicio - 4) + d.slice(-4)
}

/** Tira de um texto de erro qualquer sequência longa de dígitos (telefone, id). */
export function limparErro(texto: unknown): string {
  return String(texto ?? '')
    .replace(/\d{8,}/g, (d) => mascararTelefone(d))
    .replace(/"text"\s*:\s*"[^"]*"/gi, '"text":"…"')
    .slice(0, 300)
}
