import { Globe, Link2, Megaphone, MessageCircle, Monitor, QrCode, Store, UtensilsCrossed } from 'lucide-react'

/**
 * Ícones das origens (item 55/56): marcas desenhadas em SVG simples (sem pacote de logos) + lucide.
 * Usados no Dashboard (Origem das visitas), no card do Kanban e no painel do pedido.
 */
type P = { className?: string }

export function IconeGoogle({ className = 'h-4 w-4' }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  )
}
export function IconeMeta({ className = 'h-4 w-4' }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="none" stroke="#0866FF" strokeWidth="2.6" strokeLinecap="round" d="M3 15.5c0-4.5 2.3-8 4.8-8 3.6 0 5.6 9 8.6 9 1.9 0 3.6-1.6 3.6-4.5 0-3-1.6-4.5-3.4-4.5-3.3 0-5.4 9-8.8 9C5.3 16.5 3 16.2 3 15.5Z" />
    </svg>
  )
}
export function IconeWhatsapp({ className = 'h-4 w-4' }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z" />
      <path fill="#fff" d="M9.2 7c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.3.3-1 .9-1 2.3s1 2.7 1.2 2.9c.1.2 2 3.1 4.9 4.3 2.4.9 2.9.8 3.4.7.5 0 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4l-.5-.3-1.7-.8c-.3-.1-.5-.1-.7.1l-.8 1c-.1.2-.3.2-.6.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.9Z" />
    </svg>
  )
}
export function IconeInstagram({ className = 'h-4 w-4' }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs><linearGradient id="mz-ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#FEDA75" /><stop offset=".35" stopColor="#FA7E1E" /><stop offset=".6" stopColor="#D62976" /><stop offset="1" stopColor="#4F5BD5" /></linearGradient></defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#mz-ig)" />
      <circle cx="12" cy="12" r="4.4" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="17.4" cy="6.6" r="1.3" fill="#fff" />
    </svg>
  )
}
export function IconeFacebook({ className = 'h-4 w-4' }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#1877F2" />
      <path fill="#fff" d="M13.3 22v-7.4h2.5l.4-2.9h-2.9V9.9c0-.8.2-1.4 1.4-1.4h1.6V5.9c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2H7.6v2.9h2.6V22h3.1Z" />
    </svg>
  )
}

/** Ícone de uma origem do pedido/visita (canal da 0149) ou do canal presencial ("pdv", "balcao", "mesa"). */
export function IconeOrigem({ canal, className = 'h-4 w-4' }: { canal: string; className?: string }) {
  switch (canal) {
    case 'instagram': return <IconeInstagram className={className} />
    case 'facebook': return <IconeFacebook className={className} />
    case 'meta': return <IconeMeta className={className} />
    case 'google_anuncio': case 'google_busca': return <IconeGoogle className={className} />
    case 'whatsapp': return <IconeWhatsapp className={className} />
    case 'qrcode': return <QrCode className={`${className} text-[#C2410C]`} aria-hidden="true" />
    case 'pdv': return <Monitor className={`${className} text-[#1D4ED8]`} aria-hidden="true" />
    case 'balcao': return <Store className={`${className} text-[#047857]`} aria-hidden="true" />
    case 'mesa': return <UtensilsCrossed className={`${className} text-[#7E22CE]`} aria-hidden="true" />
    case 'outros': return <Globe className={`${className} text-[#465A69]`} aria-hidden="true" />
    case 'campanha': return <Megaphone className={`${className} text-[#047857]`} aria-hidden="true" />
    default: return <Link2 className={`${className} text-[#465A69]`} aria-hidden="true" />
  }
}

