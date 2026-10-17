/**
 * Robô de autoatendimento — monta as mensagens de uma decisão a partir dos dados da loja (puro: o webhook e o
 * simulador carregam os dados e chamam isto). O robô só afirma o que o sistema sabe.
 */
import { normalizarTexto, type Assunto } from './classificador'
import type { Decisao } from './decisao'
import { renderizar, textoDe, type ChaveTexto, type Valores } from './textos'

export interface PedidoAuto {
  numero: number
  status: string
  rotuloStatus: string
  total: number
  itens: { quantidade: number; nome: string }[]
  previsao?: string | null
}

export interface DadosLojaAuto {
  nome: string
  link: string
  aberta: boolean
  /** "Abrimos hoje às 18:00" (quando fechada). */
  proximaAbertura: string | null
  /** Grade da semana já em linhas ("- Seg: 18:00–23:00"). */
  gradeHorario: string | null
  endereco: string | null
  aceitaEntrega: boolean
  aceitaRetirada: boolean
  bairros: { bairro: string; taxa: number }[]
  taxaPadrao: number
  foraDaLista: 'bloquear' | 'taxa_padrao'
  temRaio: boolean
  tempoEntrega: string | null
  pixChave: string | null
  pixTipo: string | null
  pixOnline: boolean
  /** Cidade da loja (taxa pelo raio quando o cliente só diz o bairro). */
  cidade?: string | null
  textos?: Partial<Record<ChaveTexto, string>> | null
  assuntosDesligados?: Set<Assunto>
}

export interface ContextoResposta {
  nomeCliente?: string | null
  agora: Date
  /** Pedido encontrado (status) ou null; `abertos` = quantos pedidos em aberto o telefone tem. */
  pedido?: PedidoAuto | null
  abertos?: number
  /** Taxa calculada no servidor com a MESMA regra do checkout (bairro × raio, o menor) — vence a da lista (12/10). */
  taxaCheckout?: { taxa: number; entregavel: boolean; motivo?: string } | null
}

export interface Resposta {
  /** Mensagens na ordem (a chave Pix sai sozinha na 2ª). */
  mensagens: string[]
  /** Estado que a resposta pede (ex.: bairro achado limpa a espera; status pede o número). */
  autoEstado?: 'aguardando_bairro' | 'aguardando_numero' | 'pedir_link' | null
}

