/**
 * Robô de autoatendimento (10/10/2026) — classificador por palavras-chave, sem IA e sem custo.
 *
 * 1. Normaliza: minúsculas, sem acento, sem pontuação/emoji, abreviações comuns ("vcs", "qnto", "hj")
 *    e letras repetidas ("oiiii", "diaa").
 * 2. Número do menu sozinho (1–6, 0) decide na hora.
 * 3. Passada EXATA: a primeira palavra/expressão encontrada, na ordem de prioridade, vence.
 * 4. Só sem nenhum acerto exato: passada TOLERANTE (distância de edição 1 em palavras de 5–7 letras,
 *    2 a partir de 8), na mesma ordem. Assim "atendendo" (horário, exato) não vira "atendente".
 *
 * Prioridade (pedido do dono): atendente > reclamacao > parar > status_pedido > entrega > pagamento_pix
 * > horario > endereco_retirada > cardapio > saudacao. "ok"/"obrigado" e "voltar" são tratados à parte
 * (não respondem / reativam o robô), e o resto é "outro".
 */

export type Assunto =
  | 'saudacao' | 'cardapio' | 'entrega' | 'status_pedido' | 'horario' | 'pagamento_pix'
  | 'endereco_retirada' | 'reclamacao' | 'atendente' | 'parar'

/**
 * 'pedir' (11/10): vontade de pedir PELA CONVERSA — com o Agente de IA ligado, a IA anota; sem ele, o robô manda o link.
 * 'pix_chave' (16/10): quer a CHAVE Pix para pagar ("já me manda a chave pix que pago") — vai a chave, não a lista de formas.
 * 'resumo_pedido' (16/10): o resumo que a própria vitrine abre no WhatsApp depois do pedido ("Acabei de fazer um pedido…").
 */
export type Intencao = Assunto | 'pedir' | 'pix_chave' | 'resumo_pedido' | 'tempo_entrega' | 'duvida' | 'ok' | 'voltar' | 'outro'

export const ASSUNTOS: Assunto[] = [
  'atendente', 'reclamacao', 'parar', 'status_pedido', 'entrega', 'pagamento_pix', 'horario', 'endereco_retirada', 'cardapio', 'saudacao',
]

/** Palavras extras que o dono cadastra (por assunto), já em texto livre. */
export type PalavrasExtras = Partial<Record<Assunto, string[]>>

const ABREVIACOES: Record<string, string> = {
  vc: 'voce', vcs: 'voces', voceis: 'voces', q: 'que', qnto: 'quanto', qto: 'quanto', qnt: 'quanto', qt: 'quanto', quantu: 'quanto',
  hj: 'hoje', tb: 'tambem', tbm: 'tambem', pq: 'porque', msg: 'mensagem', msgs: 'mensagens', td: 'tudo', n: 'nao', naum: 'nao', num: 'nao',
  eh: 'e', refri: 'refrigerante', vlw: 'valeu', blz: 'beleza', obg: 'obrigado', obgd: 'obrigado', brigado: 'obrigado', brigada: 'obrigada',
  pfv: 'por favor', pf: 'por favor', pls: 'por favor', aki: 'aqui', ond: 'onde', cmg: 'comigo',
}

/** Minúsculas, sem acento, sem pontuação e emoji, abreviações expandidas, letras repetidas encurtadas. */
export function normalizarTexto(texto: string): string {
  const base = texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!base) return ''
  return base
    .split(' ')
    .map((p) => p.replace(/([a-z])\1{2,}/g, '$1').replace(/([aeiou])\1+$/, '$1'))
    .map((p) => ABREVIACOES[p] ?? p)
    .join(' ')
}

/** "3", "opção 3", "3." → 3. Qualquer outro número (ex.: nº de pedido) → null. */
export function opcaoDoMenu(texto: string): number | null {
  const m = /^(?:opcao )?([0-6])$/.exec(normalizarTexto(texto))
  return m ? Number(m[1]) : null
}

export const MENU_NUMEROS: Record<number, Assunto> = {
  1: 'cardapio', 2: 'entrega', 3: 'status_pedido', 4: 'horario', 5: 'pagamento_pix', 6: 'endereco_retirada', 0: 'atendente',
}

