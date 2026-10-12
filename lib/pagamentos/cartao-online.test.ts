import { describe, expect, it } from 'vitest'
import { dadosAntifraude, limparDadosCartao, mensagemRecusa, resultadoDoStatus, tipoDoCartao } from './cartao-online'
import { divergencias } from './pix-online'
import type { PagamentoMp } from './mercadopago'

describe('cartão online — dados do navegador (só o token; nada do cartão)', () => {
  const ok = { token: 'abc123TOKENdoBrick', payment_method_id: 'master', issuer_id: '24', installments: 1, payer: { email: 'a@b.com', identification: { type: 'CPF', number: '12345678909' } } }
  it('aceita o que o Brick manda e ignora valor vindo do navegador', () => {
    const r = limparDadosCartao({ ...ok, transaction_amount: 0.01 }, 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.dados).toMatchObject({ token: 'abc123TOKENdoBrick', metodoId: 'master', emissorId: '24', parcelas: 1, email: 'a@b.com', documento: { tipo: 'CPF', numero: '12345678909' } })
      expect(JSON.stringify(r.dados)).not.toMatch(/0\.01|transaction_amount/)
    }
  })
  it('recusa número de cartão cru, token inválido e parcelas acima do permitido pela loja', () => {
    expect(limparDadosCartao({ ...ok, card_number: '4111111111111111' }, 1).ok).toBe(false)
    expect(limparDadosCartao({ ...ok, token: 'x' }, 1).ok).toBe(false)
    expect(limparDadosCartao({ ...ok, installments: 3 }, 1).ok).toBe(false)
    expect(limparDadosCartao({ ...ok, installments: 3 }, 3).ok).toBe(true)
    expect(limparDadosCartao({ ...ok, payment_method_id: '' }, 1).ok).toBe(false)
  })
})

describe('cartão online — resultado e mensagens', () => {
  it('status do MP → resultado para a tela', () => {
    expect(resultadoDoStatus('approved')).toBe('aprovado')
    expect(resultadoDoStatus('in_process')).toBe('em_analise')
    expect(resultadoDoStatus('pending')).toBe('em_analise')
    expect(resultadoDoStatus('rejected')).toBe('recusado')
    expect(resultadoDoStatus('cancelled')).toBe('recusado')
  })
  it('recusa com mensagem clara em português', () => {
    expect(mensagemRecusa('cc_rejected_insufficient_amount')).toMatch(/limite|saldo/i)
    expect(mensagemRecusa('cc_rejected_bad_filled_security_code')).toMatch(/código de segurança/i)
    expect(mensagemRecusa('cc_rejected_call_for_authorize')).toMatch(/banco/i)
    expect(mensagemRecusa('qualquer_outro')).toMatch(/outro cartão|outra forma/i)
  })
  it('crédito ou débito pelo tipo do MP', () => {
    expect(tipoDoCartao('credit_card')).toBe('credito')
    expect(tipoDoCartao('debit_card')).toBe('debito')
    expect(tipoDoCartao('ticket')).toBeNull()
  })
})

describe('conferência do pagamento: cartão aprovado só libera se for cartão, da loja, no valor do pedido', () => {
  const pg = (x: Partial<PagamentoMp>): PagamentoMp => ({ id: '1', status: 'approved', statusDetail: null, externalReference: 'P', valor: 50, moeda: 'BRL', coletorId: 'U', taxa: 2, liquido: 48, aprovadoEm: null, metodo: 'master', tipo: 'credit_card', ...x })
  const reg = { pedido_id: 'P', valor: 50, mp_user_id: 'U', metodo: 'cartao' }
  it('tudo certo → sem divergência', () => expect(divergencias(pg({}), reg, 'U', 50)).toEqual([]))
  it('Pix aprovado numa cobrança de cartão (ou outro valor/coletor) não libera', () => {
    expect(divergencias(pg({ metodo: 'pix', tipo: 'bank_transfer' }), reg, 'U', 50)).toContain('metodo')
    expect(divergencias(pg({ valor: 1 }), reg, 'U', 50)).toContain('valor')
    expect(divergencias(pg({ coletorId: 'X' }), reg, 'U', 50)).toContain('coletor')
  })
  it('Pix continua exigindo Pix', () => {
    expect(divergencias(pg({ metodo: 'master', tipo: 'credit_card' }), { ...reg, metodo: 'pix' }, 'U', 50)).toContain('metodo')
  })
})

describe('antifraude do MP: a cobrança leva os dados do pedido (nome, telefone, itens, endereço)', () => {
  const pedido = {
    numero: 300, tipo: 'entrega', cliente_nome: 'Felipe Perone da Silva', cliente_telefone: '(27) 99253-4407',
    endereco_rua: 'Rua A', endereco_numero: '10', endereco_cep: '29100-000', endereco_bairro: 'Centro', endereco_cidade: 'Vila Velha',
  }
  const itens = [{ item_id: 'i1', nome: 'X-Bacon', quantidade: 2, preco_unitario: 20 }, { item_id: null, nome: 'Coca', quantidade: 1, preco_unitario: 8 }]
  it('nome separado, telefone com DDD, itens e endereço de entrega', () => {
    const d = dadosAntifraude(pedido, itens, 'Menuzia Lanches & Cia')
    expect(d.nome).toEqual({ primeiro: 'Felipe', ultimo: 'Perone da Silva' })
    expect(d.additional_info.payer).toMatchObject({ first_name: 'Felipe', last_name: 'Perone da Silva', phone: { area_code: '27', number: '992534407' } })
    expect(d.additional_info.items).toEqual([
      { id: 'i1', title: 'X-Bacon', quantity: 2, unit_price: 20, category_id: 'food' },
      { id: 'item-2', title: 'Coca', quantity: 1, unit_price: 8, category_id: 'food' },
    ])
    expect(d.additional_info.shipments).toEqual({ receiver_address: { zip_code: '29100000', street_name: 'Rua A', street_number: '10', city_name: 'Vila Velha' } })
    expect(d.statement_descriptor).toMatch(/^[A-Z0-9 ]{1,13}$/)
  })
  it('retirada não manda endereço; nome de uma palavra repete no sobrenome', () => {
    const d = dadosAntifraude({ ...pedido, tipo: 'retirada', cliente_nome: 'Felipe' }, itens, 'X')
    expect(d.additional_info.shipments).toBeUndefined()
    expect(d.nome).toEqual({ primeiro: 'Felipe', ultimo: 'Felipe' })
  })
})
