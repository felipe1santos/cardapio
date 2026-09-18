'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { Check, Copy, Download, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FolhaQr } from '@/components/admin/qr-cardapio-folha'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { listarMesas, type Mesa } from '@/lib/queries/mesas'
import { QrDasMesas } from '@/components/admin/qr-mesas-lista'
import {
  MAX_ETIQUETAS,
  MODELOS_ETIQUETA,
  modeloEtiqueta,
  montarEtiquetas,
  nomeArquivoQr,
  paginarEtiquetas,
  urlCardapio,
  type ModeloEtiqueta,
} from '@/lib/qr-cardapio'

const FRASE_PADRAO = 'Aponte a câmera do celular e peça pelo cardápio digital'
/** Enquanto a folha está montada, o print esconde o resto do painel (ver globals.css). */
const CLASSE_PRINT = 'imprimindo-qr'
const ESCALA_PREVIEW = 0.45

interface Preferencias {
  modelo: ModeloEtiqueta
  frase: string
  titulo: string
  quantidade: number
  copias: number
  usarLogo: boolean
}

function chavePreferencias(restauranteId: string) {
  return `menuzia:qr-cardapio:${restauranteId}`
}

function lerPreferencias(restauranteId: string): Partial<Preferencias> {
  try {
    const raw = localStorage.getItem(chavePreferencias(restauranteId))
    return raw ? (JSON.parse(raw) as Partial<Preferencias>) : {}
  } catch {
    return {}
  }
}

