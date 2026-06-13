import Link from 'next/link'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { listarLojistas, listarRestaurantes, type PapelUsuario } from '@/lib/queries/lojistas'
import { autorizarLojistaAction, criarRestauranteAction, revogarAcessoAction, sairAction } from './actions'

const PAPEL_LABELS: Record<PapelUsuario, string> = {
  dono: 'Dono',
  atendente: 'Atendente',
  cozinha: 'Cozinha',
  logistica: 'Logística',
  entregador: 'Entregador',
}

const PAPEIS: PapelUsuario[] = ['dono', 'atendente', 'cozinha', 'logistica', 'entregador']

function formatarData(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default async function SuperadminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const admin = getAdminSupabase()
  const [lojistas, restaurantes] = await Promise.all([listarLojistas(admin), listarRestaurantes(admin)])

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-main">Painel da plataforma</h1>
          <p className="mt-0.5 text-[13px] text-text-subtle">
            Contas cadastradas, autorização de acesso e histórico de login.
          </p>
        </div>
        <form action={sairAction}>
          <button type="submit" className="text-[13px] font-semibold text-danger">Sair</button>
        </form>
      </div>

      {error && (
        <p className="mb-4 rounded-menuzia border border-danger bg-danger-bg px-3 py-2 text-[13px] text-danger">{error}</p>
      )}

      {/* Nova loja */}
      <div className="mb-6 rounded-menuzia border border-border bg-main p-4">
        <h2 className="mb-1 text-[13px] font-bold text-text-main">Nova loja (slug)</h2>
        <p className="mb-3 text-[12px] text-text-subtle">
          Crie o slug da loja antes de vincular um lojista a ela.
        </p>
        <form action={criarRestauranteAction} className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome da loja</span>
            <input name="nome" type="text" required placeholder="Ex: Burger House" className="w-full rounded-menuzia border border-border px-3 py-2 text-sm" />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Slug</span>
            <input name="slug" type="text" required placeholder="Ex: burger-house" className="w-full rounded-menuzia border border-border px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="rounded-menuzia bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark">
            Criar loja
          </button>
        </form>
      </div>

      {/* Lojistas */}
      <div className="overflow-hidden rounded-menuzia border border-border bg-main">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-border bg-page text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                <th className="px-3.5 py-2.5">Hamburgueria</th>
                <th className="px-3.5 py-2.5">Responsável</th>
                <th className="px-3.5 py-2.5">Telefone</th>
                <th className="px-3.5 py-2.5">E-mail</th>
                <th className="px-3.5 py-2.5">Status</th>
                <th className="px-3.5 py-2.5">Vínculo / Papel</th>
                <th className="px-3.5 py-2.5">Cadastro</th>
                <th className="px-3.5 py-2.5">Último login</th>
                <th className="px-3.5 py-2.5">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lojistas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3.5 py-6 text-center text-[13px] text-text-subtle">
                    Nenhum cadastro ainda.
                  </td>
                </tr>
              )}
              {lojistas.map((lojista) => (
                <tr key={lojista.id} className="border-b border-border last:border-none align-top">
                  <td className="px-3.5 py-3 font-semibold text-text-main">{lojista.nomeLoja || '—'}</td>
                  <td className="px-3.5 py-3">{lojista.nome || '—'}</td>
                  <td className="px-3.5 py-3 whitespace-nowrap">{lojista.telefone || '—'}</td>
                  <td className="px-3.5 py-3">{lojista.email}</td>
                  <td className="px-3.5 py-3">
                    {lojista.autorizado ? (
                      <span className="rounded-menuzia bg-price-bg px-2 py-0.5 text-[11px] font-semibold text-price-text">Autorizado</span>
                    ) : (
                      <span className="rounded-menuzia bg-warn-bg px-2 py-0.5 text-[11px] font-semibold text-warn">Pendente</span>
                    )}
                  </td>
                  <td className="px-3.5 py-3">
                    <form action={autorizarLojistaAction} className="flex flex-col gap-1.5">
                      <input type="hidden" name="usuarioId" value={lojista.id} />
                      <select name="restauranteId" defaultValue={lojista.restauranteId ?? ''} className="rounded-menuzia border border-border px-2 py-1.5 text-[12px]">
                        <option value="">— selecione a loja —</option>
                        {restaurantes.map((r) => (
                          <option key={r.id} value={r.id}>{r.nome} ({r.slug})</option>
                        ))}
                      </select>
                      <select name="papel" defaultValue={lojista.papel} className="rounded-menuzia border border-border px-2 py-1.5 text-[12px]">
                        {PAPEIS.map((p) => (
                          <option key={p} value={p}>{PAPEL_LABELS[p]}</option>
                        ))}
                      </select>
                      <button type="submit" className="rounded-menuzia bg-primary px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark">
                        {lojista.autorizado ? 'Atualizar vínculo' : 'Autorizar'}
                      </button>
                    </form>
                    {lojista.restauranteSlug && (
                      <p className="mt-1.5 text-[11px] text-text-subtle">
                        Atual: {lojista.restauranteNome} (<Link href={`/loja/${lojista.restauranteSlug}`} target="_blank" className="underline">{lojista.restauranteSlug}</Link>) · {PAPEL_LABELS[lojista.papel]}
                      </p>
                    )}
                  </td>
                  <td className="px-3.5 py-3 whitespace-nowrap text-[12px] text-text-subtle">{formatarData(lojista.criadoEm)}</td>
                  <td className="px-3.5 py-3 whitespace-nowrap text-[12px] text-text-subtle">{formatarData(lojista.ultimoLoginEm)}</td>
                  <td className="px-3.5 py-3">
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
