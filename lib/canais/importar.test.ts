import { describe, expect, it, vi } from 'vitest'
import type { ItemExterno } from './tipos'

vi.mock('@/lib/push/painel-pedidos', () => ({ avisarPainelPedidoNovo: vi.fn() }))
vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn() }))

import { diferencaDeItens } from './importar'

const item = (nome: string, quantidade: number): ItemExterno => ({ externoId: nome, codigoExterno: null, nome, quantidade, precoUnitario: 10, observacao: '', complementos: [] })

describe('pedido alterado no app: diferença de itens', () => {
  const atuais = [{ id: 'a', nome: 'X-Bacon', quantidade: 2 }, { id: 'b', nome: 'Coca', quantidade: 1 }]

  it('item que saiu é cancelado', () => {
    expect(diferencaDeItens(atuais, [item('X-Bacon', 2)])).toEqual({ cancelar: ['b'], mudar: [], novos: [] })
  })
  it('quantidade diferente muda só a quantidade', () => {
    expect(diferencaDeItens(atuais, [item('X-Bacon', 1), item('Coca', 1)])).toEqual({ cancelar: [], mudar: [{ id: 'a', quantidade: 1 }], novos: [] })
  })
  it('item novo entra', () => {
    const r = diferencaDeItens(atuais, [item('X-Bacon', 2), item('Coca', 1), item('Suco', 1)])
    expect(r.novos.map((i) => i.nome)).toEqual(['Suco'])
  })
  it('itens de mesmo nome são casados um a um', () => {
    const r = diferencaDeItens([{ id: 'a', nome: 'X', quantidade: 1 }, { id: 'b', nome: 'X', quantidade: 1 }], [item('X', 1)])
    expect(r).toEqual({ cancelar: ['b'], mudar: [], novos: [] })
  })
})
