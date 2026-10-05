'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2, X } from 'lucide-react'

/**
 * Tela "Pague com Pix" (Pix online, 0148) — feita para o celular: QR grande, "Copiar código Pix",
 * contador regressivo e detecção automática do pagamento (consulta a cada 3 s, sem recarregar).
 * A confirmação vem SEMPRE do servidor, que confere na API do Mercado Pago.
 */
export interface PixAguardando {
  id: string; numero: number; valor: number; qrCode: string | null; qrCodeBase64: string | null; expiraEm: string
}
type Situacao = 'aguardando' | 'pago' | 'expirado' | 'pago_apos_cancelado'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function TelaPixOnline({ slug, pix, onPago, onRefazer, onFechar }: {
  slug: string; pix: PixAguardando; onPago: () => void; onRefazer: () => void; onFechar: () => void
}) {
  const [situacao, setSituacao] = useState<Situacao>('aguardando')
  const [qr, setQr] = useState({ codigo: pix.qrCode, imagem: pix.qrCodeBase64 })
  const [copiado, setCopiado] = useState(false)
  const [agora, setAgora] = useState(() => Date.now())
  const avisou = useRef(false)
  const expira = new Date(pix.expiraEm).getTime()
  const restante = Math.max(0, Math.floor((expira - agora) / 1000))

  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t) }, [])

  useEffect(() => {
    if (situacao !== 'aguardando') return
    let vivo = true
    const ler = async () => {
      try {
        const r = await fetch(`/api/loja/${slug}/pedido/${pix.id}/pix`, { cache: 'no-store' })
        if (!r.ok || !vivo) return
        const j = (await r.json()) as { situacao: Situacao; qrCode: string | null; qrCodeBase64: string | null }
        if (j.qrCode) setQr({ codigo: j.qrCode, imagem: j.qrCodeBase64 })
        setSituacao(j.situacao)
      } catch { /* rede do celular: tenta de novo em 3 s */ }
    }
    void ler()
    const t = setInterval(() => void ler(), 3000)
    const voltou = () => { if (document.visibilityState === 'visible') void ler() }
    document.addEventListener('visibilitychange', voltou)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', voltou) }
  }, [slug, pix.id, situacao])

  useEffect(() => {
    if (situacao === 'pago' && !avisou.current) { avisou.current = true; const t = setTimeout(onPago, 1200); return () => clearTimeout(t) }
  }, [situacao, onPago])

  const copiar = async () => {
    if (!qr.codigo) return
    try { await navigator.clipboard.writeText(qr.codigo) } catch {
      const ta = document.createElement('textarea'); ta.value = qr.codigo; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
    }
    setCopiado(true); setTimeout(() => setCopiado(false), 2500)
  }

  const mm = String(Math.floor(restante / 60)).padStart(2, '0')
  const ss = String(restante % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-[96] flex flex-col bg-[var(--v-fundo,#F8FAFC)] font-vitrine" role="dialog" aria-modal="true" aria-label="Pagamento com Pix" data-testid="tela-pix-online">
      <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-white px-[16px] py-[12px]">
        <p className="text-[16px] font-semibold text-[#1F1F1F]">Pague com Pix</p>
        {situacao !== 'aguardando' && (
          <button type="button" onClick={onFechar} aria-label="Fechar" className="grid h-[40px] w-[40px] place-items-center rounded-full hover:bg-[#F3F4F6]"><X className="h-[20px] w-[20px]" /></button>
        )}
      </div>
      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col items-center overflow-y-auto px-[16px] py-[20px] text-center">
        {situacao === 'aguardando' && (
          <>
            <p className="text-[14px] text-[#5C5C5C]">Pedido #{pix.numero}</p>
            <p className="mt-[2px] text-[28px] font-bold text-[#1F1F1F]" data-testid="pix-valor">{brl(pix.valor)}</p>
            <p className={`mt-[6px] text-[14px] font-semibold ${restante <= 60 ? 'text-[#B91C1C]' : 'text-[#3D3D3D]'}`} data-testid="pix-contador" aria-live="polite">
              {restante > 0 ? `Pague em até ${mm}:${ss}` : 'Tempo esgotado — conferindo…'}
            </p>
            {qr.imagem && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:image/png;base64,${qr.imagem}`} alt="QR Code do Pix" className="mt-[16px] h-[240px] w-[240px] rounded-[8px] border border-[#E5E7EB] bg-white p-[8px]" data-testid="pix-qr" />
            )}
            <button type="button" onClick={() => void copiar()} disabled={!qr.codigo}
              className="mt-[16px] flex h-[52px] w-full items-center justify-center gap-[8px] rounded-[8px] bg-[#16884D] text-[16px] font-semibold text-white active:scale-[0.99] disabled:opacity-60" data-testid="pix-copiar">
              {copiado ? <><Check className="h-[20px] w-[20px]" /> Código copiado</> : <><Copy className="h-[20px] w-[20px]" /> Copiar código Pix</>}
            </button>
            <ol className="mt-[16px] w-full space-y-[6px] text-left text-[13px] leading-[18px] text-[#3D3D3D]">
              <li>1. Abra o app do seu banco e escolha <b>Pix › Copia e cola</b> (ou leia o QR).</li>
              <li>2. Cole o código e confirme o pagamento.</li>
              <li>3. Pronto: esta tela muda sozinha quando o pagamento cair.</li>
            </ol>
            <p className="mt-[18px] flex items-center gap-[8px] text-[13px] text-[#5C5C5C]" data-testid="pix-aguardando"><Loader2 className="h-[16px] w-[16px] animate-spin" /> Aguardando o pagamento…</p>
            <p className="mt-[8px] text-[12px] text-[#5C5C5C]">O pedido só vai para a cozinha depois do pagamento.</p>
          </>
        )}
        {situacao === 'pago' && (
          <div className="mt-[40px] flex flex-col items-center" data-testid="pix-pago">
            <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-[#16884D] text-white"><Check className="h-[40px] w-[40px]" /></span>
            <p className="mt-[16px] text-[20px] font-bold text-[#1F1F1F]">Pagamento confirmado!</p>
            <p className="mt-[4px] text-[14px] text-[#5C5C5C]">Pedido #{pix.numero} enviado para a loja.</p>
          </div>
        )}
        {situacao === 'expirado' && (
          <div className="mt-[40px] flex flex-col items-center" data-testid="pix-expirado">
            <p className="text-[20px] font-bold text-[#1F1F1F]">O tempo para pagar acabou</p>
            <p className="mt-[6px] text-[14px] text-[#5C5C5C]">O pedido #{pix.numero} foi cancelado e nada foi cobrado.</p>
            <button type="button" onClick={onRefazer} className="mt-[20px] h-[52px] w-full rounded-[8px] bg-[#1446AB] px-[20px] text-[16px] font-semibold text-white" data-testid="pix-refazer">Fazer o pedido de novo</button>
          </div>
        )}
        {situacao === 'pago_apos_cancelado' && (
          <div className="mt-[40px] flex flex-col items-center" data-testid="pix-pago-depois">
            <p className="text-[20px] font-bold text-[#1F1F1F]">Recebemos seu Pix depois do prazo</p>
            <p className="mt-[6px] text-[14px] text-[#5C5C5C]">O pedido #{pix.numero} já tinha sido cancelado. A loja foi avisada e vai devolver o valor.</p>
          </div>
        )}
      </div>
    </div>
  )
}
