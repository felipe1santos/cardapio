'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { descricaoEmTextoPuro } from '@/lib/descricao-rica'
import { juntarSabores, precoPizzaSabores, separarSabores, type RegraPrecoPizza } from '@/lib/pizza-preco'
import { tamanhosVendidosDaPizza } from '@/lib/pizza-tamanhos'
import { pizzaSemSabores, saborDoProprioItem, saboresDoTamanho } from '@/lib/pizza-sabores'
import type { ComplementoItem, GrupoItemComplementos, ItemCardapio } from '@/lib/queries/cardapio'
import type { BordaPizza, MassaPizza, TamanhoPadraoPizza } from '@/lib/queries/pizza'
import { FotoItem } from './foto-item'
import { BotaoPdv, ICONES_PDV, TelaPdv } from './tela-pdv'
import { formatBRL } from './util'

/**
 * Janela "Configurar item" do PDV (2026-10-01): foto do produto em destaque, cada opção numa
 * linha grande (miniatura · nome · preço · seleção ou contador), obrigatórios claros, quantidade
 * e "Adicionar · R$" recalculado ao vivo. Se falta algo, o botão diz o quê e rola até o grupo.
 *
 * Sabores da pizza pela regra única (lib/pizza-sabores): pizza sem preço por sabor usa o preço do
 * item; pizza sem sabores não exige sabor (aviso para a loja corrigir o cadastro); o sabor do
 * próprio produto ("Pizza Calabresa" → "Calabresa") já vem marcado.
 */

export interface EstadoConfig {
  item: ItemCardapio
  /** Pizza: nome do tamanho padrão. Outros: nome do tamanho do item. */
  tamanhoNome: string
  saborNome: string
  bordaId: string
  massaId: string
  /** grupoId → nomes escolhidos (repetidos = quantidade, nos grupos com "permite quantidade"). */
  complementosSelecionados: Record<string, string[]>
  observacao: string
}

export interface LinhaConfigurada {
  tamanhoNome: string
  saborNome: string
  bordaNome: string
  massaNome: string
  complementos: string[]
  observacao: string
}

export interface CatalogoPizza {
  tamanhosPizza: TamanhoPadraoPizza[]
  bordasPizza: BordaPizza[]
  massasPizza: MassaPizza[]
  regraPizza: RegraPrecoPizza
}

/** Complementos que o operador pode escolher: sem os pausados (mesma regra da vitrine e do servidor). */
export function opcoesDoGrupo(g: GrupoItemComplementos): ComplementoItem[] {
  return g.complementos.filter((c) => !c.pausado)
}

/** Preço UNITÁRIO de uma linha (mesma conta do servidor): base + borda/massa + complementos. */
export function precoUnitarioPdv(item: ItemCardapio, l: Pick<LinhaConfigurada, 'tamanhoNome' | 'saborNome' | 'bordaNome' | 'massaNome' | 'complementos'>, cat: CatalogoPizza): number {
  const catalogo = [...item.complementos, ...item.grupos.flatMap((g) => g.complementos)].filter((c) => !c.pausado)
  const complementos = l.complementos.reduce((s, nome) => s + (catalogo.find((c) => c.nome === nome)?.preco ?? 0), 0)
  if (item.tipoItem !== 'pizza') {
    const tamanho = l.tamanhoNome ? item.tamanhos.find((t) => t.nome === l.tamanhoNome) : undefined
    return (tamanho ? tamanho.preco : (item.promocaoPreco ?? item.preco)) + complementos
  }
  const tam = cat.tamanhosPizza.find((t) => t.nome === l.tamanhoNome)
  let base: number
  if (pizzaSemSabores(item.sabores)) base = item.preco
  else {
    const vend = saboresDoTamanho(item.sabores, tam?.id, item.preco)
    base = precoPizzaSabores(separarSabores(l.saborNome).map((n) => vend.find((v) => v.sabor.nome === n)?.preco ?? 0), cat.regraPizza)
  }
  const borda = cat.bordasPizza.find((b) => b.nome === l.bordaNome)?.preco ?? 0
  const massa = cat.massasPizza.find((m) => m.nome === l.massaNome)?.preco ?? 0
  return base + borda + massa + complementos
}

