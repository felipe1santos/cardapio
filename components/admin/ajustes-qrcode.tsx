'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { Check, Copy, Download, Printer, QrCode, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FolhaQr } from '@/components/admin/qr-cardapio-folha'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { urlPublicaDaMesa } from '@/lib/queries/mesas'
import { ListaQrMesas, type MesaComQr } from '@/components/admin/qr-mesas-lista'
import {
  LIMITES_TAMANHO,
  MAX_ETIQUETAS,
  MODELOS_ETIQUETA,
  comTamanhoQr,
  descricaoDoModelo,
  modeloEtiqueta,
  montarEtiquetas,
  nomeArquivoQr,
  paginarEtiquetas,
  rotuloMesa,
  tamanhoQrValido,
  urlCardapio,
  type Etiqueta,
  type ModeloEtiqueta,
  type ModeloInfo,
} from '@/lib/qr-cardapio'

/**
 * Aba QR Code — duas folhas, lado a lado com a configuração de cada uma.
 *
 * A tela antiga misturava as duas coisas: a lista das mesas em cima (só links,
 * sem imagem) e, embaixo, UMA folha imprimível — a do delivery, descrita como
 * "para colar no tampo da mesa". O lojista imprimia aquela, colava na mesa, e o
 * cliente caía na vitrine de entrega.
 *
 * Agora cada destino é um bloco fechado, com a mesma anatomia: o QR à vista à
 * esquerda, a folha à direita, e um botão de imprimir dentro do próprio bloco.
 * Quem lê a tela não tem como confundir qual folha vai para a mesa.
 */

const FRASE_MESA = 'Aponte a câmera e veja o cardápio desta mesa'
const FRASE_DELIVERY = 'Aponte a câmera do celular e peça pelo cardápio digital'
/** Enquanto a folha está montada, o print esconde o resto do painel (ver globals.css). */
const CLASSE_PRINT = 'imprimindo-qr'
const ESCALA_PREVIEW = 0.45

type Destino = 'mesa' | 'delivery'

interface PreferenciasFolha {
  modelo: ModeloEtiqueta
  tamanho: number
  frase: string
  titulo: string
  quantidade: number
  usarLogo: boolean
}

function chavePreferencias(restauranteId: string, destino: Destino) {
  return `menuzia:qr-${destino}:${restauranteId}`
}

function lerPreferencias(restauranteId: string, destino: Destino): Partial<PreferenciasFolha> {
  try {
    const raw = localStorage.getItem(chavePreferencias(restauranteId, destino))
    return raw ? (JSON.parse(raw) as Partial<PreferenciasFolha>) : {}
  } catch {
    return {}
  }
}

/** Estado de uma folha: modelo, tamanho do QR, textos e quantidade. */
function useFolha(restauranteId: string, destino: Destino, tituloInicial: string, fraseInicial: string) {
  const [modelo, setModelo] = useState<ModeloEtiqueta>(destino === 'mesa' ? 'cartao' : 'adesivo')
  const [tamanho, setTamanho] = useState<number>(() => modeloEtiqueta(destino === 'mesa' ? 'cartao' : 'adesivo').qrMm)
  const [titulo, setTitulo] = useState(tituloInicial)
  const [frase, setFrase] = useState(fraseInicial)
  const [quantidade, setQuantidade] = useState(destino === 'mesa' ? 1 : 4)
  const [usarLogo, setUsarLogo] = useState(true)
  const [carregou, setCarregou] = useState(false)

  const restaurar = useCallback(
    (tituloPadrao: string) => {
      const p = lerPreferencias(restauranteId, destino)
      const m = p.modelo ?? (destino === 'mesa' ? 'cartao' : 'adesivo')
      setModelo(m)
      setTamanho(tamanhoQrValido(m, p.tamanho ?? modeloEtiqueta(m).qrMm))
      setTitulo(p.titulo ?? tituloPadrao)
      if (p.frase) setFrase(p.frase)
      if (p.quantidade) setQuantidade(p.quantidade)
      if (p.usarLogo !== undefined) setUsarLogo(p.usarLogo)
      setCarregou(true)
    },
    [restauranteId, destino],
  )

  useEffect(() => {
    if (!carregou) return
    try {
      localStorage.setItem(
        chavePreferencias(restauranteId, destino),
        JSON.stringify({ modelo, tamanho, frase, titulo, quantidade, usarLogo } satisfies PreferenciasFolha),
      )
    } catch {
      /* sem localStorage (aba anônima): a preferência só não persiste */
    }
  }, [carregou, restauranteId, destino, modelo, tamanho, frase, titulo, quantidade, usarLogo])

  /** Trocar de modelo leva o tamanho para o padrão dele — 110 mm num adesivo não cabe. */
  const trocarModelo = useCallback((novo: ModeloEtiqueta) => {
    setModelo(novo)
    setTamanho(modeloEtiqueta(novo).qrMm)
  }, [])

  const info: ModeloInfo = useMemo(() => comTamanhoQr(modeloEtiqueta(modelo), tamanho), [modelo, tamanho])

  return {
    modelo, trocarModelo,
    tamanho, setTamanho,
    titulo, setTitulo,
    frase, setFrase,
    quantidade, setQuantidade,
    usarLogo, setUsarLogo,
    restaurar, info,
  }
}

