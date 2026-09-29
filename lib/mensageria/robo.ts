/**
 * Robô de atendimento v1 (sem IA) — regras puras: o que o cliente quis e o que responder.
 *
 * O estado (boas-vindas na janela, silêncio, volta ao robô, resposta padrão no máximo a
 * cada 10 min) é decidido no banco, sob trava da conversa (`whatsapp_registrar_entrada`,
 * 0103). Aqui só a classificação e os textos.
 *
 * O robô só afirma o que o sistema sabe: status do pedido (servidor, pelo telefone),
 * horário (grade da loja), taxa por BAIRRO cadastrado (sem geocodificar nada) e o link do
 * cardápio. Não cria, não cancela, não altera pedido e não recebe pagamento.
 */
import type { TipoMensagem } from './provedor'
import { lojaEstaAberta, textoProximaAbertura, turnosDoDia, type HorarioFuncionamento, type StatusLoja } from '@/lib/timezone'
import { normalizarBairro } from '@/lib/frete'

export type Intencao = 'menu' | 'status' | 'atendente' | 'cardapio' | 'horario' | 'taxa' | 'outro' | 'midia'
export type Acao = 'nada' | 'boas_vindas' | 'status' | 'atendente' | 'cardapio' | 'horario' | 'taxa' | 'padrao'

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const ATENDENTE = /\b(atendente|atendimento humano|humano|pessoa|alguem|falar com (a )?(loja|voces|voce|dono|gerente)|quero falar)\b/
const STATUS = /\b(meu pedido|meus pedidos|minh[ao] (ultimo )?pedido|ultimo pedido|pedido (anterior|recente)|minha encomenda|status|cade|onde (esta|ta|anda|fica) (o |meu )?pedido|acompanhar|rastrear|ja saiu|vai demorar|demora|meu lanche|minha pizza|chegou)\b/
const TAXA = /\b(taxa|frete|valor da entrega|quanto (e|custa|fica) (a )?entrega|entregam (no|na|em|para|pro))\b/
const HORARIO = /\b(horarios?|que horas|hora (que|de)|abert[oa]s?|abre|abrem|fecha|fecham|fechad[oa]s?|funcionamento|funciona)\b/
const CARDAPIO = /\b(cardapio|fazer (um )?pedido|faco (um )?pedido|quero pedir|pedir|link|precos?|valores)\b/
const MENU = /^(0|menu|oi+|ola|opa|eai|e ai|bom dia|boa tarde|boa noite|inicio|ajuda|opcoes|help)\b/

/** Opção do menu (0–5) ou palavras. Mídia nunca é texto reconhecido. */
export function classificarIntencao(tipo: TipoMensagem, texto: string | null): Intencao {
  if (tipo !== 'texto') return 'midia'
  const t = normalizar(texto ?? '')
  if (!t) return 'outro'
  const opcao = /^([0-5])\b/.exec(t)?.[1]
  if (opcao === '2' || ATENDENTE.test(t)) return 'atendente'
  if (opcao === '1' || STATUS.test(t)) return 'status'
  if (opcao === '5' || TAXA.test(t)) return 'taxa'
  if (opcao === '4' || HORARIO.test(t)) return 'horario'
  if (opcao === '3' || CARDAPIO.test(t)) return 'cardapio'
  if (opcao === '0' || MENU.test(t)) return 'menu'
  return 'outro'
}

/**
 * Bairro escrito junto do pedido de taxa: "taxa Centro", "5 jardim camburi", "frete para
 * Praia do Canto". `null` quando a pessoa só perguntou a taxa.
 */
export function extrairBairro(texto: string | null): string | null {
  const bruto = (texto ?? '').replace(/\s+/g, ' ').trim()
  // Conectores só como palavra inteira ("pra" não come o começo de "Praia").
  const m = /^(?:5\b|.*?\b(?:taxa|frete)\b)(?:\s+de\s+entrega\b)?(?:\s+(?:para|pra|pro|no|na|em|do|da|de|bairro)\b)*\s*[:\-–]?\s*(.+)$/i.exec(bruto)
  const b = m?.[1]?.replace(/[?!.]+$/, '').trim()
  if (!b || b.length < 2 || b.length > 60 || /^\d+$/.test(b)) return null
  return b
}

export const BASE_PUBLICA = () => (process.env.MENUZIA_URL_PUBLICA ?? 'https://app.menuzia.com.br').replace(/\/$/, '')

export function linkDaLoja(slug: string): string {
  return `${BASE_PUBLICA()}/loja/${slug}`
}

export const MENU_OPCOES = [
  'Responda com o número:',
  '*1* Status do meu último pedido',
  '*2* Falar com um atendente',
  '*3* Cardápio e pedidos',
  '*4* Horário de funcionamento',
  '*5* Taxa de entrega (ex.: *taxa Centro*)',
].join('\n')

export const BOAS_VINDAS_PADRAO = (nomeLoja: string) =>
  `Olá! 👋 Aqui é o atendimento automático da *${nomeLoja}*.`

export interface DadosLoja {
  nome: string
  slug: string
  /** Texto próprio da loja (Integrações). Vazio = padrão. */
  boasVindas: string | null
}

