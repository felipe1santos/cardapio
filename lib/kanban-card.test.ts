import { describe, expect, it } from 'vitest'
import { acaoDoCard, iconesDoTipo, itensDoCard, logoDaOrigem, pagamentoDoCard, type PedidoCard } from './kanban-card'

const base: PedidoCard = {
  status: 'recebido', tipo: 'entrega', canal: 'delivery', origem: 'cardapio', mesa: null, lancadoVia: null,
  origemCanal: null, origemCampanha: null, formaPagamento: 'dinheiro', pagamentoOnline: false, pago: false, trocoPara: null,
}

describe('ícones do tipo (linha 1)', () => {
  it('entrega 🛵, retirada 🛍️, mesa 🍽️, balcão 🏪; ✍️ quando anotado pelo WhatsApp (IA)', () => {
    expect(iconesDoTipo(base).map((i) => i.emoji)).toEqual(['🛵'])
    expect(iconesDoTipo({ ...base, tipo: 'retirada' }).map((i) => i.emoji)).toEqual(['🛍️'])
    expect(iconesDoTipo({ ...base, canal: 'mesa', origem: 'pdv', mesa: '4' }).map((i) => i.emoji)).toEqual(['🍽️'])
    expect(iconesDoTipo({ ...base, canal: 'balcao', origem: 'pdv', tipo: 'retirada' }).map((i) => i.emoji)).toEqual(['🏪'])
    expect(iconesDoTipo({ ...base, origemCanal: 'whatsapp_ia' })).toEqual([{ emoji: '🛵', rotulo: 'Entrega' }, { emoji: '✍️', rotulo: 'Anotado pelo WhatsApp' }])
  })
})

describe('forma de pagamento (etiqueta embaixo do valor)', () => {
  it('dinheiro (com troco), Pix, Pix pago, cartão na entrega/retirada, na conta (mesa)', () => {
    expect(pagamentoDoCard(base)).toEqual({ texto: 'Dinheiro', icone: 'dinheiro' })
    expect(pagamentoDoCard({ ...base, trocoPara: 50 })).toEqual({ texto: 'Dinheiro · troco p/ R$ 50,00', icone: 'dinheiro' })
    expect(pagamentoDoCard({ ...base, pago: true })).toEqual({ texto: 'Dinheiro pago', icone: 'dinheiro' })
    expect(pagamentoDoCard({ ...base, formaPagamento: 'pix' })).toEqual({ texto: 'Pix', icone: 'pix' })
    expect(pagamentoDoCard({ ...base, formaPagamento: 'pix', pago: true })).toEqual({ texto: 'Pix pago', icone: 'pix' })
    expect(pagamentoDoCard({ ...base, formaPagamento: 'cartao' })).toEqual({ texto: 'Cartão na entrega', icone: 'cartao' })
    expect(pagamentoDoCard({ ...base, formaPagamento: 'cartao', tipo: 'retirada' })).toEqual({ texto: 'Cartão na retirada', icone: 'cartao' })
    expect(pagamentoDoCard({ ...base, canal: 'mesa', origem: 'pdv' })).toEqual({ texto: 'Na conta', icone: 'conta' })
  })
  it('pago online (Pix ou cartão pelo Mercado Pago): ícone do Mercado Pago + "Pago"', () => {
    expect(pagamentoDoCard({ ...base, formaPagamento: 'pix', pagamentoOnline: true, pago: true })).toEqual({ texto: 'Pago', icone: 'mercado_pago' })
    expect(pagamentoDoCard({ ...base, formaPagamento: 'cartao', pagamentoOnline: true, pago: true })).toEqual({ texto: 'Pago', icone: 'mercado_pago' })
    expect(pagamentoDoCard({ ...base, formaPagamento: 'pix', pagamentoOnline: true, pago: false })).toEqual({ texto: 'Aguardando pagamento', icone: 'mercado_pago' })
  })
})

