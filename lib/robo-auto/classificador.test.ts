import { describe, expect, it } from 'vitest'
import { classificar, normalizarTexto, opcaoDoMenu, type Intencao } from './classificador'

/**
 * Frases reais (gíria, abreviação e erro de digitação) → assunto esperado.
 * O classificador tem que acertar TODAS (pedido do dono, 10/10/2026).
 */
const FRASES: [string, Intencao][] = [
  // saudação
  ['oi', 'saudacao'], ['oii', 'saudacao'], ['oiiiii', 'saudacao'], ['Olá', 'saudacao'], ['ola boa noite', 'saudacao'],
  ['bom dia', 'saudacao'], ['Bom diaa!', 'saudacao'], ['boa tarde', 'saudacao'], ['boa noite', 'saudacao'], ['boa noitee', 'saudacao'],
  ['opa', 'saudacao'], ['eai', 'saudacao'], ['e aí', 'saudacao'], ['salve', 'saudacao'], ['oi tudo bem?', 'saudacao'],
  ['tudo bem?', 'saudacao'], ['oie', 'saudacao'], ['hello', 'saudacao'], ['Oi, boa tarde!', 'saudacao'], ['bao noite', 'saudacao'],
  // cardápio
  ['cardapio', 'cardapio'], ['manda o cardápio', 'cardapio'], ['qual o cardapio', 'cardapio'], ['cardapo', 'cardapio'], ['cardapiu', 'cardapio'],
  ['me passa o menu', 'cardapio'], ['quero fazer um pedido', 'cardapio'], ['quero pedir', 'cardapio'], ['como faço pra pedir?', 'cardapio'],
  ['tem link?', 'cardapio'], ['manda o link', 'cardapio'], ['quais os sabores de pizza?', 'cardapio'], ['quanto custa o x-tudo?', 'cardapio'],
  ['qual o preço do combo', 'cardapio'], ['tem promoção hoje?', 'cardapio'], ['quero um lanche', 'cardapio'], ['vcs tem açaí?', 'cardapio'],
  ['o que vcs tem ai', 'cardapio'], ['quero encomendar', 'cardapio'], ['valores dos lanches', 'cardapio'],
  // entrega
  ['vcs entregam no centro?', 'entrega'], ['qnto ta a taxa pro ibes', 'entrega'], ['qual a taxa de entrega?', 'entrega'], ['taxa', 'entrega'],
  ['quanto é o frete?', 'entrega'], ['entrega em vila velha?', 'entrega'], ['voces fazem entrega', 'entrega'], ['tem delivery?', 'entrega'],
  ['quanto fica a entrega pra praia do canto', 'entrega'], ['entregam na glória?', 'entrega'], ['qnt tempo demora a entrega', 'entrega'],
  ['tempo de entrega', 'entrega'], ['taxa pro jardim camburi', 'entrega'], ['vcs chegam ate itapua?', 'entrega'], ['faz entrega aqui no bairro?', 'entrega'],
  ['qto é a taxa', 'entrega'], ['taxx de entrega', 'entrega'], ['frete pro centro', 'entrega'], ['entregao no ibes?', 'entrega'], ['atendem o bairro jockey?', 'entrega'],
  // status do pedido
  ['meu lanche ja saiu?', 'status_pedido'], ['cadê meu pedido', 'status_pedido'], ['cade meu pedido?', 'status_pedido'], ['meu pedido ja saiu', 'status_pedido'],
  ['status do pedido', 'status_pedido'], ['o pedido ta pronto?', 'status_pedido'], ['minha pizza vai demorar?', 'status_pedido'],
  ['já saiu pra entrega?', 'status_pedido'], ['o motoboy ta vindo?', 'status_pedido'], ['ta chegando?', 'status_pedido'], ['quanto tempo falta?', 'status_pedido'],
  ['acompanhar pedido', 'status_pedido'], ['meu pedido', 'status_pedido'], ['ja entregou?', 'status_pedido'], ['onde esta meu pedido', 'status_pedido'],
  ['meu açaí ja ta pronto?', 'status_pedido'], ['o entregador ja saiu?', 'status_pedido'], ['pedido ja foi?', 'status_pedido'], ['ta demorando', 'status_pedido'],
  ['meu pedidu', 'status_pedido'],
  // horário
  ['q horas fecha', 'horario'], ['que horas abre?', 'horario'], ['vcs estão abertos?', 'horario'], ['ta aberto?', 'horario'], ['horario de funcionamento', 'horario'],
  ['qual o horário?', 'horario'], ['abre hoje?', 'horario'], ['até que horas vcs funcionam', 'horario'], ['estão atendendo?', 'horario'], ['fecha que horas', 'horario'],
  ['funciona domingo?', 'horario'], ['horario', 'horario'], ['horaio', 'horario'], ['vcs abrem que hora', 'horario'], ['hj tem?', 'horario'],
  // pagamento e Pix
  ['aceita pix?', 'pagamento_pix'], ['qual a chave pix', 'pagamento_pix'], ['manda o pix', 'pagamento_pix'], ['aceita cartão?', 'pagamento_pix'],
  ['formas de pagamento', 'pagamento_pix'], ['pode ser no débito?', 'pagamento_pix'], ['aceitam credito', 'pagamento_pix'], ['posso pagar em dinheiro?', 'pagamento_pix'],
  ['tem troco pra 100?', 'pagamento_pix'], ['como faço o pagamento', 'pagamento_pix'], ['pix', 'pagamento_pix'], ['chave', 'pagamento_pix'],
  ['aceita vale refeição?', 'pagamento_pix'], ['passa cartao?', 'pagamento_pix'], ['qual o pics', 'pagamento_pix'],
  // endereço e retirada
  ['qual o endereço?', 'endereco_retirada'], ['onde fica a loja', 'endereco_retirada'], ['onde vcs ficam?', 'endereco_retirada'], ['posso retirar ai?', 'endereco_retirada'],
  ['da pra buscar ai?', 'endereco_retirada'], ['tem retirada?', 'endereco_retirada'], ['vou buscar no balcão', 'endereco_retirada'], ['qual a localização', 'endereco_retirada'],
  ['endereco', 'endereco_retirada'], ['como chego ai?', 'endereco_retirada'], ['enderesso', 'endereco_retirada'], ['posso pegar ai na loja?', 'endereco_retirada'],
  // reclamação
  ['meu lanche veio errado', 'reclamacao'], ['a pizza chegou fria', 'reclamacao'], ['veio faltando a batata', 'reclamacao'], ['pedido atrasado demais', 'reclamacao'],
  ['quero reclamar', 'reclamacao'], ['péssimo atendimento', 'reclamacao'], ['que absurdo, 2 horas esperando', 'reclamacao'], ['quero meu dinheiro de volta', 'reclamacao'],
  ['veio sem o refri', 'reclamacao'], ['o hamburguer veio cru', 'reclamacao'], ['achei um cabelo na comida', 'reclamacao'], ['nunca mais peço aqui', 'reclamacao'],
  ['demorou demais', 'reclamacao'], ['quero estorno', 'reclamacao'], ['reclamação', 'reclamacao'],
  // atendente
  ['quero falar com alguem', 'atendente'], ['atendente', 'atendente'], ['falar com atendente', 'atendente'], ['quero falar com uma pessoa', 'atendente'],
  ['tem alguém ai?', 'atendente'], ['me atende por favor', 'atendente'], ['falar com o dono', 'atendente'], ['quero falar com humano', 'atendente'],
  ['chama o gerente', 'atendente'], ['atendimento humano', 'atendente'], ['quero cancelar meu pedido', 'atendente'], ['atendenti', 'atendente'],
  ['preciso falar com voces', 'atendente'], ['alguem pode me ajudar?', 'atendente'], ['me liga', 'atendente'],
  // parar
  ['parar', 'parar'], ['pare', 'parar'], ['para de mandar mensagem', 'parar'], ['nao quero mais receber mensagem', 'parar'], ['stop', 'parar'],
  ['sair', 'parar'], ['nao me mande mais nada', 'parar'], ['PARA', 'parar'],
  // agradecimento / ok (não responde)
  ['obrigado', 'ok'], ['obg', 'ok'], ['valeu', 'ok'], ['ok', 'ok'], ['blz', 'ok'], ['beleza, obrigada!', 'ok'], ['👍', 'ok'], ['tá bom', 'ok'],
  // voltar
  ['voltar', 'voltar'], ['quero voltar a receber', 'voltar'],
  // não entendeu
  ['asdkjh', 'outro'], ['kkkkkk', 'outro'], ['meu cachorro fugiu', 'outro'], ['qual seu nome?', 'outro'],
]

