'use client'

/**
 * Cache de cotações do Nexta, compartilhado entre a página Logística e o painel de
 * Despacho de rotas (os dois pontos de despacho mostram o mesmo preço).
 *
 * Por que cachear: o painel refaz `refetch()` a cada evento de realtime e a cada 10s,
 * e cotar N pedidos a cada ciclo martelaria a API do Nexta sem necessidade. O preço
 * também não pode envelhecer: por isso TTL curto (2 min) e recotação ao voltar o foco.
 *
 * O despacho NUNCA usa este cache — ele sempre recota na hora, no servidor, pra não
 * mandar uma corrida com preço vencido.
 */

import { useEffect, useState } from 'react'

export type CotacaoNextaEstado =
  | { status: 'carregando' }
  | { status: 'ok'; preco: number; etaColetaMin: number | null; etaEntregaMin: number | null }
  | { status: 'erro'; erro: string }

interface Entrada {
  em: number
  promessa: Promise<CotacaoNextaEstado>
}

const TTL_MS = 2 * 60 * 1000
const cache = new Map<string, Entrada>()

async function buscar(pedidoId: string): Promise<CotacaoNextaEstado> {
  try {
    const res = await fetch('/api/admin/nexta/cotacao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedidoId }),
    })
    const data = (await res.json()) as { preco?: number; etaColetaMin?: number | null; etaEntregaMin?: number | null; error?: string }
    if (!res.ok || typeof data.preco !== 'number') {
      return { status: 'erro', erro: data.error ?? 'Nexta indisponível' }
    }
    return { status: 'ok', preco: data.preco, etaColetaMin: data.etaColetaMin ?? null, etaEntregaMin: data.etaEntregaMin ?? null }
  } catch {
    return { status: 'erro', erro: 'Não foi possível cotar com o Nexta.' }
  }
}

/** Cotação do pedido — do cache se fresca, senão busca. Chamadas simultâneas dividem a mesma promessa. */
export function cotarPedidoNexta(pedidoId: string): Promise<CotacaoNextaEstado> {
  const atual = cache.get(pedidoId)
  if (atual && Date.now() - atual.em < TTL_MS) return atual.promessa

  const promessa = buscar(pedidoId)
  cache.set(pedidoId, { em: Date.now(), promessa })
  // Erro não fica preso pelo TTL inteiro: uma indisponibilidade momentânea do Nexta
  // seria "Nexta indisponível" por 2 min mesmo já tendo voltado.
  promessa.then((r) => {
    if (r.status === 'erro') cache.delete(pedidoId)
  })
  return promessa
}

/** Descarta a cotação de um pedido (ex.: depois de despachar ou de uma rejeição). */
export function invalidarCotacaoNexta(pedidoId: string) {
  cache.delete(pedidoId)
}

export function limparCotacoesNexta() {
  cache.clear()
}

/**
 * Cotações de vários pedidos, com recotação automática quando envelhecem (1 min de
 * verificação) e ao voltar o foco pra aba.
 *
 * `ativo: false` (integração desligada) não dispara nenhuma chamada.
 */
export function useCotacoesNexta(pedidoIds: string[], ativo: boolean): Record<string, CotacaoNextaEstado> {
  const [estados, setEstados] = useState<Record<string, CotacaoNextaEstado>>({})
  const [ciclo, setCiclo] = useState(0)
  // Dependência estável: o array de ids muda de identidade a cada render do pai.
  const chave = pedidoIds.join(',')

  useEffect(() => {
    if (!ativo) return
    const t = setInterval(() => setCiclo((c) => c + 1), 60_000)
    const aoFocar = () => setCiclo((c) => c + 1)
    window.addEventListener('focus', aoFocar)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', aoFocar)
    }
  }, [ativo])

  useEffect(() => {
    if (!ativo) return
    const ids = chave ? chave.split(',') : []
    let vivo = true

    // Some com cotações de pedidos que saíram da lista (já despachados).
    setEstados((prev) => {
      const proximo: Record<string, CotacaoNextaEstado> = {}
      for (const id of ids) if (prev[id]) proximo[id] = prev[id]
      return proximo
    })

    for (const id of ids) {
      const fresca = cache.get(id)
      if (!fresca || Date.now() - fresca.em >= TTL_MS) {
        setEstados((prev) => (prev[id] ? prev : { ...prev, [id]: { status: 'carregando' } }))
      }
      cotarPedidoNexta(id).then((r) => {
        if (vivo) setEstados((prev) => ({ ...prev, [id]: r }))
      })
    }

    return () => {
      vivo = false
    }
  }, [chave, ativo, ciclo])

  return estados
}
