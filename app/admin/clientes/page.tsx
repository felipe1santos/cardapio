'use client'

import { useEffect, useMemo, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { CartaoNumero } from '@/components/admin/cartao-numero'
import { ICONES } from '@/lib/icones-painel'
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

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CartaoNumero icone={ICONES.clientes} tom="roxo" rotulo="Clientes" valor={stats.total.toLocaleString('pt-BR')} />
          <CartaoNumero icone={ICONES.pessoaNova} tom="laranja" rotulo="Compraram 1x" valor={stats.unicos.toLocaleString('pt-BR')} />
          <CartaoNumero icone={ICONES.pessoaVolta} tom="verde" rotulo="Recorrentes (2+)" valor={stats.recorrentes.toLocaleString('pt-BR')} />
          <CartaoNumero icone={ICONES.ticket} tom="azul" rotulo="Ticket médio" valor={brl(stats.ticketMedio)} />
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
          <>
          {/* Celular: a tabela de 1180px virava rolagem lateral infinita. Cada cliente
              vira um cartão com o mesmo conteúdo, na ordem em que se lê. O desktop
              continua na tabela — a comparação linha a linha é o valor dela. */}
          <div className="flex flex-col gap-2 lg:hidden">
            {filtrados.map((cliente) => (
              <div key={cliente.telefone} className="rounded-menuzia border border-border bg-white p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-bold">{cliente.nome || '—'}</div>
                    <div className="text-[12px] text-text-subtle">{cliente.telefone}</div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-[14px] font-bold text-price-text">{brl(cliente.valorTotal)}</div>
                    <div className="text-[11px] text-text-subtle">{cliente.totalPedidos} pedido{cliente.totalPedidos === 1 ? '' : 's'}</div>
                  </div>
                </div>
                {formatarEndereco(cliente) && (
                  <div className="mt-2 text-[12px] leading-relaxed text-text-subtle">{formatarEndereco(cliente)}</div>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-[12px]">
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Última compra</dt>
                    <dd className="mt-0.5">{formatarData(cliente.ultimaCompraEm)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Ticket médio</dt>
                    <dd className="mt-0.5 font-semibold">{brl(cliente.ticketMedio)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Recorrência</dt>
                    <dd className="mt-0.5">{cliente.pedidosPorSemana.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x/semana</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Dia preferido</dt>
                    <dd className="mt-0.5">{cliente.diaSemanaPreferido !== null ? DIAS_SEMANA[cliente.diaSemanaPreferido] : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Gasto/semana</dt>
                    <dd className="mt-0.5">{brl(cliente.gastoSemanalMedio)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          {/* Desktop: uma linha por cliente. Nome e telefone lado a lado, endereço
              cortado com reticências (inteiro no title) — antes cada célula
              quebrava em duas ou três linhas e a lista ficava grossa demais. */}
          <div className="hidden overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white lg:block">
            <div className="flex items-center justify-between border-b border-[var(--adm-borda)] px-4 py-3">
              <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Clientes</h3>
              <span className="text-[12px] text-[var(--adm-texto-suave)]">
                {filtrados.length.toLocaleString('pt-BR')} {filtrados.length === 1 ? 'cliente' : 'clientes'}
              </span>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] table-fixed border-collapse">
              <colgroup>
                <col className="w-[190px]" />
                <col className="w-[140px]" />
                <col />
                <col className="w-[76px]" />
                <col className="w-[128px]" />
                <col className="w-[110px]" />
                <col className="w-[104px]" />
                <col className="w-[96px]" />
                <col className="w-[92px]" />
                <col className="w-[104px]" />
              </colgroup>
              <thead>
                <tr className="bg-[#f1f2f4]">
                  {['Cliente', 'Telefone', 'Endereço', 'Pedidos', 'Última compra', 'Total gasto', 'Ticket médio', 'Recorrência', 'Dia pref.', 'Gasto/semana'].map((t, i) => (
                    <th
                      key={t}
                      className={`sticky top-0 whitespace-nowrap px-3 py-2.5 text-[12px] font-semibold text-[var(--adm-texto-forte)] ${i >= 3 && i !== 4 && i !== 8 ? 'text-right' : 'text-left'}`}
                    >
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[12.8px]">
                {filtrados.map((cliente) => {
                  const endereco = formatarEndereco(cliente)
                  return (
                    <tr key={cliente.telefone} className="border-b border-[var(--adm-borda)] last:border-b-0 hover:bg-[var(--adm-superficie-2)]">
                      <td className="truncate whitespace-nowrap px-3 py-2 font-semibold text-[var(--adm-texto)]" title={cliente.nome}>
                        {cliente.nome || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--adm-texto-medio)]">{cliente.telefone}</td>
                      <td className="truncate whitespace-nowrap px-3 py-2 text-[var(--adm-texto-suave)]" title={endereco}>
                        {endereco || '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{cliente.totalPedidos}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[var(--adm-texto-medio)]">{formatarData(cliente.ultimaCompraEm)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-price-text">{brl(cliente.valorTotal)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(cliente.ticketMedio)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--adm-texto-medio)]">
                        {cliente.pedidosPorSemana.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x/sem
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[var(--adm-texto-medio)]">
                        {cliente.diaSemanaPreferido !== null ? DIAS_SEMANA[cliente.diaSemanaPreferido] : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(cliente.gastoSemanalMedio)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
          </>
        )}
      </div>
    </>
  )
}
