'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { resumoCurto } from '@/lib/pedido-edicao-regras'
import {
  Bell, CalendarDays, Check, ChefHat, ChevronDown, Clock3, LayoutGrid, LogOut, Maximize2, Menu, Minimize2, Moon, Search, Settings2, Sun,
  Timer, Type, Undo2, Utensils, X,
} from 'lucide-react'
import { corDoTempo, minutosDesde, totalDeItens, type LimitesTempo } from '@/lib/kds'
import type { Pedido, PedidoItem } from '@/lib/queries/pedidos'

/**
 * KDS único (12/10): só desenha. Quem busca os pedidos e move o status é a página (/admin/kds) — e, nos prints, o modo
 * demonstração. Visual (28/10) copiado da imagem-modelo do dono: barra de ferramentas branca (menu, marca, busca, setor,
 * relógio, sino, perfil), faixa azul-marinho com abas e etapas numeradas, cartões com cabeçalho colorido pela etapa
 * (vermelho = na fila, laranja = em preparo, verde = pronto), botões contornados e o painel "Status dos itens".
 * Começar preparo abre o pedido em destaque com modo de preparo e ingredientes. Tela cheia para TV/tablet.
 */
export interface PreferenciasKds { escuro: boolean; grande: boolean; limites: LimitesTempo }
export interface FichaKds { modoPreparo: string | null; ingredientes: { nome: string; quantidade: string }[]; passos: string[]; tempoMin: number | null }

type Etapa = 'fila' | 'preparo' | 'prontos'
type Tipo = 'todos' | 'entrega' | 'retirada' | 'salao'

// Cores da imagem-modelo, um tom mais fundo para o texto branco em negrito ler de longe.
const NAVY = '#34405A'
const ETAPA: Record<Etapa, { cor: string; rotulo: string }> = {
  fila: { cor: '#D94848', rotulo: 'Na fila' },
  preparo: { cor: '#DE8A12', rotulo: 'Em preparo' },
  prontos: { cor: '#1E9E5E', rotulo: 'Pronto' },
}
const ABAS_ITENS: { chave: Etapa; rotulo: string }[] = [{ chave: 'fila', rotulo: 'Na fila' }, { chave: 'preparo', rotulo: 'Em preparo' }, { chave: 'prontos', rotulo: 'Prontos' }]
const TIPOS: { chave: Tipo; rotulo: string }[] = [{ chave: 'todos', rotulo: 'Todos' }, { chave: 'entrega', rotulo: 'Entrega' }, { chave: 'retirada', rotulo: 'Retirada' }, { chave: 'salao', rotulo: 'Salão' }]

const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short' })

function rotuloTipo(p: Pedido): string {
  if (p.canal === 'mesa') return p.mesa ? `Mesa ${p.mesa}` : 'Mesa'
  if (p.canal === 'balcao') return p.comandaSenha ? `Balcão · senha ${p.comandaSenha}` : 'Balcão'
  return p.tipo === 'retirada' ? 'Retirada' : 'Entrega'
}

function tipoDo(p: Pedido): Exclude<Tipo, 'todos'> {
  if (p.canal === 'mesa' || p.canal === 'balcao') return 'salao'
  return p.tipo === 'retirada' ? 'retirada' : 'entrega'
}

