'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, Monitor, Send, Smartphone, Tablet, Users, Download } from 'lucide-react'
import { Cartao, TituloBloco, BolhaIcone, Etiqueta } from '@/components/admin/painel-visual'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { aplicarVariaveis, cortar, LIMITE_TEXTO, TEXTO_PREMIO_PADRAO } from '@/lib/push/conteudo'
import type { TipoAutomacao } from '@/lib/push/regras'

/**
 * Campanhas › Notificações do app (0127): resumo, teste, automações com prévia, avulsa,
 * limites e relatórios. Tudo pelas rotas /api/admin/campanhas/push (área Campanhas).
 */

interface Relatorio { enviadas: number; falhas: number; pendentes: number; cliques: number; pedidos: number }
interface Automacao { tipo: TipoAutomacao; ativo: boolean; titulo: string; texto: string; params: Record<string, unknown>; variaveis: string[] }
interface Avulsa {
  id: string; titulo: string; texto: string; imagem_url: string | null; destino: { tipo: string }; publico: { tipo: string; dias?: number }
  agendado_em: string | null; status: string; total_previsto: number; criado_por_nome: string | null; criado_em: string; relatorio: Relatorio
}
interface Dados {
  liberado: boolean
  servidorConfigurado: boolean
  loja: { nome: string; slug: string; icone: string; badge: string }
  config: { limiteDia: number; limiteSemana: number; antecedenciaMin: number; telefoneTeste: string | null; tetoDia: number; tetoSemana: number }
  automacoes: Automacao[]
  resumo: { total: number; android: number; ios: number; desktop: number; outro: number; instalados: number; clientes: number }
  relatorio: { porTipo: Record<string, Relatorio> }
  avulsas: Avulsa[]
}

const INFO: Record<TipoAutomacao, { nome: string; quando: string }> = {
  status_pedido: { nome: 'Status do pedido', quando: 'Pedido aceito, saiu para entrega e pronto para retirada. Não conta no limite de frequência.' },
  cupom_novo: { nome: 'Cupom novo', quando: 'Cupom criado nos últimos 3 dias, para quem pode usar.' },
  fidelidade: { nome: 'Fidelidade', quando: 'Quando faltam 1 ou 2 pedidos para o prêmio, e quando o prêmio fica liberado.' },
  loja_abriu: { nome: 'Loja abriu com promoção', quando: 'Quando a loja abre e há produto em promoção. No máximo 1 por dia.' },
  frete_gratis: { nome: 'Frete grátis', quando: 'Quando você liga o frete grátis (geral ou para um bairro do cliente).' },
  item_novo: { nome: 'Item novo no cardápio', quando: 'Produto criado ou marcado como Novidade.' },
  recompra: { nome: 'Recompra', quando: 'Cliente que fez só 1 pedido, alguns dias depois.' },
  inativo: { nome: 'Cliente sumido', quando: 'Cliente sem pedir há alguns dias. Repete de tempos em tempos enquanto ele não voltar.' },
}
const ORDEM: TipoAutomacao[] = ['status_pedido', 'cupom_novo', 'fidelidade', 'loja_abriu', 'frete_gratis', 'item_novo', 'recompra', 'inativo']

/** Valores de exemplo para a prévia. */
const EXEMPLO: Record<string, string> = { nome: 'Ana', produto: 'X-Burger', cupom: 'BEMVINDO10', desconto: 'X-Burger por R$ 25,00', faltam: '2 pedidos' }

const INPUT = 'h-[38px] w-full rounded-[5px] border border-border bg-white px-3 text-[13px] text-text-main outline-none focus:border-primary'
const BOTAO = 'inline-flex h-[38px] items-center justify-center gap-2 rounded-[5px] px-4 text-[13px] font-bold transition-colors disabled:opacity-50'

async function api<T>(url: string, metodo = 'GET', corpo?: unknown): Promise<{ ok: boolean; dados?: T; erro?: string }> {
  try {
    const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
    const j = await r.json().catch(() => ({}))
    return r.ok ? { ok: true, dados: j as T } : { ok: false, erro: (j as { error?: string }).error ?? 'Não foi possível concluir.' }
  } catch {
    return { ok: false, erro: 'Sem conexão. Confira a internet e tente de novo.' }
  }
}

