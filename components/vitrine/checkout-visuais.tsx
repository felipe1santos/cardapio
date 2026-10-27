'use client'

import type { ReactNode } from 'react'
import {
  CreditCard as PhCreditCard,
  ForkKnife as PhForkKnife,
  Money as PhMoney,
  Storefront as PhStorefront,
  CheckCircle as PhCheckCircle,
} from '@phosphor-icons/react'

/**
 * Peças do checkout da vitrine (26/10/2026): a escolha "pagar online × pagar na entrega" em dois cartões grandes
 * com ilustração própria (public/vitrine/ilustracoes/pagar-*.svg) e os ícones de cada forma de pagamento.
 */

const MODO = {
  online: { fundo: 'linear-gradient(180deg,#F1F5FF 0%,#E3ECFF 100%)', cor: '#1D4ED8', borda: '#1D4ED8' },
  entrega: { fundo: 'linear-gradient(180deg,#F5FBEA 0%,#E8F6D2 100%)', cor: '#4D7C0F', borda: '#65A30D' },
} as const

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
      {/* 26/10/2026: ilustração própria (public/vitrine/ilustracoes/pagar-*.svg) ocupando o alto do cartão. */}
      <span className="relative flex h-[164px] items-center justify-center px-[8px] pt-[8px]" style={{ background: m.fundo }} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tipo === 'online' ? '/vitrine/ilustracoes/pagar-online.svg' : '/vitrine/ilustracoes/pagar-entrega.svg'} alt="" className="h-full w-full object-contain" />
        {ativo && <PhCheckCircle weight="fill" size={24} className="absolute right-[8px] top-[8px]" style={{ color: m.cor }} />}
      </span>
      <span className="block px-[14px] pb-[14px] pt-[12px]">
        <span className="block text-[16px] font-semibold leading-[20px] text-[#1F1F1F]">{titulo}</span>
        <span className="mt-[4px] block text-[12.5px] leading-[17px] text-[#5C5C5C]">{texto}</span>
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
