'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Download, Printer, QrCode, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { urlPublicaDaMesa } from '@/lib/queries/mesas'
import { ListaQrMesas, type MesaComQr } from '@/components/admin/qr-mesas-lista'
import { ModalImpressaoQr, type PecaQr } from '@/components/admin/qr-modal-impressao'
import { nomeArquivoQr, rotuloMesa, urlCardapio } from '@/lib/qr-cardapio'

/**
 * Aba QR Code — dois blocos, e a folha só aparece quando alguém pede.
 *
 * A tela anterior mostrava a folha inteira ao lado da configuração, dos dois
 * destinos ao mesmo tempo: muito papel na tela para uma decisão que acontece uma
 * vez por mês. Agora o painel mostra o que o lojista precisa reconhecer — o QR de
 * cada mesa e o da vitrine — e a impressão abre numa janela central, onde ele
 * escolhe o tamanho e vê como sai no papel.
 *
 * Os dois QRs continuam separados com uma divisória, porque são destinos
 * diferentes: um abre o cardápio da mesa, o outro a vitrine de entrega. Trocar
 * um pelo outro foi o erro que fez cliente sentado à mesa cair no delivery.
 */

const FRASE_MESA = 'Aponte a câmera e veja o cardápio desta mesa'
const FRASE_DELIVERY = 'Aponte a câmera do celular e peça pelo cardápio digital'

interface TokenQr {
  id: string
  nome: string
  setor: string | null
  ativa: boolean
  token: string | null
  qrRevogado: boolean
}

/** O que está aberto na janela de impressão. */
type Impressao =
  | { tipo: 'mesa'; mesa: MesaComQr }
  | { tipo: 'mesas' }
  | { tipo: 'delivery' }
  | null

