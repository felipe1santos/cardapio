import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Regras e limites do financeiro da loja (fin_config). GET: quem vê o financeiro. PUT: SÓ o dono.
 * Fase 6: tolerância do fechamento, limite de mesas abertas no fechamento, minutos para avisar caixa sem abrir,
 * meta de faturamento por dia; e os limites antigos (saída do caixa, contas, desconto, horas de alerta).
 */
const CAMPOS: Record<string, [string, number, number]> = {
  toleranciaFechamentoCentavos: ['tolerancia_fechamento_centavos', 0, 100000],
  limiteComandasFechamentoCentavos: ['limite_comandas_fechamento_centavos', 0, 10000000],
  minutosCaixaSemAbrir: ['minutos_caixa_sem_abrir', 5, 600],
  limiteSaidaCentavos: ['limite_saida_centavos', 0, 100000000],
  limiteContaCentavos: ['limite_conta_centavos', 0, 1000000000],
  limiteDescontoPct: ['limite_desconto_pct', 0, 100],
  limiteDescontoCentavos: ['limite_desconto_centavos', 0, 100000000],
  horasCaixaAberto: ['horas_caixa_aberto', 1, 72],
  horasMotoboyPendente: ['horas_motoboy_pendente', 1, 48],
  maxAcoesSensiveisTurno: ['max_acoes_sensiveis_turno', 1, 1000],
}

async function ler(c: Exclude<Awaited<ReturnType<typeof contextoFinanceiro>>, { erro: unknown }>) {
  const { data } = await c.admin.from('fin_config').select('*').eq('restaurante_id', c.sessao.restauranteId).maybeSingle()
  const out: Record<string, number | null> = {}
  for (const [k, [col]] of Object.entries(CAMPOS)) out[k] = data?.[col] === undefined || data?.[col] === null ? null : Number(data[col])
  out.metaFaturamentoDiaCentavos = data?.meta_faturamento_dia_centavos === null || data?.meta_faturamento_dia_centavos === undefined ? null : Number(data.meta_faturamento_dia_centavos)
  return out
}

export async function GET() {
  const c = await contextoFinanceiro('financeiro')
  if ('erro' in c) return c.erro
  return NextResponse.json({ config: await ler(c), podeEditar: c.sessao.papel === 'dono' }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  const c = await contextoFinanceiro()
  if ('erro' in c) return c.erro
  if (c.sessao.papel !== 'dono') return NextResponse.json({ error: 'Só o dono muda as regras do financeiro.', codigo: 'sem_permissao_acao' }, { status: 403 })
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const linha: Record<string, number | null> = {}
  for (const [k, [col, min, max]] of Object.entries(CAMPOS)) {
    if (b?.[k] === undefined) continue
    const v = Number(b[k])
    if (!Number.isFinite(v) || v < min || v > max) return NextResponse.json({ error: `Valor inválido em ${k}.` }, { status: 400 })
    linha[col] = col.endsWith('_pct') ? Math.round(v * 100) / 100 : Math.round(v)
  }
  if (b && 'metaFaturamentoDiaCentavos' in b) {
    const v = b.metaFaturamentoDiaCentavos
    if (v === null || v === '') linha.meta_faturamento_dia_centavos = null
    else if (Number.isSafeInteger(Number(v)) && Number(v) >= 0) linha.meta_faturamento_dia_centavos = Number(v)
    else return NextResponse.json({ error: 'Meta inválida.' }, { status: 400 })
  }
  if (!Object.keys(linha).length) return NextResponse.json({ error: 'Nada para salvar.' }, { status: 400 })
  const antes = await ler(c)
  const { error } = await c.admin.from('fin_config').upsert({ restaurante_id: c.sessao.restauranteId, ...linha }, { onConflict: 'restaurante_id' })
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  await registrarAuditoria(c.admin, { restauranteId: c.sessao.restauranteId, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao: 'fin.config_alterada', entidade: 'restaurante', entidadeId: c.sessao.restauranteId, dados: { antes, depois: linha, dispositivo: c.dispositivo } })
  return NextResponse.json({ ok: true, config: await ler(c) })
}
