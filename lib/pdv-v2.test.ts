import { describe, it, expect } from 'vitest'
import {
  atendimentoEfetivo,
  ehAcaoConta,
  PERMISSAO_DA_ACAO,
  ACOES_CONTA,
  permissoesDaConta,
  resumirDimensoes,
  sanearAberturaBalcao,
  sanearResolucao,
  situacaoFinanceira,
  telefoneParcial,
} from './pdv-v2'
import { pode, podeNoSalao, REGRAS_SALAO_PADRAO, type Permissao } from './auth/permissoes'
import { mensagemDeErroConta } from './conta'

const UUID = '11111111-2222-4333-8444-555555555555'
const UUID2 = '11111111-2222-4333-8444-666666666666'

describe('abertura do balcão', () => {
  it('nome obrigatório, aparado e com espaços colapsados', () => {
    expect(sanearAberturaBalcao({ nome: '   ', chave: UUID })).toEqual({ ok: false, erro: 'Informe o nome do cliente.' })
    expect(sanearAberturaBalcao({ nome: '  João   da  Silva ', chave: UUID })).toMatchObject({ ok: true, nome: 'João da Silva', telefone: null })
  })
  it('nome com mais de 60 caracteres é recusado', () => {
    expect(sanearAberturaBalcao({ nome: 'x'.repeat(61), chave: UUID }).ok).toBe(false)
  })
  it('telefone opcional vira só dígitos; inválido é recusado', () => {
    expect(sanearAberturaBalcao({ nome: 'Ana', telefone: '(27) 99999-0001', chave: UUID })).toMatchObject({ ok: true, telefone: '5527999990001' })
    expect(sanearAberturaBalcao({ nome: 'Ana', telefone: '123', chave: UUID }).ok).toBe(false)
    expect(sanearAberturaBalcao({ nome: 'Ana', telefone: 12345, chave: UUID }).ok).toBe(false)
  })
  it('sem chave não abre (clique duplo precisa ser idempotente)', () => {
    expect(sanearAberturaBalcao({ nome: 'Ana' }).ok).toBe(false)
  })
  it('campos extras são ignorados — não há como mandar loja, taxa ou senha', () => {
    const r = sanearAberturaBalcao({ nome: 'Ana', chave: UUID, restauranteId: UUID2, senha: 1, taxa: 10 })
    expect(r).toEqual({ ok: true, nome: 'Ana', telefone: null, chave: UUID, entrega: null })
  })
  it('telefone na lista aparece só em parte', () => {
    expect(telefoneParcial('27999990001')).toBe('(27) …0001')
    expect(telefoneParcial('5527999990001')).toBe('(27) …0001')
    expect(telefoneParcial(null)).toBe('')
  })
})

describe('dimensões', () => {
  it('pedido legado (atendimento NULL) entregue conta como atendido; em aberto, aguarda', () => {
    expect(atendimentoEfetivo({ status: 'entregue', atendimentoStatus: null }, 'mesa')).toBe('servido')
    expect(atendimentoEfetivo({ status: 'entregue', atendimentoStatus: null }, 'balcao')).toBe('entregue_balcao')
    expect(atendimentoEfetivo({ status: 'pronto', atendimentoStatus: null }, 'balcao')).toBe('aguardando_retirada')
    expect(atendimentoEfetivo({ status: 'cancelado', atendimentoStatus: 'aguardando_servico' }, 'mesa')).toBeNull()
  })
  it('situação financeira', () => {
    expect(situacaoFinanceira(0, 0)).toBe('nao_pago')
    expect(situacaoFinanceira(50, 0)).toBe('nao_pago')
    expect(situacaoFinanceira(50, 20)).toBe('parcial')
    expect(situacaoFinanceira(50, 50)).toBe('pago')
    expect(situacaoFinanceira(50, 0, 1)).toBe('estornado')
  })
  it('resumo de cozinha e atendimento ignora cancelados', () => {
    const r = resumirDimensoes(
      [
        { status: 'recebido', atendimentoStatus: 'aguardando_retirada' },
        { status: 'preparando', atendimentoStatus: 'aguardando_retirada' },
        { status: 'entregue', atendimentoStatus: 'entregue_balcao' },
        { status: 'cancelado', atendimentoStatus: null },
      ],
      'balcao',
    )
    expect(r.cozinha).toEqual({ aguardando: 1, preparo: 1, pronto: 0 })
    expect(r.atendimento).toEqual({ aguardando: 2, atendidos: 1 })
    expect(r.texto.cozinha).toBe('1 aguardando · 1 em preparo')
  })
})

