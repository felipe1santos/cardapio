import { describe, expect, it } from 'vitest'
import { acaoV3, estadosDasEtapas, iniciais, linkDoMapa, pagamentoV3, rotuloDaAcao, selosDoCard, situacaoPagamento, type PedidoV3 } from './kanban-v3'

const base: PedidoV3 = {
  status: 'recebido', tipo: 'entrega', canal: 'delivery', origem: 'cardapio', mesa: null, lancadoVia: null,
  origemCanal: null, origemCampanha: null, formaPagamento: 'dinheiro', pagamentoOnline: false, pago: false, trocoPara: null,
  enderecoBairro: 'Jaburuna', total: 64.8,
}

describe('selos do card (linha 2)', () => {
  it('tipo no selo verde: Entrega, Retirada, Mesa X, Balcão', () => {
    expect(selosDoCard(base).tipo).toEqual({ emoji: '🛵', texto: 'Entrega' })
    expect(selosDoCard({ ...base, tipo: 'retirada' }).tipo).toEqual({ emoji: '🛍️', texto: 'Retirada' })
    expect(selosDoCard({ ...base, canal: 'mesa', origem: 'pdv', mesa: '7' }).tipo).toEqual({ emoji: '🍽️', texto: 'Mesa 7' })
    expect(selosDoCard({ ...base, canal: 'balcao', origem: 'pdv', tipo: 'retirada' }).tipo).toEqual({ emoji: '🏪', texto: 'Balcão' })
  })
  it('selo azul: "Anotado no WhatsApp" no pedido da IA; senão o bairro da entrega; senão nada', () => {
    expect(selosDoCard({ ...base, origemCanal: 'whatsapp_ia' }).azul).toEqual({ emoji: '✍️', texto: 'Anotado no WhatsApp' })
    expect(selosDoCard(base).azul).toEqual({ emoji: null, texto: 'Jaburuna' })
    expect(selosDoCard({ ...base, enderecoBairro: '  ' }).azul).toBeNull()
    expect(selosDoCard({ ...base, tipo: 'retirada' }).azul).toBeNull()
  })
})

describe('pagamento (verde = na entrega/Pix pago; azul = pago no app)', () => {
  it('dinheiro, com troco', () => {
    expect(pagamentoV3(base)).toEqual({ emoji: '💵', texto: 'Dinheiro', tom: 'verde' })
    expect(pagamentoV3({ ...base, trocoPara: 100 })).toEqual({ emoji: '💵', texto: 'Dinheiro · troco p/ R$ 100', tom: 'verde' })
  })
  it('cartão na entrega/retirada e Pix pago em verde', () => {
    expect(pagamentoV3({ ...base, formaPagamento: 'cartao' })).toMatchObject({ texto: 'Cartão na entrega', tom: 'verde' })
    expect(pagamentoV3({ ...base, formaPagamento: 'cartao', tipo: 'retirada' })).toMatchObject({ texto: 'Cartão na retirada', tom: 'verde' })
    expect(pagamentoV3({ ...base, formaPagamento: 'pix', pago: true })).toMatchObject({ texto: 'Pix pago', tom: 'verde' })
  })
  it('pago online em azul; online ainda não pago em âmbar', () => {
    expect(pagamentoV3({ ...base, formaPagamento: 'pix', pagamentoOnline: true, pago: true })).toEqual({ emoji: '✅', texto: 'Pago no app', tom: 'azul' })
    expect(pagamentoV3({ ...base, formaPagamento: 'cartao', pagamentoOnline: true, pago: true })).toMatchObject({ texto: 'Pago no app', tom: 'azul' })
    expect(pagamentoV3({ ...base, formaPagamento: 'pix', pagamentoOnline: true, pago: false })).toMatchObject({ texto: 'Aguardando pagamento', tom: 'ambar' })
  })
  it('mesa: na conta', () => {
    expect(pagamentoV3({ ...base, canal: 'mesa', origem: 'pdv' })).toMatchObject({ texto: 'Na conta', tom: 'verde' })
  })
  it('situação do pagamento no painel: Pago (azul) ou A receber (âmbar)', () => {
    expect(situacaoPagamento({ ...base, pago: true })).toEqual({ texto: 'Pago', tom: 'azul' })
    expect(situacaoPagamento(base)).toEqual({ texto: 'A receber', tom: 'ambar' })
  })
})

