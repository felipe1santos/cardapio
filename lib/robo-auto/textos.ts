/**
 * Robô de autoatendimento — textos padrão (estilo WhatsApp: *negrito* nos títulos, _itálico_ no nome do cliente,
 * `código` em nº do pedido, valores e chave Pix, listas com "- ", citação "> " para avisos e previsões).
 * O dono pode trocar cada texto em Integrações › Robô de atendimento; "Restaurar padrão" apaga a troca.
 *
 * Campos: {saudacao} {nome_cliente} {nome_loja} {link_cardapio} {numero_pedido} {itens} {total} {status} {previsao}
 * {bairro} {taxa} {tempo} {horario} {endereco} — e, de apoio, {menu} {lista_bairros} {formas_pagamento}
 * {aberto_agora} {retirada} {tipo_chave}.
 * Linha com um campo que ficou vazio some inteira (ex.: sem tempo de entrega cadastrado, a linha do tempo não sai).
 */

export const CAMPOS = [
  'saudacao', 'nome_cliente', 'nome_loja', 'link_cardapio', 'numero_pedido', 'itens', 'total', 'status', 'previsao', 'bairro', 'taxa', 'tempo',
  'horario', 'endereco', 'menu', 'lista_bairros', 'formas_pagamento', 'aberto_agora', 'retirada', 'tipo_chave',
] as const
export type Campo = (typeof CAMPOS)[number]

export type ChaveTexto =
  | 'saudacao' | 'menu_curto' | 'nao_entendeu' | 'cardapio' | 'entrega_pergunta' | 'entrega_taxa' | 'entrega_nao_encontrado' | 'entrega_sem_entrega'
  | 'status' | 'status_pedir_numero' | 'status_nao_achou' | 'horario' | 'pagamento' | 'endereco' | 'reclamacao' | 'atendente'
  | 'atendente_nao_entendeu' | 'parar' | 'audio' | 'pedir_link' | 'pedir_sem_link'

export const TEXTOS_PADRAO: Record<ChaveTexto, string> = {
  saudacao: [
    '*👋 {saudacao}!*',
    '',
    'Olá, _{nome_cliente}_! Aqui é o atendimento automático da *{nome_loja}*.',
    '',
    '*🍽️ Cardápio e pedidos:*',
    '{link_cardapio}',
    '',
    '{menu}',
  ].join('\n'),
  menu_curto: ['*Como posso ajudar?*', '', '{menu}', '', '*Cardápio:* {link_cardapio}'].join('\n'),
  nao_entendeu: ['*🤔 Não entendi sua mensagem.*', '', 'Digite o número da opção:', '', '{menu}', '', '*Cardápio:* {link_cardapio}'].join('\n'),
  cardapio: ['Nosso pedido é feito *online*, no link abaixo 👇', '{link_cardapio}'].join('\n'),
  entrega_pergunta: ['*🛵 TAXA DE ENTREGA*', '', 'Qual é o seu bairro? Me manda só o nome (ex.: _Centro_).'].join('\n'),
  entrega_taxa: [
    '*🛵 ENTREGA — {bairro}*',
    '',
    'Taxa de entrega: `{taxa}`',
    '',
    '> Tempo de entrega: *{tempo}*',
    '',
    '*Faça seu pedido:* {link_cardapio}',
  ].join('\n'),
  entrega_nao_encontrado: [
    '*📍 Não encontrei o bairro "{bairro}".*',
    '',
    'Estes são os bairros que atendemos:',
    '',
    '{lista_bairros}',
    '',
    'Me manda o nome do seu bairro de novo ou veja no cardápio: {link_cardapio}',
  ].join('\n'),
  entrega_sem_entrega: ['*🛵 ENTREGA*', '', '> No momento a *{nome_loja}* não está fazendo entregas.', '', '{retirada}'].join('\n'),
  status: [
    '*📦 PEDIDO `#{numero_pedido}`*',
    '',
    'Olá, _{nome_cliente}_! Seu pedido está: *{status}*',
    '',
    '*Itens:*',
    '{itens}',
    '',
    '> Previsão: *{previsao}*',
    '',
    'Total: `{total}`',
  ].join('\n'),
  status_pedir_numero: ['*📦 STATUS DO PEDIDO*', '', 'Me manda o *número do pedido* (ex.: `#1234`) que eu confiro para você.'].join('\n'),
  status_nao_achou: [
    '*📦 Não encontrei o pedido `#{numero_pedido}`* neste WhatsApp.',
    '',
    'Confira o número ou digite *0* para falar com um atendente.',
  ].join('\n'),
  horario: ['*🕐 HORÁRIO DE FUNCIONAMENTO*', '', '{aberto_agora}', '', '{horario}', '', '*Cardápio:* {link_cardapio}'].join('\n'),
  pagamento: ['*💳 FORMAS DE PAGAMENTO*', '', '{formas_pagamento}', '', '> Chave Pix ({tipo_chave}) na próxima mensagem 👇'].join('\n'),
  endereco: ['*📍 ENDEREÇO*', '', '{endereco}', '', '{retirada}', '', '*Cardápio:* {link_cardapio}'].join('\n'),
  reclamacao: [
    '*🙏 SINTO MUITO!*',
    '',
    'Peço desculpas pelo problema, _{nome_cliente}_. Já chamei um atendente da *{nome_loja}* para resolver com você.',
    '',
    '> Assim que possível, alguém responde por aqui.',
  ].join('\n'),
  atendente: [
    '*👤 ATENDIMENTO*',
    '',
    'Certo! Chamei um atendente da *{nome_loja}*.',
    '',
    '> Assim que possível, alguém responde por aqui.',
  ].join('\n'),
  atendente_nao_entendeu: [
    '*👤 ATENDIMENTO*',
    '',
    'Não consegui entender, então chamei um atendente da *{nome_loja}* para te ajudar.',
    '',
    '> Assim que possível, alguém responde por aqui.',
  ].join('\n'),
  audio: ['*🎤 Recebi seu áudio!*', '', 'Ainda não consigo ouvir áudios por aqui. Escreva sua dúvida ou digite *0* para falar com um atendente.', '', '*Cardápio:* {link_cardapio}'].join('\n'),
  pedir_link: ['Nosso pedido é feito *online*, no link abaixo 👇', '{link_cardapio}'].join('\n'),
  pedir_sem_link: [
    '*👤 Sem problema!*',
    '',
    'Digite *0* que eu chamo um atendente da *{nome_loja}* para anotar seu pedido.',
    '',
    'Se quiser tentar de novo pelo link: {link_cardapio}',
  ].join('\n'),
  parar: ['*🔕 Tudo bem!*', '', 'Não vou mais responder automaticamente neste número.', '', '> Se quiser voltar, é só mandar *voltar*.'].join('\n'),
}

