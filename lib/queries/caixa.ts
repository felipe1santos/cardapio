/**
 * Turno de caixa (0114): leitura e escrita pelo servidor. Regras em lib/caixa-turno.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { acertoDosEntregadores, diaSaoPaulo, resumoDoDia, type FechamentoEntregador, type LinhaEntregador, type PagamentoCaixa, type PedidoCaixa, type ResumoDiario, type Turno } from '@/lib/caixa-turno'
import { lerTodas } from './ler-todas'

export interface TurnoCaixa extends Turno {
  abertoPorNome: string | null
  fechadoPorNome: string | null
}

export interface PainelCaixa {
  turnoAberto: TurnoCaixa | null
  /** Acerto de cada entregador no turno aberto. */
  acerto: LinhaEntregador[]
  resumoDia: ResumoDiario
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapTurno = (r: any): TurnoCaixa => ({ id: r.id, abertoEm: r.aberto_em, fechadoEm: r.fechado_em, abertoPorNome: r.aberto_por_nome, fechadoPorNome: r.fechado_por_nome })

/** Turnos que tocam o dia (abertos nele) + o aberto agora, e tudo que cai dentro deles. */
async function carregar(admin: SupabaseClient, restauranteId: string, dia: string) {
  // Janela larga o bastante para o turno que abriu no dia e fechou na madrugada seguinte.
  const inicioDia = new Date(`${dia}T00:00:00-03:00`)
  const desde = new Date(inicioDia.getTime() - 24 * 3600_000).toISOString()
  const ate = new Date(inicioDia.getTime() + 48 * 3600_000).toISOString()

  const { data: turnosRows, error: eT } = await admin
    .from('caixa_turnos')
    .select('id, aberto_em, fechado_em, aberto_por_nome, fechado_por_nome')
    .eq('restaurante_id', restauranteId)
    .or(`fechado_em.is.null,aberto_em.gte.${desde}`)
    .order('aberto_em', { ascending: true })
  if (eT) throw eT
  const turnos = (turnosRows ?? []).map(mapTurno)
  const turnoAberto = turnos.find((t) => t.fechadoEm === null) ?? null
  const inicioJanela = [desde, ...turnos.map((t) => t.abertoEm)].sort()[0]

  const pedidos = (await lerTodas<Record<string, unknown>>((de, a) => admin
    .from('pedidos')
    .select('id, entregador_id, total, troco_para, forma_pagamento, status, entregue_em, entregadores ( nome )')
    .eq('restaurante_id', restauranteId)
    .eq('forma_pagamento', 'dinheiro')
    .not('entregador_id', 'is', null)
    .or(`status.eq.em_rota,and(status.eq.entregue,entregue_em.gte.${inicioJanela},entregue_em.lt.${ate})`)
    .order('id', { ascending: true })
    .range(de, a))).map((p): PedidoCaixa => ({
    id: p.id as string,
    entregadorId: p.entregador_id as string,
    entregadorNome: (p.entregadores as { nome?: string } | null)?.nome ?? 'Entregador',
    total: Number(p.total),
    trocoPara: p.troco_para === null ? null : Number(p.troco_para),
    formaPagamento: p.forma_pagamento as string,
    status: p.status as string,
    entregueEm: (p.entregue_em as string | null) ?? null,
  }))

  const ids = turnos.map((t) => t.id)
  const fechamentos: FechamentoEntregador[] = ids.length
    ? ((await admin.from('fechamentos_caixa').select('entregador_id, turno_id, fechado_em, criado_em, valor_esperado, valor_declarado').in('turno_id', ids)).data ?? [])
      .map((f) => ({ entregadorId: f.entregador_id, turnoId: f.turno_id, fechadoEm: f.fechado_em ?? f.criado_em, valorEsperado: Number(f.valor_esperado), valorDeclarado: Number(f.valor_declarado) }))
    : []

  const pagamentos: PagamentoCaixa[] = (await lerTodas<Record<string, unknown>>((de, a) => admin
    .from('pagamentos_comanda')
    .select('id, forma, valor, criado_em, estornado_em')
    .eq('restaurante_id', restauranteId)
    .gte('criado_em', inicioJanela)
    .lt('criado_em', ate)
    .order('id', { ascending: true })
    .range(de, a))).map((p) => ({ forma: p.forma as string, valor: Number(p.valor), criadoEm: p.criado_em as string, estornado: !!p.estornado_em }))

  return { turnos, turnoAberto, pedidos, fechamentos, pagamentos }
}