describe('logo da origem (ponta direita), do campo de origem que já existe', () => {
  it('canais de aquisição com logo oficial', () => {
    expect(logoDaOrigem({ ...base, origemCanal: 'whatsapp' })).toMatchObject({ arquivo: '/origens/whatsapp.svg', rotulo: 'WhatsApp' })
    expect(logoDaOrigem({ ...base, origemCanal: 'whatsapp_ia' })).toMatchObject({ arquivo: '/origens/whatsapp.svg', rotulo: 'WhatsApp (IA)' })
    expect(logoDaOrigem({ ...base, origemCanal: 'instagram' })).toMatchObject({ arquivo: '/origens/instagram.svg' })
    expect(logoDaOrigem({ ...base, origemCanal: 'facebook' })).toMatchObject({ arquivo: '/origens/facebook.svg' })
    expect(logoDaOrigem({ ...base, origemCanal: 'meta' })).toMatchObject({ arquivo: '/origens/meta.svg', rotulo: 'Anúncio Meta' })
    expect(logoDaOrigem({ ...base, origemCanal: 'google_anuncio' })).toMatchObject({ arquivo: '/origens/google-ads.svg', rotulo: 'Anúncio Google' })
    expect(logoDaOrigem({ ...base, origemCanal: 'google_busca' })).toMatchObject({ arquivo: '/origens/google.svg', rotulo: 'Google' })
    expect(logoDaOrigem({ ...base, origemCanal: 'ifood' })).toMatchObject({ arquivo: '/origens/ifood.svg', rotulo: 'iFood' })
  })
  it('app, cardápio, PDV, mesa e o que não tem logo oficial', () => {
    expect(logoDaOrigem({ ...base, origemCanal: 'push' })).toMatchObject({ arquivo: '/origens/menuzia.png', selo: 'sino', rotulo: 'Notificação do app' })
    expect(logoDaOrigem({ ...base, origemCanal: 'direto' })).toMatchObject({ arquivo: '/origens/menuzia.png', rotulo: 'Cardápio' })
    expect(logoDaOrigem(base)).toMatchObject({ arquivo: '/origens/menuzia.png', rotulo: 'Cardápio' })
    expect(logoDaOrigem({ ...base, canal: 'balcao', origem: 'pdv', tipo: 'retirada' })).toMatchObject({ arquivo: null, neutro: 'pdv', rotulo: 'PDV' })
    expect(logoDaOrigem({ ...base, canal: 'mesa', origem: 'pdv', mesa: '4' })).toMatchObject({ arquivo: null, neutro: 'mesa' })
    expect(logoDaOrigem({ ...base, origemCanal: '99food' })).toMatchObject({ arquivo: null, neutro: 'nome', rotulo: '99Food' })
    expect(logoDaOrigem({ ...base, origemCanal: 'qrcode' })).toMatchObject({ arquivo: null, neutro: 'qrcode' })
  })
})

describe('itens: no máximo 2 linhas (ajuste do dono 13/10 v2)', () => {
  const um = [{ quantidade: 2, nome: 'Smash Duplo' }], dois = [...um, { quantidade: 1, nome: 'Batata' }], tres = [...dois, { quantidade: 1, nome: 'Coca' }]
  it('1 ou 2 itens: mostra todos', () => {
    expect(itensDoCard(um)).toEqual({ linhas: um, resto: 0 })
    expect(itensDoCard(dois)).toEqual({ linhas: dois, resto: 0 })
  })
  it('mais de 2: os 2 primeiros e o resto ("+N" na linha do 2º)', () => {
    expect(itensDoCard(tres)).toEqual({ linhas: dois, resto: 1 })
    expect(itensDoCard([...tres, { quantidade: 1, nome: 'Pudim' }, { quantidade: 3, nome: 'Água' }])).toEqual({ linhas: dois, resto: 3 })
  })
})

describe('setinha de avançar: a MESMA ação dos botões de hoje', () => {
  it('recebido → aceitar; preparando → pronto; pronto retirada → entregue', () => {
    expect(acaoDoCard(base, true)).toBe('aceitar')
    expect(acaoDoCard({ ...base, status: 'preparando' }, true)).toBe('pronto')
    expect(acaoDoCard({ ...base, status: 'pronto', tipo: 'retirada' }, true)).toBe('entregue')
  })
  it('pronto entrega: despachar (com o despacho de rotas) ou saiu p/ entrega (sem)', () => {
    expect(acaoDoCard({ ...base, status: 'pronto' }, true)).toBe('despachar')
    expect(acaoDoCard({ ...base, status: 'pronto' }, false)).toBe('saiu')
  })
  it('em rota / entregue: sem setinha', () => {
    expect(acaoDoCard({ ...base, status: 'em_rota' }, true)).toBeNull()
  })
})