export const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`

/** "Bom dia" / "Boa tarde" / "Boa noite" no horário de Brasília. */
export function saudacaoDoHorario(agora: Date): string {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(agora)) % 24
  return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite'
}

const TIPOS_CHAVE: Record<string, string> = { cpf: 'CPF', cnpj: 'CNPJ', telefone: 'telefone', email: 'e-mail', aleatoria: 'chave aleatória' }

function temPix(l: DadosLojaAuto) {
  return !!l.pixChave?.trim()
}

const OPCOES_MENU: [number, Assunto, string][] = [
  [1, 'cardapio', 'Cardápio e pedido'],
  [2, 'entrega', 'Taxa e tempo de entrega'],
  [3, 'status_pedido', 'Status do meu pedido'],
  [4, 'horario', 'Horário'],
  [5, 'pagamento_pix', 'Pagamento e chave Pix'],
  [6, 'endereco_retirada', 'Endereço e retirada'],
]

/** Tira a linha "0 Falar com atendente" de qualquer texto (inclusive os salvos pela loja antes de 12/10). */
export function semLinhaDoZero(texto: string): string {
  return texto.split('\n').filter((linha) => !/^\s*[-•]?\s*\*?0\*?\s*[-–]?\s*Falar com (um )?atendente\s*$/i.test(linha)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function menu(l: DadosLojaAuto, curto = false): string {
  const desl = l.assuntosDesligados ?? new Set<Assunto>()
  const linhas = OPCOES_MENU
    .filter(([n, a]) => !desl.has(a) && (!curto || [1, 2, 3].includes(n)))
    .map(([n, a, r]) => `- *${n}* ${a === 'pagamento_pix' && !temPix(l) ? 'Formas de pagamento' : r}`)
  // 12/10: sem "0 Falar com atendente" no menu — atendente só a pedido ou após 2 "não entendi" seguidos.
  return linhas.join('\n')
}

/** Bairro da lista da loja que bate com o que o cliente escreveu (com tolerância a erro de digitação). */
export function acharBairro(escrito: string, bairros: { bairro: string; taxa: number }[]): { bairro: string; taxa: number } | null {
  const alvo = normalizarTexto(escrito).replace(/^(bairro|o|a) /, '')
  if (!alvo) return null
  const lista = bairros.map((b) => ({ ...b, n: normalizarTexto(b.bairro) }))
  const exato = lista.find((b) => b.n === alvo)
  if (exato) return exato
  let melhor: (typeof lista)[number] | null = null
  let menor = Infinity
  for (const b of lista) {
    const tol = b.n.length >= 8 ? 2 : b.n.length >= 4 ? 1 : 0
    const d = distanciaSimples(alvo, b.n)
    if (d <= tol && d < menor) { menor = d; melhor = b }
  }
  if (melhor) return melhor
  // "jardim camburi" escrito como "camburi": um bairro que contém o texto inteiro (mín. 4 letras), se for único.
  const contem = alvo.length >= 4 ? lista.filter((b) => b.n.split(' ').includes(alvo) || b.n.includes(alvo)) : []
  return contem.length === 1 ? contem[0] : null
}

function distanciaSimples(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let anterior = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const guardado = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1))
      anterior = guardado
    }
  }
  return dp[b.length]
}

function listaBairros(l: DadosLojaAuto): string {
  const ordenados = [...l.bairros].sort((a, b) => a.bairro.localeCompare(b.bairro, 'pt-BR'))
  const linhas = ordenados.slice(0, 40).map((b) => `- ${b.bairro}: \`${b.taxa > 0 ? brl(b.taxa) : 'Grátis'}\``)
  if (ordenados.length > 40) linhas.push(`- e mais ${ordenados.length - 40} bairros (veja no cardápio)`)
  if (l.foraDaLista === 'taxa_padrao' && l.taxaPadrao > 0) linhas.push(`- Outros bairros: \`${brl(l.taxaPadrao)}\``)
  if (l.temRaio) linhas.push('> Para outros endereços, a taxa aparece no cardápio ao informar o endereço.')
  return linhas.join('\n') || '> Os bairros atendidos aparecem no cardápio ao informar o endereço.'
}

function formasPagamento(l: DadosLojaAuto): string {
  const f = ['- Cartão de crédito ou débito (na entrega)', '- Dinheiro (com troco, se precisar)']
  if (temPix(l) || l.pixOnline) f.unshift(l.pixOnline ? '- Pix (pelo cardápio, na hora do pedido)' : '- Pix')
  return f.join('\n')
}

function retirada(l: DadosLojaAuto): string {
  return l.aceitaRetirada
    ? '✅ Aceitamos *retirada no balcão*: é só escolher _Retirada_ no cardápio.'
    : '> No momento não fazemos retirada, só entrega.'
}

