'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FolhaQr } from '@/components/admin/qr-cardapio-folha'
import {
  LIMITES_TAMANHO,
  MAX_ETIQUETAS,
  MODELOS_ETIQUETA,
  comTamanhoQr,
  descricaoDoModelo,
  modeloEtiqueta,
  paginarEtiquetas,
  rotuloMesa,
  tamanhoQrValido,
  type Etiqueta,
  type ModeloEtiqueta,
} from '@/lib/qr-cardapio'

/**
 * Impressão de QR em janela central.
 *
 * A folha não vive mais ao lado da configuração: ela só aparece quando alguém
 * pede para imprimir. O painel fica limpo (uma lista de QRs e dois botões) e a
 * decisão de impressão acontece num lugar só, com a folha à vista.
 *
 * O mesmo modal serve aos três caminhos: um QR de mesa, várias mesas de uma vez
 * e o QR do delivery. O que muda é a lista que entra e se há seleção.
 */

/** Uma peça imprimível: o QR já gerado e o link que ele abre. */
export interface PecaQr {
  id: string
  /** Nome que sai impresso na etiqueta ("Mesa 01"). Null = etiqueta sem nome. */
  nome: string | null
  url: string
  qrDataUrl: string | null
}

const CLASSE_PRINT = 'imprimindo-qr'
const ESCALA_PREVIEW = 0.42

