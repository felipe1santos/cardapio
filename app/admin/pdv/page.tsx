'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  buscarRestauranteIdDoUsuario,
  listarGrupos,
  listarItens,
  type GrupoCardapio,
  type GrupoItemComplementos,
  type ItemCardapio,
} from '@/lib/queries/cardapio'
import type { MesaComEstado } from '@/lib/queries/comandas'
import {
  listarBordasPizza,
  listarMassasPizza,
  listarTamanhosPadraoPizza,
  type BordaPizza,
  type MassaPizza,
  type TamanhoPadraoPizza,
} from '@/lib/queries/pizza'
import { type NovoPedidoItemInput, type Pedido } from '@/lib/queries/pedidos'
import { Button } from '@/components/ui/button'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ComandaLinha {
  uid: string
  item: ItemCardapio
  quantidade: number
  tamanhoNome: string
  saborNome: string
  bordaNome: string
  massaNome: string
  complementos: string[]
  observacao: string
}

interface SeletorState {
  item: ItemCardapio
  /** For pizza: tamanho padrão nome. For simples: tamanhos_item nome. */
  tamanhoNome: string
  saborNome: string
  bordaId: string
  massaId: string
  /** grupoId → selected complement names */
  complementosSelecionados: Record<string, string[]>
  observacao: string
}

/** Formas de pagamento oferecidas no fechamento (UI). */
type FormaPgtoUI = 'dinheiro' | 'pix' | 'debito' | 'credito'

// ─── Utilities ────────────────────────────────────────────────────────────────

function makeUid() {
  return Math.random().toString(36).slice(2)
}

function needsSelector(item: ItemCardapio): boolean {
  if (item.tipoItem === 'pizza') return true
  if (item.tamanhos.length > 0) return true
  if (item.grupos.length > 0) return true
  return false
}

