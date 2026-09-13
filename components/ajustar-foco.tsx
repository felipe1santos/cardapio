'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SeletorFoco } from '@/components/seletor-foco'
import { objectPosition, type Foco } from '@/lib/foco-imagem'

/**
 * Botão "Ajustar posição" + modal com a mira.
 *
 * A mira nasceu embaixo do upload, ocupando uma segunda cópia em tamanho
 * grande da mesma imagem que já estava na tela logo acima. Em Ajustes isso
 * empurrava o resto do formulário pra fora da dobra e dava a impressão de que
 * a foto tinha sido enviada duas vezes. Aqui ela vira uma tarefa com começo e
 * fim: abre no centro da tela, o lojista arrasta, confirma e volta pro
 * formulário.
 *
 * Nada é gravado aqui. "Aplicar" só emite o foco novo pra tela que usa; quem
 * persiste continua sendo o "Salvar alterações" do formulário — o mesmo
 * contrato da mira antiga, pra que confirmar no modal não vire um salvamento
 * escondido que atropela as outras edições ainda não salvas.
 */
export function AjustarFoco({
  src,
  foco,
  onChange,
  proporcoes,
  titulo,
  descricao,
  disabled,
}: {
  src: string
  foco: Foco
  onChange: (f: Foco) => void
  proporcoes: { rotulo: string; ratio: number }[]
  /** Cabeçalho do modal, ex. "Posição do banner de capa". */
  titulo: string
  /** Uma linha explicando o que o recorte faz nesta imagem específica. */
  descricao: string
  disabled?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  // Rascunho: arrastar a mira não mexe no formulário enquanto o modal está
  // aberto. Sem isso, "Cancelar" não teria como desfazer o arrasto.
  const [rascunho, setRascunho] = useState<Foco>(foco)
  // createPortal só existe no cliente; no primeiro render do servidor não há
  // document. O flag evita o mismatch de hidratação.
  const [montado, setMontado] = useState(false)
  useEffect(() => { setMontado(true) }, [])

  function abrir() {
    setRascunho(foco)
    setAberto(true)
  }

  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    // O modal cobre a tela inteira; rolar a página atrás dele só desalinha o
    // que o lojista volta a ver quando fecha.
    const overflowAntes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', aoTeclar)
    return () => {
      document.body.style.overflow = overflowAntes
      window.removeEventListener('keydown', aoTeclar)
    }
  }, [aberto])

  const mexido = rascunho.x !== foco.x || rascunho.y !== foco.y

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-menuzia border border-border bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-main transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
          <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm1-11h-2v3h2V3zm0 15h-2v3h2v-3zM3 11v2h3v-2H3zm15 0v2h3v-2h-3z" />
        </svg>
        Ajustar posição
      </button>

      {aberto && montado && createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={titulo}
          onClick={() => setAberto(false)}
        >
          <div
            className="flex max-h-[90dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-menuzia border border-border bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-[14px] font-bold text-text-main">{titulo}</h2>
                <p className="mt-0.5 text-[11.5px] leading-snug text-text-subtle">{descricao}</p>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setAberto(false)}
                className="-mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-menuzia text-text-subtle hover:bg-page hover:text-text-main"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.7 2.88 18.3 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.3-6.29z" /></svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <SeletorFoco src={src} foco={rascunho} onChange={setRascunho} proporcoes={proporcoes} />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border bg-page px-4 py-3">
              <span className="text-[11px] text-text-subtle">Posição: {objectPosition(rascunho)}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAberto(false)}
                  className="rounded-menuzia px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:bg-border/60 hover:text-text-main"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => { if (mexido) onChange(rascunho); setAberto(false) }}
                  className="rounded-menuzia bg-primary px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark"
                >
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
