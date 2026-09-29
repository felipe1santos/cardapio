/**
 * Campanhas: link rastreável, texto final e status de entrega/leitura vindos do provedor.
 *
 * O link é `/c/<token>`: 24 hex aleatórios por destinatário (0104), sem telefone, nome ou
 * id de campanha. Quem abre é redirecionado ao cardápio da loja e o clique fica no envio.
 * A conversão (pedido em até 12h) é calculada no banco na hora de ler as métricas.
 */
import { BASE_PUBLICA } from './robo'

export const MARCADOR_LINK = '{link}'
export const TOKEN_VALIDO = /^[0-9a-f]{24}$/

export function linkRastreavel(token: string): string {
  return `${BASE_PUBLICA()}/c/${token}`
}

/**
 * Texto que sai para o cliente. Com o link ligado: troca `{link}` pelo link do
 * destinatário, ou acrescenta no fim se a mensagem não tiver o marcador. Com o link
 * desligado a mensagem sai como a loja escreveu (campanhas antigas não mudam).
 */
export function montarTextoCampanha(mensagem: string, opcoes: { incluirLink: boolean; token: string | null }): string {
  const texto = mensagem ?? ''
  if (!opcoes.incluirLink || !opcoes.token || !TOKEN_VALIDO.test(opcoes.token)) return texto
  const link = linkRastreavel(opcoes.token)
  if (texto.includes(MARCADOR_LINK)) return texto.split(MARCADOR_LINK).join(link)
  return texto.trim() ? `${texto.trimEnd()}\n\n👉 Peça pelo cardápio: ${link}` : link
}

/**
 * DDD + 8 últimos dígitos: o mesmo cliente com ou sem 55 e com ou sem o 9 dá a mesma
 * chave. Espelho de `public.telefone_chave` (0104) — os dois precisam concordar.
 */
export function telefoneChave(telefone: string | null | undefined): string | null {
  let d = (telefone ?? '').replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length !== 10 && d.length !== 11) return null
  return d.slice(0, 2) + d.slice(-8)
}

/** Um destinatário por telefone (a chave). Devolve os únicos e quantos repetidos saíram. */
export function deduplicarDestinatarios<T extends { telefone: string }>(lista: T[]): { unicos: T[]; repetidos: number } {
  const vistos = new Set<string>()
  const unicos: T[] = []
  for (const d of lista) {
    const k = telefoneChave(d.telefone) ?? d.telefone.replace(/\D/g, '')
    if (!k || vistos.has(k)) continue
    vistos.add(k)
    unicos.push(d)
  }
  return { unicos, repetidos: lista.length - unicos.length }
}

export type StatusCampanha = 'entregue' | 'lido'

/**
 * Status de mensagem da Evolution (Baileys) → o que a métrica guarda. Só entrega e
 * leitura: "lido" depende de o cliente deixar a confirmação de leitura ligada, então é
 * um piso, nunca o total. PLAYED (áudio ouvido) conta como lido.
 */
export function statusDoProvedor(status: unknown): StatusCampanha | null {
  if (typeof status === 'number') return status === 3 ? 'entregue' : status === 4 || status === 5 ? 'lido' : null
  const s = String(status ?? '').toUpperCase()
  if (s === 'DELIVERY_ACK' || s === 'DELIVERED') return 'entregue'
  if (s === 'READ' || s === 'PLAYED') return 'lido'
  return null
}

/** Pré-visualização de link (WhatsApp, redes, buscadores) e ferramentas não contam clique. */
export function acessoDeRobo(userAgent: string | null): boolean {
  const ua = userAgent ?? ''
  if (!ua.trim()) return true
  return /(bot|crawl|spider|preview|facebookexternalhit|whatsapp\/|telegram|slack|discord|skype|curl|wget|python|node-fetch|axios|headless|lighthouse)/i.test(ua)
}

/**
 * Horário agendado (ISO, UTC) → valor do `<input type="datetime-local">`, que é hora
 * LOCAL. `toISOString().slice(0, 16)` mostrava o horário em UTC (3h adiantado em São
 * Paulo) e o salvar relia como local: cada edição empurrava a campanha 3h para frente.
 */
export function paraCampoDataHora(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
