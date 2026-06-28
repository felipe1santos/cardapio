import Link from 'next/link'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { listarLojistas, metricasPorRestaurante } from '@/lib/queries/lojistas'
import { ConfirmSubmitButton } from '@/components/ui/confirm-submit-button'
import { convidarLojistaAction, removerConviteAction, revogarAcessoAction, sairAction } from './actions'

function formatarData(iso: string | null): string {
  if (!iso) return '—'
  // Servidor roda em UTC (Coolify); fixa o fuso de São Paulo pra não mostrar +3h.
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
}

const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: number, casas = 0) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

const inputClass =
  'w-full rounded-menuzia border border-border px-3 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30'

function StatCard({ label, value, color, accent }: { label: string; value: string; color: string; accent: string }) {
  return (
    <div className="overflow-hidden rounded-menuzia border border-border bg-main">
      <div className={`h-1 w-full ${accent}`} />
      <div className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      </div>
    </div>
  )
}

export default async function SuperadminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const admin = getAdminSupabase()
  const [lojistas, metricas] = await Promise.all([listarLojistas(admin), metricasPorRestaurante(admin)])

  const ativos = lojistas.filter((l) => l.autorizado).length
  const pendentes = lojistas.length - ativos

  // Totais da plataforma (somando as métricas de todas as lojas)
  const todasMetricas = [...metricas.values()]
  const faturamentoTotal = todasMetricas.reduce((s, m) => s + m.faturamento, 0)
  const pedidosTotal = todasMetricas.reduce((s, m) => s + m.qtdPedidos, 0)
  const ticketGeral = pedidosTotal > 0 ? faturamentoTotal / pedidosTotal : 0

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-text-main">Painel da plataforma</h1>
          <p className="mt-1 text-[13px] text-text-subtle">
            Pré-cadastro de clientes, contas ativas, faturamento e histórico de login.
          </p>
        </div>
        <form action={sairAction}>
          <button
            type="submit"
            className="rounded-menuzia border border-border bg-main px-3.5 py-2 text-[12px] font-semibold text-text-subtle transition-colors hover:border-danger hover:text-danger"
          >
            Sair
          </button>
        </form>
      </div>

      {/* Métricas da plataforma */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Cadastros" value={num(lojistas.length)} color="text-text-main" accent="bg-text-subtle/40" />
        <StatCard label="Ativos" value={num(ativos)} color="text-price-text" accent="bg-status-ready" />
        <StatCard label="Aguardando 1º acesso" value={num(pendentes)} color="text-warn" accent="bg-status-pending" />
        <StatCard label="Faturamento (entregue)" value={brl(faturamentoTotal)} color="text-price-text" accent="bg-status-ready" />
        <StatCard label="Pedidos entregues" value={num(pedidosTotal)} color="text-primary" accent="bg-primary" />
        <StatCard label="Ticket médio" value={brl(ticketGeral)} color="text-purple" accent="bg-purple" />
      </div>

      {error && (
        <p className="mb-6 rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger">{error}</p>
      )}

      {/* Cadastrar cliente */}
      <div className="mb-6 rounded-menuzia border border-border bg-main p-5">
        <h2 className="mb-1 text-[13px] font-bold text-text-main">Cadastrar cliente</h2>
        <p className="mb-4 text-[12px] text-text-subtle">
          Informe só o e-mail do cliente. No primeiro acesso (em /cadastro), ele usa esse mesmo
          e-mail como login para criar a senha, o nome da loja e concluir o cadastro.
        </p>
        <form action={convidarLojistaAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">E-mail do cliente</span>
            <input name="email" type="email" required placeholder="cliente@exemplo.com" className={inputClass} />
          </label>
          <button
            type="submit"
            className="rounded-menuzia bg-primary px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark"
          >
            Pré-cadastrar
          </button>
        </form>
      </div>

      {/* Tabela de clientes */}
      <div className="overflow-hidden rounded-menuzia border border-border bg-main">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[13px] font-bold text-text-main">Clientes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-sm">
            <thead>
              <tr className="border-b border-border bg-page text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                <th className="px-4 py-3">Hamburgueria</th>
                <th className="px-4 py-3">Responsável</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">E-mail (login)</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Faturamento</th>
                <th className="px-4 py-3 text-right">Pedidos</th>
                <th className="px-4 py-3 text-right">Ticket</th>
                <th className="px-4 py-3 text-right">Ped./dia</th>
                <th className="px-4 py-3">Loja</th>
                <th className="px-4 py-3">Cadastro</th>
                <th className="px-4 py-3">Último login</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lojistas.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-5 py-8 text-center text-[13px] text-text-subtle">
                    Nenhum cadastro ainda.
                  </td>
                </tr>
              )}
              {lojistas.map((lojista) => {
                const m = lojista.restauranteId ? metricas.get(lojista.restauranteId) : undefined
                return (
                  <tr key={lojista.id} className="border-b border-border align-top transition-colors last:border-none hover:bg-page/60">
                    <td className="px-4 py-4 font-semibold text-text-main">{lojista.nomeLoja || '—'}</td>
                    <td className="px-4 py-4">{lojista.nome || '—'}</td>
                    <td className="px-4 py-4 whitespace-nowrap">{lojista.telefone || '—'}</td>
                    <td className="px-4 py-4">{lojista.email}</td>
                    <td className="px-4 py-4">
                      {lojista.autorizado ? (
                        <span className="rounded-menuzia bg-price-bg px-2.5 py-1 text-[11px] font-semibold text-price-text">Ativo</span>
                      ) : (
                        <span className="rounded-menuzia bg-warn-bg px-2.5 py-1 text-[11px] font-semibold text-warn">Aguardando 1º acesso</span>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right font-semibold text-price-text">{m ? brl(m.faturamento) : '—'}</td>
                    <td className="px-4 py-4 text-right font-semibold text-text-main">{m ? num(m.qtdPedidos) : '—'}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-right text-text-main">{m ? brl(m.ticketMedio) : '—'}</td>
                    <td className="px-4 py-4 text-right text-text-subtle">{m ? num(m.pedidosPorDia, 1) : '—'}</td>
                    <td className="px-4 py-4">
                      {lojista.restauranteSlug ? (
                        <Link href={`/loja/${lojista.restauranteSlug}`} target="_blank" className="font-medium text-primary underline">
                          {lojista.restauranteNome}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-[12px] text-text-subtle">{formatarData(lojista.criadoEm)}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-[12px] text-text-subtle">{formatarData(lojista.ultimoLoginEm)}</td>
                    <td className="px-4 py-4">
                      {lojista.autorizado ? (
                        <form action={revogarAcessoAction}>
                          <input type="hidden" name="usuarioId" value={lojista.id} />
                          <ConfirmSubmitButton
                            confirmMessage={`Revogar o acesso de ${lojista.email}? O lojista não vai conseguir entrar até você reativar.`}
                            className="text-[12px] font-semibold text-danger hover:underline"
                          >
                            Revogar acesso
                          </ConfirmSubmitButton>
                        </form>
                      ) : (
                        <form action={removerConviteAction}>
                          <input type="hidden" name="usuarioId" value={lojista.id} />
                          <ConfirmSubmitButton
                            confirmMessage={`Remover o pré-cadastro de ${lojista.email}? Essa ação não pode ser desfeita.`}
                            className="text-[12px] font-semibold text-danger hover:underline"
                          >
                            Remover
                          </ConfirmSubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