// ── prévia realista ───────────────────────────────────────────────────────────
export function PreviaNotificacao({ loja, titulo, texto, imagem }: { loja: Dados['loja']; titulo: string; texto: string; imagem?: string | null }) {
  const t = cortar(titulo || loja.nome, 60)
  const b = cortar(texto, LIMITE_TEXTO)
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-push-previa>
      {/* Android: linha do app com o badge, título forte, texto, ícone grande à direita */}
      <div>
        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-subtle">Android</p>
        <div className="rounded-[16px] bg-[#F1F3F4] p-3 shadow-sm" data-previa-android>
          <div className="flex items-center gap-1.5 text-[11px] text-[#5F6368]">
            <span className="flex h-[16px] w-[16px] items-center justify-center rounded-full bg-[#0688D4]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={loja.badge} alt="" className="h-[12px] w-[12px]" />
            </span>
            <span className="truncate">{loja.nome} · app.menuzia.com.br · agora</span>
          </div>
          <div className="mt-1.5 flex gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-[#202124]">{t}</p>
              <p className="line-clamp-2 text-[12.5px] leading-[17px] text-[#3C4043]">{b}</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={loja.icone} alt="" className="h-[40px] w-[40px] flex-shrink-0 rounded-[8px]" />
          </div>
          {imagem && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagem} alt="" className="mt-2 h-[110px] w-full rounded-[10px] object-cover" />
          )}
        </div>
      </div>
      {/* iPhone: cartão translúcido, ícone do app à esquerda, sem imagem grande */}
      <div>
        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-subtle">iPhone</p>
        <div className="rounded-[20px] bg-[#E9E9EE] p-3 shadow-sm" data-previa-iphone>
          <div className="flex gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={loja.icone} alt="" className="h-[36px] w-[36px] flex-shrink-0 rounded-[8px]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[13px] font-semibold text-black">{t}</p>
                <span className="flex-shrink-0 text-[11px] text-[#6B6B70]">agora</span>
              </div>
              <p className="line-clamp-3 text-[12.5px] leading-[17px] text-[#1C1C1E]">{b}</p>
            </div>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-text-subtle">No iPhone a imagem grande não aparece.</p>
      </div>
    </div>
  )
}

function LinhaRelatorio({ r }: { r?: Relatorio }) {
  const x = r ?? { enviadas: 0, falhas: 0, pendentes: 0, cliques: 0, pedidos: 0 }
  return (
    <p className="text-[11.5px] text-text-subtle" data-push-relatorio>
      30 dias: <strong className="text-text-main">{x.enviadas}</strong> enviadas · {x.falhas} falhas · {x.cliques} cliques · <strong className="text-text-main">{x.pedidos}</strong> pedidos em até 48 h
    </p>
  )
}

