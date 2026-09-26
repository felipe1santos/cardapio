/**
 * Robô de atendimento v1 (sem IA) — regras puras: o que o cliente quis e o que responder.
 *
 * O estado (boas-vindas na janela de 12h, silêncio, volta após 2h, resposta padrão no
 * máximo a cada 10 min) é decidido no banco, sob trava da conversa
 * (`whatsapp_registrar_entrada`, 0102). Aqui só a classificação e os textos.
 *
 * Nada de preço, taxa, horário ou produto na resposta: o robô manda o link do cardápio,
 * que é onde essas regras vivem. Status do pedido vem do servidor, pelo telefone.
 */
import type { TipoMensagem } from './provedor'

export type Intencao = 'status' | 'atendente' | 'outro' | 'midia'
export type Acao = 'nada' | 'boas_vindas' | 'status' | 'atendente' | 'padrao'

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const ATENDENTE = /\b(atendente|atendimento humano|humano|pessoa|alguem|falar com (a )?(loja|voces|voce|dono|gerente)|quero falar)\b/
const STATUS = /\b(meu pedido|status|cade|onde (esta|ta|anda|fica) (o |meu )?pedido|acompanhar|rastrear|ja saiu|vai demorar|demora|meu lanche|minha pizza|chegou)\b/

/** Opção do menu (1/2) ou palavras. Mídia nunca é texto reconhecido. */
export function classificarIntencao(tipo: TipoMensagem, texto: string | null): Intencao {
  if (tipo !== 'texto') return 'midia'
  const t = normalizar(texto ?? '')
  if (!t) return 'outro'
  if (t === '2' || /^2\b/.test(t) || ATENDENTE.test(t)) return 'atendente'
  if (t === '1' || /^1\b/.test(t) || STATUS.test(t)) return 'status'
  return 'outro'
}

export const BASE_PUBLICA = () => (process.env.MENUZIA_URL_PUBLICA ?? 'https://app.menuzia.com.br').replace(/\/$/, '')

export function linkDaLoja(slug: string): string {
  return `${BASE_PUBLICA()}/loja/${slug}`
}

const MENU = 'Digite *1* para ver o status do seu último pedido ou *2* para falar com um atendente.'

export const BOAS_VINDAS_PADRAO = (nomeLoja: string) =>
  `Olá! 👋 Aqui é o atendimento automático da *${nomeLoja}*.`

export interface DadosLoja {
  nome: string
  slug: string
  /** Texto próprio da loja (Integrações). Vazio = padrão. */
  boasVindas: string | null
}

export function textoBoasVindas(loja: DadosLoja): string {
  const link = linkDaLoja(loja.slug)
  const abertura = (loja.boasVindas ?? '').trim() || BOAS_VINDAS_PADRAO(loja.nome)
  const comLink = abertura.includes(link) ? abertura : `${abertura}\n\nFaça seu pedido pelo cardápio: ${link}`
  return `${comLink}\n\n${MENU}`
}

export function textoPadrao(loja: DadosLoja): string {
  return `Por aqui eu consigo te ajudar com o cardápio e o status do pedido 🙏\n\nCardápio: ${linkDaLoja(loja.slug)}\n\n${MENU}`
}

export function textoAtendente(loja: DadosLoja): string {
  return `Certo! Vou chamar alguém da *${loja.nome}*. Responderemos por aqui assim que possível.`
}

export interface PedidoParaStatus {
  numero: number
  rotulo: string
  criadoEm: string
}

export function textoStatus(loja: DadosLoja, pedido: PedidoParaStatus | null, comSaudacao: boolean): string {
  const saudacao = comSaudacao ? `${BOAS_VINDAS_PADRAO(loja.nome)}\n\n` : ''
  if (!pedido) {
    return `${saudacao}Não encontrei pedido feito com este número na *${loja.nome}*.\n\nPara pedir: ${linkDaLoja(loja.slug)}\n\nDigite *2* para falar com um atendente.`
  }
  const quando = new Date(pedido.criadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
  return `${saudacao}Seu pedido *#${pedido.numero}* (${quando}) está: *${pedido.rotulo}*.\n\nDigite *2* se precisar falar com um atendente.`
}

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