export async function painelCaixa(admin: SupabaseClient, restauranteId: string, dia = diaSaoPaulo(new Date().toISOString())): Promise<PainelCaixa> {
  const d = await carregar(admin, restauranteId, dia)
  return {
    turnoAberto: d.turnoAberto,
    acerto: d.turnoAberto ? acertoDosEntregadores(d.turnoAberto, d.pedidos, d.fechamentos) : [],
    resumoDia: resumoDoDia(dia, d.turnos, d.pedidos, d.fechamentos, d.pagamentos),
  }
}

export type Operador = { userId: string; nome: string | null }

export async function abrirTurno(admin: SupabaseClient, restauranteId: string, eu: Operador): Promise<{ ok: true; turno: TurnoCaixa } | { ok: false; erro: string; status: number }> {
  const { data, error } = await admin
    .from('caixa_turnos')
    .insert({ restaurante_id: restauranteId, aberto_por: eu.userId, aberto_por_nome: eu.nome })
    .select('id, aberto_em, fechado_em, aberto_por_nome, fechado_por_nome')
    .single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return { ok: false, erro: 'Já existe um turno de caixa aberto.', status: 409 }
    throw error
  }
  return { ok: true, turno: mapTurno(data) }
}

export async function fecharTurno(admin: SupabaseClient, restauranteId: string, eu: Operador, forcar: boolean):
  Promise<{ ok: true } | { ok: false; erro: string; status: number; pendentes?: LinhaEntregador[] }> {
  const painel = await painelCaixa(admin, restauranteId)
  if (!painel.turnoAberto) return { ok: false, erro: 'Não há turno de caixa aberto.', status: 409 }
  const pendentes = painel.acerto.filter((l) => l.pedidos > 0)
  if (pendentes.length && !forcar) {
    return { ok: false, erro: 'Há entregadores com dinheiro para acertar neste turno.', status: 409, pendentes }
  }
  const { data, error } = await admin
    .from('caixa_turnos')
    .update({ fechado_em: new Date().toISOString(), fechado_por: eu.userId, fechado_por_nome: eu.nome })
    .eq('id', painel.turnoAberto.id)
    .is('fechado_em', null)
    .select('id')
  if (error) throw error
  if (!data?.length) return { ok: false, erro: 'O turno já foi fechado.', status: 409 }
  return { ok: true }
}

/**
 * Acerto de um entregador no turno aberto. O esperado e o troco vêm do SERVIDOR (a tela só
 * manda o declarado): o valor gravado é o do turno, não o que o navegador calculou.
 */
export async function acertarEntregador(admin: SupabaseClient, restauranteId: string, eu: Operador, entregadorId: string, valorDeclarado: number):
  Promise<{ ok: true; linha: LinhaEntregador } | { ok: false; erro: string; status: number }> {
  const painel = await painelCaixa(admin, restauranteId)
  if (!painel.turnoAberto) return { ok: false, erro: 'Abra o turno de caixa antes de acertar.', status: 409 }
  const linha = painel.acerto.find((l) => l.entregadorId === entregadorId && l.pedidos > 0)
  if (!linha) return { ok: false, erro: 'Nada a acertar para este entregador neste turno.', status: 409 }
  const declarado = Math.round(valorDeclarado * 100) / 100
  const { error } = await admin.from('fechamentos_caixa').insert({
    restaurante_id: restauranteId,
    entregador_id: entregadorId,
    turno_id: painel.turnoAberto.id,
    valor_esperado: linha.valorEsperado,
    troco_levado: linha.trocoLevado,
    valor_declarado: declarado,
    diferenca: Math.round((declarado - linha.valorEsperado) * 100) / 100,
    pedidos: linha.pedidos,
    registrado_por_nome: eu.nome,
    fechado_em: new Date().toISOString(),
  })
  if (error) throw error
  return { ok: true, linha }
}
