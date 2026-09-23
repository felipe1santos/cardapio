'use client'

import { Check, Copy, Download, ExternalLink } from 'lucide-react'
import { rotuloMesa } from '@/lib/qr-cardapio'

/** Uma mesa já com o link e o QR prontos para a tela. */
export interface MesaComQr {
  id: string
  nome: string
  setor: string | null
  /** `/mesa/<token>` já com a origem. Vazio quando o QR foi revogado. */
  url: string
  /** PNG do QR (data URL). Null enquanto gera. */
  qrDataUrl: string | null
  qrRevogado: boolean
}

/**
 * Lista das mesas com o QR à vista.
 *
 * Antes daqui só saía o link em texto, e o dono não tinha como conferir se
 * aquele QR era mesmo o da mesa dele sem baixar o PNG. Ver a imagem ao lado do
 * nome é o que torna a tela óbvia para quem não é técnico — e é o mesmo QR que
 * vai para a folha impressa.
 */
export function ListaQrMesas({
  mesas,
  onAbrirQr,
  onCopiar,
  onBaixar,
  copiadoId,
}: {
  mesas: MesaComQr[]
  /** Tocar no QR abre a janela de impressão daquela mesa. */
  onAbrirQr: (mesa: MesaComQr) => void
  onCopiar: (mesa: MesaComQr) => void
  onBaixar: (mesa: MesaComQr) => void
  copiadoId: string | null
}) {
  if (mesas.length === 0) {
    return (
      <p className="rounded-menuzia border border-dashed border-border px-3 py-6 text-center text-[12px] text-text-subtle">
        Nenhuma mesa cadastrada ainda. Cadastre em <strong>Mesas e Comandas</strong> para cada uma ganhar o seu QR.
      </p>
    )
  }

  return (
    <div>
      <ul className="divide-y divide-border overflow-hidden rounded-menuzia border border-border bg-white">
        {mesas.map((m) => {
          return (
            <li key={m.id} className="flex items-center gap-3 p-2.5">
              {/* A miniatura é o próprio QR da mesa: dá para conferir na tela e
                  até escanear daqui, sem imprimir nada. */}
              <button
                type="button"
                onClick={() => m.url && onAbrirQr(m)}
                disabled={!m.url}
                title={m.url ? `Imprimir o QR da ${rotuloMesa(m.nome)}` : 'QR revogado'}
                aria-label={m.url ? `Imprimir o QR da ${rotuloMesa(m.nome)}` : 'QR revogado'}
                className={[
                  'flex h-[62px] w-[62px] flex-shrink-0 items-center justify-center overflow-hidden rounded-menuzia border-2 border-border bg-white transition-colors',
                  m.url ? 'hover:border-primary' : 'cursor-not-allowed opacity-50',
                ].join(' ')}
              >
                {m.qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.qrDataUrl} alt={`QR da ${rotuloMesa(m.nome)}`} className="h-full w-full object-contain p-0.5" />
                ) : (
                  <span className="text-[10px] text-text-subtle">…</span>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-text-main">{rotuloMesa(m.nome)}</span>
                  {m.setor && <span className="text-[11px] text-text-subtle">{m.setor}</span>}
                  {m.qrRevogado && (
                    <span className="rounded-menuzia bg-danger-bg px-1.5 py-0.5 text-[10px] font-bold uppercase text-danger">
                      QR revogado
                    </span>
                  )}
                </div>
                <p className="truncate font-mono text-[11px] text-text-subtle" title={m.url}>
                  {m.url || 'Gere um QR novo em Mesas e Comandas'}
                </p>
              </div>

              {m.url && (
                <div className="flex flex-shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onCopiar(m)}
                    title="Copiar link"
                    aria-label={`Copiar link da ${rotuloMesa(m.nome)}`}
                    className="toque-icone flex h-[32px] w-[32px] items-center justify-center rounded-menuzia border border-border text-text-subtle transition-colors hover:border-primary hover:text-primary"
                  >
                    {copiadoId === m.id ? <Check className="h-3.5 w-3.5 text-status-ready" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir o cardápio desta mesa"
                    aria-label={`Abrir o cardápio da ${rotuloMesa(m.nome)}`}
                    className="toque-icone flex h-[32px] w-[32px] items-center justify-center rounded-menuzia border border-border text-text-subtle transition-colors hover:border-primary hover:text-primary"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => onBaixar(m)}
                    title="Baixar o QR em PNG"
                    aria-label={`Baixar o QR da ${rotuloMesa(m.nome)}`}
                    className="toque-icone flex h-[32px] w-[32px] items-center justify-center rounded-menuzia border border-border text-text-subtle transition-colors hover:border-primary hover:text-primary"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
