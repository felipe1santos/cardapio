import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { podeFin } from '@/lib/financeiro/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { listarContas, type FiltrosContas } from '@/lib/financeiro/contas'
import { gerarCsvBR, type Celula } from '@/lib/financeiro/fluxo-regras'

const ROTULO: Record<string, string> = { a_pagar: 'Em aberto', vencido: 'Vencida', pago: 'Paga', cancelado: 'Cancelada' }

/** CSV das contas (mesmo padrão da Fase 4, auditado). financeiro_exportar + contas_pagar. */
export async function GET(request: Request) {
  const c = await contextoFinanceiro('financeiro_exportar')
  if ('erro' in c) return c.erro
  if (!podeFin(c.sessao.papel, c.acessos, 'contas_pagar')) return NextResponse.json({ error: 'Você não tem permissão para esta ação.' }, { status: 403 })
  const u = new URL(request.url).searchParams
  const f: FiltrosContas = { tipo: u.get('tipo') === 'receber' ? 'receber' : u.get('tipo') === 'pagar' ? 'pagar' : null, situacao: 'todas', de: u.get('de'), ate: u.get('ate'), busca: u.get('busca') }
  const { contas } = await listarContas(c.admin, c.sessao.restauranteId, f)
  const data = (d: unknown) => (typeof d === 'string' && d ? d.slice(0, 10).split('-').reverse().join('/') : '')
  const csv = gerarCsvBR([
    ['Tipo', 'Descrição', 'Fornecedor', 'Categoria', 'Valor (R$)', 'Vencimento', 'Situação', 'Pago/recebido em', 'De onde', 'Forma', 'Lançada por', 'Recorrência'],
    ...contas.map((k) => [k.tipo === 'pagar' ? 'A pagar' : 'A receber', k.descricao as string, k.fornecedor ?? '', k.categoria, { n: Number(k.valor_centavos) }, data(k.vencimento),
      ROTULO[k.statusExibido] ?? k.statusExibido, data(k.pago_em), k.pago_carteira === 'gaveta' ? 'Caixa' : k.pago_carteira === 'empresa' ? 'Empresa' : '', (k.pago_forma as string) ?? '',
      k.criado_por_nome as string, k.recorrencia === 'nenhuma' ? '' : (k.recorrencia as string)] as Celula[]),
  ])
  await registrarAuditoria(c.admin, {
    restauranteId: c.sessao.restauranteId, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao: 'contas.exportou', entidade: 'restaurante',
    entidadeId: c.sessao.restauranteId, dados: { linhas: contas.length, dispositivo: c.dispositivo },
  })
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="contas.csv"', 'Cache-Control': 'no-store' } })
}