/** Ícone oficial do Pix (o mesmo da vitrine). */
export function IconePix({ className = 'h-4 w-4' }: P) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="#32BCAD" aria-hidden="true">
      <path d="M11.917 11.71a2.046 2.046 0 0 1-1.454-.602l-2.1-2.1a.4.4 0 0 0-.551 0l-2.108 2.108a2.044 2.044 0 0 1-1.454.602h-.414l2.66 2.66c.83.83 2.177.83 3.007 0l2.667-2.668h-.253zM4.25 4.282c.55 0 1.066.214 1.454.602l2.108 2.108a.39.39 0 0 0 .552 0l2.1-2.1a2.044 2.044 0 0 1 1.453-.602h.253L9.503 1.623a2.127 2.127 0 0 0-3.007 0l-2.66 2.66h.414zM14.377 6.496l-1.612-1.612a.307.307 0 0 1-.114.023h-.733c-.379 0-.75.154-1.017.422l-2.1 2.1a1.005 1.005 0 0 1-1.425 0L5.268 5.32a1.448 1.448 0 0 0-1.018-.422h-.9a.306.306 0 0 1-.109-.021L1.623 6.496c-.83.83-.83 2.177 0 3.008l1.618 1.618a.305.305 0 0 1 .108-.022h.901c.38 0 .75-.153 1.018-.421L7.375 8.57a1.034 1.034 0 0 1 1.426 0l2.1 2.1c.267.268.638.421 1.017.421h.733c.04 0 .079.01.114.024l1.612-1.612c.83-.83.83-2.178 0-3.008" />
    </svg>
  )
}

/**
 * Selo da origem no card do Kanban (2026-10-07): quadradinho de 18 px com fundo SÓLIDO na cor da
 * marca (escurecida até o branco dar ≥ 4,5:1) e o desenho em branco. Só origens da vitrine — quem
 * chama já tirou Direto, PDV, Mesa e Balcão.
 */
const COR_SELO: Record<string, string> = {
  instagram: '#C13584', facebook: '#0B5FCC', meta: '#0064E0', google_anuncio: '#1967D2', google_busca: '#1967D2',
  whatsapp: '#0E7569', qrcode: '#C2410C', outros: '#4B5563',
}
export function SeloOrigem({ canal }: { canal: string }) {
  const cor = COR_SELO[canal] ?? '#4B5563'
  const desenho = (() => {
    switch (canal) {
      case 'instagram':
        return <svg viewBox="0 0 24 24" className="h-[12px] w-[12px]" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="#fff" strokeWidth="2.4" /><circle cx="12" cy="12" r="4" fill="none" stroke="#fff" strokeWidth="2.4" /><circle cx="17.3" cy="6.7" r="1.5" fill="#fff" /></svg>
      case 'facebook':
        return <svg viewBox="0 0 24 24" className="h-[12px] w-[12px]" aria-hidden="true"><path fill="#fff" d="M13.8 22v-8.2h2.8l.4-3.3h-3.2V8.4c0-.9.3-1.6 1.6-1.6h1.7V3.9c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.6v3.3h2.8V22h3.4Z" /></svg>
      case 'meta':
        return <svg viewBox="0 0 24 24" className="h-[13px] w-[13px]" aria-hidden="true"><path fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" d="M3 15.5c0-4.5 2.3-8 4.8-8 3.6 0 5.6 9 8.6 9 1.9 0 3.6-1.6 3.6-4.5 0-3-1.6-4.5-3.4-4.5-3.3 0-5.4 9-8.8 9C5 16.5 3 15.9 3 15.5Z" /></svg>
      case 'google_anuncio': case 'google_busca':
        return <svg viewBox="0 0 24 24" className="h-[12px] w-[12px]" aria-hidden="true"><path fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" d="M20 12.2h-7.6M19.4 8A8.4 8.4 0 1 0 20.4 13" /></svg>
      case 'whatsapp': return <MessageCircle className="h-[12px] w-[12px] text-white" strokeWidth={2.6} aria-hidden="true" />
      case 'qrcode': return <QrCode className="h-[12px] w-[12px] text-white" strokeWidth={2.6} aria-hidden="true" />
      default: return <Globe className="h-[12px] w-[12px] text-white" strokeWidth={2.6} aria-hidden="true" />
    }
  })()
  return (
    <span className="inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px]" style={{ background: cor }} data-selo-origem={canal}>
      {desenho}
    </span>
  )
}