const saudar = (loja: DadosLoja, sim: boolean) => (sim ? `${BOAS_VINDAS_PADRAO(loja.nome)}\n\n` : '')
const rodape = '\n\nDigite *0* para ver as opções ou *2* para falar com um atendente.'

export function textoBoasVindas(loja: DadosLoja): string {
  const link = linkDaLoja(loja.slug)
  const abertura = (loja.boasVindas ?? '').trim() || BOAS_VINDAS_PADRAO(loja.nome)
  const comLink = abertura.includes(link) ? abertura : `${abertura}\n\nFaça seu pedido pelo cardápio: ${link}`
  return `${comLink}\n\n${MENU_OPCOES}`
}

export function textoCardapio(loja: DadosLoja, comSaudacao = false): string {
  return `${saudar(loja, comSaudacao)}Nosso cardápio, com preços e o pedido online: ${linkDaLoja(loja.slug)}${rodape}`
}

/** Resposta para o que não foi entendido, variando pelo tipo do que chegou. */
export function textoPadrao(loja: DadosLoja, tipo: TipoMensagem = 'texto', comSaudacao = false): string {
  const link = linkDaLoja(loja.slug)
  const aviso: Partial<Record<TipoMensagem, string>> = {
    audio: 'Ainda não consigo ouvir áudios por aqui 🙏',
    imagem: 'Ainda não consigo ver imagens por aqui 🙏',
    video: 'Ainda não consigo ver vídeos por aqui 🙏',
    figurinha: 'Recebi sua figurinha 😄',
    documento: 'Ainda não consigo abrir arquivos por aqui 🙏',
    contato: 'Ainda não consigo usar contatos compartilhados por aqui 🙏',
    localizacao: 'Recebi sua localização! Para saber a taxa, digite *taxa* e o seu bairro (ex.: *taxa Centro*) ou veja no cardápio.',
  }
  const inicio = aviso[tipo] ?? 'Não entendi 🙏 Por aqui eu consigo te ajudar com o básico.'
  return `${saudar(loja, comSaudacao)}${inicio}\n\nCardápio: ${link}\n\n${MENU_OPCOES}`
}

/**
 * Descadastro das campanhas (0112). Só a mensagem INTEIRA conta ("sair", "SAIR!", "parar"),
 * para "vou sair de casa" ou "quero cancelar o pedido" nunca descadastrarem ninguém.
 * "cancelar" fica de fora de propósito: é como o cliente pede para cancelar um pedido.
 */
const PALAVRAS_SAIR = new Set([
  'sair', 'parar', 'pare', 'stop', 'descadastrar', 'descadastro', 'descadastre', 'remover', 'me remova', 'me tira', 'me tire',
  'nao quero mais', 'nao quero receber', 'nao quero mais receber', 'parar de receber', 'sair da lista', 'nao envie mais', 'nao mande mais',
])
const PALAVRAS_VOLTAR = new Set(['voltar', 'quero voltar', 'voltar a receber', 'receber de novo', 'quero receber'])