/** Palavras e expressões padrão (já normalizadas). Expressões casam palavra por palavra, em sequência. */
export const PALAVRAS_PADRAO: Record<Assunto, string[]> = {
  atendente: [
    'atendente', 'atendimento humano', 'humano', 'pessoa', 'alguem', 'falar com', 'quero falar', 'me atende', 'gerente', 'dono', 'responsavel',
    'cancelar', 'cancela', 'me liga', 'ligar pra', 'ligacao',
    // 16/10: assuntos de pessoa (emprego, fiado, parceria, mexer em pedido já feito) vão direto para o atendente.
    'emprego', 'vaga', 'vagas', 'curriculo', 'trabalhar ai', 'trabalhar com voces', 'fiado', 'pendura', 'pendurar', 'parceria', 'proposta', 'fornecedor',
    'mudar meu pedido', 'mudar o pedido', 'alterar meu pedido', 'alterar o pedido', 'trocar meu pedido', 'trocar o pedido', 'tirar do pedido',
    'acrescentar no pedido', 'acrescentar no meu pedido', 'adicionar no pedido', 'adicionar no meu pedido', 'esqueci de pedir', 'esqueci de colocar',
  ],
  reclamacao: [
    'reclamacao', 'reclamar', 'reclamo', 'errado', 'errada', 'fria', 'frio', 'veio cru', 'veio crua', 'faltando', 'faltou', 'veio sem', 'nao veio',
    'atrasado', 'atrasada', 'atrasou', 'demorou demais', 'demorou muito', 'demorando demais', 'demorando muito', 'pessimo', 'pessima', 'horrivel',
    'absurdo', 'vergonha', 'estragado', 'estragada', 'cabelo', 'nunca mais', 'dinheiro de volta', 'estorno', 'reembolso', 'devolucao', 'decepcionado',
    'nao recebi', 'nao recebemos', 'nunca chegou',
  ],
  parar: [
    'para de mandar', 'pare de mandar', 'parar de mandar', 'para de enviar', 'pare de enviar', 'nao quero mais receber', 'parar de receber',
    'nao me mande mais', 'nao mande mais', 'nao quero receber', 'nao quero mais mensagem', 'descadastrar', 'me descadastra',
  ],
  status_pedido: [
    'meu pedido', 'meus pedidos', 'minha encomenda', 'pedido ja', 'pedido ta', 'pedido esta', 'pedido saiu', 'pedido vai', 'cade', 'ja saiu',
    'saiu pra entrega', 'saiu para entrega', 'vai demorar', 'demorando', 'chegando', 'vai chegar', 'falta muito', 'tempo falta', 'status', 'acompanhar',
    'rastrear', 'onde esta meu', 'onde ta meu', 'meu lanche', 'minha pizza', 'meu hamburguer', 'minha comida', 'meu acai', 'minha marmita', 'motoboy',
    'entregador', 'ja entregou', 'ja entregaram', 'ta pronto', 'esta pronto', 'ficou pronto', 'ja ta pronto',
    'fiz um pedido', 'fiz pedido', 'fiz o pedido', 'fiz meu pedido', 'ja fiz', 'acabei de pedir', 'ja pedi',
  ],
  entrega: [
    'taxa', 'taxas', 'frete', 'entrega', 'entregam', 'entregar', 'entregao', 'delivery', 'chegam ate', 'chega ate', 'atendem', 'atende o bairro',
    'tempo de entrega', 'demora a entrega', 'demora pra entregar', 'taxx', 'entregando',
  ],
  pagamento_pix: [
    'pix', 'pics', 'chave', 'pagamento', 'pagamentos', 'pagar', 'pago', 'cartao', 'credito', 'debito', 'dinheiro', 'tem troco', 'leva troco', 'levam troco', 'traz troco', 'trazem troco', 'vale refeicao',
    'vale alimentacao', 'pagto',
  ],
  horario: [
    'horario', 'horarios', 'que horas', 'que hora', 'aberto', 'aberta', 'abertos', 'abertas', 'abre', 'abrem', 'fecha', 'fecham', 'fechado', 'fechada',
    'funcionamento', 'funciona', 'funcionam', 'atendendo', 'hoje tem', 'horaio',
    // 16/10 (Ponto 400): "vcs tá trabalhando hoje", "tá funcionando?", "vai abrir hoje?", "já abriu?"
    'trabalhando', 'trabalham hoje', 'funcionando', 'abrir', 'abriu', 'abriram',
  ],
  endereco_retirada: [
    'endereco', 'onde fica', 'onde ficam', 'onde voces ficam', 'onde voces e', 'onde voces sao', 'onde e a loja', 'onde e ai', 'onde e voces', 'localizacao', 'retirar', 'retirada', 'retiro', 'buscar', 'busco',
    'pegar ai', 'pegar na loja', 'balcao', 'como chego', 'ponto de referencia',
  ],
  cardapio: [
    'cardapio', 'menu', 'pedir', 'fazer um pedido', 'fazer pedido', 'encomendar', 'link', 'site', 'preco', 'precos', 'valor', 'valores',
    'quanto custa', 'sabores', 'sabor', 'promocao', 'promocoes', 'opcoes', 'o que voces tem', 'lanche', 'lanches', 'pizza', 'pizzas', 'acai',
    'hamburguer', 'hamburgueres', 'combo', 'combos', 'bebidas', 'pastel', 'porcao', 'porcoes', 'marmita', 'sobremesa',
  ],
  saudacao: [
    'oi', 'oie', 'ola', 'opa', 'eai', 'e ai', 'bom dia', 'boa tarde', 'boa noite', 'bao noite', 'bao dia', 'salve', 'hello', 'hey', 'tudo bem',
    'tudo bom', 'boa', 'ei', 'fala comigo', 'fala ai', 'alo',
  ],
}

