/**
 * Lê o token de pareamento do Assistente de Impressão de uma requisição.
 * Só o header `Authorization: Bearer <token>` (não vaza em logs de proxy). O `?token=` era do Assistente
 * antigo, desligado em 12/10.
 */
export function lerAgenteToken(request: Request): string | null {
  const auth = request.headers.get('authorization')
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const t = auth.slice(7).trim()
    if (t) return t
  }
  return null
}