export function ModalImpressaoQr({
  titulo,
  subtitulo,
  pecas,
  comSelecao = false,
  destino,
  nomeLoja,
  logoUrl,
  fraseInicial,
  modeloInicial = 'cartao',
  onFechar,
}: {
  titulo: string
  subtitulo?: string
  pecas: PecaQr[]
  /** true = o lojista escolhe quais peças entram na folha (impressão em lote). */
  comSelecao?: boolean
  destino: 'mesa' | 'delivery'
  nomeLoja: string
  logoUrl: string | null
  fraseInicial: string
  modeloInicial?: ModeloEtiqueta
  onFechar: () => void
}) {
  const [modelo, setModelo] = useState<ModeloEtiqueta>(modeloInicial)
  const [tamanho, setTamanho] = useState(() => modeloEtiqueta(modeloInicial).qrMm)
  const [copias, setCopias] = useState(1)
  const [tituloImpresso, setTituloImpresso] = useState(nomeLoja)
  const [frase, setFrase] = useState(fraseInicial)
  const [usarLogo, setUsarLogo] = useState(true)
  const [maisOpcoes, setMaisOpcoes] = useState(false)
  const [selecionadas, setSelecionadas] = useState<string[]>(() => pecas.map((p) => p.id))
  const [imprimindo, setImprimindo] = useState(false)

  const limites = LIMITES_TAMANHO[modelo]
  const info = useMemo(() => comTamanhoQr(modeloEtiqueta(modelo), tamanho), [modelo, tamanho])

  /** Trocar de modelo devolve o tamanho ao padrão dele: 110 mm não cabe num adesivo. */
  const trocarModelo = useCallback((novo: ModeloEtiqueta) => {
    setModelo(novo)
    setTamanho(modeloEtiqueta(novo).qrMm)
  }, [])

  const escolhidas = useMemo(
    () => (comSelecao ? pecas.filter((p) => selecionadas.includes(p.id)) : pecas),
    [comSelecao, pecas, selecionadas],
  )

  const etiquetas: Etiqueta[] = useMemo(() => {
    const lista: Etiqueta[] = []
    const n = Math.max(1, copias)
    for (const p of escolhidas) {
      for (let i = 0; i < n; i++) {
        lista.push({ id: `${p.id}-${i}`, mesa: p.nome, qrDataUrl: p.qrDataUrl, url: p.url })
      }
    }
    return lista.slice(0, MAX_ETIQUETAS)
  }, [escolhidas, copias])

  const paginas = useMemo(() => paginarEtiquetas(etiquetas, info.porPagina), [etiquetas, info.porPagina])

  // Esc fecha; enquanto o modal está aberto, a página atrás não rola.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', aoTeclar)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = overflow
    }
  }, [onFechar])

  // A folha real vai para o <body> (o painel tem overflow hidden e cortaria a
  // impressão). Ela só é montada no instante do print.
  useEffect(() => {
    if (!imprimindo) return
    const limpar = () => {
      document.body.classList.remove(CLASSE_PRINT)
      setImprimindo(false)
    }
    document.body.classList.add(CLASSE_PRINT)
    window.addEventListener('afterprint', limpar, { once: true })
    const t = setTimeout(() => {
      try {
        window.print()
      } finally {
        limpar()
      }
    }, 80)
    return () => {
      clearTimeout(t)
      window.removeEventListener('afterprint', limpar)
    }
  }, [imprimindo])

  const conteudo = (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={onFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-menuzia bg-main shadow-2xl sm:max-h-[88vh] sm:max-w-4xl sm:rounded-menuzia"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-text-main">{titulo}</h3>
            {subtitulo && <p className="mt-0.5 text-[12px] text-text-subtle">{subtitulo}</p>}
          </div>
          <button
            onClick={onFechar}
            aria-label="Fechar"
            className="toque-icone -mr-2 flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-menuzia text-text-subtle hover:bg-page hover:text-text-main"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 lg:flex-row">
          {/* ── Configuração ── */}
          <div className="w-full flex-shrink-0 space-y-4 lg:w-[300px]">
            {comSelecao && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                    {selecionadas.length} de {pecas.length} selecionadas
                  </span>
                  <div className="flex gap-3 text-[11px] font-semibold uppercase tracking-wide">
                    <button type="button" onClick={() => setSelecionadas(pecas.map((p) => p.id))} className="text-primary hover:underline">
                      Todas
                    </button>
                    <button type="button" onClick={() => setSelecionadas([])} className="text-text-subtle hover:text-text-main">
                      Nenhuma
                    </button>
                  </div>
                </div>
                <div className="flex max-h-[168px] flex-wrap gap-1.5 overflow-y-auto rounded-menuzia border border-border p-2">
                  {pecas.map((p) => {
                    const on = selecionadas.includes(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelecionadas((s) => (on ? s.filter((x) => x !== p.id) : [...s, p.id]))}
                        className={[
                          'rounded-menuzia border px-2.5 py-1 text-[12px] font-semibold transition-colors',
                          on ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-main hover:border-primary',
                        ].join(' ')}
                      >
                        {p.nome ? rotuloMesa(p.nome) : 'Etiqueta'}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div>
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                Modelo da folha
              </span>
              <div className="space-y-2">
                {MODELOS_ETIQUETA.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => trocarModelo(m.id)}
                    className={[
                      'flex w-full items-start gap-2.5 rounded-menuzia border p-2.5 text-left transition-colors',
                      modelo === m.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border',
                        modelo === m.id ? 'border-primary' : 'border-border',
                      ].join(' ')}
                    >
                      {modelo === m.id && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-text-main">{m.label}</span>
                      <span className="block text-[11px] leading-snug text-text-subtle">{descricaoDoModelo(m, destino)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                Tamanho do QR
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setTamanho(tamanhoQrValido(modelo, tamanho - limites.passo))}
                  disabled={tamanho <= limites.min}
                  aria-label="Diminuir o QR"
                  className="toque-icone flex h-[38px] w-[38px] items-center justify-center rounded-menuzia border border-border text-[18px] font-bold text-text-subtle hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  −
                </button>
                <div className="min-w-[74px] text-center">
                  <span className="text-[17px] font-bold tabular-nums text-text-main">{tamanho}</span>
                  <span className="ml-1 text-[12px] text-text-subtle">mm</span>
                </div>
                <button
                  type="button"
                  onClick={() => setTamanho(tamanhoQrValido(modelo, tamanho + limites.passo))}
                  disabled={tamanho >= limites.max}
                  aria-label="Aumentar o QR"
                  className="toque-icone flex h-[38px] w-[38px] items-center justify-center rounded-menuzia border border-border text-[18px] font-bold text-text-subtle hover:border-primary hover:text-primary disabled:opacity-40"
                >
                  +
                </button>
                <input
                  type="range"
                  min={limites.min}
                  max={limites.max}
                  step={limites.passo}
                  value={tamanho}
                  onChange={(e) => setTamanho(tamanhoQrValido(modelo, Number(e.target.value)))}
                  aria-label="Tamanho do QR em milímetros"
                  className="h-1 flex-1 cursor-pointer accent-primary"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                {comSelecao ? 'Cópias de cada uma' : 'Quantas etiquetas'}
              </label>
              <input
                type="number"
                min={1}
                max={comSelecao ? 20 : MAX_ETIQUETAS}
                value={copias}
                onChange={(e) => setCopias(Math.max(1, Math.min(comSelecao ? 20 : MAX_ETIQUETAS, Number(e.target.value) || 1)))}
                className="w-24 rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary"
              />
            </div>

            <button
              type="button"
              onClick={() => setMaisOpcoes((v) => !v)}
              className="text-[11px] font-semibold uppercase tracking-wide text-primary hover:underline"
            >
              {maisOpcoes ? 'Menos opções' : 'Título, frase e logo'}
            </button>

            {maisOpcoes && (
              <div className="space-y-3 rounded-menuzia border border-border p-3">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Título</label>
                  <input
                    value={tituloImpresso}
                    onChange={(e) => setTituloImpresso(e.target.value)}
                    maxLength={40}
                    className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Frase</label>
                  <input
                    value={frase}
                    onChange={(e) => setFrase(e.target.value)}
                    maxLength={70}
                    className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </div>
                <label className="flex items-center gap-2 text-[13px] text-text-main">
                  <input type="checkbox" checked={usarLogo} onChange={(e) => setUsarLogo(e.target.checked)} className="h-4 w-4 accent-primary" />
                  Imprimir a logo da loja
                </label>
              </div>
            )}
          </div>

          {/* ── A folha ── */}
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Como vai sair no papel</span>
              <span className="text-[11px] text-text-subtle">
                A4 · {info.label} · {info.qrMm} mm · {paginas.length} {paginas.length === 1 ? 'folha' : 'folhas'}
              </span>
            </div>
            <div className="max-h-[52vh] overflow-y-auto rounded-menuzia border border-border bg-page p-4">
              {paginas.length === 0 ? (
                <p className="py-10 text-center text-[12px] text-text-subtle">
                  {comSelecao ? 'Escolha ao menos uma mesa.' : 'Nada para imprimir.'}
                </p>
              ) : (
                <FolhaQr
                  paginas={paginas}
                  modelo={info}
                  titulo={tituloImpresso || nomeLoja}
                  frase={frase}
                  url={pecas[0]?.url ?? ''}
                  qrDataUrl={pecas[0]?.qrDataUrl ?? null}
                  logoUrl={usarLogo ? logoUrl : null}
                  escala={ESCALA_PREVIEW}
                />
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-4">
          <span className="text-[12px] text-text-subtle">
            {etiquetas.length} {etiquetas.length === 1 ? 'etiqueta' : 'etiquetas'}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button onClick={() => setImprimindo(true)} disabled={paginas.length === 0}>
              <Printer className="mr-1.5 inline h-3.5 w-3.5" />
              Imprimir
            </Button>
          </div>
        </div>
      </div>

      {imprimindo &&
        createPortal(
          <div id="qr-print-root" className="hidden">
            <FolhaQr
              paginas={paginas}
              modelo={info}
              titulo={tituloImpresso || nomeLoja}
              frase={frase}
              url={pecas[0]?.url ?? ''}
              qrDataUrl={pecas[0]?.qrDataUrl ?? null}
              logoUrl={usarLogo ? logoUrl : null}
            />
          </div>,
          document.body,
        )}
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(conteudo, document.body)
}
