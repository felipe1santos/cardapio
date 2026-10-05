/**
 * Regras do alarme de pedido novo do Painel de Pedidos (2026-10-03). Funções puras: quem
 * toca, quando repete, qual aba toca. O som em si fica em components/pedidos/use-alarme.ts.
 *
 * Diagnóstico das falhas antigas em docs/kanban-topo/relatorio.md. Em resumo: o pedido que já
 * esperava quando o painel abriu nunca tocava, o alarme parava sozinho em 2 min e várias abas
 * tocavam ao mesmo tempo.
 */

/** Intervalos de repetição oferecidos (segundos). 0 = toca só uma vez por pedido. */
export const OPCOES_REPETICAO = [0, 10, 15, 30, 60] as const
export const REPETICAO_PADRAO = 15

/**
 * Pedidos que devem tocar agora: os "recebidos" que ainda não tocaram NESTA aba.
 * Na primeira leitura (anteriores = null) toca também o que já estava esperando — o pedido
 * que chegou com o painel fechado/recarregando não pode passar mudo.
 */
export function pedidosParaTocar(atuais: Iterable<string>, jaTocados: ReadonlySet<string>): string[] {
  const novos: string[] = []
  for (const id of atuais) if (!jaTocados.has(id)) novos.push(id)
  return novos
}

/** Repetir agora? Só com pedido pendente, som ligado e o intervalo vencido. */
export function deveRepetir(p: { repetirSeg: number; pendentes: number; somLigado: boolean; ultimoToque: number; agora: number }): boolean {
  if (!p.somLigado || p.pendentes <= 0 || p.repetirSeg <= 0) return false
  return p.agora - p.ultimoToque >= p.repetirSeg * 1000 - 250
}

export interface ArmazenamentoSimples {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

/**
 * Várias abas do painel abertas: só uma toca cada pedido. A primeira que reivindicar a chave
 * (localStorage, compartilhado entre abas) toca; as outras ficam quietas por `janelaMs`.
 */
export function reivindicarToque(chave: string, aba: string, agora: number, armazenamento: ArmazenamentoSimples | null, janelaMs = 8000): boolean {
  if (!armazenamento) return true
  try {
    const bruto = armazenamento.getItem(chave)
    if (bruto) {
      const [quem, quando] = bruto.split('|')
      if (quem !== aba && agora - Number(quando) < janelaMs) return false
    }
    armazenamento.setItem(chave, `${aba}|${agora}`)
    return true
  } catch {
    return true
  }
}

export type MotivoFalhaSom = 'autoplay_bloqueado' | 'arquivo_indisponivel' | 'sem_web_audio' | 'erro_reproducao' | 'contexto_suspenso'

/** Mensagem do aviso clicável enquanto o navegador não libera o som. */
export const TEXTO_SOM_BLOQUEADO = '🔇 Clique aqui para ativar o som dos pedidos'

/** Título da aba piscando quando o som não chega: "🔔 Pedido novo #12" ou "🔔 3 pedidos novos". */
export function textoDoTituloPiscando(numeros: number[]): string {
  if (numeros.length <= 1) return `🔔 Pedido novo${numeros[0] ? ` #${numeros[0]}` : ''}`
  return `🔔 ${numeros.length} pedidos novos`
}
