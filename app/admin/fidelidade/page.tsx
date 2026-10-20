'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { TopBar } from '@/components/layout/topbar'
import { Segmentado } from '@/components/ui/topo-compacto'
import { classeBotao } from '@/components/ui/botoes'
import { IcoAdicionar, IcoCashback, IcoCupom, IcoEditar, IcoExcluir, IcoFechar, IcoMeta, IcoPresente, IcoSino } from '@/components/icones/sistema'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario, listarItens, type ItemCardapio } from '@/lib/queries/cardapio'
import type { CampanhaFidelidadeComStats, CampanhaFidelidadeInput, CupomComStats, CupomInput } from '@/lib/queries/fidelidade'
import type { RegraCashbackComItem } from '@/lib/queries/cashback'
import { formatarReal } from '@/lib/moeda'

/**
 * Fidelidade (redesenho da Etapa 7, 20/10/2026 — SÓ LOCAL até o dono aprovar): campanhas, cupons e o CASHBACK novo
 * no visual do Kanban (docs/design/guia-visual-menuzia.md): três cartões de resumo, controle segmentado, listas
 * compactas com etiquetas pastel, botões de components/ui/botoes.ts e ícones Phosphor. As regras continuam no
 * servidor (/api/admin/fidelidade/*); aqui é só tela.
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

const brl = formatarReal

/** Campo do guia: 36px (44px no toque), canto 4px, borda cinza. */
const CAMPO = 'h-[36px] w-full rounded-[4px] border border-[#D1D5DB] bg-white px-[10px] text-[13px] text-[#1F2937] outline-none placeholder:text-[#9CA3AF] hover:border-[#9AA6B1] focus-visible:shadow-[0_0_0_2px_rgba(6,136,212,0.4)] max-lg:h-[44px]'
const CAMPO_AREA = 'w-full rounded-[4px] border border-[#D1D5DB] bg-white px-[10px] py-[8px] text-[13px] text-[#1F2937] outline-none placeholder:text-[#9CA3AF] hover:border-[#9AA6B1] focus-visible:shadow-[0_0_0_2px_rgba(6,136,212,0.4)]'
/** Contorno branco com borda (guia §4 Botões). */
const BOTAO_CONTORNO = 'inline-flex h-[32px] items-center justify-center gap-[6px] whitespace-nowrap rounded-[4px] border border-[#D1D5DB] bg-white px-3 text-[12px] font-semibold text-[#1F2937] transition-colors hover:bg-[#F3F4F6] disabled:opacity-50 max-lg:h-[44px]'
/** Botão só de ícone das listas (36px; abaixo de lg vira botão com texto, 44px). */
const BOTAO_ICONE = 'inline-flex h-[36px] w-[36px] items-center justify-center rounded-[4px] border border-[#D1D5DB] bg-white text-[#4B5563] transition-colors hover:bg-[#F3F4F6] max-lg:h-[44px] max-lg:w-auto max-lg:flex-1 max-lg:gap-[6px] max-lg:px-3 max-lg:text-[12px] max-lg:font-semibold'

const DAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const DIA_SEMANA_LABEL: Record<number, string> = { 0: 'aos domingos', 1: 'às segundas', 2: 'às terças', 3: 'às quartas', 4: 'às quintas', 5: 'às sextas', 6: 'aos sábados' }

