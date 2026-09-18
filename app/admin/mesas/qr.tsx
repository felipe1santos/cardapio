'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { Check, Copy, Download, Printer, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FolhaQr } from '@/components/admin/qr-cardapio-folha'
import { modeloEtiqueta, paginarEtiquetas, rotuloMesa, type Etiqueta, type ModeloEtiqueta } from '@/lib/qr-cardapio'
import { urlPublicaDaMesa, type Mesa } from '@/lib/queries/mesas'

/**
 * QR Code das mesas: o de UMA mesa (copiar, baixar, rodar o token) e a folha A4 com
 * todas.
 *
 * O QR de mesa é diferente do QR do cardápio: cada mesa tem token próprio, opaco e
 * revogável, então a folha imprime um QR por etiqueta em vez de repetir o mesmo.
 *
 * Rodar o token é destrutivo para quem está com o papel antigo na mão, por isso passa
 * por confirmação explícita e por `/api/admin/mesas/[id]/estado`, que exige
 * `mesas.gerenciar` e grava auditoria. A tela nunca faz o update direto.
 */

/** Enquanto a folha está montada, o print esconde o resto do painel (ver globals.css). */
const CLASSE_PRINT = 'imprimindo-qr'
const ESCALA_PREVIEW = 0.42
const FRASE_PADRAO = 'Aponte a câmera para ver o cardápio e montar seu pedido'

function useQrDaUrl(url: string): string | null {
  const [imagem, setImagem] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    if (!url) {
      setImagem(null)
      return
    }
    QRCode.toDataURL(url, { width: 1024, margin: 1, errorCorrectionLevel: 'M' })
      .then((d) => vivo && setImagem(d))
      .catch(() => vivo && setImagem(null))
    return () => {
      vivo = false
    }
  }, [url])
  return imagem
}

function imprimir() {
  const limpar = () => document.body.classList.remove(CLASSE_PRINT)
  document.body.classList.add(CLASSE_PRINT)
  window.addEventListener('afterprint', limpar, { once: true })
  try {
    window.print()
  } finally {
    // Chrome só retorna daqui depois de fechar a caixa de diálogo; o afterprint cobre
    // os navegadores em que print() retorna antes.
    limpar()
  }
}

// ── QR de uma mesa ──────────────────────────────────────────────────────────

