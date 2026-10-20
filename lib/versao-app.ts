/**
 * Versão do app (20/10/2026): o painel guarda a versão do servidor ao abrir (/api/versao = .next/BUILD_ID) e compara
 * nas conferências seguintes (components/admin/nova-versao).
 */
export function versaoMudou(local: string | null | undefined, servidor: string | null | undefined): boolean {
  return !!local && !!servidor && local !== servidor
}
