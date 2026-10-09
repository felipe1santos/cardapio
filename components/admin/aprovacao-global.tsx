'use client'

import { useEffect, useState } from 'react'
import { AprovacaoPin, Janela, type AprovacaoDada, type PedidoRemoto } from '@/components/financeiro/apoio'

/**
 * Janela global de aprovação com PIN (estorno e cancelamento depois da cozinha — ver
 * lib/financeiro/aprovacao-sensivel.ts).
 *
 * Funciona para TODA tela sem mexer em cada uma: observa o `fetch` da página (como o
 * IndicadorSalvar). Quando o servidor responde pedindo aprovação — cabeçalho
 * X-Menuzia-Aprovacao + codigo 'aprovacao_necessaria' —, abre a janela, pede o PIN de outra
 * pessoa (ou a aprovação pelo celular) e repete a MESMA requisição com `aprovacao` no corpo. A
 * tela que chamou recebe só a resposta final, como se nada tivesse acontecido no meio. Cancelar
 * a janela devolve a resposta original (a tela mostra "Precisa da aprovação de outra pessoa").
 */
const CABECALHO = 'x-menuzia-aprovacao'
const ERROS_DE_PIN = new Set(['pin_errado', 'pin_bloqueado', 'propria', 'sem_permissao', 'sem_pin', 'invalido', 'outra_acao', 'outro_valor', 'usada', 'expirado'])

interface Pedido { titulo: string; remoto: PedidoRemoto | null; erro: string | null; responder: (a: AprovacaoDada | null) => void }

let instalado = false
let mostrar: ((p: Pedido | null) => void) | null = null

function pedirAprovacao(titulo: string, remoto: PedidoRemoto | null, erro: string | null): Promise<AprovacaoDada | null> {
  return new Promise((resolve) => {
    if (!mostrar) return resolve(null)
    mostrar({ titulo, remoto, erro, responder: (a) => { mostrar?.(null); resolve(a) } })
  })
}

async function lerJson(r: Response): Promise<Record<string, unknown> | null> {
  try { return (await r.clone().json()) as Record<string, unknown> } catch { return null }
}

function instalar() {
  if (instalado || typeof window === 'undefined') return
  instalado = true
  const anterior = window.fetch.bind(window)
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const resposta = await anterior(entrada, init)
    // Só o que o servidor marcou, e só corpo JSON em texto (dá para repetir com a aprovação).
    if (!resposta.headers.has(CABECALHO) || typeof init?.body !== 'string') return resposta
    const j = await lerJson(resposta)
    if (j?.codigo !== 'aprovacao_necessaria') return resposta
    let corpo: Record<string, unknown>
    try { corpo = JSON.parse(init.body) as Record<string, unknown> } catch { return resposta }
    const titulo = typeof j.titulo === 'string' ? j.titulo : 'Outra pessoa precisa aprovar com o PIN'
    const remoto = (j.pedidoRemoto as PedidoRemoto | undefined) ?? null
    let erro: string | null = null
    for (;;) {
      const aprovacao = await pedirAprovacao(titulo, remoto, erro)
      if (!aprovacao) return resposta
      const nova = await anterior(entrada, { ...init, body: JSON.stringify({ ...corpo, aprovacao }) })
      const jn = nova.headers.has(CABECALHO) ? await lerJson(nova) : null
      if (jn && ERROS_DE_PIN.has(String(jn.codigo))) { erro = typeof jn.error === 'string' ? jn.error : 'Não aprovado.'; continue }
      return nova
    }
  }
}

export function AprovacaoGlobal() {
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => {
    instalar()
    mostrar = (p) => { setOcupado(false); setPedido(p) }
    return () => { mostrar = null }
  }, [])
  if (!pedido) return null
  return (
    <Janela titulo="Aprovação" onFechar={() => pedido.responder(null)} testid="aprovacao-global">
      <AprovacaoPin
        titulo={pedido.titulo} erro={pedido.erro} ocupado={ocupado} remoto={pedido.remoto}
        onCancelar={() => pedido.responder(null)}
        onConfirmar={(a) => { setOcupado(true); pedido.responder(a) }}
      />
    </Janela>
  )
}
