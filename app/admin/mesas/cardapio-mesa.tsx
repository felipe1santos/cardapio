'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ImagePlus, Loader2, RotateCcw, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario, listarGrupos, listarItens, type GrupoCardapio, type ItemCardapio } from '@/lib/queries/cardapio'
import { enviarImagemCarrosselMesa } from '@/lib/queries/ajustes'
import { MESA_CARROSSEL_MAX, MESA_MENSAGEM_MAX, ordenarParaMesa } from '@/lib/mesa-vitrine'

/**
 * Personalização do cardápio que o cliente abre pelo QR da mesa:
 *  1. carrossel do topo (imagens que passam sozinhas; sem imagens = banner da loja);
 *  2. texto do aviso "isto é só a sua seleção";
 *  3. ordem dos itens dentro de cada categoria.
 *
 * Grava por `/api/admin/mesas/cardapio` (só a gestão). O delivery não muda.
 */

interface Estado {
  carrossel: string[]
  mensagem: string | null
  mensagemPadrao: string
  posicoes: Record<string, number | null>
}

type Aviso = { tipo: 'ok' | 'erro'; texto: string } | null

async function salvar(corpo: Record<string, unknown>): Promise<string | null> {
  const r = await fetch('/api/admin/mesas/cardapio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  })
  if (r.ok) return null
  const j = (await r.json().catch(() => ({}))) as { error?: string }
  return j.error ?? 'Não foi possível salvar.'
}

function Retorno({ aviso }: { aviso: Aviso }) {
  if (!aviso) return null
  return (
    <p className={`text-[12px] font-semibold ${aviso.tipo === 'ok' ? 'text-status-ready' : 'text-danger'}`} role="status">
      {aviso.texto}
    </p>
  )
}

export function CardapioDaMesaConfig() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [estado, setEstado] = useState<Estado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [grupos, setGrupos] = useState<GrupoCardapio[]>([])
  const [itens, setItens] = useState<ItemCardapio[]>([])

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/mesas/cardapio', { cache: 'no-store' })
    const j = (await r.json().catch(() => ({}))) as Estado & { error?: string }
    if (!r.ok) {
      setErro(j.error ?? 'Não foi possível carregar a personalização do cardápio da mesa.')
      return
    }
    setEstado(j)
  }, [])

  useEffect(() => {
    void carregar()
    void (async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      setRestauranteId(id)
      if (!id) return
      const [g, i] = await Promise.all([listarGrupos(supabase, id), listarItens(supabase, id)])
      setGrupos([...g].sort((a, b) => a.posicao - b.posicao))
      setItens(i)
    })()
  }, [carregar, supabase])

  if (erro) {
    return (
      <Card>
        <h3 className="mb-1 text-[13px] font-bold text-text-main">Cardápio da mesa (QR)</h3>
        <p className="text-[12px] text-danger">{erro}</p>
      </Card>
    )
  }
  if (!estado) {
    return (
      <Card>
        <p className="text-[12px] text-text-subtle">Carregando o cardápio da mesa…</p>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <SecaoCarrossel
        inicial={estado.carrossel}
        restauranteId={restauranteId}
        supabase={supabase}
        onSalvo={(carrossel) => setEstado({ ...estado, carrossel })}
      />
      <SecaoMensagem
        inicial={estado.mensagem}
        padrao={estado.mensagemPadrao}
        onSalvo={(mensagem) => setEstado({ ...estado, mensagem })}
      />
      <SecaoOrdem grupos={grupos} itens={itens} posicoes={estado.posicoes} onSalvo={(posicoes) => setEstado({ ...estado, posicoes })} />
    </div>
  )
}

// ── 1. carrossel ────────────────────────────────────────────────────────────

