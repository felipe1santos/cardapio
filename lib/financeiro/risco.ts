import type { SupabaseClient } from '@supabase/supabase-js'
import { METRICAS, avaliarRisco, metricaDaAcao, type LinhaRisco, type Metrica } from './risco-regras'

/**
 * Relatório de risco por funcionário (Fase 6). Lê a auditoria (imutável, com hash) e os fechamentos de caixa do
 * período; conta por pessoa e destaca quem foge do padrão da equipe. Só dono e gerente (servidor confere).
 */
const DATA = /^\d{4}-\d{2}-\d{2}$/

export async function relatorioDeRisco(admin: SupabaseClient, loja: string, de: string, ate: string) {
  if (!DATA.test(de) || !DATA.test(ate) || de > ate) throw Object.assign(new Error('Período inválido.'), { status: 400 })
  const { data, error } = await admin.rpc('fin_risco_funcionarios', { p_restaurante: loja, p_de: de, p_ate: ate })
  if (error) throw error
  const zero = () => Object.fromEntries(METRICAS.map((k) => [k, 0])) as Record<Metrica, number>
  const porPessoa = new Map<string, LinhaRisco & { acoes: Record<string, number> }>()
  for (const r of (data ?? []) as { usuario_id: string; usuario_nome: string; papel: string | null; acao: string; qtd: number; valor_centavos: number }[]) {
    const m: Metrica | null = r.acao === 'caixa.divergencia' ? 'divergencias' : metricaDaAcao(r.acao)
    const k = r.usuario_id
    const l = porPessoa.get(k) ?? { usuarioId: k, nome: r.usuario_nome ?? '—', papel: r.papel, valores: zero(), valorCentavos: zero(), acoes: {} }
    if (r.papel && !l.papel) l.papel = r.papel
    l.acoes[r.acao] = (l.acoes[r.acao] ?? 0) + Number(r.qtd)
    if (m) { l.valores[m] += Number(r.qtd); l.valorCentavos[m] += Number(r.valor_centavos) }
    porPessoa.set(k, l)
  }
  // Nome e papel atuais (quem saiu continua no relatório com o nome da época).
  const ids = [...porPessoa.keys()]
  if (ids.length) {
    const { data: us } = await admin.from('usuarios').select('id, nome, papel, cargo').in('id', ids)
    for (const u of us ?? []) { const l = porPessoa.get(u.id as string); if (l) { l.nome = (u.nome as string) || l.nome; l.papel = (u.cargo as string) || (u.papel as string) } }
  }
  const ativos = [...porPessoa.values()].filter((l) => METRICAS.some((k) => l.valores[k] > 0))
  const { linhas, medianas } = avaliarRisco(ativos)
  return { periodo: { de, ate }, linhas: linhas.map((l) => ({ ...l, acoes: porPessoa.get(l.usuarioId as string)?.acoes ?? {} })), medianas }
}
