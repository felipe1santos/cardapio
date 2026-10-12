'use client'

import { memo, useEffect, useState } from 'react'
import { Check, Maximize2, Minimize2, Moon, Settings2, Sun, Type, X } from 'lucide-react'
import { corDoTempo, minutosDesde, type CorTempo, type LimitesTempo } from '@/lib/kds'
import type { Pedido, PedidoItem } from '@/lib/queries/pedidos'

/**
 * Quadro do KDS (prévia, 12/10): só desenha. Quem busca os pedidos e move o status é a página (/admin/kds) — e, nos
 * prints, o modo demonstração com pedidos fictícios. Tela cheia para TV/tablet, letra grande, claro/escuro.
 */
export interface PreferenciasKds { escuro: boolean; grande: boolean; limites: LimitesTempo }

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

export function QuadroKds({
  pedidos, agora, prefs, setores, setor, riscados, carregando, demo,
  onSetor, onRiscar, onPronto, onPrefs, onSair,
}: {
  pedidos: Pedido[]; agora: number; prefs: PreferenciasKds; setores: string[]; setor: string | null; riscados: Record<string, string[]>
  carregando?: boolean; demo?: boolean
  onSetor: (s: string | null) => void; onRiscar: (pedidoId: string, itemId: string) => void; onPronto: (p: Pedido) => void
  onPrefs: (p: PreferenciasKds) => void; onSair: () => void
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
  const atrasados = pedidos.filter((p) => corDoTempo(minutosDesde(p.criadoEm, agora), prefs.limites) === 'vermelho').length

  return (
    <div
      className={`fixed inset-0 z-[80] flex flex-col font-sans ${e ? 'bg-[#111827] text-[#F9FAFB]' : 'bg-[#EDEEF1] text-[#1F2937]'}`}
      style={{ fontSize: prefs.grande ? 18 : 15 }}
      data-testid="kds"
    >
      <header className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 ${e ? 'border-[#1F2937] bg-[#0B1220]' : 'border-[#E5E7EB] bg-white'}`}>
        <p className="text-[1.15em] font-semibold tracking-tight">Cozinha</p>
        <span className="rounded-[3px] bg-[#A855F7] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">Prévia</span>
        {demo && <span className="rounded-[3px] bg-[#F59E0B] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#111827]">Demonstração</span>}
        <span className={`text-[0.9em] ${e ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}`} data-testid="kds-contagem">
          {pedidos.length} {pedidos.length === 1 ? 'pedido' : 'pedidos'}{atrasados > 0 ? ` · ${atrasados} atrasado${atrasados > 1 ? 's' : ''}` : ''}
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
          <BotaoTopo escuro={e} rotulo="Fechar a cozinha" onClick={onSair}><X className="h-5 w-5" /></BotaoTopo>
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
          <span className={e ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}>Guardado neste aparelho.</span>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        {pedidos.length === 0 ? (
          <div className={`grid h-full place-items-center text-center ${e ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}`}>
            <div>
              <p className="text-[1.6em] font-semibold">{carregando ? 'Carregando…' : 'Nenhum pedido na cozinha'}</p>
              {!carregando && <p className="mt-1">Os pedidos novos aparecem aqui sozinhos.</p>}
            </div>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${prefs.grande ? 340 : 290}px, 1fr))` }}>
            {pedidos.map((p) => (
              <CardKds key={p.id} p={p} agora={agora} prefs={prefs} riscados={riscados[p.id]} onRiscar={onRiscar} onPronto={onPronto} />
            ))}
          </div>
        )}
      </main>
    </div>
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

