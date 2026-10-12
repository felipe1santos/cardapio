import { describe, expect, it } from 'vitest'
import { planoAlteracao, type PedidoPos } from './pos-pedido'

const ped = (x: Partial<PedidoPos> = {}): PedidoPos => ({
  id: 'p1', numero: 287, status: 'recebido', forma_pagamento: 'cartao', pago: false, pagamento_online: false, impresso: false,
  cancelado_motivo: null, total: 25, ...x,
})
const loja = { pixOnline: true, pixChave: true }
const pixPendente = ped({ status: 'aguardando_pagamento', forma_pagamento: 'pix', pagamento_online: true })

describe('pedido já criado: o que a IA pode fazer sozinha (12/10)', () => {
  it('Pix ainda NÃO pago → cartão ou dinheiro: cancela a cobrança e manda para a cozinha', () => {
    expect(planoAlteracao(pixPendente, 'trocar_pagamento', 'cartao', loja)).toEqual({ tipo: 'pix_para_entrega' })
    expect(planoAlteracao(pixPendente, 'trocar_pagamento', 'dinheiro', loja)).toEqual({ tipo: 'pix_para_entrega' })
  })
  it('Pix já PAGO: não troca, chama atendente', () => {
    const pago = ped({ status: 'recebido', forma_pagamento: 'pix', pagamento_online: true, pago: true })
    expect(planoAlteracao(pago, 'trocar_pagamento', 'cartao', loja)).toEqual({ tipo: 'atendente', motivo: 'Alteração do pedido #287 (Pix já pago)' })
  })
  it('cartão/dinheiro → Pix antes de aceitar: gera o Pix online (se ainda não foi impresso); impresso → atendente', () => {
    expect(planoAlteracao(ped(), 'trocar_pagamento', 'pix', loja)).toEqual({ tipo: 'para_pix_online' })
    expect(planoAlteracao(ped({ impresso: true }), 'trocar_pagamento', 'pix', loja).tipo).toBe('atendente')
    // Sem Pix online: chave cadastrada; impresso → reimprime com a forma certa.
    expect(planoAlteracao(ped({ impresso: true }), 'trocar_pagamento', 'pix', { pixOnline: false, pixChave: true })).toEqual({ tipo: 'trocar_simples', reimprimir: true })
    expect(planoAlteracao(ped(), 'trocar_pagamento', 'pix', { pixOnline: false, pixChave: false }).tipo).toBe('info')
  })
  it('cartão ↔ dinheiro antes de aceitar: troca (e reimprime se já saiu o papel)', () => {
    expect(planoAlteracao(ped(), 'trocar_pagamento', 'dinheiro', loja)).toEqual({ tipo: 'trocar_simples', reimprimir: false })
    expect(planoAlteracao(ped({ impresso: true }), 'trocar_pagamento', 'dinheiro', loja)).toEqual({ tipo: 'trocar_simples', reimprimir: true })
  })
  it('depois de aceito (preparando, pronto, em rota): trocar pagamento → atendente', () => {
    for (const status of ['preparando', 'pronto', 'em_rota']) {
      expect(planoAlteracao(ped({ status }), 'trocar_pagamento', 'dinheiro', loja)).toEqual({ tipo: 'atendente', motivo: 'Alteração do pedido #287' })
    }
  })
  it('no Kanban: cancelar → atendente "Cancelamento"; itens/endereço → atendente "Alteração"', () => {
    for (const status of ['recebido', 'preparando', 'pronto', 'em_rota']) {
      expect(planoAlteracao(ped({ status }), 'cancelar', undefined, loja)).toEqual({ tipo: 'atendente', motivo: 'Cancelamento do pedido #287' })
      expect(planoAlteracao(ped({ status }), 'alterar_endereco', undefined, loja)).toEqual({ tipo: 'atendente', motivo: 'Alteração do pedido #287' })
      expect(planoAlteracao(ped({ status }), 'alterar_itens', undefined, loja)).toEqual({ tipo: 'atendente', motivo: 'Alteração do pedido #287' })
    }
  })
  it('Pix pendente (ainda fora do Kanban): cancelar = cancela a cobrança e o pedido; mudar itens → atendente', () => {
    expect(planoAlteracao(pixPendente, 'cancelar', undefined, loja)).toEqual({ tipo: 'cancelar_pix_pendente' })
    expect(planoAlteracao(pixPendente, 'alterar_itens', undefined, loja).tipo).toBe('atendente')
  })
  it('Pix expirado: trocar pagamento (ou gerar outro Pix) remonta o mesmo pedido e manda o resumo', () => {
    const exp = ped({ status: 'cancelado', cancelado_motivo: 'pix_expirado', forma_pagamento: 'pix' })
    expect(planoAlteracao(exp, 'trocar_pagamento', 'cartao', loja)).toEqual({ tipo: 'remontar' })
    expect(planoAlteracao(exp, 'trocar_pagamento', 'pix', loja)).toEqual({ tipo: 'remontar' })
    expect(planoAlteracao(exp, 'cancelar', undefined, loja).tipo).toBe('info')
  })
  it('mesma forma: só informa; entregue → atendente', () => {
    expect(planoAlteracao(ped(), 'trocar_pagamento', 'cartao', loja).tipo).toBe('info')
    expect(planoAlteracao(ped({ status: 'entregue' }), 'cancelar', undefined, loja).tipo).toBe('atendente')
  })
})