/** Mensagem inteira que só fecha a conversa ("ok", "obrigado", 👍): não responde nem conta como "não entendi". */
const PALAVRAS_OK = new Set([
  'ok', 'okay', 'okey', 'obrigado', 'obrigada', 'beleza', 'valeu', 'certo', 'ta', 'bom', 'show', 'top', 'perfeito', 'combinado', 'joia', 'blz',
  'entendi', 'tranquilo', 'sim', 'isso', 'aguardo', 'agradeco', 'muito', 'de', 'nada', 'vlw',
])

/** "parar" de uma palavra só vale como mensagem inteira (senão "para" de "pra" pararia o robô). */
const PARAR_INTEIRA = new Set(['parar', 'pare', 'para', 'stop', 'sair', 'chega', 'cancelar mensagens'])
const VOLTAR_INTEIRA = new Set(['voltar', 'volta', 'quero voltar', 'quero voltar a receber', 'voltar a receber', 'receber de novo', 'pode voltar'])

function distancia(a: string, b: string, maximo: number): number {
  if (Math.abs(a.length - b.length) > maximo) return maximo + 1
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const atual = [i]
    let menor = i
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (atual[j] < menor) menor = atual[j]
    }
    if (menor > maximo) return maximo + 1
    anterior = atual
  }
  return anterior[b.length]
}

/** Palavras comuns que a passada tolerante NÃO aproxima ("saber" virava "sabor" → cardápio; "ainda" virava bairro). */
const NAO_APROXIMAR = new Set(['saber', 'sabia', 'sabem', 'ainda', 'pedi', 'pedido', 'pedidos'])

function toleranciaPara(palavra: string): number {
  return palavra.length >= 8 ? 2 : palavra.length >= 5 ? 1 : 0
}

/** A expressão aparece em sequência nas palavras do texto? */
function contem(palavras: string[], expressao: string[], tolerante: boolean): boolean {
  for (let i = 0; i + expressao.length <= palavras.length; i++) {
    let ok = true
    for (let k = 0; k < expressao.length && ok; k++) {
      const p = palavras[i + k]
      const e = expressao[k]
      if (p === e) continue
      const tol = tolerante && !NAO_APROXIMAR.has(p) ? toleranciaPara(e) : 0
      ok = tol > 0 && distancia(p, e, tol) <= tol
    }
    if (ok) return true
  }
  return false
}

function listaDo(assunto: Assunto, extras?: PalavrasExtras): string[][] {
  const todas = [...PALAVRAS_PADRAO[assunto], ...(extras?.[assunto] ?? []).map(normalizarTexto).filter(Boolean)]
  return todas.map((e) => e.split(' '))
}

export interface Classificacao {
  intencao: Intencao
  /** Igual a `intencao` quando é um dos assuntos; senão o que mais se aproxima para o registro. */
  assunto: Intencao
  /** Veio pelo número do menu. */
  porNumero: boolean
  /** Texto normalizado (vai para "Perguntas que o robô não entendeu"). */
  normalizado: string
  /** 'pedir' de quem diz que não consegue usar o link/site: sem IA, o robô oferece o atendente. */
  pedidoSemLink?: boolean
}