export function TabQrCode({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [slug, setSlug] = useState('')
  const [nomeLoja, setNomeLoja] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [moduloMesas, setModuloMesas] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [origem, setOrigem] = useState('')

  const [mesasQr, setMesasQr] = useState<MesaComQr[]>([])
  const [qrDelivery, setQrDelivery] = useState<string | null>(null)
  const [copiadoDelivery, setCopiadoDelivery] = useState(false)
  const [copiadoMesa, setCopiadoMesa] = useState<string | null>(null)
  const [impressao, setImpressao] = useState<Impressao>(null)

  useEffect(() => {
    setOrigem(window.location.origin)
  }, [])

  useEffect(() => {
    if (!active || loaded) return
    let vivo = true
    ;(async () => {
      try {
        const config = await buscarConfigLoja(supabase, restauranteId)
        if (!vivo || !config) return
        setSlug(config.slug)
        setNomeLoja(config.nome)
        setLogoUrl(config.logoUrl)
        setModuloMesas(config.moduloMesasAtivo)
        setLoaded(true)
      } catch {
        if (vivo) setErro('Não foi possível carregar os dados da loja.')
      }
    })()
    return () => {
      vivo = false
    }
  }, [active, loaded, supabase, restauranteId])

  // Tokens das mesas + o QR de cada uma. A rota só responde à gestão.
  useEffect(() => {
    if (!active || !moduloMesas || !origem) return
    let vivo = true
    ;(async () => {
      const r = await fetch('/api/admin/mesas/qr', { cache: 'no-store' })
      const corpo = (await r.json().catch(() => ({}))) as { mesas?: TokenQr[]; error?: string }
      if (!vivo) return
      if (!r.ok) {
        setErro(corpo.error ?? 'Não foi possível carregar os QR Codes das mesas.')
        return
      }
      const comQr = await Promise.all(
        (corpo.mesas ?? [])
          .filter((m) => m.ativa)
          .map(async (m) => {
            const url = m.token ? urlPublicaDaMesa(origem, m.token) : ''
            // Duas resoluções: a grande vai para o papel, a pequena para a tela
            // (lista e prévia). Com 13 mesas, 52 imagens de 1024px travavam a janela.
            const [qrDataUrl, qrPreview] = url
              ? await Promise.all([
                  QRCode.toDataURL(url, { width: 1024, margin: 1, errorCorrectionLevel: 'M' }).catch(() => null),
                  QRCode.toDataURL(url, { width: 240, margin: 1, errorCorrectionLevel: 'M' }).catch(() => null),
                ])
              : [null, null]
            return { id: m.id, nome: m.nome, setor: m.setor, url, qrDataUrl, qrPreview, qrRevogado: m.qrRevogado }
          }),
      )
      if (vivo) setMesasQr(comQr)
    })()
    return () => {
      vivo = false
    }
  }, [active, moduloMesas, origem])

  const urlDelivery = slug ? urlCardapio(origem, slug) : ''

  useEffect(() => {
    if (!urlDelivery) return
    let vivo = true
    QRCode.toDataURL(urlDelivery, { width: 1024, margin: 1, errorCorrectionLevel: 'M' })
      .then((d) => vivo && setQrDelivery(d))
      .catch(() => vivo && setErro('Não foi possível gerar o QR Code.'))
    return () => {
      vivo = false
    }
  }, [urlDelivery])

  const copiar = useCallback((texto: string, aoCopiar: () => void) => {
    navigator.clipboard.writeText(texto).then(aoCopiar).catch(() => {})
  }, [])

  const baixarPng = useCallback((dataUrl: string | null, nome: string) => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = nome
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, [])

  const mesasImprimiveis = useMemo(() => mesasQr.filter((m) => m.url), [mesasQr])

  /** O que vai para a janela de impressão, conforme o botão que foi tocado. */
  const pecas: PecaQr[] = useMemo(() => {
    if (!impressao) return []
    if (impressao.tipo === 'mesa') {
      const m = impressao.mesa
      return [{ id: m.id, nome: rotuloMesa(m.nome), url: m.url, qrDataUrl: m.qrDataUrl, qrPreview: m.qrPreview }]
    }
    if (impressao.tipo === 'mesas') {
      return mesasImprimiveis.map((m) => ({
        id: m.id,
        nome: rotuloMesa(m.nome),
        url: m.url,
        qrDataUrl: m.qrDataUrl,
        qrPreview: m.qrPreview,
      }))
    }
    return [{ id: 'delivery', nome: null, url: urlDelivery, qrDataUrl: qrDelivery }]
  }, [impressao, mesasImprimiveis, urlDelivery, qrDelivery])

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-3xl">
          {erro && (
            <p className="mb-5 rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{erro}</p>
          )}

          {/* ══ Mesas ═══════════════════════════════════════════════════════ */}
          {moduloMesas && (
            <section className="mb-8">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-menuzia bg-primary/10 text-primary">
                    <QrCode className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-bold text-text-main">QR das mesas · cardápio do salão</h3>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-text-subtle">
                      <strong className="text-text-main">Este é o que vai na mesa.</strong> Toque no QR de uma mesa para
                      imprimir só ela, ou use o botão ao lado para imprimir várias de uma vez.
                    </p>
                  </div>
                </div>
                <Button onClick={() => setImpressao({ tipo: 'mesas' })} disabled={mesasImprimiveis.length === 0}>
                  <Printer className="mr-1.5 inline h-3.5 w-3.5" />
                  Imprimir QR das mesas
                </Button>
              </div>

              <Card className="p-3">
                <ListaQrMesas
                  mesas={mesasQr}
                  onAbrirQr={(m) => setImpressao({ tipo: 'mesa', mesa: m })}
                  onCopiar={(m) =>
                    copiar(m.url, () => {
                      setCopiadoMesa(m.id)
                      setTimeout(() => setCopiadoMesa(null), 1500)
                    })
                  }
                  onBaixar={(m) => baixarPng(m.qrDataUrl, `qrcode-mesa-${m.nome.replace(/\W+/g, '-').toLowerCase()}.png`)}
                  copiadoId={copiadoMesa}
                />
              </Card>
            </section>
          )}

          {/* ══ Divisória ═══════════════════════════════════════════════════ */}
          {moduloMesas && (
            <div className="mb-8 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">Outro QR, outro destino</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          )}

          {/* ══ Delivery ════════════════════════════════════════════════════ */}
          <section>
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-menuzia bg-alert-bg text-alert-text">
                <Truck className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-[15px] font-bold text-text-main">
                  {moduloMesas ? 'QR do delivery · vitrine de entrega' : 'QR do cardápio'}
                </h3>
                <p className="mt-0.5 text-[12px] leading-relaxed text-text-subtle">
                  {moduloMesas ? (
                    <>
                      <strong className="text-text-main">Este NÃO vai na mesa.</strong> Abre a vitrine de entrega e
                      retirada — use no balcão, na embalagem, no cartão e nas redes sociais.
                    </>
                  ) : (
                    <>Abre o seu cardápio digital. Imprima e deixe onde o cliente vê: mesa, balcão ou vitrine.</>
                  )}
                </p>
              </div>
            </div>

            <Card>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => setImpressao({ tipo: 'delivery' })}
                  disabled={!qrDelivery}
                  title="Imprimir este QR"
                  className="flex h-[128px] w-[128px] flex-shrink-0 items-center justify-center overflow-hidden rounded-menuzia border-2 border-border bg-white p-1.5 transition-colors hover:border-primary disabled:cursor-not-allowed"
                >
                  {qrDelivery ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrDelivery} alt="QR Code do delivery" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-[11px] text-text-subtle">Gerando…</span>
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <p className="mb-2.5 truncate font-mono text-[11px] text-text-subtle" title={urlDelivery}>
                    {urlDelivery || 'Carregando…'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setImpressao({ tipo: 'delivery' })} disabled={!qrDelivery}>
                      <Printer className="mr-1.5 inline h-3.5 w-3.5" />
                      Imprimir
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        copiar(urlDelivery, () => {
                          setCopiadoDelivery(true)
                          setTimeout(() => setCopiadoDelivery(false), 1500)
                        })
                      }
                      disabled={!urlDelivery}
                    >
                      {copiadoDelivery ? (
                        <><Check className="mr-1.5 inline h-3.5 w-3.5 text-status-ready" /> Copiado</>
                      ) : (
                        <><Copy className="mr-1.5 inline h-3.5 w-3.5" /> Copiar link</>
                      )}
                    </Button>
                    <Button variant="outline" onClick={() => baixarPng(qrDelivery, nomeArquivoQr(slug))} disabled={!qrDelivery}>
                      <Download className="mr-1.5 inline h-3.5 w-3.5" /> Baixar PNG
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </section>
        </div>
      </div>

      {impressao && (
        <ModalImpressaoQr
          key={impressao.tipo === 'mesa' ? impressao.mesa.id : impressao.tipo}
          titulo={
            impressao.tipo === 'mesa'
              ? `Imprimir o QR da ${rotuloMesa(impressao.mesa.nome)}`
              : impressao.tipo === 'mesas'
                ? 'Imprimir o QR das mesas'
                : 'Imprimir o QR do delivery'
          }
          subtitulo={
            impressao.tipo === 'delivery'
              ? 'Abre a vitrine de entrega — não é o QR da mesa.'
              : 'Cada etiqueta sai com o QR da mesa dela.'
          }
          pecas={pecas}
          comSelecao={impressao.tipo === 'mesas'}
          destino={impressao.tipo === 'delivery' ? 'delivery' : 'mesa'}
          nomeLoja={nomeLoja}
          logoUrl={logoUrl}
          fraseInicial={impressao.tipo === 'delivery' ? FRASE_DELIVERY : FRASE_MESA}
          modeloInicial={impressao.tipo === 'delivery' ? 'adesivo' : 'cartao'}
          onFechar={() => setImpressao(null)}
        />
      )}
    </div>
  )
}
