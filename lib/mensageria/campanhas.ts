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

export const MARCADOR_NOME = '{nome}'
export const VARIAVEIS_CAMPANHA = [MARCADOR_NOME, MARCADOR_LINK] as const
export const RODAPE_DESCADASTRO = 'Para não receber mais, responda SAIR.'

/** Primeiro nome do cliente para o {nome}; sem nome, "cliente". */
export function primeiroNome(nome: string | null | undefined): string {
  const palavra = (nome ?? '').trim().split(/\s+/)[0] ?? ''
  const limpa = palavra.replace(/[^\p{L}'-]/gu, '')
  if (!limpa) return 'cliente'
  return limpa[0].toUpperCase() + limpa.slice(1).toLowerCase()
}

/**
 * Variáveis que a mensagem usa e o sistema não conhece — bloqueiam o salvar. Antes,
 * `{Nome}` ou `{cupom}` saíam literais para o cliente. `{link}` sem o link ligado também.
 */
export function problemasDasVariaveis(mensagem: string, opcoes: { incluirLink: boolean }): string | null {
  const usadas = [...new Set((mensagem ?? '').match(/\{[^{}\n]{0,40}\}/g) ?? [])]
  const desconhecidas = usadas.filter((v) => !(VARIAVEIS_CAMPANHA as readonly string[]).includes(v))
  if (desconhecidas.length) {
    return `Variável desconhecida: ${desconhecidas.join(', ')}. Use {nome} (primeiro nome do cliente) ou {link} (link do cardápio).`
  }
  if (!opcoes.incluirLink && usadas.includes(MARCADOR_LINK)) {
    return 'A mensagem usa {link}, mas "Incluir link do cardápio" está desligado. Ligue a opção ou tire o {link}.'
  }
  return null
}

/**
 * Texto que sai para o cliente: {nome} vira o primeiro nome (ou "cliente"); com o link
 * ligado, {link} vira o link do destinatário (ou ele vai no fim); com o descadastro ligado,
 * o rodapé "Para não receber mais, responda SAIR." fecha a mensagem.
 */
/**
 * Botões de link da campanha (Fase 4, 2026-09-30). A conexão das lojas é pelo WhatsApp Web
 * (Evolution 2.3.7/Baileys, QR Code): o envio de botões dá erro nessa versão e, quando sai,
 * não aparece em parte dos aparelhos — além de arriscar o número. Por isso os botões saem
 * SEMPRE como links no texto, um por linha ("👉 Ver cardápio: https://..."); o primeiro
 * link gera a prévia com a imagem da loja. A campanha nunca falha por causa dos botões.
 */
export const BOTOES_MAX = 2
export const BOTAO_TEXTO_MAX = 20

export interface BotaoCampanha { texto: string; url: string }

/** Valida e limpa os botões vindos da tela. Erro em português ou a lista pronta. */
export function validarBotoes(bruto: unknown): { ok: true; botoes: BotaoCampanha[] } | { ok: false; erro: string } {
  if (bruto === undefined || bruto === null) return { ok: true, botoes: [] }
  if (!Array.isArray(bruto)) return { ok: false, erro: 'Botões inválidos.' }
  const lista = (bruto as Partial<BotaoCampanha>[]).filter((b) => b && (String(b.texto ?? '').trim() || String(b.url ?? '').trim()))
  if (lista.length > BOTOES_MAX) return { ok: false, erro: `No máximo ${BOTOES_MAX} botões.` }
  const botoes: BotaoCampanha[] = []
  for (const b of lista) {
    const texto = String(b.texto ?? '').trim()
    const url = String(b.url ?? '').trim()
    if (!texto) return { ok: false, erro: 'Escreva o texto do botão.' }
    if (texto.length > BOTAO_TEXTO_MAX) return { ok: false, erro: `O texto do botão pode ter até ${BOTAO_TEXTO_MAX} caracteres.` }
    let u: URL
    try { u = new URL(url) } catch { return { ok: false, erro: `Link inválido no botão "${texto}".` } }
    if (u.protocol !== 'https:') return { ok: false, erro: `O link do botão "${texto}" precisa começar com https://` }
    botoes.push({ texto, url: u.toString() })
  }
  return { ok: true, botoes }
}

/** Os botões como linhas de texto (o jeito confiável de enviar pela conexão por QR Code). */
export function linhasDosBotoes(botoes: BotaoCampanha[] | null | undefined): string {
  return (botoes ?? []).map((b) => `👉 ${b.texto}: ${b.url}`).join('\n')
}

export function montarTextoCampanha(
  mensagem: string,
  opcoes: { incluirLink: boolean; token: string | null; nome?: string | null; incluirDescadastro?: boolean; botoes?: BotaoCampanha[] | null },
): string {
  let texto = (mensagem ?? '').split(MARCADOR_NOME).join(primeiroNome(opcoes.nome))
  if (opcoes.incluirLink && opcoes.token && TOKEN_VALIDO.test(opcoes.token)) {
    const link = linkRastreavel(opcoes.token)
    if (texto.includes(MARCADOR_LINK)) texto = texto.split(MARCADOR_LINK).join(link)
    else texto = texto.trim() ? `${texto.trimEnd()}\n\n👉 Peça pelo cardápio: ${link}` : link
  }
  const linhas = linhasDosBotoes(opcoes.botoes)
  if (linhas) texto = texto.trim() ? `${texto.trimEnd()}\n\n${linhas}` : linhas
  if (opcoes.incluirDescadastro) texto = texto.trim() ? `${texto.trimEnd()}\n\n${RODAPE_DESCADASTRO}` : RODAPE_DESCADASTRO
  return texto
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

/**
 * Um destinatário por telefone (a chave). Telefone que não é número de WhatsApp (curto,
 * dígito sobrando, vazio) fica FORA: antes entrava na fila, virava "erro" no envio e
 * contava como falha — e a estimativa da tela não batia com o que saía.
 */
export function deduplicarDestinatarios<T extends { telefone: string }>(lista: T[]): { unicos: T[]; repetidos: number; invalidos: number } {
  const vistos = new Set<string>()
  const unicos: T[] = []
  let invalidos = 0
  for (const d of lista) {
    const k = telefoneChave(d.telefone)
    if (!k) { invalidos++; continue }
    if (vistos.has(k)) continue
    vistos.add(k)
    unicos.push(d)
  }
  return { unicos, repetidos: lista.length - unicos.length - invalidos, invalidos }
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

export type SituacaoCampanha = 'rascunho' | 'agendada' | 'enviando' | 'pausada' | 'concluida' | 'concluida_com_falhas' | 'falhou' | 'cancelada'

/**
 * Como a campanha aparece na lista. "Concluída" com 0 enviados era mentira: a "SDAASD" da
 * Menuzia (28/09) teve as 4 mensagens recusadas (WhatsApp desconectado) e aparecia
 * "Concluída · 4/4". Agora: sem nenhum envio = "Falhou"; com parte = "Concluída com falhas".
 */
export function situacaoCampanha(c: { status: string; totalEnviados: number; totalErros: number }): SituacaoCampanha {
  if (c.status === 'concluida') {
    if (c.totalEnviados === 0) return 'falhou'
    if (c.totalErros > 0) return 'concluida_com_falhas'
    return 'concluida'
  }
  if (['rascunho', 'agendada', 'enviando', 'pausada', 'cancelada'].includes(c.status)) return c.status as SituacaoCampanha
  return 'rascunho'
}

/** Barra de progresso: enviados, falhas e o que ainda não saiu (fila, expirado, incerto). */
export function progressoCampanha(c: { totalDestinatarios: number; totalEnviados: number; totalErros: number }) {
  const total = Math.max(0, c.totalDestinatarios)
  const enviados = Math.min(total, Math.max(0, c.totalEnviados))
  const falhas = Math.min(total - enviados, Math.max(0, c.totalErros))
  return { total, enviados, falhas, restantes: total - enviados - falhas }
}
