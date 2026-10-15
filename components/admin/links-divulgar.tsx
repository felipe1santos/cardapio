'use client'

/**
 * Ajustes › Perfil da loja › "Links para divulgar" (10/10/2026, só com "Novidades em teste"). Link do cardápio marcado
 * para cada canal (utm legível, sem encurtador), com "Copiar"; o do panfleto também em QR para baixar em PNG.
 * Cada pedido que chegar por um desses links sai com a origem certa no card, no pedido e no Dashboard.
 */
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Download, Link2 } from 'lucide-react'
import { ModalCentral } from '@/components/ui/flutuante'
import { linksParaDivulgar, PASSOS_GOOGLE, type LinkDivulgar } from '@/lib/links-divulgar'

const GRUPOS: { canal: LinkDivulgar['canal']; titulo: string }[] = [
  { canal: 'google', titulo: 'Google (Perfil da Empresa / Google Meu Negócio)' },
  { canal: 'instagram', titulo: 'Instagram' },
  { canal: 'whatsapp', titulo: 'WhatsApp' },
  { canal: 'qrcode', titulo: 'Panfleto / QR' },
  { canal: 'anuncio', titulo: 'Anúncios pagos' },
]

function LinhaLink({ l }: { l: LinkDivulgar }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="flex flex-col gap-1.5 rounded-[6px] border border-[#E4E7EA] bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3" data-testid={`link-${l.id}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-[#1C2B33]">{l.rotulo}</p>
        <p className="truncate font-mono text-[12px] text-[#465A69]" title={l.url}>{l.url}</p>
        <p className="text-[11.5px] text-[#6B7280]">{l.dica}</p>
      </div>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(l.url).then(() => { setCopiado(true); window.setTimeout(() => setCopiado(false), 1600) }).catch(() => {}) }}
        className="inline-flex h-[34px] flex-shrink-0 items-center justify-center gap-1.5 rounded-[6px] border border-[#CBD2D9] bg-white px-3 text-[12.5px] font-semibold text-[#1C2B33] hover:border-[#0868A6] hover:text-[#0868A6]"
        data-testid={`copiar-${l.id}`}>
        {copiado ? <><Check className="h-4 w-4" /> Copiado</> : <><Copy className="h-4 w-4" /> Copiar</>}
      </button>
    </div>
  )
}

/**
 * O que fica no Perfil da loja (15/10): só o resumo e um botão. A lista inteira (que esticava o
 * card por mais de 1500 px) abre numa janela.
 */
export function CartaoLinksDivulgar({ baseCardapio, slug }: { baseCardapio: string; slug: string }) {
  const [aberto, setAberto] = useState(false)
  const total = useMemo(() => linksParaDivulgar(baseCardapio).length, [baseCardapio])
  return (
    <>
      <div className="flex flex-wrap gap-1.5" aria-hidden>
        {GRUPOS.map((g) => (
          <span key={g.canal} className="rounded-full bg-[#F3F4F6] px-2.5 py-1 text-[11.5px] font-medium text-[#4B5563]">
            {g.titulo.replace(/ \(.*\)$/, '')}
          </span>
        ))}
      </div>
      <button type="button" onClick={() => setAberto(true)} data-testid="abrir-links-divulgar"
        className="inline-flex h-[36px] w-full items-center justify-center gap-2 rounded-[6px] border border-[#0688D4] bg-white px-3 text-[12.5px] font-semibold text-[#0688D4] hover:bg-[#F0F8FD]">
        <Link2 className="h-4 w-4" /> Ver os {total} links
      </button>
      <ModalCentral aberto={aberto} onFechar={() => setAberto(false)} titulo="Links para divulgar" largura={640} testid="modal-links-divulgar"
        subtitulo="Um link para cada canal. Pedido que chegar por eles aparece com a origem certa no card e no Dashboard.">
        <LinksParaDivulgar baseCardapio={baseCardapio} slug={slug} />
      </ModalCentral>
    </>
  )
}

export function LinksParaDivulgar({ baseCardapio, slug }: { baseCardapio: string; slug: string }) {
  const links = useMemo(() => linksParaDivulgar(baseCardapio), [baseCardapio])
  const panfleto = links.find((l) => l.canal === 'qrcode')!
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    QRCode.toDataURL(panfleto.url, { width: 1024, margin: 1, errorCorrectionLevel: 'M' }).then((d) => vivo && setQr(d)).catch(() => vivo && setQr(null))
    return () => { vivo = false }
  }, [panfleto.url])

  function baixar() {
    if (!qr) return
    const a = document.createElement('a')
    a.href = qr
    a.download = `qr-panfleto-${slug}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="space-y-4 p-4 sm:p-5" data-testid="links-divulgar">
      {GRUPOS.map((g) => (
        <div key={g.canal} className="space-y-2">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#6B7280]">{g.titulo}</p>
          {g.canal === 'google' && (
            <ol className="list-decimal space-y-0.5 rounded-[6px] bg-[#F5F7F9] py-2 pl-7 pr-3 text-[12.5px] leading-[18px] text-[#465A69]" data-testid="passos-google">
              {PASSOS_GOOGLE.map((p) => <li key={p}>{p}</li>)}
            </ol>
          )}
          {links.filter((l) => l.canal === g.canal).map((l) => <LinhaLink key={l.id} l={l} />)}
          {g.canal === 'qrcode' && (
            <div className="flex items-center gap-3">
              {qr
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={qr} alt="QR do link do panfleto" className="h-[96px] w-[96px] rounded-[4px] border border-[#E4E7EA]" data-testid="qr-panfleto" />
                : <div className="h-[96px] w-[96px] rounded-[4px] bg-[#F5F7F9]" />}
              <button type="button" onClick={baixar} disabled={!qr}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[6px] bg-[#0868A6] px-3 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
                data-testid="baixar-qr-panfleto">
                <Download className="h-4 w-4" /> Baixar QR (PNG)
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
