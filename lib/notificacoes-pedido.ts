/**
 * Aviso de pedido novo pela notificação do navegador.
 *
 * O alarme sonoro do Kanban só serve para quem está com aquela aba na frente. A
 * notificação do sistema alcança quem está em outra aba do painel — que é onde o
 * dono passa boa parte do tempo (cardápio, clientes, ajustes).
 *
 * Limite honesto, que a tela precisa dizer: isto vale enquanto o painel estiver
 * ABERTO em alguma aba. Não é push de servidor; com o navegador fechado, nada
 * chega. Suportar isso exigiria service worker com push e chaves VAPID, que é
 * outra obra.
 *
 * Regra pura aqui; quem fala com o navegador é o componente.
 */

export type EstadoNotificacao =
  /** Navegador sem a API (Safari antigo, webview). */
  | 'indisponivel'
  /** Dá para ativar: ninguém pediu permissão ainda. */
  | 'disponivel'
  /** Permissão concedida — os avisos chegam. */
  | 'ativas'
  /** O usuário negou: só reativa nas configurações do navegador. */
  | 'negadas'

export function estadoDaPermissao(permissao: NotificationPermission | null): EstadoNotificacao {
  if (permissao === null) return 'indisponivel'
  if (permissao === 'granted') return 'ativas'
  if (permissao === 'denied') return 'negadas'
  return 'disponivel'
}

export const ROTULO_ESTADO: Record<EstadoNotificacao, string> = {
  indisponivel: 'Notificações indisponíveis',
  disponivel: 'Ativar notificações de pedidos',
  ativas: 'Notificações ativadas',
  negadas: 'Notificações bloqueadas',
}

export const AJUDA_ESTADO: Record<EstadoNotificacao, string> = {
  indisponivel: 'Este navegador não oferece notificações. Tente pelo Chrome no computador.',
  disponivel: 'Receba um aviso do navegador quando entrar pedido, mesmo em outra aba do painel.',
  ativas: 'Você recebe um aviso a cada pedido novo enquanto o painel estiver aberto em alguma aba.',
  negadas:
    'O navegador está bloqueando os avisos. No Chrome: cadeado ao lado do endereço → Notificações → Permitir, e recarregue a página.',
}

/** Quantos ids guardar para não repetir aviso. O bastante para um pico de pedidos. */
const LIMITE_MEMORIA = 50
const CHAVE = 'menuzia:pedidos-notificados'

/**
 * Ids já avisados, compartilhados entre as abas.
 *
 * Duas abas do painel abertas recebem o MESMO evento do Realtime e avisariam
 * duas vezes o mesmo pedido. O localStorage é o único lugar que as duas
 * enxergam — quem gravar primeiro ganha, e a outra cala.
 */
export function jaAvisado(id: string, ler: () => string | null, gravar: (v: string) => void): boolean {
  let lista: string[] = []
  try {
    const bruto = ler()
    if (bruto) lista = JSON.parse(bruto) as string[]
  } catch {
    lista = []
  }
  if (lista.includes(id)) return true
  const nova = [...lista, id].slice(-LIMITE_MEMORIA)
  try {
    gravar(JSON.stringify(nova))
  } catch {
    /* sem storage (aba anônima): pior caso, o aviso repete */
  }
  return false
}

export function chaveMemoria(): string {
  return CHAVE
}

export interface PedidoParaAvisar {
  numero: number | null
  /** 'delivery' | 'mesa' | 'balcao' — só para dizer de onde veio. */
  canal?: string | null
}

/**
 * O que a notificação mostra.
 *
 * Sem nome, telefone, endereço ou valor: a notificação aparece na tela do
 * computador da loja, que fica à vista de quem passa, e o conteúdo dela não
 * pode ser um vazamento de dado do cliente. Número do pedido basta para a
 * pessoa saber que precisa olhar o Kanban.
 */
export function textoDaNotificacao(pedido: PedidoParaAvisar): { titulo: string; corpo: string } {
  const numero = pedido.numero ? `#${pedido.numero}` : 'novo'
  const origem = pedido.canal === 'mesa' ? 'da mesa' : pedido.canal === 'balcao' ? 'do balcão' : 'do delivery'
  return {
    titulo: `Pedido ${numero} chegou`,
    corpo: `Pedido ${origem} aguardando aceite no Painel de Pedidos.`,
  }
}