function diasSemanaTexto(dias: number[]): string {
  const labels = [...dias].sort().map((d) => DIA_SEMANA_LABEL[d]).filter((l): l is string => Boolean(l))
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`
}

function formatarData(iso: string | null): string {
  if (!iso) return ''
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

const TIPO_META_LABEL: Record<CampanhaFidelidadeInput['tipoMeta'], string> = { valor_gasto: 'Valor gasto (R$)', qtd_pedidos: 'Quantidade de pedidos', qtd_itens: 'Quantidade de itens' }
const PREMIO_TIPO_LABEL: Record<CampanhaFidelidadeInput['premioTipo'], string> = { item_gratis: 'Item grátis', desconto_percentual: 'Desconto percentual (%)', desconto_valor: 'Desconto em valor (R$)', entrega_gratis: 'Entrega grátis' }
const CUPOM_TIPO_LABEL: Record<CupomInput['tipo'], string> = { desconto_percentual: 'Desconto percentual (%)', desconto_valor: 'Desconto em valor (R$)', entrega_gratis: 'Entrega grátis', item_gratis: 'Item grátis' }
const PUBLICO_LABEL: Record<NonNullable<CupomInput['publico']>, string> = { todos: 'Todos os clientes', primeira_compra: 'Primeira compra', recompra: 'Recompra (clientes sumidos)' }
/** O que cada público significa na prática (o limite total já foi confundido com "por cliente"). */
const PUBLICO_AJUDA: Record<NonNullable<CupomInput['publico']>, string> = {
  todos: 'Qualquer pessoa que digitar o código, quantos clientes forem.',
  primeira_compra: 'Vale para TODO cliente que ainda não recebeu nenhum pedido — cada um usa uma vez, sem limite de quantos clientes. O cliente precisa entrar com o telefone no cardápio.',
  recompra: 'Para quem fez no máximo 1 pedido ou sumiu há um tempo. Cada um usa uma vez. O cliente precisa entrar com o telefone no cardápio.',
}

function metaLegivel(c: CampanhaFidelidadeComStats): string {
  let base: string
  if (c.tipoMeta === 'valor_gasto') base = `${brl(c.metaValor ?? 0)} gastos`
  else if (c.tipoMeta === 'qtd_pedidos') base = `${c.metaQuantidade ?? 0} pedidos`
  else base = `${c.metaQuantidade ?? 0} itens`
  if (c.diasSemanaContam.length > 0) base += ` ${diasSemanaTexto(c.diasSemanaContam)}`
  return base
}

function premioLegivel(c: { premioTipo: CampanhaFidelidadeInput['premioTipo']; premioValor: number | null; premioItemNome?: string }): string {
  switch (c.premioTipo) {
    case 'item_gratis': return `${c.premioItemNome ?? 'Item'} grátis`
    case 'desconto_percentual': return `${c.premioValor ?? 0}% de desconto`
    case 'desconto_valor': return `${brl(c.premioValor ?? 0)} de desconto`
    case 'entrega_gratis': return 'Entrega grátis'
  }
}

function cupomTipoLegivel(c: CupomComStats): string {
  switch (c.tipo) {
    case 'desconto_percentual': return `${c.valor ?? 0}% de desconto`
    case 'desconto_valor': return `${brl(c.valor ?? 0)} de desconto`
    case 'entrega_gratis': return 'Entrega grátis'
    case 'item_gratis': return `${c.itemNome ?? 'Item'} grátis`
  }
}

function publicoLegivel(c: CupomComStats): string {
  if (c.publico === 'primeira_compra') return 'Primeira compra'
  if (c.publico === 'recompra') return `Recompra${c.diasInatividade != null ? ` · ${c.diasInatividade} dias` : ''}`
  return 'Todos'
}

function cashbackLegivel(r: RegraCashbackComItem): string {
  return r.tipo === 'valor' ? `${brl(r.valor)} por unidade` : `${r.valor}% do valor`
}

// ─── Peças visuais (guia §2 e §4) ─────────────────────────────────────────────

type TomEtiqueta = 'verde' | 'cinza' | 'vermelho' | 'azul' | 'roxo' | 'laranja'
const ETIQUETA: Record<TomEtiqueta, { fundo: string; texto: string; ponto: string }> = {
  verde: { fundo: '#DCFCE7', texto: '#15803D', ponto: '#10B981' },
  cinza: { fundo: '#F1F2F4', texto: '#4B5563', ponto: '#9CA3AF' },
  vermelho: { fundo: '#FEE2E2', texto: '#B91C1C', ponto: '#EF4444' },
  azul: { fundo: '#E0F2FE', texto: '#0369A1', ponto: '#0688D4' },
  roxo: { fundo: '#F3E8FF', texto: '#7E22CE', ponto: '#A855F7' },
  laranja: { fundo: '#FFEDD5', texto: '#C2410C', ponto: '#F97316' },
}

/** Etiqueta de status: 11,5px/600, canto 4px, fundo pastel + texto da mesma cor, ponto opcional. */
function Etiqueta({ tom, ponto = false, children, testid }: { tom: TomEtiqueta; ponto?: boolean; children: ReactNode; testid?: string }) {
  const t = ETIQUETA[tom]
  return (
    <span data-testid={testid} className="inline-flex max-w-full items-center gap-[5px] rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-semibold" style={{ backgroundColor: t.fundo, color: t.texto }}>
      {ponto && <span className="h-[6px] w-[6px] rounded-full" style={{ backgroundColor: t.ponto }} aria-hidden="true" />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}

/** Cartão de resumo: rótulo pequeno → número grande (com sufixo menor) → uma linha de detalhe. Sem ícone em bolha. */
function CartaoResumo({ rotulo, valor, sufixo, detalhe, testid }: { rotulo: string; valor: ReactNode; sufixo?: string; detalhe: string; testid?: string }) {
  return (
    <section data-testid={testid} className="min-w-0 rounded-[6px] border border-[#E5E7EB] bg-white px-[16px] py-[12px] max-md:px-[12px]">
      <div className="truncate text-[11.5px] font-semibold text-[#5B6472]">{rotulo}</div>
      <div className="mt-[2px] flex items-baseline gap-[4px]">
        <span className="text-[24px] font-semibold leading-[28px] tabular-nums text-[#1F2937] max-md:text-[20px]">{valor}</span>
        {sufixo && <span className="text-[12px] text-[#5B6472]">{sufixo}</span>}
      </div>
      <div className="mt-[2px] truncate text-[12px] text-[#5B6472]">{detalhe}</div>
    </section>
  )
}

/** Cabeçalho de cartão: ícone 16px cinza + título 14/600 + contador cinza + descrição após "·" (só a partir de md). */
function CabecalhoCartao({ icone, titulo, contador, descricao, acoes }: { icone: ReactNode; titulo: string; contador?: number; descricao?: string; acoes?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] border-b border-[#E5E7EB] px-[16px] py-[12px]">
      <div className="flex min-w-0 flex-1 items-center gap-[8px]">
        <span className="flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center text-[#6B7280]">{icone}</span>
        <h2 className="text-[14px] font-semibold text-[#1F2937]">{titulo}</h2>
        {contador !== undefined && <span className="text-[13px] text-[#6B7280]">{contador}</span>}
        {descricao && <span className="hidden min-w-0 truncate text-[12.5px] text-[#5B6472] md:inline">· {descricao}</span>}
      </div>
      {acoes && <div className="flex items-center gap-[8px] max-lg:w-full max-lg:[&>*]:flex-1">{acoes}</div>}
    </div>
  )
}

/** Estado vazio: uma linha centralizada de 13px em cinza, ~60px, com ação opcional ao lado. */
function Vazio({ texto, acao }: { texto: string; acao?: ReactNode }) {
  return (
    <div className="flex min-h-[60px] flex-wrap items-center justify-center gap-[12px] px-[16px] py-[12px] text-center text-[13px] text-[#5B6472]">
      <span>{texto}</span>
      {acao}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-[4px] block text-[12px] font-medium text-[#4B5563]">{label}</label>
      {children}
      {hint && <p className="mt-[4px] text-[11.5px] text-[#5B6472]">{hint}</p>}
    </div>
  )
}

function ToggleSwitch({ checked, onChange, disabled, rotulo }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; rotulo?: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={rotulo} disabled={disabled} onClick={() => onChange(!checked)}
      className={['inline-flex h-[22px] w-[38px] !min-h-0 flex-shrink-0 items-center rounded-full border p-[2px] transition-colors disabled:cursor-not-allowed disabled:opacity-50', checked ? 'border-[#0688D4] bg-[#0688D4]' : 'border-[#D1D5DB] bg-[#D1D5DB]'].join(' ')}
    >
      <span className={['block h-[16px] w-[16px] flex-shrink-0 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[16px]' : 'translate-x-0'].join(' ')} />
    </button>
  )
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-[16px]">
      <div>
        <div className="text-[13px] font-medium text-[#1F2937]">{label}</div>
        {hint && <p className="mt-[2px] text-[11.5px] text-[#5B6472]">{hint}</p>}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} rotulo={label} />
    </div>
  )
}

/** Chips D S T Q Q S S — mesmo padrão do gestor de cardápio. */
function DiasChips({ dias, onChange }: { dias: number[]; onChange: (dias: number[]) => void }) {
  const ativos = useMemo(() => new Set(dias), [dias])
  function toggle(dia: number) {
    const next = new Set(ativos)
    if (next.has(dia)) next.delete(dia)
    else next.add(dia)
    onChange([...next].sort())
  }
  return (
    <div className="flex gap-[4px]">
      {DAY_LABELS.map((label, dia) => (
        <button
          key={dia} type="button" onClick={() => toggle(dia)} aria-pressed={ativos.has(dia)}
          className={['flex h-[28px] w-[28px] !min-h-0 select-none items-center justify-center rounded-[4px] border text-[11.5px] font-semibold transition-colors max-lg:h-[44px] max-lg:w-[40px]', ativos.has(dia) ? 'border-[#0688D4] bg-[#0688D4] text-white' : 'border-[#D1D5DB] bg-white text-[#4B5563] hover:border-[#0688D4]'].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Avatar 36px da lista compacta: foto do item ou inicial. */
function ItemThumb({ nome, imagemUrl, tamanho = 36 }: { nome: string; imagemUrl: string | null; tamanho?: number }) {
  const estilo = { width: tamanho, height: tamanho }
  if (imagemUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imagemUrl} alt="" loading="lazy" decoding="async" style={estilo} className="flex-shrink-0 rounded-[4px] border border-[#E5E7EB] object-cover" />
  }
  return <div style={estilo} className="flex flex-shrink-0 items-center justify-center rounded-[4px] border border-[#E5E7EB] bg-[#F1F2F4] text-[13px] font-semibold text-[#4B5563]">{nome.charAt(0).toUpperCase()}</div>
}

/** Bolha neutra de 36px com ícone (campanha e cupom sem item). */
function IconeLista({ children }: { children: ReactNode }) {
  return <span className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-[4px] border border-[#E5E7EB] bg-[#F9FAFB] text-[#4B5563]">{children}</span>
}

/** Seletor de item do cardápio com busca client-side (thumb + nome + preço). */
function ItemSelector({ itens, value, onChange, travado = false }: { itens: ItemCardapio[]; value: string | null; onChange: (id: string | null) => void; travado?: boolean }) {
  const [busca, setBusca] = useState('')
  const selecionado = itens.find((i) => i.id === value)
  if (selecionado) {
    return (
      <div className="flex items-center gap-[12px] rounded-[4px] border border-[#E5E7EB] bg-[#F9FAFB] px-[12px] py-[8px]">
        <ItemThumb nome={selecionado.nome} imagemUrl={selecionado.imagemUrl} tamanho={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#1F2937]">{selecionado.nome}</p>
          <p className="text-[12px] text-[#5B6472]">{brl(selecionado.preco)}</p>
        </div>
        {!travado && <button type="button" onClick={() => onChange(null)} className={BOTAO_CONTORNO}>Trocar</button>}
      </div>
    )
  }
  const termo = busca.trim().toLowerCase()
  const filtrados = termo ? itens.filter((i) => i.nome.toLowerCase().includes(termo)) : itens
  return (
    <div className="space-y-[8px]">
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item do cardápio…" className={CAMPO} data-testid="seletor-item-busca" />
      <div className="max-h-[220px] divide-y divide-[#E5E7EB] overflow-y-auto rounded-[4px] border border-[#E5E7EB]">
        {itens.length === 0 ? (
          <p className="px-[12px] py-[12px] text-[12.5px] text-[#5B6472]">Nenhum item cadastrado no cardápio.</p>
        ) : filtrados.length === 0 ? (
          <p className="px-[12px] py-[12px] text-[12.5px] text-[#5B6472]">Nenhum item encontrado para “{busca}”.</p>
        ) : (
          filtrados.map((item) => (
            <button key={item.id} type="button" onClick={() => onChange(item.id)} className="flex w-full items-center gap-[12px] px-[12px] py-[8px] text-left transition-colors hover:bg-[#F3F4F6]">
              <ItemThumb nome={item.nome} imagemUrl={item.imagemUrl} tamanho={32} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[#1F2937]">{item.nome}</span>
              <span className="text-[12px] text-[#5B6472]">{brl(item.preco)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

/** Gaveta lateral (520px) com cabeçalho, corpo rolável e rodapé de ações. */
function Gaveta({ aberta, titulo, onFechar, rodape, children, testid }: { aberta: boolean; titulo: string; onFechar: () => void; rodape: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <>
      {aberta && <div className="fixed inset-0 z-40 bg-[#111827]/40" onClick={onFechar} />}
      <div data-testid={testid} aria-hidden={!aberta} className={['fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col bg-white shadow-2xl transition-transform duration-300', aberta ? 'translate-x-0' : 'translate-x-full'].join(' ')}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[#E5E7EB] px-[16px] py-[12px]">
          <h2 className="text-[15px] font-semibold text-[#1F2937]">{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className={BOTAO_ICONE.replace('max-lg:w-auto max-lg:flex-1 max-lg:gap-[6px] max-lg:px-3 max-lg:text-[12px] max-lg:font-semibold', 'max-lg:w-[44px]')}><IcoFechar className="h-4 w-4" /></button>
        </div>
        {aberta && <div className="flex-1 space-y-[16px] overflow-y-auto px-[16px] py-[16px]">{children}</div>}
        <div className="flex flex-shrink-0 items-center justify-between gap-[12px] border-t border-[#E5E7EB] bg-white px-[16px] py-[12px]">{rodape}</div>
      </div>
    </>
  )
}

function Erro({ texto }: { texto: string | null }) {
  if (!texto) return null
  return <p role="alert" className="rounded-[4px] border border-[#FECACA] bg-[#FEE2E2] px-[12px] py-[8px] text-[13px] text-[#B91C1C]">{texto}</p>
}

// ─── Formulários (state) ──────────────────────────────────────────────────────

interface CampanhaForm {
  nome: string; descricao: string; ativa: boolean; tipoMeta: CampanhaFidelidadeInput['tipoMeta']; metaValor: string; metaQuantidade: string
  diasSemanaContam: number[]; diasSemanaResgate: number[]; premioTipo: CampanhaFidelidadeInput['premioTipo']; premioItemId: string | null; premioValor: string; repetivel: boolean
}
function campanhaFormDefault(): CampanhaForm {
  return { nome: '', descricao: '', ativa: true, tipoMeta: 'valor_gasto', metaValor: '', metaQuantidade: '', diasSemanaContam: [], diasSemanaResgate: [], premioTipo: 'item_gratis', premioItemId: null, premioValor: '', repetivel: true }
}
function campanhaInputFromForm(f: CampanhaForm): CampanhaFidelidadeInput {
  const temDesconto = f.premioTipo === 'desconto_percentual' || f.premioTipo === 'desconto_valor'
  return {
    nome: f.nome.trim(), descricao: f.descricao.trim(), ativa: f.ativa, tipoMeta: f.tipoMeta,
    metaValor: f.tipoMeta === 'valor_gasto' ? Number(f.metaValor) : null, metaQuantidade: f.tipoMeta === 'valor_gasto' ? null : Number(f.metaQuantidade),
    diasSemanaContam: f.diasSemanaContam, diasSemanaResgate: f.diasSemanaResgate, premioTipo: f.premioTipo,
    premioItemId: f.premioTipo === 'item_gratis' ? f.premioItemId : null, premioValor: temDesconto ? Number(f.premioValor) : null, repetivel: f.repetivel,
  }
}
/** PATCH é replace-full: monta o Input COMPLETO a partir do registro da lista. */
function campanhaInputFromRecord(c: CampanhaFidelidadeComStats): CampanhaFidelidadeInput {
  return { nome: c.nome, descricao: c.descricao, ativa: c.ativa, tipoMeta: c.tipoMeta, metaValor: c.metaValor, metaQuantidade: c.metaQuantidade, diasSemanaContam: c.diasSemanaContam, diasSemanaResgate: c.diasSemanaResgate, premioTipo: c.premioTipo, premioItemId: c.premioItemId, premioValor: c.premioValor, repetivel: c.repetivel }
}

interface CupomForm {
  codigo: string; descricao: string; ativo: boolean; tipo: CupomInput['tipo']; valor: string; itemId: string | null; publico: NonNullable<CupomInput['publico']>
  diasInatividade: string; diasSemana: number[]; validadeInicio: string; validadeFim: string; valorMinimoPedido: string; usoUnicoPorCliente: boolean; maxUsos: string
}
function cupomFormDefault(): CupomForm {
  return { codigo: '', descricao: '', ativo: true, tipo: 'desconto_percentual', valor: '', itemId: null, publico: 'todos', diasInatividade: '', diasSemana: [], validadeInicio: '', validadeFim: '', valorMinimoPedido: '', usoUnicoPorCliente: true, maxUsos: '' }
}
function cupomInputFromForm(f: CupomForm): CupomInput {
  const temValor = f.tipo === 'desconto_percentual' || f.tipo === 'desconto_valor'
  return {
    codigo: f.codigo.trim(), descricao: f.descricao.trim(), ativo: f.ativo, tipo: f.tipo, valor: temValor ? Number(f.valor) : null, itemId: f.tipo === 'item_gratis' ? f.itemId : null,
    publico: f.publico, diasInatividade: f.publico === 'recompra' && f.diasInatividade !== '' ? Number(f.diasInatividade) : null, diasSemana: f.diasSemana,
    validadeInicio: f.validadeInicio || null, validadeFim: f.validadeFim || null, valorMinimoPedido: f.valorMinimoPedido !== '' ? Number(f.valorMinimoPedido) : null,
    usoUnicoPorCliente: f.usoUnicoPorCliente, maxUsos: f.maxUsos !== '' ? Number(f.maxUsos) : null,
  }
}
function cupomInputFromRecord(c: CupomComStats): CupomInput {
  return { codigo: c.codigo, descricao: c.descricao, ativo: c.ativo, tipo: c.tipo, valor: c.valor, itemId: c.itemId, publico: c.publico, diasInatividade: c.diasInatividade, diasSemana: c.diasSemana, validadeInicio: c.validadeInicio, validadeFim: c.validadeFim, valorMinimoPedido: c.valorMinimoPedido, usoUnicoPorCliente: c.usoUnicoPorCliente, maxUsos: c.maxUsos }
}

interface CashbackForm { itemId: string | null; tipo: 'valor' | 'percentual'; valor: string; validadeDias: string; ativo: boolean }
function cashbackFormDefault(): CashbackForm {
  return { itemId: null, tipo: 'valor', valor: '', validadeDias: '30', ativo: true }
}

// ─── Página ───────────────────────────────────────────────────────────────────

type Aba = 'campanhas' | 'cupons' | 'cashback'
const ABAS: { id: Aba; rotulo: string }[] = [{ id: 'campanhas', rotulo: 'Campanhas' }, { id: 'cupons', rotulo: 'Cupons' }, { id: 'cashback', rotulo: 'Cashback' }]

export default function FidelidadePage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [aba, setAba] = useState<Aba>('campanhas')
  const [campanhas, setCampanhas] = useState<CampanhaFidelidadeComStats[]>([])
  const [cupons, setCupons] = useState<CupomComStats[]>([])
  const [regras, setRegras] = useState<RegraCashbackComItem[]>([])
  const [itens, setItens] = useState<ItemCardapio[]>([])
  const [loading, setLoading] = useState(true)

  const [drawerCampanha, setDrawerCampanha] = useState(false)
  const [editandoCampanhaId, setEditandoCampanhaId] = useState<string | null>(null)
  const [formCampanha, setFormCampanha] = useState<CampanhaForm>(campanhaFormDefault())

  const [drawerCupom, setDrawerCupom] = useState(false)
  const [editandoCupomId, setEditandoCupomId] = useState<string | null>(null)
  const [formCupom, setFormCupom] = useState<CupomForm>(cupomFormDefault())

  const [drawerCashback, setDrawerCashback] = useState(false)
  const [editandoCashbackId, setEditandoCashbackId] = useState<string | null>(null)
  const [formCashback, setFormCashback] = useState<CashbackForm>(cashbackFormDefault())

  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // ── Carregar ──────────────────────────────────────────────────────────────
  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [resCampanhas, resCupons, resCashback] = await Promise.all([
        fetch('/api/admin/fidelidade/campanhas'),
        fetch('/api/admin/fidelidade/cupons'),
        fetch('/api/admin/fidelidade/cashback'),
      ])
      if (resCampanhas.ok) setCampanhas(await resCampanhas.json())
      if (resCupons.ok) setCupons(await resCupons.json())
      // Cashback (0211): sem a migration a API responde 400 e a tela segue com campanhas e cupons.
      if (resCashback.ok) setRegras(await resCashback.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    buscarRestauranteIdDoUsuario(supabase).then((id) => {
      if (!id) return
      carregar()
      listarItens(supabase, id).then(setItens).catch(() => {})
    })
  }, [supabase, carregar])

  // ── Campanhas ─────────────────────────────────────────────────────────────
  function abrirNovaCampanha() { setEditandoCampanhaId(null); setFormCampanha(campanhaFormDefault()); setErro(null); setDrawerCampanha(true) }
  function abrirEditarCampanha(c: CampanhaFidelidadeComStats) {
    setEditandoCampanhaId(c.id)
    setFormCampanha({
      nome: c.nome, descricao: c.descricao ?? '', ativa: c.ativa, tipoMeta: c.tipoMeta, metaValor: c.metaValor != null ? String(c.metaValor) : '', metaQuantidade: c.metaQuantidade != null ? String(c.metaQuantidade) : '',
      diasSemanaContam: c.diasSemanaContam, diasSemanaResgate: c.diasSemanaResgate, premioTipo: c.premioTipo, premioItemId: c.premioItemId, premioValor: c.premioValor != null ? String(c.premioValor) : '', repetivel: c.repetivel,
    })
    setErro(null); setDrawerCampanha(true)
  }
  async function salvarCampanha() {
    setSaving(true); setErro(null)
    try {
      const res = await fetch(editandoCampanhaId ? `/api/admin/fidelidade/campanhas/${editandoCampanhaId}` : '/api/admin/fidelidade/campanhas', {
        method: editandoCampanhaId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(campanhaInputFromForm(formCampanha)),
      })
      if (!res.ok) { const data = await res.json().catch(() => null); setErro(data?.error ?? 'Erro ao salvar campanha.'); return }
      setDrawerCampanha(false); setEditandoCampanhaId(null); carregar()
    } catch { setErro('Erro ao salvar campanha.') } finally { setSaving(false) }
  }
  async function toggleCampanhaAtiva(c: CampanhaFidelidadeComStats) {
    setCampanhas((prev) => prev.map((x) => (x.id === c.id ? { ...x, ativa: !c.ativa } : x)))
    const res = await fetch(`/api/admin/fidelidade/campanhas/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...campanhaInputFromRecord(c), ativa: !c.ativa }) })
    if (!res.ok) carregar()
  }
  async function excluirCampanha(id: string) {
    if (!confirm('Excluir esta campanha de fidelidade? O progresso dos clientes será perdido.')) return
    await fetch(`/api/admin/fidelidade/campanhas/${id}`, { method: 'DELETE' }); carregar()
  }

  // ── Cupons ────────────────────────────────────────────────────────────────
  function abrirNovoCupom() { setEditandoCupomId(null); setFormCupom(cupomFormDefault()); setErro(null); setDrawerCupom(true) }
  function abrirPresetCompreDeNovo() {
    setEditandoCupomId(null)
    setFormCupom({ ...cupomFormDefault(), descricao: 'Sentimos sua falta! Volte a pedir com 10% de desconto.', tipo: 'desconto_percentual', valor: '10', publico: 'recompra', diasInatividade: '30' })
    setErro(null); setDrawerCupom(true)
  }
  function abrirEditarCupom(c: CupomComStats) {
    setEditandoCupomId(c.id)
    setFormCupom({
      codigo: c.codigo, descricao: c.descricao ?? '', ativo: c.ativo, tipo: c.tipo, valor: c.valor != null ? String(c.valor) : '', itemId: c.itemId, publico: c.publico,
      diasInatividade: c.diasInatividade != null ? String(c.diasInatividade) : '', diasSemana: c.diasSemana, validadeInicio: c.validadeInicio ? c.validadeInicio.slice(0, 10) : '', validadeFim: c.validadeFim ? c.validadeFim.slice(0, 10) : '',
      valorMinimoPedido: c.valorMinimoPedido != null ? String(c.valorMinimoPedido) : '', usoUnicoPorCliente: c.usoUnicoPorCliente, maxUsos: c.maxUsos != null ? String(c.maxUsos) : '',
    })
    setErro(null); setDrawerCupom(true)
  }
  async function salvarCupom() {
    setSaving(true); setErro(null)
    try {
      const res = await fetch(editandoCupomId ? `/api/admin/fidelidade/cupons/${editandoCupomId}` : '/api/admin/fidelidade/cupons', {
        method: editandoCupomId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cupomInputFromForm(formCupom)),
      })
      if (!res.ok) { const data = await res.json().catch(() => null); setErro(data?.error ?? 'Erro ao salvar cupom.'); return }
      setDrawerCupom(false); setEditandoCupomId(null); carregar()
    } catch { setErro('Erro ao salvar cupom.') } finally { setSaving(false) }
  }
  async function toggleCupomAtivo(c: CupomComStats) {
    setCupons((prev) => prev.map((x) => (x.id === c.id ? { ...x, ativo: !c.ativo } : x)))
    const res = await fetch(`/api/admin/fidelidade/cupons/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...cupomInputFromRecord(c), ativo: !c.ativo }) })
    if (!res.ok) carregar()
  }
  async function excluirCupom(id: string) {
    if (!confirm('Excluir este cupom permanentemente?')) return
    await fetch(`/api/admin/fidelidade/cupons/${id}`, { method: 'DELETE' }); carregar()
  }

  // ── Cashback (Etapa 7) ────────────────────────────────────────────────────
  function abrirNovoCashback() { setEditandoCashbackId(null); setFormCashback(cashbackFormDefault()); setErro(null); setDrawerCashback(true) }
  function abrirEditarCashback(r: RegraCashbackComItem) {
    setEditandoCashbackId(r.id)
    setFormCashback({ itemId: r.itemId, tipo: r.tipo, valor: String(r.valor), validadeDias: String(r.validadeDias), ativo: r.ativo })
    setErro(null); setDrawerCashback(true)
  }
  async function salvarCashback() {
    setSaving(true); setErro(null)
    try {
      const res = await fetch('/api/admin/fidelidade/cashback', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: formCashback.itemId, tipo: formCashback.tipo, valor: Number(String(formCashback.valor).replace(',', '.')), validadeDias: Number(formCashback.validadeDias), ativo: formCashback.ativo }),
      })
      if (!res.ok) { const data = await res.json().catch(() => null); setErro(data?.error ?? 'Erro ao salvar o cashback.'); return }
      setDrawerCashback(false); setEditandoCashbackId(null); carregar()
    } catch { setErro('Erro ao salvar o cashback.') } finally { setSaving(false) }
  }
  async function toggleCashbackAtivo(r: RegraCashbackComItem) {
    setRegras((prev) => prev.map((x) => (x.id === r.id ? { ...x, ativo: !r.ativo } : x)))
    const res = await fetch('/api/admin/fidelidade/cashback', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: r.itemId, tipo: r.tipo, valor: r.valor, validadeDias: r.validadeDias, ativo: !r.ativo }) })
    if (!res.ok) carregar()
  }
  async function excluirCashback(r: RegraCashbackComItem) {
    if (!confirm(`Excluir o cashback de ${r.itemNome}? Os créditos que os clientes já ganharam continuam valendo até expirar.`)) return
    await fetch(`/api/admin/fidelidade/cashback?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' }); carregar()
  }

  // ── Resumos ───────────────────────────────────────────────────────────────
  const campanhasAtivas = campanhas.filter((c) => c.ativa).length
  const progredindo = campanhas.reduce((s, c) => s + c.clientesProgredindo, 0)
  const ganhos = campanhas.reduce((s, c) => s + c.recompensasGanhas, 0)
  const cuponsAtivos = cupons.filter((c) => c.ativo).length
  const usosCupons = cupons.reduce((s, c) => s + c.usos, 0)
  const regrasAtivas = regras.filter((r) => r.ativo).length
  const cashbackAberto = regras.reduce((s, r) => s + r.valorAberto, 0)
  const creditosAbertos = regras.reduce((s, r) => s + r.creditosAbertos, 0)

  const premioTemValor = formCampanha.premioTipo === 'desconto_percentual' || formCampanha.premioTipo === 'desconto_valor'
  const cupomTemValor = formCupom.tipo === 'desconto_percentual' || formCupom.tipo === 'desconto_valor'
  const itemCashback = itens.find((i) => i.id === formCashback.itemId) ?? null
  const valorCashbackNum = Number(String(formCashback.valor).replace(',', '.'))
  const previaCashback = itemCashback && valorCashbackNum > 0 && Number(formCashback.validadeDias) > 0
    ? `Quem comprar ${itemCashback.nome} ganha ${formCashback.tipo === 'valor' ? `${brl(valorCashbackNum)} por unidade` : `${valorCashbackNum}% do valor (${brl((itemCashback.preco * valorCashbackNum) / 100)} no preço atual)`} para usar em até ${formCashback.validadeDias} dias.`
    : null

  const botaoNovo = (texto: string, onClick: () => void, testid: string) => (
    <button type="button" onClick={onClick} className={classeBotao('azul', 'normal')} data-testid={testid}><IcoAdicionar className="h-[14px] w-[14px]" />{texto}</button>
  )

  return (
    <div className="flex h-full flex-col overflow-hidden" data-painel>
      <TopBar
        title="Fidelidade"
        breadcrumb="Campanhas, cupons e cashback"
        right={
          <Link href="/admin/ajustes?aba=notificacoes" className={BOTAO_CONTORNO} data-atalho-notificacoes>
            <IcoSino className="h-4 w-4" /> Notificações do app
          </Link>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col gap-[12px] overflow-y-auto p-[16px] lg:p-[24px]" data-testid="fidelidade-pagina">
        {/* Cartões de resumo: fileira de 3 também no celular (guia §4). */}
        <div className="grid grid-cols-3 gap-[12px] max-md:gap-[8px]" data-testid="fidelidade-resumos">
          <CartaoResumo rotulo="Campanhas" valor={loading ? '–' : campanhasAtivas} sufixo={loading ? undefined : `de ${campanhas.length} ativas`} detalhe={loading ? ' ' : `${progredindo} progredindo · ${ganhos} prêmios`} testid="resumo-campanhas" />
          <CartaoResumo rotulo="Cupons" valor={loading ? '–' : cuponsAtivos} sufixo={loading ? undefined : `de ${cupons.length} ativos`} detalhe={loading ? ' ' : `${usosCupons} ${usosCupons === 1 ? 'uso' : 'usos'} no total`} testid="resumo-cupons" />
          <CartaoResumo rotulo="Cashback" valor={loading ? '–' : regrasAtivas} sufixo={loading ? undefined : regrasAtivas === 1 ? 'item ativo' : 'itens ativos'} detalhe={loading ? ' ' : `${brl(cashbackAberto)} em ${creditosAbertos} ${creditosAbertos === 1 ? 'crédito' : 'créditos'} abertos`} testid="resumo-cashback" />
        </div>

        {/* Linha de filtros: segmentado à esquerda, ações à direita. */}
        <div className="flex flex-wrap items-center gap-[8px]">
          <Segmentado valor={aba} opcoes={ABAS} onMudar={setAba} rotulo="Seção" testidPrefixo="fidelidade-aba-" />
          <div className="ml-auto flex flex-wrap items-center gap-[8px] max-md:ml-0 max-md:w-full max-md:[&>*]:flex-1">
            {aba === 'campanhas' && botaoNovo('Nova campanha', abrirNovaCampanha, 'nova-campanha')}
            {aba === 'cupons' && (
              <>
                <button type="button" onClick={abrirPresetCompreDeNovo} className={BOTAO_CONTORNO} data-testid="cupom-compre-de-novo">Compre de novo</button>
                {botaoNovo('Novo cupom', abrirNovoCupom, 'novo-cupom')}
              </>
            )}
            {aba === 'cashback' && botaoNovo('Cashback em um item', abrirNovoCashback, 'novo-cashback')}
          </div>
        </div>

        {/* ── Campanhas ───────────────────────────────────────────────────── */}
        {aba === 'campanhas' && (
          <section className="rounded-[6px] border border-[#E5E7EB] bg-white" data-testid="lista-campanhas">
            <CabecalhoCartao icone={<IcoMeta className="h-4 w-4" />} titulo="Campanhas de fidelidade" contador={campanhas.length} descricao="o cliente acumula a cada pedido entregue e ganha o prêmio ao bater a meta" />
            {loading ? <Vazio texto="Carregando…" /> : campanhas.length === 0 ? (
              <Vazio texto="Nenhuma campanha ainda." acao={<button type="button" onClick={abrirNovaCampanha} className={BOTAO_CONTORNO}>Criar a primeira</button>} />
            ) : (
              <ul className="divide-y divide-[#E5E7EB]">
                {campanhas.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] px-[16px] py-[12px]" data-testid="campanha-linha">
                    {c.premioTipo === 'item_gratis' ? <ItemThumb nome={c.premioItemNome ?? 'Item'} imagemUrl={c.premioItemImagemUrl ?? null} /> : <IconeLista><IcoPresente className="h-4 w-4" /></IconeLista>}
                    <div className="min-w-0 flex-1 basis-[200px]">
                      <div className="flex min-w-0 items-center gap-[8px]">
                        <p className="truncate text-[14px] font-semibold text-[#1F2937]">{c.nome}</p>
                        <Etiqueta tom={c.ativa ? 'verde' : 'cinza'} ponto>{c.ativa ? 'Ativa' : 'Pausada'}</Etiqueta>
                      </div>
                      <p className="mt-[2px] truncate text-[12.5px] text-[#4B5563]">{metaLegivel(c)} → <span className="font-medium text-[#1F2937]">{premioLegivel(c)}</span></p>
                      <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
                        <Etiqueta tom="azul">{c.clientesProgredindo} progredindo</Etiqueta>
                        {c.recompensasGanhas > 0 && <Etiqueta tom="roxo">{c.recompensasGanhas} ganhos · {c.recompensasResgatadas} resgatados</Etiqueta>}
                        {c.diasSemanaResgate.length > 0 && c.diasSemanaResgate.length < 7 && <Etiqueta tom="laranja">Resgate só {diasSemanaTexto(c.diasSemanaResgate)}</Etiqueta>}
                        {!c.repetivel && <Etiqueta tom="cinza">Uma vez por cliente</Etiqueta>}
                      </div>
                    </div>
                    <div className="flex items-center gap-[8px] max-lg:w-full">
                      <ToggleSwitch checked={c.ativa} onChange={() => toggleCampanhaAtiva(c)} rotulo={`Ativar a campanha ${c.nome}`} />
                      <button type="button" onClick={() => abrirEditarCampanha(c)} className={BOTAO_ICONE} aria-label={`Editar ${c.nome}`} title="Editar"><IcoEditar className="h-4 w-4" /><span className="lg:hidden">Editar</span></button>
                      <button type="button" onClick={() => excluirCampanha(c.id)} className={`${BOTAO_ICONE} hover:text-[#B91C1C]`} aria-label={`Excluir ${c.nome}`} title="Excluir"><IcoExcluir className="h-4 w-4" /><span className="lg:hidden">Excluir</span></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ── Cupons ──────────────────────────────────────────────────────── */}
        {aba === 'cupons' && (
          <section className="rounded-[6px] border border-[#E5E7EB] bg-white" data-testid="lista-cupons">
            <CabecalhoCartao icone={<IcoCupom className="h-4 w-4" />} titulo="Cupons" contador={cupons.length} descricao="códigos que o cliente aplica no checkout do cardápio" />
            {loading ? <Vazio texto="Carregando…" /> : cupons.length === 0 ? (
              <Vazio texto="Nenhum cupom ainda." acao={<button type="button" onClick={abrirNovoCupom} className={BOTAO_CONTORNO}>Criar o primeiro</button>} />
            ) : (
              <ul className="divide-y divide-[#E5E7EB]">
                {cupons.map((c) => {
                  const esgotado = c.maxUsos != null && c.usos >= c.maxUsos
                  return (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] px-[16px] py-[12px]" data-testid="cupom-linha">
                      {c.tipo === 'item_gratis' ? <ItemThumb nome={c.itemNome ?? 'Item'} imagemUrl={c.itemImagemUrl ?? null} /> : <IconeLista><IcoCupom className="h-4 w-4" /></IconeLista>}
                      <div className="min-w-0 flex-1 basis-[200px]">
                        <div className="flex min-w-0 flex-wrap items-center gap-[8px]">
                          <span className="rounded-[4px] border border-[#E5E7EB] bg-[#F9FAFB] px-[6px] py-[1px] font-mono text-[13px] font-semibold tracking-wide text-[#1F2937]">{c.codigo}</span>
                          <Etiqueta tom={!c.ativo ? 'cinza' : esgotado ? 'vermelho' : 'verde'} ponto>{!c.ativo ? 'Pausado' : esgotado ? 'Esgotado' : 'Ativo'}</Etiqueta>
                        </div>
                        <p className="mt-[2px] truncate text-[12.5px] text-[#4B5563]">
                          <span className="font-medium text-[#1F2937]">{cupomTipoLegivel(c)}</span>
                          {c.valorMinimoPedido != null && ` · pedido mínimo ${brl(c.valorMinimoPedido)}`}
                          {c.descricao && ` · ${c.descricao}`}
                        </p>
                        <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
                          <Etiqueta tom="azul">{publicoLegivel(c)}</Etiqueta>
                          <Etiqueta tom="cinza">{c.usos}{c.maxUsos != null ? ` de ${c.maxUsos}` : ''} {c.usos === 1 && c.maxUsos == null ? 'uso' : 'usos'}{c.usoUnicoPorCliente ? ' · 1 por cliente' : ''}</Etiqueta>
                          {c.diasSemana.length > 0 && c.diasSemana.length < 7 && <Etiqueta tom="laranja">{[...c.diasSemana].sort().map((d) => DIA_CURTO[d]).join(', ')}</Etiqueta>}
                          {(c.validadeInicio || c.validadeFim) && <Etiqueta tom="cinza">{c.validadeInicio ? formatarData(c.validadeInicio) : '…'} – {c.validadeFim ? formatarData(c.validadeFim) : '…'}</Etiqueta>}
                        </div>
                      </div>
                      <div className="flex items-center gap-[8px] max-lg:w-full">
                        <ToggleSwitch checked={c.ativo} onChange={() => toggleCupomAtivo(c)} rotulo={`Ativar o cupom ${c.codigo}`} />
                        <button type="button" onClick={() => abrirEditarCupom(c)} className={BOTAO_ICONE} aria-label={`Editar ${c.codigo}`} title="Editar"><IcoEditar className="h-4 w-4" /><span className="lg:hidden">Editar</span></button>
                        <button type="button" onClick={() => excluirCupom(c.id)} className={`${BOTAO_ICONE} hover:text-[#B91C1C]`} aria-label={`Excluir ${c.codigo}`} title="Excluir"><IcoExcluir className="h-4 w-4" /><span className="lg:hidden">Excluir</span></button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {/* ── Cashback (Etapa 7) ──────────────────────────────────────────── */}
        {aba === 'cashback' && (
          <section className="rounded-[6px] border border-[#E5E7EB] bg-white" data-testid="lista-cashback">
            <CabecalhoCartao icone={<IcoCashback className="h-4 w-4" />} titulo="Cashback por item" contador={regras.length} descricao="o cliente ganha crédito ao receber o item e usa sozinho no próximo pedido, no cardápio ou pelo WhatsApp" />
            {loading ? <Vazio texto="Carregando…" /> : regras.length === 0 ? (
              <Vazio texto="Nenhum item com cashback ainda." acao={<button type="button" onClick={abrirNovoCashback} className={BOTAO_CONTORNO}>Escolher um item</button>} />
            ) : (
              <ul className="divide-y divide-[#E5E7EB]">
                {regras.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] px-[16px] py-[12px]" data-testid="cashback-linha">
                    <ItemThumb nome={r.itemNome} imagemUrl={r.itemImagemUrl} />
                    <div className="min-w-0 flex-1 basis-[200px]">
                      <div className="flex min-w-0 items-center gap-[8px]">
                        <p className="truncate text-[14px] font-semibold text-[#1F2937]">{r.itemNome}</p>
                        <Etiqueta tom={r.ativo ? 'verde' : 'cinza'} ponto>{r.ativo ? 'Ativo' : 'Pausado'}</Etiqueta>
                      </div>
                      <p className="mt-[2px] truncate text-[12.5px] text-[#4B5563]">
                        <span className="font-medium text-[#1F2937]">{cashbackLegivel(r)}</span> · vale {r.validadeDias} {r.validadeDias === 1 ? 'dia' : 'dias'} depois da entrega
                      </p>
                      <div className="mt-[6px] flex flex-wrap items-center gap-[6px]">
                        {r.creditosAbertos > 0
                          ? <Etiqueta tom="laranja">{brl(r.valorAberto)} em {r.creditosAbertos} {r.creditosAbertos === 1 ? 'crédito aberto' : 'créditos abertos'}</Etiqueta>
                          : <Etiqueta tom="cinza">Nenhum crédito aberto</Etiqueta>}
                        <Etiqueta tom="cinza">Preço hoje {brl(r.itemPreco)}</Etiqueta>
                      </div>
                    </div>
                    <div className="flex items-center gap-[8px] max-lg:w-full">
                      <ToggleSwitch checked={r.ativo} onChange={() => toggleCashbackAtivo(r)} rotulo={`Ativar o cashback de ${r.itemNome}`} />
                      <button type="button" onClick={() => abrirEditarCashback(r)} className={BOTAO_ICONE} aria-label={`Editar cashback de ${r.itemNome}`} title="Editar"><IcoEditar className="h-4 w-4" /><span className="lg:hidden">Editar</span></button>
                      <button type="button" onClick={() => excluirCashback(r)} className={`${BOTAO_ICONE} hover:text-[#B91C1C]`} aria-label={`Excluir cashback de ${r.itemNome}`} title="Excluir"><IcoExcluir className="h-4 w-4" /><span className="lg:hidden">Excluir</span></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-[#E5E7EB] px-[16px] py-[10px] text-[12px] text-[#5B6472]">
              Como funciona: o crédito nasce quando o pedido é <b className="font-semibold text-[#1F2937]">entregue</b>, o cliente recebe no WhatsApp quanto ganhou e até quando vale, e o valor é descontado sozinho no próximo pedido (só do subtotal, nunca do frete). Pedido cancelado devolve o crédito. O robô mostra tudo em <b className="font-semibold text-[#1F2937]">4 · Ver meu progresso</b>.
            </div>
          </section>
        )}
      </div>

      {/* ── Gaveta: Campanha ─────────────────────────────────────────────── */}
      <Gaveta
        aberta={drawerCampanha} titulo={editandoCampanhaId ? 'Editar campanha de fidelidade' : 'Nova campanha de fidelidade'} onFechar={() => setDrawerCampanha(false)} testid="gaveta-campanha"
        rodape={<>
          <button type="button" onClick={() => setDrawerCampanha(false)} className={BOTAO_CONTORNO}>Cancelar</button>
          <button type="button" disabled={saving} onClick={salvarCampanha} className={classeBotao('azul', 'normal')} data-testid="salvar-campanha">{saving ? 'Salvando…' : editandoCampanhaId ? 'Salvar alterações' : 'Criar campanha'}</button>
        </>}
      >
        <Field label="Nome da campanha"><input value={formCampanha.nome} onChange={(e) => setFormCampanha((f) => ({ ...f, nome: e.target.value }))} placeholder="Ex: Clube do burger" className={CAMPO} /></Field>
        <Field label="Descrição" hint="Aparece para o cliente na aba Cupons do cardápio.">
          <textarea rows={2} value={formCampanha.descricao} onChange={(e) => setFormCampanha((f) => ({ ...f, descricao: e.target.value }))} placeholder="Ex: A cada R$ 200 em pedidos, ganhe um lanche grátis!" className={`${CAMPO_AREA} resize-none`} />
        </Field>
        <Field label="Tipo de meta">
          <select value={formCampanha.tipoMeta} onChange={(e) => setFormCampanha((f) => ({ ...f, tipoMeta: e.target.value as CampanhaForm['tipoMeta'] }))} className={CAMPO}>
            {(Object.keys(TIPO_META_LABEL) as CampanhaForm['tipoMeta'][]).map((t) => <option key={t} value={t}>{TIPO_META_LABEL[t]}</option>)}
          </select>
        </Field>
        {formCampanha.tipoMeta === 'valor_gasto' ? (
          <Field label="Meta (R$)" hint="Quanto o cliente precisa gastar (soma dos pedidos entregues) para ganhar o prêmio.">
            <input type="number" min={0} step={10} value={formCampanha.metaValor} onChange={(e) => setFormCampanha((f) => ({ ...f, metaValor: e.target.value }))} placeholder="Ex: 200" className={CAMPO} />
          </Field>
        ) : (
          <Field label={formCampanha.tipoMeta === 'qtd_pedidos' ? 'Meta (pedidos)' : 'Meta (itens)'} hint={formCampanha.tipoMeta === 'qtd_pedidos' ? 'Quantos pedidos entregues para ganhar o prêmio.' : 'Quantos itens comprados para ganhar o prêmio.'}>
            <input type="number" min={1} step={1} value={formCampanha.metaQuantidade} onChange={(e) => setFormCampanha((f) => ({ ...f, metaQuantidade: e.target.value }))} placeholder="Ex: 10" className={CAMPO} />
          </Field>
        )}
        <Field label="Dias que contam" hint="Nenhum selecionado = pedidos de qualquer dia contam para a meta."><DiasChips dias={formCampanha.diasSemanaContam} onChange={(dias) => setFormCampanha((f) => ({ ...f, diasSemanaContam: dias }))} /></Field>
        <Field label="Dias de resgate" hint="Nenhum selecionado = o prêmio pode ser resgatado em qualquer dia."><DiasChips dias={formCampanha.diasSemanaResgate} onChange={(dias) => setFormCampanha((f) => ({ ...f, diasSemanaResgate: dias }))} /></Field>
        <Field label="Prêmio">
          <select value={formCampanha.premioTipo} onChange={(e) => setFormCampanha((f) => ({ ...f, premioTipo: e.target.value as CampanhaForm['premioTipo'] }))} className={CAMPO}>
            {(Object.keys(PREMIO_TIPO_LABEL) as CampanhaForm['premioTipo'][]).map((t) => <option key={t} value={t}>{PREMIO_TIPO_LABEL[t]}</option>)}
          </select>
        </Field>
        {formCampanha.premioTipo === 'item_gratis' && <Field label="Item do prêmio"><ItemSelector itens={itens} value={formCampanha.premioItemId} onChange={(id) => setFormCampanha((f) => ({ ...f, premioItemId: id }))} /></Field>}
        {premioTemValor && (
          <Field label={formCampanha.premioTipo === 'desconto_percentual' ? 'Desconto (%)' : 'Desconto (R$)'}>
            <input type="number" min={0} max={formCampanha.premioTipo === 'desconto_percentual' ? 100 : undefined} step={formCampanha.premioTipo === 'desconto_percentual' ? 1 : 0.5} value={formCampanha.premioValor} onChange={(e) => setFormCampanha((f) => ({ ...f, premioValor: e.target.value }))} placeholder={formCampanha.premioTipo === 'desconto_percentual' ? 'Ex: 10' : 'Ex: 15'} className={CAMPO} />
          </Field>
        )}
        <div className="space-y-[12px] border-t border-[#E5E7EB] pt-[16px]">
          <ToggleRow label="Repetível" hint="Ao completar a meta, o progresso zera e o cliente pode ganhar de novo." checked={formCampanha.repetivel} onChange={(v) => setFormCampanha((f) => ({ ...f, repetivel: v }))} />
          <ToggleRow label="Campanha ativa" hint="Só campanhas ativas acumulam progresso e aparecem para o cliente." checked={formCampanha.ativa} onChange={(v) => setFormCampanha((f) => ({ ...f, ativa: v }))} />
        </div>
        <Erro texto={erro} />
      </Gaveta>

      {/* ── Gaveta: Cupom ────────────────────────────────────────────────── */}
      <Gaveta
        aberta={drawerCupom} titulo={editandoCupomId ? 'Editar cupom' : 'Novo cupom'} onFechar={() => setDrawerCupom(false)} testid="gaveta-cupom"
        rodape={<>
          <button type="button" onClick={() => setDrawerCupom(false)} className={BOTAO_CONTORNO}>Cancelar</button>
          <button type="button" disabled={saving} onClick={salvarCupom} className={classeBotao('azul', 'normal')} data-testid="salvar-cupom">{saving ? 'Salvando…' : editandoCupomId ? 'Salvar alterações' : 'Criar cupom'}</button>
        </>}
      >
        <Field label="Código do cupom" hint="É o que o cliente digita no checkout. Sem espaços.">
          <input value={formCupom.codigo} onChange={(e) => setFormCupom((f) => ({ ...f, codigo: e.target.value.toUpperCase().replace(/\s+/g, '') }))} placeholder="Ex: VOLTA10" className={`${CAMPO} font-mono font-semibold uppercase tracking-wide`} />
        </Field>
        <Field label="Descrição" hint="Aparece para o cliente junto do cupom.">
          <textarea rows={2} value={formCupom.descricao} onChange={(e) => setFormCupom((f) => ({ ...f, descricao: e.target.value }))} placeholder="Ex: 10% de desconto para você voltar a pedir!" className={`${CAMPO_AREA} resize-none`} />
        </Field>
        <Field label="Tipo de desconto">
          <select value={formCupom.tipo} onChange={(e) => setFormCupom((f) => ({ ...f, tipo: e.target.value as CupomForm['tipo'] }))} className={CAMPO}>
            {(Object.keys(CUPOM_TIPO_LABEL) as CupomForm['tipo'][]).map((t) => <option key={t} value={t}>{CUPOM_TIPO_LABEL[t]}</option>)}
          </select>
        </Field>
        {cupomTemValor && (
          <Field label={formCupom.tipo === 'desconto_percentual' ? 'Desconto (%)' : 'Desconto (R$)'}>
            <input type="number" min={0} max={formCupom.tipo === 'desconto_percentual' ? 100 : undefined} step={formCupom.tipo === 'desconto_percentual' ? 1 : 0.5} value={formCupom.valor} onChange={(e) => setFormCupom((f) => ({ ...f, valor: e.target.value }))} placeholder={formCupom.tipo === 'desconto_percentual' ? 'Ex: 10' : 'Ex: 15'} className={CAMPO} />
          </Field>
        )}
        {formCupom.tipo === 'item_gratis' && <Field label="Item grátis"><ItemSelector itens={itens} value={formCupom.itemId} onChange={(id) => setFormCupom((f) => ({ ...f, itemId: id }))} /></Field>}
        <Field label="Público" hint={PUBLICO_AJUDA[formCupom.publico]}>
          <select value={formCupom.publico} onChange={(e) => setFormCupom((f) => ({ ...f, publico: e.target.value as CupomForm['publico'] }))} className={CAMPO}>
            {(Object.keys(PUBLICO_LABEL) as CupomForm['publico'][]).map((p) => <option key={p} value={p}>{PUBLICO_LABEL[p]}</option>)}
          </select>
        </Field>
        {formCupom.publico === 'recompra' && (
          <Field label="Sem pedir há quantos dias?" hint="Também vale para quem fez no máximo 1 pedido.">
            <input type="number" min={1} step={1} value={formCupom.diasInatividade} onChange={(e) => setFormCupom((f) => ({ ...f, diasInatividade: e.target.value }))} placeholder="Ex: 30" className={CAMPO} />
          </Field>
        )}
        <Field label="Dias da semana" hint="Nenhum selecionado = vale todos os dias."><DiasChips dias={formCupom.diasSemana} onChange={(dias) => setFormCupom((f) => ({ ...f, diasSemana: dias }))} /></Field>
        <div className="grid grid-cols-2 gap-[12px]">
          <Field label="Válido a partir de"><input type="date" value={formCupom.validadeInicio} onChange={(e) => setFormCupom((f) => ({ ...f, validadeInicio: e.target.value }))} className={CAMPO} /></Field>
          <Field label="Válido até"><input type="date" value={formCupom.validadeFim} onChange={(e) => setFormCupom((f) => ({ ...f, validadeFim: e.target.value }))} className={CAMPO} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-[12px]">
          <Field label="Pedido mínimo (R$)" hint="Vazio = sem mínimo.">
            <input type="number" min={0} step={5} value={formCupom.valorMinimoPedido} onChange={(e) => setFormCupom((f) => ({ ...f, valorMinimoPedido: e.target.value }))} placeholder="Ex: 40" className={CAMPO} />
          </Field>
          {/* "Máximo de usos" era lido como "por cliente"; o texto diz de quem é o limite. */}
          <Field label="Limite total de usos" hint="Somando TODOS os clientes. Vazio = sem limite. Para limitar por pessoa, use a chave abaixo.">
            <input type="number" min={1} step={1} value={formCupom.maxUsos} onChange={(e) => setFormCupom((f) => ({ ...f, maxUsos: e.target.value }))} placeholder="Ex: 100" className={CAMPO} />
            {formCupom.maxUsos !== '' && Number(formCupom.maxUsos) > 0 && (
              <p className="mt-[4px] text-[11.5px] font-semibold text-[#B45309]">
                {formCupom.publico === 'todos'
                  ? `Atenção: o cupom sai do ar depois de ${formCupom.maxUsos} ${Number(formCupom.maxUsos) === 1 ? 'uso no total' : 'usos no total'} — não por cliente.`
                  : `Atenção: ${Number(formCupom.maxUsos) === 1 ? 'só o primeiro cliente vai conseguir usar; do 2º' : `só os ${formCupom.maxUsos} primeiros clientes vão conseguir usar; do ${Number(formCupom.maxUsos) + 1}º`} em diante o cupom aparece como esgotado. Para valer para todos, deixe este campo vazio — "Uso único por cliente" já garante um por pessoa.`}
              </p>
            )}
          </Field>
        </div>
        <div className="space-y-[12px] border-t border-[#E5E7EB] pt-[16px]">
          <ToggleRow label="Uso único por cliente" hint="Cada cliente só pode usar este cupom uma vez." checked={formCupom.usoUnicoPorCliente} onChange={(v) => setFormCupom((f) => ({ ...f, usoUnicoPorCliente: v }))} />
          <ToggleRow label="Cupom ativo" hint="Só cupons ativos podem ser aplicados no checkout." checked={formCupom.ativo} onChange={(v) => setFormCupom((f) => ({ ...f, ativo: v }))} />
        </div>
        <Erro texto={erro} />
      </Gaveta>

      {/* ── Gaveta: Cashback (Etapa 7) ───────────────────────────────────── */}
      <Gaveta
        aberta={drawerCashback} titulo={editandoCashbackId ? 'Editar cashback do item' : 'Cashback em um item'} onFechar={() => setDrawerCashback(false)} testid="gaveta-cashback"
        rodape={<>
          <button type="button" onClick={() => setDrawerCashback(false)} className={BOTAO_CONTORNO}>Cancelar</button>
          <button type="button" disabled={saving || !formCashback.itemId} onClick={salvarCashback} className={classeBotao('azul', 'normal')} data-testid="salvar-cashback">{saving ? 'Salvando…' : editandoCashbackId ? 'Salvar alterações' : 'Ativar cashback'}</button>
        </>}
      >
        <Field label="1. Item do cardápio" hint={editandoCashbackId ? 'O item não muda: para outro item, crie outro cashback.' : 'Quem receber este item ganha o crédito.'}>
          <ItemSelector itens={itens} value={formCashback.itemId} onChange={(id) => setFormCashback((f) => ({ ...f, itemId: id }))} travado={!!editandoCashbackId} />
        </Field>
        <Field label="2. Quanto de cashback">
          <div className="flex items-center gap-[8px]">
            <Segmentado valor={formCashback.tipo} opcoes={[{ id: 'valor', rotulo: 'R$ por unidade' }, { id: 'percentual', rotulo: '% do valor' }]} onMudar={(t) => setFormCashback((f) => ({ ...f, tipo: t }))} rotulo="Tipo de cashback" testidPrefixo="cashback-tipo-" />
            <input
              type="number" inputMode="decimal" min={0} max={formCashback.tipo === 'percentual' ? 100 : undefined} step={formCashback.tipo === 'percentual' ? 1 : 0.5}
              value={formCashback.valor} onChange={(e) => setFormCashback((f) => ({ ...f, valor: e.target.value }))} placeholder={formCashback.tipo === 'percentual' ? 'Ex: 10' : 'Ex: 2,00'} className={`${CAMPO} w-[120px]`} data-testid="cashback-valor"
            />
          </div>
        </Field>
        <Field label="3. Validade (dias depois da entrega)" hint="De 1 a 365. Depois disso o crédito some sozinho.">
          <div className="flex items-center gap-[8px]">
            <Segmentado valor={['7', '15', '30', '60'].includes(formCashback.validadeDias) ? formCashback.validadeDias : null} opcoes={[{ id: '7', rotulo: '7' }, { id: '15', rotulo: '15' }, { id: '30', rotulo: '30' }, { id: '60', rotulo: '60' }]} onMudar={(d) => setFormCashback((f) => ({ ...f, validadeDias: d }))} rotulo="Validade" />
            <input type="number" min={1} max={365} step={1} value={formCashback.validadeDias} onChange={(e) => setFormCashback((f) => ({ ...f, validadeDias: e.target.value }))} className={`${CAMPO} w-[90px]`} data-testid="cashback-validade" />
          </div>
        </Field>
        {previaCashback && (
          <p className="rounded-[4px] border border-[#BBF7D0] bg-[#DCFCE7] px-[12px] py-[8px] text-[13px] text-[#15803D]" data-testid="cashback-previa">{previaCashback}</p>
        )}
        <div className="border-t border-[#E5E7EB] pt-[16px]">
          <ToggleRow label="Cashback ativo" hint="Pausado, novos pedidos não geram crédito; o que já foi ganho continua valendo até expirar." checked={formCashback.ativo} onChange={(v) => setFormCashback((f) => ({ ...f, ativo: v }))} />
        </div>
        <Erro texto={erro} />
      </Gaveta>
    </div>
  )
}
