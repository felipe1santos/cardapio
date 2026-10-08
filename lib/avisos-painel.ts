/**
 * Avisos fixos do painel admin, ligados e desligados só por nós (a loja não fecha).
 *
 * AVISO DO NOVO SISTEMA DE IMPRESSÃO (2026-09-28) — convida as lojas a migrarem para o
 * Assistente Beta. Para DESLIGAR em todas as telas: troque AVISO_NOVA_IMPRESSAO_LIGADO
 * para `false` e publique; ou, sem mexer no código, defina NEXT_PUBLIC_AVISO_NOVA_IMPRESSAO=0
 * no ambiente do build (Coolify) e faça Redeploy.
 *
 * Desligado a pedido do dono em 2026-10-04. Religado na impressão v3 (2026-10-05, branch
 * impressao-v3, ainda NÃO publicado) só para quem precisa atualizar: a loja que imprime e
 * não tem nenhum computador com o Assistente na versão do modelo v3 (VERSAO_IMPRESSAO_V3).
 * Quem já atualizou, ou não usa impressão, não vê nada.
 */
const AVISO_NOVA_IMPRESSAO_LIGADO = true
export const AVISO_NOVA_IMPRESSAO_ATIVO = AVISO_NOVA_IMPRESSAO_LIGADO && process.env.NEXT_PUBLIC_AVISO_NOVA_IMPRESSAO !== '0'

/**
 * Versão do Assistente que toda loja deve ter. Era o beta.9 (modelo v3); desde o item 60
 * (2026-10-08) é o beta.10: QR da rota do entregador, envio automático e conectar sem código.
 */
export const VERSAO_IMPRESSAO_V3 = '0.2.0-beta.10'

/** Telas onde o aviso NÃO aparece: o Kanban de pedidos (operação) e a própria Impressão. */
export const ROTAS_SEM_AVISO_NOVA_IMPRESSAO = ['/admin/pedidos', '/admin/impressao']

export function mostrarAvisoNovaImpressao(pathname: string, ativo = AVISO_NOVA_IMPRESSAO_ATIVO): boolean {
  if (!ativo) return false
  return !ROTAS_SEM_AVISO_NOVA_IMPRESSAO.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}

/**
 * Compara versões "0.1.26", "0.2.0-beta.8": < 0 se a < b, 0 se iguais, > 0 se a > b.
 * Pré-lançamento (beta.N) vem antes da versão final de mesmo número; texto estranho = 0.0.0.
 */
export function compararVersao(a: string | null | undefined, b: string | null | undefined): number {
  const ler = (v: string | null | undefined) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-[a-z]+\.?(\d+))?/i.exec(String(v ?? '').trim())
    if (!m) return [0, 0, 0, -1]
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? Number.MAX_SAFE_INTEGER : Number(m[4])]
  }
  const x = ler(a), y = ler(b)
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

/**
 * A loja precisa atualizar o Assistente? Só quando IMPRIME (Assistente ativado) e nenhum
 * computador pareado e não revogado está na versão do v3 ou mais nova. Quem só usa o
 * Assistente antigo (token, sem pareamento) também precisa.
 */
export function precisaAtualizarAssistente(
  imprime: boolean,
  agentes: { versao: string | null; revogado?: boolean }[],
  alvo = VERSAO_IMPRESSAO_V3,
): boolean {
  if (!imprime) return false
  return !agentes.some((a) => !a.revogado && compararVersao(a.versao, alvo) >= 0)
}