const LINHA = 'flex min-h-[68px] w-full items-center gap-3 rounded-menuzia border-2 px-3 py-2 text-left transition-colors active:scale-[0.995]'
const LINHA_ON = 'border-primary bg-primary/5'
const LINHA_OFF = 'border-border bg-white hover:border-primary/50'

function Marca({ marcada, redonda }: { marcada: boolean; redonda?: boolean }) {
  return (
    <span className={['flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center border-2', redonda ? 'rounded-full' : 'rounded-[6px]', marcada ? 'border-primary bg-primary text-white' : 'border-border bg-white'].join(' ')} aria-hidden>
      {marcada && (redonda
        ? <span className="h-[10px] w-[10px] rounded-full bg-white" />
        : <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>)}
    </span>
  )
}

function CabecalhoGrupo({ nome, obrigatorio, regra, falta }: { nome: string; obrigatorio: boolean; regra: string; falta: number }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h3 className="text-[15px] font-bold text-text-main">{nome}</h3>
      <span className={['rounded-full px-2 py-[2px] text-[11.5px] font-semibold', obrigatorio ? 'bg-warn-bg text-[#92400E]' : 'bg-page text-text-subtle'].join(' ')}>
        {obrigatorio ? `Obrigatório · ${regra}` : `Opcional · ${regra}`}
      </span>
      {falta > 0 && <span className="text-[12px] font-bold text-danger" data-falta>{falta === 1 ? 'Falta 1' : `Faltam ${falta}`}</span>}
    </div>
  )
}