function CartaoAutomacao({ a, loja, relatorio, onSalvo }: { a: Automacao; loja: Dados['loja']; relatorio?: Relatorio; onSalvo: (msg: string) => void }) {
  const [ativo, setAtivo] = useState(a.ativo)
  const [titulo, setTitulo] = useState(a.titulo)
  const [texto, setTexto] = useState(a.texto)
  const [params, setParams] = useState<Record<string, unknown>>(a.params)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)
  const info = INFO[a.tipo]
  const vars = { ...EXEMPLO, loja: loja.nome }
  const textoPrevia = a.tipo === 'status_pedido' ? 'Pedido #128 saiu para entrega! 🛵' : aplicarVariaveis(texto, vars)

  async function salvar(novoAtivo = ativo) {
    setSalvando(true)
    setErro(null)
    const r = await api('/api/admin/campanhas/push/automacoes', 'PUT', { tipo: a.tipo, ativo: novoAtivo, titulo, texto, params })
    setSalvando(false)
    if (!r.ok) { setErro(r.erro ?? 'Erro'); return false }
    onSalvo(`${info.nome}: ${novoAtivo ? 'ligada' : 'desligada'} e salva.`)
    return true
  }

  return (
    <Cartao className="p-4" data-push-automacao={a.tipo}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[14px] font-bold text-text-main">{info.nome}</h4>
            {a.tipo === 'status_pedido' && <Etiqueta tom="azul">Transacional</Etiqueta>}
          </div>
          <p className="mt-0.5 text-[12px] text-text-subtle">{info.quando}</p>
          <LinhaRelatorio r={relatorio} />
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={ativo}
          aria-label={`Ligar ${info.nome}`}
          disabled={salvando}
          onClick={async () => { const novo = !ativo; setAtivo(novo); if (!(await salvar(novo))) setAtivo(!novo) }}
          className={['relative mt-1 h-[24px] w-[42px] flex-shrink-0 rounded-full transition-colors', ativo ? 'bg-primary' : 'bg-[#CBD5E1]'].join(' ')}
          data-push-ligar={a.tipo}
        >
          <span className={['absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all', ativo ? 'left-[21px]' : 'left-[3px]'].join(' ')} />
        </button>
      </div>
      {a.tipo !== 'status_pedido' && (
        <button type="button" onClick={() => setAberto((x) => !x)} className="mt-2 text-[12px] font-semibold text-primary" data-push-editar={a.tipo}>
          {aberto ? 'Fechar' : 'Editar texto e prévia'}
        </button>
      )}
      {aberto && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Título</span>
              <input value={titulo} maxLength={60} onChange={(e) => setTitulo(e.target.value)} className={INPUT} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Texto</span>
              <textarea value={texto} maxLength={200} rows={3} onChange={(e) => setTexto(e.target.value)} className={`${INPUT} h-auto py-2`} data-push-texto={a.tipo} />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {a.variaveis.map((v) => (
                <button key={v} type="button" onClick={() => setTexto((t) => `${t}${t.endsWith(' ') || !t ? '' : ' '}{${v}}`)} className="rounded-full border border-border px-2 py-0.5 text-[11.5px] font-semibold text-text-subtle hover:border-primary hover:text-primary">
                  {`{${v}}`}
                </button>
              ))}
            </div>
            {a.tipo === 'recompra' && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Dias depois do 1º pedido</span>
                <input type="number" min={1} max={60} value={Number(params.dias ?? 3)} onChange={(e) => setParams({ ...params, dias: Number(e.target.value) })} className={`${INPUT} w-28`} />
              </label>
            )}
            {a.tipo === 'inativo' && (
              <div className="flex flex-wrap gap-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Sem pedir há (dias)</span>
                  <input type="number" min={2} max={180} value={Number(params.dias ?? 6)} onChange={(e) => setParams({ ...params, dias: Number(e.target.value) })} className={`${INPUT} w-28`} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Repetir a cada (dias)</span>
                  <input type="number" min={3} max={90} value={Number(params.repetir_dias ?? 14)} onChange={(e) => setParams({ ...params, repetir_dias: Number(e.target.value) })} className={`${INPUT} w-28`} />
                </label>
              </div>
            )}
            {a.tipo === 'fidelidade' && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Texto do prêmio liberado</span>
                <input value={String(params.texto_premio ?? TEXTO_PREMIO_PADRAO)} maxLength={200} onChange={(e) => setParams({ ...params, texto_premio: e.target.value })} className={INPUT} />
              </label>
            )}
            {erro && <p className="text-[12px] font-semibold text-danger">{erro}</p>}
            <button type="button" disabled={salvando} onClick={() => void salvar()} className={`${BOTAO} bg-primary text-white hover:bg-primary-dark`} data-push-salvar={a.tipo}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
          <PreviaNotificacao loja={loja} titulo={aplicarVariaveis(titulo, vars)} texto={textoPrevia} />
        </div>
      )}
    </Cartao>
  )
}

function rotuloPublico(p: Avulsa['publico']): string {
  if (p.tipo === 'recentes') return `Pediu nos últimos ${p.dias} dias`
  if (p.tipo === 'inativos') return `Sem pedir há ${p.dias} dias`
  if (p.tipo === 'fidelidade') return 'Clientes da fidelidade'
  return 'Todos'
}

