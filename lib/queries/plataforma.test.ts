import { describe, expect, it } from 'vitest'
import { agruparPorLoja, resumir, situacaoDaConta, statusDoSublogin } from './plataforma'

const AGORA = new Date('2026-10-04T12:00:00Z').getTime()
let seq = 0
function u(p: Partial<Parameters<typeof agruparPorLoja>[0][number]>) {
  seq++
  return {
    id: `u${seq}`, email: `u${seq}@x.com`, usuario: `u${seq}`, nome: `Pessoa ${seq}`, nome_loja: '', telefone: '', papel: 'dono', cargo: null,
    autorizado: true, restaurante_id: null, ultimo_login_em: null, criado_em: `2026-01-${String(seq).padStart(2, '0')}T00:00:00Z`,
    acesso_expira_em: null, logins_total: 0, desativado_em: null, situacao: null, ...p,
  }
}

describe('painel da plataforma: uma linha por loja', () => {
  const lojas = [{ id: 'A', nome: 'Loja A', slug: 'a', impressao_beta_liberado: true }, { id: 'B', nome: 'Loja B', slug: 'b' }, { id: 'C', nome: 'Sem dono', slug: 'c' }]
  const usuarios = [
    u({ id: 'donoA', restaurante_id: 'A', nome_loja: '' }), // dono sem nome_loja (caso "Administrador/admin")
    u({ id: 'garcomA', restaurante_id: 'A', papel: 'garcom', email: 'g.aaaa@equipe.menuzia.local' }),
    u({ id: 'pausadoA', restaurante_id: 'A', papel: 'atendente', desativado_em: '2026-09-01T00:00:00Z', situacao: 'pausado' }),
    u({ id: 'excluidoA', restaurante_id: 'A', papel: 'cozinha', desativado_em: '2026-09-01T00:00:00Z', situacao: 'excluido' }),
    u({ id: 'donoB', restaurante_id: 'B', autorizado: false }),
    u({ id: 'pre', restaurante_id: null, nome_loja: 'Burger Novo', acesso_expira_em: '2026-12-31T23:59:59Z' }),
    u({ id: 'motoboyB', restaurante_id: 'B', papel: 'entregador', cargo: 'motoboy', desativado_em: '2026-09-01T00:00:00Z' }),
  ]
  const metricas = new Map([['A', { faturamento: 300, qtdPedidos: 3 }], ['B', { faturamento: 100, qtdPedidos: 1 }]])
  const linhas = agruparPorLoja(usuarios, lojas, metricas, AGORA)

  it('loja com dono vira 1 linha; sublogins não viram linha; loja sem dono fica de fora; pré-cadastro é linha própria', () => {
    expect(linhas.map((l) => l.chave)).toEqual(['A', 'B', 'pre:pre'])
    const a = linhas[0]
    expect(a.contaId).toBe('donoA')
    expect(a.loja).toBe('Loja A') // nome vem da loja, não do nome_loja vazio do dono
    expect(a.sublogins.map((s) => [s.id, s.status])).toEqual(expect.arrayContaining([['garcomA', 'ativo'], ['pausadoA', 'pausado']]))
    expect(a.sublogins).toHaveLength(2) // excluído não conta
    expect(a.betaLiberado).toBe(true)
    expect(linhas[1].sublogins.map((s) => s.status)).toEqual(['bloqueado'])
    expect(linhas[2]).toMatchObject({ situacao: 'pendente', loja: 'Burger Novo', restauranteId: null })
  })

  it('números do topo contam só lojas e somam valores por loja, sem duplicar pela equipe', () => {
    const r = resumir(linhas)
    expect(r).toMatchObject({ cadastros: 3, ativos: 1, pendentes: 1, semAcesso: 1, faturamento: 400, pedidos: 4 })
    expect(r.ticket).toBe(100)
  })

  it('com dois donos, a conta principal é a com acesso e mais antiga; o outro vira sublogin', () => {
    const l = agruparPorLoja([u({ id: 'velhoSemAcesso', restaurante_id: 'X', autorizado: false }), u({ id: 'novoComAcesso', restaurante_id: 'X' })], [{ id: 'X', nome: 'X', slug: 'x' }], new Map(), AGORA)
    expect(l[0].contaId).toBe('novoComAcesso')
    expect(l[0].sublogins.map((s) => s.papel)).toEqual(['dono'])
  })
})

describe('situação e status', () => {
  it('situacaoDaConta', () => {
    expect(situacaoDaConta({ restauranteId: null, autorizado: false, acessoExpiraEm: null }, AGORA)).toBe('pendente')
    expect(situacaoDaConta({ restauranteId: 'r', autorizado: false, acessoExpiraEm: null }, AGORA)).toBe('revogado')
    expect(situacaoDaConta({ restauranteId: 'r', autorizado: true, acessoExpiraEm: null }, AGORA)).toBe('ativo')
    expect(situacaoDaConta({ restauranteId: 'r', autorizado: true, acessoExpiraEm: '2026-11-01T00:00:00Z' }, AGORA)).toBe('ativo_temporario')
    expect(situacaoDaConta({ restauranteId: 'r', autorizado: true, acessoExpiraEm: '2026-09-01T00:00:00Z' }, AGORA)).toBe('expirado')
  })
  it('statusDoSublogin', () => {
    expect(statusDoSublogin({ desativado_em: null, situacao: null })).toBe('ativo')
    expect(statusDoSublogin({ desativado_em: 'x', situacao: 'pausado' })).toBe('pausado')
    expect(statusDoSublogin({ desativado_em: 'x', situacao: null })).toBe('bloqueado')
    expect(statusDoSublogin({ desativado_em: 'x', situacao: 'excluido' })).toBeNull()
  })
})
