/**
 * Canal de suporte da Menuzia no painel administrativo — o ÚNICO lugar do número.
 *
 * Antes o número vinha de NEXT_PUBLIC_SUPORTE_WHATSAPP com um padrão copiado da tela
 * da integração Nexta (5527998925966), que é o suporte da Nexta, não o da Menuzia:
 * o "Dúvidas?" abria a conversa errada. Sem variável de ambiente agora — um valor
 * esquecido no servidor voltaria a mandar a loja para o número errado.
 * (O contato da Nexta, na tela da integração, continua lá: é o suporte deles.)
 */
export const SUPORTE_MENUZIA = {
  exibicao: '(27) 99853-4407',
  whatsapp: '5527998534407',
} as const

const ROTULO_PAPEL: Record<string, string> = {
  dono: 'Dono',
  gerente: 'Gerente',
  garcom: 'Garçom',
  atendente: 'Atendente',
  cozinha: 'Cozinha',
  logistica: 'Logística',
  entregador: 'Entregador',
}

/** Limite do texto digitado: cabe numa conversa e mantém a URL do wa.me curta. */
export const DUVIDA_MAX = 1000

/**
 * Caminho da tela, seguro para ir numa mensagem: sem query string nem fragmento
 * (onde moram tokens e filtros) e com identificadores trocados por ":id" — uuid,
 * número, token longo. "/admin/mesas/3f2c…?aba=conta" vira "/admin/mesas/:id".
 */
export function caminhoSeguro(caminho: string | null | undefined): string {
  const semResto = (caminho ?? '').split(/[?#]/)[0] ?? ''
  const partes = semResto.split('/').filter(Boolean).map((p) => {
    let s = p
    try { s = decodeURIComponent(p) } catch { /* segmento malformado: trata como id */ return ':id' }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return ':id'
    if (/^\d+$/.test(s)) return ':id'
    if (s.length >= 16 && /\d/.test(s) && /^[A-Za-z0-9_-]+$/.test(s)) return ':id'
    if (!/^[a-z0-9-]+$/i.test(s)) return ':id'
    return s
  })
  return '/' + partes.join('/')
}

export interface DadosSuporte {
  loja?: string | null
  usuario?: string | null
  papel?: string | null
  caminho?: string | null
  duvida: string
}

/**
 * Texto da mensagem. Só o necessário para o suporte saber de quem é e onde: loja,
 * nome exibido, perfil, tela (caminho seguro) e a dúvida. Nada de token, senha,
 * cookie, query string, id interno, cliente ou pedido.
 */
export function mensagemDoSuporte(d: DadosSuporte): string {
  const linha = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim() || '—'
  const duvida = d.duvida.trim().slice(0, DUVIDA_MAX)
  return [
    'Olá! Preciso de ajuda com o Menuzia.',
    '',
    `Loja: ${linha(d.loja)}`,
    `Usuário: ${linha(d.usuario)}`,
    `Perfil: ${ROTULO_PAPEL[d.papel ?? ''] ?? linha(d.papel)}`,
    `Tela: ${caminhoSeguro(d.caminho)}`,
    '',
    'Dúvida:',
    duvida,
  ].join('\n')
}

/** Link do WhatsApp do suporte com a mensagem codificada. Dúvida vazia → null. */
export function linkDoSuporte(d: DadosSuporte): string | null {
  if (!d.duvida.trim()) return null
  return `https://wa.me/${SUPORTE_MENUZIA.whatsapp}?text=${encodeURIComponent(mensagemDoSuporte(d))}`
}

/**
 * O agente de impressão avisa que está vivo de tempos em tempos. Passado este
 * silêncio, o painel trata como desconectado: dizer "conectado" para uma
 * impressora que caiu há uma hora faria o dono perder pedido sem saber.
 */
export const SILENCIO_AGENTE_MS = 3 * 60_000

export type EstadoImpressora = 'conectada' | 'desconectada' | 'sem-agente'

export function estadoDaImpressora(
  status: { impressoraId: string | null; vistoEm: string | null } | null,
  agora: number,
): EstadoImpressora {
  if (!status || !status.vistoEm) return 'sem-agente'
  const visto = new Date(status.vistoEm).getTime()
  if (Number.isNaN(visto)) return 'sem-agente'
  if (agora - visto > SILENCIO_AGENTE_MS) return 'desconectada'
  return status.impressoraId ? 'conectada' : 'desconectada'
}

export const ROTULO_IMPRESSORA: Record<EstadoImpressora, string> = {
  conectada: 'Impressão automática ligada',
  desconectada: 'Assistente de impressão fora do ar',
  'sem-agente': 'Impressão automática não configurada',
}
