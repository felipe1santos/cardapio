'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ImagePlus, Loader2, RotateCcw, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario, listarGrupos, listarItens, type GrupoCardapio, type ItemCardapio } from '@/lib/queries/cardapio'
import { enviarImagemCarrosselMesa } from '@/lib/queries/ajustes'
import { MESA_CARROSSEL_MAX, MESA_MENSAGEM_MAX, mensagemPadraoDaMesa, ordenarParaMesa } from '@/lib/mesa-vitrine'

/**
 * Personalização do cardápio que o cliente abre pelo QR da mesa:
 *  1. carrossel do topo (imagens que passam sozinhas; sem imagens = banner da loja);
 *  2. texto do aviso "isto é só a sua seleção";
 *  3. ordem das categorias no trilho do cardápio da mesa (só a mesa).
 *
 * Grava por `/api/admin/mesas/cardapio` (só a gestão). O delivery não muda.
 */

interface Estado {
  somenteVisualizacao: boolean
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
      <SecaoModo inicial={estado.somenteVisualizacao} onSalvo={(v) => setEstado({ ...estado, somenteVisualizacao: v })} />
      <SecaoCarrossel
        inicial={estado.carrossel}
        restauranteId={restauranteId}
        supabase={supabase}
        onSalvo={(carrossel) => setEstado({ ...estado, carrossel })}
      />
      <SecaoMensagem
        inicial={estado.mensagem}
        // O texto padrão depende do modo, e o modo muda na tela ao lado sem recarregar:
        // calcular aqui mantém a prévia coerente com a chave que o dono acabou de virar.
        padrao={mensagemPadraoDaMesa(estado.somenteVisualizacao)}
        onSalvo={(mensagem) => setEstado({ ...estado, mensagem })}
      />
      <SecaoOrdem grupos={grupos} itens={itens} posicoes={estado.posicoes} onSalvo={(posicoes) => setEstado({ ...estado, posicoes })} />
    </div>
  )
}

// ── 0. modo do cardápio ─────────────────────────────────────────────────────

/**
 * "Somente visualização": o cliente só vê o cardápio (itens, fotos, descrições e os
 * sabores da pizza) — não seleciona, não monta lista, não escolhe tamanho nem adicional.
 * Desligado, tudo funciona como antes.
 */