/**
 * Gatilho "quero pedir por aqui" (11/10/2026, Agente de IA). Sem custo: só palavras.
 *  - SEM_LINK: não consegue/não quer usar o link ("o link não abre", "prefiro pedir por aqui").
 *  - FORTE: vontade explícita ("quero fazer um pedido", "anota meu pedido", "dá pra pedir por aqui?").
 *  - FRACO: "quero / queria / vou querer / me vê / manda / gostaria de" SÓ quando seguido de quantidade ou artigo
 *    ("quero UM x-tudo", "me vê 2 coca") e a coisa pedida não é assunto do robô ("manda o cardápio", "quero o link").
 * Atendente, reclamação, parar e status vêm antes; entrega, Pix, horário e endereço vêm antes do FRACO.
 */
const PEDIR_SEM_LINK = [
  'nao consigo pedir', 'nao consigo abrir', 'nao consigo usar', 'nao consigo mexer', 'nao consigo pelo site', 'nao consigo pelo link', 'nao consigo entrar',
  'link nao abre', 'link nao funciona', 'link nao carrega', 'site nao abre', 'site nao funciona', 'site nao carrega', 'nao abre o link', 'nao abre o site',
  'nao sei mexer', 'nao sei usar', 'prefiro pedir por aqui', 'prefiro pedir aqui', 'prefiro por aqui', 'prefiro aqui', 'por aqui mesmo', 'aqui mesmo',
  'quero por aqui', 'pode ser por aqui', 'pelo whats mesmo', 'pelo zap mesmo',
].map((e) => e.split(' '))
/** Contêm "meu pedido" (palavra de status): por isso são conferidas antes do status. */
const PEDIR_ANTES_DO_STATUS = ['anota meu pedido', 'anota o meu pedido', 'tira meu pedido', 'tira o meu pedido', 'faz meu pedido', 'faz o meu pedido', 'fazer meu pedido', 'fecha meu pedido'].map((e) => e.split(' '))
const PEDIR_FORTE = [
  'fazer um pedido', 'fazer pedido', 'fazer o pedido', 'quero pedir', 'queria pedir', 'vou pedir', 'posso pedir', 'consigo pedir', 'da pra pedir', 'tem como pedir',
  'pedir por aqui', 'pedir aqui', 'pedir pelo whats', 'pedir pelo whatsapp', 'pedir pelo zap', 'pedir no whats', 'pedido por aqui', 'anota ai', 'anota pra mim',
  'faz o pedido', 'faz um pedido', 'me ajuda a pedir', 'me ajuda pedir', 'quero encomendar', 'queria encomendar', '1 por aqui', 'fechar o pedido', 'fechar pedido',
  // "quero fazer um peiddo" (erro de digitação, teste do Felipe 12/10): "fazer um/uma" já diz que é pedido.
  'quero fazer um', 'quero fazer uma', 'queria fazer um', 'queria fazer uma', 'gostaria de fazer um', 'gostaria de fazer uma', 'vou fazer um pedido',
].map((e) => e.split(' '))
const PELA_CONVERSA = new Set(['aqui', 'whats', 'whatsapp', 'zap', 'zapzap', 'wpp', 'conversa'])
const PEDIR_FRACO =['quero', 'queria', 'vou querer', 'me ve', 'me manda', 'manda', 'gostaria de', 'gostaria', 'traz', 'me traz'].map((e) => e.split(' '))
const DEPOIS_DO_FRACO = new Set(['um', 'uma', 'uns', 'umas', 'dois', 'duas', 'tres', 'quatro', 'cinco', 'seis', 'meia', 'mais', 'o', 'a', 'os', 'as', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
const COISAS_DO_ROBO = new Set(['cardapio', 'menu', 'link', 'site', 'pix', 'chave', 'endereco', 'localizacao', 'horario', 'taxa', 'numero', 'telefone', 'contato', 'status', 'nome', 'senha', 'codigo'])

function pedidoFraco(palavras: string[]): boolean {
  for (const e of PEDIR_FRACO) {
    for (let i = 0; i + e.length < palavras.length; i++) {
      if (!e.every((w, k) => palavras[i + k] === w)) continue
      const seguinte = palavras[i + e.length]
      if (!DEPOIS_DO_FRACO.has(seguinte)) continue
      const coisa = palavras.slice(i + e.length, i + e.length + 3)
      if (!coisa.some((w) => COISAS_DO_ROBO.has(w))) return true
    }
  }
  return false
}

/** Tempo de entrega (16/10): "quanto tempo pra entrega?", "tempo de espera" — antes da entrega, que perguntava o bairro. */
const TEMPO_ENTREGA = ['quanto tempo', 'tempo de espera', 'tempo de entrega', 'tempo pra entrega', 'tempo para entrega', 'tempo pra entregar', 'demora quanto', 'quanto demora', 'tempo medio']
  .map((e) => e.split(' '))

/** Botão "Dúvidas" da vitrine: "Olá! Vim pelo cardápio online e tenho uma dúvida." */
const DUVIDA = ['tenho uma duvida', 'tenho duvida', 'uma duvida', 'vim pelo cardapio'].map((e) => e.split(' '))

/**
 * Pedido escrito na conversa, sem verbo ("1 x-bacon caprichado", "2 x burgão e uma coca", "um x tudo"): começa com
 * quantidade seguida de algo que não é número de menu/pedido. Vai para o Agente de IA (ou atendente sem ela).
 */
function pareceItens(palavras: string[]): boolean {
  const QTD = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'um', 'uma', 'dois', 'duas', 'tres'])
  if (palavras.length < 2 || !QTD.has(palavras[0])) return false
  const resto = palavras.slice(1)
  if (resto[0] === 'x' || /^x[a-z]/.test(resto[0])) return true
  return resto.some((p) => p.length >= 3 && !/^d+$/.test(p) && !['hora', 'horas', 'min', 'minutos', 'reais', 'real', 'pessoas', 'dias', 'opcao'].includes(p))
    && !palavras.some((p) => ['troco', 'pedido', 'pedidos', 'numero', 'mesa'].includes(p))
}

