import { NextResponse } from 'next/server'
import { contextoImpressao } from '@/lib/impressao/contexto'
import { atribuirFuncao, ehFuncaoImpressora } from '@/lib/impressao/servico'
import { ehUuid } from '@/lib/pdv-v2'
import { perguntaAoTrocar } from '@/lib/impressao/protecao-computador'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Atribui a função Cozinha, Caixa ou Comanda de entrega (0158) a uma impressora (ou tira:
 * `dispositivoId: null`).
 * A mesma impressora nas duas só com `confirmarCompartilhada: true`.
 */
export async function PUT(request: Request) {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const corpo = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (!ehFuncaoImpressora(corpo.funcao)) return NextResponse.json({ error: 'Função inválida' }, { status: 400 })
  const dispositivoId = corpo.dispositivoId === null ? null : ehUuid(corpo.dispositivoId) ? corpo.dispositivoId : undefined
  if (dispositivoId === undefined) return NextResponse.json({ error: 'Impressora inválida' }, { status: 400 })
  // Outro computador não assume a impressão em silêncio (09/10, Villa): com o atual ativo, só confirmando.
  const troca = dispositivoId ? await perguntaAoTrocar(ctx.admin, ctx.op.restauranteId, corpo.funcao, dispositivoId) : null
  if (troca && corpo.confirmar !== true) return NextResponse.json({ error: troca.pergunta, codigo: 'outro_computador' }, { status: 409 })
  const r = await atribuirFuncao(ctx.admin, ctx.op, corpo.funcao, dispositivoId, corpo.confirmarCompartilhada === true)
  if (r.ok && troca) {
    await registrarAuditoria(ctx.admin, { restauranteId: ctx.op.restauranteId, usuarioId: ctx.op.userId, usuarioNome: ctx.op.nome, acao: 'impressao.troca_computador', entidade: 'restaurante', entidadeId: ctx.op.restauranteId, dados: { funcao: corpo.funcao, de: troca.de, dispositivo: dispositivoId, resumo: `${corpo.funcao}: saiu de ${troca.de} (confirmado)` } }).catch(() => {})
  }
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  // modoRecuou: o modo ligado perdeu a impressora de que precisava e voltou para a segurança.
  return NextResponse.json({ ok: true, modoRecuou: r.modoRecuou ?? null })
}