function linhaDescricao(linha: ComandaLinha): string {
  const parts: string[] = []
  if (linha.tamanhoNome) parts.push(linha.tamanhoNome)
  if (linha.saborNome) parts.push(linha.saborNome)
  if (linha.bordaNome) parts.push(`Borda: ${linha.bordaNome}`)
  if (linha.massaNome) parts.push(`Massa: ${linha.massaNome}`)
  if (linha.complementos.length) parts.push(linha.complementos.join(', '))
  if (linha.observacao) parts.push(`Obs: ${linha.observacao}`)
  return parts.join(' · ')
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

/** Tempo desde que a comanda foi aberta (curto, p/ o card da mesa). */
function tempoDecorrido(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h}h${String(min % 60).padStart(2, '0')}`
}

type MesaEstadoVisual = 'livre' | 'aguardando' | 'ocupada'
/** Estado visual da mesa: livre (sem comanda), aguardando (comanda aberta sem pedido),
 * ocupada (comanda aberta com pedidos). */
function mesaEstadoVisual(mesa: MesaComEstado): MesaEstadoVisual {
  if (!mesa.comandaAberta) return 'livre'
  if (mesa.qtdPedidos === 0) return 'aguardando'
  return 'ocupada'
}

// ─── Product Selector Modal ───────────────────────────────────────────────────

function SeletorModal({
  state,
  tamanhosPizza,
  bordasPizza,
  massasPizza,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: SeletorState
  tamanhosPizza: TamanhoPadraoPizza[]
  bordasPizza: BordaPizza[]
  massasPizza: MassaPizza[]
  onChange: (patch: Partial<SeletorState>) => void
  onCancel: () => void
  onConfirm: (result: Omit<ComandaLinha, 'uid' | 'item' | 'quantidade'>) => void
}) {
  const { item } = state
  const isPizza = item.tipoItem === 'pizza'
  const hasSimplesTamanhos = !isPizza && item.tamanhos.length > 0

  // Validate: can confirm?
  const pizzaReady = isPizza ? state.tamanhoNome !== '' && state.saborNome !== '' : true
  const tamanhosReady = hasSimplesTamanhos ? state.tamanhoNome !== '' : true
  const gruposReady = item.grupos
    .filter((g) => g.obrigatorio)
    .every((g) => {
      if (g.complementos.length === 0) return true // grupo obrigatório sem opções não trava o botão
      const sel = state.complementosSelecionados[g.id] ?? []
      return sel.length >= g.minEscolhas
    })
  const canConfirm = pizzaReady && tamanhosReady && gruposReady

  // O que ainda falta selecionar — mostrado quando "Adicionar à comanda" está desabilitado,
  // pra ficar claro por que o item não pode ser adicionado.
  const faltando: string[] = []
  if (isPizza && state.tamanhoNome === '') faltando.push('tamanho')
  if (isPizza && state.saborNome === '') faltando.push('sabor')
  if (hasSimplesTamanhos && state.tamanhoNome === '') faltando.push('tamanho')
  for (const g of item.grupos.filter((x) => x.obrigatorio)) {
    if (g.complementos.length === 0) continue
    const sel = state.complementosSelecionados[g.id] ?? []
    if (sel.length < g.minEscolhas) faltando.push(g.nome)
  }

  function handleGroupToggle(grupo: GrupoItemComplementos, compNome: string) {
    const current = state.complementosSelecionados[grupo.id] ?? []
    let next: string[]
    if (current.includes(compNome)) {
      next = current.filter((n) => n !== compNome)
    } else if (grupo.maxEscolhas === 1) {
      next = [compNome]
    } else if (grupo.maxEscolhas === 0 || current.length < grupo.maxEscolhas) {
      // maxEscolhas 0 = sem limite ("quantos quiser"), igual à vitrine do cliente.
      next = [...current, compNome]
    } else {
      next = current // atingiu o máximo — ignora
    }
    onChange({ complementosSelecionados: { ...state.complementosSelecionados, [grupo.id]: next } })
  }

  function confirm() {
    const bordaPizza = bordasPizza.find((b) => b.id === state.bordaId)
    const massaPizza = massasPizza.find((m) => m.id === state.massaId)
    const complementos: string[] = Object.values(state.complementosSelecionados).flat()
    onConfirm({
      tamanhoNome: state.tamanhoNome,
      saborNome: state.saborNome,
      bordaNome: bordaPizza?.nome ?? '',
      massaNome: massaPizza?.nome ?? '',
      complementos,
      observacao: state.observacao,
    })
  }

  const chipBase = 'rounded-menuzia border px-3 py-1.5 text-[12px] font-semibold transition-colors'
  const chipActive = 'border-primary bg-primary text-white'
  const chipIdle = 'border-border bg-white text-text-main hover:border-primary hover:text-primary'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-menuzia bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Configurar item</p>
            <h2 className="text-[15px] font-bold text-text-main">{item.nome}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-text-subtle transition-colors hover:bg-page hover:text-text-main"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* Pizza — tamanho padrão */}
          {isPizza && tamanhosPizza.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                Tamanho <span className="text-danger">*</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {tamanhosPizza.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onChange({ tamanhoNome: t.nome })}
                    className={[chipBase, state.tamanhoNome === t.nome ? chipActive : chipIdle].join(' ')}
                  >
                    {t.nome}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pizza — sabor */}
          {isPizza && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                Sabor <span className="text-danger">*</span>
              </p>
              <div className="flex flex-col gap-1.5">
                {item.sabores
                  .filter((s) => s.status === 'disponivel')
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onChange({ saborNome: s.nome })}
                      className={[
                        'rounded-menuzia border px-3 py-2 text-left text-[13px] font-medium transition-colors',
                        state.saborNome === s.nome
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border bg-white text-text-main hover:border-primary/50',
                      ].join(' ')}
                    >
                      <span className="font-semibold">{s.nome}</span>
                      {s.descricao && (
                        <span className="block text-[11px] font-normal text-text-subtle">{s.descricao}</span>
                      )}
                    </button>
                  ))}
                {item.sabores.filter((s) => s.status === 'disponivel').length === 0 && (
                  <p className="text-[12px] text-text-subtle">Nenhum sabor disponível.</p>
                )}
              </div>
            </div>
          )}

          {/* Pizza — borda (opcional) */}
          {isPizza && bordasPizza.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                Borda <span className="font-normal text-text-subtle/60">(opcional)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onChange({ bordaId: '' })}
                  className={[chipBase, state.bordaId === '' ? chipActive : chipIdle].join(' ')}
                >
                  Sem borda
                </button>
                {bordasPizza.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onChange({ bordaId: b.id })}
                    className={[chipBase, state.bordaId === b.id ? chipActive : chipIdle].join(' ')}
                  >
                    {b.nome}
                    {b.preco > 0 && <span className="ml-1 text-[11px] font-normal">(+{formatBRL(b.preco)})</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pizza — massa (opcional) */}
          {isPizza && massasPizza.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                Massa <span className="font-normal text-text-subtle/60">(opcional)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onChange({ massaId: '' })}
                  className={[chipBase, state.massaId === '' ? chipActive : chipIdle].join(' ')}
                >
                  Padrão
                </button>
                {massasPizza.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onChange({ massaId: m.id })}
                    className={[chipBase, state.massaId === m.id ? chipActive : chipIdle].join(' ')}
                  >
                    {m.nome}
                    {m.preco > 0 && <span className="ml-1 text-[11px] font-normal">(+{formatBRL(m.preco)})</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Simples/marmita — tamanhos_item */}
          {hasSimplesTamanhos && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                Tamanho <span className="text-danger">*</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {item.tamanhos.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onChange({ tamanhoNome: t.nome })}
                    className={[chipBase, state.tamanhoNome === t.nome ? chipActive : chipIdle].join(' ')}
                  >
                    {t.nome}
                    <span className="ml-1.5 font-normal">{formatBRL(t.preco)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Complement groups */}
          {item.grupos.map((grupo) => {
            const sel = state.complementosSelecionados[grupo.id] ?? []
            return (
              <div key={grupo.id}>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                  {grupo.nome}
                  {grupo.obrigatorio && <span className="ml-1 text-danger">*</span>}
                  <span className="ml-1 font-normal text-text-subtle/60">
                    {grupo.maxEscolhas === 1
                      ? '(escolha 1)'
                      : grupo.maxEscolhas === 0
                        ? '(quantos quiser)'
                        : `(até ${grupo.maxEscolhas})`}
                  </span>
                </p>
                <div className="flex flex-col gap-1.5">
                  {grupo.complementos.map((comp) => {
                    const isSelected = sel.includes(comp.nome)
                    return (
                      <button
                        key={comp.id}
                        type="button"
                        onClick={() => handleGroupToggle(grupo, comp.nome)}
                        className={[
                          'flex items-center justify-between rounded-menuzia border-2 px-3 py-2.5 text-[13px] transition-colors',
                          isSelected
                            ? 'border-primary-dark bg-primary font-semibold text-white'
                            : 'border-border bg-white text-text-main hover:border-primary/40',
                        ].join(' ')}
                      >
                        <span>{comp.nome}</span>
                        {comp.preco > 0 && (
                          <span
                            className={[
                              'text-[12px] font-semibold',
                              isSelected ? 'text-white' : 'text-price-text',
                            ].join(' ')}
                          >
                            +{formatBRL(comp.preco)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Observação */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
              Observação <span className="font-normal text-text-subtle/60">(opcional)</span>
            </p>
            <textarea
              value={state.observacao}
              onChange={(e) => onChange({ observacao: e.target.value })}
              rows={2}
              placeholder="Ex: sem cebola, ponto da carne…"
              className="w-full resize-none rounded-menuzia border border-border bg-white px-3 py-2 text-[13px] text-text-main placeholder:text-text-subtle/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-3">
          {!canConfirm && faltando.length > 0 && (
            <p className="mb-2 text-[11px] font-medium text-status-pending">
              Falta selecionar: {faltando.join(', ')}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onCancel}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={!canConfirm} onClick={confirm}>
              Adicionar à comanda
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal de pagamento / fechamento de conta ──────────────────────────────────

function PagamentoModal({
  pedidos,
  total,
  imagemPorNome,
  localNome,
  emPreparo,
  processando,
  onCancel,
  onReceber,
  onReceberEFechar,
}: {
  pedidos: Pedido[]
  total: number
  imagemPorNome: Map<string, string>
  localNome: string
  emPreparo: boolean
  processando: boolean
  onCancel: () => void
  onReceber: (forma: FormaPgtoUI) => void
  onReceberEFechar: (forma: FormaPgtoUI) => void
}) {
  const [forma, setForma] = useState<FormaPgtoUI | null>(null)
  const [recebido, setRecebido] = useState('')

  const recebidoNum = Number(recebido.replace(/\./g, '').replace(',', '.')) || 0
  const troco = recebidoNum - total

  const linhas = pedidos.flatMap((p) => p.itens.map((i) => ({ ...i, uid: i.id })))

  const formas: { id: FormaPgtoUI; label: string; selBg: string; idle: string; icon: React.ReactNode }[] = [
    {
      id: 'dinheiro',
      label: 'Dinheiro',
      selBg: 'bg-[#16A34A]',
      idle: 'border-[#16A34A]/40 text-[#16A34A]',
      icon: (
        <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current">
          <path d="M2 6h20v12H2V6zm2 2v8h16V8H4zm8 1.5A2.5 2.5 0 0 1 14.5 12 2.5 2.5 0 0 1 12 14.5 2.5 2.5 0 0 1 9.5 12 2.5 2.5 0 0 1 12 9.5zM6 9a2 2 0 0 1-2 2v2a2 2 0 0 1 2 2h12a2 2 0 0 1 2-2v-2a2 2 0 0 1-2-2H6z" />
        </svg>
      ),
    },
    {
      id: 'pix',
      label: 'Pix',
      selBg: 'bg-[#0FB8AD]',
      idle: 'border-[#0FB8AD]/40 text-[#0FB8AD]',
      icon: (
        <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current">
          <path d="M12 2.5 3.5 11l8.5 8.5L20.5 11 12 2.5zm0 2.83L17.67 11 12 16.67 6.33 11 12 5.33z" />
        </svg>
      ),
    },
    {
      id: 'debito',
      label: 'Débito',
      selBg: 'bg-[#0688D4]',
      idle: 'border-[#0688D4]/40 text-[#0688D4]',
      icon: (
        <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current">
          <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z" />
        </svg>
      ),
    },
    {
      id: 'credito',
      label: 'Crédito',
      selBg: 'bg-[#7C3AED]',
      idle: 'border-[#7C3AED]/40 text-[#7C3AED]',
      icon: (
        <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current">
          <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2zM6 15h6v2H6z" />
        </svg>
      ),
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-menuzia bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Fechar conta</p>
            <h2 className="text-[15px] font-bold text-text-main">{localNome}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-text-subtle transition-colors hover:bg-page hover:text-text-main"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {emPreparo && (
            <p className="rounded-menuzia bg-warn-bg px-3 py-2 text-[12px] font-semibold text-warn">
              ⚠ Há pedido ainda em preparo nesta mesa.
            </p>
          )}

          {/* Resumo dos itens */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Resumo</p>
            <ul className="space-y-2">
              {linhas.map((i) => {
                const img = imagemPorNome.get(i.nome)
                return (
                  <li key={i.uid} className="flex items-center gap-3">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={i.nome} className="h-12 w-12 flex-shrink-0 rounded-menuzia bg-page object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-menuzia bg-page text-text-subtle/25">
                        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                        </svg>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-text-main">
                        {i.quantidade}× {i.nome}
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-[13px] font-bold text-text-main">
                      {formatBRL(i.precoUnitario * i.quantidade)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between rounded-menuzia bg-page px-3 py-2.5">
            <span className="text-[14px] font-bold text-text-main">Total</span>
            <span className="text-[18px] font-extrabold text-text-main">{formatBRL(total)}</span>
          </div>

          {/* Forma de pagamento */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Forma de pagamento</p>
            <div className="grid grid-cols-2 gap-2.5">
              {formas.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setForma(f.id)}
                  className={[
                    'flex flex-col items-center justify-center gap-1.5 rounded-menuzia border-2 px-3 py-4 font-bold transition-all active:scale-[0.97]',
                    forma === f.id
                      ? `${f.selBg} border-transparent text-white shadow-md`
                      : `bg-white ${f.idle} hover:shadow-sm`,
                  ].join(' ')}
                >
                  {f.icon}
                  <span className="text-[14px]">{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Dinheiro: valor recebido + troco */}
          {forma === 'dinheiro' && (
            <div className="rounded-menuzia border border-border p-3">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Valor recebido</p>
              <input
                type="text"
                inputMode="decimal"
                value={recebido}
                onChange={(e) => setRecebido(e.target.value)}
                placeholder="Ex: 50,00"
                className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-[16px] font-bold text-text-main placeholder:font-normal placeholder:text-text-subtle/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-text-subtle">Troco</span>
                <span
                  className={[
                    'text-[18px] font-extrabold',
                    recebidoNum === 0 ? 'text-text-subtle/40' : troco < 0 ? 'text-danger' : 'text-price-text',
                  ].join(' ')}
                >
                  {recebidoNum === 0 ? '—' : formatBRL(Math.max(0, troco))}
                </span>
              </div>
              {troco < 0 && recebidoNum > 0 && (
                <p className="mt-1 text-[11px] font-semibold text-danger">
                  Faltam {formatBRL(Math.abs(troco))} para o total.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="space-y-2 border-t border-border px-4 py-3">
          <Button
            className="w-full py-2.5"
            variant="success"
            disabled={!forma || processando}
            onClick={() => forma && onReceberEFechar(forma)}
          >
            {processando ? 'Processando…' : 'Receber e fechar conta'}
          </Button>
          <button
            type="button"
            disabled={!forma || processando}
            onClick={() => forma && onReceber(forma)}
            className="w-full rounded-menuzia border-2 border-primary py-2 text-[12px] font-bold uppercase tracking-wide text-primary transition-colors hover:bg-primary hover:text-white disabled:opacity-40"
          >
            Receber (manter mesa aberta)
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── PDV Page ─────────────────────────────────────────────────────────────────

export default function PdvPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const router = useRouter()

  // ── Data ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [itens, setItens] = useState<ItemCardapio[]>([])
  const [grupos, setGrupos] = useState<GrupoCardapio[]>([])
  const [mesasEstado, setMesasEstado] = useState<MesaComEstado[]>([])
  const [tamanhosPizza, setTamanhosPizza] = useState<TamanhoPadraoPizza[]>([])
  const [bordasPizza, setBordasPizza] = useState<BordaPizza[]>([])
  const [massasPizza, setMassasPizza] = useState<MassaPizza[]>([])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)

  // ── Mesa / cliente ─────────────────────────────────────────────────────────
  const [mesaSelecionada, setMesaSelecionada] = useState<MesaComEstado | null>(null)
  // Ref kept in sync so the realtime callback can read the current mesa
  // without being listed in the channel effect's deps (avoids re-subscribing on every mesa click).
  const mesaSelecionadaRef = useRef<MesaComEstado | null>(null)
  useEffect(() => { mesaSelecionadaRef.current = mesaSelecionada }, [mesaSelecionada])
  const [mesaEscolhida, setMesaEscolhida] = useState(false)
  const [nomeCliente, setNomeCliente] = useState('')

  // ── Cardápio filters ───────────────────────────────────────────────────────
  const [busca, setBusca] = useState('')
  const [grupoFiltro, setGrupoFiltro] = useState<string | null>(null)

  // ── Comanda da mesa (pedidos já lançados) ─────────────────────────────────
  const [pedidosComanda, setPedidosComanda] = useState<Pedido[]>([])
  const [carregandoComanda, setCarregandoComanda] = useState(false)
  const [fechando, setFechando] = useState(false)
  const [pagamentoAberto, setPagamentoAberto] = useState(false)
  const [mesaAcao, setMesaAcao] = useState<MesaComEstado | null>(null) // chooser ao clicar na mesa
  const [pedidosModalAberto, setPedidosModalAberto] = useState(false)
  const [sairConfirm, setSairConfirm] = useState(false)

  // ── Comanda em montagem ────────────────────────────────────────────────────
  const [comanda, setComanda] = useState<ComandaLinha[]>([])

  // ── Selector modal ────────────────────────────────────────────────────────
  const [seletor, setSeletor] = useState<SeletorState | null>(null)

  // ── Launch ────────────────────────────────────────────────────────────────
  const [launching, setLaunching] = useState(false)
  const [launchMsg, setLaunchMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // ── Mobile tab ────────────────────────────────────────────────────────────
  const [mobileTab, setMobileTab] = useState<'cardapio' | 'comanda'>('cardapio')

  // ── Painel de mesas vs. atendimento ────────────────────────────────────────
  // true = mostra o painel com todas as mesas; false = mesa aberta (cardápio + comanda).
  const [painelMesas, setPainelMesas] = useState(true)

  // ── Tela cheia do navegador (Fullscreen API) ────────────────────────────────
  const [telaCheia, setTelaCheia] = useState(false)
  useEffect(() => {
    const onChange = () => setTelaCheia(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  async function alternarTelaCheia() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
      else await document.exitFullscreen()
    } catch {
      /* o navegador pode bloquear o fullscreen — ignora silenciosamente */
    }
  }

  // ── Fetch mesas com estado de ocupação ────────────────────────────────────
  const recarregarMesas = useCallback(async () => {
    const res = await fetch('/api/admin/pdv/comanda')
    if (!res.ok) return
    const data = (await res.json()) as { mesas: MesaComEstado[] }
    setMesasEstado(data.mesas)
  }, [])

  // ── Focus mode: hide sidebar while PDV is open ────────────────────────────
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('menuzia:focus-mode', { detail: true }))
    return () => {
      window.dispatchEvent(new CustomEvent('menuzia:focus-mode', { detail: false }))
    }
  }, [])

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const rid = await buscarRestauranteIdDoUsuario(supabase)
        if (!rid || cancelled) return

        const [itensData, gruposData, tamanhosData, bordasData, massasData] = await Promise.all([
          listarItens(supabase, rid),
          listarGrupos(supabase, rid),
          listarTamanhosPadraoPizza(supabase, rid),
          listarBordasPizza(supabase, rid),
          listarMassasPizza(supabase, rid),
        ])
        if (cancelled) return

        setItens(itensData.filter((i) => i.status === 'disponivel'))
        setGrupos(gruposData)
        setTamanhosPizza(tamanhosData)
        setBordasPizza(bordasData)
        setMassasPizza(massasData)
        setRestauranteId(rid)
        await recarregarMesas()
      } catch {
        if (!cancelled) setLoadError('Não foi possível carregar os dados. Recarregue a página.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [supabase, recarregarMesas])

  // ── Fetch pedidos da comanda aberta ───────────────────────────────────────
  const recarregarComanda = useCallback(async (comandaId: string) => {
    setCarregandoComanda(true)
    try {
      const res = await fetch(`/api/admin/pdv/comanda?comandaId=${comandaId}`)
      if (!res.ok) return
      const data = (await res.json()) as { pedidos: Pedido[] }
      setPedidosComanda(data.pedidos)
    } finally {
      setCarregandoComanda(false)
    }
  }, [])

  // Carrega pedidos ao selecionar mesa ocupada
  useEffect(() => {
    const comandaId = mesaSelecionada?.comandaAberta?.id
    if (comandaId) {
      void recarregarComanda(comandaId)
    } else {
      setPedidosComanda([])
    }
  }, [mesaSelecionada, recarregarComanda])

  // ── Realtime: atualizar estado ao mudar pedidos ────────────────────────────
  useEffect(() => {
    if (!restauranteId) return
    const channel = supabase
      .channel(`pdv-comandas-${restauranteId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos', filter: `restaurante_id=eq.${restauranteId}` },
        () => {
          void recarregarMesas()
          const comandaId = mesaSelecionadaRef.current?.comandaAberta?.id
          if (comandaId) void recarregarComanda(comandaId)
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, recarregarMesas, recarregarComanda, restauranteId])

  // ── Filtered items ─────────────────────────────────────────────────────────
  const itensFiltrados = useMemo(() => {
    let list = itens
    if (grupoFiltro) list = list.filter((i) => i.grupoId === grupoFiltro)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      list = list.filter((i) => i.nome.toLowerCase().includes(q) || i.descricao.toLowerCase().includes(q))
    }
    return list
  }, [itens, grupoFiltro, busca])

  // Mapa nome do item → imagem, p/ exibir miniatura no resumo de pagamento
  // (o snapshot do pedido não guarda a imagem; buscamos pelo nome no cardápio atual).
  const imagemPorNome = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of itens) if (i.imagemUrl) m.set(i.nome, i.imagemUrl)
    return m
  }, [itens])

  // ── Mesa selection ─────────────────────────────────────────────────────────
  function selecionarMesa(mesa: MesaComEstado | null) {
    setMesaSelecionada(mesa)
    setMesaEscolhida(true)
    setPainelMesas(false)
    setComanda([]) // novo atendimento começa com a comanda de montagem vazia
    setLaunchMsg(null)
    setMobileTab('cardapio')
  }

  function voltarParaMesas() {
    setPainelMesas(true)
    setLaunchMsg(null)
    void recarregarMesas()
  }

  // Clique no quadrado da mesa: se ocupada, abre o chooser (ver pedidos / novo pedido);
  // se livre, vai direto cadastrar um novo pedido.
  function clicarMesa(mesa: MesaComEstado) {
    if (mesa.comandaAberta) setMesaAcao(mesa)
    else selecionarMesa(mesa)
  }

  function acaoVerPedidos() {
    if (!mesaAcao) return
    const m = mesaAcao
    setMesaSelecionada(m)
    setMesaEscolhida(true)
    setMesaAcao(null)
    setPedidosModalAberto(true)
    if (m.comandaAberta) void recarregarComanda(m.comandaAberta.id)
  }

  function acaoNovoPedido() {
    if (!mesaAcao) return
    const m = mesaAcao
    setMesaAcao(null)
    selecionarMesa(m)
  }

  function sairDoPdv() {
    setSairConfirm(false)
    router.push('/admin/dashboard')
  }

  // ── Add item to comanda ────────────────────────────────────────────────────
  function addItem(item: ItemCardapio) {
    if (needsSelector(item)) {
      setSeletor({
        item,
        tamanhoNome: '',
        saborNome: '',
        bordaId: '',
        massaId: '',
        complementosSelecionados: {},
        observacao: '',
      })
      return
    }
    // No selector needed — add or increment
    setComanda((prev) => {
      const existing = prev.find(
        (l) => l.item.id === item.id && !l.tamanhoNome && !l.saborNome && l.complementos.length === 0
      )
      if (existing) {
        return prev.map((l) => (l.uid === existing.uid ? { ...l, quantidade: l.quantidade + 1 } : l))
      }
      return [
        ...prev,
        {
          uid: makeUid(),
          item,
          quantidade: 1,
          tamanhoNome: '',
          saborNome: '',
          bordaNome: '',
          massaNome: '',
          complementos: [],
          observacao: '',
        },
      ]
    })
  }

  function confirmarSeletor(result: Omit<ComandaLinha, 'uid' | 'item' | 'quantidade'>) {
    if (!seletor) return
    setComanda((prev) => [...prev, { uid: makeUid(), item: seletor.item, quantidade: 1, ...result }])
    setSeletor(null)
  }

  function alterarQtd(uidTarget: string, delta: number) {
    setComanda((prev) =>
      prev
        .map((l) => (l.uid === uidTarget ? { ...l, quantidade: l.quantidade + delta } : l))
        .filter((l) => l.quantidade > 0)
    )
  }

  function removerLinha(uidTarget: string) {
    setComanda((prev) => prev.filter((l) => l.uid !== uidTarget))
  }

  // ── Cancelar pedido da comanda ─────────────────────────────────────────────
  async function cancelarPedido(pedidoId: string) {
    if (!confirm('Cancelar este pedido? Ele some da cozinha e sai da conta.')) return
    const res = await fetch(`/api/admin/pdv/pedido/${pedidoId}/cancelar`, { method: 'POST' })
    if (res.ok) {
      const comandaId = mesaSelecionada?.comandaAberta?.id
      if (comandaId) await recarregarComanda(comandaId)
      await recarregarMesas()
    }
  }

  // ── Fechar conta da mesa ───────────────────────────────────────────────────
  // Limpa o estado e volta ao painel após fechar a conta.
  function resetPosFechar() {
    setPagamentoAberto(false)
    setPedidosModalAberto(false)
    setPedidosComanda([])
    setMesaSelecionada(null)
    setMesaEscolhida(false)
    setComanda([])
    setPainelMesas(true)
  }

  // Recebe o pagamento (marca todos os pedidos da comanda como pagos). Se fechar=true,
  // também fecha a conta e libera a mesa; senão mantém a mesa aberta (cliente pagou
  // antecipado e continua na mesa). Pagamento é obrigatório antes de fechar.
  async function processarPagamento(fechar: boolean) {
    const comandaId = mesaSelecionada?.comandaAberta?.id
    if (!comandaId || fechando) return
    setFechando(true)
    try {
      await fetch(`/api/admin/pdv/comanda/${comandaId}/pagar`, { method: 'POST' })
      if (fechar) {
        const res = await fetch(`/api/admin/pdv/comanda/${comandaId}/fechar`, { method: 'POST' })
        if (res.ok) {
          resetPosFechar()
          await recarregarMesas()
        }
      } else {
        setPagamentoAberto(false)
        await recarregarMesas()
        await recarregarComanda(comandaId)
      }
    } finally {
      setFechando(false)
    }
  }

  // Fecha a conta quando tudo já está pago (sem passar pelo modal de pagamento).
  async function fecharContaPaga() {
    const comandaId = mesaSelecionada?.comandaAberta?.id
    if (!comandaId || fechando) return
    setFechando(true)
    try {
      const res = await fetch(`/api/admin/pdv/comanda/${comandaId}/fechar`, { method: 'POST' })
      if (res.ok) {
        resetPosFechar()
        await recarregarMesas()
      }
    } finally {
      setFechando(false)
    }
  }

  // ── Launch ─────────────────────────────────────────────────────────────────
  async function lancarNaCozinha() {
    if (!mesaEscolhida || comanda.length === 0 || launching) return
    setLaunching(true)
    setLaunchMsg(null)

    const itensBody: NovoPedidoItemInput[] = comanda.map((linha) => ({
      itemId: linha.item.id,
      quantidade: linha.quantidade,
      observacao: linha.observacao,
      complementos: linha.complementos,
      tamanhoNome: linha.tamanhoNome || undefined,
      saborNome: linha.saborNome || undefined,
      bordaNome: linha.bordaNome || undefined,
      massaNome: linha.massaNome || undefined,
    }))

    const body = {
      tipo: 'retirada' as const,
      origem: 'pdv' as const,
      mesa: mesaSelecionada?.nome,
      mesaId: mesaSelecionada?.id,
      cliente: { nome: nomeCliente.trim() || 'Cliente Balcão', telefone: '' },
      endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
      pagamento: 'dinheiro' as const,
      trocoPara: null,
      itens: itensBody,
    }

    try {
      const res = await fetch('/api/admin/pdv/pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { id?: string; numero?: number; error?: string }
      if (res.status === 201 && data.numero) {
        const local = mesaSelecionada?.nome ?? 'Balcão'
        const mesaIdAntes = mesaSelecionada?.id
        setComanda([])
        setNomeCliente('')
        setLaunchMsg({ type: 'ok', text: `Pedido #${data.numero} lançado em ${local}!` })
        // Recarregar mesas + re-selecionar a mesa atualizada (agora ocupada)
        const atualizadas = await fetch('/api/admin/pdv/comanda')
          .then((r) => r.json() as Promise<{ mesas: MesaComEstado[] }>)
          .catch(() => null)
        setMesasEstado(atualizadas?.mesas ?? [])
        if (mesaIdAntes && atualizadas?.mesas) {
          const nova = atualizadas.mesas.find((m) => m.id === mesaIdAntes)
          if (nova) {
            setMesaSelecionada(nova)
            if (nova.comandaAberta) await recarregarComanda(nova.comandaAberta.id)
          }
        }
      } else {
        setLaunchMsg({ type: 'err', text: data.error ?? 'Erro ao lançar pedido.' })
      }
    } catch {
      setLaunchMsg({ type: 'err', text: 'Erro de conexão. Tente novamente.' })
    } finally {
      setLaunching(false)
    }
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  const totalConta = pedidosComanda
    .filter((p) => p.status !== 'cancelado')
    .reduce((s, p) => s + p.total, 0)

  const subtotal = comanda.reduce((s, l) => {
    // Use base price as reference; server recalculates the real total
    return s + (l.item.promocaoPreco ?? l.item.preco) * l.quantidade
  }, 0)

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-page">
        <div className="text-center">
          <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-[3px] border-border border-t-primary" />
          <p className="text-[13px] text-text-subtle">Carregando PDV…</p>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center bg-page p-6">
        <div className="w-full max-w-xs rounded-menuzia border border-danger-bg bg-white p-6 text-center">
          <p className="text-[14px] text-danger">{loadError}</p>
          <Button className="mt-4 w-full" onClick={() => window.location.reload()}>
            Recarregar
          </Button>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const botaoTelaCheia = (
    <button
      type="button"
      onClick={() => void alternarTelaCheia()}
      title="Tela cheia (também: tecla F11)"
      className="flex flex-shrink-0 items-center gap-1.5 rounded-menuzia border border-border bg-white px-2.5 py-1.5 text-[12px] font-semibold text-text-main transition-colors hover:border-primary hover:text-primary"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
        {telaCheia ? (
          <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
        ) : (
          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
        )}
      </svg>
      {telaCheia ? 'Sair da tela cheia' : 'Tela cheia'}
    </button>
  )

  const botaoSair = (
    <button
      type="button"
      onClick={() => setSairConfirm(true)}
      title="Sair do PDV e voltar ao menu principal"
      className="flex flex-shrink-0 items-center gap-1.5 rounded-menuzia border border-danger/40 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-danger transition-colors hover:bg-danger hover:text-white"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
        <path d="M16 13v-2H7V8l-5 4 5 4v-3h9zM20 3h-9a2 2 0 0 0-2 2v4h2V5h9v14h-9v-4H9v4a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
      </svg>
      Sair
    </button>
  )

  return (
    <>
      {/* Product selector modal */}
      {seletor && (
        <SeletorModal
          state={seletor}
          tamanhosPizza={tamanhosPizza}
          bordasPizza={bordasPizza}
          massasPizza={massasPizza}
          onChange={(patch) => setSeletor((prev) => (prev ? { ...prev, ...patch } : prev))}
          onCancel={() => setSeletor(null)}
          onConfirm={confirmarSeletor}
        />
      )}

      {/* Payment / close-table modal */}
      {pagamentoAberto && mesaSelecionada?.comandaAberta && (
        <PagamentoModal
          pedidos={pedidosComanda.filter((p) => p.status !== 'cancelado')}
          total={totalConta}
          imagemPorNome={imagemPorNome}
          localNome={mesaSelecionada?.nome ?? 'Mesa'}
          emPreparo={pedidosComanda.some((p) => p.status === 'preparando' || p.status === 'recebido')}
          processando={fechando}
          onCancel={() => setPagamentoAberto(false)}
          onReceber={() => void processarPagamento(false)}
          onReceberEFechar={() => void processarPagamento(true)}
        />
      )}

      {/* Chooser ao clicar numa mesa ocupada: ver pedidos ou novo pedido */}
      {mesaAcao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-menuzia bg-white p-5 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[16px] font-bold text-text-main">{mesaAcao.nome}</h2>
              <button
                type="button"
                onClick={() => setMesaAcao(null)}
                className="rounded p-1 text-text-subtle transition-colors hover:bg-page hover:text-text-main"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>
            <p className="mb-4 text-[12px] text-text-subtle">
              {formatBRL(mesaAcao.total)} · {mesaAcao.qtdPedidos} pedido(s) em aberto
            </p>
            <div className="grid grid-cols-1 gap-2.5">
              <button
                type="button"
                onClick={acaoVerPedidos}
                className="flex items-center gap-3 rounded-menuzia border-2 border-primary bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10"
              >
                <svg viewBox="0 0 24 24" className="h-7 w-7 flex-shrink-0 fill-primary">
                  <path d="M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h18v2H3v-2z" />
                </svg>
                <div>
                  <p className="text-[14px] font-bold text-primary">Ver pedidos</p>
                  <p className="text-[11px] text-text-subtle">Itens lançados · pagar e fechar a conta</p>
                </div>
              </button>
              <button
                type="button"
                onClick={acaoNovoPedido}
                className="flex items-center gap-3 rounded-menuzia border-2 border-status-ready bg-status-ready/5 px-4 py-3 text-left transition-colors hover:bg-status-ready/10"
              >
                <svg viewBox="0 0 24 24" className="h-7 w-7 flex-shrink-0 fill-status-ready">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                </svg>
                <div>
                  <p className="text-[14px] font-bold text-status-ready">Cadastrar novo pedido</p>
                  <p className="text-[11px] text-text-subtle">Adicionar mais itens à mesa</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: pedidos lançados da mesa (ver pedidos) */}
      {pedidosModalAberto && mesaSelecionada && (() => {
        const naoCancelados = pedidosComanda.filter((p) => p.status !== 'cancelado')
        const tudoPago = naoCancelados.length > 0 && naoCancelados.every((p) => p.pago)
        const statusInfo: Record<string, { label: string; cls: string }> = {
          recebido: { label: 'Recebido', cls: 'bg-status-pending/15 text-status-pending' },
          preparando: { label: 'Preparando', cls: 'bg-status-preparing/15 text-status-preparing' },
          pronto: { label: 'Pronto', cls: 'bg-status-ready/15 text-status-ready' },
          em_rota: { label: 'Saiu', cls: 'bg-primary/15 text-primary' },
          entregue: { label: 'Entregue', cls: 'bg-status-ready/15 text-status-ready' },
        }
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-menuzia bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pedidos da mesa</p>
                  <h2 className="text-[15px] font-bold text-text-main">{mesaSelecionada.nome}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setPedidosModalAberto(false)}
                  className="rounded p-1 text-text-subtle transition-colors hover:bg-page hover:text-text-main"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {carregandoComanda ? (
                  <p className="text-[12px] text-text-subtle/60">Carregando…</p>
                ) : naoCancelados.length === 0 ? (
                  <p className="py-8 text-center text-[13px] text-text-subtle">Nenhum pedido lançado ainda.</p>
                ) : (
                  naoCancelados.map((p) => {
                    const st = statusInfo[p.status] ?? { label: p.status, cls: 'bg-page text-text-subtle' }
                    return (
                      <div key={p.id} className="rounded-menuzia border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-bold text-text-main">Pedido #{p.numero}</span>
                            <span className={['rounded-menuzia px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide', st.cls].join(' ')}>
                              {st.label}
                            </span>
                            <span
                              className={[
                                'rounded-menuzia px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                                p.pago ? 'bg-price-bg text-price-text' : 'bg-warn-bg text-warn',
                              ].join(' ')}
                            >
                              {p.pago ? 'Pago' : 'A receber'}
                            </span>
                          </div>
                          <span className="text-[13px] font-bold text-text-main">{formatBRL(p.total)}</span>
                        </div>
                        <ul className="mt-1.5 space-y-0.5">
                          {p.itens.map((i) => (
                            <li key={i.id} className="flex items-center justify-between gap-2 text-[12px]">
                              <span className="truncate text-text-subtle">{i.quantidade}× {i.nome}</span>
                              <span className="flex-shrink-0 text-text-main/80">{formatBRL(i.precoUnitario * i.quantidade)}</span>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() => void cancelarPedido(p.id)}
                          className="mt-1.5 text-[11px] font-semibold text-danger hover:underline"
                        >
                          Cancelar pedido
                        </button>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
                <span className="text-[13px] font-bold text-text-main">Total da conta</span>
                <span className="text-[18px] font-extrabold text-text-main">{formatBRL(totalConta)}</span>
              </div>

              <div className="space-y-2 border-t border-border px-4 py-3">
                <Button
                  variant="secondary"
                  className="w-full py-2.5"
                  onClick={() => {
                    setPedidosModalAberto(false)
                    selecionarMesa(mesaSelecionada)
                  }}
                >
                  + Adicionar itens
                </Button>
                {tudoPago ? (
                  <Button
                    variant="success"
                    className="w-full py-2.5"
                    disabled={fechando}
                    onClick={() => void fecharContaPaga()}
                  >
                    {fechando ? 'Fechando…' : 'Fechar conta'}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    className="w-full py-2.5"
                    disabled={naoCancelados.length === 0}
                    onClick={() => {
                      setPedidosModalAberto(false)
                      setPagamentoAberto(true)
                    }}
                  >
                    Receber pagamento
                  </Button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Confirmação de saída do PDV */}
      {sairConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xs rounded-menuzia bg-[#111827] p-5 text-center text-white shadow-xl">
            <p className="text-[15px] font-bold">Tem certeza que quer sair do sistema?</p>
            <p className="mt-1 text-[12px] text-white/60">Você voltará ao menu principal.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setSairConfirm(false)}
                className="flex-1 rounded-menuzia border border-white/20 py-2 text-[13px] font-semibold text-white/80 transition-colors hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={sairDoPdv}
                className="flex-1 rounded-menuzia bg-danger py-2 text-[13px] font-bold text-white transition-colors hover:brightness-110"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )}


      <div className="flex h-full flex-col overflow-hidden bg-page">
        {painelMesas ? (
          /* ═══ Painel de mesas ═══ */
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-[18px] font-bold text-text-main">Mesas</h1>
              <div className="flex flex-wrap items-center gap-4">
                {([
                  ['bg-status-ready', 'Livre'],
                  ['bg-primary', 'Ocupada'],
                  ['bg-status-pending', 'Aguardando'],
                ] as const).map(([cor, lbl]) => (
                  <span key={lbl} className="flex items-center gap-1.5">
                    <span className={['h-3 w-3 rounded-full', cor].join(' ')} />
                    <span className="text-[11px] font-semibold text-text-subtle">{lbl}</span>
                  </span>
                ))}
                {botaoTelaCheia}
                {botaoSair}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {/* Balcão — venda avulsa */}
              <button
                type="button"
                onClick={() => selecionarMesa(null)}
                className="flex aspect-square flex-col justify-between rounded-menuzia bg-sidebar-bg p-3 text-left text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.97]"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-white/60">Avulso</span>
                <div>
                  <span className="block text-[20px] font-bold leading-none">Balcão</span>
                  <span className="mt-1 block text-[11px] text-white/70">Venda rápida</span>
                </div>
              </button>

              {mesasEstado.map((mesa) => {
                const estado = mesaEstadoVisual(mesa)
                const cor = { livre: 'bg-status-ready', aguardando: 'bg-status-pending', ocupada: 'bg-primary' }[estado]
                const labelEstado = { livre: 'Livre', aguardando: 'Aguardando', ocupada: 'Ocupada' }[estado]
                return (
                  <button
                    key={mesa.id}
                    type="button"
                    onClick={() => clicarMesa(mesa)}
                    className={[
                      'flex aspect-square flex-col justify-between rounded-menuzia p-3 text-left text-white shadow-sm transition-all hover:brightness-105 active:scale-[0.97]',
                      cor,
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-white/80">{labelEstado}</span>
                      {mesa.comandaAberta && (
                        <span className="text-[10px] font-medium text-white/75">
                          {tempoDecorrido(mesa.comandaAberta.abertaEm)}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="block text-[24px] font-extrabold leading-none">{mesa.nome}</span>
                      {mesa.comandaAberta ? (
                        <span className="mt-1.5 block text-[13px] font-bold text-white/95">
                          {formatBRL(mesa.total)} · {mesa.qtdPedidos} ped
                        </span>
                      ) : (
                        <span className="mt-1.5 block text-[11px] text-white/75">Toque p/ abrir</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {mesasEstado.length === 0 && (
              <p className="mt-6 text-center text-[13px] text-text-subtle">
                Nenhuma mesa cadastrada. Cadastre em{' '}
                <span className="font-semibold text-text-main">Ajustes → Mesas</span>, ou use o{' '}
                <span className="font-semibold text-text-main">Balcão</span> acima.
              </p>
            )}
          </div>
        ) : (
          /* ═══ Atendimento: cardápio + comanda ═══ */
          <>
            {/* Mobile tab bar */}
            <div className="flex border-b border-border bg-white lg:hidden">
              {(['cardapio', 'comanda'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setMobileTab(tab)}
                  className={[
                    'flex-1 py-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                    mobileTab === tab
                      ? 'border-b-2 border-primary text-primary'
                      : 'text-text-subtle hover:text-text-main',
                  ].join(' ')}
                >
                  {tab === 'cardapio'
                    ? 'Cardápio'
                    : `Comanda${comanda.length > 0 ? ` (${comanda.length})` : ''}`}
                </button>
              ))}
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* ── Cardápio ─────────────────────────────────────────────────── */}
              <section
                className={[
                  'flex flex-col overflow-hidden lg:flex-1',
                  mobileTab === 'cardapio' ? 'flex flex-1' : 'hidden lg:flex',
                ].join(' ')}
              >
                {/* Voltar ao painel + local atual */}
                <div className="flex items-center gap-2 border-b border-border bg-white px-3 py-2">
                  <button
                    type="button"
                    onClick={voltarParaMesas}
                    className="flex items-center gap-1.5 rounded-menuzia border-2 border-primary bg-primary px-4 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-primary-dark active:scale-[0.97]"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                    </svg>
                    Mesas
                  </button>
                  <span className="text-[14px] font-bold text-text-main">{mesaSelecionada?.nome ?? 'Balcão'}</span>
                  <div className="ml-auto flex items-center gap-2">{botaoTelaCheia}{botaoSair}</div>
                </div>
            {/* Search + category chips */}
            <div className="border-b border-border bg-white px-3 py-2.5 space-y-2">
              <input
                type="text"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value)
                  setGrupoFiltro(null)
                }}
                placeholder="Buscar item…"
                className="w-full rounded-menuzia border border-border bg-white px-3 py-1.5 text-[13px] text-text-main placeholder:text-text-subtle/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => { setGrupoFiltro(null); setBusca('') }}
                  className={[
                    'flex-shrink-0 rounded-menuzia border px-4 py-2.5 text-[13px] font-semibold transition-colors',
                    grupoFiltro === null && !busca
                      ? 'border-primary bg-primary text-white'
                      : 'border-border bg-white text-text-subtle hover:border-primary hover:text-primary',
                  ].join(' ')}
                >
                  Todos
                </button>
                {grupos.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { setGrupoFiltro(g.id); setBusca('') }}
                    className={[
                      'flex-shrink-0 rounded-menuzia border px-4 py-2.5 text-[13px] font-semibold transition-colors',
                      grupoFiltro === g.id
                        ? 'border-primary bg-primary text-white'
                        : 'border-border bg-white text-text-subtle hover:border-primary hover:text-primary',
                    ].join(' ')}
                  >
                    {g.nome}
                  </button>
                ))}
              </div>
            </div>

            {/* Items grid */}
            <div className="flex-1 overflow-y-auto p-3">
              {itensFiltrados.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-text-subtle">
                  {busca || grupoFiltro ? 'Nenhum item encontrado.' : 'Cardápio vazio.'}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  {itensFiltrados.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addItem(item)}
                      className="group flex flex-col overflow-hidden rounded-menuzia border border-border bg-white text-left transition-all hover:border-primary hover:shadow-md active:scale-[0.98]"
                    >
                      {item.imagemUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imagemUrl}
                          alt={item.nome}
                          className="aspect-[4/3] w-full object-cover object-center"
                        />
                      ) : (
                        <div className="flex aspect-[4/3] w-full items-center justify-center bg-page text-text-subtle/25">
                          <svg viewBox="0 0 24 24" className="h-12 w-12 fill-current">
                            <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                          </svg>
                        </div>
                      )}
                      <div className="flex flex-1 flex-col p-3">
                        <p className="line-clamp-2 text-[14px] font-semibold leading-tight text-text-main group-hover:text-primary">
                          {item.nome}
                        </p>
                        {item.descricao && (
                          <p className="mt-1 line-clamp-1 text-[12px] leading-tight text-text-subtle">
                            {item.descricao}
                          </p>
                        )}
                        <div className="mt-auto flex items-center justify-between pt-2">
                          <span
                            className={
                              item.promocaoPreco !== null
                                ? 'text-[15px] font-bold text-price-text'
                                : 'text-[15px] font-bold text-text-main'
                            }
                          >
                            {item.tamanhos.length > 0 && !item.promocaoPreco ? 'a partir de ' : ''}
                            {formatBRL(item.promocaoPreco ?? item.preco)}
                          </span>
                          {(item.tipoItem === 'pizza' || item.tamanhos.length > 0 || item.grupos.some((g) => g.obrigatorio)) && (
                            <span className="rounded-menuzia bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              config
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ── Column 3: Comanda ───────────────────────────────────────────── */}
          <aside
            className={[
              'flex flex-col border-l border-border bg-white lg:w-[300px] lg:flex-shrink-0',
              mobileTab === 'comanda' ? 'flex flex-1' : 'hidden lg:flex',
            ].join(' ')}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">Comanda</p>
              <span className="text-[11px] font-semibold text-primary">
                {mesaSelecionada?.nome ?? 'Balcão'}
              </span>
            </div>

            {/* Cliente (opcional) */}
            <div className="border-b border-border px-3 py-2">
              <input
                type="text"
                value={nomeCliente}
                onChange={(e) => setNomeCliente(e.target.value)}
                placeholder="Nome do cliente (opcional)"
                className="w-full rounded-menuzia border border-border bg-white px-2.5 py-1.5 text-[13px] text-text-main placeholder:text-text-subtle/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Launch feedback */}
            {launchMsg && (
              <div
                className={[
                  'mx-3 mt-3 rounded-menuzia px-3 py-2 text-[12px] font-semibold',
                  launchMsg.type === 'ok' ? 'bg-price-bg text-price-text' : 'bg-danger-bg text-danger',
                ].join(' ')}
              >
                {launchMsg.text}
              </div>
            )}

            {/* Conta da mesa — pedidos já lançados */}
            {mesaSelecionada?.comandaAberta && (
              <div className="border-b border-border">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">Conta da mesa</p>
                  <span className="text-[12px] font-bold text-text-main">{formatBRL(totalConta)}</span>
                </div>
                {carregandoComanda ? (
                  <p className="px-3 pb-2.5 text-[11px] text-text-subtle/60">Carregando…</p>
                ) : (
                  <ul className="max-h-52 divide-y divide-border overflow-y-auto">
                    {pedidosComanda.map((p) => {
                      const cancelado = p.status === 'cancelado'
                      return (
                        <li
                          key={p.id}
                          className={['px-3 py-2', cancelado ? 'opacity-50' : ''].join(' ')}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={[
                                'text-[12px] font-semibold text-text-main',
                                cancelado ? 'line-through' : '',
                              ].join(' ')}
                            >
                              Pedido #{p.numero}
                            </span>
                            <span
                              className={[
                                'text-[12px] font-semibold text-text-main',
                                cancelado ? 'line-through' : '',
                              ].join(' ')}
                            >
                              {formatBRL(p.total)}
                            </span>
                          </div>
                          {!cancelado && (
                            <span
                              className={[
                                'mt-1 inline-block rounded-menuzia px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                                p.pago ? 'bg-price-bg text-price-text' : 'bg-warn-bg text-warn',
                              ].join(' ')}
                            >
                              {p.pago ? 'Pago' : 'A receber'}
                            </span>
                          )}
                          <ul className="mt-1 space-y-0.5">
                            {p.itens.map((i) => (
                              <li key={i.id} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="truncate text-text-subtle">
                                  {i.quantidade}× {i.nome}
                                </span>
                                <span className="flex-shrink-0 font-semibold text-text-main/80">
                                  {formatBRL(i.precoUnitario * i.quantidade)}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {!cancelado && (
                            <button
                              type="button"
                              onClick={() => void cancelarPedido(p.id)}
                              className="mt-1 text-[11px] font-semibold text-danger hover:underline"
                            >
                              Cancelar pedido
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div className="p-3">
                  <Button
                    variant="primary"
                    className="w-full py-2.5"
                    disabled={!mesaSelecionada?.comandaAberta || fechando}
                    onClick={() => setPagamentoAberto(true)}
                  >
                    Ir para pagamento
                  </Button>
                </div>
              </div>
            )}

            {/* Order lines */}
            <div className="flex-1 overflow-y-auto">
              {comanda.length === 0 ? (
                <div className="flex h-full items-center justify-center p-6 text-center">
                  <div>
                    <svg viewBox="0 0 24 24" className="mx-auto mb-3 h-8 w-8 fill-text-subtle/30">
                      <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 14.9V17H9v2h6v-2h-2v-2.1a5.01 5.01 0 0 0 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zm-15 3V7h2v3.82C4.84 10.4 4 9.3 4 8zm7 5c-1.65 0-3-1.35-3-3V5h6v5c0 1.65-1.35 3-3 3zm8-5c0 1.3-.84 2.4-2 2.82V7h2v1z" />
                    </svg>
                    <p className="text-[13px] font-medium text-text-subtle">Comanda vazia</p>
                    <p className="mt-0.5 text-[11px] text-text-subtle/60">Toque nos itens do cardápio.</p>
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {comanda.map((linha) => {
                    const descricao = linhaDescricao(linha)
                    const precoRef = (linha.item.promocaoPreco ?? linha.item.preco) * linha.quantidade
                    return (
                      <li key={linha.uid} className="flex gap-2.5 px-3 py-3">
                        {linha.item.imagemUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={linha.item.imagemUrl}
                            alt={linha.item.nome}
                            className="h-14 w-14 flex-shrink-0 rounded-menuzia bg-page object-contain"
                          />
                        ) : (
                          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-menuzia bg-page text-text-subtle/25">
                            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                            </svg>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[13px] font-semibold leading-tight text-text-main">
                              {linha.item.nome}
                            </p>
                            <span className="flex-shrink-0 text-[13px] font-bold text-text-main">
                              {formatBRL(precoRef)}
                            </span>
                          </div>
                          {descricao && (
                            <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-text-subtle">
                              {descricao}
                            </p>
                          )}
                          <div className="mt-2 flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label="Diminuir quantidade"
                              onClick={() => alterarQtd(linha.uid, -1)}
                              className="flex h-8 w-8 items-center justify-center rounded-menuzia border border-border text-text-subtle transition-colors hover:border-danger hover:text-danger"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                <path d="M19 13H5v-2h14v2z" />
                              </svg>
                            </button>
                            <span className="w-7 text-center text-[14px] font-bold text-text-main">
                              {linha.quantidade}
                            </span>
                            <button
                              type="button"
                              aria-label="Aumentar quantidade"
                              onClick={() => alterarQtd(linha.uid, 1)}
                              className="flex h-8 w-8 items-center justify-center rounded-menuzia border border-border text-text-subtle transition-colors hover:border-primary hover:text-primary"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              aria-label="Remover item"
                              onClick={() => removerLinha(linha.uid)}
                              className="ml-auto flex h-8 w-8 items-center justify-center rounded-menuzia border border-transparent text-text-subtle/40 transition-colors hover:border-danger hover:text-danger"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Footer: subtotal + launch */}
            <div className="space-y-2.5 border-t border-border p-3">
              {comanda.length > 0 && (
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-text-subtle">Subtotal (ref.)</span>
                  <span className="font-semibold text-text-main">{formatBRL(subtotal)}</span>
                </div>
              )}
              <Button
                className="w-full py-2.5"
                variant="success"
                disabled={!mesaEscolhida || comanda.length === 0 || launching}
                onClick={lancarNaCozinha}
              >
                {launching ? 'Lançando…' : 'Lançar na cozinha'}
              </Button>
            </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </>
  )
}
