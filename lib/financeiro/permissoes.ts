import type { Acessos, Sensivel } from '@/lib/acessos'

/**
 * Quem pode cada ação do módulo financeiro (0132). Regra pura, usada no servidor (que decide)
 * e na tela (que só esconde botão).
 *
 * - Dono: tudo.
 * - Com acessos próprios (Equipe): só o que estiver marcado (e a área Financeiro para ver).
 * - Sem acessos (padrão do papel): gerente tudo, menos reabrir caixa; atendente (caixa)
 *   opera o caixa do dia; logística faz o acerto do motoboy.
 * - Reabrir caixa fechado: SEMPRE só o dono, marque o que marcar.
 */
export type AcaoFin = Extract<Sensivel,
  'financeiro' | 'caixa_abrir' | 'fechar_caixa' | 'caixa_reabrir' | 'sangria' | 'despesa' | 'acerto_motoboy' | 'pix_conferir'
  | 'estornar' | 'receber_pagamento' | 'aprovar' | 'reimprimir' | 'custos_editar' | 'auditoria_ver' | 'contas_pagar' | 'dre_ver'
  | 'desconto' | 'taxa' | 'cancelar_pedido'>

const PADRAO_DO_PAPEL: Record<string, AcaoFin[]> = {
  gerente: ['financeiro', 'caixa_abrir', 'fechar_caixa', 'sangria', 'despesa', 'acerto_motoboy', 'pix_conferir', 'estornar',
    'receber_pagamento', 'aprovar', 'reimprimir', 'custos_editar', 'auditoria_ver', 'contas_pagar', 'dre_ver', 'desconto', 'taxa', 'cancelar_pedido'],
  atendente: ['caixa_abrir', 'fechar_caixa', 'receber_pagamento', 'acerto_motoboy', 'reimprimir'],
  logistica: ['acerto_motoboy'],
}

export function podeFin(papel: string | null | undefined, acessos: Acessos | null, acao: AcaoFin): boolean {
  if (!papel) return false
  if (papel === 'dono') return true
  if (acao === 'caixa_reabrir') return false
  if (acessos) {
    if (acao === 'financeiro') return acessos.areas.includes('financeiro')
    return acessos.sensiveis.includes(acao)
  }
  return (PADRAO_DO_PAPEL[papel] ?? []).includes(acao)
}

/** Tudo o que o usuário pode no financeiro (para a tela montar menus e botões). */
export function acoesFin(papel: string | null | undefined, acessos: Acessos | null): AcaoFin[] {
  const todas: AcaoFin[] = ['financeiro', 'caixa_abrir', 'fechar_caixa', 'caixa_reabrir', 'sangria', 'despesa', 'acerto_motoboy',
    'pix_conferir', 'estornar', 'receber_pagamento', 'aprovar', 'reimprimir', 'custos_editar', 'auditoria_ver', 'contas_pagar', 'dre_ver',
    'desconto', 'taxa', 'cancelar_pedido']
  return todas.filter((a) => podeFin(papel, acessos, a))
}