/** "Estão abertos agora?" escrito com palavras de entrega/trabalho — vem antes da entrega ("tá entregando ainda?"). */
const ESTA_ABERTO = [
  'ta entregando', 'esta entregando', 'tao entregando', 'estao entregando', 'entregando hoje', 'entregando ainda', 'entregando agora', 'vao entregar hoje',
  'ta trabalhando', 'esta trabalhando', 'tao trabalhando', 'estao trabalhando', 'trabalhando hoje', 'ta funcionando', 'tao funcionando', 'estao funcionando',
  'vai abrir', 'vao abrir', 'ja abriu', 'ja abriram', 'ate que horas',
].map((e) => e.split(' '))

/** Pix na hora da entrega / ao motoboy: é pergunta de forma de pagamento, não pedido da chave. */
const PIX_NA_ENTREGA = new Set(['entrega', 'entregador', 'motoboy', 'chegar', 'maquininha', 'cartao', 'dinheiro', 'credito', 'debito', 'troco'])

/** Verbos de quem quer a chave para pagar agora ("manda o pix", "qual o pix", "posso pagar no pix"). */
const QUER_A_CHAVE = new Set(['manda', 'mandar', 'mande', 'me', 'passa', 'passar', 'passe', 'envia', 'enviar', 'qual', 'pagar', 'pago', 'faz', 'fazer', 'faco'])

/**
 * Quer a chave Pix: fala "chave", ou "pix" com um verbo de pedir/pagar, ou manda só "pix" — e não está perguntando sobre
 * pagar na entrega. "aceita pix?" continua sendo a pergunta de formas de pagamento (que também traz a chave).
 */
function pedeChavePix(palavras: string[]): boolean {
  if (palavras.some((p) => PIX_NA_ENTREGA.has(p))) return false
  if (palavras.includes('chave')) return true
  const pix = palavras.includes('pix') || palavras.includes('pics')
  if (!pix) return false
  return palavras.every((p) => p === 'pix' || p === 'pics' || p === 'o') || palavras.some((p) => QUER_A_CHAVE.has(p))
}

/** O resumo que a vitrine monta (app/loja/[slug]/vitrine.tsx, montarAvisoLoja): "Acabei de fazer um pedido…" + "• 1x …" + "Total:". */
function ehResumoDaVitrine(bruto: string, normalizado: string): boolean {
  if (normalizado.startsWith('acabei de fazer um pedido')) return true
  return /•\s*\d+x\s/.test(bruto) && /total:\s*r\$/i.test(bruto)
}