function SecaoModo({ inicial, onSalvo }: { inicial: boolean; onSalvo: (v: boolean) => void }) {
  const [ligado, setLigado] = useState(inicial)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<Aviso>(null)

  async function alternar() {
    const novo = !ligado
    setSalvando(true)
    setAviso(null)
    const e = await salvar({ somenteVisualizacao: novo })
    setSalvando(false)
    if (e) return setAviso({ tipo: 'erro', texto: e })
    setLigado(novo)
    onSalvo(novo)
    setAviso({
      tipo: 'ok',
      texto: novo
        ? 'Ligado: o cardápio da mesa agora é só para ver.'
        : 'Desligado: o cliente volta a montar a seleção para mostrar ao garçom.',
    })
  }

  // Fundo amarelo: esta chave muda o cardápio inteiro do QR (some a seleção e o
  // chamado do garçom). Destacada, ninguém a liga sem perceber no meio das outras.
  return (
    <Card className="!bg-warn-bg border-warn/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="mb-1 text-[13px] font-bold text-text-main">Somente visualização (cardápio da mesa)</h3>
          <p className="text-[12px] leading-relaxed text-text-subtle">
            Ligado, o cliente só <strong className="text-text-main">vê</strong> o cardápio do QR: itens, fotos,
            descrições e os sabores da pizza. Ele não escolhe tamanho nem adicional, não monta a lista e não chama o
            garçom pela tela. Tocando num item, abre a foto inteira com a descrição. Desligado, tudo funciona como hoje.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={ligado}
          aria-label="Somente visualização"
          onClick={alternar}
          disabled={salvando}
          className={`relative mt-0.5 h-7 w-12 flex-shrink-0 rounded-full transition-colors disabled:opacity-60 ${ligado ? 'bg-status-ready' : 'bg-border'}`}
          data-modo-visualizacao
        >
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${ligado ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      <p className={`mt-2 text-[11px] font-bold uppercase tracking-wide ${ligado ? 'text-status-ready' : 'text-text-subtle'}`}>
        {ligado ? 'Ligado — só visualização' : 'Desligado — cliente monta a seleção'}
      </p>
      <Retorno aviso={aviso} />
    </Card>
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
        Aparece como rodapé, depois do último item do cardápio — e também em &quot;Minha seleção&quot;, quando o cliente
        monta a lista. Deixe em branco para usar o texto padrão.
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

// ── 3. ordem das categorias ─────────────────────────────────────────────────

/**
 * Ordem das CATEGORIAS no trilho da esquerda do cardápio da mesa (QR). Só a mesa: a
 * ordem do delivery continua sendo a do Cardápio. Aparecem as categorias que têm item
 * vendido no salão — as outras não aparecem na mesa de qualquer forma.
 */
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
  const categorias = useMemo(
    () => grupos.filter((g) => itens.some((i) => i.grupoId === g.id && i.disponivelSalao !== false)),
    [grupos, itens],
  )
  const ordemSalva = useMemo(
    () => ordenarParaMesa(categorias, new Map(Object.entries(posicoes))).map((g) => g.id),
    [categorias, posicoes],
  )
  const [ordem, setOrdem] = useState<string[]>(ordemSalva)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<Aviso>(null)

  useEffect(() => {
    setOrdem(ordemSalva)
  }, [ordemSalva])

  const porId = useMemo(() => new Map(categorias.map((g) => [g.id, g])), [categorias])
  const qtdItens = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of itens) if (i.grupoId && i.disponivelSalao !== false) m.set(i.grupoId, (m.get(i.grupoId) ?? 0) + 1)
    return m
  }, [itens])
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
    setAviso({ tipo: 'ok', texto: 'Ordem salva. O cardápio da mesa já mostra as categorias assim.' })
  }

  return (
    <Card>
      <h3 className="mb-1 text-[13px] font-bold text-text-main">Ordem das categorias (cardápio da mesa)</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
        Arrume a ordem em que as categorias aparecem na lista da esquerda do cardápio que o cliente abre pelo QR da
        mesa. Não muda o delivery — a ordem dele continua sendo ajustada em Cardápio.
      </p>

      {categorias.length === 0 ? (
        <p className="text-[12px] text-text-subtle">Nenhuma categoria com item vendido no salão ainda.</p>
      ) : (
        <>
          <ol className="divide-y divide-border rounded-menuzia border border-border" data-ordem-categorias>
            {ordem.map((id, i) => {
              const g = porId.get(id)
              if (!g) return null
              return (
                <li key={id} className="flex items-center gap-2 px-2.5 py-1.5">
                  <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-primary/10 text-[12px] font-bold text-primary">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-text-main">{g.nome}</span>
                    <span className="block text-[11px] text-text-subtle">
                      {qtdItens.get(id) ?? 0} {(qtdItens.get(id) ?? 0) === 1 ? 'item' : 'itens'}
                      {g.horarioAtivoInicio && g.horarioAtivoFim
                        ? ` · ${g.horarioAtivoInicio.slice(0, 5)}–${g.horarioAtivoFim.slice(0, 5)}`
                        : ''}
                    </span>
                  </span>
                  <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir ${g.nome}`} className="grid h-9 w-9 place-items-center rounded-menuzia text-text-subtle hover:bg-page disabled:opacity-30">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => mover(i, 1)} disabled={i === ordem.length - 1} aria-label={`Descer ${g.nome}`} className="grid h-9 w-9 place-items-center rounded-menuzia text-text-subtle hover:bg-page disabled:opacity-30">
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
