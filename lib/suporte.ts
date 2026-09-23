/**
 * Canal de suporte da Menuzia, usado pelo botão do topo do painel.
 *
 * O número vive em variável de ambiente porque muda por operação (e porque
 * número de atendimento não é coisa para ficar espalhada em componente). Sem a
 * variável, cai no contato que o projeto já usava na tela de integração — é
 * melhor abrir a conversa certa do que oferecer um botão morto.
 */
const PADRAO = '5527998925966'

export function numeroDoSuporte(env: string | undefined = process.env.NEXT_PUBLIC_SUPORTE_WHATSAPP): string {
  const limpo = (env ?? '').replace(/\D/g, '')
  return limpo.length >= 10 ? limpo : PADRAO
}

/**
 * Link do WhatsApp já com a mensagem inicial.
 *
 * O nome da loja entra no texto para o atendimento saber de quem se trata sem
 * ter que perguntar. Loja sem nome (cadastro pela metade) manda a mensagem
 * genérica em vez de "Sou a loja undefined".
 */
export function linkDoSuporte(nomeDaLoja?: string | null, env?: string): string {
  const nome = (nomeDaLoja ?? '').trim()
  const texto = nome
    ? `Olá! Preciso de ajuda com o painel da Menuzia. Minha loja é ${nome}.`
    : 'Olá! Preciso de ajuda com o painel da Menuzia.'
  return `https://wa.me/${numeroDoSuporte(env)}?text=${encodeURIComponent(texto)}`
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
