'use client'

/**
 * Ficha "Sobre a loja" da vitrine nova (2026-10-07): logo, status, contato (WhatsApp, Instagram,
 * endereço com mapa), entrega e taxa por bairro, num cartão só. Fonte da vitrine, peso até 600.
 */
import { Clock, MapPin, Truck, Store, ChevronRight, X } from 'lucide-react'
import { capitalizarTexto } from '@/lib/texto'
import { mascararTelefoneBR } from '@/lib/telefone'

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

/** "https://instagram.com/loja/" → "@loja". Null se não for um link do Instagram. */
export function usuarioInstagram(url: string | null | undefined): string | null {
  const m = (url ?? '').match(/^https:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?$/)
  return m ? `@${m[1]}` : null
}

/** Glifo oficial do Instagram (gradiente da marca), sem distorcer. */
export function IconeInstagram({ className = 'h-[20px] w-[20px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <radialGradient id="ig-grad" cx="0.3" cy="1.07" r="1.3">
          <stop offset="0" stopColor="#FDF497" />
          <stop offset="0.05" stopColor="#FDF497" />
          <stop offset="0.45" stopColor="#FD5949" />
          <stop offset="0.6" stopColor="#D6249F" />
          <stop offset="0.9" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="6.5" fill="url(#ig-grad)" />
      <rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="16.3" cy="7.7" r="1.05" fill="#fff" />
    </svg>
  )
}

function LinhaContato({ icone, titulo, texto, href, acao, testid }: {
  icone: React.ReactNode; titulo: string; texto: string; href?: string; acao?: string; testid?: string
}) {
  const conteudo = (
    <>
      <span className="flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-[10px] bg-[#F5F5F5]">{icone}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] leading-[16px] text-[#5C5C5C]">{titulo}</span>
        <span className="block truncate text-[14px] font-semibold leading-[20px] text-[#1F1F1F]">{texto}</span>
      </span>
      {href && (
        <span className="flex flex-shrink-0 items-center gap-[2px] text-[12px] font-semibold text-[var(--v-acao)]">
          {acao}<ChevronRight className="h-[16px] w-[16px]" strokeWidth={2.2} />
        </span>
      )}
    </>
  )
  const classe = 'flex min-h-[64px] w-full items-center gap-[12px] px-[14px] py-[12px] text-left'
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${classe} transition-colors hover:bg-[#FAFAFA]`} data-testid={testid}>{conteudo}</a>
  ) : (
    <div className={classe} data-testid={testid}>{conteudo}</div>
  )
}

export interface FichaLojaProps {
  nome: string
  logoUrl: string | null
  aberta: boolean
  horarioTexto: string | null
  endereco: string
  telefone: string
  /** Número do WhatsApp da loja (55…) ou vazio. */
  whatsapp: string
  instagramUrl: string | null
  aceitaEntrega: boolean
  aceitaRetirada: boolean
  prazoEntrega: string
  freteGratisAcima: number | null
  taxaPadrao: number
  menorTaxa: number
  bairros: { bairro: string; taxa: number }[]
  onFechar: () => void
  onCalcularFrete: () => void
}

