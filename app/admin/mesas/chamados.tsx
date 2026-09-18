'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BellRing, Check, HandPlatter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ROTULO_MOTIVO, esperaCritica, esperaTexto } from '@/lib/chamados'
import type { Chamado } from '@/lib/queries/chamados'

/**
 * Painel de chamados do salão.
 *
 * Fica no topo da tela de mesas porque é a única informação que não pode esperar o
 * garçom olhar o card certo: mesa chamando há seis minutos é reclamação na porta.
 *
 * Assumir e concluir passam pela rota (`/api/admin/mesas/chamados`), que chama a função
 * do banco — dois garçons tocando "assumir" no mesmo chamado não se atropelam: um ganha
 * e o outro recebe o nome de quem pegou.
 */

export function PainelChamados({
  chamados,
  agora,
  onMudou,
}: {
  chamados: Chamado[]
  /** Relógio do pai, para todos os "há X min" avançarem juntos. */
  agora: number
  onMudou: () => void
}) {
  const [emAcao, setEmAcao] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const agir = useCallback(
    async (chamadoId: string, acao: 'assumir' | 'concluir') => {
      setEmAcao(chamadoId)
      setErro(null)
      try {
        const r = await fetch('/api/admin/mesas/chamados', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao, chamadoId }),
        })
        const corpo = (await r.json()) as { error?: string }
        if (!r.ok) setErro(corpo.error ?? 'Não foi possível atualizar o chamado.')
      } catch {
        setErro('Sem conexão com o servidor.')
      } finally {
        setEmAcao(null)
        // Recarrega nos dois casos: no erro de corrida, para a tela mostrar quem pegou.
        onMudou()
      }
    },
    [onMudou],
  )

  if (chamados.length === 0) return null

  return (
    <div className="mb-4 rounded-menuzia border border-status-pending bg-warn-bg">
      <div className="flex items-center gap-2 border-b border-status-pending/40 px-4 py-2.5">
        <BellRing className="h-4 w-4 flex-shrink-0 text-status-pending" />
        <span className="text-[13px] font-bold text-text-main">
          {chamados.length === 1 ? '1 mesa chamando' : `${chamados.length} mesas chamando`}
        </span>
      </div>

      <ul className="divide-y divide-status-pending/25">
        {chamados.map((c) => {
          const urgente = c.status === 'pendente' && esperaCritica(c.criadoEm, agora)
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <Link
                href={`/admin/mesas/${c.mesaId}`}
                className="text-[14px] font-bold text-text-main underline decoration-transparent hover:decoration-inherit"
              >
                {c.mesaNome}
              </Link>
              <span className="text-[12px] text-text-main">{ROTULO_MOTIVO[c.motivo]}</span>
              <span className={`text-[11px] font-semibold ${urgente ? 'text-danger' : 'text-text-subtle'}`}>
                {esperaTexto(c.criadoEm, agora)}
              </span>

              {c.status === 'assumido' && (
                <span className="rounded-menuzia bg-alert-bg px-2 py-0.5 text-[11px] font-semibold text-alert-text">
                  {c.assumidoPorNome ? `${c.assumidoPorNome} está indo` : 'Assumido'}
                </span>
              )}

              <div className="ml-auto flex gap-1.5">
                {c.status === 'pendente' && (
                  <Button variant="outline" className="!px-2.5" onClick={() => agir(c.id, 'assumir')} disabled={emAcao === c.id}>
                    <HandPlatter className="mr-1 inline h-3.5 w-3.5" />
                    Assumir
                  </Button>
                )}
                <Button variant="success" className="!px-2.5" onClick={() => agir(c.id, 'concluir')} disabled={emAcao === c.id}>
                  <Check className="mr-1 inline h-3.5 w-3.5" />
                  Atendido
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {erro && <p className="border-t border-status-pending/40 px-4 py-2 text-[12px] text-danger">{erro}</p>}
    </div>
  )
}

/**
 * Relógio compartilhado. Um `setInterval` por tela, não um por linha: com dez chamados
 * na fila, dez timers redesenhando o mesmo minuto é desperdício.
 */
export function useRelogio(intervaloMs = 30_000): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), intervaloMs)
    return () => clearInterval(t)
  }, [intervaloMs])
  return agora
}
