'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  buscarRestaurantePorSlug,
  listarBairrosVitrine,
  listarCardapioPublico,
  listarOrderBumpsPublico,
  type GrupoComItens,
  type ItemCardapio,
  type LayoutCardapio,
  type RestauranteVitrine,
} from '@/lib/queries/cardapio'
import type { ClientePerfil, EnderecoCliente } from '@/lib/queries/clientes'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CartLine {
  key: string
  itemId: string
  name: string
  imagemUrl: string | null
  qty: number
  unit: number
  addons: { nome: string; preco: number }[]
  obs: string
}

interface ToastItem {
  id: string
  message: string
}

type Tab = 'home' | 'cart' | 'pedidos' | 'cupons'
type CheckoutStep = 1 | 2 | 3

// ─── Helpers ─────────────────────────────────────────────────────────────────

const brl = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`

function PriceTag({ price, originalPrice }: { price: number; originalPrice?: number | null }) {
  if (originalPrice) {
    const off = Math.round((1 - price / originalPrice) * 100)
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-price-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-price-text">-{off}% desconto</span>
        <span className="text-[13px] font-bold text-price-text">{brl(price)}</span>
        <span className="text-[11px] text-text-subtle line-through">{brl(originalPrice)}</span>
      </span>
    )
  }
  return <span className="text-[13px] font-bold text-text-main">{brl(price)}</span>
}

function ProductThumb({ item, size = 96 }: { item: Pick<ItemCardapio, 'nome' | 'imagemUrl'>; size?: number }) {
  if (item.imagemUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.imagemUrl}
        alt={item.nome}
        className="flex-shrink-0 rounded object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gradient-to-br from-amber-200 to-orange-300"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      <span className="font-extrabold text-white/80">{item.nome.charAt(0).toUpperCase()}</span>
    </div>
  )
}

function ProductImage({ item, className = '' }: { item: Pick<ItemCardapio, 'nome' | 'imagemUrl'>; className?: string }) {
  if (item.imagemUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={item.imagemUrl} alt={item.nome} className={`object-cover ${className}`} />
    )
  }
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-amber-200 to-orange-300 ${className}`}>
      <span className="text-3xl font-extrabold text-white/80">{item.nome.charAt(0).toUpperCase()}</span>
    </div>
  )
}