describe('classificador do robô de autoatendimento', () => {
  it(`tem pelo menos 150 frases de teste (${FRASES.length})`, () => {
    expect(FRASES.length).toBeGreaterThanOrEqual(150)
  })

  it.each(FRASES)('"%s" → %s', (frase, esperado) => {
    expect(classificar(frase).assunto).toBe(esperado)
  })

  it('números do menu: 1–6 e 0', () => {
    const m: [string, Intencao][] = [['1', 'cardapio'], ['2', 'entrega'], ['3', 'status_pedido'], ['4', 'horario'], ['5', 'pagamento_pix'], ['6', 'endereco_retirada'], ['0', 'atendente'], [' 3 ', 'status_pedido'], ['opção 4', 'horario'], ['5.', 'pagamento_pix']]
    for (const [t, a] of m) expect(classificar(t).assunto, t).toBe(a)
    expect(opcaoDoMenu('1234')).toBeNull()
    expect(opcaoDoMenu('7')).toBeNull()
  })

  it('palavras extras do dono entram no assunto', () => {
    expect(classificar('tem rodízio?').assunto).toBe('outro')
    expect(classificar('tem rodízio?', { cardapio: ['rodizio'] }).assunto).toBe('cardapio')
  })

  it('normaliza acento, pontuação, maiúsculas e letras repetidas', () => {
    expect(normalizarTexto('  Olááá!!!  Tudo   BEM?? ')).toBe('ola tudo bem')
  })

  it('prioridade: atendente > reclamação > parar > status > entrega > pix > horário > endereço > cardápio > saudação', () => {
    expect(classificar('oi, quero falar com atendente sobre meu pedido').assunto).toBe('atendente')
    expect(classificar('bom dia, meu pedido veio errado').assunto).toBe('reclamacao')
    expect(classificar('boa noite, cadê meu pedido?').assunto).toBe('status_pedido')
    expect(classificar('oi, qual a taxa pro centro e o cardápio?').assunto).toBe('entrega')
    expect(classificar('oi, aceita pix? que horas fecha?').assunto).toBe('pagamento_pix')
    expect(classificar('ola, que horas abre e qual o endereço').assunto).toBe('horario')
    expect(classificar('oi manda o cardapio').assunto).toBe('cardapio')
  })
})
