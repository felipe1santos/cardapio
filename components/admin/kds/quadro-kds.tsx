'use client'

import { memo, useEffect, useState } from 'react'
import { resumoCurto } from '@/lib/pedido-edicao-regras'
import { Check, ChefHat, LogOut, Maximize2, Minimize2, Moon, Settings2, Sun, Type, Undo2, X } from 'lucide-react'
import { corDoTempo, minutosDesde, type CorTempo, type LimitesTempo } from '@/lib/kds'
import type { Pedido, PedidoItem } from '@/lib/queries/pedidos'

/**
 * KDS único (12/10): só desenha. Quem busca os pedidos e move o status é a página (/admin/kds) — e, nos prints, o modo
 * demonstração. Três colunas: Na fila → Em preparo → Prontos. Tocar na fila = Começar preparo (abre o pedido em destaque
 * com modo de preparo e ingredientes). Tela cheia para TV/tablet, letra grande, claro/escuro.
 */
export interface PreferenciasKds { escuro: boolean; grande: boolean; limites: LimitesTempo }
export interface FichaKds { modoPreparo: string | null; ingredientes: { nome: string; quantidade: string }[]; passos: string[]; tempoMin: number | null }

const COR: Record<CorTempo, { faixa: string; texto: string; textoEscuro: string }> = {
  verde: { faixa: '#10B981', texto: '#047857', textoEscuro: '#34D399' },
  amarelo: { faixa: '#F59E0B', texto: '#B45309', textoEscuro: '#FBBF24' },
  vermelho: { faixa: '#EF4444', texto: '#B91C1C', textoEscuro: '#F87171' },
}
const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })

