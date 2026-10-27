'use client'

import type { ReactNode } from 'react'
import {
  CreditCard as PhCreditCard,
  DeviceMobile as PhDeviceMobile,
  ForkKnife as PhForkKnife,
  Money as PhMoney,
  Moped as PhMoped,
  QrCode as PhQrCode,
  Storefront as PhStorefront,
  CheckCircle as PhCheckCircle,
} from '@phosphor-icons/react'

/**
 * Peças do checkout da vitrine (26/10/2026): a escolha "pagar online × pagar na entrega" em dois cartões grandes
 * com ilustração (ícones duotone compostos, sem imagem externa) e os ícones de cada forma de pagamento.
 */

const MODO = {
  online: { fundo: 'linear-gradient(160deg,#EEF4FF 0%,#DCE8FF 100%)', cor: '#1D4ED8', borda: '#1D4ED8' },
  entrega: { fundo: 'linear-gradient(160deg,#ECFDF3 0%,#D3F5E1 100%)', cor: '#15803D', borda: '#15803D' },
} as const

function Selo({ children, cor, className }: { children: ReactNode; cor: string; className: string }) {
  return (
    <span className={`absolute flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white shadow-[0_4px_10px_rgba(16,24,40,0.12)] ${className}`} style={{ color: cor }}>
      {children}
    </span>
  )
}

/** Cartão vertical grande para escolher como pagar. */
export function CartaoModoPagamento({ tipo, titulo, texto, ativo, onClick, testid }: {
  tipo: 'online' | 'entrega'; titulo: string; texto: string; ativo: boolean; onClick: () => void; testid?: string
}) {
  const m = MODO[tipo]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      data-testid={testid}
      className="relative flex flex-col overflow-hidden rounded-[14px] border-2 bg-white text-left transition-[border-color,box-shadow] active:scale-[0.99]"
      style={{ borderColor: ativo ? m.borda : '#E5E7EB', boxShadow: ativo ? `0 0 0 3px ${m.borda}22` : undefined }}
    >
      <span className="relative flex h-[112px] items-center justify-center" style={{ background: m.fundo }} aria-hidden="true">
        {tipo === 'online' ? (
          <>
            <PhDeviceMobile weight="duotone" size={64} style={{ color: m.cor }} />
            <Selo cor="#0F766E" className="left-[22%] top-[18px]"><PhQrCode weight="bold" size={18} /></Selo>
            <Selo cor={m.cor} className="bottom-[14px] right-[20%]"><PhCreditCard weight="fill" size={18} /></Selo>
          </>
        ) : (
          <>
            <PhMoped weight="duotone" size={66} style={{ color: m.cor }} />
            <Selo cor="#15803D" className="left-[20%] top-[16px]"><PhMoney weight="fill" size={18} /></Selo>
            <Selo cor="#1D4ED8" className="bottom-[14px] right-[18%]"><PhCreditCard weight="fill" size={18} /></Selo>
          </>
        )}
        {ativo && <PhCheckCircle weight="fill" size={22} className="absolute right-[8px] top-[8px]" style={{ color: m.cor }} />}
      </span>
      <span className="block px-[12px] pb-[12px] pt-[10px]">
        <span className="block text-[15px] font-semibold leading-[20px] text-[#1F1F1F]">{titulo}</span>
        <span className="mt-[2px] block text-[12px] leading-[16px] text-[#5C5C5C]">{texto}</span>
      </span>
    </button>
  )
}

/** Ícone + fundo da forma de pagamento (OpcaoRadio, revisão do pedido). */
export function iconeFormaPagamento(forma: 'cartao_online' | 'maquininha' | 'dinheiro' | 'vale' | 'retirada'): { icone: ReactNode; fundo: string } {
  switch (forma) {
    case 'cartao_online': return { icone: <PhCreditCard weight="duotone" size={22} color="#1D4ED8" />, fundo: '#EEF4FF' }
    case 'maquininha': return { icone: <PhCreditCard weight="duotone" size={22} color="#4338CA" />, fundo: '#EEF0FF' }
    case 'dinheiro': return { icone: <PhMoney weight="duotone" size={22} color="#15803D" />, fundo: '#ECFDF3' }
    case 'vale': return { icone: <PhForkKnife weight="duotone" size={22} color="#7E22CE" />, fundo: '#F5EEFF' }
    case 'retirada': return { icone: <PhStorefront weight="duotone" size={22} color="#00466F" />, fundo: '#E6EFF5' }
  }
}
