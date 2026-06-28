'use client'

import { useEffect, useMemo, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import {
  listarClientesComMetricas,
  gerarCsvMetaAds,
  type ClienteMetrica,
} from '@/lib/queries/clientes'

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

const brl = (value: number) => `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function formatarData(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatarEndereco(cliente: ClienteMetrica): string {
  const { rua, numero, complemento, bairro, cep } = cliente.endereco
  const linha1 = [rua, numero].filter(Boolean).join(', ')
  const partes = [linha1, complemento, bairro].filter(Boolean)
  const endereco = partes.join(' - ')
  if (!endereco && !cep) return ''
  return cep ? `${endereco}${endereco ? ' · ' : ''}CEP ${cep}` : endereco
}

export default function ClientesPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [clientes, setClientes] = useState<ClienteMetrica[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (!active) return
      if (!id) {
        setError('Não encontramos uma loja vinculada ao seu usuário.')
        setLoading(false)
        return
      }
      try {
        setClientes(await listarClientesComMetricas(supabase, id))
      } catch {
        setError('Não foi possível carregar a base de clientes.')
      } finally {
        setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [supabase])

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return clientes
    return clientes.filter((c) => c.nome.toLowerCase().includes(termo) || c.telefone.includes(termo))
  }, [clientes, busca])

  const stats = useMemo(() => {
    const total = clientes.length
    const recorrentes = clientes.filter((c) => c.totalPedidos > 1).length
    const ticketMedio = total ? clientes.reduce((s, c) => s + c.ticketMedio, 0) / total : 0
    return { total, unicos: total - recorrentes, recorrentes, ticketMedio }
  }, [clientes])

  const exportarCsv = () => {
    const csv = gerarCsvMetaAds(filtrados)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clientes-meta-ads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <>
        <TopBar title="Base de Clientes" breadcrumb="Clientes" />
        <div className="flex flex-1 items-center justify-center p-5 text-sm text-text-subtle">Carregando clientes…</div>
      </>
    )
  }

  return (
    <>
      <TopBar title="Base de Clientes" breadcrumb="Clientes" />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
        {error && (
          <div className="rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{error}</div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Clientes</div>
            <div className="mt-1.5 text-xl font-bold">{stats.total.toLocaleString('pt-BR')}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Compraram 1x</div>
            <div className="mt-1.5 text-xl font-bold">{stats.unicos.toLocaleString('pt-BR')}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Recorrentes (2+)</div>
            <div className="mt-1.5 text-xl font-bold">{stats.recorrentes.toLocaleString('pt-BR')}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Ticket médio</div>
            <div className="mt-1.5 text-xl font-bold">{brl(stats.ticketMedio)}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-menuzia border border-border bg-white px-2.5 py-2 sm:max-w-xs">
            <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 fill-text-subtle">
              <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 119.5 5a4.5 4.5 0 010 9z" />
            </svg>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou telefone…"
              className="w-full border-none bg-transparent font-sans text-[13px] text-text-main outline-none placeholder:text-text-subtle/60"
            />
          </div>
          <button
            onClick={exportarCsv}
            disabled={filtrados.length === 0}
            className="rounded-menuzia bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            Exportar CSV (Meta Ads)
          </button>
        </div>

        {filtrados.length === 0 ? (
          <div className="rounded-menuzia border border-dashed border-border bg-white p-8 text-center text-sm text-text-subtle">
            {clientes.length === 0
              ? 'Nenhum pedido registrado ainda — a base de clientes aparece aqui conforme os pedidos chegam.'
              : 'Nenhum cliente encontrado para essa busca.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-menuzia border border-border bg-white">
            <table className="w-full min-w-[1180px] border-collapse">
              <thead>
                <tr>
                  <th className="sticky top-0 border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Cliente</th>
                  <th className="sticky top-0 border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Endereço</th>
                  <th className="sticky top-0 w-[80px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pedidos</th>
                  <th className="sticky top-0 w-[130px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Última compra</th>
                  <th className="sticky top-0 w-[110px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Total gasto</th>
                  <th className="sticky top-0 w-[110px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Ticket médio</th>
                  <th className="sticky top-0 w-[110px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Recorrência</th>
                  <th className="sticky top-0 w-[110px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Dia preferido</th>
                  <th className="sticky top-0 w-[110px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Gasto/semana</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((cliente) => (
                  <tr key={cliente.telefone} className="hover:bg-[#F9FAFB]">
                    <td className="border-b border-border px-3.5 py-3">
                      <div className="text-[13px] font-semibold">{cliente.nome || '—'}</div>
                      <div className="text-[11px] text-text-subtle">{cliente.telefone}</div>
                    </td>
                    <td className="border-b border-border px-3.5 py-3 text-[12px] leading-relaxed text-text-subtle">
                      {formatarEndereco(cliente) || '—'}
                    </td>
                    <td className="border-b border-border px-3.5 py-3 text-[13px] font-semibold">{cliente.totalPedidos}</td>
                    <td className="border-b border-border px-3.5 py-3 text-[12px] text-text-subtle">{formatarData(cliente.ultimaCompraEm)}</td>
                    <td className="border-b border-border px-3.5 py-3 text-[13px] font-semibold text-price-text">{brl(cliente.valorTotal)}</td>
                    <td className="border-b border-border px-3.5 py-3 text-[13px]">{brl(cliente.ticketMedio)}</td>
                    <td className="border-b border-border px-3.5 py-3 text-[12px] text-text-subtle">
                      {cliente.pedidosPorSemana.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x/semana
                    </td>
                    <td className="border-b border-border px-3.5 py-3 text-[12px] text-text-subtle">
                      {cliente.diaSemanaPreferido !== null ? DIAS_SEMANA[cliente.diaSemanaPreferido] : '—'}
                    </td>
                    <td className="border-b border-border px-3.5 py-3 text-[13px]">{brl(cliente.gastoSemanalMedio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