function NovaAvulsa({ loja, onCriada }: { loja: Dados['loja']; onCriada: (msg: string) => void }) {
  const [titulo, setTitulo] = useState(loja.nome)
  const [texto, setTexto] = useState('')
  const [imagem, setImagem] = useState('')
  const [destino, setDestino] = useState<'cardapio' | 'promocoes' | 'produto' | 'cupom'>('cardapio')
  const [produtoId, setProdutoId] = useState('')
  const [cupom, setCupom] = useState('')
  const [publico, setPublico] = useState<'todos' | 'recentes' | 'inativos' | 'fidelidade'>('todos')
  const [dias, setDias] = useState(30)
  const [quando, setQuando] = useState<'agora' | 'agendar'>('agora')
  const [agendado, setAgendado] = useState('')
  const [previsto, setPrevisto] = useState<{ clientes: number; aparelhos: number } | null>(null)
  const [produtos, setProdutos] = useState<{ id: string; nome: string }[]>([])
  const [enviando, setEnviando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const pub = useMemo(() => (publico === 'recentes' || publico === 'inativos' ? { tipo: publico, dias } : { tipo: publico }), [publico, dias])
  useEffect(() => {
    let vivo = true
    void api<{ clientes: number; aparelhos: number }>('/api/admin/campanhas/push/estimativa', 'POST', { publico: pub }).then((r) => { if (vivo && r.ok) setPrevisto(r.dados!) })
    return () => { vivo = false }
  }, [pub])
  useEffect(() => {
    if (destino !== 'produto' || produtos.length) return
    ;(async () => {
      const sb = getBrowserSupabase()
      const rid = await buscarRestauranteIdDoUsuario(sb)
      if (!rid) return
      const { data } = await sb.from('itens_cardapio').select('id, nome').eq('restaurante_id', rid).order('nome').limit(500)
      setProdutos(data ?? [])
    })()
  }, [destino, produtos.length])

  async function enviar() {
    setEnviando(true)
    setErro(null)
    const d = destino === 'produto' ? { tipo: 'produto', id: produtoId } : destino === 'cupom' ? { tipo: 'cupom', codigo: cupom } : { tipo: destino }
    const r = await api<{ clientes: number; enfileirados: number }>('/api/admin/campanhas/push/avulsas', 'POST', {
      titulo, texto, imagemUrl: imagem || null, destino: d, publico: pub,
      agendadoEm: quando === 'agendar' && agendado ? new Date(agendado).toISOString() : null,
    })
    setEnviando(false)
    setConfirmar(false)
    if (!r.ok) { setErro(r.erro ?? 'Erro'); return }
    setTexto('')
    onCriada(quando === 'agendar'
      ? 'Notificação agendada. Ela sai no horário escolhido, dentro do horário de funcionamento.'
      : r.dados!.enfileirados ? `Notificação enviada para ${r.dados!.clientes} cliente(s).` : 'Notificação criada. Ela sai quando a loja estiver no horário permitido.')
  }

  return (
    <Cartao className="p-4" data-push-avulsa-form>
      <TituloBloco titulo="Notificação avulsa" subtitulo="Mande agora ou agende. Sai só dentro do horário permitido e para quem deixou promoções ligadas." />
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Título</span>
            <input value={titulo} maxLength={60} onChange={(e) => setTitulo(e.target.value)} className={INPUT} data-avulsa-titulo /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Texto</span>
            <textarea value={texto} maxLength={200} rows={3} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: Hoje tem pizza grande com 20% de desconto, {nome}!" className={`${INPUT} h-auto py-2`} data-avulsa-texto /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Imagem (opcional, link https)</span>
            <input value={imagem} onChange={(e) => setImagem(e.target.value)} placeholder="https://…" className={INPUT} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Ao tocar, abre</span>
              <select value={destino} onChange={(e) => setDestino(e.target.value as typeof destino)} className={INPUT} data-avulsa-destino>
                <option value="cardapio">Cardápio</option>
                <option value="promocoes">Promoções</option>
                <option value="produto">Um produto</option>
                <option value="cupom">Um cupom</option>
              </select></label>
            {destino === 'produto' && (
              <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Produto</span>
                <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)} className={INPUT}>
                  <option value="">Escolha…</option>
                  {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select></label>
            )}
            {destino === 'cupom' && (
              <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Código do cupom</span>
                <input value={cupom} onChange={(e) => setCupom(e.target.value.toUpperCase())} className={INPUT} /></label>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Para quem</span>
              <select value={publico} onChange={(e) => setPublico(e.target.value as typeof publico)} className={INPUT} data-avulsa-publico>
                <option value="todos">Todos com notificação ativa</option>
                <option value="recentes">Quem pediu nos últimos X dias</option>
                <option value="inativos">Quem não pede há X dias</option>
                <option value="fidelidade">Clientes da fidelidade</option>
              </select></label>
            {(publico === 'recentes' || publico === 'inativos') && (
              <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Dias</span>
                <input type="number" min={1} max={365} value={dias} onChange={(e) => setDias(Number(e.target.value))} className={INPUT} /></label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[13px]"><input type="radio" checked={quando === 'agora'} onChange={() => setQuando('agora')} /> Enviar agora</label>
            <label className="flex items-center gap-1.5 text-[13px]"><input type="radio" checked={quando === 'agendar'} onChange={() => setQuando('agendar')} /> Agendar</label>
            {quando === 'agendar' && <input type="datetime-local" value={agendado} onChange={(e) => setAgendado(e.target.value)} className={`${INPUT} w-auto`} />}
          </div>
          <p className="text-[12.5px] text-text-main" data-avulsa-previsto>
            {previsto === null ? 'Contando destinatários…' : <>Vai para <strong>{previsto.clientes}</strong> cliente(s) em <strong>{previsto.aparelhos}</strong> aparelho(s).</>}
          </p>
          {erro && <p className="text-[12px] font-semibold text-danger">{erro}</p>}
          {!confirmar ? (
            <button type="button" disabled={!texto.trim() || !titulo.trim() || (quando === 'agendar' && !agendado) || (destino === 'produto' && !produtoId) || (destino === 'cupom' && !cupom.trim())}
              onClick={() => setConfirmar(true)} className={`${BOTAO} bg-primary text-white hover:bg-primary-dark`} data-avulsa-enviar>
              <Send className="h-4 w-4" /> {quando === 'agendar' ? 'Agendar' : 'Enviar'}
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-[6px] bg-alert p-3 text-[13px] text-text-main" data-avulsa-confirmar>
              <span>Confirmar envio para {previsto?.clientes ?? 0} cliente(s)?</span>
              <button type="button" onClick={() => setConfirmar(false)} className={`${BOTAO} border border-border bg-white text-text-main`}>Voltar</button>
              <button type="button" disabled={enviando} onClick={() => void enviar()} className={`${BOTAO} bg-primary text-white`} data-avulsa-confirmar-sim>
                {enviando ? 'Enviando…' : 'Confirmar'}
              </button>
            </div>
          )}
        </div>
        <PreviaNotificacao loja={loja} titulo={aplicarVariaveis(titulo, { ...EXEMPLO, loja: loja.nome })} texto={aplicarVariaveis(texto || 'Seu texto aparece aqui.', { ...EXEMPLO, loja: loja.nome })} imagem={imagem.startsWith('https://') ? imagem : null} />
      </div>
    </Cartao>
  )
}

export function PushNotificacoes() {
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [limites, setLimites] = useState({ limiteDia: 1, limiteSemana: 3, antecedenciaMin: 30, telefoneTeste: '' })
  const [salvandoLim, setSalvandoLim] = useState(false)
  const [testando, setTestando] = useState(false)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const r = await api<Dados>('/api/admin/campanhas/push')
    if (!r.ok) { setErro(r.erro ?? 'Erro'); return }
    setDados(r.dados!)
    const c = r.dados!.config
    setLimites({ limiteDia: c.limiteDia, limiteSemana: c.limiteSemana, antecedenciaMin: c.antecedenciaMin, telefoneTeste: c.telefoneTeste ?? '' })
  }, [])
  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 5000); return () => clearTimeout(t) }, [aviso])

  if (erro) return <p className="text-[13px] text-danger">{erro}</p>
  if (!dados) return <p className="text-[13px] text-text-subtle">Carregando…</p>

  if (!dados.liberado) {
    return (
      <Cartao className="p-6 text-center" data-push-nao-liberado>
        <div className="mx-auto mb-3 w-fit"><BolhaIcone icone={Bell} tom="azul" tamanho={48} /></div>
        <h3 className="text-[15px] font-bold">Notificações do app</h3>
        <p className="mx-auto mt-1 max-w-[460px] text-[13px] text-text-subtle">
          Avise seus clientes no celular, com o ícone e o nome da sua loja: pedido saiu, promoção, cupom, fidelidade.
          Ainda não está liberado para a sua loja — fale com o suporte da Menuzia para ativar.
        </p>
      </Cartao>
    )
  }

  const r = dados.resumo
  const stats: { rotulo: string; valor: number; icone: typeof Bell; tom: 'azul' | 'verde' | 'roxo' | 'cinza' | 'ambar' }[] = [
    { rotulo: 'Aparelhos com notificação', valor: r.total, icone: Bell, tom: 'azul' },
    { rotulo: 'Android', valor: r.android, icone: Smartphone, tom: 'verde' },
    { rotulo: 'iPhone', valor: r.ios, icone: Tablet, tom: 'cinza' },
    { rotulo: 'Computador', valor: r.desktop + r.outro, icone: Monitor, tom: 'roxo' },
    { rotulo: 'Instalaram o app', valor: r.instalados, icone: Download, tom: 'ambar' },
    { rotulo: 'Clientes identificados', valor: r.clientes, icone: Users, tom: 'azul' },
  ]

  return (
    <div className="space-y-4" data-push-painel>
      {aviso && <p className="rounded-[6px] bg-price-bg px-3 py-2 text-[13px] font-semibold text-price-text" role="status" data-push-aviso>{aviso}</p>}
      {!dados.servidorConfigurado && (
        <p className="rounded-[6px] bg-warn-bg px-3 py-2 text-[13px] text-text-main">As chaves de envio ainda não estão configuradas no servidor. Fale com o suporte.</p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-push-resumo>
        {stats.map((s) => (
          <Cartao key={s.rotulo} className="flex items-center gap-3 p-3">
            <BolhaIcone icone={s.icone} tom={s.tom} tamanho={36} />
            <div className="min-w-0">
              <p className="text-[20px] font-bold leading-none text-text-main">{s.valor}</p>
              <p className="mt-1 truncate text-[11.5px] text-text-subtle">{s.rotulo}</p>
            </div>
          </Cartao>
        ))}
      </div>

      <Cartao className="p-4" data-push-teste>
        <TituloBloco titulo="Testar no seu celular" subtitulo="Abra o cardápio da loja no seu celular, ative as notificações (Perfil › Notificações) com o seu telefone e toque em enviar." />
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Telefone de teste</span>
            <input value={limites.telefoneTeste} onChange={(e) => setLimites({ ...limites, telefoneTeste: e.target.value })} placeholder="(27) 99999-0000" className={`${INPUT} w-[200px]`} data-push-telefone-teste /></label>
          <button type="button" disabled={testando} className={`${BOTAO} bg-primary text-white hover:bg-primary-dark`} data-push-testar
            onClick={async () => {
              setTestando(true)
              setErroAcao(null)
              const s = await api('/api/admin/campanhas/push/config', 'PUT', limites)
              const t = s.ok ? await api<{ aparelhos: number }>('/api/admin/campanhas/push/teste', 'POST', {}) : s
              setTestando(false)
              if (t.ok) setAviso(`Notificação de teste enviada para ${(t.dados as { aparelhos: number }).aparelhos} aparelho(s).`)
              else setErroAcao(t.erro ?? 'Não foi possível enviar.')
            }}>
            <Send className="h-4 w-4" /> {testando ? 'Enviando…' : 'Enviar notificação de teste para mim'}
          </button>
        </div>
        {erroAcao && <p className="mt-2 text-[12px] font-semibold text-danger" data-push-teste-erro>{erroAcao}</p>}
      </Cartao>

      <div>
        <TituloBloco titulo="Automações" subtitulo="Saem sozinhas, só no horário da loja e dentro do limite por cliente. Quando várias valem ao mesmo tempo, vai só a mais importante (cupom > fidelidade > promoção > recompra)." />
        <div className="mt-3 grid gap-3">
          {ORDEM.map((t) => dados.automacoes.find((a) => a.tipo === t)).filter(Boolean).map((a) => (
            <CartaoAutomacao key={a!.tipo} a={a!} loja={dados.loja} relatorio={dados.relatorio.porTipo[a!.tipo]} onSalvo={(m) => { setAviso(m); void carregar() }} />
          ))}
        </div>
      </div>

      <NovaAvulsa loja={dados.loja} onCriada={(m) => { setAviso(m); void carregar() }} />

      {dados.avulsas.length > 0 && (
        <Cartao className="p-4" data-push-avulsas>
          <TituloBloco titulo="Notificações avulsas" subtitulo="Últimas 30, com o resultado." />
          <ul className="mt-3 divide-y divide-border">
            {dados.avulsas.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-text-main">{a.titulo} — <span className="font-normal">{a.texto}</span></p>
                  <p className="text-[11.5px] text-text-subtle">
                    {rotuloPublico(a.publico)} · {a.agendado_em ? `agendada para ${new Date(a.agendado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : `criada ${new Date(a.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                    {a.criado_por_nome ? ` · por ${a.criado_por_nome}` : ''}
                  </p>
                  <LinhaRelatorio r={a.relatorio} />
                </div>
                <div className="flex items-center gap-2">
                  <Etiqueta tom={a.status === 'concluida' ? 'verde' : a.status === 'cancelada' ? 'vermelho' : 'ambar'}>
                    {{ agendada: 'Aguardando', enviando: 'Enviando', concluida: 'Enviada', cancelada: 'Cancelada' }[a.status] ?? a.status}
                  </Etiqueta>
                  {a.status === 'agendada' && (
                    <button type="button" className="text-[12px] font-semibold text-danger" onClick={async () => { const r2 = await api(`/api/admin/campanhas/push/avulsas/${a.id}`, 'PATCH', {}); if (r2.ok) { setAviso('Notificação cancelada.'); void carregar() } }}>
                      Cancelar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      <Cartao className="p-4" data-push-limites>
        <TituloBloco titulo="Limites e horários" subtitulo={`Marketing nunca sai de madrugada (00:00–07:59) e só com a loja aberta ou pouco antes de abrir. Teto do sistema: ${dados.config.tetoDia} por dia e ${dados.config.tetoSemana} por semana.`} />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Por cliente, por dia</span>
            <input type="number" min={0} max={dados.config.tetoDia} value={limites.limiteDia} onChange={(e) => setLimites({ ...limites, limiteDia: Number(e.target.value) })} className={`${INPUT} w-28`} data-push-limite-dia /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Por cliente, por semana</span>
            <input type="number" min={0} max={dados.config.tetoSemana} value={limites.limiteSemana} onChange={(e) => setLimites({ ...limites, limiteSemana: Number(e.target.value) })} className={`${INPUT} w-28`} /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Minutos antes de abrir</span>
            <input type="number" min={0} max={120} value={limites.antecedenciaMin} onChange={(e) => setLimites({ ...limites, antecedenciaMin: Number(e.target.value) })} className={`${INPUT} w-28`} /></label>
          <button type="button" disabled={salvandoLim} className={`${BOTAO} bg-primary text-white hover:bg-primary-dark`} data-push-salvar-limites
            onClick={async () => {
              setSalvandoLim(true)
              setErroAcao(null)
              const s = await api('/api/admin/campanhas/push/config', 'PUT', limites)
              setSalvandoLim(false)
              if (s.ok) setAviso('Limites salvos.')
              else setErroAcao(s.erro ?? 'Não foi possível salvar.')
            }}>
            {salvandoLim ? 'Salvando…' : 'Salvar limites'}
          </button>
        </div>
        {erroAcao && <p className="mt-2 text-[12px] font-semibold text-danger">{erroAcao}</p>}
      </Cartao>
    </div>
  )
}

