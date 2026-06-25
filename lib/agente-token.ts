/**
 * Lê o token de pareamento do Assistente de Impressão de uma requisição.
 * Prefere o header `Authorization: Bearer <token>` (não vaza em logs de proxy);
 * cai para `?token=` por compatibilidade com agentes antigos.
 */
export function lerAgenteToken(request: Request): string | null {
  const auth = request.headers.get('authorization')
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const t = auth.slice(7).trim()
    if (t) return t
  }
  return new URL(request.url).searchParams.get('token')
}
