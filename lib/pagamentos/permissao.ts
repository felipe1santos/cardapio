/**
 * Permissão "conectar pagamentos" (Pix online, 0148): conectar ou desconectar a conta do Mercado Pago
 * da loja é só do DONO — é para onde o dinheiro da loja vai. Não é atribuível na tela de Equipe.
 */
export function podeConectarPagamentos(papel: string | null | undefined): boolean {
  return papel === 'dono'
}

/**
 * Redirecionamento das rotas da conexão: caminho RELATIVO no `Location` (o navegador resolve no
 * mesmo host). `new URL(x, request.url)` usaria o host interno do servidor (localhost/contêiner)
 * e o cookie da sessão se perderia.
 */
export function redirecionar(destino: string): Response {
  return new Response(null, { status: 303, headers: { Location: destino, 'Cache-Control': 'no-store' } })
}
