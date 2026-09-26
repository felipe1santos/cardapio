/**
 * Provedor de WhatsApp atrás de uma interface só.
 *
 * A lógica do robô, da fila e dos avisos não conhece a Evolution: fala com
 * `ProvedorWhatsapp`. Trocar pela API oficial do WhatsApp (Meta) é escrever outra
 * implementação desta interface — envio e interpretação do webhook — sem mexer no resto.
 *
 * `simulado` existe para a suíte de testes (nenhuma comunicação externa). Só é usado com
 * `WHATSAPP_PROVEDOR=simulado` E `WHATSAPP_SIMULADO_ARQUIVO` definidos — produção não tem
 * nenhum dos dois.
 */
import { limparErro, mascararTelefone } from './mascara'

export type TipoMensagem = 'texto' | 'audio' | 'imagem' | 'video' | 'figurinha' | 'localizacao' | 'documento' | 'contato' | 'outro'

/** Mensagem que chegou, já sem nada específico do provedor. */
export interface MensagemRecebida {
  /** Id da mensagem no WhatsApp — único por instância. */
  waId: string
  /** Telefone do outro lado, só dígitos. `null` quando o provedor não informa (ex.: @lid). */
  telefone: string | null
  deMim: boolean
  grupo: boolean
  /** Status, broadcast, canal, newsletter: nunca respondido. */
  difusao: boolean
  tipo: TipoMensagem
  texto: string | null
  instante: string | null
}

export interface EventoWebhook {
  instancia: string | null
  /** Número do próprio WhatsApp da loja (quando o provedor informa). */
  numeroDaLoja: string | null
  mensagens: MensagemRecebida[]
}

export type ResultadoEnvio =
  | { ok: true; idExterno: string | null }
  | { ok: false; tipo: 'transitorio' | 'definitivo' | 'incerto'; erro: string }

export interface ProvedorWhatsapp {
  nome: string
  enviarTexto(instancia: string, numero: string, texto: string): Promise<ResultadoEnvio>
  enviarImagem(instancia: string, numero: string, url: string, legenda: string): Promise<ResultadoEnvio>
  enviarAudio(instancia: string, numero: string, url: string): Promise<ResultadoEnvio>
  interpretarWebhook(corpo: unknown): EventoWebhook
}

const TEMPO_LIMITE_MS = 15_000

// ─── Evolution ─────────────────────────────────────────────────────────────────

function jidParaTelefone(jid: unknown): string | null {
  if (typeof jid !== 'string') return null
  const [usuario, dominio] = jid.split('@')
  if (dominio !== 's.whatsapp.net' && dominio !== 'c.us') return null
  const d = (usuario ?? '').split(':')[0].replace(/\D/g, '')
  return d.length >= 10 && d.length <= 15 ? d : null
}

function tipoEvolution(m: Record<string, unknown> | undefined, tipo: unknown): { tipo: TipoMensagem; texto: string | null } {
  const msg = m ?? {}
  const txt = (msg.conversation as string | undefined) ?? (msg.extendedTextMessage as { text?: string } | undefined)?.text
  if (typeof txt === 'string') return { tipo: 'texto', texto: txt }
  const mapa: [string, TipoMensagem][] = [
    ['audioMessage', 'audio'], ['imageMessage', 'imagem'], ['videoMessage', 'video'], ['stickerMessage', 'figurinha'],
    ['locationMessage', 'localizacao'], ['liveLocationMessage', 'localizacao'], ['documentMessage', 'documento'],
    ['documentWithCaptionMessage', 'documento'], ['contactMessage', 'contato'], ['contactsArrayMessage', 'contato'],
  ]
  for (const [chave, t] of mapa) if (chave in msg || tipo === chave) return { tipo: t, texto: null }
  return { tipo: 'outro', texto: null }
}

export function interpretarWebhookEvolution(corpo: unknown): EventoWebhook {
  const c = (corpo ?? {}) as Record<string, unknown>
  const evento = String(c.event ?? '').toLowerCase().replace('_', '.')
  const vazio: EventoWebhook = { instancia: typeof c.instance === 'string' ? c.instance : null, numeroDaLoja: jidParaTelefone(c.sender), mensagens: [] }
  if (evento !== 'messages.upsert') return vazio
  const dados = Array.isArray(c.data) ? c.data : [c.data]
  for (const d of dados) {
    const item = (d ?? {}) as Record<string, unknown>
    const key = (item.key ?? {}) as Record<string, unknown>
    const jid = typeof key.remoteJid === 'string' ? key.remoteJid : ''
    const waId = typeof key.id === 'string' ? key.id : ''
    if (!waId) continue
    const { tipo, texto } = tipoEvolution(item.message as Record<string, unknown> | undefined, item.messageType)
    const ts = Number(item.messageTimestamp)
    vazio.mensagens.push({
      waId: waId.slice(0, 200),
      // Endereço @lid (privacidade do WhatsApp): o número vem, quando vem, em senderPn/remoteJidAlt.
      telefone: jidParaTelefone(jid) ?? jidParaTelefone(key.senderPn) ?? jidParaTelefone(key.remoteJidAlt),
      deMim: key.fromMe === true,
      grupo: jid.endsWith('@g.us'),
      difusao: jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter'),
      tipo,
      texto: texto === null ? null : texto.slice(0, 1000),
      instante: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
    })
  }
  return vazio
}

