/**
 * Versão do app (20/10/2026): carimbo gerado no BUILD (next.config.ts › NEXT_PUBLIC_VERSAO_APP), embutido igual no
 * navegador e no servidor. /api/versao devolve a do servidor no ar; o painel compara com a sua (components/admin/nova-versao).
 */
export function versaoMudou(local: string | null | undefined, servidor: string | null | undefined): boolean {
  return !!local && !!servidor && local !== servidor
}
