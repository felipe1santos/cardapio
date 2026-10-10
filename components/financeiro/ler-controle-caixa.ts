/**
 * Leitura do controle de caixa (nível 2) compartilhada pela tela Caixa: o bloco do controle (ControleCaixa) e o aviso
 * do "Caixa fechado" (SecaoCaixa) montam juntos e pediam a mesma rota duas vezes (desempenho, 10/10).
 * Chamadas dentro de 3 s reaproveitam a mesma resposta; depois de ativar/desativar a tela usa a resposta do POST.
 */
let emVoo: { em: number; p: Promise<Record<string, unknown> | null> } | null = null

export function lerControleCaixa(): Promise<Record<string, unknown> | null> {
  if (emVoo && Date.now() - emVoo.em < 3000) return emVoo.p
  const p = fetch('/api/admin/financeiro/controle-caixa', { cache: 'no-store' })
    .then(async (r) => (r.ok ? ((await r.json().catch(() => null)) as Record<string, unknown> | null) : null))
    .catch(() => null)
  emVoo = { em: Date.now(), p }
  return p
}