function SecaoCarrossel({
  inicial,
  restauranteId,
  supabase,
  onSalvo,
}: {
  inicial: string[]
  restauranteId: string | null
  supabase: ReturnType<typeof getBrowserSupabase>
  onSalvo: (urls: string[]) => void
}) {
  const [urls, setUrls] = useState(inicial)
  const [enviando, setEnviando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<Aviso>(null)
  const arquivo = useRef<HTMLInputElement>(null)
  const mudou = JSON.stringify(urls) !== JSON.stringify(inicial)

  async function adicionar(files: FileList | null) {
    if (!files || !restauranteId) return
    const lista = [...files].slice(0, MESA_CARROSSEL_MAX - urls.length)
    if (lista.length === 0) {
      setAviso({ tipo: 'erro', texto: `No máximo ${MESA_CARROSSEL_MAX} imagens.` })
      return
    }
    setEnviando(true)
    setAviso(null)
    try {
      const novas: string[] = []
      for (const f of lista) novas.push(await enviarImagemCarrosselMesa(supabase, restauranteId, f))
      setUrls((a) => [...a, ...novas].slice(0, MESA_CARROSSEL_MAX))
    } catch {
      setAviso({ tipo: 'erro', texto: 'Não foi possível enviar a imagem. Tente outra.' })
    } finally {
      setEnviando(false)
      if (arquivo.current) arquivo.current.value = ''
    }
  }

  function mover(i: number, d: -1 | 1) {
    setUrls((a) => {
      const j = i + d
      if (j < 0 || j >= a.length) return a
      const n = [...a]
      ;[n[i], n[j]] = [n[j]!, n[i]!]
      return n
    })
  }

  async function gravar() {
    setSalvando(true)
    setAviso(null)
    const e = await salvar({ carrossel: urls })
    setSalvando(false)
    if (e) return setAviso({ tipo: 'erro', texto: e })
    onSalvo(urls)
    setAviso({ tipo: 'ok', texto: urls.length ? 'Carrossel salvo. Já aparece no cardápio da mesa.' : 'Sem carrossel: o topo volta a mostrar o banner da loja.' })
  }

  return (
    <Card>
      <h3 className="mb-1 text-[13px] font-bold text-text-main">Carrossel do topo (cardápio da mesa)</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
        Imagens que passam sozinhas, devagar, no topo do cardápio que o cliente abre pelo QR. Sem imagens, o topo mostra o
        banner da loja. Até {MESA_CARROSSEL_MAX} imagens; formato horizontal fica melhor.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {urls.map((u, i) => (
          <div key={u} className="relative overflow-hidden rounded-menuzia border border-border bg-page">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt={`Imagem ${i + 1} do carrossel`} className="aspect-[2/1] w-full object-cover" />
            <span className="absolute left-1 top-1 rounded-menuzia bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
            <div className="flex items-center justify-between gap-1 border-t border-border bg-main p-1">
              <span className="flex gap-1">
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Mover para antes" className="grid h-8 w-8 place-items-center rounded-menuzia text-text-subtle hover:bg-page disabled:opacity-30">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === urls.length - 1} aria-label="Mover para depois" className="grid h-8 w-8 place-items-center rounded-menuzia text-text-subtle hover:bg-page disabled:opacity-30">
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </span>
              <button type="button" onClick={() => setUrls((a) => a.filter((x) => x !== u))} aria-label="Remover imagem" className="grid h-8 w-8 place-items-center rounded-menuzia text-danger hover:bg-danger-bg">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {urls.length < MESA_CARROSSEL_MAX && (
          <button
            type="button"
            onClick={() => arquivo.current?.click()}
            disabled={enviando || !restauranteId}
            className="flex aspect-[2/1] flex-col items-center justify-center gap-1 rounded-menuzia border border-dashed border-border bg-page text-[11px] font-semibold text-text-subtle hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            {enviando ? 'Enviando…' : 'Adicionar imagem'}
          </button>
        )}
      </div>
      <input ref={arquivo} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void adicionar(e.target.files)} />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={gravar} disabled={!mudou || salvando || enviando}>
          {salvando ? 'Salvando…' : 'Salvar carrossel'}
        </Button>
        <Retorno aviso={aviso} />
      </div>
    </Card>
  )
}

// ── 2. mensagem ─────────────────────────────────────────────────────────────

function SecaoMensagem({ inicial, padrao, onSalvo }: { inicial: string | null; padrao: string; onSalvo: (m: string | null) => void }) {
  const [texto, setTexto] = useState(inicial ?? '')
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<Aviso>(null)
  const mudou = (texto.trim() || null) !== (inicial ?? null)

  async function gravar(valor: string | null) {
    setSalvando(true)
    setAviso(null)
    const e = await salvar({ mensagem: valor })
    setSalvando(false)
    if (e) return setAviso({ tipo: 'erro', texto: e })
    const final = valor?.trim() || null
    onSalvo(final)
    setTexto(final ?? '')
    setAviso({ tipo: 'ok', texto: final ? 'Mensagem salva.' : 'Voltou ao texto padrão.' })
  }

  return (
    <Card>
      <h3 className="mb-1 text-[13px] font-bold text-text-main">Aviso da seleção (cardápio da mesa)</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
        Aparece no fim do cardápio e em &quot;Minha seleção&quot;. Deixe em branco para usar o texto padrão.
      </p>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value.slice(0, MESA_MENSAGEM_MAX))}
        placeholder={padrao}
        rows={3}
        className="w-full rounded-menuzia border border-border bg-main px-3 py-2 text-[13px] outline-none focus:border-primary"
      />
      <div className="mt-1 text-right text-[11px] text-text-subtle">
        {texto.length}/{MESA_MENSAGEM_MAX}
      </div>

      <p className="mb-1 mt-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Como o cliente vê</p>
      <div className="flex items-start gap-2.5 rounded-menuzia border border-border border-l-4 border-l-[#CB000F] bg-main px-3.5 py-3">
        <span className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-full bg-[#CB000F] font-serif text-[13px] font-extrabold italic text-white">
          i
        </span>
        <p className="text-[13px] leading-relaxed text-text-main">{texto.trim() || padrao}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => gravar(texto)} disabled={!mudou || salvando}>
          {salvando ? 'Salvando…' : 'Salvar mensagem'}
        </Button>
        {inicial && (
          <Button variant="outline" onClick={() => gravar(null)} disabled={salvando}>
            <RotateCcw className="h-3.5 w-3.5" />
            Usar texto padrão
          </Button>
        )}
        <Retorno aviso={aviso} />
      </div>
    </Card>
  )
}

// ── 3. ordem dos itens ──────────────────────────────────────────────────────

function SecaoOrdem({
  grupos,
  itens,
  posicoes,
  onSalvo,
}: {
  grupos: GrupoCardapio[]
  itens: ItemCardapio[]
  posicoes: Record<string, number | null>
  onSalvo: (p: Record<string, number | null>) => void
}) {
  // Só itens que aparecem no salão; categorias que têm pelo menos um.
  const doSalao = useMemo(() => itens.filter((i) => i.disponivelSalao !== false), [itens])
  const categorias = useMemo(() => grupos.filter((g) => doSalao.some((i) => i.grupoId === g.id)), [grupos, doSalao])
  const [categoria, setCategoria] = useState<string | null>(null)
  const atual = categoria && categorias.some((g) => g.id === categoria) ? categoria : (categorias[0]?.id ?? null)

  const ordemSalva = useMemo(() => {
    const mapa = new Map(Object.entries(posicoes))
    return ordenarParaMesa(doSalao.filter((i) => i.grupoId === atual), mapa).map((i) => i.id)
  }, [doSalao, atual, posicoes])
  const [ordem, setOrdem] = useState<string[]>(ordemSalva)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<Aviso>(null)

  useEffect(() => {
    setOrdem(ordemSalva)
  }, [ordemSalva])

  const porId = useMemo(() => new Map(doSalao.map((i) => [i.id, i])), [doSalao])
  const mudou = JSON.stringify(ordem) !== JSON.stringify(ordemSalva)

  function mover(i: number, d: -1 | 1) {
    setOrdem((a) => {
      const j = i + d
      if (j < 0 || j >= a.length) return a
      const n = [...a]
      ;[n[i], n[j]] = [n[j]!, n[i]!]
      return n
    })
  }

  async function gravar() {
    setSalvando(true)
    setAviso(null)
    const e = await salvar({ ordem })
    setSalvando(false)
    if (e) return setAviso({ tipo: 'erro', texto: e })
    onSalvo({ ...posicoes, ...Object.fromEntries(ordem.map((id, n) => [id, n + 1])) })
    setAviso({ tipo: 'ok', texto: 'Ordem salva. O cardápio da mesa já mostra assim.' })
  }

  return (
    <Card>
      <h3 className="mb-1 text-[13px] font-bold text-text-main">Ordem dos itens (cardápio da mesa)</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
        Escolha a categoria e arrume a ordem em que o cliente vê os itens no cardápio do QR. Não muda o delivery.
      </p>

      {categorias.length === 0 ? (
        <p className="text-[12px] text-text-subtle">Nenhum item vendido no salão ainda.</p>
      ) : (
        <>
          <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categorias.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  setCategoria(g.id)
                  setAviso(null)
                }}
                className={[
                  'min-h-[36px] flex-shrink-0 whitespace-nowrap rounded-menuzia border px-3 text-[11px] font-bold uppercase tracking-wide',
                  g.id === atual ? 'border-primary bg-primary text-white' : 'border-border bg-main text-text-subtle hover:text-text-main',
                ].join(' ')}
              >
                {g.nome}
              </button>
            ))}
          </div>

          <ol className="divide-y divide-border rounded-menuzia border border-border">
            {ordem.map((id, i) => {
              const item = porId.get(id)
              if (!item) return null
              return (
                <li key={id} className="flex items-center gap-2 px-2.5 py-1.5">
                  <span className="w-6 text-center text-[12px] font-bold text-text-subtle">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-main">
                    {item.nome}
                    {item.status !== 'disponivel' && <span className="ml-1.5 text-[10px] font-bold uppercase text-text-subtle">({item.status})</span>}
                  </span>
                  <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir ${item.nome}`} className="grid h-9 w-9 place-items-center rounded-menuzia text-text-subtle hover:bg-page disabled:opacity-30">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => mover(i, 1)} disabled={i === ordem.length - 1} aria-label={`Descer ${item.nome}`} className="grid h-9 w-9 place-items-center rounded-menuzia text-text-subtle hover:bg-page disabled:opacity-30">
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={gravar} disabled={!mudou || salvando}>
              {salvando ? 'Salvando…' : 'Salvar ordem'}
            </Button>
            <Retorno aviso={aviso} />
          </div>
        </>
      )}
    </Card>
  )
}