export function TabQrCode({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [slug, setSlug] = useState('')
  const [nomeLoja, setNomeLoja] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [mesas, setMesas] = useState<Mesa[]>([])
  const [erro, setErro] = useState<string | null>(null)
  // Com Mesas e Comandas ligado, a mesa tem QR próprio (`/mesa/<token>`, cardápio de
  // autoatendimento). O QR desta aba continua sendo o do delivery (`/loja/<slug>`) e
  // deixa de oferecer "nome da mesa na etiqueta" — senão a mesa sairia com o QR errado.
  const [moduloMesas, setModuloMesas] = useState(false)

  const [modelo, setModelo] = useState<ModeloEtiqueta>('cartao')
  const [titulo, setTitulo] = useState('')
  const [frase, setFrase] = useState(FRASE_PADRAO)
  const [quantidade, setQuantidade] = useState(4)
  // Cópias por mesa é outra conta: 13 mesas x 4 cópias seriam 52 etiquetas sem
  // querer. Por isso o campo tem valor próprio, e não o da folha genérica.
  const [copias, setCopias] = useState(1)
  const [usarLogo, setUsarLogo] = useState(true)
  const [mesasSelecionadas, setMesasSelecionadas] = useState<string[]>([])

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [origem, setOrigem] = useState('')

  // Carrega loja + mesas na primeira vez que a aba é aberta.
  useEffect(() => {
    if (!active || loaded) return
    let vivo = true
    ;(async () => {
      try {
        const [config, rows] = await Promise.all([
          buscarConfigLoja(supabase, restauranteId),
          listarMesas(supabase, restauranteId).catch(() => [] as Mesa[]),
        ])
        if (!vivo) return
        if (config) {
          setSlug(config.slug)
          setNomeLoja(config.nome)
          setModuloMesas(config.moduloMesasAtivo)
          if (config.moduloMesasAtivo) setMesasSelecionadas([])
          setLogoUrl(config.logoUrl)
          const prefs = lerPreferencias(restauranteId)
          setTitulo(prefs.titulo ?? config.nome)
          if (prefs.modelo) setModelo(prefs.modelo)
          if (prefs.frase) setFrase(prefs.frase)
          if (prefs.quantidade) setQuantidade(prefs.quantidade)
          if (prefs.copias) setCopias(prefs.copias)
          if (prefs.usarLogo !== undefined) setUsarLogo(prefs.usarLogo)
        }
        setMesas(rows.filter((m) => m.ativa))
        setLoaded(true)
      } catch {
        if (vivo) setErro('Não foi possível carregar os dados da loja.')
      }
    })()
    return () => {
      vivo = false
    }
  }, [active, loaded, supabase, restauranteId])

  useEffect(() => {
    setOrigem(window.location.origin)
  }, [])

  const url = slug ? urlCardapio(origem, slug) : ''

  // Guarda as escolhas: reimprimir uma mesa nova não deve exigir refazer tudo.
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(
        chavePreferencias(restauranteId),
        JSON.stringify({ modelo, frase, titulo, quantidade, copias, usarLogo } satisfies Preferencias),
      )
    } catch {
      /* sem localStorage (aba anônima): a preferência só não persiste */
    }
  }, [loaded, restauranteId, modelo, frase, titulo, quantidade, copias, usarLogo])

  // QR em alta resolução: a mesma imagem serve a folha inteira (o navegador
  // reaproveita o data URL) e o download em PNG.
  useEffect(() => {
    if (!url) return
    let vivo = true
    QRCode.toDataURL(url, { width: 1024, margin: 1, errorCorrectionLevel: 'M' })
      .then((data) => {
        if (vivo) setQrDataUrl(data)
      })
      .catch(() => {
        if (vivo) setErro('Não foi possível gerar o QR Code.')
      })
    return () => {
      vivo = false
    }
  }, [url])

  const info = modeloEtiqueta(modelo)
  const etiquetas = useMemo(
    () => montarEtiquetas({
      mesas: mesasSelecionadas,
      quantidade: mesasSelecionadas.length > 0 ? copias : quantidade,
    }),
    [mesasSelecionadas, quantidade, copias],
  )
  const paginas = useMemo(() => paginarEtiquetas(etiquetas, info.porPagina), [etiquetas, info.porPagina])

  const handleCopiar = useCallback(() => {
    if (!url) return
    navigator.clipboard.writeText(url).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    })
  }, [url])

  const handleBaixar = useCallback(() => {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = nomeArquivoQr(slug)
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [qrDataUrl, slug])

  const handleImprimir = useCallback(() => {
    const limpar = () => document.body.classList.remove(CLASSE_PRINT)
    document.body.classList.add(CLASSE_PRINT)
    window.addEventListener('afterprint', limpar, { once: true })
    try {
      window.print()
    } finally {
      // Chrome volta daqui só depois de fechar a caixa de diálogo; o afterprint
      // cobre os navegadores em que print() retorna antes.
      limpar()
    }
  }, [])

  function toggleMesa(nome: string) {
    setMesasSelecionadas((prev) => (prev.includes(nome) ? prev.filter((m) => m !== nome) : [...prev, nome]))
  }

  const total = etiquetas.length
  const noLimite = total >= MAX_ETIQUETAS

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="flex flex-wrap items-start gap-6">
          {/* ── Configuração ── */}
          <div className="w-full max-w-xl space-y-6">
            {moduloMesas && loaded && <QrDasMesas mesas={mesas} nomeLoja={nomeLoja} logoUrl={logoUrl} />}

            <Card>
              <h3 className="mb-1 text-[13px] font-bold text-text-main">
                {moduloMesas ? 'QR Code do delivery (vitrine)' : 'QR Code do cardápio'}
              </h3>
              <p className="mb-4 text-[12px] leading-relaxed text-text-subtle">
                {moduloMesas ? (
                  <>
                    Abre a <strong className="text-text-main">vitrine de delivery</strong>, onde o cliente pede para
                    entregar ou retirar. Use para divulgação, balcão e redes sociais. <strong className="text-text-main">
                    Para as mesas, use o QR de cada mesa acima.</strong>
                  </>
                ) : (
                  <>
                    Gere as etiquetas para imprimir e colar nas mesas. O cliente aponta a câmera e cai direto no seu
                    cardápio digital.
                  </>
                )}
              </p>

              <div className="mb-4 flex min-w-0 items-center gap-2 overflow-hidden rounded-menuzia border border-border bg-page px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-subtle">
                  {url || 'Carregando…'}
                </span>
                <button
                  onClick={handleCopiar}
                  disabled={!url}
                  className={[
                    'flex flex-shrink-0 items-center gap-1 rounded-menuzia px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50',
                    copiado ? 'text-status-ready' : 'text-primary hover:bg-primary/10',
                  ].join(' ')}
                >
                  {copiado ? <Check size={13} /> : <Copy size={13} />}
                  {copiado ? 'Copiado!' : 'Copiar'}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handleImprimir} disabled={!qrDataUrl || total === 0}>
                  <Printer size={13} />
                  Imprimir {paginas.length > 0 ? `(${paginas.length} ${paginas.length === 1 ? 'folha' : 'folhas'})` : ''}
                </Button>
                <Button variant="outline" onClick={handleBaixar} disabled={!qrDataUrl}>
                  <Download size={13} />
                  Baixar PNG
                </Button>
              </div>
            </Card>

            <Card>
              <h4 className="mb-3 text-[13px] font-bold text-text-main">Modelo da etiqueta</h4>
              <div className="space-y-2">
                {MODELOS_ETIQUETA.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModelo(m.id)}
                    className={[
                      'flex w-full items-start gap-3 rounded-menuzia border p-3 text-left transition-colors',
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
                      <span className="block text-[11px] leading-relaxed text-text-subtle">{m.descricao}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="space-y-4">
              <h4 className="text-[13px] font-bold text-text-main">Conteúdo impresso</h4>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                  Título
                </label>
                <input
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder={nomeLoja}
                  className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none transition-colors focus:border-primary"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                  Frase de instrução
                </label>
                <input
                  value={frase}
                  onChange={(e) => setFrase(e.target.value)}
                  placeholder={FRASE_PADRAO}
                  className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none transition-colors focus:border-primary"
                />
              </div>

              {logoUrl && (
                <label className="flex items-center gap-2 text-[12px] text-text-main">
                  <input
                    type="checkbox"
                    checked={usarLogo}
                    onChange={(e) => setUsarLogo(e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Imprimir a logo da loja acima do título
                </label>
              )}
            </Card>

            {!moduloMesas && (
            <Card className="space-y-4">
              <div>
                <h4 className="text-[13px] font-bold text-text-main">Mesas</h4>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-subtle">
                  Selecione as mesas para imprimir o nome em cada etiqueta. O QR é o mesmo em todas — o nome serve
                  para o garçom saber onde colar. Sem seleção, sai a etiqueta genérica.
                </p>
              </div>

              {mesas.length === 0 ? (
                <p className="rounded-menuzia border border-dashed border-border px-3 py-2.5 text-[12px] text-text-subtle">
                  Nenhuma mesa cadastrada. Cadastre na aba <strong>Mesas</strong> ou imprima etiquetas sem
                  identificação.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {mesas.map((m) => {
                      const on = mesasSelecionadas.includes(m.nome)
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleMesa(m.nome)}
                          className={[
                            'rounded-menuzia border px-2.5 py-1 text-[12px] font-medium transition-colors',
                            on
                              ? 'border-primary bg-primary text-white'
                              : 'border-border bg-white text-text-main hover:border-primary',
                          ].join(' ')}
                        >
                          {m.nome}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex gap-3 text-[11px] font-semibold uppercase tracking-wide">
                    <button
                      type="button"
                      onClick={() => setMesasSelecionadas(mesas.map((m) => m.nome))}
                      className="text-primary hover:underline"
                    >
                      Selecionar todas
                    </button>
                    <button
                      type="button"
                      onClick={() => setMesasSelecionadas([])}
                      className="text-text-subtle hover:text-text-main"
                    >
                      Limpar
                    </button>
                  </div>
                </>
              )}

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                  {mesasSelecionadas.length > 0 ? 'Cópias por mesa' : 'Quantidade de etiquetas'}
                </label>
                <input
                  type="number"
                  min={1}
                  max={MAX_ETIQUETAS}
                  value={mesasSelecionadas.length > 0 ? copias : quantidade}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(MAX_ETIQUETAS, Number(e.target.value) || 1))
                    if (mesasSelecionadas.length > 0) setCopias(v)
                    else setQuantidade(v)
                  }}
                  className="w-28 rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none transition-colors focus:border-primary"
                />
                <p className="mt-1.5 text-[11px] text-text-subtle">
                  {total} {total === 1 ? 'etiqueta' : 'etiquetas'} · {paginas.length}{' '}
                  {paginas.length === 1 ? 'folha A4' : 'folhas A4'}
                  {noLimite && ` (limite de ${MAX_ETIQUETAS} por impressão)`}
                </p>
              </div>
            </Card>
            )}

            {erro && (
              <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">
                {erro}
              </p>
            )}
          </div>

          {/* ── Pré-visualização (mesma folha que vai pra impressora) ── */}
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                Pré-visualização
              </span>
              <span className="text-[11px] text-text-subtle">A4 · {info.label}</span>
            </div>
            <div className="max-h-[70vh] overflow-y-auto rounded-menuzia border border-border bg-page p-4">
              {paginas.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-text-subtle">Nenhuma etiqueta para imprimir.</p>
              ) : (
                <FolhaQr
                  paginas={paginas}
                  modelo={info}
                  titulo={titulo || nomeLoja}
                  frase={frase || FRASE_PADRAO}
                  url={url}
                  qrDataUrl={qrDataUrl}
                  logoUrl={usarLogo ? logoUrl : null}
                  escala={ESCALA_PREVIEW}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* A folha real vive fora do layout do painel (que tem overflow hidden e
          cortaria a impressão) — daí o portal direto no <body>. */}
      {active &&
        typeof document !== 'undefined' &&
        createPortal(
          <div id="qr-print-root" className="hidden">
            <FolhaQr
              paginas={paginas}
              modelo={info}
              titulo={titulo || nomeLoja}
              frase={frase || FRASE_PADRAO}
              url={url}
              qrDataUrl={qrDataUrl}
              logoUrl={usarLogo ? logoUrl : null}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