export function DrawerQrMesa({
  mesa,
  podeGerenciar,
  onFechar,
  onTokenRodado,
}: {
  mesa: Mesa
  podeGerenciar: boolean
  onFechar: () => void
  onTokenRodado: (token: string) => void
}) {
  const [copiado, setCopiado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [rodando, setRodando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const url = useMemo(
    () => urlPublicaDaMesa(typeof window === 'undefined' ? '' : window.location.origin, mesa.token),
    [mesa.token],
  )
  const imagem = useQrDaUrl(url)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch {
      /* clipboard bloqueado: o link continua visível na tela para copiar à mão */
    }
  }

  async function rodar() {
    setRodando(true)
    setErro(null)
    try {
      const r = await fetch(`/api/admin/mesas/${mesa.id}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'rodar_qr' }),
      })
      const corpo = (await r.json()) as { token?: string; error?: string }
      if (!r.ok || !corpo.token) {
        setErro(corpo.error ?? 'Não foi possível gerar um QR novo.')
        return
      }
      onTokenRodado(corpo.token)
      setConfirmando(false)
    } catch {
      setErro('Sem conexão com o servidor.')
    } finally {
      setRodando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onFechar}>
      <aside className="flex h-full w-full max-w-md flex-col bg-main shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-border px-5">
          <span className="text-[15px] font-semibold text-text-main">QR Code · {mesa.nome}</span>
          <button onClick={onFechar} className="text-text-subtle hover:text-text-main" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto w-full max-w-[260px] rounded-menuzia border border-border p-4 text-center">
            {imagem ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagem} alt={`QR Code da ${mesa.nome}`} className="w-full" />
            ) : (
              <div className="flex h-[228px] items-center justify-center text-[12px] text-text-subtle">Gerando QR…</div>
            )}
            <p className="mt-2 text-[13px] font-bold text-text-main">{rotuloMesa(mesa.nome)}</p>
            <p className="text-[10px] uppercase tracking-wide text-text-subtle">Aponte a câmera para ver o cardápio</p>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Link da mesa</label>
            <div className="flex gap-1.5">
              <input
                readOnly
                value={url}
                className="h-9 flex-1 rounded-menuzia border border-border bg-bg-page px-2.5 text-[11px] text-text-subtle outline-none"
              />
              <Button variant="outline" className="!px-2.5" onClick={copiar} title="Copiar link">
                {copiado ? <Check className="h-3.5 w-3.5 text-price-text" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-text-subtle">
              O link não revela a loja nem o número interno da mesa — é um código próprio, que pode ser revogado.
            </p>
          </div>

          <div className="mt-4 flex gap-2">
            <a href={imagem ?? '#'} download={`qr-${mesa.nome.toLowerCase().replace(/\s+/g, '-')}.png`} className="flex-1">
              <Button variant="outline" className="w-full" disabled={!imagem}>
                <Download className="mr-1.5 inline h-3.5 w-3.5" />
                Baixar PNG
              </Button>
            </a>
            <Button
              variant="outline"
              className="flex-1"
              disabled={!podeGerenciar}
              title={podeGerenciar ? 'Revoga o QR atual e emite um novo' : 'Só a gestão pode gerar um QR novo'}
              onClick={() => setConfirmando(true)}
            >
              <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
              Gerar novo
            </Button>
          </div>

          {erro && (
            <p className="mt-3 rounded-menuzia border border-danger bg-danger-bg px-3 py-2 text-[12px] text-danger">{erro}</p>
          )}

          {confirmando && (
            <div className="mt-4 rounded-menuzia border border-warn bg-warn-bg p-4">
              <p className="text-[13px] font-bold text-text-main">Revogar o QR desta mesa?</p>
              <p className="mt-1 text-[12px] leading-relaxed text-text-main">
                O adesivo e o cartão que já estão na mesa <strong>param de funcionar na hora</strong>. Quem estiver com o
                cardápio aberto precisará ler o QR novo. A mesa, as contas e o histórico continuam os mesmos.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmando(false)} disabled={rodando}>
                  Cancelar
                </Button>
                <Button className="flex-1" onClick={rodar} disabled={rodando}>
                  {rodando ? 'Gerando…' : 'Revogar e gerar novo'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

// ── Folha A4 com todas as mesas ─────────────────────────────────────────────

export function DrawerFolhaMesas({
  mesas,
  nomeLoja,
  logoUrl,
  onFechar,
}: {
  mesas: Mesa[]
  nomeLoja: string
  logoUrl: string | null
  onFechar: () => void
}) {
  const [modelo, setModelo] = useState<ModeloEtiqueta>('cartao')
  const [selecionadas, setSelecionadas] = useState<string[]>(() => mesas.map((m) => m.id))
  const [usarLogo, setUsarLogo] = useState(true)
  const [qrPorMesa, setQrPorMesa] = useState<Record<string, string>>({})
  const [gerando, setGerando] = useState(true)

  const origem = typeof window === 'undefined' ? '' : window.location.origin
  const info = modeloEtiqueta(modelo)

  // Um QR por mesa, gerado uma vez. São imagens grandes (1024px): regenerar a cada
  // troca de modelo travaria a tela com 30 mesas.
  useEffect(() => {
    let vivo = true
    setGerando(true)
    Promise.all(
      mesas.map(async (m) => {
        const dado = await QRCode.toDataURL(urlPublicaDaMesa(origem, m.token), {
          width: 1024,
          margin: 1,
          errorCorrectionLevel: 'M',
        }).catch(() => '')
        return [m.id, dado] as const
      }),
    ).then((pares) => {
      if (!vivo) return
      setQrPorMesa(Object.fromEntries(pares.filter(([, d]) => d)))
      setGerando(false)
    })
    return () => {
      vivo = false
    }
  }, [mesas, origem])

  const etiquetas: Etiqueta[] = useMemo(
    () =>
      mesas
        .filter((m) => selecionadas.includes(m.id))
        .map((m) => ({
          id: m.id,
          mesa: m.nome,
          qrDataUrl: qrPorMesa[m.id] ?? null,
          url: urlPublicaDaMesa(origem, m.token),
        })),
    [mesas, selecionadas, qrPorMesa, origem],
  )

  const paginas = useMemo(() => paginarEtiquetas(etiquetas, info.porPagina), [etiquetas, info.porPagina])
  const prontoParaImprimir = etiquetas.length > 0 && !gerando

  const alternar = useCallback((id: string) => {
    setSelecionadas((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]))
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onFechar}>
      <aside className="flex h-full w-full max-w-4xl flex-col bg-main shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-border px-5">
          <span className="text-[15px] font-semibold text-text-main">Folha de QR Codes das mesas</span>
          <button onClick={onFechar} className="text-text-subtle hover:text-text-main" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5 lg:flex-row">
          <div className="w-full space-y-4 lg:max-w-sm">
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Formato</div>
              <div className="flex flex-wrap gap-1.5">
                {(['adesivo', 'cartao', 'cartaz'] as ModeloEtiqueta[]).map((id) => (
                  <Button
                    key={id}
                    variant={modelo === id ? 'primary' : 'outline'}
                    className="!px-3"
                    onClick={() => setModelo(id)}
                  >
                    {modeloEtiqueta(id).label}
                  </Button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-text-subtle">{info.descricao}</p>
            </div>

            <label className="flex items-center gap-2 text-[12px] text-text-main">
              <input type="checkbox" checked={usarLogo} onChange={(e) => setUsarLogo(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
              Imprimir a logo da loja
            </label>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                  Mesas ({selecionadas.length}/{mesas.length})
                </span>
                <button
                  className="text-[11px] text-primary underline"
                  onClick={() => setSelecionadas(selecionadas.length === mesas.length ? [] : mesas.map((m) => m.id))}
                >
                  {selecionadas.length === mesas.length ? 'Nenhuma' : 'Todas'}
                </button>
              </div>
              <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-menuzia border border-border p-2">
                {mesas.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => alternar(m.id)}
                    className={`rounded-menuzia border px-2.5 py-1 text-[11px] font-semibold ${
                      selecionadas.includes(m.id)
                        ? 'border-primary bg-alert-bg text-alert-text'
                        : 'border-border text-text-subtle'
                    }`}
                  >
                    {m.nome}
                  </button>
                ))}
                {mesas.length === 0 && <span className="text-[12px] text-text-subtle">Nenhuma mesa cadastrada.</span>}
              </div>
            </div>

            <Button className="w-full" onClick={imprimir} disabled={!prontoParaImprimir}>
              <Printer className="mr-1.5 inline h-3.5 w-3.5" />
              {gerando
                ? 'Gerando QR Codes…'
                : `Imprimir ${paginas.length} ${paginas.length === 1 ? 'folha A4' : 'folhas A4'}`}
            </Button>
            <p className="text-[11px] text-text-subtle">
              Cada etiqueta sai com o QR <strong>daquela</strong> mesa — os links são diferentes. Corte pelas linhas
              tracejadas.
            </p>
          </div>

          <div className="flex min-w-0 flex-1 justify-center">
            {paginas.length > 0 && (
              <FolhaQr
                paginas={paginas}
                modelo={info}
                titulo={nomeLoja}
                frase={FRASE_PADRAO}
                url=""
                qrDataUrl={null}
                logoUrl={usarLogo ? logoUrl : null}
                escala={ESCALA_PREVIEW}
              />
            )}
          </div>
        </div>

        {/* A folha real vive fora do layout do painel (que tem overflow hidden e cortaria
            a impressão) — daí o portal direto no <body>. */}
        {typeof document !== 'undefined' &&
          createPortal(
            <div id="qr-print-root" className="hidden">
              <FolhaQr
                paginas={paginas}
                modelo={info}
                titulo={nomeLoja}
                frase={FRASE_PADRAO}
                url=""
                qrDataUrl={null}
                logoUrl={usarLogo ? logoUrl : null}
              />
            </div>,
            document.body,
          )}
      </aside>
    </div>
  )
}