function cronometro(min: number): string {
  const s = Math.max(0, Math.floor(min * 60))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export interface ColunasKds { fila: Pedido[]; preparo: Pedido[]; prontos: Pedido[]; aguardandoAceite: number }

export function QuadroKds({
  colunas, agora, prefs, setores, setor, riscados, fichas, destaque, carregando, demo, ocupado,
  onSetor, onRiscar, onComecar, onAbrir, onFecharDestaque, onPronto, onVoltar, onPrefs, onSair, onLogout,
}: {
  colunas: ColunasKds; agora: number; prefs: PreferenciasKds; setores: string[]; setor: string | null; riscados: Record<string, string[]>
  fichas: Record<string, FichaKds>; destaque: Pedido | null; carregando?: boolean; demo?: boolean; ocupado?: string | null
  onSetor: (s: string | null) => void; onRiscar: (pedidoId: string, itemId: string) => void
  onComecar: (p: Pedido) => void; onAbrir: (p: Pedido) => void; onFecharDestaque: () => void
  onPronto: (p: Pedido) => void; onVoltar: (p: Pedido) => void
  onPrefs: (p: PreferenciasKds) => void; onSair: () => void; onLogout: () => void
}) {
  const [config, setConfig] = useState(false)
  const [cheia, setCheia] = useState(false)
  const [menu, setMenu] = useState(false)
  const [abaItens, setAbaItens] = useState<Etapa>('fila')
  const [tipo, setTipo] = useState<Tipo>('todos')
  const [etapa, setEtapa] = useState<Etapa | null>(null)
  const [busca, setBusca] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const mudou = () => setCheia(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', mudou)
    return () => document.removeEventListener('fullscreenchange', mudou)
  }, [])
  useEffect(() => {
    if (!menu) return
    const fora = (ev: MouseEvent) => { if (!menuRef.current?.contains(ev.target as Node)) setMenu(false) }
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [menu])
  const telaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }
  const e = prefs.escuro
  const termo = busca.trim().toLowerCase()
  const filtrar = (lista: Pedido[]) => lista.filter((p) =>
    (tipo === 'todos' || tipoDo(p) === tipo)
    && (!termo || String(p.numero).includes(termo) || p.itens.some((i) => i.nome.toLowerCase().includes(termo))))
  const vis: Record<Etapa, Pedido[]> = { fila: filtrar(colunas.fila), preparo: filtrar(colunas.preparo), prontos: filtrar(colunas.prontos) }
  const ativos = [...colunas.fila, ...colunas.preparo]
  const atrasados = ativos.filter((p) => corDoTempo(minutosDesde(p.criadoEm, agora), prefs.limites) === 'vermelho').length
  const mostrar = (x: Etapa) => !etapa || etapa === x
  const totalVisivel = (mostrar('fila') ? vis.fila.length : 0) + (mostrar('preparo') ? vis.preparo.length : 0) + (mostrar('prontos') ? vis.prontos.length : 0)
  const itens = totalDeItens(vis[abaItens])
  const passos: { chave: Etapa | null; rotulo: string; qtd: number }[] = [
    { chave: null, rotulo: 'Aguardando aceite', qtd: colunas.aguardandoAceite },
    { chave: 'fila', rotulo: 'Na fila', qtd: vis.fila.length },
    { chave: 'preparo', rotulo: 'Em preparo', qtd: vis.preparo.length },
    { chave: 'prontos', rotulo: 'Prontos', qtd: vis.prontos.length },
  ]

  return (
    <div className="fixed inset-0 z-[80] flex flex-col font-sans text-[#1F2937]" style={{ fontSize: prefs.grande ? 18 : 15, backgroundColor: e ? NAVY : '#E9ECF2' }} data-testid="kds">
      {/* ── Barra de ferramentas (branca, como na imagem) ── */}
      <header className="relative z-[2] flex h-[60px] flex-shrink-0 items-center gap-2 bg-white px-3 shadow-[0_1px_4px_rgba(16,24,40,0.18)] sm:gap-3 sm:px-4">
        <button type="button" onClick={onSair} aria-label="Voltar ao painel" title="Voltar ao painel"
          className="grid h-[44px] w-[44px] flex-shrink-0 place-items-center rounded-[4px] text-[#374151] hover:bg-[#F3F4F6]">
          <Menu className="h-6 w-6" aria-hidden />
        </button>
        <p className="flex flex-shrink-0 items-center gap-2">
          <span className="grid h-[36px] w-[36px] place-items-center rounded-full bg-[#2563EB] text-white"><ChefHat className="h-5 w-5" aria-hidden /></span>
          <span className="leading-none">
            <span className="block text-[11px] font-medium text-[#6B7280]">Menuzia</span>
            <span className="block text-[18px] font-semibold tracking-tight text-[#1E3A8A]">KDS Cozinha</span>
          </span>
        </p>
        {demo && <span className="hidden rounded-[4px] bg-[#FEF3C7] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#92400E] sm:inline">Demonstração</span>}

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <label className="relative hidden md:block">
            <span className="sr-only">Buscar pedido ou item</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden />
            <input type="search" value={busca} onChange={(ev) => setBusca(ev.target.value)} placeholder="Buscar pedido ou item" data-testid="kds-busca"
              className="h-[40px] w-[220px] rounded-full border border-[#D1D5DB] bg-[#F9FAFB] pl-9 pr-3 text-[14px] outline-none focus:border-[#2563EB] focus:bg-white lg:w-[260px]" />
          </label>
          {setores.length > 1 && (
            <label className="relative hidden items-center lg:flex">
              <span className="sr-only">Setor</span>
              <LayoutGrid className="pointer-events-none absolute left-2.5 h-4 w-4 text-[#2563EB]" aria-hidden />
              <select value={setor ?? ''} onChange={(ev) => onSetor(ev.target.value || null)} data-testid="kds-setor"
                className="h-[40px] cursor-pointer appearance-none rounded-[4px] bg-transparent pl-8 pr-7 text-[14px] font-medium text-[#374151] hover:bg-[#F3F4F6]">
                <option value="">Todos os setores</option>
                {setores.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-[#6B7280]" aria-hidden />
            </label>
          )}
          <span className="hidden items-center gap-1.5 text-[14px] font-medium tabular-nums text-[#374151] sm:flex" data-testid="kds-relogio">
            <Clock3 className="h-4 w-4 text-[#2563EB]" aria-hidden />{hora.format(new Date(agora))}
          </span>
          <button type="button" onClick={onSair} data-testid="kds-sino"
            aria-label={colunas.aguardandoAceite > 0 ? `${colunas.aguardandoAceite} pedido(s) esperando aceite no Painel` : 'Nenhum pedido esperando aceite'}
            title={colunas.aguardandoAceite > 0 ? `${colunas.aguardandoAceite} esperando aceite no Painel` : 'Nenhum pedido esperando aceite'}
            className="relative grid h-[44px] w-[44px] flex-shrink-0 place-items-center rounded-[4px] text-[#374151] hover:bg-[#F3F4F6]">
            <Bell className="h-5 w-5" aria-hidden />
            {colunas.aguardandoAceite > 0 && <span className="absolute right-1.5 top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#DC2626] px-1 text-[11px] font-semibold text-white">{colunas.aguardandoAceite}</span>}
          </button>
          <div className="relative" ref={menuRef}>
            <button type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} data-testid="kds-perfil"
              className="flex h-[44px] items-center gap-2 rounded-[4px] pl-1 pr-2 hover:bg-[#F3F4F6]">
              <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[#1E3A8A] text-[13px] font-semibold text-white">K</span>
              <span className="hidden text-[14px] font-semibold sm:inline">KDS</span>
              <ChevronDown className="h-4 w-4 text-[#6B7280]" aria-hidden />
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 top-[50px] w-[240px] overflow-hidden rounded-[6px] border border-[#E5E7EB] bg-white py-1 shadow-[0_8px_24px_rgba(16,24,40,0.18)]">
                <ItemMenu icone={e ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} onClick={() => onPrefs({ ...prefs, escuro: !e })}>{e ? 'Fundo claro' : 'Fundo escuro'}</ItemMenu>
                <ItemMenu icone={<Type className="h-4 w-4" />} onClick={() => onPrefs({ ...prefs, grande: !prefs.grande })}>{prefs.grande ? 'Letra normal' : 'Letra grande'}</ItemMenu>
                <ItemMenu icone={<Settings2 className="h-4 w-4" />} onClick={() => { setConfig((v) => !v); setMenu(false) }}>Tempos do cronômetro</ItemMenu>
                <ItemMenu icone={cheia ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} onClick={() => { telaCheia(); setMenu(false) }}>{cheia ? 'Sair da tela cheia' : 'Tela cheia'}</ItemMenu>
                <ItemMenu icone={<X className="h-4 w-4" />} onClick={onSair}>Voltar ao painel</ItemMenu>
                <div className="my-1 border-t border-[#E5E7EB]" />
                <ItemMenu icone={<LogOut className="h-4 w-4" />} onClick={onLogout} perigo testid="kds-sair-conta">Sair da conta</ItemMenu>
              </div>
            )}
          </div>
        </div>
      </header>

      {config && (
        <div className="flex flex-wrap items-center gap-4 border-b border-[#E5E7EB] bg-white px-4 py-2.5 text-[0.85em]" data-testid="kds-config">
          <span className="font-semibold">Cores do tempo (minutos):</span>
          <label className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-[#F59E0B]" aria-hidden />Amarelo a partir de
            <input type="number" min={1} max={120} value={prefs.limites.amarelo} inputMode="numeric"
              onChange={(ev) => { const a = Number(ev.target.value); if (a >= 1 && a < prefs.limites.vermelho) onPrefs({ ...prefs, limites: { ...prefs.limites, amarelo: a } }) }}
              className="h-[36px] w-[64px] rounded-[4px] border border-[#CBD2D9] bg-white px-2" />
          </label>
          <label className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-[#EF4444]" aria-hidden />Vermelho depois de
            <input type="number" min={2} max={180} value={prefs.limites.vermelho} inputMode="numeric"
              onChange={(ev) => { const v = Number(ev.target.value); if (v > prefs.limites.amarelo && v <= 180) onPrefs({ ...prefs, limites: { ...prefs.limites, vermelho: v } }) }}
              className="h-[36px] w-[64px] rounded-[4px] border border-[#CBD2D9] bg-white px-2" />
          </label>
          <span className="text-[#6B7280]">Guardado neste aparelho.</span>
          <button type="button" onClick={() => setConfig(false)} className="ml-auto h-[36px] rounded-[4px] border border-[#D1D5DB] px-3 text-[12px] font-semibold uppercase">Fechar</button>
        </div>
      )}

      {/* ── Faixa: abas à esquerda, etapas numeradas no centro ── */}
      <div className="grid flex-shrink-0 grid-cols-1 items-center gap-3 px-3 pb-2 pt-3 sm:px-4 lg:grid-cols-[1fr_auto_1fr]">
        <nav className="flex flex-wrap gap-2" aria-label="Tipo de pedido">
          {TIPOS.map((x) => {
            const ativo = tipo === x.chave
            return (
              <button key={x.chave} type="button" onClick={() => setTipo(x.chave)} aria-pressed={ativo} data-testid={`kds-tipo-${x.chave}`}
                className={`h-[44px] rounded-full px-5 text-[14px] font-semibold transition-colors ${ativo ? 'bg-[#2563EB] text-white shadow-[0_2px_6px_rgba(37,99,235,0.45)]' : e ? 'bg-[#4A5671] text-white hover:bg-[#56637F]' : 'bg-white text-[#374151] hover:bg-[#F3F4F6]'}`}>
                {x.rotulo}
              </button>
            )
          })}
        </nav>
        <ol className="flex items-start justify-center" aria-label="Etapas" data-testid="kds-etapas">
          {passos.map((x, n) => {
            const ativo = !!x.chave && etapa === x.chave
            const bolinha = (
              <>
                {n > 0 && <span className={`absolute right-1/2 top-[19px] h-[2px] w-full ${e ? 'bg-white/60' : 'bg-[#9CA3AF]'}`} aria-hidden />}
                <span className={`relative z-[1] grid h-[40px] min-w-[40px] place-items-center rounded-full border-[3px] px-1 text-[16px] font-semibold tabular-nums text-white transition-colors ${ativo ? 'border-white bg-[#2563EB]' : 'border-white/80 bg-[#1E3A8A]'}`}>{x.qtd}</span>
                <span className={`mt-1 text-[12px] font-semibold leading-tight ${e ? 'text-white' : 'text-[#1F2937]'}`}>{x.rotulo}</span>
              </>
            )
            return (
              <li key={x.rotulo} className="relative flex w-[84px] flex-col items-center text-center sm:w-[112px]">
                {x.chave ? (
                  <button type="button" onClick={() => setEtapa(ativo ? null : x.chave)} aria-pressed={ativo} title={ativo ? 'Mostrar todas as etapas' : `Mostrar só ${x.rotulo}`}
                    className="relative flex w-full flex-col items-center">{bolinha}</button>
                ) : bolinha}
              </li>
            )
          })}
        </ol>
        <p className={`hidden text-right text-[13px] font-medium lg:block ${e ? 'text-white/85' : 'text-[#374151]'}`} data-testid="kds-contagem">
          {ativos.length} na cozinha{atrasados > 0 ? ` · ${atrasados} atrasado${atrasados > 1 ? 's' : ''}` : ''}
        </p>
      </div>

      <main className="flex min-h-0 flex-1 gap-3 px-3 pb-3 sm:px-4">
        <section className="min-h-0 flex-1 overflow-y-auto pr-1" aria-label="Pedidos" data-testid="kds-quadro">
          {totalVisivel === 0 ? (
            <div className={`mt-16 text-center ${e ? 'text-white/85' : 'text-[#6B7280]'}`}>
              <ChefHat className="mx-auto mb-2 h-10 w-10 opacity-70" aria-hidden />
              <p className="text-[1em] font-semibold">{carregando ? 'Carregando…' : termo || tipo !== 'todos' || etapa ? 'Nenhum pedido com esse filtro.' : 'Nada na cozinha agora.'}</p>
              {!carregando && !termo && tipo === 'todos' && !etapa && <p className="mt-1 text-[0.85em]">Pedidos aceitos no Painel aparecem aqui.</p>}
            </div>
          ) : (
            <div className="columns-1 gap-3 sm:columns-[250px]">
              {mostrar('fila') && vis.fila.map((p) => (
                <CardKds key={p.id} p={p} etapa="fila" agora={agora} prefs={prefs} fichas={fichas} ocupado={ocupado === p.id} onAcao={() => onComecar(p)} />
              ))}
              {mostrar('preparo') && vis.preparo.map((p) => (
                <CardKds key={p.id} p={p} etapa="preparo" agora={agora} prefs={prefs} riscados={riscados[p.id]} fichas={fichas} ocupado={ocupado === p.id}
                  onRiscar={onRiscar} onAcao={() => onPronto(p)} onAbrir={() => onAbrir(p)} />
              ))}
              {mostrar('prontos') && vis.prontos.map((p) => (
                <CardKds key={p.id} p={p} etapa="prontos" agora={agora} prefs={prefs} fichas={fichas} ocupado={ocupado === p.id} onAcao={() => onVoltar(p)} />
              ))}
            </div>
          )}
        </section>

        {/* ── Painel "Status dos itens" (lado direito da imagem) ── */}
        <aside className="hidden w-[310px] flex-shrink-0 flex-col overflow-hidden rounded-[6px] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.2)] md:flex" aria-label="Status dos itens" data-testid="kds-status-itens">
          <p className="px-4 pb-1 pt-4 text-[16px] font-semibold">Status dos itens</p>
          <div className="flex border-b border-[#E5E7EB] px-2" role="tablist">
            {ABAS_ITENS.map((x) => (
              <button key={x.chave} type="button" role="tab" aria-selected={abaItens === x.chave} onClick={() => setAbaItens(x.chave)}
                className={`-mb-px h-[44px] flex-1 border-b-[3px] px-2 text-[14px] font-semibold ${abaItens === x.chave ? 'border-[#2563EB] text-[#1F2937]' : 'border-transparent text-[#6B7280] hover:text-[#1F2937]'}`}>
                {x.rotulo}
              </button>
            ))}
          </div>
          <div className="flex justify-between bg-[#F3F4F6] px-4 py-2.5 text-[13px] font-semibold text-[#374151]"><span>Item</span><span>Quantidade</span></div>
          <ul className="min-h-0 flex-1 divide-y divide-[#EEF0F3] overflow-y-auto">
            {itens.length === 0 && <li className="px-4 py-8 text-center text-[14px] text-[#6B7280]">Nenhum item nesta etapa.</li>}
            {itens.map((x) => (
              <li key={`${x.nome}|${x.detalhe}`} className="flex items-center justify-between gap-3 px-4 py-3 text-[14px]">
                <span className="min-w-0">{x.nome}{x.detalhe && <span className="block text-[12px] text-[#6B7280]">{x.detalhe}</span>}</span>
                <span className="w-[40px] text-center font-semibold tabular-nums">{x.quantidade}</span>
              </li>
            ))}
          </ul>
        </aside>
      </main>

      {destaque && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3" onMouseDown={onFecharDestaque} data-testid="kds-destaque">
          <div role="dialog" aria-modal="true" aria-label={`Pedido ${destaque.numero}`} onMouseDown={(ev) => ev.stopPropagation()}
            className="flex max-h-full w-full max-w-[720px] flex-col overflow-hidden rounded-[6px] bg-white text-[#1F2937]">
            <div className="flex items-center justify-between gap-2 px-4 py-3 text-white" style={{ backgroundColor: ETAPA.preparo.cor }}>
              <p className="text-[1.4em] font-semibold">Pedido Nº {destaque.numero} <span className="text-[0.6em] font-medium opacity-95">{rotuloTipo(destaque)} · {hora.format(new Date(destaque.criadoEm))}</span></p>
              <button type="button" onClick={onFecharDestaque} aria-label="Fechar" className="grid h-[44px] w-[44px] place-items-center rounded-[4px] hover:bg-white/15"><X className="h-6 w-6" /></button>
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-[#E5E7EB] overflow-y-auto px-4">
              {destaque.itens.map((i) => (
                <li key={i.id}>
                  <ItemKds i={i} feito={(riscados[destaque.id] ?? []).includes(i.id)} onClick={() => onRiscar(destaque.id, i.id)} />
                  <FichaDoItem f={i.itemId ? fichas[i.itemId] : undefined} />
                </li>
              ))}
            </ul>
            {destaque.editadoEm && <p className="mx-4 mt-2 rounded-[4px] bg-[#B45309] px-2 py-1 text-center font-semibold text-white" data-testid="kds-destaque-alterado"><span className="uppercase tracking-wide">⚠ Alterado</span>{resumoCurto(destaque.edicoes) ? `: ${resumoCurto(destaque.edicoes)}` : ''}</p>}
            {destaque.observacao && <p className="mx-4 my-2 rounded-[4px] bg-[#FEF3C7] px-2 py-1 font-semibold text-[#92400E]">Obs.: {destaque.observacao}</p>}
            <div className="p-3">
              <button type="button" onClick={() => onPronto(destaque)} disabled={ocupado === destaque.id}
                className="flex h-[56px] w-full items-center justify-center gap-2 rounded-[4px] bg-[#1E9E5E] text-[1.05em] font-semibold text-white hover:bg-[#178A50] disabled:opacity-60" data-testid="kds-destaque-pronto">
                <Check className="h-6 w-6" aria-hidden /> Marcar como pronto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ItemMenu({ icone, onClick, perigo, testid, children }: { icone: React.ReactNode; onClick: () => void; perigo?: boolean; testid?: string; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} data-testid={testid}
      className={`flex h-[44px] w-full items-center gap-3 px-4 text-left text-[14px] font-medium ${perigo ? 'text-[#B91C1C] hover:bg-[#FEF2F2]' : 'text-[#374151] hover:bg-[#F3F4F6]'}`}>
      <span aria-hidden>{icone}</span>{children}
    </button>
  )
}

/**
 * Cartão da imagem-modelo: cabeçalho colorido pela etapa com tipo, número, data/hora e cronômetro; itens com o
 * quadradinho à esquerda (vermelho = a fazer, verde = feito) e botão contornado embaixo. Fila: Iniciar preparo.
 * Preparo: riscar itens, Marcar pronto. Prontos: Voltar ao preparo (engano). Cronômetro atrasado vira selo branco.
 */
const CardKds = memo(function CardKds({ p, etapa, agora, prefs, riscados, fichas, ocupado, onRiscar, onAcao, onAbrir }: {
  p: Pedido; etapa: Etapa; agora: number; prefs: PreferenciasKds; riscados?: string[]; fichas: Record<string, FichaKds>; ocupado: boolean
  onRiscar?: (pedidoId: string, itemId: string) => void; onAcao: () => void; onAbrir?: () => void
}) {
  const min = minutosDesde(p.criadoEm, agora)
  const cor = corDoTempo(min, prefs.limites)
  const feitos = new Set(riscados ?? [])
  const testid = etapa === 'fila' ? 'kds-fila-card' : etapa === 'preparo' ? 'kds-card' : 'kds-pronto-card'
  const atrasado = etapa !== 'prontos' && cor === 'vermelho'
  const cabecalho = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[0.95em] font-semibold"><Utensils className="h-4 w-4 flex-shrink-0" aria-hidden /><span className="truncate">{rotuloTipo(p)}</span></span>
        <span className="flex-shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[0.72em] font-semibold uppercase tracking-wide">{ETAPA[etapa].rotulo}</span>
      </span>
      <span className="mt-1 block text-[1.2em] font-semibold leading-tight">Pedido Nº {p.numero}</span>
      <span className="mt-1 flex items-center justify-between gap-2 text-[0.82em] font-medium">
        <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden />{dia.format(new Date(p.criadoEm))} · {hora.format(new Date(p.criadoEm))}</span>
        {etapa !== 'prontos' && (
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold tabular-nums ${atrasado ? 'bg-white text-[#B91C1C]' : 'bg-black/15'}`} data-testid="kds-tempo"
            title={atrasado ? 'Atrasado' : undefined}>
            <Timer className="h-3.5 w-3.5" aria-hidden />{cronometro(min)}{atrasado && <span className="sr-only"> atrasado</span>}
          </span>
        )}
      </span>
      {p.preparandoPor && etapa === 'preparo' && <span className="mt-0.5 block text-[0.78em] font-medium opacity-95">{p.preparandoPor}</span>}
    </>
  )
  const estiloCab = { backgroundColor: ETAPA[etapa].cor }
  return (
    <article className="mb-3 flex break-inside-avoid flex-col overflow-hidden rounded-[6px] bg-white shadow-[0_2px_6px_rgba(0,0,0,0.25)]" data-testid={testid} data-cor={cor}>
      {onAbrir ? (
        <button type="button" onClick={onAbrir} className="block w-full px-3 py-2.5 text-left text-white" style={estiloCab} aria-label={`Abrir o pedido ${p.numero} em destaque`}>{cabecalho}</button>
      ) : (
        <div className="px-3 py-2.5 text-white" style={estiloCab}>{cabecalho}</div>
      )}
      <ul className="divide-y divide-[#EEF0F3] px-3">
        {p.itens.map((i) => (
          <li key={i.id}>
            <ItemKds i={i} feito={feitos.has(i.id)} onClick={onRiscar ? () => onRiscar(p.id, i.id) : undefined} />
            {etapa === 'preparo' && <FichaDoItem f={i.itemId ? fichas[i.itemId] : undefined} curta />}
          </li>
        ))}
      </ul>
      {/* Edição de pedido (Bloco A, 19/10): faixa curta gerada do histórico ("− 1× fsd · + 1× coca lata"); a observação do cliente fica só dele. */}
      {p.editadoEm && <p className="mx-3 mb-1 rounded-[4px] bg-[#B45309] px-2 py-1 text-center text-[0.85em] font-semibold text-white" data-testid="kds-alterado"><span className="uppercase tracking-wide">⚠ Alterado</span>{resumoCurto(p.edicoes) ? `: ${resumoCurto(p.edicoes)}` : ''}</p>}
      {p.observacao && <p className="mx-3 mb-1 text-[0.85em] text-[#374151]" data-testid="kds-obs-pedido"><span className="font-semibold">Obs.:</span> {p.observacao}</p>}
      <div className="px-3 pb-3 pt-2">
        {etapa === 'fila' && (
          <BotaoCard onClick={onAcao} disabled={ocupado} testid="kds-comecar" icone={<ChefHat className="h-4 w-4 text-[#D94848]" aria-hidden />}>
            {ocupado ? 'Iniciando…' : 'Iniciar preparo'}
          </BotaoCard>
        )}
        {etapa === 'preparo' && (
          <BotaoCard onClick={onAcao} disabled={ocupado} testid="kds-pronto" icone={<Check className="h-4 w-4 text-[#1E9E5E]" aria-hidden />}>
            {ocupado ? 'Salvando…' : 'Marcar como pronto'}
          </BotaoCard>
        )}
        {etapa === 'prontos' && (
          <BotaoCard onClick={onAcao} disabled={ocupado} testid="kds-voltar" rotulo={`Voltar o pedido ${p.numero} para o preparo`} icone={<Undo2 className="h-4 w-4 text-[#DE8A12]" aria-hidden />}>
            Voltar ao preparo
          </BotaoCard>
        )}
      </div>
    </article>
  )
})

/** Botão contornado da imagem-modelo ("Back to New Order"), na altura de toque. */
function BotaoCard({ onClick, disabled, testid, rotulo, icone, children }: { onClick: () => void; disabled: boolean; testid: string; rotulo?: string; icone: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={rotulo} data-testid={testid}
      className="flex h-[44px] w-full items-center justify-center gap-2 rounded-[4px] border border-[#9CA3AF] bg-white text-[0.88em] font-semibold text-[#1F2937] transition-colors hover:bg-[#F3F4F6] active:bg-[#E5E7EB] disabled:cursor-wait disabled:opacity-50">
      {icone}{children}
    </button>
  )
}

function ItemKds({ i, feito, onClick }: { i: PedidoItem; feito: boolean; onClick?: () => void }) {
  const detalhes = [i.tamanhoNome, i.saborNome, i.bordaNome && `Borda ${i.bordaNome}`, i.massaNome && `Massa ${i.massaNome}`].filter(Boolean) as string[]
  const conteudo = (
    <span className="flex items-start gap-2.5">
      {/* Quadradinho da imagem-modelo: vermelho = a fazer, verde = feito. */}
      <span className={`mt-[3px] grid h-[14px] w-[14px] flex-shrink-0 place-items-center border-2 ${feito ? 'border-[#1E9E5E]' : 'border-[#D94848]'}`} aria-hidden>
        <span className={`h-[6px] w-[6px] rounded-full ${feito ? 'bg-[#1E9E5E]' : 'bg-[#D94848]'}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`flex items-baseline justify-between gap-2 text-[0.95em] font-semibold leading-snug ${feito ? 'line-through' : ''}`}>
          <span>{i.nome}</span><span className="flex-shrink-0 tabular-nums">× {i.quantidade}</span>
        </span>
        {detalhes.length > 0 && <span className="block text-[0.82em] text-[#6B7280]">{detalhes.join(' · ')}</span>}
        {i.complementos.length > 0 && <span className="block text-[0.82em] font-medium text-[#1D4ED8]">{i.complementos.map((c) => `+ ${c.nome}`).join('  ')}</span>}
        {i.observacao && <span className="mt-1 block rounded-[4px] bg-[#FEF3C7] px-2 py-0.5 text-[0.85em] font-semibold text-[#92400E]">⚠ {i.observacao}</span>}
      </span>
    </span>
  )
  if (!onClick) return <div className="py-2.5" data-testid="kds-item">{conteudo}</div>
  return (
    <button type="button" onClick={onClick} aria-pressed={feito} title={feito ? 'Desmarcar item' : 'Marcar item como feito'}
      className={`block min-h-[44px] w-full py-2.5 text-left ${feito ? 'opacity-50' : ''}`} data-testid="kds-item">
      {conteudo}
    </button>
  )
}

/** Modo de preparo + ingredientes (ficha de preparo do item). Sem nada cadastrado, não aparece. */
function FichaDoItem({ f, curta }: { f?: FichaKds; curta?: boolean }) {
  if (!f || (!f.modoPreparo && !f.ingredientes.length && !f.passos.length)) return null
  return (
    <div className="mb-2 rounded-[4px] bg-[#F3F4F6] px-2 py-1.5 text-[0.85em] text-[#374151]" data-testid="kds-ficha">
      {f.modoPreparo && <p><span className="font-semibold">Modo de preparo:</span> {f.modoPreparo}</p>}
      {!curta && f.ingredientes.length > 0 && <p className="mt-1"><span className="font-semibold">Ingredientes:</span> {f.ingredientes.map((x) => (x.quantidade ? `${x.nome} (${x.quantidade})` : x.nome)).join(', ')}</p>}
      {!curta && f.passos.length > 0 && <ol className="mt-1 list-decimal pl-5">{f.passos.map((t, n) => <li key={n}>{t}</li>)}</ol>}
    </div>
  )
}