const CardKds = memo(function CardKds({ p, agora, prefs, riscados, onRiscar, onPronto }: {
  p: Pedido; agora: number; prefs: PreferenciasKds; riscados?: string[]; onRiscar: (pedidoId: string, itemId: string) => void; onPronto: (p: Pedido) => void
}) {
  const e = prefs.escuro
  const min = minutosDesde(p.criadoEm, agora)
  const cor = COR[corDoTempo(min, prefs.limites)]
  const novo = p.status === 'recebido'
  const feitos = new Set(riscados ?? [])
  return (
    <article className={`flex flex-col overflow-hidden rounded-[3px] border ${e ? 'border-[#1F2937] bg-[#1F2937]' : 'border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.06)]'}`}
      style={{ borderTop: `6px solid ${cor.faixa}` }} data-testid="kds-card" data-cor={corDoTempo(min, prefs.limites)}>
      <div className={`flex items-start justify-between gap-2 border-b px-3 py-2 ${e ? 'border-[#374151]' : 'border-[#E5E7EB]'}`}>
        <div className="min-w-0">
          <p className="text-[1.6em] font-semibold leading-none tracking-tight">#{p.numero}</p>
          <p className={`mt-1 text-[0.85em] font-semibold ${e ? 'text-[#D1D5DB]' : 'text-[#374151]'}`}>
            {rotuloTipo(p)} · {hora.format(new Date(p.criadoEm))}
            {novo && <span className="ml-1.5 rounded-[3px] bg-[#F97316] px-1.5 py-[1px] text-[0.75em] font-semibold uppercase text-white">Novo</span>}
          </p>
        </div>
        <p className="text-[1.5em] font-semibold tabular-nums leading-none" style={{ color: e ? cor.textoEscuro : cor.texto }} data-testid="kds-tempo" aria-label={`${Math.floor(min)} minutos`}>
          {cronometro(min)}
        </p>
      </div>
      <ul className={`flex-1 divide-y px-3 py-1 ${e ? 'divide-[#374151]' : 'divide-[#E5E7EB]'}`}>
        {p.itens.map((i) => (
          <ItemKds key={i.id} i={i} feito={feitos.has(i.id)} escuro={e} onClick={() => onRiscar(p.id, i.id)} />
        ))}
      </ul>
      {p.observacao && (
        <p className="mx-3 mb-2 rounded-[3px] bg-[#FEF3C7] px-2 py-1 text-[0.95em] font-semibold text-[#92400E]" data-testid="kds-obs-pedido">⚠ Pedido: {p.observacao}</p>
      )}
      <button type="button" onClick={() => onPronto(p)}
        className="flex h-[56px] items-center justify-center gap-2 bg-[#047857] text-[1em] font-semibold uppercase tracking-wide text-white hover:bg-[#065F46] active:bg-[#064E3B]" data-testid="kds-pronto">
        <Check className="h-6 w-6" aria-hidden /> Pronto
      </button>
    </article>
  )
})

function ItemKds({ i, feito, escuro, onClick }: { i: PedidoItem; feito: boolean; escuro: boolean; onClick: () => void }) {
  const detalhes = [i.tamanhoNome, i.saborNome, i.bordaNome && `Borda ${i.bordaNome}`, i.massaNome && `Massa ${i.massaNome}`].filter(Boolean) as string[]
  return (
    <li>
      <button type="button" onClick={onClick} aria-pressed={feito} className={`block w-full py-2 text-left ${feito ? 'opacity-45' : ''}`} data-testid="kds-item">
        <span className={`text-[1.15em] font-semibold leading-snug ${feito ? 'line-through' : ''}`}>
          <span className="tabular-nums">{i.quantidade}×</span> {i.nome}
        </span>
        {detalhes.length > 0 && <span className={`block text-[0.9em] font-semibold ${escuro ? 'text-[#D1D5DB]' : 'text-[#374151]'}`}>{detalhes.join(' · ')}</span>}
        {i.complementos.length > 0 && (
          <span className={`block text-[0.9em] font-semibold ${escuro ? 'text-[#7DD3FC]' : 'text-[#0369A1]'}`}>{i.complementos.map((c) => `+ ${c.nome}`).join('  ')}</span>
        )}
        {i.observacao && (
          <span className="mt-1 block rounded-[3px] bg-[#FEF3C7] px-2 py-1 text-[0.95em] font-semibold text-[#92400E]">⚠ {i.observacao}</span>
        )}
      </button>
    </li>
  )
}