type Folha = ReturnType<typeof useFolha>

/** Escolha do modelo + ajuste fino do tamanho do QR, em mm. */
function ConfigFolha({ folha, destino }: { folha: Folha; destino: Destino }) {
  const limites = LIMITES_TAMANHO[folha.modelo]
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {MODELOS_ETIQUETA.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => folha.trocarModelo(m.id)}
            className={[
              'flex w-full items-start gap-3 rounded-menuzia border p-3 text-left transition-colors',
              folha.modelo === m.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
            ].join(' ')}
          >
            <span
              className={[
                'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border',
                folha.modelo === m.id ? 'border-primary' : 'border-border',
              ].join(' ')}
            >
              {folha.modelo === m.id && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-text-main">{m.label}</span>
              <span className="block text-[11px] leading-relaxed text-text-subtle">{descricaoDoModelo(m, destino)}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Tamanho do QR impresso: quem cola na mesa sabe se precisa de maior. */}
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
          Tamanho do QR impresso
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => folha.setTamanho(tamanhoQrValido(folha.modelo, folha.tamanho - limites.passo))}
            disabled={folha.tamanho <= limites.min}
            aria-label="Diminuir o QR"
            className="toque-icone flex h-[38px] w-[38px] items-center justify-center rounded-menuzia border border-border text-[18px] font-bold text-text-subtle transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
          >
            −
          </button>
          <div className="min-w-[86px] text-center">
            <span className="text-[18px] font-bold tabular-nums text-text-main">{folha.tamanho}</span>
            <span className="ml-1 text-[12px] text-text-subtle">mm</span>
          </div>
          <button
            type="button"
            onClick={() => folha.setTamanho(tamanhoQrValido(folha.modelo, folha.tamanho + limites.passo))}
            disabled={folha.tamanho >= limites.max}
            aria-label="Aumentar o QR"
            className="toque-icone flex h-[38px] w-[38px] items-center justify-center rounded-menuzia border border-border text-[18px] font-bold text-text-subtle transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
          >
            +
          </button>
          <input
            type="range"
            min={limites.min}
            max={limites.max}
            step={limites.passo}
            value={folha.tamanho}
            onChange={(e) => folha.setTamanho(tamanhoQrValido(folha.modelo, Number(e.target.value)))}
            aria-label="Tamanho do QR em milímetros"
            className="h-1 flex-1 cursor-pointer accent-primary"
          />
        </div>
        <p className="mt-1.5 text-[11px] text-text-subtle">
          De {limites.min} a {limites.max} mm neste modelo. O tamanho vale para a folha impressa.
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Título</label>
        <input
          value={folha.titulo}
          onChange={(e) => folha.setTitulo(e.target.value)}
          maxLength={40}
          className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none transition-colors focus:border-primary"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
          Frase de instrução
        </label>
        <input
          value={folha.frase}
          onChange={(e) => folha.setFrase(e.target.value)}
          maxLength={70}
          className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none transition-colors focus:border-primary"
        />
      </div>

      <label className="flex items-center gap-2 text-[13px] text-text-main">
        <input
          type="checkbox"
          checked={folha.usarLogo}
          onChange={(e) => folha.setUsarLogo(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Imprimir a logo da loja acima do título
      </label>
    </div>
  )
}