export function ConfigurarItem({
  state,
  catalogo,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: EstadoConfig
  catalogo: CatalogoPizza
  onChange: (patch: Partial<EstadoConfig>) => void
  onCancel: () => void
  onConfirm: (linha: LinhaConfigurada, quantidade: number) => void
}) {
  const { item } = state
  const { tamanhosPizza, bordasPizza, massasPizza } = catalogo
  const isPizza = item.tipoItem === 'pizza'
  const temTamanhos = !isPizza && item.tamanhos.length > 0
  const [quantidade, setQuantidade] = useState(1)
  const [destaque, setDestaque] = useState<string | null>(null)
  const refs = useRef<Record<string, HTMLElement | null>>({})

  // ── Pizza ──
  const tamanhosDoItem = isPizza ? tamanhosVendidosDaPizza(tamanhosPizza, item.sabores, item.pizzaTamanhosOcultos) : []
  const tamanhoPizza = isPizza ? (tamanhosDoItem.find((t) => t.nome === state.tamanhoNome) ?? null) : null
  const maxSabores = tamanhoPizza?.maxSabores ?? 1
  const vendaveis = useMemo(() => (isPizza ? saboresDoTamanho(item.sabores, tamanhoPizza?.id, item.preco) : []), [isPizza, item, tamanhoPizza?.id])
  const semSabores = isPizza && !!tamanhoPizza && vendaveis.length === 0
  const saboresEscolhidos = separarSabores(state.saborNome).filter((n) => vendaveis.some((v) => v.sabor.nome === n)).slice(0, maxSabores)

  // Pizza: ao escolher o tamanho, o sabor do próprio produto ("Pizza Calabresa" → Calabresa) já
  // vem marcado; sabores que não valem no tamanho novo saem.
  function escolherTamanho(id: string, nome: string) {
    const novos = saboresDoTamanho(item.sabores, id, item.preco)
    const max = tamanhosDoItem.find((t) => t.id === id)?.maxSabores ?? 1
    const ficam = separarSabores(state.saborNome).filter((n) => novos.some((v) => v.sabor.nome === n)).slice(0, max)
    const proprio = ficam.length ? null : saborDoProprioItem(item.nome, novos.map((v) => v.sabor.nome))
    onChange({ tamanhoNome: nome, saborNome: juntarSabores(ficam.length ? ficam : proprio ? [proprio] : []) })
  }
  // Um tamanho só: já vem escolhido.
  useEffect(() => {
    if (isPizza && !state.tamanhoNome && tamanhosDoItem.length === 1) escolherTamanho(tamanhosDoItem[0].id, tamanhosDoItem[0].nome)
    if (temTamanhos && !state.tamanhoNome && item.tamanhos.length === 1) onChange({ tamanhoNome: item.tamanhos[0].nome })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Aviso para a loja corrigir o cadastro (fica no console do navegador do operador).
  useEffect(() => {
    if (semSabores) console.warn(`[cardápio] "${item.nome}": o tamanho "${tamanhoPizza?.nome}" não tem sabores cadastrados.`)
  }, [semSabores, item.nome, tamanhoPizza?.nome])

  // ── Grupos de opções (sem pausados; grupo vazio não aparece nem trava) ──
  const grupos = item.grupos.map((g) => ({ g, opcoes: opcoesDoGrupo(g) })).filter((x) => x.opcoes.length > 0)
  const minimo = (g: GrupoItemComplementos) => (g.obrigatorio ? Math.max(1, g.minEscolhas) : 0)
  const maximo = (g: GrupoItemComplementos, n: number) => (g.maxEscolhas > 0 ? g.maxEscolhas : g.permiteQuantidade ? Infinity : n)
  const qtdNoGrupo = (gid: string) => (state.complementosSelecionados[gid] ?? []).length

  // ── O que falta (na ordem da tela) ──
  const faltas: { chave: string; rotulo: string }[] = []
  if ((isPizza && tamanhosDoItem.length > 0 && !tamanhoPizza) || (temTamanhos && !state.tamanhoNome)) faltas.push({ chave: 'tamanho', rotulo: 'tamanho' })
  if (isPizza && tamanhoPizza && !semSabores && saboresEscolhidos.length === 0) faltas.push({ chave: 'sabor', rotulo: 'sabor' })
  for (const { g } of grupos) if (qtdNoGrupo(g.id) < minimo(g)) faltas.push({ chave: g.id, rotulo: g.nome })

  const linha: LinhaConfigurada = {
    tamanhoNome: state.tamanhoNome,
    saborNome: juntarSabores(saboresEscolhidos),
    bordaNome: bordasPizza.find((b) => b.id === state.bordaId)?.nome ?? '',
    massaNome: massasPizza.find((m) => m.id === state.massaId)?.nome ?? '',
    complementos: grupos.flatMap(({ g }) => state.complementosSelecionados[g.id] ?? []),
    observacao: state.observacao,
  }
  const unitario = precoUnitarioPdv(item, linha, catalogo)

  function alternar(g: GrupoItemComplementos, nome: string, n: number) {
    const atual = state.complementosSelecionados[g.id] ?? []
    let prox: string[]
    if (atual.includes(nome)) prox = atual.filter((x) => x !== nome)
    else if (g.maxEscolhas === 1) prox = [nome]
    else if (atual.length < maximo(g, n)) prox = [...atual, nome]
    else prox = atual
    onChange({ complementosSelecionados: { ...state.complementosSelecionados, [g.id]: prox } })
  }
  function contar(g: GrupoItemComplementos, nome: string, delta: number, n: number) {
    const atual = state.complementosSelecionados[g.id] ?? []
    let prox = atual
    if (delta > 0 && atual.length < maximo(g, n)) prox = [...atual, nome]
    if (delta < 0) { const i = atual.lastIndexOf(nome); if (i >= 0) prox = [...atual.slice(0, i), ...atual.slice(i + 1)] }
    onChange({ complementosSelecionados: { ...state.complementosSelecionados, [g.id]: prox } })
  }
  function adicionar() {
    if (faltas.length) {
      const alvo = refs.current[faltas[0].chave]
      alvo?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setDestaque(faltas[0].chave)
      setTimeout(() => setDestaque(null), 1600)
      return
    }
    onConfirm(linha, quantidade)
  }
  const anel = (chave: string) => (destaque === chave ? 'rounded-menuzia ring-2 ring-danger ring-offset-4' : '')

  const foto = item.imagemUrl ?? item.imagemThumbUrl
  const precoBase = isPizza ? null : (item.promocaoPreco ?? item.preco)

  return (
    <TelaPdv
      titulo={item.nome}
      onVoltar={onCancel}
      testid="configurar-item"
      sujo={Object.values(state.complementosSelecionados).some((x) => x.length > 0) || !!state.observacao.trim()}
      rodape={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex h-[60px] flex-shrink-0 items-center justify-between rounded-menuzia border-2 border-border bg-white sm:w-[180px]" data-testid="config-quantidade">
            <button type="button" onClick={() => setQuantidade((q) => Math.max(1, q - 1))} aria-label="Diminuir quantidade" className="flex h-full w-[56px] items-center justify-center text-[26px] font-bold text-primary disabled:opacity-30" disabled={quantidade <= 1}>−</button>
            <span className="text-[20px] font-extrabold text-text-main" data-testid="config-qtd">{quantidade}</span>
            <button type="button" onClick={() => setQuantidade((q) => Math.min(99, q + 1))} aria-label="Aumentar quantidade" className="flex h-full w-[56px] items-center justify-center text-[26px] font-bold text-primary">+</button>
          </div>
          <button
            type="button"
            onClick={adicionar}
            data-testid="config-adicionar"
            data-pendente={faltas.length ? '' : undefined}
            className={['flex min-h-[64px] flex-1 items-center justify-center gap-2 rounded-menuzia px-4 text-[17px] font-bold text-white transition-all active:scale-[0.98]', faltas.length ? 'bg-text-subtle' : 'bg-status-ready hover:brightness-95'].join(' ')}
          >
            {faltas.length ? (
              <>Escolha: {faltas.map((f) => f.rotulo).join(', ')}</>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden><path d={ICONES_PDV.mais} /></svg>
                Adicionar · {formatBRL(unitario * quantidade)}
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="lg:flex lg:min-h-full">
        {/* Foto e dados do produto */}
        <aside className="border-b border-border bg-page/50 lg:w-[320px] lg:flex-shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex gap-4 p-4 lg:flex-col">
            {foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto} alt={item.nome} loading="lazy" decoding="async" className="h-[120px] w-[120px] flex-shrink-0 rounded-menuzia bg-page object-cover lg:aspect-square lg:h-auto lg:w-full" data-config-foto />
            ) : (
              <FotoItem url={null} nome={item.nome} tamanho={120} className="lg:!h-[220px] lg:!w-full" />
            )}
            <div className="min-w-0">
              <h2 className="text-[19px] font-bold leading-tight text-text-main">{item.nome}</h2>
              {item.descricao && <p className="mt-1 text-[13px] leading-[18px] text-text-subtle">{descricaoEmTextoPuro(item.descricao)}</p>}
              {precoBase !== null && <p className="mt-2 text-[17px] font-bold text-price-text">{formatBRL(precoBase)}</p>}
            </div>
          </div>
        </aside>

        {/* Escolhas */}
        <div className="min-w-0 flex-1 space-y-6 p-4">
          {isPizza && tamanhosDoItem.length > 0 && (
            <section ref={(el) => { refs.current.tamanho = el }} className={anel('tamanho')} data-config-grupo="tamanho">
              <CabecalhoGrupo nome="Tamanho" obrigatorio regra="escolha 1" falta={tamanhoPizza ? 0 : 1} />
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {tamanhosDoItem.map((t) => {
                  const on = state.tamanhoNome === t.nome
                  return (
                    <button key={t.id} type="button" onClick={() => escolherTamanho(t.id, t.nome)} className={[LINHA, on ? LINHA_ON : LINHA_OFF].join(' ')} data-config-tamanho={t.nome}>
                      <Marca marcada={on} redonda />
                      <span className="min-w-0 flex-1 text-[15px] font-semibold text-text-main">{t.nome}</span>
                      {t.maxSabores > 1 && <span className="text-[12px] text-text-subtle">até {t.maxSabores} sabores</span>}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {isPizza && (
            <section ref={(el) => { refs.current.sabor = el }} className={anel('sabor')} data-config-grupo="sabor">
              <CabecalhoGrupo
                nome={maxSabores > 1 ? 'Sabores' : 'Sabor'}
                obrigatorio={!semSabores}
                regra={maxSabores > 1 ? `até ${maxSabores} (${saboresEscolhidos.length}/${maxSabores})` : 'escolha 1'}
                falta={tamanhoPizza && !semSabores && saboresEscolhidos.length === 0 ? 1 : 0}
              />
              {!tamanhoPizza && <p className="text-[13px] text-text-subtle">Escolha o tamanho para ver os sabores.</p>}
              {semSabores && (
                <p className="rounded-menuzia bg-warn-bg px-3 py-2 text-[13px] text-text-main" data-config-sem-sabores>
                  Este tamanho não tem sabores cadastrados — a pizza sai pelo preço do item. Corrija o cadastro em Cardápio.
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {vendaveis.map(({ sabor: s, preco }) => {
                  const on = saboresEscolhidos.includes(s.nome)
                  const cheio = saboresEscolhidos.length >= maxSabores
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!on && cheio && maxSabores > 1}
                      onClick={() => {
                        let prox: string[]
                        if (on) prox = saboresEscolhidos.filter((n) => n !== s.nome)
                        else if (maxSabores === 1) prox = [s.nome]
                        else prox = [...saboresEscolhidos, s.nome]
                        onChange({ saborNome: juntarSabores(prox) })
                      }}
                      className={[LINHA, on ? LINHA_ON : LINHA_OFF, 'disabled:opacity-40'].join(' ')}
                      data-config-sabor={s.nome}
                    >
                      <FotoItem url={s.imagemUrl} nome={s.nome} tamanho={52} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-semibold text-text-main">{s.nome}</span>
                        {s.descricao && <span className="block truncate text-[12px] text-text-subtle">{descricaoEmTextoPuro(s.descricao)}</span>}
                      </span>
                      <span className="flex-shrink-0 text-[14px] font-semibold text-price-text">{formatBRL(preco)}</span>
                      <Marca marcada={on} redonda={maxSabores === 1} />
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {isPizza && bordasPizza.length > 0 && (
            <section data-config-grupo="borda">
              <CabecalhoGrupo nome="Borda" obrigatorio={false} regra="escolha 1" falta={0} />
              <div className="grid gap-2 sm:grid-cols-2">
                {[{ id: '', nome: 'Sem borda', preco: 0 }, ...bordasPizza].map((b) => {
                  const on = state.bordaId === b.id
                  return (
                    <button key={b.id || 'sem'} type="button" onClick={() => onChange({ bordaId: b.id })} className={[LINHA, on ? LINHA_ON : LINHA_OFF].join(' ')}>
                      <Marca marcada={on} redonda />
                      <span className="min-w-0 flex-1 text-[15px] font-semibold text-text-main">{b.nome}</span>
                      {b.preco > 0 && <span className="text-[14px] font-semibold text-price-text">+ {formatBRL(b.preco)}</span>}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {isPizza && massasPizza.length > 0 && (
            <section data-config-grupo="massa">
              <CabecalhoGrupo nome="Massa" obrigatorio={false} regra="escolha 1" falta={0} />
              <div className="grid gap-2 sm:grid-cols-2">
                {[{ id: '', nome: 'Padrão', preco: 0 }, ...massasPizza].map((m) => {
                  const on = state.massaId === m.id
                  return (
                    <button key={m.id || 'padrao'} type="button" onClick={() => onChange({ massaId: m.id })} className={[LINHA, on ? LINHA_ON : LINHA_OFF].join(' ')}>
                      <Marca marcada={on} redonda />
                      <span className="min-w-0 flex-1 text-[15px] font-semibold text-text-main">{m.nome}</span>
                      {m.preco > 0 && <span className="text-[14px] font-semibold text-price-text">+ {formatBRL(m.preco)}</span>}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {temTamanhos && (
            <section ref={(el) => { refs.current.tamanho = el }} className={anel('tamanho')} data-config-grupo="tamanho">
              <CabecalhoGrupo nome="Tamanho" obrigatorio regra="escolha 1" falta={state.tamanhoNome ? 0 : 1} />
              <div className="grid gap-2 sm:grid-cols-2">
                {item.tamanhos.map((t) => {
                  const on = state.tamanhoNome === t.nome
                  return (
                    <button key={t.id} type="button" onClick={() => onChange({ tamanhoNome: t.nome })} className={[LINHA, on ? LINHA_ON : LINHA_OFF].join(' ')} data-config-tamanho={t.nome}>
                      <Marca marcada={on} redonda />
                      <span className="min-w-0 flex-1 text-[15px] font-semibold text-text-main">{t.nome}</span>
                      <span className="text-[14px] font-semibold text-price-text">{formatBRL(t.preco)}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {grupos.map(({ g, opcoes }) => {
            const sel = state.complementosSelecionados[g.id] ?? []
            const n = opcoes.length
            const regra = g.maxEscolhas === 1 ? 'escolha 1' : g.maxEscolhas > 0 ? `até ${g.maxEscolhas}` : 'quantos quiser'
            const cheio = sel.length >= maximo(g, n)
            return (
              <section key={g.id} ref={(el) => { refs.current[g.id] = el }} className={anel(g.id)} data-config-grupo={g.nome}>
                <CabecalhoGrupo nome={g.nome} obrigatorio={g.obrigatorio} regra={minimo(g) > 1 ? `escolha ${minimo(g)}` : regra} falta={Math.max(0, minimo(g) - sel.length)} />
                <div className="grid gap-2 sm:grid-cols-2">
                  {opcoes.map((c) => {
                    const qtd = sel.filter((x) => x === c.nome).length
                    const on = qtd > 0
                    if (g.permiteQuantidade) {
                      return (
                        <div key={c.id} className={[LINHA, on ? LINHA_ON : LINHA_OFF, 'cursor-default'].join(' ')} data-config-opcao={c.nome}>
                          <FotoItem url={c.imagemUrl} nome={c.nome} tamanho={52} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold text-text-main">{c.nome}</span>
                            {c.preco > 0 && <span className="block text-[13px] font-semibold text-price-text">+ {formatBRL(c.preco)}</span>}
                          </span>
                          <span className="flex flex-shrink-0 items-center rounded-menuzia border border-border bg-white">
                            <button type="button" onClick={() => contar(g, c.nome, -1, n)} disabled={!on} aria-label={`Menos ${c.nome}`} className="flex h-[48px] w-[44px] items-center justify-center text-[22px] font-bold text-primary disabled:opacity-30">−</button>
                            <span className="min-w-[24px] text-center text-[16px] font-bold" data-config-opcao-qtd>{qtd}</span>
                            <button type="button" onClick={() => contar(g, c.nome, 1, n)} disabled={cheio} aria-label={`Mais ${c.nome}`} className="flex h-[48px] w-[44px] items-center justify-center text-[22px] font-bold text-primary disabled:opacity-30">+</button>
                          </span>
                        </div>
                      )
                    }
                    return (
                      <button key={c.id} type="button" onClick={() => alternar(g, c.nome, n)} disabled={!on && cheio && g.maxEscolhas !== 1} className={[LINHA, on ? LINHA_ON : LINHA_OFF, 'disabled:opacity-40'].join(' ')} data-config-opcao={c.nome}>
                        <FotoItem url={c.imagemUrl} nome={c.nome} tamanho={52} />
                        <span className="min-w-0 flex-1 text-[15px] font-semibold text-text-main">{c.nome}</span>
                        {c.preco > 0 && <span className="flex-shrink-0 text-[14px] font-semibold text-price-text">+ {formatBRL(c.preco)}</span>}
                        <Marca marcada={on} redonda={g.maxEscolhas === 1} />
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}

          <section>
            <CabecalhoGrupo nome="Observação" obrigatorio={false} regra="texto livre" falta={0} />
            <textarea
              value={state.observacao}
              onChange={(e) => onChange({ observacao: e.target.value })}
              rows={2}
              maxLength={200}
              placeholder="Ex.: sem cebola, ponto da carne…"
              className="w-full resize-none rounded-menuzia border border-border bg-white px-3 py-2.5 text-[15px] text-text-main placeholder:text-text-subtle/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              data-config-obs
            />
          </section>
          <BotaoPdv icone={ICONES_PDV.voltar} onClick={onCancel} className="w-full sm:hidden">Cancelar</BotaoPdv>
        </div>
      </div>
    </TelaPdv>
  )
}
