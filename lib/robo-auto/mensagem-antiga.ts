/**
 * Mensagem velha não ganha resposta automática (15/11/2026). Quando a instância da Evolution reconecta, o WhatsApp
 * reentrega tudo o que ficou pendente (na Gordelícia: até 30 h atrás) como mensagem nova; o robô e a IA respondiam
 * cada uma, de madrugada. A mensagem continua gravada na central; só a resposta automática não sai.
 */
export const MENSAGEM_ANTIGA_MS = 10 * 60_000

/** `instante` = hora em que o cliente mandou (messageTimestamp do provedor). Sem hora válida conta como nova. */
export function mensagemAntiga(instante: string | null, agora: number = Date.now()): boolean {
  if (!instante) return false
  const em = Date.parse(instante)
  if (!Number.isFinite(em)) return false
  return agora - em > MENSAGEM_ANTIGA_MS
}