/** Pré-visualização da folha, do lado direito de cada bloco. */
function Previa({
  paginas,
  info,
  titulo,
  frase,
  url,
  qrDataUrl,
  logoUrl,
  vazio,
}: {
  paginas: Etiqueta[][]
  info: ModeloInfo
  titulo: string
  frase: string
  url: string
  qrDataUrl: string | null
  logoUrl: string | null
  vazio: string
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pré-visualização</span>
        <span className="text-[11px] text-text-subtle">
          A4 · {info.label} · {info.qrMm} mm · {paginas.length} {paginas.length === 1 ? 'folha' : 'folhas'}
        </span>
      </div>
      <div className="max-h-[70vh] overflow-y-auto rounded-menuzia border border-border bg-page p-4">
        {paginas.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-text-subtle">{vazio}</p>
        ) : (
          <FolhaQr
            paginas={paginas}
            modelo={info}
            titulo={titulo}
            frase={frase}
            url={url}
            qrDataUrl={qrDataUrl}
            logoUrl={logoUrl}
            escala={ESCALA_PREVIEW}
          />
        )}
      </div>
    </div>
  )
}

interface TokenQr {
  id: string
  nome: string
  setor: string | null
  ativa: boolean
  token: string | null
  qrRevogado: boolean
}

export function TabQrCode({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [slug, setSlug] = useState('')
  const [nomeLoja, setNomeLoja] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [moduloMesas, setModuloMesas] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [origem, setOrigem] = useState('')

  // ── Delivery ──────────────────────────────────────────────────────────────
  const folhaDelivery = useFolha(restauranteId, 'delivery', '', FRASE_DELIVERY)
  const [qrDelivery, setQrDelivery] = useState<string | null>(null)
  const [copiadoDelivery, setCopiadoDelivery] = useState(false)

  // ── Mesas ─────────────────────────────────────────────────────────────────
  const folhaMesas = useFolha(restauranteId, 'mesa', '', FRASE_MESA)
  const [mesasQr, setMesasQr] = useState<MesaComQr[]>([])
  const [selecionadas, setSelecionadas] = useState<string[]>([])
  const [copiadoMesa, setCopiadoMesa] = useState<string | null>(null)

  /** Qual folha está indo para a impressora agora (o portal só monta uma). */
  const [imprimindo, setImprimindo] = useState<Destino | null>(null)

  useEffect(() => {
    setOrigem(window.location.origin)
  }, [])

  // `restaurar` é estável (useCallback com restauranteId/destino), então dá para
  // depender dela em vez do objeto inteiro da folha — que muda a cada render.
  const restaurarDelivery = folhaDelivery.restaurar
  const restaurarMesas = folhaMesas.restaurar

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
        restaurarDelivery(config.nome)
        restaurarMesas(config.nome)
        setLoaded(true)
      } catch {
        if (vivo) setErro('Não foi possível carregar os dados da loja.')
      }
    })()
    return () => {
      vivo = false
    }
  }, [active, loaded, supabase, restauranteId, restaurarDelivery, restaurarMesas])

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
      const ativas = (corpo.mesas ?? []).filter((m) => m.ativa)
      const comQr = await Promise.all(
        ativas.map(async (m) => {
          const url = m.token ? urlPublicaDaMesa(origem, m.token) : ''
          const qrDataUrl = url
            ? await QRCode.toDataURL(url, { width: 1024, margin: 1, errorCorrectionLevel: 'M' }).catch(() => null)
            : null
          return { id: m.id, nome: m.nome, setor: m.setor, url, qrDataUrl, qrRevogado: m.qrRevogado }
        }),
      )
      if (!vivo) return
      setMesasQr(comQr)
      setSelecionadas(comQr.filter((m) => m.url).map((m) => m.id))
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

  // ── Folhas ────────────────────────────────────────────────────────────────
  const etiquetasDelivery = useMemo(
    () => montarEtiquetas({ mesas: [], quantidade: folhaDelivery.quantidade }),
    [folhaDelivery.quantidade],
  )
  const paginasDelivery = useMemo(
    () => paginarEtiquetas(etiquetasDelivery, folhaDelivery.info.porPagina),
    [etiquetasDelivery, folhaDelivery.info.porPagina],
  )

  /** Cada mesa entra na folha com o QR DELA — é isso que difere das etiquetas do delivery. */
  const etiquetasMesas = useMemo(() => {
    const escolhidas = mesasQr.filter((m) => selecionadas.includes(m.id) && m.url)
    const copias = Math.max(1, folhaMesas.quantidade)
    const lista: Etiqueta[] = []
    for (const m of escolhidas) {
      for (let i = 0; i < copias; i++) {
        lista.push({ id: `${m.id}-${i}`, mesa: rotuloMesa(m.nome), qrDataUrl: m.qrDataUrl, url: m.url })
      }
    }
    return lista.slice(0, MAX_ETIQUETAS)
  }, [mesasQr, selecionadas, folhaMesas.quantidade])
  const paginasMesas = useMemo(
    () => paginarEtiquetas(etiquetasMesas, folhaMesas.info.porPagina),
    [etiquetasMesas, folhaMesas.info.porPagina],
  )

  // Imprime a folha escolhida: o portal monta só ela, então o print sai limpo.
  useEffect(() => {
    if (!imprimindo) return
    const limpar = () => {
      document.body.classList.remove(CLASSE_PRINT)
      setImprimindo(null)
    }
    document.body.classList.add(CLASSE_PRINT)
    window.addEventListener('afterprint', limpar, { once: true })
    // Um quadro para o portal montar a folha certa antes de abrir a caixa de impressão.
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

  const alvo = imprimindo === 'mesa' ? 'mesa' : 'delivery'
  const folhaImpressa = alvo === 'mesa' ? folhaMesas : folhaDelivery
  const paginasImpressas = alvo === 'mesa' ? paginasMesas : paginasDelivery

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        {erro && (
          <p className="mb-5 rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{erro}</p>
        )}

        {/* ══ Bloco 1 · Mesas ══════════════════════════════════════════════ */}
        {moduloMesas && (
          <section className="mb-8">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-menuzia bg-primary/10 text-primary">
                <QrCode className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-[15px] font-bold text-text-main">QR das mesas · cardápio do salão</h3>
                <p className="mt-0.5 text-[12px] leading-relaxed text-text-subtle">
                  <strong className="text-text-main">Este é o que vai na mesa.</strong> Cada mesa tem o QR dela: o
                  cliente escaneia, vê o cardápio e mostra a escolha ao garçom. Nada vai para a cozinha sem o garçom
                  lançar.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-start gap-6">
              <div className="w-full max-w-xl space-y-5">
                <Card className="space-y-4">
                  <h4 className="text-[13px] font-bold text-text-main">Mesas e seus QR Codes</h4>
                  <ListaQrMesas
                    mesas={mesasQr}
                    selecionadas={selecionadas}
                    onAlternar={(id) =>
                      setSelecionadas((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
                    }
                    onTodas={() => setSelecionadas(mesasQr.filter((m) => m.url).map((m) => m.id))}
                    onNenhuma={() => setSelecionadas([])}
                    onCopiar={(m) => copiar(m.url, () => {
                      setCopiadoMesa(m.id)
                      setTimeout(() => setCopiadoMesa(null), 1500)
                    })}
                    onBaixar={(m) => baixarPng(m.qrDataUrl, `qrcode-mesa-${m.nome.replace(/\W+/g, '-').toLowerCase()}.png`)}
                    copiadoId={copiadoMesa}
                  />
                </Card>

                <Card className="space-y-4">
                  <h4 className="text-[13px] font-bold text-text-main">Como imprimir</h4>
                  <ConfigFolha folha={folhaMesas} destino="mesa" />
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                      Cópias de cada mesa
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={folhaMesas.quantidade}
                      onChange={(e) => folhaMesas.setQuantidade(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                      className="w-28 rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none transition-colors focus:border-primary"
                    />
                    <p className="mt-1.5 text-[11px] text-text-subtle">
                      {etiquetasMesas.length} {etiquetasMesas.length === 1 ? 'etiqueta' : 'etiquetas'} ·{' '}
                      {paginasMesas.length} {paginasMesas.length === 1 ? 'folha A4' : 'folhas A4'}
                    </p>
                  </div>
                  <Button onClick={() => setImprimindo('mesa')} disabled={paginasMesas.length === 0} className="w-full">
                    <Printer className="mr-1.5 inline h-3.5 w-3.5" />
                    Imprimir folha das mesas
                  </Button>
                </Card>
              </div>

              <Previa
                paginas={paginasMesas}
                info={folhaMesas.info}
                titulo={folhaMesas.titulo || nomeLoja}
                frase={folhaMesas.frase || FRASE_MESA}
                url=""
                qrDataUrl={null}
                logoUrl={folhaMesas.usarLogo ? logoUrl : null}
                vazio="Escolha ao menos uma mesa para montar a folha."
              />
            </div>
          </section>
        )}

        {/* ══ Divisória ════════════════════════════════════════════════════ */}
        {moduloMesas && (
          <div className="mb-8 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">Outro QR, outro destino</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}

        {/* ══ Bloco 2 · Delivery ═══════════════════════════════════════════ */}
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
                    <strong className="text-text-main">Este NÃO vai na mesa.</strong> Ele abre a vitrine de entrega e
                    retirada — use no balcão, na embalagem, no cartão e nas redes sociais.
                  </>
                ) : (
                  <>Abre o seu cardápio digital. Imprima e deixe onde o cliente vê: mesa, balcão ou vitrine.</>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-6">
            <div className="w-full max-w-xl space-y-5">
              <Card className="space-y-4">
                <h4 className="text-[13px] font-bold text-text-main">O seu QR</h4>
                <div className="flex items-center gap-4">
                  <div className="flex h-[112px] w-[112px] flex-shrink-0 items-center justify-center overflow-hidden rounded-menuzia border-2 border-border bg-white p-1">
                    {qrDelivery ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrDelivery} alt="QR Code do delivery" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-[11px] text-text-subtle">Gerando…</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-2 truncate font-mono text-[11px] text-text-subtle" title={urlDelivery}>
                      {urlDelivery || 'Carregando…'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => copiar(urlDelivery, () => {
                          setCopiadoDelivery(true)
                          setTimeout(() => setCopiadoDelivery(false), 1500)
                        })}
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

              <Card className="space-y-4">
                <h4 className="text-[13px] font-bold text-text-main">Como imprimir</h4>
                {moduloMesas && (
                  <p className="rounded-menuzia border border-warn bg-warn-bg px-3 py-2 text-[11px] font-semibold leading-relaxed text-warn">
                    Esta folha é do delivery — não cole nas mesas. Para as mesas, use a folha do bloco acima.
                  </p>
                )}
                <ConfigFolha folha={folhaDelivery} destino="delivery" />
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                    Quantidade de etiquetas
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={MAX_ETIQUETAS}
                    value={folhaDelivery.quantidade}
                    onChange={(e) =>
                      folhaDelivery.setQuantidade(Math.max(1, Math.min(MAX_ETIQUETAS, Number(e.target.value) || 1)))
                    }
                    className="w-28 rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none transition-colors focus:border-primary"
                  />
                  <p className="mt-1.5 text-[11px] text-text-subtle">
                    {etiquetasDelivery.length} {etiquetasDelivery.length === 1 ? 'etiqueta' : 'etiquetas'} ·{' '}
                    {paginasDelivery.length} {paginasDelivery.length === 1 ? 'folha A4' : 'folhas A4'}
                  </p>
                </div>
                <Button onClick={() => setImprimindo('delivery')} disabled={paginasDelivery.length === 0} className="w-full">
                  <Printer className="mr-1.5 inline h-3.5 w-3.5" />
                  Imprimir folha do delivery
                </Button>
              </Card>
            </div>

            <Previa
              paginas={paginasDelivery}
              info={folhaDelivery.info}
              titulo={folhaDelivery.titulo || nomeLoja}
              frase={folhaDelivery.frase || FRASE_DELIVERY}
              url={urlDelivery}
              qrDataUrl={qrDelivery}
              logoUrl={folhaDelivery.usarLogo ? logoUrl : null}
              vazio="Nenhuma etiqueta para imprimir."
            />
          </div>
        </section>
      </div>

      {/* A folha real vive fora do layout do painel (que tem overflow hidden e
          cortaria a impressão) — daí o portal direto no <body>. Só a folha que
          está sendo impressa é montada, para não sair a outra junto. */}
      {imprimindo &&
        typeof document !== 'undefined' &&
        createPortal(
          <div id="qr-print-root" className="hidden">
            <FolhaQr
              paginas={paginasImpressas}
              modelo={folhaImpressa.info}
              titulo={folhaImpressa.titulo || nomeLoja}
              frase={folhaImpressa.frase || (alvo === 'mesa' ? FRASE_MESA : FRASE_DELIVERY)}
              url={alvo === 'mesa' ? '' : urlDelivery}
              qrDataUrl={alvo === 'mesa' ? null : qrDelivery}
              logoUrl={folhaImpressa.usarLogo ? logoUrl : null}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
