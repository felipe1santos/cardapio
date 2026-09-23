'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Pencil, X } from 'lucide-react'

/**
 * Ficha da loja — o que o bloco do topo do menu abre.
 *
 * É só leitura, de propósito: a edição já existe em Ajustes, e uma segunda tela
 * de edição seria outro lugar para o mesmo dado divergir. Daqui o dono vê o que
 * está publicado e vai para Ajustes quando quiser mudar.
 */
export interface DadosDaLoja {
  nome: string
  logoUrl: string | null
  bairro: string
  cidade: string
  slug?: string | null
  telefone?: string | null
}

export function FichaDaLoja({
  loja,
  onFechar,
  onEditar,
  urlCardapio,
}: {
  loja: DadosDaLoja
  onFechar: () => void
  /** Leva para a tela de configuração que já existe. */
  onEditar: () => void
  urlCardapio?: string | null
}) {
  const fechar = useRef<HTMLButtonElement>(null)

  // Esc fecha, e o foco entra na janela — quem navega por teclado não fica preso atrás.
  // Ao sair, o foco VOLTA para o botão que abriu: sem isso ele cai no <body> e a
  // próxima tecla Tab recomeça do topo da página, longe de onde a pessoa estava.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar()
    }
    const abriu = document.activeElement as HTMLElement | null
    window.addEventListener('keydown', aoTeclar)
    fechar.current?.focus()
    return () => {
      window.removeEventListener('keydown', aoTeclar)
      if (abriu?.isConnected) abriu.focus()
    }
  }, [onFechar])

  if (typeof document === 'undefined') return null

  const linhas: { rotulo: string; valor: string }[] = [
    { rotulo: 'Nome', valor: loja.nome },
    { rotulo: 'Bairro', valor: loja.bairro },
    { rotulo: 'Cidade', valor: loja.cidade },
    ...(loja.telefone ? [{ rotulo: 'Telefone', valor: loja.telefone }] : []),
  ].filter((l) => l.valor)

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-6"
      onClick={onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Dados de ${loja.nome}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-t-[var(--adm-raio,8px)] bg-white pb-[max(env(safe-area-inset-bottom),0px)] shadow-2xl sm:rounded-[var(--adm-raio,8px)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--adm-borda,#e5e7eb)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {loja.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={loja.logoUrl}
                alt=""
                className="h-11 w-11 flex-shrink-0 rounded-[var(--adm-raio-sm,6px)] border border-[var(--adm-borda,#e5e7eb)] object-cover"
              />
            ) : (
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[var(--adm-raio-sm,6px)] bg-[var(--adm-azul-claro,#eff6ff)] text-[16px] font-bold text-[var(--adm-azul,#0b78d0)]">
                {loja.nome.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-bold text-[var(--adm-texto,#101828)]">{loja.nome}</h2>
              {(loja.bairro || loja.cidade) && (
                <p className="truncate text-[12px] text-[var(--adm-texto-suave,#5b6472)]">
                  {[loja.bairro, loja.cidade].filter(Boolean).join(', ')}
                </p>
              )}
            </div>
          </div>
          <button
            ref={fechar}
            onClick={onFechar}
            aria-label="Fechar"
            className="toque-icone -mr-2 flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-[var(--adm-raio-sm,6px)] text-[var(--adm-texto-suave,#5b6472)] hover:bg-[var(--adm-superficie-2,#fafbfc)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <dl className="divide-y divide-[var(--adm-borda,#e5e7eb)] px-5">
          {linhas.map((l) => (
            <div key={l.rotulo} className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--adm-texto-suave,#5b6472)]">
                {l.rotulo}
              </dt>
              <dd className="min-w-0 truncate text-right text-[13px] text-[var(--adm-texto,#101828)]">{l.valor}</dd>
            </div>
          ))}
          {urlCardapio && (
            <div className="flex items-baseline justify-between gap-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--adm-texto-suave,#5b6472)]">
                Cardápio
              </dt>
              <dd className="min-w-0 truncate text-right">
                <a
                  href={urlCardapio}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--adm-azul,#0b78d0)] hover:underline"
                >
                  Abrir <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </dd>
            </div>
          )}
        </dl>

        <div className="flex justify-end gap-2 border-t border-[var(--adm-borda,#e5e7eb)] px-5 py-4">
          <button
            onClick={onFechar}
            className="rounded-[var(--adm-raio-sm,6px)] border border-[var(--adm-borda,#e5e7eb)] px-3.5 py-2 text-[12px] font-semibold text-[var(--adm-texto-suave,#5b6472)] hover:bg-[var(--adm-superficie-2,#fafbfc)]"
          >
            Fechar
          </button>
          <button
            onClick={onEditar}
            className="inline-flex items-center gap-1.5 rounded-[var(--adm-raio-sm,6px)] bg-[var(--adm-azul,#0b78d0)] px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-[var(--adm-azul-escuro,#0961a8)]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Editar em Ajustes
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