/** Rótulos para a tela do dono. */
export const ROTULO_TEXTO: Record<ChaveTexto, string> = {
  saudacao: 'Saudação', menu_curto: 'Menu curto', nao_entendeu: 'Não entendi (menu completo)', cardapio: 'Cardápio',
  entrega_pergunta: 'Entrega — pergunta o bairro', entrega_taxa: 'Entrega — taxa do bairro', entrega_nao_encontrado: 'Entrega — bairro não encontrado',
  entrega_sem_entrega: 'Entrega — loja sem entrega', status: 'Status do pedido', status_pedir_numero: 'Status — pede o número',
  status_nao_achou: 'Status — pedido não encontrado', horario: 'Horário', pagamento: 'Pagamento e Pix', endereco: 'Endereço e retirada',
  reclamacao: 'Reclamação', atendente: 'Atendente', atendente_nao_entendeu: 'Atendente (não entendeu 2 vezes)', parar: 'Parar', audio: 'Áudio recebido',
  pedir_link: 'Quer pedir pela conversa — insiste no link (1ª vez)', pedir_sem_link: 'Quer pedir pela conversa — oferece atendente (sem IA)',
}

export type Valores = Partial<Record<Campo, string | null | undefined>>

/**
 * Preenche os campos. Linha com campo vazio some; o nome do cliente vazio tira o ", _{nome_cliente}_" junto.
 * Nunca deixa 3 linhas em branco seguidas.
 */
export function renderizar(modelo: string, valores: Valores): string {
  const vazio = (c: string) => !String(valores[c as Campo] ?? '').trim()
  let m = modelo
  if (vazio('nome_cliente')) m = m.replace(/,?\s*_\{nome_cliente\}_/g, '').replace(/,?\s*\{nome_cliente\}/g, '')
  const linhas = m.split('\n').filter((linha) => {
    const campos = [...linha.matchAll(/\{([a-z_]+)\}/g)].map((x) => x[1])
    return !campos.some((c) => (CAMPOS as readonly string[]).includes(c) && vazio(c))
  })
  return linhas
    .join('\n')
    .replace(/\{([a-z_]+)\}/g, (todo, c: string) => ((CAMPOS as readonly string[]).includes(c) ? String(valores[c as Campo] ?? '') : todo))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function textoDe(chave: ChaveTexto, personalizados?: Partial<Record<ChaveTexto, string>> | null): string {
  const p = personalizados?.[chave]
  return typeof p === 'string' && p.trim() ? p : TEXTOS_PADRAO[chave]
}

/** Campo desconhecido no texto do dono (ex.: {nome}) — a tela avisa antes de salvar. */
export function camposDesconhecidos(modelo: string): string[] {
  return [...new Set([...modelo.matchAll(/\{([a-z_]+)\}/g)].map((x) => x[1]).filter((c) => !(CAMPOS as readonly string[]).includes(c)))]
}