export function FichaLoja(p: FichaLojaProps) {
  const insta = usuarioInstagram(p.instagramUrl)
  const temContato = !!(p.whatsapp || p.telefone || insta || p.endereco)
  return (
    <>
      <div className="fixed inset-0 z-[64] bg-[#111827]/60" onClick={p.onFechar} />
      <div className="fixed inset-0 z-[65] flex items-end justify-center sm:items-center sm:p-4" onClick={p.onFechar}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Sobre ${p.nome}`}
          className="flex max-h-[90dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-[16px] bg-[#F8FAFC] shadow-2xl sm:rounded-[16px]"
          onClick={(e) => e.stopPropagation()}
          data-testid="ficha-loja"
        >
          {/* Cabeçalho: logo, nome e status */}
          <div className="relative bg-white px-[20px] pb-[18px] pt-[20px]">
            <button onClick={p.onFechar} aria-label="Fechar" className="absolute right-[12px] top-[12px] flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[#F3F4F6] text-[#3D3D3D] transition-colors hover:bg-[#E5E7EB]">
              <X className="h-[18px] w-[18px]" strokeWidth={2.2} />
            </button>
            <div className="flex items-center gap-[14px] pr-[40px]">
              <div className="h-[64px] w-[64px] flex-shrink-0 overflow-hidden rounded-[14px] border border-[#EFEFEF] bg-[#F5F5F5]" data-testid="ficha-loja-logo">
                {p.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.logoUrl} alt={p.nome} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[var(--tema-dark)] text-[24px] font-semibold text-white">{p.nome.charAt(0).toUpperCase()}</div>
                )}
              </div>
              <div className="min-w-0">
                <h2 className="line-clamp-2 text-[18px] font-semibold leading-[22px] text-[#1F1F1F]">{p.nome}</h2>
                <div className="mt-[6px] flex flex-wrap items-center gap-[8px]">
                  <span className={['inline-flex items-center gap-[6px] rounded-full px-[10px] py-[3px] text-[12px] font-semibold', p.aberta ? 'bg-[#E8F5EE] text-[#0B7A3E]' : 'bg-[#FDECEC] text-[#B42318]'].join(' ')} data-testid="ficha-loja-status">
                    <span className={['h-[7px] w-[7px] rounded-full', p.aberta ? 'bg-[#16884D]' : 'bg-[#D92D20]'].join(' ')} />
                    {p.aberta ? 'Aberta agora' : 'Fechada'}
                  </span>
                  {p.horarioTexto && (
                    <span className="inline-flex items-center gap-[4px] text-[12px] text-[#5C5C5C]">
                      <Clock className="h-[13px] w-[13px]" strokeWidth={2.2} /> {p.horarioTexto}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-[16px] overflow-y-auto overscroll-contain px-[16px] pb-[max(env(safe-area-inset-bottom),20px)] pt-[16px]">
            {/* Contato */}
            {temContato && (
              <section>
                <h3 className="mb-[8px] px-[4px] text-[13px] font-semibold text-[#5C5C5C]">Contato e endereço</h3>
                <div className="divide-y divide-[#EFEFEF] overflow-hidden rounded-[12px] border border-[#EFEFEF] bg-white">
                  {(p.whatsapp || p.telefone) && (
                    <LinhaContato
                      icone={p.whatsapp
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src="/icons/integracoes/whatsapp-icon.svg" alt="" className="h-[22px] w-[22px]" />
                        : <Store className="h-[20px] w-[20px] text-[#3D3D3D]" strokeWidth={1.8} />}
                      titulo={p.whatsapp ? 'WhatsApp da loja' : 'Telefone'}
                      texto={mascararTelefoneBR(p.telefone)}
                      href={p.whatsapp ? `https://wa.me/${p.whatsapp}` : `tel:${p.telefone.replace(/\D/g, '')}`}
                      acao={p.whatsapp ? 'Conversar' : 'Ligar'}
                      testid="ficha-loja-whatsapp"
                    />
                  )}
                  {insta && (
                    <LinhaContato icone={<IconeInstagram />} titulo="Instagram" texto={insta} href={p.instagramUrl!} acao="Seguir" testid="ficha-loja-instagram" />
                  )}
                  {p.endereco && (
                    <LinhaContato
                      icone={<MapPin className="h-[20px] w-[20px] text-[#D92D20]" strokeWidth={2} />}
                      titulo="Endereço"
                      texto={capitalizarTexto(p.endereco)}
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.endereco)}`}
                      acao="Mapa"
                      testid="ficha-loja-endereco"
                    />
                  )}
                </div>
              </section>
            )}

            {/* Como a loja atende */}
            <section>
              <h3 className="mb-[8px] px-[4px] text-[13px] font-semibold text-[#5C5C5C]">Como a loja atende</h3>
              <div className="grid grid-cols-2 gap-[8px]">
                <div className={['rounded-[12px] border bg-white p-[12px]', p.aceitaEntrega ? 'border-[#EFEFEF]' : 'border-[#EFEFEF] opacity-60'].join(' ')}>
                  <Truck className="h-[18px] w-[18px] text-[#3D3D3D]" strokeWidth={2} />
                  <div className="mt-[6px] text-[14px] font-semibold text-[#1F1F1F]">{p.aceitaEntrega ? 'Entrega' : 'Sem entrega'}</div>
                  {p.aceitaEntrega && <div className="mt-[2px] text-[12px] leading-[16px] text-[#5C5C5C]">{p.prazoEntrega}</div>}
                </div>
                <div className={['rounded-[12px] border bg-white p-[12px]', p.aceitaRetirada ? 'border-[#EFEFEF]' : 'border-[#EFEFEF] opacity-60'].join(' ')}>
                  <Store className="h-[18px] w-[18px] text-[#3D3D3D]" strokeWidth={2} />
                  <div className="mt-[6px] text-[14px] font-semibold text-[#1F1F1F]">{p.aceitaRetirada ? 'Retirada' : 'Sem retirada'}</div>
                  {p.aceitaRetirada && <div className="mt-[2px] text-[12px] leading-[16px] text-[#5C5C5C]">Sem taxa, no balcão</div>}
                </div>
              </div>
              {p.freteGratisAcima !== null && (
                <div className="mt-[8px] rounded-[10px] bg-[#E8F5EE] px-[12px] py-[9px] text-[13px] font-semibold text-[#0B7A3E]">
                  Frete grátis em pedidos acima de {brl(p.freteGratisAcima)}
                </div>
              )}
            </section>

            {/* Taxa de entrega */}
            {p.aceitaEntrega && (
              <section>
                <div className="mb-[8px] flex items-baseline justify-between px-[4px]">
                  <h3 className="text-[13px] font-semibold text-[#5C5C5C]">Taxa de entrega</h3>
                  {p.bairros.length > 0 && <span className="text-[12px] text-[#5C5C5C]">a partir de {brl(p.menorTaxa)}</span>}
                </div>
                {p.bairros.length > 0 ? (
                  <div className="max-h-[32dvh] overflow-y-auto overscroll-contain rounded-[12px] border border-[#EFEFEF] bg-white" data-testid="ficha-loja-bairros">
                    {p.bairros.map((b) => (
                      <div key={b.bairro} className="flex items-center justify-between gap-[12px] border-b border-[#F3F3F3] px-[14px] py-[10px] text-[14px] last:border-none">
                        <span className="min-w-0 truncate text-[#3D3D3D]">{capitalizarTexto(b.bairro)}</span>
                        <span className={['flex-shrink-0 font-semibold', b.taxa === 0 ? 'text-[#0B7A3E]' : 'text-[#1F1F1F]'].join(' ')}>{b.taxa === 0 ? 'Grátis' : brl(b.taxa)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-[12px] bg-[#FAFAFA] px-[14px] py-[10px] text-[14px]">
                      <span className="text-[#5C5C5C]">Demais bairros</span>
                      <span className="font-semibold text-[#1F1F1F]">{brl(p.taxaPadrao)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[12px] border border-[#EFEFEF] bg-white px-[14px] py-[12px] text-[14px] text-[#3D3D3D]">
                    Taxa única: <span className="font-semibold text-[#1F1F1F]">{p.taxaPadrao > 0 ? brl(p.taxaPadrao) : 'a combinar'}</span>
                  </div>
                )}
                <button
                  onClick={p.onCalcularFrete}
                  className="mt-[12px] min-h-[48px] w-full rounded-[10px] bg-[var(--tema-dark)] px-[16px] text-[15px] font-semibold text-white transition-all hover:brightness-95 active:scale-[0.99]"
                  data-testid="ficha-loja-calcular"
                >
                  Calcular a taxa pelo meu CEP
                </button>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
