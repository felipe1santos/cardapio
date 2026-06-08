'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

interface Addon {
  name: string
  price: number
}

interface Product {
  id: string
  name: string
  desc: string
  price: number
  originalPrice?: number
  emoji: string
  gradient: string
  requiresPonto?: boolean
  hasAddons?: boolean
}

interface Category {
  name: string
  desc: string
  items: Product[]
}

interface CartLine {
  key: string
  name: string
  emoji: string
  gradient: string
  qty: number
  unit: number
  addons: string[]
  ponto: string | null
  obs: string
}

const PONTOS = ['Mal passada', 'Ao ponto', 'Bem passada']
const ADDONS: Addon[] = [
  { name: 'Bacon extra', price: 4.0 },
  { name: 'Cheddar extra', price: 3.5 },
  { name: 'Ovo', price: 2.5 },
  { name: 'Cebola caramelizada', price: 3.0 },
]
const FEE = 7.0

const MENU: Category[] = [
  {
    name: 'Lanches',
    desc: 'Hambúrgueres artesanais, feitos na hora',
    items: [
      { id: 'l1', name: 'Burger Duplo Artesanal', desc: 'Pão brioche, 2 carnes 120g, cheddar e molho da casa', price: 32.9, emoji: '🍔', gradient: 'from-amber-200 to-orange-300', requiresPonto: true, hasAddons: true },
      { id: 'l2', name: 'X-Bacon Supremo', desc: 'Carne, bacon crocante, cheddar duplo e cebola', price: 24.9, originalPrice: 28.9, emoji: '🥓', gradient: 'from-rose-200 to-orange-300', requiresPonto: true, hasAddons: true },
      { id: 'l3', name: 'X-Salada Clássico', desc: 'Carne, queijo, alface, tomate e maionese da casa', price: 24.9, emoji: '🍔', gradient: 'from-yellow-200 to-amber-300', requiresPonto: true, hasAddons: true },
      { id: 'l4', name: 'Frango Crispy', desc: 'Filé empanado, maionese temperada e picles', price: 27.9, emoji: '🍗', gradient: 'from-orange-200 to-amber-300', hasAddons: true },
      { id: 'l5', name: 'Veggie Burger', desc: 'Hambúrguer de grão-de-bico, legumes e rúcula', price: 26.5, emoji: '🥗', gradient: 'from-lime-200 to-green-300', hasAddons: true },
    ],
  },
  {
    name: 'Combos',
    desc: 'Refeição completa com economia',
    items: [
      { id: 'c1', name: 'Combo Família', desc: '4 burgers, 2 batatas G e refrigerante 2L', price: 79.9, originalPrice: 89.9, emoji: '🍱', gradient: 'from-cyan-200 to-blue-300' },
      { id: 'c2', name: 'Combo Kids', desc: 'Mini burger, batata P, suco e brinde surpresa', price: 29.0, emoji: '🧒', gradient: 'from-sky-200 to-cyan-300' },
    ],
  },
  {
    name: 'Porções',
    desc: 'Para compartilhar à mesa',
    items: [
      { id: 'p1', name: 'Batata Frita G', desc: 'Porção generosa com cheddar e bacon', price: 18.9, emoji: '🍟', gradient: 'from-yellow-200 to-orange-200' },
      { id: 'p2', name: 'Onion Rings', desc: 'Anéis de cebola empanados crocantes', price: 16.0, emoji: '🧅', gradient: 'from-amber-200 to-yellow-300' },
    ],
  },
  {
    name: 'Bebidas',
    desc: 'Para acompanhar o pedido',
    items: [
      { id: 'b1', name: 'Coca-Cola lata', desc: '350ml gelada', price: 6.0, emoji: '🥤', gradient: 'from-red-200 to-rose-200' },
      { id: 'b2', name: 'Suco natural', desc: 'Laranja, maracujá ou abacaxi', price: 9.0, emoji: '🧃', gradient: 'from-orange-200 to-yellow-200' },
      { id: 'b3', name: 'Água mineral', desc: '500ml com ou sem gás', price: 4.0, emoji: '💧', gradient: 'from-sky-200 to-cyan-100' },
    ],
  },
  {
    name: 'Sobremesas',
    desc: 'Para fechar com chave de ouro',
    items: [
      { id: 's1', name: 'Brownie com sorvete', desc: 'Brownie quente com sorvete de creme', price: 11.9, originalPrice: 14.0, emoji: '🍫', gradient: 'from-stone-300 to-amber-200' },
      { id: 's2', name: 'Milkshake', desc: 'Chocolate, morango ou ovomaltine', price: 18.0, emoji: '🥤', gradient: 'from-pink-200 to-rose-200' },
    ],
  },
]

