import Link from 'next/link'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { listarLojistas, listarRestaurantes } from '@/lib/queries/lojistas'
import { autorizarLojistaAction, criarRestauranteAction, revogarAcessoAction, sairAction } from './actions'

function formatarData(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

const inputClass =
  'w-full rounded-menuzia border border-border px-3 py-2.5 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30'

const selectClass =
  'rounded-menuzia border border-border px-2.5 py-1.5 text-[12px] transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30'

export default async function SuperadminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const admin = getAdminSupabase()
  const [lojistas, restaurantes] = await Promise.all([listarLojistas(admin), listarRestaurantes(admin)])

  const autorizados = lojistas.filter((l) => l.autorizado).length
  const pendentes = lojistas.length - autorizados

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-text-main">Painel da plataforma</h1>
          <p className="mt-1 text-[13px] text-text-subtle">
            Contas cadastradas, autorização de acesso e histórico de login.
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

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-menuzia border border-border bg-main p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Cadastros</p>
          <p className="mt-1 text-2xl font-bold text-text-main">{lojistas.length}</p>
        </div>
        <div className="rounded-menuzia border border-border bg-main p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Autorizados</p>
          <p className="mt-1 text-2xl font-bold text-price-text">{autorizados}</p>
        </div>
        <div className="rounded-menuzia border border-border bg-main p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pendentes</p>
          <p className="mt-1 text-2xl font-bold text-warn">{pendentes}</p>
        </div>
      </div>

      {error && (
        <p className="mb-6 rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger">{error}</p>
      )}

      <div className="mb-6 rounded-menuzia border border-border bg-main p-5">
        <h2 className="mb-1 text-[13px] font-bold text-text-main">Nova loja</h2>
        <p className="mb-4 text-[12px] text-text-subtle">
          Crie o slug da loja antes de vincular um lojista a ela.
        </p>
        <form action={criarRestauranteAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome da loja</span>
            <input name="nome" type="text" required placeholder="Ex: Burger House" className={inputClass} />
          </label>
          <label className="flex-1">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Slug</span>
            <input name="slug" type="text" required placeholder="Ex: burger-house" className={inputClass} />
          </label>
          <button
            type="submit"
            className="rounded-menuzia bg-primary px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark"
          >
            Criar loja
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-menuzia border border-border bg-main">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[13px] font-bold text-text-main">Lojistas cadastrados</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b border-border bg-page text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                <th className="px-5 py-3">Hamburgueria</th>
                <th className="px-5 py-3">Responsável</th>
                <th className="px-5 py-3">Telefone</th>
                <th className="px-5 py-3">E-mail</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Loja vinculada</th>
                <th className="px-5 py-3">Cadastro</th>
                <th className="px-5 py-3">Último login</th>
                <th className="px-5 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lojistas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-[13px] text-text-subtle">
                    Nenhum cadastro ainda.
                  </td>
                </tr>
              )}
              {lojistas.map((lojista) => (
                <tr key={lojista.id} className="border-b border-border align-top transition-colors last:border-none hover:bg-page/60">
                  <td className="px-5 py-4 font-semibold text-text-main">{lojista.nomeLoja || '—'}</td>
                  <td className="px-5 py-4">{lojista.nome || '—'}</td>
                  <td className="px-5 py-4 whitespace-nowrap">{lojista.telefone || '—'}</td>
                  <td className="px-5 py-4">{lojista.email}</td>
                  <td className="px-5 py-4">
                    {lojista.autorizado ? (
                      <span className="rounded-menuzia bg-price-bg px-2.5 py-1 text-[11px] font-semibold text-price-text">Autorizado</span>
                    ) : (
                      <span className="rounded-menuzia bg-warn-bg px-2.5 py-1 text-[11px] font-semibold text-warn">Pendente</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <form action={autorizarLojistaAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input type="hidden" name="usuarioId" value={lojista.id} />
                      <select name="restauranteId" defaultValue={lojista.restauranteId ?? ''} className={selectClass}>
                        <option value="">— selecione a loja —</option>
                        {restaurantes.map((r) => (
                          <option key={r.id} value={r.id}>{r.nome} ({r.slug})</option>
                        ))}
                      </select>
                      <button type="submit" className="whitespace-nowrap rounded-menuzia bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark">
                        {lojista.autorizado ? 'Atualizar' : 'Autorizar'}
                      </button>
                    </form>
                    {lojista.restauranteSlug && (
                      <p className="mt-1.5 text-[11px] text-text-subtle">
                        Atual: <Link href={`/loja/${lojista.restauranteSlug}`} target="_blank" className="font-medium text-primary underline">{lojista.restauranteNome}</Link>
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap text-[12px] text-text-subtle">{formatarData(lojista.criadoEm)}</td>
                  <td className="px-5 py-4 whitespace-nowrap text-[12px] text-text-subtle">{formatarData(lojista.ultimoLoginEm)}</td>
                  <td className="px-5 py-4">
                    {lojista.autorizado && (
                      <form action={revogarAcessoAction}>
                        <input type="hidden" name="usuarioId" value={lojista.id} />
                        <button type="submit" className="text-[12px] font-semibold text-danger hover:underline">Revogar acesso</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
