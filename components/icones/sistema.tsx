'use client'

import {
  ArrowLeft, ArrowRight, Bag, Bell, CashRegister, Check, Coins, CreditCard, DotsThree, ForkKnife, Gift, MapPin, Moped, PencilSimple, Phone, Plus, Printer,
  Receipt, Storefront, Tag, Target, Trash, Warning, X, type IconProps,
} from '@phosphor-icons/react'

/**
 * Ícones do SISTEMA (Bloco D, 19/10/2026): um conjunto só, Phosphor (@phosphor-icons/react), para o Kanban e o painel
 * do pedido — antes misturavam lucide com desenhos à mão (capacete). Ícones de MARCA (Pix, WhatsApp, Instagram, Google,
 * Meta, Claude) ficam à parte em components/icones/origens.tsx. Cada peça aqui tem um nome pelo que significa, não
 * pelo desenho, para trocar o desenho num lugar só.
 */
type P = Omit<IconProps, 'ref'> & { className?: string }
const padrao: Partial<IconProps> = { weight: 'bold', 'aria-hidden': true }

export const IcoEditar = (p: P) => <PencilSimple {...padrao} {...p} />
export const IcoImprimir = (p: P) => <Printer {...padrao} {...p} />
export const IcoFechar = (p: P) => <X {...padrao} {...p} />
export const IcoMais = (p: P) => <DotsThree {...padrao} {...p} />
export const IcoSeguir = (p: P) => <ArrowRight {...padrao} {...p} />
export const IcoVoltar = (p: P) => <ArrowLeft {...padrao} {...p} />
export const IcoOk = (p: P) => <Check {...padrao} {...p} />
export const IcoAviso = (p: P) => <Warning {...padrao} weight="fill" {...p} />
export const IcoEndereco = (p: P) => <MapPin {...padrao} {...p} />
export const IcoTelefone = (p: P) => <Phone {...padrao} {...p} />
/** Entrega: moto/entregador (no lugar do capacete desenhado à mão). */
export const IcoEntrega = (p: P) => <Moped {...padrao} {...p} />
export const IcoRetirada = (p: P) => <Bag {...padrao} {...p} />
export const IcoMesa = (p: P) => <ForkKnife {...padrao} {...p} />
/** Origem: cardápio (vitrine) / PDV / salão. */
export const IcoCardapio = (p: P) => <Storefront {...padrao} {...p} />
export const IcoPdv = (p: P) => <Receipt {...padrao} {...p} />
/** Origem PDV/Balcão no selo do card: caixa registradora. */
export const IcoCaixa = (p: P) => <CashRegister {...padrao} {...p} />
export const IcoCartao = (p: P) => <CreditCard {...padrao} weight="duotone" color="#1D4ED8" {...p} />
/** Fidelidade (Etapa 7, 20/10/2026): campanha (alvo), prêmio (presente), cupom (etiqueta), cashback (moedas). */
export const IcoMeta = (p: P) => <Target {...padrao} {...p} />
export const IcoPresente = (p: P) => <Gift {...padrao} {...p} />
export const IcoCupom = (p: P) => <Tag {...padrao} {...p} />
export const IcoCashback = (p: P) => <Coins {...padrao} {...p} />
export const IcoExcluir = (p: P) => <Trash {...padrao} {...p} />
export const IcoAdicionar = (p: P) => <Plus {...padrao} {...p} />
export const IcoSino = (p: P) => <Bell {...padrao} {...p} />

/** Cédula colorida — o MESMO desenho do chip "Faturamento" no topo do Painel de Pedidos (Material "payments"). */
export function IcoDinheiro({ className = 'h-4 w-4', cor = 'var(--valor-dinheiro)' }: { className?: string; cor?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={{ fill: cor }} aria-hidden="true">
      <path d="M19 14V6c0-1.1-.9-2-2-2H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zm-9-1c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-6v11c0 1.1-.9 2-2 2H4v-2h17V7h2z" />
    </svg>
  )
}
