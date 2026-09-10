'use client'

import { rotuloMesa, type Etiqueta, type ModeloInfo } from '@/lib/qr-cardapio'

export interface FolhaQrProps {
  /** Etiquetas já paginadas (uma lista por folha A4). */
  paginas: Etiqueta[][]
  modelo: ModeloInfo
  /** Chamada principal — normalmente o nome da loja. */
  titulo: string
  /** Frase de instrução impressa abaixo do QR. */
  frase: string
  /** URL do cardápio, impressa como texto (plano B se a câmera falhar). */
  url: string
  /** PNG do QR já gerado (data URL). */
  qrDataUrl: string | null
  logoUrl?: string | null
  /** 1 = tamanho real (impressão). Menor = pré-visualização na tela. */
  escala?: number
}

/** Medidas tipográficas por modelo — em pt, pra sair igual no papel. */
const ESTILO_MODELO: Record<string, { titulo: number; mesa: number; frase: number; url: number; gapMm: number }> = {
  adesivo: { titulo: 11, mesa: 9, frase: 7.5, url: 6.5, gapMm: 2 },
  cartao: { titulo: 15, mesa: 11, frase: 9.5, url: 8, gapMm: 3.5 },
  cartaz: { titulo: 26, mesa: 16, frase: 14, url: 11, gapMm: 6 },
}

const MARGEM_MM = 10

function EtiquetaCard({
  etiqueta,
  modelo,
  titulo,
  frase,
  url,
  qrDataUrl,
  logoUrl,
}: {
  etiqueta: Etiqueta
  modelo: ModeloInfo
  titulo: string
  frase: string
  url: string
  qrDataUrl: string | null
  logoUrl?: string | null
}) {
  const e = ESTILO_MODELO[modelo.id] ?? ESTILO_MODELO.adesivo
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center overflow-hidden border border-dashed border-[#D1D5DB] text-center"
      style={{ padding: `${e.gapMm}mm`, gap: `${e.gapMm}mm`, breakInside: 'avoid' }}
    >
      <div className="flex flex-col items-center" style={{ gap: `${e.gapMm * 0.5}mm` }}>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            style={{ height: `${modelo.qrMm * 0.22}mm`, objectFit: 'contain' }}
          />
        )}
        <span
          className="font-bold uppercase leading-tight tracking-wide text-[#1F2937]"
          style={{ fontSize: `${e.titulo}pt` }}
        >
          {titulo}
        </span>
        {etiqueta.mesa && (
          <span
            className="rounded-menuzia bg-[#111827] px-2 py-[1px] font-semibold uppercase tracking-wide text-white"
            style={{ fontSize: `${e.mesa}pt` }}
          >
            {rotuloMesa(etiqueta.mesa)}
          </span>
        )}
      </div>

      {qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={qrDataUrl}
          alt={`QR Code do cardápio${etiqueta.mesa ? ` — ${rotuloMesa(etiqueta.mesa)}` : ''}`}
          style={{ width: `${modelo.qrMm}mm`, height: `${modelo.qrMm}mm` }}
        />
      ) : (
        <div
          className="flex items-center justify-center border border-[#E5E7EB] bg-[#F3F4F6] text-[#6B7280]"
          style={{ width: `${modelo.qrMm}mm`, height: `${modelo.qrMm}mm`, fontSize: `${e.url}pt` }}
        >
          Gerando…
        </div>
      )}

      <div className="flex flex-col items-center" style={{ gap: `${e.gapMm * 0.35}mm` }}>
        <span className="font-semibold leading-snug text-[#1F2937]" style={{ fontSize: `${e.frase}pt` }}>
          {frase}
        </span>
        <span className="leading-snug text-[#6B7280]" style={{ fontSize: `${e.url}pt` }}>
          {url}
        </span>
      </div>
    </div>
  )
}

function Pagina({
  etiquetas,
  modelo,
  escala,
  ultima,
  children,
}: {
  etiquetas: Etiqueta[]
  modelo: ModeloInfo
  escala: number
  ultima: boolean
  children: (etiqueta: Etiqueta) => React.ReactNode
}) {
  const linhas = Math.ceil(modelo.porPagina / modelo.colunas)
  const pagina = (
    <div
      className="bg-white"
      style={{
        width: '210mm',
        height: '297mm',
        padding: `${MARGEM_MM}mm`,
        display: 'grid',
        gridTemplateColumns: `repeat(${modelo.colunas}, 1fr)`,
        gridTemplateRows: `repeat(${linhas}, 1fr)`,
        breakAfter: ultima ? 'auto' : 'page',
        boxSizing: 'border-box',
      }}
    >
      {etiquetas.map((etiqueta) => (
        <div key={etiqueta.id} className="min-h-0 min-w-0">
          {children(etiqueta)}
        </div>
      ))}
    </div>
  )

  if (escala === 1) return pagina

  // Pré-visualização: a folha continua com as medidas reais (mm) e é reduzida
  // por transform — o wrapper reserva só a altura já escalada.
  return (
    <div
      className="overflow-hidden border border-border shadow-sm"
      style={{ width: `${210 * escala}mm`, height: `${297 * escala}mm` }}
    >
      <div style={{ transform: `scale(${escala})`, transformOrigin: 'top left' }}>{pagina}</div>
    </div>
  )
}

/**
 * Folha A4 de etiquetas de QR Code do cardápio.
 *
 * O mesmo componente desenha a pré-visualização (escala < 1) e o que vai pra
 * impressora (escala 1, montado em um portal fora do layout do painel) — assim
 * o que o dono vê é exatamente o que sai no papel.
 */
export function FolhaQr({
  paginas,
  modelo,
  titulo,
  frase,
  url,
  qrDataUrl,
  logoUrl,
  escala = 1,
}: FolhaQrProps) {
  return (
    <div className="flex flex-col items-center gap-4 print:block print:gap-0">
      {paginas.map((etiquetas, i) => (
        <Pagina key={i} etiquetas={etiquetas} modelo={modelo} escala={escala} ultima={i === paginas.length - 1}>
          {(etiqueta) => (
            <EtiquetaCard
              etiqueta={etiqueta}
              modelo={modelo}
              titulo={titulo}
              frase={frase}
              url={url}
              qrDataUrl={qrDataUrl}
              logoUrl={logoUrl}
            />
          )}
        </Pagina>
      ))}
    </div>
  )
}