const PROMO_ITEMS = MENU.flatMap((cat) => cat.items.filter((item) => item.originalPrice))

const brl = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`

type Tab = 'home' | 'promos' | 'cart'
type CheckoutStep = 1 | 2 | 3

function PriceTag({ price, originalPrice }: { price: number; originalPrice?: number }) {
  if (originalPrice) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="rounded-menuzia bg-price-bg px-2 py-0.5 text-[15px] font-bold text-price-text">{brl(price)}</span>
        <span className="text-xs text-text-subtle line-through">{brl(originalPrice)}</span>
      </span>
    )
  }
  return <span className="text-[15px] font-bold text-price-text">{brl(price)}</span>
}

function ProductThumb({ product, size = 96 }: { product: Product; size?: number }) {
  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-menuzia bg-gradient-to-br ${product.gradient}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {product.emoji}
    </div>
  )
}

export default function StorefrontPage() {
  const params = useParams<{ slug: string }>()
  const storeName = params?.slug
    ? params.slug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    : 'Menuzia Burger'

  const [tab, setTab] = useState<Tab>('home')
  const [activeCategory, setActiveCategory] = useState(MENU[0].name)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])

  const [productSheet, setProductSheet] = useState<Product | null>(null)
  const [qty, setQty] = useState(1)
  const [ponto, setPonto] = useState(PONTOS[1])
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set())
  const [obs, setObs] = useState('')

  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>(1)
  const [payMethod, setPayMethod] = useState('Pix')
  const [changeFor, setChangeFor] = useState('')
  const [trackingId, setTrackingId] = useState<string | null>(null)

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return MENU
    const term = search.toLowerCase()
    return MENU.map((cat) => ({ ...cat, items: cat.items.filter((item) => item.name.toLowerCase().includes(term)) })).filter(
      (cat) => cat.items.length > 0
    )
  }, [search])

  const cartCount = cart.reduce((sum, line) => sum + line.qty, 0)
  const subtotal = cart.reduce((sum, line) => sum + line.unit * line.qty, 0)
  const total = subtotal + (cart.length ? FEE : 0)

  function openProduct(product: Product) {
    setProductSheet(product)
    setQty(1)
    setPonto(PONTOS[1])
    setSelectedAddons(new Set())
    setObs('')
  }

  function toggleAddon(name: string) {
    setSelectedAddons((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const addonsTotal = useMemo(
    () => ADDONS.filter((a) => selectedAddons.has(a.name)).reduce((sum, a) => sum + a.price, 0),
    [selectedAddons]
  )
  const unitPrice = productSheet ? productSheet.price + addonsTotal : 0

  function addToCart() {
    if (!productSheet) return
    setCart((prev) => [
      ...prev,
      {
        key: `${productSheet.id}-${Date.now()}`,
        name: productSheet.name,
        emoji: productSheet.emoji,
        gradient: productSheet.gradient,
        qty,
        unit: unitPrice,
        addons: [...selectedAddons],
        ponto: productSheet.requiresPonto ? ponto : null,
        obs,
      },
    ])
    setProductSheet(null)
    setTab('cart')
  }

  function changeLineQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((line) => (line.key === key ? { ...line, qty: line.qty + delta } : line))
        .filter((line) => line.qty > 0)
    )
  }

  function startCheckout() {
    setCheckoutOpen(true)
    setCheckoutStep(1)
  }

  function checkoutNext() {
    if (checkoutStep < 3) {
      setCheckoutStep((s) => (s + 1) as CheckoutStep)
      return
    }
    setTrackingId(`#MGB-${Math.floor(1000 + Math.random() * 9000)}`)
    setCheckoutOpen(false)
    setCart([])
    setTab('home')
  }

  function checkoutBack() {
    if (checkoutStep > 1) setCheckoutStep((s) => (s - 1) as CheckoutStep)
    else setCheckoutOpen(false)
  }

  return (
    <div className="min-h-screen bg-page font-sans text-text-main">
      <div className="relative mx-auto min-h-screen max-w-[600px] bg-main pb-28 shadow-2xl shadow-black/5">
        {/* Cover + store card */}
        <div className="h-36 bg-gradient-to-br from-sky-500 via-cyan-500 to-primary-dark" />
        <div className="relative z-10 -mt-10 px-4.5">
          <div className="flex items-center gap-3.5 rounded-menuzia border border-border bg-white p-4 shadow-md">
            <div className="flex h-[60px] w-[60px] flex-shrink-0 items-center justify-center rounded-menuzia bg-gradient-to-br from-orange-400 to-orange-500 text-3xl">
              🍔
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-extrabold tracking-tight">{storeName}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-text-subtle">
                <span className="inline-flex items-center gap-1.5 font-semibold text-price-text">
                  <span className="h-1.5 w-1.5 rounded-full bg-status-ready" /> Aberto agora
                </span>
                <span>⏱ 30–45 min</span>
                <span>Mín. {brl(20)}</span>
                <span>⭐ 4,8</span>
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
        {tab === 'home' && (
          <div className="mx-4.5 mt-3.5 flex items-center gap-2.5 rounded-menuzia bg-page px-3.5 py-2.5">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-text-subtle">
              <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 119.5 5a4.5 4.5 0 010 9z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar no cardápio..."
              className="w-full border-none bg-transparent font-sans text-sm text-text-main outline-none placeholder:text-text-subtle"
            />
          </div>
        )}

        {/* HOME TAB */}
        {tab === 'home' && (
          <>
            <div className="sticky top-0 z-10 mt-3.5 flex gap-2 overflow-x-auto border-b border-border bg-main px-4.5 py-3 [scrollbar-width:none]">
              {filteredCategories.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => {
                    setActiveCategory(cat.name)
                    document.getElementById(`sec-${cat.name}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  className={[
                    'flex-shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
                    activeCategory === cat.name
                      ? 'border-primary bg-primary text-white'
                      : 'border-border bg-white text-text-subtle hover:border-primary hover:text-primary',
                  ].join(' ')}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            <div>
              {filteredCategories.map((cat) => (
                <div key={cat.name} id={`sec-${cat.name}`} className="px-4.5 pb-1 pt-4.5">
                  <h2 className="mb-1 text-[17px] font-bold tracking-tight">{cat.name}</h2>
                  <p className="mb-3 text-xs text-text-subtle">{cat.desc}</p>
                  {cat.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => openProduct(item)}
                      className="flex w-full gap-3.5 border-b border-border py-3.5 text-left last:border-none"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 text-[15px] font-semibold">{item.name}</div>
                        <p className="mb-2 line-clamp-2 text-[13px] leading-relaxed text-text-subtle">{item.desc}</p>
                        <PriceTag price={item.price} originalPrice={item.originalPrice} />
                      </div>
                      <div className="relative flex-shrink-0">
                        <ProductThumb product={item} />
                        <span className="absolute -bottom-1.5 -right-1.5 flex h-[30px] w-[30px] items-center justify-center rounded-menuzia border-2 border-white bg-primary text-lg font-bold text-white shadow-md">
                          +
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
              {filteredCategories.length === 0 && (
                <div className="px-4.5 py-16 text-center text-sm text-text-subtle">Nenhum item encontrado para &ldquo;{search}&rdquo;.</div>
              )}
            </div>
          </>
        )}

        {/* PROMOS TAB */}
        {tab === 'promos' && (
          <div className="px-4.5 pt-5">
            <h2 className="mb-1 text-[18px] font-bold tracking-tight">Promoções</h2>
            <p className="mb-4 text-xs text-text-subtle">Ofertas especiais por tempo limitado — aproveite antes que acabe.</p>
            {PROMO_ITEMS.length === 0 && <div className="py-16 text-center text-sm text-text-subtle">Nenhuma promoção ativa no momento.</div>}
            {PROMO_ITEMS.map((item) => (
              <button key={item.id} onClick={() => openProduct(item)} className="flex w-full gap-3.5 border-b border-border py-3.5 text-left last:border-none">
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 inline-flex items-center gap-1.5">
                    <span className="rounded-menuzia bg-price-bg px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-price-text">Promoção</span>
                  </div>
                  <div className="mb-0.5 mt-1 text-[15px] font-semibold">{item.name}</div>
                  <p className="mb-2 line-clamp-2 text-[13px] leading-relaxed text-text-subtle">{item.desc}</p>
                  <PriceTag price={item.price} originalPrice={item.originalPrice} />
                </div>
                <div className="relative flex-shrink-0">
                  <ProductThumb product={item} />
                  <span className="absolute -bottom-1.5 -right-1.5 flex h-[30px] w-[30px] items-center justify-center rounded-menuzia border-2 border-white bg-primary text-lg font-bold text-white shadow-md">
                    +
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* CART TAB */}
        {tab === 'cart' && (
          <div className="px-4.5 pt-5">
            <h2 className="mb-4 text-[18px] font-bold tracking-tight">Sua sacola</h2>
            {cart.length === 0 ? (
              <div className="py-16 text-center text-sm text-text-subtle">Sua sacola está vazia. Volte ao cardápio e monte seu pedido.</div>
            ) : (
              <>
                {cart.map((line) => (
                  <div key={line.key} className="flex gap-3 border-b border-border py-3.5 last:border-none">
                    <div className={`flex h-[54px] w-[54px] flex-shrink-0 items-center justify-center rounded-menuzia bg-gradient-to-br ${line.gradient} text-2xl`}>
                      {line.emoji}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{line.qty}x {line.name}</div>
                      <div className="mt-0.5 text-xs text-text-subtle">{[line.ponto, ...line.addons].filter(Boolean).join(', ') || 'Sem adicionais'}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-bold text-price-text">{brl(line.unit * line.qty)}</span>
                        <div className="flex items-center rounded-menuzia border border-border">
                          <button onClick={() => changeLineQty(line.key, -1)} className="flex h-[30px] w-[30px] items-center justify-center text-base font-semibold text-primary">−</button>
                          <span className="w-[26px] text-center text-[13px] font-bold">{line.qty}</span>
                          <button onClick={() => changeLineQty(line.key, 1)} className="flex h-[30px] w-[30px] items-center justify-center text-base font-semibold text-primary">+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="mt-3 rounded-menuzia bg-page p-3.5 text-sm">
                  <div className="flex justify-between py-1 text-text-subtle"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
                  <div className="flex justify-between py-1 text-text-subtle"><span>Taxa de entrega</span><span>{brl(FEE)}</span></div>
                  <div className="mt-1.5 flex justify-between border-t border-border pt-2.5 text-base font-bold"><span>Total</span><span>{brl(total)}</span></div>
                </div>
                <button
                  onClick={startCheckout}
                  className="mt-4 flex w-full items-center justify-between rounded-menuzia bg-primary px-5 py-3.5 text-[15px] font-bold text-white transition-colors hover:bg-primary-dark"
                >
                  <span>Continuar para pagamento</span>
                  <span>{brl(total)}</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* Bottom nav */}
        <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-[600px] -translate-x-1/2 border-t border-border bg-white px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-around">
            {[
              { id: 'home' as Tab, label: 'Home', icon: '🏠' },
              { id: 'promos' as Tab, label: 'Promoções', icon: '🏷️' },
              { id: 'cart' as Tab, label: 'Carrinho', icon: '🛍️' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={[
                  'relative flex flex-1 flex-col items-center gap-1 rounded-menuzia py-1.5 text-xs font-semibold transition-colors',
                  tab === item.id ? 'text-primary' : 'text-text-subtle',
                ].join(' ')}
              >
                <span className="text-lg leading-none">{item.icon}</span>
                {item.label}
                {item.id === 'cart' && cartCount > 0 && (
                  <span className="absolute -top-0.5 right-[28%] flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                    {cartCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      </div>

      {/* Overlay for sheets */}
      {productSheet && <div className="fixed inset-0 z-40 bg-[#111827]/50" onClick={() => setProductSheet(null)} />}

      {/* Product detail sheet */}
      <div
        className={[
          'fixed bottom-0 left-1/2 z-50 flex max-h-[92vh] w-full max-w-[600px] -translate-x-1/2 flex-col overflow-hidden rounded-t-2xl bg-white transition-transform duration-300',
          productSheet ? 'translate-y-0' : 'translate-y-full',
        ].join(' ')}
      >
        {productSheet && (
          <>
            <button
              onClick={() => setProductSheet(null)}
              className="absolute right-3.5 top-3 z-10 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/90 text-xl shadow-md"
            >
              ×
            </button>
            <div className="flex-1 overflow-y-auto">
              <div className={`flex h-[200px] items-center justify-center bg-gradient-to-br ${productSheet.gradient} text-7xl`}>{productSheet.emoji}</div>
              <div className="p-4.5">
                <h2 className="text-xl font-bold tracking-tight">{productSheet.name}</h2>
                <p className="my-2 text-sm leading-relaxed text-text-subtle">{productSheet.desc}</p>
                <PriceTag price={productSheet.price} originalPrice={productSheet.originalPrice} />

                {productSheet.requiresPonto && (
                  <div className="mt-5">
                    <div className="mb-2.5 flex items-center justify-between">
                      <h3 className="text-sm font-bold">Ponto da carne</h3>
                      <span className="rounded-menuzia bg-danger-bg px-2 py-0.5 text-[10px] font-bold uppercase text-danger">Obrigatório</span>
                    </div>
                    {PONTOS.map((p) => (
                      <button
                        key={p}
                        onClick={() => setPonto(p)}
                        className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left last:border-none"
                      >
                        <span className="flex-1 text-sm font-medium">{p}</span>
                        <span
                          className={[
                            'flex h-5 w-5 items-center justify-center rounded-full border-2',
                            ponto === p ? 'border-primary bg-primary' : 'border-border',
                          ].join(' ')}
                        >
                          {ponto === p && (
                            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white">
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                            </svg>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {productSheet.hasAddons && (
                  <div className="mt-5">
                    <div className="mb-2.5 flex items-center justify-between">
                      <h3 className="text-sm font-bold">Adicionais</h3>
                      <span className="rounded-menuzia bg-page px-2 py-0.5 text-[10px] font-bold uppercase text-text-subtle">Opcional</span>
                    </div>
                    {ADDONS.map((addon) => (
                      <button
                        key={addon.name}
                        onClick={() => toggleAddon(addon.name)}
                        className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left last:border-none"
                      >
                        <span className="flex-1 text-sm font-medium">{addon.name}</span>
                        <span className="text-[13px] font-semibold text-price-text">+ {brl(addon.price)}</span>
                        <span
                          className={[
                            'flex h-5 w-5 items-center justify-center rounded-menuzia border-2',
                            selectedAddons.has(addon.name) ? 'border-primary bg-primary' : 'border-border',
                          ].join(' ')}
                        >
                          {selectedAddons.has(addon.name) && (
                            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white">
                              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                            </svg>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-5">
                  <h3 className="mb-2.5 text-sm font-bold">Observações</h3>
                  <textarea
                    value={obs}
                    onChange={(e) => setObs(e.target.value)}
                    placeholder="Ex: sem cebola, ponto da batata..."
                    className="min-h-[64px] w-full resize-none rounded-menuzia border border-border p-2.5 font-sans text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3.5 border-t border-border p-4.5">
              <div className="flex items-center rounded-menuzia border border-border">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} className="flex h-[42px] w-[38px] items-center justify-center text-xl font-semibold text-primary disabled:text-border">−</button>
                <span className="w-[34px] text-center text-[15px] font-bold">{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} className="flex h-[42px] w-[38px] items-center justify-center text-xl font-semibold text-primary">+</button>
              </div>
              <button onClick={addToCart} className="flex flex-1 items-center justify-between rounded-menuzia bg-primary px-4 py-3.5 text-sm font-bold text-white hover:bg-primary-dark">
                <span>Adicionar</span>
                <span>{brl(unitPrice * qty)}</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Checkout screen */}
      <div className={`fixed inset-0 z-[60] overflow-y-auto bg-page transition-transform duration-300 ${checkoutOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="mx-auto min-h-screen max-w-[600px] bg-white pb-28">
          <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-white px-3.5">
            <button onClick={checkoutBack} className="flex h-[34px] w-[34px] items-center justify-center rounded-menuzia bg-page text-lg">←</button>
            <span className="text-base font-bold">{checkoutStep === 1 ? 'Pagamento' : checkoutStep === 2 ? 'Endereço' : 'Revisar pedido'}</span>
          </div>
          <div className="flex gap-2 px-4.5 py-4">
            {[1, 2, 3].map((step) => (
              <div key={step} className={`h-1 flex-1 rounded-full ${checkoutStep >= step ? 'bg-primary' : 'bg-border'}`} />
            ))}
          </div>

          {checkoutStep === 1 && (
            <div className="px-4.5 pb-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Forma de pagamento</h3>
              {[
                { id: 'Pix', icon: '🔑' },
                { id: 'Cartão na entrega', icon: '💳' },
                { id: 'Dinheiro', icon: '💵' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setPayMethod(opt.id)}
                  className={[
                    'mb-2.5 flex w-full items-center gap-3 rounded-menuzia border p-3.5 text-left transition-colors',
                    payMethod === opt.id ? 'border-primary bg-[#ECFEFF]' : 'border-border',
                  ].join(' ')}
                >
                  <span className="flex h-[38px] w-[38px] items-center justify-center rounded-menuzia bg-page text-lg">{opt.icon}</span>
                  <span className="flex-1 text-sm font-semibold">{opt.id}</span>
                  <span className={['flex h-5 w-5 items-center justify-center rounded-full border-2', payMethod === opt.id ? 'border-primary bg-primary' : 'border-border'].join(' ')} />
                </button>
              ))}
              {payMethod === 'Dinheiro' && (
                <div className="mt-2">
                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Precisa de troco para quanto?</label>
                  <input
                    value={changeFor}
                    onChange={(e) => setChangeFor(e.target.value)}
                    placeholder="Ex: R$ 50,00 (deixe em branco se não precisar)"
                    className="w-full rounded-menuzia border border-border p-2.5 font-sans text-sm outline-none focus:border-primary"
                  />
                </div>
              )}
            </div>
          )}

          {checkoutStep === 2 && (
            <div className="px-4.5 pb-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Endereço de entrega</h3>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">CEP</label>
                  <input defaultValue="29090-000" className="w-full rounded-menuzia border border-border p-2.5 font-sans text-sm outline-none focus:border-primary" />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Número</label>
                  <input defaultValue="245" className="w-full rounded-menuzia border border-border p-2.5 font-sans text-sm outline-none focus:border-primary" />
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Rua</label>
                <input defaultValue="Rua das Acácias" className="w-full rounded-menuzia border border-border p-2.5 font-sans text-sm outline-none focus:border-primary" />
              </div>
              <div className="mt-3">
                <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Complemento</label>
                <input placeholder="Apto, bloco, referência" className="w-full rounded-menuzia border border-border p-2.5 font-sans text-sm outline-none focus:border-primary" />
              </div>
              <div className="mt-3">
                <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Bairro</label>
                <input defaultValue="Jardim Camburi" className="w-full rounded-menuzia border border-border p-2.5 font-sans text-sm outline-none focus:border-primary" />
              </div>
            </div>
          )}

          {checkoutStep === 3 && (
            <div className="px-4.5 pb-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Resumo do pedido</h3>
              <div className="mb-3 space-y-1.5 text-sm">
                {cart.map((line) => (
                  <div key={line.key} className="flex justify-between"><span>{line.qty}x {line.name}</span><span className="font-semibold">{brl(line.unit * line.qty)}</span></div>
                ))}
              </div>
              <div className="rounded-menuzia bg-page p-3.5 text-sm">
                <div className="flex justify-between py-0.5 text-text-subtle"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
                <div className="flex justify-between py-0.5 text-text-subtle"><span>Taxa de entrega</span><span>{brl(FEE)}</span></div>
                <div className="mt-1.5 flex justify-between border-t border-border pt-2 text-base font-bold"><span>Total</span><span>{brl(total)}</span></div>
              </div>
              <h3 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wide text-text-subtle">Entrega & pagamento</h3>
              <div className="mb-2.5 flex items-center gap-3 rounded-menuzia border border-border p-3.5">
                <span className="flex h-[38px] w-[38px] items-center justify-center rounded-menuzia bg-page text-lg">📍</span>
                <div className="text-[13px] leading-relaxed">Rua das Acácias, 245<br /><span className="text-text-subtle">Jardim Camburi · ~30 min</span></div>
              </div>
              <div className="flex items-center gap-3 rounded-menuzia border border-border p-3.5">
                <span className="flex h-[38px] w-[38px] items-center justify-center rounded-menuzia bg-page text-lg">💳</span>
                <div className="text-[13px] font-semibold">
                  {payMethod}
                  {payMethod === 'Dinheiro' && changeFor && <span className="font-normal text-text-subtle"> · troco para {changeFor}</span>}
                </div>
              </div>
            </div>
          )}

          <div className="fixed bottom-0 left-1/2 w-full max-w-[600px] -translate-x-1/2 border-t border-border bg-white p-3.5">
            <button onClick={checkoutNext} className="flex w-full items-center justify-between rounded-menuzia bg-primary px-5 py-3.5 text-[15px] font-bold text-white hover:bg-primary-dark">
              <span>{checkoutStep === 1 ? 'Ir para endereço' : checkoutStep === 2 ? 'Revisar pedido' : 'Fazer pedido'}</span>
              <span>{checkoutStep === 3 ? brl(total) : ''}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tracking screen */}
      <div className={`fixed inset-0 z-[60] overflow-y-auto bg-page transition-transform duration-300 ${trackingId ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="mx-auto min-h-screen max-w-[600px] bg-white pb-28">
          <div className="px-4.5 pb-3 pt-9 text-center">
            <div className="mx-auto mb-3.5 flex h-16 w-16 items-center justify-center rounded-full bg-price-bg">
              <svg viewBox="0 0 24 24" className="h-9 w-9 fill-status-ready">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold">Pedido confirmado!</h2>
            <p className="mt-1 text-[13px] text-text-subtle">
              Pedido <b className="text-text-main">{trackingId}</b> · {storeName}
            </p>
            <span className="mt-3 inline-block rounded-menuzia bg-alert-bg px-3.5 py-1.5 text-[13px] font-semibold text-alert-text">
              Chega em aproximadamente 35 min
            </span>
          </div>
          <div className="px-7 py-6">
            {[
              { label: 'Pedido recebido', time: 'agora', state: 'done' },
              { label: 'Preparando seu pedido', time: 'em andamento', state: 'current' },
              { label: 'Pedido pronto', time: '', state: 'pending' },
              { label: 'Saiu para entrega', time: '', state: 'pending' },
              { label: 'Entregue', time: '', state: 'pending' },
            ].map((step, index, arr) => (
              <div key={step.label} className="relative flex gap-3.5 pb-6 last:pb-0">
                {index < arr.length - 1 && (
                  <span className={`absolute left-[11px] top-6 h-full w-0.5 ${step.state === 'done' ? 'bg-status-ready' : 'bg-border'}`} />
                )}
                <span
                  className={[
                    'z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 bg-white',
                    step.state === 'done' ? 'border-status-ready bg-status-ready' : step.state === 'current' ? 'border-primary bg-primary' : 'border-border',
                  ].join(' ')}
                >
                  {step.state === 'done' && (
                    <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                    </svg>
                  )}
                </span>
                <div>
                  <div className={`text-sm font-semibold ${step.state === 'pending' ? 'text-text-subtle' : 'text-text-main'}`}>{step.label}</div>
                  {step.time && <div className="mt-0.5 text-xs text-text-subtle">{step.time}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="fixed bottom-0 left-1/2 w-full max-w-[600px] -translate-x-1/2 border-t border-border bg-white p-3.5">
            <button
              onClick={() => setTrackingId(null)}
              className="w-full rounded-menuzia bg-page px-5 py-3.5 text-[15px] font-bold text-text-main hover:bg-border"
            >
              Voltar ao cardápio
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
