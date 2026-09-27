/**
 * Regras puras do indicador global de "Salvando… / Salvo" do painel
 * (components/admin/indicador-salvar.tsx). Ficam aqui para serem testadas.
 *
 * A ideia: em vez de cada tela chamar um "mostrar salvando", o painel observa
 * as requisições de ESCRITA que o próprio usuário disparou. Assim vale para
 * tudo — cardápio, ajustes, kanban, PDV, logística — sem tocar em cada tela.
 */

/** Uma escrita conta como "salvar" se começar até este tempo depois de um clique/Enter. */
export const JANELA_GESTO_MS = 2000

const METODOS_DE_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * A requisição é uma gravação do usuário?
 *
 * Entra: PostgREST (/rest/v1/tabela), Storage (upload de foto) e as rotas de
 * API do painel. Fica de fora: /rpc/ (no painel só há RPC de leitura, e o
 * dashboard chama uma a cada troca de filtro), autenticação, realtime e o
 * analytics da vitrine. E nada conta sem um gesto recente: o aceite automático,
 * o heartbeat e a sincronização em segundo plano gravam sozinhos e não podem
 * piscar um "Salvo" na cara do operador.
 */
export function ehGravacaoDoUsuario(
  metodo: string,
  url: string,
  msDesdeGesto: number,
): boolean {
  if (!METODOS_DE_ESCRITA.has(metodo.toUpperCase())) return false
  if (!(msDesdeGesto >= 0 && msDesdeGesto <= JANELA_GESTO_MS)) return false
  let caminho: string
  try {
    caminho = new URL(url, 'http://local').pathname
  } catch {
    return false
  }
  if (caminho.includes('/rest/v1/rpc/')) return false
  if (caminho.startsWith('/auth/') || caminho.includes('/auth/v1/')) return false
  if (caminho.includes('/realtime/')) return false
  if (/^\/api\/loja\/[^/]+\/eventos/.test(caminho)) return false
  // Consulta de endereço/frete usa POST mas não grava nada.
  if (caminho.startsWith('/api/geo/') || /^\/api\/loja\/[^/]+\/frete/.test(caminho)) return false
  // Efeitos colaterais que saem junto com a gravação, não a gravação: o aviso de WhatsApp
  // ao cliente (fogo-e-esquece, cai se a instância da loja estiver fora) e a cotação do
  // Nexta (POST de leitura, refeita a cada atualização da Logística). Contá-los fazia o
  // despacho mostrar "Não foi possível salvar" com o pedido já atribuído.
  if (/^\/api\/pedidos\/[^/]+\/notificar$/.test(caminho) || caminho === '/api/admin/nexta/cotacao') return false
  return caminho.includes('/rest/v1/') || caminho.includes('/storage/v1/object/') || caminho.startsWith('/api/')
}

export type FaseIndicador = 'oculto' | 'salvando' | 'salvo' | 'erro'