export function responder(decisao: Decisao, l: DadosLojaAuto, ctx: ContextoResposta): Resposta {
  const base: Valores = {
    saudacao: saudacaoDoHorario(ctx.agora),
    nome_cliente: ctx.nomeCliente?.trim().split(/\s+/)[0] ?? '',
    nome_loja: l.nome,
    link_cardapio: l.link,
    tempo: l.tempoEntrega,
  }
  const t = (chave: ChaveTexto, extra: Valores = {}) => semLinhaDoZero(renderizar(textoDe(chave, l.textos), { ...base, ...extra }))

  switch (decisao.acao) {
    case 'nada':
      return { mensagens: [] }
    case 'saudacao':
      return { mensagens: [t('saudacao', { menu: menu(l, true) })] }
    case 'menu_curto':
      return { mensagens: [t('menu_curto', { menu: menu(l, true) })] }
    case 'nao_entendeu':
      return { mensagens: [t('nao_entendeu', { menu: menu(l) })] }
    case 'cardapio':
      return { mensagens: [t('cardapio')] }
    case 'entrega_perguntar_bairro':
      if (!l.aceitaEntrega) return { mensagens: [t('entrega_sem_entrega', { retirada: retirada(l) })], autoEstado: null }
      return { mensagens: [t('entrega_pergunta')], autoEstado: 'aguardando_bairro' }
    case 'entrega': {
      if (!l.aceitaEntrega) return { mensagens: [t('entrega_sem_entrega', { retirada: retirada(l) })], autoEstado: null }
      const achado = acharBairro(decisao.bairro ?? '', l.bairros)
      const ck = ctx.taxaCheckout
      if (ck?.entregavel) {
        return { mensagens: [t('entrega_taxa', { bairro: achado?.bairro ?? decisao.bairro ?? '', taxa: ck.taxa > 0 ? brl(ck.taxa) : 'Grátis' })], autoEstado: null }
      }
      if (achado) {
        return { mensagens: [t('entrega_taxa', { bairro: achado.bairro, taxa: achado.taxa > 0 ? brl(achado.taxa) : 'Grátis' })], autoEstado: null }
      }
      return { mensagens: [t('entrega_nao_encontrado', { bairro: decisao.bairro ?? '', lista_bairros: listaBairros(l) })], autoEstado: 'aguardando_bairro' }
    }
    case 'status':
    case 'status_numero': {
      const p = ctx.pedido
      if (p) {
        const itens = p.itens.map((i) => `- ${i.quantidade}x ${i.nome}`).join('\n')
        return {
          mensagens: [t('status', { numero_pedido: String(p.numero), status: p.rotuloStatus, itens, total: brl(p.total), previsao: p.previsao ?? '' })],
          autoEstado: null,
        }
      }
      if (decisao.acao === 'status_numero') return { mensagens: [t('status_nao_achou', { numero_pedido: String(decisao.numeroPedido ?? '') })], autoEstado: null }
      return { mensagens: [t('status_pedir_numero')], autoEstado: 'aguardando_numero' }
    }
    case 'horario': {
      const aberto = l.aberta ? '✅ *Estamos abertos agora!*' : `> Estamos fechados agora.${l.proximaAbertura ? ` ${l.proximaAbertura}.` : ''}`
      return { mensagens: [t('horario', { aberto_agora: aberto, horario: l.gradeHorario ?? '' })] }
    }
    case 'pagamento': {
      if (!temPix(l)) {
        const semPix = renderizar(textoDe('pagamento', l.textos), { ...base, formas_pagamento: formasPagamento(l), tipo_chave: '' })
        return { mensagens: [semPix] }
      }
      const tipo = TIPOS_CHAVE[l.pixTipo ?? ''] ?? 'Pix'
      return { mensagens: [t('pagamento', { formas_pagamento: formasPagamento(l), tipo_chave: tipo }), l.pixChave!.trim()] }
    }
    case 'endereco':
      return { mensagens: [t('endereco', { endereco: l.endereco ?? '', retirada: retirada(l) })] }
    case 'reclamacao':
      return { mensagens: [t('reclamacao')] }
    case 'atendente':
      if (decisao.porSemPix) return { mensagens: ['*💠 Pix*\n\nJá chamei alguém da loja para te passar a chave Pix. Só um instante! 🙏'] }
      return { mensagens: [t(decisao.porNaoEntender ? 'atendente_nao_entendeu' : 'atendente')] }
    case 'parar':
      return { mensagens: [t('parar')] }
    case 'audio':
      return { mensagens: [t('audio')] }
    case 'pedir_link':
      return { mensagens: [t('pedir_link')], autoEstado: 'pedir_link' }
    case 'pedir_sem_link':
      return { mensagens: [t('pedir_sem_link')], autoEstado: null }
    case 'pix_chave': {
      // A chave sai SOZINHA na 2ª mensagem (fácil de copiar); com pedido em aberto, o valor vai junto (16/10).
      const tipo = TIPOS_CHAVE[l.pixTipo ?? ''] ?? 'Pix'
      const p = ctx.pedido
      const valor = p ? `\nValor do pedido \`#${p.numero}\`: *${brl(p.total)}*` : ''
      return { mensagens: [`*💠 Chave Pix (${tipo})*${valor}\n\nCopie a chave na mensagem abaixo 👇 e mande o comprovante aqui.`, l.pixChave!.trim()] }
    }
    case 'resumo_pedido': {
      // O cliente mandou o resumo que a vitrine abre no WhatsApp: confirma o pedido. Nunca manda o link (16/10).
      const p = ctx.pedido
      if (!p) return { mensagens: ['*👍 Recebemos sua mensagem!*\n\nAssim que o pedido aparecer aqui, você recebe a confirmação.'] }
      return { mensagens: [`*👍 Recebemos seu pedido \`#${p.numero}\`!*\n\n> ${p.rotuloStatus}`] }
    }
  }
}
