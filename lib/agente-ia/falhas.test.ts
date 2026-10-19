import { describe, expect, it } from 'vitest'
import { falhaDoPedido } from './falhas'
import { FalhaPedido } from './pedido'

const loja = { aceitaEntrega: true, aceitaRetirada: false, proximaAbertura: 'A loja abre amanhã às 18:00' }

describe('falhas do pedido viram texto humano (19/10, auditoria da Ponto 400): nunca erro técnico ao cliente', () => {
  it('retirada desligada (bárbarah 18/10): só entrega, pergunta o endereço e troca o tipo', () => {
    const f = falhaDoPedido(new FalhaPedido('sem_retirada', 'A loja não está aceitando retirada agora.'), loja)
    expect(f).toEqual({ codigo: 'sem_retirada', texto: 'No momento estamos só com entrega 🛵 Posso mandar pro seu endereço?', atendente: false, ajustarTipo: 'entrega' })
  })
  it('entrega desligada: só retirada', () => {
    const f = falhaDoPedido(new FalhaPedido('sem_entrega', 'x'), { ...loja, aceitaRetirada: true, aceitaEntrega: false })
    expect(f.texto).toBe('No momento estamos só com retirada no balcão 🛍️ Quer retirar?')
    expect(f.ajustarTipo).toBe('retirada')
  })
  it('loja fechada (AA7 17/10): pedido fica guardado, diz quando abre, sem "não consegui fechar"', () => {
    const f = falhaDoPedido(new FalhaPedido('fechada', 'A loja está fechada agora; o pedido não pode ser feito.'), loja)
    expect(f.texto).toBe('A loja está fechada agora 😕 A loja abre amanhã às 18:00.\n\nSeu pedido ficou anotado: quando abrir, é só me chamar que eu fecho pra você.')
    expect(f.atendente).toBe(false)
    expect(falhaDoPedido(new FalhaPedido('fechada', 'x'), { ...loja, proximaAbertura: null }).texto).toContain('A loja está fechada agora 😕\n\nSeu pedido ficou anotado')
  })
  it('fora da área: avisa com educação e chama o atendente com o que o cliente queria', () => {
    const f = falhaDoPedido(new FalhaPedido('fora_da_area', 'Não entregamos nesse bairro.'), loja, 'X-Tudo e Coca 2L, entrega na Rua A, 10')
    expect(f.texto).toBe('Esse endereço fica fora da nossa área de entrega 😕 Já chamei alguém da loja para ver o que dá pra fazer, só um instante 🙏')
    expect(f.atendente).toBe(true)
    expect(f.resumo).toBe('Fora da área de entrega — X-Tudo e Coca 2L, entrega na Rua A, 10')
  })
  it('item indisponível: pede outra opção', () => {
    const f = falhaDoPedido(new Error('Item "X-Bacon" indisponível no momento.'), loja)
    expect(f.codigo).toBe('item')
    expect(f.texto).toBe('Um item do pedido acabou de ficar indisponível 😕 Quer trocar por outro do cardápio? Me fala qual.')
  })
  it('erro desconhecido: pede desculpas e chama o atendente (nunca mostra a mensagem técnica)', () => {
    const f = falhaDoPedido(new Error('column foo does not exist'), loja, 'pedido do cliente')
    expect(f.codigo).toBe('outro')
    expect(f.texto).toBe('Tive um problema para fechar o pedido aqui 😕 Já chamei alguém da loja para continuar com você, só um instante 🙏')
    expect(f.texto).not.toContain('column')
    expect(f.atendente).toBe(true)
  })
})