export function classificar(texto: string | null, extras?: PalavrasExtras): Classificacao {
  const bruto = texto ?? ''
  const normalizado = normalizarTexto(bruto)
  const r = (intencao: Intencao, porNumero = false): Classificacao => ({ intencao, assunto: intencao, porNumero, normalizado })
  if (!normalizado) return r(bruto.trim() ? 'ok' : 'outro') // só emoji (👍) = ok
  if (ehResumoDaVitrine(bruto, normalizado)) return r('resumo_pedido')
  if (DUVIDA.some((e) => contem(normalizado.split(' '), e, false)) && !normalizado.includes('pedido')) return r('duvida')

  const opcao = opcaoDoMenu(bruto)
  if (opcao !== null) return r(MENU_NUMEROS[opcao], true)
  if (PARAR_INTEIRA.has(normalizado)) return r('parar')
  if (VOLTAR_INTEIRA.has(normalizado)) return r('voltar')

  const palavras = normalizado.split(' ')
  if (palavras.every((p) => PALAVRAS_OK.has(p))) return r('ok')

  const pedir = (semLink: boolean): Classificacao => ({ ...r('pedir'), pedidoSemLink: semLink })
  for (const tolerante of [false, true]) {
    for (const assunto of ASSUNTOS) {
      if (assunto === 'status_pedido' && PEDIR_ANTES_DO_STATUS.some((e) => contem(palavras, e, tolerante))) return pedir(false)
      if (assunto === 'entrega') {
        if (!tolerante && ESTA_ABERTO.some((e) => contem(palavras, e, false))) {
          // "está entregando no centro?" continua sendo taxa do bairro; "tá entregando ainda/hoje?" é "estão abertos?".
          const b = bairroDaFrase(bruto)
          if (!b || ['ainda', 'hoje', 'agora', 'ai'].includes(b)) return r('horario')
        }
        if (!tolerante && TEMPO_ENTREGA.some((e) => contem(palavras, e, false))) return r('tempo_entrega')
        if (!tolerante && pedeChavePix(palavras)) return r('pix_chave')
        if (!tolerante && palavras.includes('pix')) return r('pagamento_pix') // "pix na entrega?"
        if (PEDIR_SEM_LINK.some((e) => contem(palavras, e, tolerante))) return pedir(true)
        // "quero fazer um pedido POR AQUI / pelo whats" (14/10): já disse que é pela conversa — a IA atende, sem o link.
        if (PEDIR_FORTE.some((e) => contem(palavras, e, tolerante))) return pedir(palavras.some((p) => PELA_CONVERSA.has(p)))
      }
      if (assunto === 'cardapio' && !tolerante && pareceItens(palavras)) return pedir(true)
      if (assunto === 'cardapio' && !tolerante && pedidoFraco(palavras)) return pedir(false)
      if (listaDo(assunto, extras).some((e) => contem(palavras, e, tolerante))) return r(assunto)
    }
  }
  return r('outro')
}

const CONECTORES = new Set(['hoje', 'agora', 'no', 'na', 'nos', 'nas', 'pro', 'pra', 'para', 'em', 'ate', 'o', 'a', 'ao', 'do', 'da', 'de', 'bairro', 'aqui', 'entrega', 'taxa', 'frete'])

/**
 * Bairro escrito junto da pergunta de entrega: "taxa pro ibes", "entregam no centro?", "frete pra praia do canto".
 * Pega o que vem depois da última palavra de entrega + conectores. `null` se não sobrou nada.
 */
export function bairroDaFrase(texto: string): string | null {
  const palavras = normalizarTexto(texto).split(' ').filter(Boolean)
  const gatilhos = new Set(['taxa', 'taxas', 'frete', 'entrega', 'entregam', 'entregar', 'entregao', 'entregando', 'delivery', 'chegam', 'chega', 'atendem', 'atende', 'taxx'])
  let i = -1
  palavras.forEach((p, k) => { if (gatilhos.has(p)) i = k })
  if (i < 0) return null
  let resto = palavras.slice(i + 1)
  while (resto.length && CONECTORES.has(resto[0])) resto = resto.slice(1)
  // "taxa de entrega pro centro": pula "de entrega" e tenta de novo.
  const outra = resto.findIndex((p) => gatilhos.has(p))
  if (outra >= 0) return bairroDaFrase(resto.join(' '))
  const b = resto.join(' ').trim()
  if (!b || b.length < 2 || /^\d+$/.test(b)) return null
  return b
}
