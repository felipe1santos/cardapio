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
  ['me passa o menu', 'cardapio'], ['como faço pra pedir?', 'cardapio'],
  ['tem link?', 'cardapio'], ['manda o link', 'cardapio'], ['quais os sabores de pizza?', 'cardapio'], ['quanto custa o x-tudo?', 'cardapio'],
  ['qual o preço do combo', 'cardapio'], ['tem promoção hoje?', 'cardapio'], ['vcs tem açaí?', 'cardapio'],
  ['o que vcs tem ai', 'cardapio'], ['valores dos lanches', 'cardapio'], ['me manda o cardápio', 'cardapio'], ['quero o link', 'cardapio'],
  // entrega
  ['vcs entregam no centro?', 'entrega'], ['qnto ta a taxa pro ibes', 'entrega'], ['qual a taxa de entrega?', 'entrega'], ['taxa', 'entrega'],
  ['quanto é o frete?', 'entrega'], ['entrega em vila velha?', 'entrega'], ['voces fazem entrega', 'entrega'], ['tem delivery?', 'entrega'],
  ['quanto fica a entrega pra praia do canto', 'entrega'], ['entregam na glória?', 'entrega'], ['qnt tempo demora a entrega', 'tempo_entrega'],
  // Ponto 400, 11/10: "entregando" ficava perto de "entregador" (status) na passada tolerante
  // 16/10: "tá entregando?" é "estão abertos?" (responde aberto agora + horário), não pergunta o bairro.
  ['Está entregando?', 'horario'], ['vcs tão entregando hoje?', 'horario'],
  ['tempo de entrega', 'tempo_entrega'], ['taxa pro jardim camburi', 'entrega'], ['vcs chegam ate itapua?', 'entrega'], ['faz entrega aqui no bairro?', 'entrega'],
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
  // 16/10: pedir a chave ("qual a chave", "manda o pix", "pix") manda só a chave; "aceita pix?" segue com as formas.
  ['aceita pix?', 'pagamento_pix'], ['qual a chave pix', 'pix_chave'], ['manda o pix', 'pix_chave'], ['aceita cartão?', 'pagamento_pix'],
  ['formas de pagamento', 'pagamento_pix'], ['pode ser no débito?', 'pagamento_pix'], ['aceitam credito', 'pagamento_pix'], ['posso pagar em dinheiro?', 'pagamento_pix'],
  ['tem troco pra 100?', 'pagamento_pix'], ['como faço o pagamento', 'pagamento_pix'], ['pix', 'pix_chave'], ['chave', 'pix_chave'],
  ['aceita vale refeição?', 'pagamento_pix'], ['passa cartao?', 'pagamento_pix'], ['qual o pics', 'pix_chave'], ['vcs levam troco?', 'pagamento_pix'],
  // pedido escrito por mensagem com "troco para" (Ponto 400, 11/10): é saudação, não pergunta de pagamento
  ['Boa noite querido um x tudo troco para 50', 'saudacao'],
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

  it('números do menu: 1–7 e 0 (4 = progresso desde 20/10; 8 = alterar, só com pedido aberto)', () => {
    const m: [string, Intencao][] = [['1', 'cardapio'], ['2', 'entrega'], ['3', 'status_pedido'], ['4', 'fidelidade'], ['5', 'horario'], ['6', 'pagamento_pix'], ['7', 'endereco_retirada'], ['0', 'atendente'], [' 3 ', 'status_pedido'], ['opção 5', 'horario'], ['6.', 'pagamento_pix']]
    for (const [t, a] of m) expect(classificar(t).assunto, t).toBe(a)
    expect(opcaoDoMenu('1234')).toBeNull()
    expect(opcaoDoMenu('9')).toBeNull()
    expect(classificar('8').assunto).not.toBe('fidelidade')
    for (const t of ['quero ver meu cashback', 'meu progresso', 'tem cupom?', 'quanto tenho de saldo']) expect(classificar(t).assunto, t).toBe('fidelidade')
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

/** Gatilho "quero pedir por aqui" (11/10, Agente de IA): vontade de pedir pela conversa, mesmo sem citar item. */
describe('intenção de pedir pela conversa', () => {
  const PEDIR = [
    'quero fazer um pedido', 'quero pedir', 'dá pra pedir por aqui?', 'da pra pedir por aqui', 'posso pedir pelo whats?', 'consigo pedir por aqui?',
    'anota meu pedido', 'tira meu pedido', 'faz o pedido pra mim', 'me ajuda a pedir', 'quero encomendar', 'qero fazer um pedido',
    'vou querer um x tudo', 'queria uma pizza grande', 'me vê 2 coca', 'me ve dois hamburguer', 'quero um lanche', 'manda 1 batata', 'gostaria de um açaí',
    '1 por aqui', 'boa noite, quero pedir', 'oi queria fazer um pedido',
  ]
  it.each(PEDIR)('"%s" → pedir', (f) => expect(classificar(f).intencao).toBe('pedir'))

  // 14/10 (teste do Felipe): "por aqui"/"pelo whats" junto do pedido = quer pedir pela conversa; o link só se pedir.
  const SEM_LINK = ['não consigo pedir pelo site', 'o link não abre', 'nao sei mexer no cardápio', 'prefiro pedir por aqui', 'n consigo abrir o link', 'o site nao funciona', 'quero por aqui mesmo', 'pode ser por aqui mesmo', 'prefiro aqui',
    'quero fazer um pedido por aqui', 'Quero fazer um peidid por aqui', 'da pra pedir por aqui', 'posso pedir pelo whats?', 'quero pedir pelo zap']
  it.each(SEM_LINK)('"%s" → pedir sem conseguir usar o link', (f) => {
    const c = classificar(f)
    expect(c.intencao).toBe('pedir')
    expect(c.pedidoSemLink).toBe(true)
  })

  const NAO = [
    ['qual o horário', 'horario'], ['tem taxa?', 'entrega'], ['quero saber a taxa pro centro', 'entrega'], ['queria saber que horas fecha', 'horario'],
    ['quero falar com atendente', 'atendente'], ['quero cancelar meu pedido', 'atendente'], ['manda o cardápio', 'cardapio'], ['manda o link', 'cardapio'],
    ['me manda a chave pix', 'pix_chave'], ['meu pedido já saiu?', 'status_pedido'], ['quero o endereço', 'endereco_retirada'],
    ['aceita cartão?', 'pagamento_pix'], ['oi', 'saudacao'], ['quanto custa o x-tudo?', 'cardapio'], ['como faço pra pedir?', 'cardapio'],
  ] as const
  it.each(NAO)('"%s" não é pedido (→ %s)', (f, esperado) => expect(classificar(f).intencao).toBe(esperado))

  it('teste do Felipe 12/10: saudação + pedido com erro de digitação é pedido (o "oi" não vence)', () => {
    for (const t of ['Oii quero fazer um peiddo', 'Oi quero fazer um peidid', 'boa noite, gostaria de fazer uma encomenda']) expect(classificar(t).intencao, t).toBe('pedir')
    for (const t of ['oi', 'oii tudo bem?', 'bao noite', 'Oi, boa tarde!']) expect(classificar(t).intencao, t).toBe('saudacao')
  })

  it('"pedir" não tira a prioridade de atendente, reclamação e status', () => {
    expect(classificar('quero pedir mas o ultimo veio errado').intencao).toBe('reclamacao')
    expect(classificar('quero fazer um pedido, cadê o outro?').intencao).toBe('status_pedido')
  })
})