function rotuloTipo(p: Pedido): string {
  if (p.canal === 'mesa') return p.mesa ? `Mesa ${p.mesa}` : 'Mesa'
  if (p.canal === 'balcao') return p.comandaSenha ? `Balcão · senha ${p.comandaSenha}` : 'Balcão'
  return p.tipo === 'retirada' ? 'Retirada' : 'Entrega'
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
  useEffect(() => {
    const mudou = () => setCheia(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', mudou)
    return () => document.removeEventListener('fullscreenchange', mudou)
  }, [])
  const telaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }
  const e = prefs.escuro
  const ativos = [...colunas.fila, ...colunas.preparo]
  const atrasados = ativos.filter((p) => corDoTempo(minutosDesde(p.criadoEm, agora), prefs.limites) === 'vermelho').length
  const suave = e ? 'text-[#9CA3AF]' : 'text-[#6B7280]'

  return (
    <div className={`fixed inset-0 z-[80] flex flex-col font-sans ${e ? 'bg-[#111827] text-[#F9FAFB]' : 'bg-[#EDEEF1] text-[#1F2937]'}`}
      style={{ fontSize: prefs.grande ? 18 : 15 }} data-testid="kds">
      <header className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 ${e ? 'border-[#1F2937] bg-[#0B1220]' : 'border-[#E5E7EB] bg-white'}`}>
        <p className="flex items-center gap-2 text-[1.15em] font-semibold tracking-tight"><ChefHat className="h-5 w-5" aria-hidden /> KDS</p>
        <span className="rounded-[3px] bg-[#A855F7] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">Em teste</span>
        {demo && <span className="rounded-[3px] bg-[#F59E0B] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#111827]">Demonstração</span>}
        <span className={`text-[0.9em] ${suave}`} data-testid="kds-contagem">
          {ativos.length} na cozinha{atrasados > 0 ? ` · ${atrasados} atrasado${atrasados > 1 ? 's' : ''}` : ''}
          {colunas.aguardandoAceite > 0 ? ` · ${colunas.aguardandoAceite} esperando aceite no Painel` : ''}
        </span>
        {setores.length > 1 && (
          <nav className="flex flex-wrap gap-1.5" aria-label="Setor">
            {[null, ...setores].map((s) => {
              const ativo = setor === s
              return (
                <button key={s ?? 'todos'} type="button" onClick={() => onSetor(s)} aria-pressed={ativo}
                  className={`h-[34px] rounded-[3px] px-3 text-[12px] font-semibold uppercase tracking-wide ${ativo ? 'bg-[#0688D4] text-white' : e ? 'bg-[#1F2937] text-[#D1D5DB]' : 'bg-[#F3F4F6] text-[#374151]'}`}>
                  {s ?? 'Todos'}
                </button>
              )
            })}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <BotaoTopo escuro={e} rotulo={e ? 'Modo claro' : 'Modo escuro'} onClick={() => onPrefs({ ...prefs, escuro: !e })}>{e ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</BotaoTopo>
          <BotaoTopo escuro={e} rotulo={prefs.grande ? 'Letra normal' : 'Letra grande'} ativo={prefs.grande} onClick={() => onPrefs({ ...prefs, grande: !prefs.grande })}><Type className="h-5 w-5" /></BotaoTopo>
          <BotaoTopo escuro={e} rotulo="Tempos do cronômetro" ativo={config} onClick={() => setConfig((v) => !v)}><Settings2 className="h-5 w-5" /></BotaoTopo>
          <BotaoTopo escuro={e} rotulo={cheia ? 'Sair da tela cheia' : 'Tela cheia'} onClick={telaCheia}>{cheia ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}</BotaoTopo>
          <BotaoTopo escuro={e} rotulo="Voltar ao painel" onClick={onSair}><X className="h-5 w-5" /></BotaoTopo>
          <button type="button" onClick={onLogout} title="Sair da conta" aria-label="Sair da conta" data-testid="kds-sair-conta"
            className={`ml-1 flex h-[40px] items-center gap-1 rounded-[3px] px-2 text-[11px] font-semibold uppercase tracking-wide ${suave} hover:underline`}>
            <LogOut className="h-4 w-4" aria-hidden /> Sair
          </button>
        </div>
      </header>

      {config && (
        <div className={`flex flex-wrap items-center gap-4 border-b px-4 py-2.5 text-[0.85em] ${e ? 'border-[#1F2937] bg-[#0B1220]' : 'border-[#E5E7EB] bg-white'}`} data-testid="kds-config">
          <span className="font-semibold">Cores do tempo (minutos):</span>
          <label className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-[#F59E0B]" aria-hidden />Amarelo a partir de
            <input type="number" min={1} max={120} value={prefs.limites.amarelo} inputMode="numeric"
              onChange={(ev) => { const a = Number(ev.target.value); if (a >= 1 && a < prefs.limites.vermelho) onPrefs({ ...prefs, limites: { ...prefs.limites, amarelo: a } }) }}
              className={`h-[34px] w-[64px] rounded-[3px] border px-2 ${e ? 'border-[#374151] bg-[#1F2937]' : 'border-[#CBD2D9] bg-white'}`} />
          </label>
          <label className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-[#EF4444]" aria-hidden />Vermelho depois de
            <input type="number" min={2} max={180} value={prefs.limites.vermelho} inputMode="numeric"
              onChange={(ev) => { const v = Number(ev.target.value); if (v > prefs.limites.amarelo && v <= 180) onPrefs({ ...prefs, limites: { ...prefs.limites, vermelho: v } }) }}
              className={`h-[34px] w-[64px] rounded-[3px] border px-2 ${e ? 'border-[#374151] bg-[#1F2937]' : 'border-[#CBD2D9] bg-white'}`} />
          </label>
          <span className={suave}>Guardado neste aparelho.</span>
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 md:grid-cols-[1fr_1.4fr_0.8fr] md:overflow-hidden">
        <Coluna titulo="Na fila" qtd={colunas.fila.length} escuro={e} testid="kds-col-fila" vazio={carregando ? 'Carregando…' : 'Nada esperando. Pedidos aceitos no Painel aparecem aqui.'}>
          {colunas.fila.map((p) => (
            <CartaoFila key={p.id} p={p} agora={agora} prefs={prefs} ocupado={ocupado === p.id} onComecar={() => onComecar(p)} />
          ))}
        </Coluna>
        <Coluna titulo="Em preparo" qtd={colunas.preparo.length} escuro={e} testid="kds-col-preparo" vazio="Toque num pedido da fila para começar.">
          {colunas.preparo.map((p) => (
            <CardKds key={p.id} p={p} agora={agora} prefs={prefs} riscados={riscados[p.id]} fichas={fichas} ocupado={ocupado === p.id}
              onRiscar={onRiscar} onPronto={onPronto} onAbrir={() => onAbrir(p)} />
          ))}
        </Coluna>
        <Coluna titulo="Prontos" qtd={colunas.prontos.length} escuro={e} testid="kds-col-prontos" vazio="Os últimos prontos aparecem aqui.">
          {colunas.prontos.map((p) => (
            <div key={p.id} className={`flex items-center justify-between gap-2 rounded-[3px] border px-3 py-2 ${e ? 'border-[#1F2937] bg-[#1F2937]' : 'border-[#E5E7EB] bg-white'}`} data-testid="kds-pronto-card">
              <div className="min-w-0">
                <p className="font-semibold">#{p.numero} <span className={`text-[0.8em] font-normal ${suave}`}>{rotuloTipo(p)}</span></p>
                <p className={`truncate text-[0.8em] ${suave}`}>{p.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', ')}</p>
              </div>
              <button type="button" onClick={() => onVoltar(p)} disabled={ocupado === p.id} title="Voltar para o preparo (engano)" aria-label={`Voltar o pedido ${p.numero} para o preparo`}
                className={`flex h-[36px] flex-shrink-0 items-center gap-1 rounded-[3px] px-2 text-[11px] font-semibold uppercase ${e ? 'bg-[#374151] text-[#E5E7EB]' : 'bg-[#F3F4F6] text-[#374151]'} disabled:opacity-50`} data-testid="kds-voltar">
                <Undo2 className="h-4 w-4" aria-hidden /> Voltar
              </button>
            </div>
          ))}
        </Coluna>
      </main>

      {destaque && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3" onMouseDown={onFecharDestaque} data-testid="kds-destaque">
          <div role="dialog" aria-modal="true" aria-label={`Pedido ${destaque.numero}`} onMouseDown={(ev) => ev.stopPropagation()}
            className={`flex max-h-full w-full max-w-[720px] flex-col overflow-hidden rounded-[3px] ${e ? 'bg-[#1F2937] text-[#F9FAFB]' : 'bg-white text-[#1F2937]'}`}>
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: e ? '#374151' : '#E5E7EB' }}>
              <p className="text-[1.4em] font-semibold">#{destaque.numero} <span className={`text-[0.6em] font-normal ${suave}`}>{rotuloTipo(destaque)} · {hora.format(new Date(destaque.criadoEm))}</span></p>
              <button type="button" onClick={onFecharDestaque} aria-label="Fechar" className="grid h-[40px] w-[40px] place-items-center rounded-[3px]"><X className="h-5 w-5" /></button>
            </div>
            <ul className={`min-h-0 flex-1 divide-y overflow-y-auto px-4 ${e ? 'divide-[#374151]' : 'divide-[#E5E7EB]'}`}>
              {destaque.itens.map((i) => (
                <li key={i.id}>
                  <ItemKds i={i} feito={(riscados[destaque.id] ?? []).includes(i.id)} escuro={e} onClick={() => onRiscar(destaque.id, i.id)} />
                  <FichaDoItem f={i.itemId ? fichas[i.itemId] : undefined} escuro={e} />
                </li>
              ))}
            </ul>
            {destaque.editadoEm && <p className="mx-4 mt-2 rounded-[3px] bg-[#B45309] px-2 py-1 text-center font-semibold text-white" data-testid="kds-destaque-alterado"><span className="uppercase tracking-wide">⚠ Alterado</span>{resumoCurto(destaque.edicoes) ? `: ${resumoCurto(destaque.edicoes)}` : ''}</p>}
            {destaque.observacao && <p className="mx-4 my-2 rounded-[3px] bg-[#FEF3C7] px-2 py-1 font-semibold text-[#92400E]">⚠ Pedido: {destaque.observacao}</p>}
            <button type="button" onClick={() => onPronto(destaque)} disabled={ocupado === destaque.id}
              className="flex h-[60px] items-center justify-center gap-2 bg-[#047857] text-[1.05em] font-semibold uppercase tracking-wide text-white hover:bg-[#065F46] disabled:opacity-60" data-testid="kds-destaque-pronto">
              <Check className="h-6 w-6" aria-hidden /> Pronto
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Coluna({ titulo, qtd, escuro, vazio, testid, children }: { titulo: string; qtd: number; escuro: boolean; vazio: string; testid: string; children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col" data-testid={testid}>
      <h2 className={`mb-2 flex items-center gap-2 text-[0.85em] font-semibold uppercase tracking-wide ${escuro ? 'text-[#D1D5DB]' : 'text-[#374151]'}`}>
        {titulo} <span className={`rounded-full px-2 py-[1px] text-[0.9em] ${escuro ? 'bg-[#374151]' : 'bg-white'}`}>{qtd}</span>
      </h2>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2">
        {qtd === 0 ? <p className={`mt-6 text-center text-[0.9em] ${escuro ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}`}>{vazio}</p> : children}
      </div>
    </section>
  )
}

function BotaoTopo({ escuro, rotulo, ativo, onClick, children }: { escuro: boolean; rotulo: string; ativo?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo} aria-pressed={ativo}
      className={`grid h-[40px] w-[40px] place-items-center rounded-[3px] ${ativo ? 'bg-[#0688D4] text-white' : escuro ? 'bg-[#1F2937] text-[#E5E7EB] hover:bg-[#374151]' : 'bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB]'}`}>
      {children}
    </button>
  )
}

function Tempo({ p, agora, prefs }: { p: Pedido; agora: number; prefs: PreferenciasKds }) {
  const min = minutosDesde(p.criadoEm, agora)
  const cor = COR[corDoTempo(min, prefs.limites)]
  return <span className="font-semibold tabular-nums" style={{ color: prefs.escuro ? cor.textoEscuro : cor.texto }} data-testid="kds-tempo">{cronometro(min)}</span>
}

/** Fila: cartão compacto; o toque inteiro é "Começar preparo". */
function CartaoFila({ p, agora, prefs, ocupado, onComecar }: { p: Pedido; agora: number; prefs: PreferenciasKds; ocupado: boolean; onComecar: () => void }) {
  const e = prefs.escuro
  const cor = COR[corDoTempo(minutosDesde(p.criadoEm, agora), prefs.limites)]
  return (
    <button type="button" onClick={onComecar} disabled={ocupado} data-testid="kds-fila-card"
      className={`block w-full rounded-[3px] border text-left disabled:opacity-60 ${e ? 'border-[#1F2937] bg-[#1F2937] hover:bg-[#273449]' : 'border-[#E5E7EB] bg-white hover:bg-[#F9FAFB]'}`}
      style={{ borderLeft: `6px solid ${cor.faixa}` }}>
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <span className="text-[1.3em] font-semibold">#{p.numero}</span>
        <Tempo p={p} agora={agora} prefs={prefs} />
      </div>
      <p className={`px-3 text-[0.85em] ${e ? 'text-[#D1D5DB]' : 'text-[#374151]'}`}>{rotuloTipo(p)} · {hora.format(new Date(p.criadoEm))}</p>
      <p className="px-3 pb-1 text-[0.9em]">{p.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(' · ')}</p>
      <p className="border-t px-3 py-1.5 text-[0.8em] font-semibold uppercase tracking-wide text-[#0688D4]" style={{ borderColor: e ? '#374151' : '#E5E7EB' }}>
        {ocupado ? 'Começando…' : 'Tocar para começar o preparo'}
      </p>
    </button>
  )
}

const CardKds = memo(function CardKds({ p, agora, prefs, riscados, fichas, ocupado, onRiscar, onPronto, onAbrir }: {
  p: Pedido; agora: number; prefs: PreferenciasKds; riscados?: string[]; fichas: Record<string, FichaKds>; ocupado: boolean
  onRiscar: (pedidoId: string, itemId: string) => void; onPronto: (p: Pedido) => void; onAbrir: () => void
}) {
  const e = prefs.escuro
  const cor = COR[corDoTempo(minutosDesde(p.criadoEm, agora), prefs.limites)]
  const feitos = new Set(riscados ?? [])
  return (
    <article className={`flex flex-col overflow-hidden rounded-[3px] border ${e ? 'border-[#1F2937] bg-[#1F2937]' : 'border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.06)]'}`}
      style={{ borderTop: `6px solid ${cor.faixa}` }} data-testid="kds-card" data-cor={corDoTempo(minutosDesde(p.criadoEm, agora), prefs.limites)}>
      <button type="button" onClick={onAbrir} className={`flex items-start justify-between gap-2 border-b px-3 py-2 text-left ${e ? 'border-[#374151]' : 'border-[#E5E7EB]'}`} aria-label={`Abrir o pedido ${p.numero} em destaque`}>
        <div className="min-w-0">
          <p className="text-[1.5em] font-semibold leading-none tracking-tight">#{p.numero}</p>
          <p className={`mt-1 text-[0.85em] ${e ? 'text-[#D1D5DB]' : 'text-[#374151]'}`}>{rotuloTipo(p)} · {hora.format(new Date(p.criadoEm))}{p.preparandoPor ? ` · ${p.preparandoPor}` : ''}</p>
        </div>
        <span className="text-[1.4em] leading-none"><Tempo p={p} agora={agora} prefs={prefs} /></span>
      </button>
      <ul className={`flex-1 divide-y px-3 py-1 ${e ? 'divide-[#374151]' : 'divide-[#E5E7EB]'}`}>
        {p.itens.map((i) => (
          <li key={i.id}>
            <ItemKds i={i} feito={feitos.has(i.id)} escuro={e} onClick={() => onRiscar(p.id, i.id)} />
            <FichaDoItem f={i.itemId ? fichas[i.itemId] : undefined} escuro={e} curta />
          </li>
        ))}
      </ul>
      {/* Edição de pedido (Bloco A, 19/10): faixa curta gerada do histórico ("− 1× fsd · + 1× coca lata"); a observação do cliente fica só dele. */}
      {p.editadoEm && <p className="mx-3 mb-1 rounded-[3px] bg-[#B45309] px-2 py-1 text-center text-[0.9em] font-semibold text-white" data-testid="kds-alterado"><span className="uppercase tracking-wide">⚠ Alterado</span>{resumoCurto(p.edicoes) ? `: ${resumoCurto(p.edicoes)}` : ''}</p>}
      {p.observacao && <p className="mx-3 mb-2 rounded-[3px] bg-[#FEF3C7] px-2 py-1 text-[0.95em] font-semibold text-[#92400E]" data-testid="kds-obs-pedido">⚠ Pedido: {p.observacao}</p>}
      <button type="button" onClick={() => onPronto(p)} disabled={ocupado}
        className="flex h-[56px] items-center justify-center gap-2 bg-[#047857] text-[1em] font-semibold uppercase tracking-wide text-white hover:bg-[#065F46] active:bg-[#064E3B] disabled:opacity-60" data-testid="kds-pronto">
        <Check className="h-6 w-6" aria-hidden /> Pronto
      </button>
    </article>
  )
})

function ItemKds({ i, feito, escuro, onClick }: { i: PedidoItem; feito: boolean; escuro: boolean; onClick: () => void }) {
  const detalhes = [i.tamanhoNome, i.saborNome, i.bordaNome && `Borda ${i.bordaNome}`, i.massaNome && `Massa ${i.massaNome}`].filter(Boolean) as string[]
  return (
    <button type="button" onClick={onClick} aria-pressed={feito} className={`block w-full py-2 text-left ${feito ? 'opacity-45' : ''}`} data-testid="kds-item">
      <span className={`text-[1.15em] font-semibold leading-snug ${feito ? 'line-through' : ''}`}><span className="tabular-nums">{i.quantidade}×</span> {i.nome}</span>
      {detalhes.length > 0 && <span className={`block text-[0.9em] font-semibold ${escuro ? 'text-[#D1D5DB]' : 'text-[#374151]'}`}>{detalhes.join(' · ')}</span>}
      {i.complementos.length > 0 && <span className={`block text-[0.9em] font-semibold ${escuro ? 'text-[#7DD3FC]' : 'text-[#0369A1]'}`}>{i.complementos.map((c) => `+ ${c.nome}`).join('  ')}</span>}
      {i.observacao && <span className="mt-1 block rounded-[3px] bg-[#FEF3C7] px-2 py-1 text-[0.95em] font-semibold text-[#92400E]">⚠ {i.observacao}</span>}
    </button>
  )
}

/** Modo de preparo + ingredientes (ficha de preparo do item). Sem nada cadastrado, não aparece. */
function FichaDoItem({ f, escuro, curta }: { f?: FichaKds; escuro: boolean; curta?: boolean }) {
  if (!f || (!f.modoPreparo && !f.ingredientes.length && !f.passos.length)) return null
  const caixa = escuro ? 'bg-[#111827] text-[#D1D5DB]' : 'bg-[#F3F4F6] text-[#374151]'
  return (
    <div className={`mb-2 rounded-[3px] px-2 py-1.5 text-[0.85em] ${caixa}`} data-testid="kds-ficha">
      {f.modoPreparo && <p><span className="font-semibold">Modo de preparo:</span> {f.modoPreparo}</p>}
      {!curta && f.ingredientes.length > 0 && <p className="mt-1"><span className="font-semibold">Ingredientes:</span> {f.ingredientes.map((x) => (x.quantidade ? `${x.nome} (${x.quantidade})` : x.nome)).join(', ')}</p>}
      {!curta && f.passos.length > 0 && <ol className="mt-1 list-decimal pl-5">{f.passos.map((t, n) => <li key={n}>{t}</li>)}</ol>}
    </div>
  )
}