async function postarEvolution(caminho: string, corpo: unknown): Promise<ResultadoEnvio> {
  const url = process.env.EVOLUTION_API_URL
  const chave = process.env.EVOLUTION_API_KEY
  if (!url || !chave) return { ok: false, tipo: 'definitivo', erro: 'Evolution não configurada no servidor' }
  const controle = new AbortController()
  const t = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS)
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}${caminho}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chave },
      body: JSON.stringify(corpo),
      signal: controle.signal,
    })
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as { key?: { id?: string } } | null
      return { ok: true, idExterno: j?.key?.id ?? null }
    }
    const erro = limparErro(`HTTP ${res.status} ${await res.text().catch(() => '')}`)
    // 5xx e 429: o provedor pode voltar. 4xx: o pedido está errado (número, instância).
    return { ok: false, tipo: res.status >= 500 || res.status === 429 ? 'transitorio' : 'definitivo', erro }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      // O provedor pode ter aceitado e só a resposta demorou: não reenviar sozinho.
      return { ok: false, tipo: 'incerto', erro: 'tempo esgotado aguardando o provedor (pode ter sido entregue)' }
    }
    return { ok: false, tipo: 'transitorio', erro: limparErro((e as Error).message) }
  } finally {
    clearTimeout(t)
  }
}

export const provedorEvolution: ProvedorWhatsapp = {
  nome: 'evolution',
  enviarTexto: (inst, numero, texto) => postarEvolution(`/message/sendText/${encodeURIComponent(inst)}`, { number: numero, text: texto }),
  enviarImagem: (inst, numero, url, legenda) =>
    postarEvolution(`/message/sendMedia/${encodeURIComponent(inst)}`, { number: numero, mediatype: 'image', media: url, caption: legenda }),
  enviarAudio: (inst, numero, url) => postarEvolution(`/message/sendWhatsAppAudio/${encodeURIComponent(inst)}`, { number: numero, audio: url }),
  interpretarWebhook: interpretarWebhookEvolution,
}

// ─── Simulado (testes) ─────────────────────────────────────────────────────────

interface ControleSimulado {
  /** Próximas N chamadas falham deste jeito. */
  falhar?: 'transitorio' | 'definitivo' | 'incerto' | null
  restantes?: number
}

/**
 * `fs` só quando o simulado está ativo, e sem import estático: `lib/whatsapp` também entra
 * no bundle do navegador (via lib/queries/clientes), onde `node:fs` não existe.
 */
function fsDoServidor(): typeof import('node:fs') {
  const p = process as unknown as { getBuiltinModule?: (m: string) => unknown }
  if (typeof window !== 'undefined' || !p.getBuiltinModule) throw new Error('provedor simulado só no servidor (Node 22+)')
  return p.getBuiltinModule('node:fs') as typeof import('node:fs')
}

function registrarSimulado(arquivo: string, registro: Record<string, unknown>): ResultadoEnvio {
  const { appendFileSync, existsSync, readFileSync, writeFileSync } = fsDoServidor()
  const arqControle = `${arquivo}.controle.json`
  let controle: ControleSimulado = {}
  if (existsSync(arqControle)) {
    try { controle = JSON.parse(readFileSync(arqControle, 'utf8')) } catch { controle = {} }
  }
  if (controle.falhar && (controle.restantes ?? 0) > 0) {
    writeFileSync(arqControle, JSON.stringify({ ...controle, restantes: (controle.restantes ?? 1) - 1 }))
    appendFileSync(arquivo, JSON.stringify({ ...registro, resultado: controle.falhar, em: new Date().toISOString() }) + '\n')
    return { ok: false, tipo: controle.falhar, erro: `simulado: ${controle.falhar}` }
  }
  const idExterno = `SIM${Date.now()}${Math.random().toString(36).slice(2, 8)}`
  appendFileSync(arquivo, JSON.stringify({ ...registro, resultado: 'ok', idExterno, em: new Date().toISOString() }) + '\n')
  return { ok: true, idExterno }
}

export function provedorSimulado(arquivo: string): ProvedorWhatsapp {
  return {
    nome: 'simulado',
    enviarTexto: async (instancia, numero, texto) => registrarSimulado(arquivo, { instancia, numero, texto }),
    enviarImagem: async (instancia, numero, url, legenda) => registrarSimulado(arquivo, { instancia, numero, texto: legenda, midia: url }),
    enviarAudio: async (instancia, numero, url) => registrarSimulado(arquivo, { instancia, numero, midia: url }),
    interpretarWebhook: interpretarWebhookEvolution,
  }
}

/** O provedor em uso. Simulado só com as duas variáveis explícitas. */
export function provedorAtual(): ProvedorWhatsapp {
  const arquivo = process.env.WHATSAPP_SIMULADO_ARQUIVO
  if (process.env.WHATSAPP_PROVEDOR === 'simulado' && arquivo) return provedorSimulado(arquivo)
  return provedorEvolution
}

/** Log de falha sem número completo nem conteúdo. */
export function logFalhaEnvio(contexto: string, numero: string, erro: string) {
  console.error(`[whatsapp] ${contexto} para ${mascararTelefone(numero)}: ${limparErro(erro)}`)
}