describe('seta do card e botão principal do painel: a MESMA ação de hoje', () => {
  it('recebido → aceitar; preparando → pronto; pronto retirada → entregue; pronto entrega → despachar/saiu', () => {
    expect(acaoV3(base, { despacho: true, concluirEmRota: false })).toBe('aceitar')
    expect(acaoV3({ ...base, status: 'preparando' }, { despacho: true, concluirEmRota: false })).toBe('pronto')
    expect(acaoV3({ ...base, status: 'pronto', tipo: 'retirada' }, { despacho: true, concluirEmRota: false })).toBe('entregue')
    expect(acaoV3({ ...base, status: 'pronto' }, { despacho: true, concluirEmRota: false })).toBe('despachar')
    expect(acaoV3({ ...base, status: 'pronto' }, { despacho: false, concluirEmRota: false })).toBe('saiu')
  })
  it('em trânsito → confirmar entrega só quando a loja já confirma pelo Kanban (sem Logística)', () => {
    expect(acaoV3({ ...base, status: 'em_rota' }, { despacho: true, concluirEmRota: true })).toBe('confirmar')
    expect(acaoV3({ ...base, status: 'em_rota' }, { despacho: true, concluirEmRota: false })).toBeNull()
    expect(acaoV3({ ...base, status: 'entregue' }, { despacho: true, concluirEmRota: true })).toBeNull()
  })
  it('rótulos do botão principal', () => {
    expect(rotuloDaAcao('aceitar')).toBe('Aceitar pedido')
    expect(rotuloDaAcao('pronto')).toBe('Marcar como pronto')
    expect(rotuloDaAcao('despachar')).toBe('Despachar')
    expect(rotuloDaAcao('confirmar')).toBe('Confirmar entrega')
    expect(rotuloDaAcao('entregue')).toBe('Marcar como entregue')
    expect(rotuloDaAcao('saiu')).toBe('Saiu para entrega')
  })
})

describe('barra de etapas do painel', () => {
  const etapas = [{ id: 'recebido' }, { id: 'preparando' }, { id: 'pronto' }, { id: 'em_rota' }, { id: 'entregue' }]
  it('concluídas, atual e próximas', () => {
    expect(estadosDasEtapas(etapas, 'pronto')).toEqual(['feita', 'feita', 'atual', 'proxima', 'proxima'])
    expect(estadosDasEtapas(etapas, 'recebido')).toEqual(['atual', 'proxima', 'proxima', 'proxima', 'proxima'])
  })
  it('entregue: tudo concluído; cancelado: nada marcado como atual', () => {
    expect(estadosDasEtapas(etapas, 'entregue')).toEqual(['feita', 'feita', 'feita', 'feita', 'feita'])
    expect(estadosDasEtapas(etapas, 'cancelado')).toEqual(['proxima', 'proxima', 'proxima', 'proxima', 'proxima'])
  })
})

describe('apoio do painel', () => {
  it('iniciais do cliente', () => {
    expect(iniciais('Ana Ribeiro')).toBe('AR')
    expect(iniciais('felipe')).toBe('F')
    expect(iniciais('  ')).toBe('?')
    expect(iniciais('Maria da Silva Santos')).toBe('MS')
  })
  it('link do mapa com o endereço (só um link aberto pelo operador, nenhuma API)', () => {
    const url = linkDoMapa({ enderecoRua: 'Rua A', enderecoNumero: '10', enderecoBairro: 'Centro', enderecoCidade: 'Vila Velha' })
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=Rua%20A%2C%2010%2C%20Centro%2C%20Vila%20Velha')
  })
})