function ProductCard({ item, onClick, className = '' }: { item: ItemCardapio; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col overflow-hidden rounded-md border border-border bg-white text-left shadow-sm transition-all duration-150 hover:shadow-md active:scale-[0.98] ${className}`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-md">
        <ProductImage item={item} className="h-full w-full transition-transform duration-300 group-hover:scale-105" />
        {item.maisVendido && (
          <span className="absolute left-2.5 top-2.5 rounded bg-pink-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-pink-600 shadow-sm">Mais vendido</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="line-clamp-2 text-[14px] font-bold leading-snug text-text-main">{item.nome}</div>
        {item.descricao && (
          <p className="line-clamp-2 text-[12px] leading-relaxed text-text-subtle">{item.descricao}</p>
        )}
        <div className="pt-1">
          <PriceTag price={item.promocaoPreco ?? item.preco} originalPrice={item.promocaoPreco ? item.preco : null} />
        </div>
      </div>
    </button>
  )
}

function ProductListRow({ item, onClick }: { item: ItemCardapio; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-border bg-white px-3 py-3 text-left transition-colors last:border-none hover:bg-[#F9FAFB] active:bg-[#F3F4F6]"
    >
      <div className="min-w-0 flex-1">
        <div className="line-clamp-1 text-[14px] font-bold leading-snug text-text-main">{item.nome}</div>
        {item.descricao && (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-text-subtle">{item.descricao}</p>
        )}
        <div className="mt-1.5">
          <PriceTag price={item.promocaoPreco ?? item.preco} originalPrice={item.promocaoPreco ? item.preco : null} />
        </div>
      </div>
      <div className="relative flex-shrink-0">
        <ProductThumb item={item} size={76} />
        {item.maisVendido && (
          <span className="absolute left-1 top-1 rounded bg-pink-100 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-pink-600 shadow-sm">Mais vendido</span>
        )}
      </div>
    </button>
  )
}

function ItemsGrid({ items, layout, onSelect }: { items: ItemCardapio[]; layout: LayoutCardapio; onSelect: (item: ItemCardapio) => void }) {
  if (layout === 'lista') {
    return (
      <div className="overflow-hidden rounded border border-border bg-white">
        {items.map((item) => (
          <ProductListRow key={item.id} item={item} onClick={() => onSelect(item)} />
        ))}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4 xl:grid-cols-4">
      {items.map((item) => (
        <ProductCard key={item.id} item={item} onClick={() => onSelect(item)} />
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StorefrontPage() {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug ?? ''
  const supabase = useMemo(() => getBrowserSupabase(), [])

  // ── Data ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restaurante, setRestaurante] = useState<RestauranteVitrine | null>(null)
  const [groups, setGroups] = useState<GrupoComItens[]>([])
  const [bairros, setBairros] = useState<{ bairro: string; taxa: number }[]>([])
  const [orderBumps, setOrderBumps] = useState<ItemCardapio[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const loja = await buscarRestaurantePorSlug(supabase, slug)
        if (cancelled) return
        if (!loja) {
          setError('Não encontramos essa loja. Confira o endereço e tente novamente.')
          setLoading(false)
          return
        }
        setRestaurante(loja)
        const [cardapio, taxasBairro, bumps] = await Promise.all([
          listarCardapioPublico(supabase, loja.id),
          listarBairrosVitrine(supabase, loja.id),
          listarOrderBumpsPublico(supabase, loja.id, loja.orderBumpMax),
        ])
        if (cancelled) return
        setGroups(cardapio)
        setBairros(taxasBairro)
        setOrderBumps(bumps)
      } catch {
        if (!cancelled) setError('Não foi possível carregar o cardápio agora. Tente novamente em instantes.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (slug) load()
    return () => { cancelled = true }
  }, [supabase, slug])

  // ── Tracking pixel injection ───────────────────────────────────────────────
  useEffect(() => {
    if (!restaurante) return
    const { facebookPixelId: pixelId, googleTagId: tagId } = restaurante
    const scripts: HTMLScriptElement[] = []
    if (pixelId) {
      const s = document.createElement('script')
      s.id = 'fb-pixel'
      s.innerHTML = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`
      document.head.appendChild(s)
      scripts.push(s)
    }
    if (tagId) {
      const s = document.createElement('script')
      s.id = 'google-tag'
      s.async = true
      s.src = `https://www.googletagmanager.com/gtag/js?id=${tagId}`
      document.head.appendChild(s)
      scripts.push(s)
      const s2 = document.createElement('script')
      s2.id = 'google-tag-init'
      s2.innerHTML = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${tagId}');`
      document.head.appendChild(s2)
      scripts.push(s2)
    }
    return () => scripts.forEach((el) => el.parentNode?.removeChild(el))
  }, [restaurante])

  // ── Derived ───────────────────────────────────────────────────────────────
  const allItems = useMemo(() => groups.flatMap((g) => g.itens), [groups])
  const promoItems = useMemo(() => allItems.filter((item) => item.promocaoPreco !== null), [allItems])
  const destaques = useMemo(() => {
    if (promoItems.length > 0) return promoItems.slice(0, 8)
    const result: ItemCardapio[] = []
    for (const g of groups) {
      if (g.itens[0]) result.push(g.itens[0])
      if (result.length >= 8) break
    }
    return result
  }, [groups, promoItems])
  const collageImages = useMemo(() => allItems.filter((item) => item.imagemUrl).slice(0, 3), [allItems])

  // ── Navigation ────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('home')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)

  useEffect(() => {
    if (!activeCategory && groups.length > 0) setActiveCategory(groups[0].nome)
  }, [groups, activeCategory])

  // ── Cart ──────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartLine[]>([])

  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0)
  const subtotal = cart.reduce((sum, l) => sum + l.unit * l.qty, 0)

  // ── Checkout form state (hoisted so fee can access endereco) ───────────────
  const [endereco, setEndereco] = useState({ rua: '', numero: '', complemento: '', bairro: '', cep: '' })

  const fee = useMemo(() => {
    const padrao = restaurante?.taxaEntregaPadrao ?? 0
    const alvo = endereco.bairro.trim().toLowerCase()
    if (!alvo) return padrao
    const match = bairros.find((b) => b.bairro.trim().toLowerCase() === alvo)
    return match ? match.taxa : padrao
  }, [restaurante, bairros, endereco.bairro])

  const total = subtotal + (cart.length ? fee : 0)

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<ToastItem[]>([])
  function showToast(message: string) {
    const id = Date.now().toString()
    setToasts((prev) => [...prev, { id, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2600)
  }

  // ── Delivery banner (cidade via IP) + calculadora de frete (CEP) ───────────
  const [ipCidade, setIpCidade] = useState<string | null>(null)
  const [freteOpen, setFreteOpen] = useState(false)
  const [freteCep, setFreteCep] = useState('')
  const [freteLoading, setFreteLoading] = useState(false)
  const [freteError, setFreteError] = useState<string | null>(null)
  const [freteResult, setFreteResult] = useState<{ rua: string; bairro: string; cidade: string; taxa: number } | null>(null)

  useEffect(() => {
    fetch('/api/geo')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.cidade) setIpCidade(data.cidade) })
      .catch(() => {})
  }, [])

  async function calcularFrete() {
    const cepLimpo = freteCep.replace(/\D/g, '')
    if (cepLimpo.length !== 8) {
      setFreteError('Digite um CEP válido (8 dígitos).')
      return
    }
    setFreteLoading(true)
    setFreteError(null)
    setFreteResult(null)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`)
      const data = await res.json()
      if (data.erro) {
        setFreteError('CEP não encontrado.')
        return
      }
      const bairro = (data.bairro as string) || ''
      const cidade = (data.localidade as string) || ''
      const match = bairros.find((b) => b.bairro.trim().toLowerCase() === bairro.trim().toLowerCase())
      const taxa = match ? match.taxa : restaurante?.taxaEntregaPadrao ?? 0
      setFreteResult({ rua: (data.logradouro as string) || '', bairro, cidade, taxa })
    } catch {
      setFreteError('Não foi possível consultar o CEP agora. Tente novamente.')
    } finally {
      setFreteLoading(false)
    }
  }

  function usarEnderecoDoFrete() {
    if (!freteResult) return
    setEndereco((prev) => ({
      ...prev,
      rua: freteResult.rua || prev.rua,
      bairro: freteResult.bairro || prev.bairro,
      cep: freteCep.replace(/\D/g, ''),
    }))
    setFreteOpen(false)
    showToast('Endereço preenchido! Confira no checkout.')
  }

  // ── Conta do cliente (login por código enviado via WhatsApp) ───────────────
  const [clienteSessao, setClienteSessao] = useState<{ telefone: string; token: string } | null>(null)
  const [perfilCliente, setPerfilCliente] = useState<ClientePerfil | null>(null)
  const [contaOpen, setContaOpen] = useState(false)
  const [contaStep, setContaStep] = useState<'telefone' | 'codigo'>('telefone')
  const [contaTelefone, setContaTelefone] = useState('')
  const [contaCodigo, setContaCodigo] = useState('')
  const [contaNome, setContaNome] = useState('')
  const [contaEndereco, setContaEndereco] = useState<EnderecoCliente>({ rua: '', numero: '', complemento: '', bairro: '', cep: '' })
  const [contaLoading, setContaLoading] = useState(false)
  const [contaError, setContaError] = useState<string | null>(null)
  const [contaSaved, setContaSaved] = useState(false)
  const [contaEditando, setContaEditando] = useState(false)

  // Restaura sessão salva no navegador.
  useEffect(() => {
    if (!slug) return
    try {
      const raw = localStorage.getItem(`menuzia_cliente_${slug}`)
      if (raw) {
        const sessao = JSON.parse(raw)
        if (sessao?.telefone && sessao?.token) setClienteSessao(sessao)
      }
    } catch { /* sessão inválida, ignora */ }
  }, [slug])

  // Carrega o perfil salvo e pré-preenche o checkout.
  useEffect(() => {
    if (!clienteSessao || !slug) return
    let cancelled = false
    fetch(`/api/loja/${slug}/conta?telefone=${encodeURIComponent(clienteSessao.telefone)}&token=${encodeURIComponent(clienteSessao.token)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ClientePerfil | null) => {
        if (cancelled) return
        if (!data) {
          localStorage.removeItem(`menuzia_cliente_${slug}`)
          setClienteSessao(null)
          return
        }
        setPerfilCliente(data)
        setContaNome(data.nome)
        setContaEndereco(data.endereco)
        setContaEditando(!data.nome && !data.endereco.rua)
        setCliente((c) => ({ nome: data.nome || c.nome, telefone: data.telefone }))
        if (data.endereco.rua || data.endereco.bairro) setEndereco(data.endereco)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [clienteSessao, slug])

  async function enviarCodigoConta() {
    setContaLoading(true)
    setContaError(null)
    try {
      const res = await fetch(`/api/loja/${slug}/conta/codigo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: contaTelefone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível enviar o código.')
      setContaStep('codigo')
    } catch (err) {
      setContaError(err instanceof Error ? err.message : 'Não foi possível enviar o código.')
    } finally {
      setContaLoading(false)
    }
  }

  async function confirmarCodigoConta() {
    setContaLoading(true)
    setContaError(null)
    try {
      const res = await fetch(`/api/loja/${slug}/conta/verificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: contaTelefone, codigo: contaCodigo }),
      })
      const data: ClientePerfil & { error?: string } = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Código inválido.')
      localStorage.setItem(`menuzia_cliente_${slug}`, JSON.stringify({ telefone: data.telefone, token: data.token }))
      setClienteSessao({ telefone: data.telefone, token: data.token })
      setPerfilCliente(data)
      setContaNome(data.nome)
      setContaEndereco(data.endereco)
      setContaEditando(!data.nome && !data.endereco.rua)
      setContaCodigo('')
    } catch (err) {
      setContaError(err instanceof Error ? err.message : 'Código inválido.')
    } finally {
      setContaLoading(false)
    }
  }

  async function salvarPerfilConta() {
    if (!clienteSessao) return
    setContaLoading(true)
    setContaError(null)
    setContaSaved(false)
    try {
      const res = await fetch(`/api/loja/${slug}/conta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: clienteSessao.telefone, token: clienteSessao.token, nome: contaNome, endereco: contaEndereco }),
      })
      const data: ClientePerfil & { error?: string } = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível salvar.')
      setPerfilCliente(data)
      setCliente((c) => ({ nome: data.nome, telefone: data.telefone || c.telefone }))
      setEndereco(data.endereco)
      setContaSaved(true)
      setContaEditando(false)
    } catch (err) {
      setContaError(err instanceof Error ? err.message : 'Não foi possível salvar.')
    } finally {
      setContaLoading(false)
    }
  }

  function cancelarEdicaoConta() {
    if (!perfilCliente) return
    setContaNome(perfilCliente.nome)
    setContaEndereco(perfilCliente.endereco)
    setContaError(null)
    setContaEditando(false)
  }

  function sairConta() {
    if (!slug) return
    localStorage.removeItem(`menuzia_cliente_${slug}`)
    setClienteSessao(null)
    setPerfilCliente(null)
    setContaStep('telefone')
    setContaTelefone('')
    setContaCodigo('')
    setContaNome('')
    setContaEndereco({ rua: '', numero: '', complemento: '', bairro: '', cep: '' })
    setContaEditando(false)
    setContaSaved(false)
  }

  // ── Product sheet ─────────────────────────────────────────────────────────
  const [productSheet, setProductSheet] = useState<ItemCardapio | null>(null)
  const [qty, setQty] = useState(1)
  const [groupSelections, setGroupSelections] = useState<Map<string, Set<string>>>(new Map())
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set())
  const [obs, setObs] = useState('')

  function openProduct(item: ItemCardapio) {
    setProductSheet(item)
    setQty(1)
    setGroupSelections(new Map())
    setSelectedAddons(new Set())
    setObs('')
  }

  function selectRadio(grupoId: string, compId: string) {
    setGroupSelections((prev) => { const next = new Map(prev); next.set(grupoId, new Set([compId])); return next })
  }

  function toggleCheckbox(grupoId: string, compId: string, maxEscolhas: number) {
    setGroupSelections((prev) => {
      const next = new Map(prev)
      const cur = new Set(next.get(grupoId) ?? [])
      if (cur.has(compId)) cur.delete(compId)
      else if (cur.size < maxEscolhas) cur.add(compId)
      next.set(grupoId, cur)
      return next
    })
  }

  function toggleAddon(nome: string) {
    setSelectedAddons((prev) => { const next = new Set(prev); if (next.has(nome)) next.delete(nome); else next.add(nome); return next })
  }

  const gruposValidos = useMemo(() => {
    if (!productSheet) return true
    return productSheet.grupos.every((g) => {
      if (!g.obrigatorio) return true
      const sel = groupSelections.get(g.id) ?? new Set()
      return sel.size >= g.minEscolhas
    })
  }, [productSheet, groupSelections])

  const addonsTotal = useMemo(() => {
    if (!productSheet) return 0
    let sum = 0
    for (const grupo of productSheet.grupos) {
      const sel = groupSelections.get(grupo.id) ?? new Set()
      for (const compId of sel) {
        const comp = grupo.complementos.find((c) => c.id === compId)
        if (comp) sum += comp.preco
      }
    }
    for (const comp of productSheet.complementos) {
      if (selectedAddons.has(comp.nome)) sum += comp.preco
    }
    return sum
  }, [productSheet, groupSelections, selectedAddons])

  const basePrice = productSheet ? productSheet.promocaoPreco ?? productSheet.preco : 0
  const unitPrice = basePrice + addonsTotal

  function addToCart() {
    if (!productSheet || !gruposValidos) return
    const addonsList: { nome: string; preco: number }[] = []
    for (const grupo of productSheet.grupos) {
      const sel = groupSelections.get(grupo.id) ?? new Set()
      for (const compId of sel) {
        const comp = grupo.complementos.find((c) => c.id === compId)
        if (comp) addonsList.push({ nome: comp.nome, preco: comp.preco })
      }
    }
    for (const comp of productSheet.complementos) {
      if (selectedAddons.has(comp.nome)) addonsList.push({ nome: comp.nome, preco: comp.preco })
    }
    setCart((prev) => [
      ...prev,
      {
        key: `${productSheet.id}-${Date.now()}`,
        itemId: productSheet.id,
        name: productSheet.nome,
        imagemUrl: productSheet.imagemUrl,
        qty,
        unit: unitPrice,
        addons: addonsList,
        obs,
      },
    ])
    showToast(`${productSheet.nome} adicionado!`)
    setProductSheet(null)
    setTab('cart')
  }

  // ── Order bump quick-add ──────────────────────────────────────────────────
  function quickAddOrderBump(item: ItemCardapio) {
    if (item.grupos.some((g) => g.obrigatorio)) {
      openProduct(item)
      return
    }
    setCart((prev) => {
      const existingIdx = prev.findIndex((l) => l.itemId === item.id && l.addons.length === 0)
      if (existingIdx >= 0) {
        return prev.map((l, i) => (i === existingIdx ? { ...l, qty: l.qty + 1 } : l))
      }
      return [
        ...prev,
        {
          key: `bump-${item.id}-${Date.now()}`,
          itemId: item.id,
          name: item.nome,
          imagemUrl: item.imagemUrl,
          qty: 1,
          unit: item.promocaoPreco ?? item.preco,
          addons: [],
          obs: '',
        },
      ]
    })
    showToast(`${item.nome} adicionado!`)
  }

  function changeLineQty(key: string, delta: number) {
    setCart((prev) =>
      prev.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0)
    )
  }

  // ── Checkout ──────────────────────────────────────────────────────────────
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>(1)
  const [payMethod, setPayMethod] = useState('Pix')
  const [changeFor, setChangeFor] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [cliente, setCliente] = useState({ nome: '', telefone: '' })

  // ── Lock background scroll while a full-screen overlay is open ────────────
  useEffect(() => {
    const open = !!productSheet || checkoutOpen || freteOpen || contaOpen || infoOpen
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [productSheet, checkoutOpen, freteOpen, contaOpen, infoOpen])

  // ── Order tracking ────────────────────────────────────────────────────────
  const [pedidoId, setPedidoId] = useState<string | null>(null)
  const [pedidoStatus, setPedidoStatus] = useState<string>('recebido')
  const [trackingNr, setTrackingNr] = useState<string | null>(null)

  useEffect(() => {
    if (!pedidoId) return
    let active = true
    const tick = async () => {
      try {
        const res = await fetch(`/api/loja/${slug}/pedido/${pedidoId}`)
        if (!res.ok) return
        const data = await res.json()
        if (active && data.status) setPedidoStatus(data.status)
      } catch { /* keep last status */ }
    }
    tick()
    const interval = setInterval(tick, 5000)
    return () => { active = false; clearInterval(interval) }
  }, [pedidoId, slug])

  const PAY_MAP: Record<string, 'pix' | 'cartao' | 'dinheiro'> = {
    Pix: 'pix',
    'Cartão na entrega': 'cartao',
    Dinheiro: 'dinheiro',
  }

  function parseMoney(value: string): number | null {
    const n = Number(value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.').trim())
    return Number.isFinite(n) && n > 0 ? n : null
  }

  async function submitOrder() {
    setSubmitting(true)
    setCheckoutError(null)
    try {
      const payload = {
        tipo: 'entrega' as const,
        cliente: { nome: cliente.nome.trim(), telefone: cliente.telefone.trim() },
        endereco,
        pagamento: PAY_MAP[payMethod] ?? 'pix',
        trocoPara: payMethod === 'Dinheiro' ? parseMoney(changeFor) : null,
        taxaEntrega: fee,
        itens: cart.map((l) => ({
          itemId: l.itemId,
          quantidade: l.qty,
          observacao: l.obs,
          complementos: l.addons.map((a) => a.nome),
        })),
      }
      const res = await fetch(`/api/loja/${slug}/pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível enviar o pedido.')
      setTrackingNr(`#${data.numero}`)
      setPedidoId(data.id)
      setPedidoStatus('recebido')
      setCheckoutOpen(false)
      setCart([])
      setTab('pedidos')
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Não foi possível enviar o pedido.')
    } finally {
      setSubmitting(false)
    }
  }

  function checkoutNext() {
    if (checkoutStep === 2 && (!cliente.nome.trim() || !endereco.rua.trim() || !endereco.numero.trim())) {
      setCheckoutError('Preencha nome, rua e número para continuar.')
      return
    }
    setCheckoutError(null)
    if (checkoutStep < 3) { setCheckoutStep((s) => (s + 1) as CheckoutStep); return }
    submitOrder()
  }

  function checkoutBack() {
    if (checkoutStep > 1) setCheckoutStep((s) => (s - 1) as CheckoutStep)
    else setCheckoutOpen(false)
  }

  // ── Loading / error ────────────────────────────────────────────────────────
  if (loading) {
    return <div className="font-loja flex min-h-dvh items-center justify-center bg-[#F3F4F6] text-sm text-text-subtle">Carregando cardápio…</div>
  }
  if (error || !restaurante) {
    return (
      <div className="font-loja flex min-h-dvh items-center justify-center bg-[#F3F4F6] p-6">
        <div className="max-w-sm rounded border border-border bg-white p-5 text-center">
          <h1 className="text-sm font-bold text-danger">Loja indisponível</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-text-subtle">{error}</p>
        </div>
      </div>
    )
  }

  const storeName = restaurante.nome

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="font-loja min-h-dvh bg-[#F3F4F6] text-text-main">
      <style>{`@keyframes toast-pop{from{opacity:0;transform:translateY(8px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>

      {/* ── Desktop top nav ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 hidden border-b border-border bg-white lg:block">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-2 px-8">
          <div className="flex items-center gap-2.5 font-extrabold tracking-tight">
            {restaurante.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={restaurante.logoUrl} alt={storeName} className="h-8 w-8 rounded object-cover" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded bg-gradient-to-br from-[#008fba] to-[#007599] text-sm font-extrabold text-white">
                {storeName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="text-[15px]">{storeName}</span>
          </div>
          <nav className="ml-6 flex items-center gap-1">
            {([
              { id: 'home' as Tab, label: 'Cardápio' },
              { id: 'pedidos' as Tab, label: 'Pedidos' },
              { id: 'cupons' as Tab, label: 'Cupons' },
            ] as const).map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={['rounded px-3.5 py-2 text-[13px] font-semibold transition-colors', tab === item.id ? 'bg-[#F3F4F6] text-[#008fba]' : 'text-text-subtle hover:text-text-main'].join(' ')}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <button
            onClick={() => setTab('cart')}
            className={['ml-auto flex items-center gap-2.5 rounded border px-4 py-2 text-[13px] font-bold transition-colors', tab === 'cart' ? 'border-[#008fba] bg-[#008fba] text-white' : 'border-border bg-white text-text-main hover:border-[#008fba]'].join(' ')}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96C5 16.1 6.9 18 9 18h12v-2H9.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63H19c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z" /></svg>
            Sacola
            {cartCount > 0 && <span className="rounded bg-white/20 px-1.5 py-0.5 text-[11px]">{cartCount}</span>}
            {cartCount > 0 && <span>{brl(total)}</span>}
          </button>
        </div>
      </header>

      <div className="relative mx-auto min-h-dvh max-w-[600px] bg-[#F3F4F6] pb-24 lg:max-w-[1280px] lg:pb-16">

        {/* ── HOME header: cover banner + profile + search + category nav ── */}
        {tab === 'home' && (
          <>
            {/* Cover banner */}
            <div className="h-40 w-full overflow-hidden sm:h-56 lg:mx-8 lg:mt-6 lg:h-72 lg:rounded-md">
              {restaurante.bannerUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={restaurante.bannerUrl} alt={storeName} className="h-full w-full object-cover" />
              ) : collageImages[0] ? (
                <ProductImage item={collageImages[0]} className="h-full w-full" />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-[#22D3EE] via-[#008fba] to-[#007599]" />
              )}
            </div>

            {/* Profile photo overlapping the banner + store info */}
            <div className="px-4 lg:px-8">
              <div className="-mt-6 flex items-end gap-3.5 sm:-mt-8 lg:-mt-10">
                <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md border-4 border-white bg-white shadow-md sm:h-24 sm:w-24 lg:h-28 lg:w-28">
                  {restaurante.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={restaurante.logoUrl} alt={storeName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#008fba] to-[#007599] text-3xl font-extrabold text-white">
                      {storeName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 items-start justify-between gap-2 pb-1.5">
                  <div className="min-w-0">
                    <h1 className="-mx-2 line-clamp-2 break-words rounded bg-white px-2 py-0.5 text-[17px] font-extrabold leading-[1.2] tracking-tight text-text-main sm:text-[22px] sm:leading-snug lg:text-[26px]">{storeName}</h1>
                    <div className="-mx-2 mt-1.5 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-white px-2 py-1 text-xs font-medium text-text-subtle sm:text-[13px]">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#1cce93]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#1cce93]" /> Aberto agora
                      </span>
                      <span>⏱ 30–45 min</span>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      onClick={() => setSearchOpen((v) => !v)}
                      className="flex h-9 w-9 items-center justify-center rounded-md bg-white shadow-sm"
                      aria-label="Buscar no cardápio"
                    >
                      <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] flex-shrink-0 fill-text-subtle/60">
                        <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 119.5 5a4.5 4.5 0 010 9z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setInfoOpen(true)}
                      className="flex h-9 w-9 items-center justify-center rounded-md bg-white shadow-sm"
                      aria-label="Informações da loja"
                    >
                      <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] flex-shrink-0 fill-text-subtle/60">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Search (collapsible) + delivery banner */}
            <div className="mx-4 mt-4 space-y-3 lg:mx-8">
              {searchOpen && (
                <div className="flex items-center gap-2.5 rounded-md bg-white px-4 py-3 shadow-sm">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] flex-shrink-0 fill-text-subtle/60">
                    <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 119.5 5a4.5 4.5 0 010 9z" />
                  </svg>
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar no cardápio…"
                    className="w-full border-none bg-transparent font-sans text-sm text-text-main outline-none placeholder:text-text-subtle"
                  />
                  <button onClick={() => { setSearch(''); setSearchOpen(false) }} className="text-text-subtle hover:text-text-main">×</button>
                </div>
              )}

              {/* Delivery banner */}
              <button
                onClick={() => setFreteOpen(true)}
                className="flex w-full items-center gap-2.5 rounded-md border border-[#BAE6FD] bg-[#E0F2FE] px-4 py-3 text-left shadow-sm"
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] flex-shrink-0 fill-[#0369A1]">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" />
                </svg>
                <span className="flex-1 text-[13px] font-medium text-[#0369A1]">
                  {ipCidade ? `Entregamos em ${ipCidade}` : 'Calcular frete e prazo de entrega'}
                </span>
                <span className="flex-shrink-0 whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-[#0369A1] underline">
                  Calcular frete
                </span>
              </button>
            </div>

            {/* Category nav */}
            <div className="sticky top-0 z-10 mt-4 flex gap-2 overflow-x-auto bg-[#F3F4F6] px-4 py-3 [scrollbar-width:none] lg:top-16 lg:mx-8">
              {promoItems.length > 0 && (
                <button
                  onClick={() => setActiveCategory('__promos__')}
                  className={['flex-shrink-0 whitespace-nowrap rounded border px-3.5 py-1.5 text-[13px] font-semibold transition-colors', activeCategory === '__promos__' ? 'border-[#1cce93] bg-[#D1FAE5] text-[#1cce93]' : 'border-border bg-white text-text-subtle hover:border-[#008fba] hover:text-[#008fba]'].join(' ')}
                >
                  🏷️ Promoções
                </button>
              )}
              {groups.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => { setActiveCategory(cat.nome); document.getElementById(`sec-${cat.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
                  className={['flex-shrink-0 whitespace-nowrap rounded border px-3.5 py-1.5 text-[13px] font-semibold transition-colors', activeCategory === cat.nome ? 'border-[#008fba] bg-[#008fba] text-white' : 'border-border bg-white text-text-subtle hover:border-[#008fba] hover:text-[#008fba]'].join(' ')}
                >
                  {cat.nome}
                </button>
              ))}
            </div>

            {/* Destaques */}
            {destaques.length > 0 && activeCategory !== '__promos__' && !search.trim() && (
              <div className="px-4 pb-1 pt-4 lg:px-8">
                <h2 className="mb-3 text-[17px] font-bold tracking-tight">Destaques</h2>
                <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible xl:grid-cols-4">
                  {destaques.map((item) => (
                    <ProductCard key={item.id} item={item} onClick={() => openProduct(item)} className="w-[150px] flex-shrink-0 lg:w-auto" />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── CART header: minimal ── */}
        {tab === 'cart' && (
          <div className="flex h-14 items-center gap-3.5 border-b border-border bg-white px-4 lg:hidden">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Sua sacola</div>
              <div className="truncate text-[14px] font-bold">{storeName}</div>
            </div>
            <button
              onClick={() => setTab('home')}
              className="flex flex-shrink-0 items-center gap-1.5 rounded border border-border bg-white px-3 py-2 text-[12px] font-semibold text-text-subtle transition-colors hover:border-[#008fba] hover:text-[#008fba] active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" /></svg>
              Continuar comprando
            </button>
          </div>
        )}

        {tab === 'pedidos' && (
          <div className="flex h-14 items-center border-b border-border bg-white px-4 lg:hidden">
            <h2 className="text-base font-bold">Meus pedidos</h2>
          </div>
        )}
        {tab === 'cupons' && (
          <div className="flex h-14 items-center border-b border-border bg-white px-4 lg:hidden">
            <h2 className="text-base font-bold">Cupons</h2>
          </div>
        )}

        {/* ── HOME tab ──────────────────────────────────────────────────── */}
        {tab === 'home' && (
          <div>
            {/* Promo filter view */}
            {activeCategory === '__promos__' && (
              <div className="px-4 pb-1 pt-4 lg:px-8">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-[17px] font-bold tracking-tight">Promoções</h2>
                  <span className="rounded bg-[#D1FAE5] px-2 py-0.5 text-[11px] font-bold text-[#1cce93]">{promoItems.length} itens</span>
                </div>
                <ItemsGrid items={promoItems} layout={restaurante.layoutCardapio} onSelect={openProduct} />
              </div>
            )}

            {/* Regular categories (or search results) */}
            {activeCategory !== '__promos__' &&
              (search.trim()
                ? groups.map((g) => ({ ...g, itens: g.itens.filter((i) => i.nome.toLowerCase().includes(search.toLowerCase())) })).filter((g) => g.itens.length > 0)
                : groups
              ).map((cat) => (
                <div key={cat.id} id={`sec-${cat.id}`} className="px-4 pb-1 pt-4 lg:px-8">
                  <h2 className="mb-3 text-[17px] font-bold tracking-tight">{cat.nome}</h2>
                  <ItemsGrid items={cat.itens} layout={restaurante.layoutCardapio} onSelect={openProduct} />
                </div>
              ))}
            {search.trim() && groups.every((g) => !g.itens.some((i) => i.nome.toLowerCase().includes(search.toLowerCase()))) && (
              <div className="px-4 py-16 text-center text-sm text-text-subtle lg:px-8">Nenhum item encontrado para &ldquo;{search}&rdquo;.</div>
            )}
          </div>
        )}

        {/* ── CART tab ──────────────────────────────────────────────────── */}
        {tab === 'cart' && (
          <div className="px-4 pt-5 lg:px-8 lg:pt-8">
            {cart.length === 0 ? (
              <div className="py-20 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-3xl">🛍️</div>
                <p className="font-semibold text-text-main">Sua sacola está vazia</p>
                <p className="mt-1 text-[13px] text-text-subtle">Escolha seus itens favoritos no cardápio.</p>
                <button onClick={() => setTab('home')} className="mt-5 rounded bg-[#008fba] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#007599]">
                  Ver cardápio
                </button>
              </div>
            ) : (
              <div className="lg:grid lg:grid-cols-[1fr_360px] lg:items-start lg:gap-6">
                <div>
                  <p className="mb-4 text-[12px] font-semibold uppercase tracking-wide text-text-subtle">
                    {cartCount} item{cartCount !== 1 ? 's' : ''} no carrinho
                  </p>

                  {/* Lines */}
                  <div className="mb-5 overflow-hidden rounded border border-border bg-white">
                    {cart.map((line, i) => (
                      <div key={line.key} className={['flex gap-3.5 p-3.5', i < cart.length - 1 ? 'border-b border-border' : ''].join(' ')}>
                        <div className="h-[54px] w-[54px] flex-shrink-0 overflow-hidden rounded">
                          <ProductThumb item={{ nome: line.name, imagemUrl: line.imagemUrl }} size={54} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px] font-semibold">{line.name}</div>
                          {line.addons.length > 0 && (
                            <div className="mt-0.5 text-[12px] leading-relaxed text-text-subtle">{line.addons.map((a) => a.nome).join(', ')}</div>
                          )}
                          {line.obs && <div className="mt-0.5 text-[12px] italic text-text-subtle">&ldquo;{line.obs}&rdquo;</div>}
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-[14px] font-bold text-[#1cce93]">{brl(line.unit * line.qty)}</span>
                            <div className="flex items-center rounded border border-border">
                              <button onClick={() => changeLineQty(line.key, -1)} className="flex h-[32px] w-[32px] items-center justify-center text-lg font-semibold text-[#008fba] hover:bg-[#F3F4F6] active:bg-border">−</button>
                              <span className="w-[26px] text-center text-[13px] font-bold">{line.qty}</span>
                              <button onClick={() => changeLineQty(line.key, 1)} className="flex h-[32px] w-[32px] items-center justify-center text-lg font-semibold text-[#008fba] hover:bg-[#F3F4F6] active:bg-border">+</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Order bumps — "Peça também" */}
                  {orderBumps.length > 0 && (
                    <div className="mb-5">
                      <h3 className="mb-3 text-[15px] font-bold tracking-tight">Peça também</h3>
                      <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-wrap">
                        {orderBumps.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => quickAddOrderBump(item)}
                            className="group flex w-[142px] flex-shrink-0 flex-col overflow-hidden rounded border border-border bg-white transition-all duration-150 hover:border-[#008fba] hover:shadow-lg active:scale-[0.97]"
                          >
                            <div className="h-[100px] w-full overflow-hidden">
                              <ProductThumb item={item} size={142} />
                            </div>
                            <div className="flex flex-1 flex-col p-2.5">
                              <div className="line-clamp-2 min-h-[34px] text-[12px] font-semibold leading-snug text-text-main">{item.nome}</div>
                              <div className="mt-1 text-[12px] font-bold text-[#1cce93]">{brl(item.promocaoPreco ?? item.preco)}</div>
                              <div className="mt-2 rounded bg-[#008fba] py-1.5 text-center text-[11px] font-bold tracking-wide text-white transition-colors group-hover:bg-[#007599]">
                                + Adicionar
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="lg:sticky lg:top-24">
                  {/* Summary */}
                  <div className="mb-5 overflow-hidden rounded border border-border bg-white">
                    <div className="flex items-center justify-between px-4 py-3 text-[13px] text-text-subtle">
                      <span>Subtotal</span><span>{brl(subtotal)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[13px] text-text-subtle">
                      <span>Taxa de entrega</span><span>{brl(fee)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border px-4 py-3.5 text-[15px] font-bold">
                      <span>Total</span><span className="text-[#1cce93]">{brl(total)}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => { setCheckoutOpen(true); setCheckoutStep(1); setCheckoutError(null) }}
                    className="flex w-full items-center justify-between rounded bg-[#008fba] px-5 py-3 text-[15px] font-bold text-white transition-colors hover:bg-[#007599] active:scale-[0.99]"
                  >
                    <span>Continuar para pagamento</span>
                    <span>{brl(total)}</span>
                  </button>
                  <button
                    onClick={() => setTab('home')}
                    className="mt-2.5 flex w-full items-center justify-center rounded bg-[#1F2937] px-5 py-3 text-[15px] font-bold text-white transition-colors hover:bg-[#111827] active:scale-[0.99]"
                  >
                    Continuar comprando
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PEDIDOS tab ───────────────────────────────────────────────── */}
        {tab === 'pedidos' && (
          <div className="px-4 pt-6 lg:mx-auto lg:max-w-2xl lg:px-8 lg:pt-10">
            {trackingNr ? (
              <>
                <div className="mb-5 rounded border border-border bg-white p-5 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#D1FAE5]">
                    <svg viewBox="0 0 24 24" className="h-7 w-7 fill-status-ready"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
                  </div>
                  <div className="text-[16px] font-bold">Pedido {trackingNr} confirmado!</div>
                  <div className="mt-0.5 text-[12px] text-text-subtle">{storeName} · Chega em ~35 min</div>
                </div>
                <div className="rounded border border-border bg-white p-5">
                  {(['recebido', 'preparando', 'pronto', 'em_rota', 'entregue'] as const).map((step, i, arr) => {
                    const labels = ['Pedido recebido', 'Preparando seu pedido', 'Pronto para despacho', 'Saiu para entrega', 'Entregue!']
                    const statusIdx = arr.indexOf(pedidoStatus as typeof step)
                    const state = i < statusIdx ? 'done' : i === statusIdx ? 'active' : 'pending'
                    return (
                      <div key={step} className="relative flex gap-3.5 pb-6 last:pb-0">
                        {i < arr.length - 1 && <span className={`absolute left-[11px] top-6 h-full w-0.5 ${state === 'done' ? 'bg-status-ready' : 'bg-border'}`} />}
                        <span className={['z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 bg-white', state === 'done' ? 'border-status-ready bg-status-ready' : state === 'active' ? 'border-[#008fba] bg-[#008fba]' : 'border-border'].join(' ')}>
                          {state !== 'pending' && <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>}
                        </span>
                        <div>
                          <div className={`text-sm font-semibold ${state === 'pending' ? 'text-text-subtle' : 'text-text-main'}`}>{labels[i]}</div>
                          {state === 'active' && <div className="mt-0.5 text-[12px] text-[#008fba]">Em andamento…</div>}
                          {state === 'done' && <div className="mt-0.5 text-[12px] text-status-ready">Concluído</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="py-20 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-3xl">📦</div>
                <p className="font-semibold text-text-main">Nenhum pedido ativo</p>
                <p className="mt-1 text-[13px] text-text-subtle">Quando você finalizar um pedido, o acompanhamento aparece aqui.</p>
                <button onClick={() => setTab('home')} className="mt-5 rounded bg-[#008fba] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#007599]">
                  Ver cardápio
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── CUPONS tab ────────────────────────────────────────────────── */}
        {tab === 'cupons' && (
          <div className="px-4 pt-6 lg:mx-auto lg:max-w-2xl lg:px-8 lg:pt-10">
            <div className="rounded border border-dashed border-border py-20 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F3F4F6] text-3xl">🏷️</div>
              <p className="font-semibold text-text-main">Cupons em breve</p>
              <p className="mx-auto mt-1.5 max-w-[240px] text-[13px] leading-relaxed text-text-subtle">
                Em breve você poderá usar cupons de desconto nessa loja.
              </p>
            </div>
          </div>
        )}

        {/* ── Floating cart bar (mobile only) ──────────────────────────── */}
        {cartCount > 0 && tab !== 'cart' && (
          <button
            onClick={() => setTab('cart')}
            className="fixed bottom-[78px] left-1/2 z-30 flex w-[calc(100%-2rem)] max-w-[568px] -translate-x-1/2 items-center justify-between rounded-md bg-[#111827] px-4 py-3.5 text-white shadow-lg lg:hidden"
          >
            <span className="flex items-center gap-2.5 text-sm font-bold">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-[12px] font-bold">{cartCount}</span>
              Ver carrinho
            </span>
            <span className="text-sm font-bold">{brl(total)}</span>
          </button>
        )}

        {/* ── Bottom nav (mobile only) ─────────────────────────────────── */}
        <nav className="fixed bottom-0 left-1/2 z-30 w-full max-w-[600px] -translate-x-1/2 border-t border-border bg-white pb-[max(env(safe-area-inset-bottom),6px)] pt-1 shadow-[0_-4px_20px_rgba(0,0,0,0.07)] lg:hidden">
          <div className="flex">
            {([
              { id: 'home' as Tab, label: 'Home', onClick: () => setTab('home'), active: tab === 'home', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-[22px] w-[22px]"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.5 1.5 0 012.122 0l8.954 8.955M4.5 9.75v10.125a.75.75 0 00.75.75H9a.75.75 0 00.75-.75v-4.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75v4.5c0 .414.336.75.75.75h3.75a.75.75 0 00.75-.75V9.75" /></svg> },
              { id: 'pedidos' as Tab, label: 'Pedidos', onClick: () => setTab('pedidos'), active: tab === 'pedidos', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-[22px] w-[22px]"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6M9 15.75h6M9 19.5h6M5.25 5.25h13.5A1.5 1.5 0 0120.25 6.75v13.5a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5V6.75a1.5 1.5 0 011.5-1.5zM9 5.25V3.75a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75v1.5" /></svg> },
              { id: 'cupons' as Tab, label: 'Cupons', onClick: () => setTab('cupons'), active: tab === 'cupons', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-[22px] w-[22px]"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v3m0 3v3m0 3v1.5m-9-12.75h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" /></svg> },
              {
                id: 'perfil' as const,
                label: perfilCliente ? 'Perfil' : 'Entrar',
                onClick: () => setContaOpen(true),
                active: contaOpen,
                icon: perfilCliente ? (
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#008fba] text-[11px] font-bold text-white">
                    {(perfilCliente.nome || perfilCliente.telefone).charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className="h-[22px] w-[22px]"><path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.964 0a9 9 0 10-11.964 0m11.964 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                ),
              },
            ] as const).map((item) => (
              <button
                key={item.id}
                onClick={item.onClick}
                className={['relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors', item.active ? 'text-[#008fba]' : 'text-text-subtle hover:text-text-main'].join(' ')}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      </div>

      {/* ── Product sheet overlay ─────────────────────────────────────── */}
      {productSheet && <div className="fixed inset-0 z-40 bg-[#111827]/60" onClick={() => setProductSheet(null)} />}
      <div className={['fixed inset-y-0 left-1/2 z-50 flex h-dvh w-full max-w-[600px] -translate-x-1/2 flex-col overflow-hidden bg-white transition-all duration-300 lg:inset-y-auto lg:bottom-auto lg:top-1/2 lg:h-auto lg:max-h-[85vh] lg:max-w-[520px] lg:-translate-y-1/2 lg:rounded', productSheet ? 'translate-y-0 lg:opacity-100 lg:scale-100' : 'translate-y-full lg:opacity-0 lg:scale-95 lg:pointer-events-none'].join(' ')}>
        {productSheet && (
          <>
            <button onClick={() => setProductSheet(null)} className="absolute right-3.5 top-3 z-10 flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/90 text-xl font-light shadow-md">×</button>
            <div className="flex-1 overflow-y-auto">
              {productSheet.imagemUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={productSheet.imagemUrl} alt={productSheet.nome} className="h-[42vh] w-full object-cover lg:h-[260px]" />
                : <div className="flex h-[42vh] items-center justify-center bg-gradient-to-br from-amber-200 to-orange-300 text-6xl font-extrabold text-white/70 lg:h-[260px]">{productSheet.nome.charAt(0)}</div>
              }
              <div className="p-4.5">
                <h2 className="text-xl font-bold tracking-tight">{productSheet.nome}</h2>
                <p className="my-2 text-sm leading-relaxed text-text-subtle">{productSheet.descricao}</p>
                <PriceTag price={productSheet.promocaoPreco ?? productSheet.preco} originalPrice={productSheet.promocaoPreco ? productSheet.preco : null} />

                {productSheet.grupos.map((grupo) => {
                  const sel = groupSelections.get(grupo.id) ?? new Set()
                  const isRadio = grupo.maxEscolhas === 1
                  const showError = grupo.obrigatorio && sel.size > 0 && sel.size < grupo.minEscolhas
                  return (
                    <div key={grupo.id} className="mt-5">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold">{grupo.nome}</h3>
                          <div className="mt-0.5 text-[11px] text-text-subtle">
                            {grupo.obrigatorio
                              ? grupo.minEscolhas === grupo.maxEscolhas ? `Escolha ${grupo.minEscolhas}` : `Escolha ${grupo.minEscolhas}–${grupo.maxEscolhas}`
                              : grupo.maxEscolhas === 1 ? 'Opcional' : `Até ${grupo.maxEscolhas}`}
                          </div>
                        </div>
                        <span className={['mt-0.5 flex-shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase', grupo.obrigatorio ? 'bg-danger-bg text-danger' : 'bg-[#F3F4F6] text-text-subtle'].join(' ')}>
                          {grupo.obrigatorio ? 'Obrigatório' : 'Opcional'}
                        </span>
                      </div>
                      {!isRadio && grupo.maxEscolhas > 1 && (
                        <div className="mb-1.5 text-[11px] text-text-subtle">{sel.size}/{grupo.maxEscolhas} selecionado{sel.size !== 1 ? 's' : ''}</div>
                      )}
                      {grupo.complementos.map((comp) => {
                        const isSelected = sel.has(comp.id)
                        return (
                          <button key={comp.id} onClick={() => isRadio ? selectRadio(grupo.id, comp.id) : toggleCheckbox(grupo.id, comp.id, grupo.maxEscolhas)} className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left last:border-none">
                            <span className="flex-1 text-sm font-medium">{comp.nome}</span>
                            {comp.preco > 0
                              ? <span className="text-[13px] font-semibold text-[#1cce93]">+ {brl(comp.preco)}</span>
                              : <span className="rounded bg-[#D1FAE5] px-1.5 py-0.5 text-[11px] font-bold text-[#1cce93]">Grátis</span>
                            }
                            {isRadio ? (
                              <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2', isSelected ? 'border-[#008fba] bg-[#008fba]' : 'border-border'].join(' ')}>
                                {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                              </span>
                            ) : (
                              <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2', isSelected ? 'border-[#008fba] bg-[#008fba]' : 'border-border'].join(' ')}>
                                {isSelected && <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>}
                              </span>
                            )}
                          </button>
                        )
                      })}
                      {showError && (
                        <div className="mt-1.5 rounded border border-danger/30 bg-danger-bg px-2.5 py-1.5 text-[11px] font-medium text-danger">
                          Selecione ao menos {grupo.minEscolhas} item{grupo.minEscolhas > 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  )
                })}

                {productSheet.complementos.length > 0 && (
                  <div className="mt-5">
                    <div className="mb-2.5 flex items-center justify-between">
                      <h3 className="text-sm font-bold">Adicionais</h3>
                      <span className="rounded bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-bold uppercase text-text-subtle">Opcional</span>
                    </div>
                    {productSheet.complementos.map((addon) => (
                      <button key={addon.id} onClick={() => toggleAddon(addon.nome)} className="flex w-full items-center gap-3 border-b border-border py-2.5 text-left last:border-none">
                        <span className="flex-1 text-sm font-medium">{addon.nome}</span>
                        {addon.preco > 0
                          ? <span className="text-[13px] font-semibold text-[#1cce93]">+ {brl(addon.preco)}</span>
                          : <span className="rounded bg-[#D1FAE5] px-1.5 py-0.5 text-[11px] font-bold text-[#1cce93]">Grátis</span>
                        }
                        <span className={['flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2', selectedAddons.has(addon.nome) ? 'border-[#008fba] bg-[#008fba]' : 'border-border'].join(' ')}>
                          {selectedAddons.has(addon.nome) && <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-5">
                  <h3 className="mb-2.5 text-sm font-bold">Observações</h3>
                  <textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex: sem cebola, ponto da batata…" className="min-h-[60px] w-full resize-none rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                </div>
              </div>
            </div>
            <div className="flex flex-shrink-0 flex-col gap-2 border-t border-border p-4.5 pb-[max(env(safe-area-inset-bottom),1.125rem)]">
              {!gruposValidos && <p className="text-center text-[11px] font-medium text-danger">Preencha todos os campos obrigatórios para continuar.</p>}
              <div className="flex items-center gap-3.5">
                <div className="flex items-center rounded border border-border">
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} className="flex h-[44px] w-[40px] items-center justify-center text-xl font-semibold text-[#008fba] disabled:text-border">−</button>
                  <span className="w-[34px] text-center text-[15px] font-bold">{qty}</span>
                  <button onClick={() => setQty((q) => q + 1)} className="flex h-[44px] w-[40px] items-center justify-center text-xl font-semibold text-[#008fba]">+</button>
                </div>
                <button
                  onClick={addToCart}
                  disabled={!gruposValidos}
                  className={['flex flex-1 items-center justify-between rounded px-4 py-3.5 text-[15px] font-bold text-white transition-colors', gruposValidos ? 'bg-[#008fba] hover:bg-[#007599] active:scale-[0.99]' : 'cursor-not-allowed bg-border'].join(' ')}
                >
                  <span>Adicionar</span>
                  <span>{brl(unitPrice * qty)}</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Checkout screen ───────────────────────────────────────────── */}
      <div className={`fixed inset-0 z-[60] overflow-y-auto bg-[#F3F4F6] transition-all duration-300 lg:flex lg:items-center lg:justify-center lg:overflow-hidden lg:bg-black/50 lg:p-6 lg:translate-x-0 ${checkoutOpen ? 'translate-x-0 lg:opacity-100' : 'translate-x-full lg:opacity-0 lg:pointer-events-none'}`}>
        <div className="mx-auto min-h-dvh max-w-[600px] bg-white pb-28 lg:min-h-0 lg:max-h-[85vh] lg:w-full lg:overflow-y-auto lg:rounded lg:pb-0 lg:shadow-2xl">
          <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-white px-3.5">
            <button onClick={checkoutBack} className="flex h-[34px] w-[34px] items-center justify-center rounded bg-[#F3F4F6] text-lg">←</button>
            <span className="text-base font-bold">{checkoutStep === 1 ? 'Pagamento' : checkoutStep === 2 ? 'Endereço' : 'Revisar pedido'}</span>
          </div>
          <div className="flex gap-2 px-4 py-4">
            {[1, 2, 3].map((step) => <div key={step} className={`h-1 flex-1 rounded-full ${checkoutStep >= step ? 'bg-[#008fba]' : 'bg-border'}`} />)}
          </div>

          {checkoutStep === 1 && (
            <div className="px-4 pb-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Forma de pagamento</h3>
              {[
                {
                  id: 'Pix',
                  icon: (
                    <svg viewBox="0 0 24 24" className="h-6 w-6">
                      <rect x="4" y="4" width="16" height="16" rx="5" fill="#32BCAD" transform="rotate(45 12 12)" />
                      <rect x="9" y="9" width="6" height="6" rx="2" fill="#fff" transform="rotate(45 12 12)" />
                    </svg>
                  ),
                },
                {
                  id: 'Cartão na entrega',
                  icon: (
                    <svg viewBox="0 0 24 24" className="h-6 w-6">
                      <rect x="1.5" y="5" width="21" height="14" rx="2.5" fill="#008fba" />
                      <rect x="1.5" y="8.5" width="21" height="3" fill="#fff" fillOpacity="0.85" />
                      <rect x="4.5" y="14.5" width="7" height="1.8" rx="0.9" fill="#fff" fillOpacity="0.7" />
                    </svg>
                  ),
                },
                {
                  id: 'Dinheiro',
                  icon: (
                    <svg viewBox="0 0 24 24" className="h-6 w-6">
                      <rect x="1" y="5.5" width="22" height="13" rx="2.5" fill="#16A34A" />
                      <circle cx="12" cy="12" r="3" fill="#fff" fillOpacity="0.9" />
                      <circle cx="4.5" cy="12" r="1.1" fill="#fff" fillOpacity="0.6" />
                      <circle cx="19.5" cy="12" r="1.1" fill="#fff" fillOpacity="0.6" />
                    </svg>
                  ),
                },
              ].map((opt) => (
                <button key={opt.id} onClick={() => setPayMethod(opt.id)}
                  className={['mb-2.5 flex w-full items-center gap-3 rounded border p-3.5 text-left transition-colors', payMethod === opt.id ? 'border-[#008fba] bg-[#E0F2FE]' : 'border-border'].join(' ')}>
                  <span className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded bg-[#F3F4F6]">{opt.icon}</span>
                  <span className="flex-1 text-sm font-semibold">{opt.id}</span>
                  <span className={['flex h-5 w-5 items-center justify-center rounded-full border-2', payMethod === opt.id ? 'border-[#008fba] bg-[#008fba]' : 'border-border'].join(' ')} />
                </button>
              ))}
              {payMethod === 'Dinheiro' && (
                <div className="mt-2">
                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Troco para quanto? (deixe em branco se não precisar)</label>
                  <input value={changeFor} onChange={(e) => setChangeFor(e.target.value)} placeholder="Ex: 50,00"
                    className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                </div>
              )}
            </div>
          )}

          {checkoutStep === 2 && (
            <div className="px-4 pb-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Seus dados</h3>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Nome *</label>
                  <input value={cliente.nome} onChange={(e) => setCliente((c) => ({ ...c, nome: e.target.value }))} placeholder="Seu nome"
                    className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Telefone</label>
                  <input value={cliente.telefone} onChange={(e) => setCliente((c) => ({ ...c, telefone: e.target.value }))} placeholder="(00) 00000-0000"
                    className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                </div>
              </div>
              <h3 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wide text-text-subtle">Endereço de entrega</h3>
              <div className="flex gap-3">
                <div className="flex-[2]">
                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Rua *</label>
                  <input value={endereco.rua} onChange={(e) => setEndereco((a) => ({ ...a, rua: e.target.value }))} placeholder="Nome da rua"
                    className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Número *</label>
                  <input value={endereco.numero} onChange={(e) => setEndereco((a) => ({ ...a, numero: e.target.value }))} placeholder="123"
                    className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                </div>
              </div>
              <div className="mt-3 flex gap-3">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Bairro</label>
                  <input value={endereco.bairro} onChange={(e) => setEndereco((a) => ({ ...a, bairro: e.target.value }))} placeholder="Bairro"
                    className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">CEP</label>
                  <input value={endereco.cep} onChange={(e) => setEndereco((a) => ({ ...a, cep: e.target.value }))} placeholder="00000-000"
                    className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Complemento</label>
                <input value={endereco.complemento} onChange={(e) => setEndereco((a) => ({ ...a, complemento: e.target.value }))} placeholder="Apto, bloco, referência"
                  className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
              </div>
            </div>
          )}

          {checkoutStep === 3 && (
            <div className="px-4 pb-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Resumo do pedido</h3>
              <div className="mb-4 overflow-hidden rounded border border-border bg-white">
                {cart.map((l) => (
                  <div key={l.key} className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5 last:border-none text-sm">
                    <span className="text-text-subtle">{l.qty}× {l.name}</span>
                    <span className="font-semibold">{brl(l.unit * l.qty)}</span>
                  </div>
                ))}
                <div className="flex justify-between px-3.5 py-2.5 text-[13px] text-text-subtle"><span>Subtotal</span><span>{brl(subtotal)}</span></div>
                <div className="flex justify-between border-t border-border px-3.5 py-2.5 text-[13px] text-text-subtle"><span>Taxa de entrega</span><span>{brl(fee)}</span></div>
                <div className="flex justify-between border-t border-border px-3.5 py-3 text-[15px] font-bold"><span>Total</span><span className="text-[#1cce93]">{brl(total)}</span></div>
              </div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-subtle">Entrega & pagamento</h3>
              <div className="mb-2.5 flex items-center gap-3 rounded border border-border p-3.5">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-[#F3F4F6] text-lg">📍</span>
                <div className="text-[13px] leading-relaxed">
                  {endereco.rua}, {endereco.numero}{endereco.complemento && ` · ${endereco.complemento}`}
                  <br /><span className="text-text-subtle">{endereco.bairro || 'Entrega'} · ~30–45 min</span>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded border border-border p-3.5">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-[#F3F4F6] text-lg">💳</span>
                <div className="text-[13px] font-semibold">{payMethod}{payMethod === 'Dinheiro' && changeFor && <span className="font-normal text-text-subtle"> · troco para R$ {changeFor}</span>}</div>
              </div>
            </div>
          )}

          <div className="fixed bottom-0 left-1/2 w-full max-w-[600px] -translate-x-1/2 border-t border-border bg-white p-4 pb-[max(env(safe-area-inset-bottom),1rem)] lg:sticky lg:left-auto lg:max-w-none lg:translate-x-0 lg:pb-4">
            {checkoutError && <div className="mb-2.5 rounded border border-danger bg-danger-bg px-3 py-2 text-[13px] font-medium text-danger">{checkoutError}</div>}
            <button onClick={checkoutNext} disabled={submitting}
              className="flex w-full items-center justify-between rounded bg-[#008fba] px-5 py-4 text-[15px] font-bold text-white transition-colors hover:bg-[#007599] disabled:opacity-60 active:scale-[0.99]">
              <span>{submitting ? 'Enviando…' : checkoutStep === 1 ? 'Ir para endereço' : checkoutStep === 2 ? 'Revisar pedido' : 'Fazer pedido'}</span>
              {checkoutStep === 3 && !submitting && <span>{brl(total)}</span>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Frete calculator overlay ──────────────────────────────────── */}
      {freteOpen && <div className="fixed inset-0 z-[64] bg-[#111827]/60" onClick={() => setFreteOpen(false)} />}
      <div className={['fixed bottom-0 left-1/2 z-[65] flex max-h-[85vh] w-full max-w-[600px] -translate-x-1/2 flex-col overflow-hidden rounded-t-md bg-white transition-all duration-300 lg:bottom-auto lg:top-1/2 lg:max-w-[480px] lg:-translate-y-1/2 lg:rounded', freteOpen ? 'translate-y-0 lg:opacity-100 lg:scale-100' : 'translate-y-full lg:opacity-0 lg:scale-95 lg:pointer-events-none'].join(' ')}>
        {freteOpen && (
          <>
            <div className="flex items-center justify-between border-b border-border p-4.5">
              <h2 className="text-base font-bold">Calcular frete</h2>
              <button onClick={() => setFreteOpen(false)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#F3F4F6] text-xl font-light">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4.5 pb-[max(env(safe-area-inset-bottom),1.125rem)]">
              <label className="mb-1.5 block text-xs font-semibold text-text-subtle">CEP</label>
              <div className="flex gap-2">
                <input
                  value={freteCep}
                  onChange={(e) => setFreteCep(e.target.value)}
                  placeholder="00000-000"
                  inputMode="numeric"
                  className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]"
                />
                <button onClick={calcularFrete} disabled={freteLoading} className="flex-shrink-0 rounded bg-[#008fba] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#007599] disabled:opacity-60">
                  {freteLoading ? '...' : 'Calcular'}
                </button>
              </div>
              {freteError && <p className="mt-2.5 text-[13px] font-medium text-danger">{freteError}</p>}
              {freteResult && (
                <div className="mt-4 rounded border border-border p-3.5">
                  <p className="text-sm font-semibold">{freteResult.rua || 'Endereço encontrado'}</p>
                  <p className="text-[13px] text-text-subtle">{freteResult.bairro}{freteResult.bairro && freteResult.cidade ? ' · ' : ''}{freteResult.cidade}</p>
                  <div className="mt-2.5 flex items-center justify-between rounded bg-[#DCFCE7] px-3 py-2">
                    <span className="text-[13px] font-semibold text-[#16A34A]">Taxa de entrega</span>
                    <span className="text-sm font-bold text-[#16A34A]">{brl(freteResult.taxa)}</span>
                  </div>
                  <button onClick={usarEnderecoDoFrete} className="mt-3 w-full rounded bg-[#008fba] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#007599]">
                    Usar este endereço no pedido
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Conta do cliente overlay ──────────────────────────────────── */}
      {contaOpen && <div className="fixed inset-0 z-[64] bg-[#111827]/60" onClick={() => setContaOpen(false)} />}
      <div className={['fixed bottom-0 left-1/2 z-[65] flex max-h-[85vh] w-full max-w-[600px] -translate-x-1/2 flex-col overflow-hidden rounded-t-md bg-white transition-all duration-300 lg:bottom-auto lg:top-1/2 lg:max-w-[480px] lg:-translate-y-1/2 lg:rounded', contaOpen ? 'translate-y-0 lg:opacity-100 lg:scale-100' : 'translate-y-full lg:opacity-0 lg:scale-95 lg:pointer-events-none'].join(' ')}>
        {contaOpen && (
          <>
            <div className="flex items-center justify-between border-b border-border p-4.5">
              <h2 className="text-base font-bold">Minha conta</h2>
              <button onClick={() => setContaOpen(false)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#F3F4F6] text-xl font-light">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4.5 pb-[max(env(safe-area-inset-bottom),1.125rem)]">
              {!perfilCliente ? (
                contaStep === 'telefone' ? (
                  <>
                    <p className="mb-3 text-[13px] text-text-subtle">Informe seu telefone com DDD para receber um código de confirmação pelo WhatsApp.</p>
                    <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Telefone</label>
                    <input value={contaTelefone} onChange={(e) => setContaTelefone(e.target.value)} placeholder="(00) 00000-0000" inputMode="tel"
                      className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                    {contaError && <p className="mt-2.5 text-[13px] font-medium text-danger">{contaError}</p>}
                    <button onClick={enviarCodigoConta} disabled={contaLoading || !contaTelefone}
                      className="mt-4 w-full rounded bg-[#008fba] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#007599] disabled:opacity-60">
                      {contaLoading ? 'Enviando…' : 'Receber código por WhatsApp'}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mb-3 text-[13px] text-text-subtle">Enviamos um código de 6 dígitos pelo WhatsApp para {contaTelefone}.</p>
                    <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Código</label>
                    <input value={contaCodigo} onChange={(e) => setContaCodigo(e.target.value)} placeholder="000000" inputMode="numeric" maxLength={6}
                      className="w-full rounded border border-border p-2.5 text-center font-sans text-lg font-bold tracking-[0.5em] outline-none focus:border-[#008fba]" />
                    {contaError && <p className="mt-2.5 text-[13px] font-medium text-danger">{contaError}</p>}
                    <button onClick={confirmarCodigoConta} disabled={contaLoading || contaCodigo.length < 6}
                      className="mt-4 w-full rounded bg-[#008fba] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#007599] disabled:opacity-60">
                      {contaLoading ? 'Confirmando…' : 'Confirmar código'}
                    </button>
                    <button onClick={() => { setContaStep('telefone'); setContaCodigo(''); setContaError(null) }} className="mt-3 w-full text-center text-[13px] font-semibold text-[#008fba]">
                      Trocar número / reenviar código
                    </button>
                  </>
                )
              ) : contaEditando ? (
                <>
                  <div className="mb-4 flex items-center justify-between rounded border border-border p-3.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Telefone confirmado</p>
                      <p className="text-sm font-bold">{perfilCliente.telefone}</p>
                    </div>
                    <button onClick={sairConta} className="text-[13px] font-semibold text-danger">Sair</button>
                  </div>

                  <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Nome</label>
                  <input value={contaNome} onChange={(e) => setContaNome(e.target.value)} placeholder="Seu nome"
                    className="mb-3 w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />

                  <h3 className="mb-2.5 mt-4 text-xs font-semibold uppercase tracking-wide text-text-subtle">Endereço salvo</h3>
                  <div className="flex gap-3">
                    <div className="flex-[2]">
                      <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Rua</label>
                      <input value={contaEndereco.rua} onChange={(e) => setContaEndereco((a) => ({ ...a, rua: e.target.value }))} placeholder="Nome da rua"
                        className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Número</label>
                      <input value={contaEndereco.numero} onChange={(e) => setContaEndereco((a) => ({ ...a, numero: e.target.value }))} placeholder="123"
                        className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                    </div>
                  </div>
                  <div className="mt-3 flex gap-3">
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Bairro</label>
                      <input value={contaEndereco.bairro} onChange={(e) => setContaEndereco((a) => ({ ...a, bairro: e.target.value }))} placeholder="Bairro"
                        className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1.5 block text-xs font-semibold text-text-subtle">CEP</label>
                      <input value={contaEndereco.cep} onChange={(e) => setContaEndereco((a) => ({ ...a, cep: e.target.value }))} placeholder="00000-000"
                        className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="mb-1.5 block text-xs font-semibold text-text-subtle">Complemento</label>
                    <input value={contaEndereco.complemento} onChange={(e) => setContaEndereco((a) => ({ ...a, complemento: e.target.value }))} placeholder="Apto, bloco, referência"
                      className="w-full rounded border border-border p-2.5 font-sans text-sm outline-none focus:border-[#008fba]" />
                  </div>

                  {contaError && <p className="mt-2.5 text-[13px] font-medium text-danger">{contaError}</p>}
                  <button onClick={salvarPerfilConta} disabled={contaLoading}
                    className="mt-4 w-full rounded bg-[#008fba] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#007599] disabled:opacity-60">
                    {contaLoading ? 'Salvando…' : 'Salvar'}
                  </button>
                  {(perfilCliente.nome || perfilCliente.endereco.rua) && (
                    <button onClick={cancelarEdicaoConta} className="mt-2.5 w-full text-center text-[13px] font-semibold text-text-subtle">
                      Cancelar
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="mb-4 flex items-center justify-between rounded border border-border p-3.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Telefone confirmado</p>
                      <p className="text-sm font-bold">{perfilCliente.telefone}</p>
                    </div>
                    <button onClick={sairConta} className="text-[13px] font-semibold text-danger">Sair</button>
                  </div>

                  {contaSaved && <p className="mb-3 text-[13px] font-medium text-[#16A34A]">Dados salvos!</p>}

                  <div className="overflow-hidden rounded border border-border">
                    <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome</span>
                      <span className="text-sm font-semibold">{perfilCliente.nome || '—'}</span>
                    </div>
                    <div className="px-3.5 py-2.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Endereço</span>
                      <p className="mt-1 text-sm">
                        {perfilCliente.endereco.rua
                          ? `${perfilCliente.endereco.rua}, ${perfilCliente.endereco.numero}${perfilCliente.endereco.complemento ? ` · ${perfilCliente.endereco.complemento}` : ''}`
                          : '—'}
                      </p>
                      {(perfilCliente.endereco.bairro || perfilCliente.endereco.cep) && (
                        <p className="mt-0.5 text-[13px] text-text-subtle">
                          {perfilCliente.endereco.bairro}{perfilCliente.endereco.bairro && perfilCliente.endereco.cep ? ' · ' : ''}{perfilCliente.endereco.cep}
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => { setContaSaved(false); setContaEditando(true) }}
                    className="mt-4 w-full rounded border border-[#008fba] px-4 py-3 text-sm font-bold text-[#008fba] transition-colors hover:bg-[#E0F2FE]"
                  >
                    Editar dados
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Informações da empresa (modal centralizado) ─────────────────── */}
      {infoOpen && (
        <>
          <div className="fixed inset-0 z-[64] bg-[#111827]/60" onClick={() => setInfoOpen(false)} />
          <div className="fixed inset-0 z-[65] flex items-center justify-center p-4">
            <div className="max-h-[85vh] w-full max-w-[420px] overflow-y-auto rounded-md bg-white">
              <div className="flex items-center justify-between border-b border-border p-4.5">
                <h2 className="text-base font-bold">Sobre {storeName}</h2>
                <button onClick={() => setInfoOpen(false)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#F3F4F6] text-xl font-light">×</button>
              </div>
              <div className="p-4.5">
                {restaurante.endereco && (
                  <div className="mb-4">
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">Endereço</h3>
                    <p className="text-sm">{restaurante.endereco}</p>
                  </div>
                )}
                <div className="mb-4">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">Tempo médio de entrega</h3>
                  <p className="text-sm">⏱ 30–45 min</p>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">Bairros atendidos</h3>
                  {bairros.length > 0 ? (
                    <div className="overflow-hidden rounded border border-border">
                      {bairros.map((b) => (
                        <div key={b.bairro} className="flex items-center justify-between border-b border-border px-3.5 py-2.5 text-sm last:border-none">
                          <span>{b.bairro}</span>
                          <span className="font-semibold text-[#1cce93]">{b.taxa === 0 ? 'Grátis' : brl(b.taxa)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between border-t border-border bg-[#F3F4F6] px-3.5 py-2.5 text-sm">
                        <span className="text-text-subtle">Demais bairros</span>
                        <span className="font-semibold">{brl(restaurante.taxaEntregaPadrao)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="rounded border border-border px-3.5 py-2.5 text-sm text-text-subtle">Taxa de entrega: {brl(restaurante.taxaEntregaPadrao)}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Toast container ───────────────────────────────────────────── */}
      <div className="pointer-events-none fixed bottom-24 left-1/2 z-[70] flex w-full max-w-[380px] -translate-x-1/2 flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex w-full items-center gap-2.5 rounded-full bg-[#111827]/95 px-5 py-3 text-sm font-semibold text-white shadow-2xl backdrop-blur-sm"
            style={{ animation: 'toast-pop 0.25s ease-out both' }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 fill-status-ready">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  )
}
