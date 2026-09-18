'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import {
  GRUPOS_EVENTO,
  listarAuditoria,
  resumoEvento,
  rotuloEvento,
  type EventoAuditoriaLinha,
} from '@/lib/queries/auditoria'

/**
 * Trilha de auditoria consultável.
 *
 * A trilha já era gravada (0062, `lib/auditoria.ts`) e já tinha permissão própria
 * (`auditoria.ver`), mas não havia tela: só dava para ler o histórico de UMA conta,
 * dentro da mesa. Quando o dono pergunta "quem cancelou aquele item ontem?" ou "quem
 * deu esse desconto?", a resposta precisa estar em um lugar.
 *
 * A consulta roda com o JWT do dono e a policy exige `auth_e_gestor()` — a loja é
 * filtrada pela RLS, não por este código.
 */

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function AuditoriaPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [grupo, setGrupo] = useState('todos')
  const [busca, setBusca] = useState('')
  const [eventos, setEventos] = useState<EventoAuditoriaLinha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(
    async (id: string, grupoId: string) => {
      setCarregando(true)
      try {
        const prefixos = GRUPOS_EVENTO.find((g) => g.id === grupoId)?.prefixos ?? []
        setEventos(await listarAuditoria(supabase, id, { prefixos }))
        setErro(null)
      } catch {
        // A policy nega quem não tem `auditoria.ver`: a mensagem diz isso, em vez de
        // mostrar uma lista vazia que pareceria "nada aconteceu".
        setErro('Não foi possível carregar a auditoria. Só a gestão da loja tem acesso a ela.')
      } finally {
        setCarregando(false)
      }
    },
    [supabase],
  )

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (!vivo) return
      if (!id) {
        setCarregando(false)
        setErro('Não foi possível identificar a loja.')
        return
      }
      setRestauranteId(id)
      await carregar(id, grupo)
    })()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  useEffect(() => {
    if (restauranteId) void carregar(restauranteId, grupo)
  }, [restauranteId, grupo, carregar])

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return eventos
    return eventos.filter((e) =>
      [rotuloEvento(e.acao), e.acao, e.usuarioNome ?? '', resumoEvento(e.dados)].join(' ').toLowerCase().includes(termo),
    )
  }, [eventos, busca])

  return (
    <>
      <TopBar
        title="Auditoria"
        breadcrumb="Retaguarda · Quem fez o quê"
        right={
          <Button variant="outline" onClick={() => restauranteId && carregar(restauranteId, grupo)} disabled={carregando}>
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por ação, pessoa ou mesa…"
            className="h-9 w-64 rounded-menuzia border border-border bg-main px-3 text-[13px] text-text-main outline-none placeholder:text-text-subtle focus:border-primary"
          />
          <div className="flex flex-wrap gap-1.5">
            {GRUPOS_EVENTO.map((g) => (
              <button
                key={g.id}
                onClick={() => setGrupo(g.id)}
                className={[
                  'rounded-menuzia border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide',
                  grupo === g.id
                    ? 'border-primary bg-primary text-white'
                    : 'border-border bg-main text-text-subtle hover:text-text-main',
                ].join(' ')}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {erro && (
          <p className="rounded-menuzia border border-danger bg-danger-bg px-4 py-3 text-[13px] text-danger">{erro}</p>
        )}

        {!erro && carregando && <p className="text-[13px] text-text-subtle">Carregando…</p>}

        {!erro && !carregando && visiveis.length === 0 && (
          <div className="rounded-menuzia border border-border bg-main px-6 py-12 text-center">
            <p className="text-[14px] font-semibold text-text-main">Nenhum evento neste filtro</p>
            <p className="mt-1 text-[12px] text-text-subtle">
              A trilha registra abertura de mesa, lançamento, cancelamento, desconto, pagamento, transferência, chamado,
              rotação de QR e mudança na equipe.
            </p>
          </div>
        )}

        {!erro && !carregando && visiveis.length > 0 && (
          <div className="overflow-hidden rounded-menuzia border border-border bg-main">
            <table className="w-full text-left">
              <thead className="bg-page text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                <tr>
                  <th className="px-4 py-2.5">Quando</th>
                  <th className="px-4 py-2.5">Quem</th>
                  <th className="px-4 py-2.5">O que</th>
                  <th className="px-4 py-2.5">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((e) => (
                  <tr key={e.id} className="border-t border-border align-top text-[13px]">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-text-subtle">{dataHora(e.criadoEm)}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-text-main">{e.usuarioNome ?? 'Sistema'}</span>
                      {e.ator === 'sistema' && (
                        <span className="ml-1.5 text-[11px] uppercase tracking-wide text-text-subtle">automático</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-text-main">{rotuloEvento(e.acao)}</td>
                    <td className="px-4 py-2.5 text-text-subtle">{resumoEvento(e.dados) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[11px] text-text-subtle">
          Mostrando os {visiveis.length} eventos mais recentes. A trilha não guarda senha, token nem dado de cartão.
        </p>
      </div>
    </>
  )
}
