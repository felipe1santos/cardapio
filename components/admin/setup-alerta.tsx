'use client'

import type { PendenciaSetup } from '@/lib/setup-checklist'

export interface SetupAlertaProps {
  pendencias: PendenciaSetup[]
  /** "OK, entendi": fecha o modal e deixa só o marcador no menu. */
  onDispensar: () => void
  /** "Resolver agora": leva pro item do menu que resolve a pendência. */
  onResolver: (href: string) => void
}

const MENU_LABEL: Record<string, string> = {
  '/admin/ajustes': 'Ajustes',
  '/admin/cardapio': 'Cardápio',
  '/admin/lista-pedidos': 'Pedidos',
  '/admin/logistica': 'Pedidos',
  '/admin/pedidos': 'Painel de Pedidos',
}

/**
 * Modal que abre no painel quando falta configuração que atrapalha o pedido do
 * cliente final. Pisca de propósito: é a única tela do admin que interrompe o
 * fluxo, e só aparece de novo quando surge uma pendência nova (ver a assinatura
 * guardada pelo AdminLayout).
 */
export function SetupAlerta({ pendencias, onDispensar, onResolver }: SetupAlertaProps) {
  // Aberto pelo ícone de alerta do menu sem nada pendente: confirma que está tudo certo.
  if (pendencias.length === 0) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#111827]/70 p-4" role="dialog" aria-modal="true" aria-labelledby="setup-alerta-titulo" onClick={onDispensar}>
        <div className="w-full max-w-[420px] rounded-menuzia border border-border bg-main p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <h2 id="setup-alerta-titulo" className="text-[15px] font-semibold text-text-main">Nenhuma pendência</h2>
          <p className="mt-1 text-[13px] text-text-subtle">A configuração da sua loja está completa.</p>
          <button type="button" onClick={onDispensar} className="mt-4 rounded-menuzia bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark">OK</button>
        </div>
      </div>
    )
  }

  const criticas = pendencias.filter((p) => p.severidade === 'critico')
  const primeira = criticas[0] ?? pendencias[0]

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#111827]/70 p-4" role="dialog" aria-modal="true" aria-labelledby="setup-alerta-titulo">
      <div className="flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden rounded-menuzia border border-border bg-main shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border p-4.5">
          <span className="animate-alerta-setup flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-danger-bg">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-danger" aria-hidden>
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="setup-alerta-titulo" className="text-[15px] font-semibold leading-tight text-text-main">
              {criticas.length > 0 ? 'Sua loja tem pendências que atrapalham o pedido' : 'Dá pra deixar sua loja mais completa'}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-text-subtle">
              {criticas.length > 0
                ? 'Enquanto isso não for resolvido, o cliente pode não conseguir fechar o pedido no seu cardápio.'
                : 'Nada aqui trava o pedido, mas resolver melhora a experiência de quem compra.'}
            </p>
          </div>
        </div>

        <ul className="flex-1 overflow-y-auto p-4.5">
          {pendencias.map((p) => (
            <li key={p.id} className="mb-2.5 rounded-menuzia border border-border p-3 last:mb-0">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[13.5px] font-semibold leading-tight text-text-main">{p.titulo}</h3>
                <span
                  className={[
                    'flex-shrink-0 rounded-menuzia px-1.5 py-[3px] text-[9px] font-semibold uppercase tracking-wide',
                    p.severidade === 'critico' ? 'bg-danger text-white' : 'bg-warn-bg text-[#B45309]',
                  ].join(' ')}
                >
                  {p.severidade === 'critico' ? 'Crítico' : 'Atenção'}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-text-subtle">{p.descricao}</p>
              <button
                type="button"
                data-testid="pendencia-resolver"
                onClick={() => onResolver(p.href)}
                className="mt-2 rounded-menuzia bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark"
              >
                Resolver <span className="font-normal normal-case opacity-80">· {MENU_LABEL[p.href] ?? 'Ajustes'}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 border-t border-border p-4.5 sm:flex-row-reverse">
          <button
            type="button"
            onClick={() => onResolver(primeira.href)}
            className="rounded-menuzia bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark sm:flex-1"
          >
            Resolver agora
          </button>
          <button
            type="button"
            onClick={onDispensar}
            className="rounded-menuzia border border-border bg-main px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle transition-colors hover:bg-page sm:flex-1"
          >
            OK, entendi
          </button>
        </div>
      </div>
    </div>
  )
}