export function pedidoDeDescadastro(tipo: TipoMensagem, texto: string | null): 'sair' | 'voltar' | null {
  if (tipo !== 'texto') return null
  const t = normalizar(texto ?? '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t || t.length > 40) return null
  if (PALAVRAS_SAIR.has(t)) return 'sair'
  if (PALAVRAS_VOLTAR.has(t)) return 'voltar'
  return null
}

export function textoDescadastro(loja: DadosLoja, sair: boolean): string {
  return sair
    ? `Pronto! Você não vai mais receber promoções da *${loja.nome}* por aqui. Os avisos dos seus pedidos continuam chegando normalmente.\n\nSe mudar de ideia, é só responder *VOLTAR*.`
    : `Combinado! Você voltou a receber as novidades da *${loja.nome}*. Para parar, é só responder *SAIR*.`
}

export function textoAtendente(loja: DadosLoja): string {
  return `Certo! Vou chamar alguém da *${loja.nome}*. Um atendente continua a conversa por aqui assim que possível — enquanto isso, eu fico quietinho.`
}

export interface PedidoParaStatus {
  numero: number
  rotulo: string
  criadoEm: string
}

export function textoStatus(loja: DadosLoja, pedido: PedidoParaStatus | null, comSaudacao: boolean): string {
  const saudacao = saudar(loja, comSaudacao)
  if (!pedido) {
    return `${saudacao}Não encontrei pedido feito com este número na *${loja.nome}*.\n\nPara pedir: ${linkDaLoja(loja.slug)}\n\nDigite *2* para falar com um atendente.`
  }
  const quando = new Date(pedido.criadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
  return `${saudacao}Seu pedido *#${pedido.numero}* (${quando}) está: *${pedido.rotulo}*.\n\nDigite *2* se precisar falar com um atendente.`
}

// ─── horário ──────────────────────────────────────────────────────────────────

export interface HorarioLoja {
  statusLoja: StatusLoja
  horarioFuncionamento: HorarioFuncionamento | null
}

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export function textoHorario(loja: DadosLoja, h: HorarioLoja, comSaudacao = false): string {
  const aberta = lojaEstaAberta(h)
  const agora = aberta ? '🟢 Estamos *abertos* agora.' : '🔴 Estamos *fechados* agora.'
  const proxima = aberta ? null : textoProximaAbertura(h)
  const linhas: string[] = []
  if (h.horarioFuncionamento) {
    for (let d = 0; d < 7; d++) {
      const turnos = turnosDoDia(h.horarioFuncionamento, d)
      linhas.push(`${DIAS[d]}: ${turnos.length ? turnos.map((t) => `${t.abre}–${t.fecha}`).join(' e ') : 'fechado'}`)
    }
  }
  const grade = linhas.length ? `\n\n${linhas.join('\n')}` : ''
  const prox = proxima ? ` A loja ${proxima}.` : ''
  return `${saudar(loja, comSaudacao)}${agora}${prox}${grade}\n\nCardápio: ${linkDaLoja(loja.slug)}${rodape}`
}

// ─── taxa por bairro ──────────────────────────────────────────────────────────

export interface FreteLoja {
  bairros: { bairro: string; taxa: number }[]
  /** Faixas por distância: o robô não geocodifica — com elas, o valor final é no cardápio. */
  temRaio: boolean
  taxaPadrao: number
  foraDaLista: 'bloquear' | 'taxa_padrao'
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Taxa de entrega pelo BAIRRO cadastrado. Nunca promete o que depende do endereço
 * completo: com faixas por distância o valor pode ser menor, e fora da lista só a taxa
 * padrão quando a loja aceita. O valor final é o do cardápio, ao informar o endereço.
 */
export function textoTaxa(loja: DadosLoja, bairro: string | null, frete: FreteLoja, comSaudacao = false): string {
  const link = linkDaLoja(loja.slug)
  const inicio = saudar(loja, comSaudacao)
  if (!bairro) {
    return `${inicio}Me diga o bairro junto: por exemplo *taxa Centro*.\n\nOu veja no cardápio, ao informar o endereço: ${link}${rodape}`
  }
  const alvo = normalizarBairro(bairro)
  const achou = frete.bairros.find((b) => normalizarBairro(b.bairro) === alvo)
  const fim = `\n\nO valor final aparece no cardápio, ao informar o endereço: ${link}${rodape}`
  if (achou) {
    const valor = achou.taxa > 0 ? brl(achou.taxa) : 'grátis'
    const talvezMenor = frete.temRaio ? ' (pode sair menor, dependendo da distância)' : ''
    return `${inicio}A taxa de entrega para *${achou.bairro}* é *${valor}*${talvezMenor}.${fim}`
  }
  if (frete.temRaio) {
    return `${inicio}Para *${bairro}* a taxa depende da distância até o endereço.${fim}`
  }
  if (frete.foraDaLista === 'taxa_padrao') {
    return `${inicio}Para *${bairro}* a taxa de entrega é *${frete.taxaPadrao > 0 ? brl(frete.taxaPadrao) : 'grátis'}*.${fim}`
  }
  return `${inicio}Não encontrei *${bairro}* na nossa lista de bairros atendidos. Confira no cardápio ou fale com um atendente (*2*).\n\nCardápio: ${link}`
}

// ─── telefones ────────────────────────────────────────────────────────────────

/**
 * Formas em que o MESMO celular pode estar gravado no pedido: com/sem 55 e com/sem o
 * nono dígito (o WhatsApp de alguns números ainda chega sem o 9).
 */
export function variantesTelefone(telefoneWhatsapp: string): string[] {
  let d = telefoneWhatsapp.replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length !== 10 && d.length !== 11) return []
  const ddd = d.slice(0, 2)
  const resto = d.slice(2)
  const locais = new Set<string>([d])
  if (resto.length === 8) locais.add(`${ddd}9${resto}`)
  if (resto.length === 9 && resto.startsWith('9')) locais.add(`${ddd}${resto.slice(1)}`)
  const out = new Set<string>()
  for (const l of locais) {
    out.add(l)
    out.add(`55${l}`)
  }
  return [...out]
}

/**
 * Lista branca para o teste real controlado: com `WHATSAPP_ROBO_SOMENTE=<números>` (só
 * dígitos, separados por vírgula), o robô ignora TODO outro número. Sem a variável, vale
 * para todos.
 */
export function numeroPermitido(telefone: string, lista: string | undefined): boolean {
  const permitidos = (lista ?? '').split(',').map((n) => n.replace(/\D/g, '')).filter(Boolean)
  if (!permitidos.length) return true
  return permitidos.some((n) => variantesTelefone(n).includes(telefone) || n === telefone)
}

/**
 * Trava do servidor: o robô só responde (e a fila do robô só envia) com
 * `WHATSAPP_ROBO_LIBERADO=1` no ambiente. Sem ela, ligar numa loja não faz nada — é a
 * garantia de que publicar o código não manda mensagem real.
 */
export function roboLiberadoNoServidor(env: Record<string, string | undefined> = process.env): boolean {
  return env.WHATSAPP_ROBO_LIBERADO === '1'
}