describe('permissões das ações', () => {
  it('toda ação tem permissão registrada', () => {
    for (const a of ACOES_CONTA) expect(PERMISSAO_DA_ACAO[a]).toBeTruthy()
    expect(ehAcaoConta('pagamento')).toBe(true)
    expect(ehAcaoConta('apagar_tudo')).toBe(false)
  })
  it('atendente: recebe, fecha, entrega, cancela só recebido; não estorna, não força, não reabre', () => {
    const p = permissoesDaConta((x: Permissao) => podeNoSalao('atendente', x, REGRAS_SALAO_PADRAO), 'balcao')
    expect(p.pagamento && p.fechar && p.atender && p.cancelar_pedido && p.lancar).toBe(true)
    expect(p.estorno || p.resolver || p.reabrir || p.cancelar_qualquer || p.decidir_cancelamento).toBe(false)
    expect(p.ajustar_valores).toBe(false)
  })
  it('atendente com caixa_desconto ligado ajusta valores', () => {
    const p = permissoesDaConta((x: Permissao) => podeNoSalao('atendente', x, { ...REGRAS_SALAO_PADRAO, caixaDesconto: true }), 'balcao')
    expect(p.ajustar_valores).toBe(true)
  })
  it('gerente e dono resolvem à força, reabrem e estornam', () => {
    for (const papel of ['gerente', 'dono']) {
      const p = permissoesDaConta((x: Permissao) => pode(papel, x), 'mesa')
      expect(p.resolver && p.reabrir && p.estorno && p.cancelar_qualquer).toBe(true)
    }
  })
  it('garçom não opera balcão nem cancela direto', () => {
    expect(pode('garcom', 'balcao.abrir')).toBe(false)
    expect(pode('garcom', 'pedidos.presencial.cancelar_recebido')).toBe(false)
    expect(pode('garcom', 'pedidos.presencial.atender')).toBe(true)
  })
  it('cozinha não mexe em conta', () => {
    const p = permissoesDaConta((x: Permissao) => pode('cozinha', x), 'mesa')
    expect(Object.values(p).some(Boolean)).toBe(false)
  })
})

describe('resolução forçada', () => {
  it('só "marcar atendido" não exige motivo', () => {
    expect(sanearResolucao({ acoes: [{ pedido_id: UUID, acao: 'marcar_atendido' }] })).toMatchObject({ ok: true })
  })
  it('ação forçada exige motivo de 5+ letras e confirmação', () => {
    const acoes = [{ pedido_id: UUID, acao: 'forcar_atendido' }]
    expect(sanearResolucao({ acoes, motivo: 'abc', confirmacao: true }).ok).toBe(false)
    expect(sanearResolucao({ acoes, motivo: 'cliente foi embora' }).ok).toBe(false)
    expect(sanearResolucao({ acoes, motivo: 'cliente foi embora', confirmacao: true })).toMatchObject({ ok: true, fechar: false })
  })
  it('recusa pedido repetido, ação desconhecida e cancelar itens sem itens', () => {
    expect(sanearResolucao({ acoes: [{ pedido_id: UUID, acao: 'marcar_atendido' }, { pedido_id: UUID, acao: 'marcar_atendido' }] }).ok).toBe(false)
    expect(sanearResolucao({ acoes: [{ pedido_id: UUID, acao: 'apagar' }], motivo: 'motivo longo', confirmacao: true }).ok).toBe(false)
    expect(sanearResolucao({ acoes: [{ pedido_id: UUID, acao: 'cancelar_itens' }], motivo: 'motivo longo', confirmacao: true }).ok).toBe(false)
    expect(sanearResolucao({ acoes: [{ pedido_id: UUID, acao: 'cancelar_itens', item_ids: [UUID2, 'x'] }], motivo: 'motivo longo', confirmacao: true }))
      .toMatchObject({ ok: true, acoes: [{ item_ids: [UUID2] }] })
  })
})

describe('mensagens dos erros novos do banco', () => {
  it('traduz conflito de status com a etapa real', () => {
    expect(mensagemDeErroConta('conflito_status:preparando')).toContain('em preparo')
  })
  it('ajuste financeiro mostra o excedente em reais', () => {
    expect(mensagemDeErroConta('ajuste_financeiro_necessario:8.00')).toContain('R$')
  })
  it('atendente sem alçada recebe orientação de pedir à gerência', () => {
    expect(mensagemDeErroConta('cancelamento_requer_gestao')).toContain('gerência')
  })
  it('código desconhecido não vaza', () => {
    expect(mensagemDeErroConta('relation "x" does not exist')).toBe('Não foi possível concluir a operação.')
  })
})
