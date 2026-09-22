'use client'

import { useMemo, useState } from 'react'
import { descricaoEmTextoPuro } from '@/lib/descricao-rica'
import { Check, ChevronDown, ImageOff, Minus, Pencil, Plus, Send, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { GrupoCardapio, ItemCardapio } from '@/lib/queries/cardapio'
import type { BordaPizza, MassaPizza, TamanhoPadraoPizza } from '@/lib/queries/pizza'
import { juntarSabores, precoPizzaSabores, separarSabores, type RegraPrecoPizza } from '@/lib/pizza-preco'
import { validarOpcoes, minimoDoGrupo, maximoDoGrupo } from '@/lib/opcoes-item'
import {
  gruposComOpcao,
  precoDeVitrine,
  precoEstimado,
  regrasDoItem,
  temObrigatorio,
  totalDoLancamento,
  type EscolhaItem,
  type LinhaLancamento,
  type LinhaSelecao,
  type ResultadoSelecao,
} from '@/lib/garcom-catalogo'

/**
 * Peças da aba "Lançar pedido" do painel do garçom: card do produto, bloco da seleção
 * do cliente, painel do lançamento e configurador do item. A regra (o que pode ser
 * lançado, o que falta escolher, como a seleção vira lançamento) mora em
 * `lib/garcom-catalogo.ts`; aqui é só tela.
 */

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export interface DadosPizza {
  tamanhos: TamanhoPadraoPizza[]
  bordas: BordaPizza[]
  massas: MassaPizza[]
  regra: RegraPrecoPizza
}

/** "Grande · Calabresa / Mussarela · Borda Catupiry · Bacon" — o que foi escolhido. */
export function descreverEscolha(l: Pick<EscolhaItem, 'tamanhoNome' | 'saborNome' | 'bordaNome' | 'massaNome' | 'complementos'>): string {
  return [
    l.tamanhoNome,
    l.saborNome,
    l.bordaNome ? `Borda ${l.bordaNome}` : '',
    l.massaNome ? `Massa ${l.massaNome}` : '',
    ...l.complementos.map((c) => c.nome),
  ]
    .filter(Boolean)
    .join(' · ')
}

// ── card do produto ─────────────────────────────────────────────────────────

export function CardProduto({
  item,
  categoria,
  noLancamento,
  onTocar,
}: {
  item: ItemCardapio
  /** Nome da categoria — só na busca, que mistura categorias. */
  categoria?: string
  noLancamento: number
  onTocar: () => void
}) {
  const preco = precoDeVitrine(item)
  const foto = item.imagemThumbUrl ?? item.imagemUrl
  const obrigatorio = temObrigatorio(item)
  return (
    <button
      onClick={onTocar}
      aria-label={`Adicionar ${item.nome}`}
      className={[
        'relative flex min-h-[76px] w-full items-center gap-3 rounded-menuzia border bg-main p-2.5 text-left transition-colors hover:border-primary',
        noLancamento > 0 ? 'border-primary' : 'border-border',
      ].join(' ')}
    >
      <span className="grid h-[56px] w-[56px] flex-shrink-0 place-items-center overflow-hidden rounded-menuzia bg-page">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={foto} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <ImageOff className="h-4 w-4 text-text-subtle" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        {categoria && <span className="block truncate text-[10px] font-bold uppercase tracking-wide text-text-subtle">{categoria}</span>}
        <span className="block truncate text-[13px] font-semibold text-text-main">{item.nome}</span>
        {item.descricao && (
          <span className="line-clamp-1 text-[11px] leading-snug text-text-subtle">{descricaoEmTextoPuro(item.descricao)}</span>
        )}
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-bold text-price-text">
            {preco.aPartirDe && <span className="font-normal text-text-subtle">a partir de </span>}
            {brl(preco.valor)}
          </span>
          {obrigatorio && <Badge tone="alert">Escolher opções</Badge>}
        </span>
      </span>
      <span
        className={[
          'grid h-[32px] min-w-[32px] flex-shrink-0 place-items-center rounded-menuzia px-1 text-[12px] font-bold',
          noLancamento > 0 ? 'bg-primary text-white' : 'text-primary',
        ].join(' ')}
        aria-hidden
      >
        {noLancamento > 0 ? `${noLancamento}×` : <Plus className="h-4 w-4" />}
      </span>
    </button>
  )
}

// ── seleção do cliente (NÃO lançado) ────────────────────────────────────────

export function SelecaoDoCliente({
  linhas,
  resolucoes,
  adicionadas,
  aberto,
  aviso,
  onAlternar,
  onAdicionar,
  onAdicionarTodas,
}: {
  linhas: LinhaSelecao[]
  resolucoes: Map<string, ResultadoSelecao>
  adicionadas: Set<string>
  aberto: boolean
  aviso: string | null
  onAlternar: () => void
  onAdicionar: (chave: string) => void
  onAdicionarTodas: () => void
}) {
  const pendentes = linhas.filter((l) => !adicionadas.has(l.chave) && resolucoes.get(l.chave)?.tipo !== 'indisponivel')
  const qtd = linhas.reduce((s, l) => s + l.quantidade, 0)

  // Sem nada marcado: só uma linha fina, sem abrir/fechar.
  if (linhas.length === 0) {
    return (
      <div className="flex min-h-[36px] items-center gap-2 rounded-menuzia border border-warn/60 bg-warn-bg px-2.5 py-1.5">
        <Badge tone="pending">Não lançado</Badge>
        <span className="min-w-0 truncate text-[12px] text-text-subtle">O cliente ainda não marcou nada no celular.</span>
      </div>
    )
  }

  return (
    <div className="rounded-menuzia border border-warn bg-warn-bg">
      {/* Faixa de uma linha: é o que ocupa a tela no celular enquanto recolhida. */}
      <button onClick={onAlternar} aria-expanded={aberto} className="flex min-h-[40px] w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <Badge tone="pending">Não lançado</Badge>
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-text-main">
          Cliente marcou {qtd} {qtd === 1 ? 'item' : 'itens'}
          {pendentes.length > 0 && pendentes.length < linhas.length && (
            <span className="font-semibold text-text-subtle"> · {pendentes.length} a adicionar</span>
          )}
        </span>
        <span className="flex flex-shrink-0 items-center gap-0.5 text-[11px] font-bold uppercase text-primary">
          {aberto ? 'Fechar' : 'Ver'}
          <ChevronDown className={`h-4 w-4 transition-transform ${aberto ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {aberto && (
        <div className="border-t border-warn/40 px-2.5 pb-2 pt-1">
          <ul className="divide-y divide-warn/30">
            {linhas.map((l) => {
              const r = resolucoes.get(l.chave)
              const ja = adicionadas.has(l.chave)
              const unit = l.precoUnitario + l.opcoes.reduce((s, o) => s + (Number.isFinite(o.preco) ? o.preco : 0), 0)
              const detalhe = [...l.opcoes.map((o) => o.escolha), l.observacao ? `“${l.observacao}”` : ''].filter(Boolean).join(' · ')
              return (
                <li key={l.chave} className="flex items-center gap-2 py-1.5">
                  <div className="min-w-0 flex-1 text-[12px] leading-snug text-text-main">
                    <div className="truncate">
                      <span className="font-bold">{l.quantidade}×</span> {l.nome}
                      <span className="ml-1 text-text-subtle">{brl(unit)}</span>
                    </div>
                    {detalhe && <div className="truncate text-[11px] text-text-subtle">{detalhe}</div>}
                    {!ja && r?.tipo === 'indisponivel' && <div className="text-[11px] font-semibold text-danger">{r.motivo}</div>}
                    {!ja && r?.tipo === 'configurar' && <div className="text-[11px] font-semibold text-status-pending">{r.motivo}</div>}
                    {!ja && r?.tipo === 'pronto' && r.precoMudou && (
                      <div className="text-[11px] font-semibold text-status-pending">Preço atual: {brl(r.linha.preco)} cada</div>
                    )}
                  </div>
                  {ja ? (
                    <span className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-bold uppercase text-status-ready">
                      <Check className="h-3.5 w-3.5" /> Adicionado
                    </span>
                  ) : r?.tipo === 'indisponivel' ? (
                    <span className="flex-shrink-0 whitespace-nowrap text-[11px] font-bold uppercase text-danger">Indisponível</span>
                  ) : (
                    <button
                      onClick={() => onAdicionar(l.chave)}
                      className="flex min-h-[36px] flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-menuzia border border-primary bg-main px-2 text-[11px] font-bold uppercase tracking-wide text-primary hover:bg-primary hover:text-white"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {r?.tipo === 'configurar' ? 'Configurar' : 'Adicionar'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {pendentes.length > 1 && (
            <Button variant="outline" className="mt-1.5 w-full whitespace-nowrap" onClick={onAdicionarTodas}>
              <Plus className="h-3.5 w-3.5" />
              Adicionar todos
            </Button>
          )}
          {aviso && (
            <p className="mt-1.5 rounded-menuzia bg-main px-2 py-1.5 text-[11px] font-semibold text-text-main" role="status">
              {aviso}
            </p>
          )}
          <p className="mt-1.5 text-[11px] leading-snug text-text-subtle">
            Não foi enviado à cozinha. Confirme com o cliente antes de adicionar.
          </p>
        </div>
      )}
    </div>
  )
}

// ── painel do lançamento ────────────────────────────────────────────────────

export function PainelLancamento({
  linhas,
  erro,
  bloqueio,
  enviando,
  classeLista = '',
  onQuantidade,
  onEditar,
  onRemover,
  onEnviar,
}: {
  linhas: LinhaLancamento[]
  erro: string | null
  bloqueio: string | null
  enviando: boolean
  classeLista?: string
  onQuantidade: (chave: string, delta: number) => void
  onEditar: (chave: string) => void
  onRemover: (chave: string) => void
  onEnviar: () => void
}) {
  const { itens, total } = totalDoLancamento(linhas)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`min-h-0 overflow-y-auto ${classeLista}`}>
        {linhas.length === 0 && (
          <p className="px-4 py-8 text-center text-[12px] text-text-subtle">Toque nos itens do cardápio para montar o pedido.</p>
        )}
        {linhas.map((l) => {
          const escolha = descreverEscolha(l)
          return (
            <div
              key={l.chave}
              data-linha-lancamento
              className={`border-b px-3 py-2.5 sm:px-4 ${l.indisponivel ? 'border-danger bg-danger-bg' : 'border-border'}`}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold leading-snug text-text-main">{l.nome}</div>
                  {escolha && <div className="text-[11px] text-text-subtle">{escolha}</div>}
                  {l.observacao && <div className="text-[11px] italic text-text-subtle">Obs.: {l.observacao}</div>}
                  {l.indisponivel && <div className="text-[11px] font-semibold text-danger">{l.indisponivel}</div>}
                  <div className="mt-0.5 text-[11px] text-text-subtle">
                    {brl(l.preco)} cada · <strong className="text-price-text">{brl(l.preco * l.quantidade)}</strong>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center rounded-menuzia border border-border">
                  <button
                    aria-label={`Diminuir ${l.nome}`}
                    onClick={() => onQuantidade(l.chave, -1)}
                    className="grid h-[36px] w-[36px] place-items-center text-primary"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-[20px] text-center text-[13px] font-bold" aria-label="Quantidade">
                    {l.quantidade}
                  </span>
                  <button
                    aria-label={`Aumentar ${l.nome}`}
                    onClick={() => onQuantidade(l.chave, 1)}
                    className="grid h-[36px] w-[36px] place-items-center text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-1 flex gap-3">
                <button onClick={() => onEditar(l.chave)} className="flex min-h-[32px] items-center gap-1 text-[11px] font-semibold text-primary">
                  <Pencil className="h-3 w-3" /> Editar
                </button>
                <button onClick={() => onRemover(l.chave)} className="flex min-h-[32px] items-center gap-1 text-[11px] font-semibold text-text-subtle hover:text-danger">
                  <Trash2 className="h-3 w-3" /> Remover
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex-shrink-0 space-y-2 border-t border-border p-3 sm:p-4">
        {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>}
        <div className="flex items-center justify-between text-[14px]">
          <span className="text-text-subtle">
            {itens} {itens === 1 ? 'item' : 'itens'}
          </span>
          <strong className="text-price-text">{brl(total)}</strong>
        </div>
        {bloqueio && !enviando && linhas.length > 0 && <p className="text-[11px] font-semibold text-danger">{bloqueio}</p>}
        <Button variant="success" className="w-full min-h-[44px]" disabled={!!bloqueio} onClick={onEnviar}>
          <Send className="h-3.5 w-3.5" />
          {enviando ? 'Enviando…' : 'Enviar para a cozinha'}
        </Button>
      </div>
    </div>
  )
}

// ── configurador do item ────────────────────────────────────────────────────

function Opcao({
  marcada,
  radio,
  rotulo,
  detalhe,
  desabilitada,
  onClick,
}: {
  marcada: boolean
  radio: boolean
  rotulo: string
  detalhe?: string
  desabilitada?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={desabilitada}
      role={radio ? 'radio' : 'checkbox'}
      aria-checked={marcada}
      className={`flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] disabled:opacity-40 ${marcada ? 'bg-alert-bg' : ''}`}
    >
      <span
        className={`h-4 w-4 flex-shrink-0 border-2 ${radio ? 'rounded-full' : 'rounded-menuzia'} ${
          marcada ? 'border-primary bg-primary' : 'border-border'
        }`}
      />
      <span className="flex-1 text-text-main">{rotulo}</span>
      {detalhe && <span className="text-[12px] font-semibold text-text-subtle">{detalhe}</span>}
    </button>
  )
}

function Etapa({ titulo, obrigatorio, ok, dica, children }: { titulo: string; obrigatorio: boolean; ok: boolean; dica?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-text-main">{titulo}</span>
        {obrigatorio ? <Badge tone={ok ? 'ok' : 'danger'}>Obrigatório</Badge> : dica && <span className="text-[11px] text-text-subtle">{dica}</span>}
      </div>
      <div className="divide-y divide-border rounded-menuzia border border-border">{children}</div>
    </div>
  )
}

/**
 * Escolhas de um item antes de entrar no lançamento (ou para editar uma linha).
 *
 * Mesmas regras do servidor: tamanho, sabor(es) da pizza, borda e massa opcionais e os
 * grupos de opções com mínimo/máximo (`validarOpcoes`). O preço mostrado é estimativa;
 * o servidor reprecifica no envio.
 */
export function ConfiguradorGarcom({
  item,
  pizza,
  inicial,
  aviso,
  modo,
  onCancelar,
  onConfirmar,
}: {
  item: ItemCardapio
  pizza: DadosPizza
  inicial?: Partial<EscolhaItem>
  aviso?: string | null
  modo: 'adicionar' | 'editar'
  onCancelar: () => void
  onConfirmar: (escolha: EscolhaItem, precoUnitario: number) => void
}) {
  const grupos = useMemo(() => gruposComOpcao(item), [item])
  const ehPizza = item.tipoItem === 'pizza'
  const sabores = useMemo(() => item.sabores.filter((s) => s.status === 'disponivel'), [item])
  // Tamanho de pizza só entra se algum sabor disponível tem preço nele.
  const tamanhosPizza = useMemo(
    () => {
      const comPreco = pizza.tamanhos.filter((t) => sabores.some((s) => s.precos.some((p) => p.tamanhoPadraoId === t.id && p.preco > 0)))
      return comPreco.length > 0 ? comPreco : pizza.tamanhos
    },
    [pizza.tamanhos, sabores],
  )
  const tamanhosItem = useMemo(() => [...item.tamanhos].sort((a, b) => a.posicao - b.posicao), [item])

  const [tamanhoNome, setTamanhoNome] = useState<string | undefined>(() => {
    const lista = ehPizza ? tamanhosPizza.map((t) => t.nome) : tamanhosItem.map((t) => t.nome)
    return inicial?.tamanhoNome && lista.includes(inicial.tamanhoNome) ? inicial.tamanhoNome : undefined
  })
  const [saboresEscolhidos, setSaboresEscolhidos] = useState<string[]>(() =>
    separarSabores(inicial?.saborNome ?? '').filter((n) => sabores.some((s) => s.nome === n)),
  )
  const [bordaNome, setBordaNome] = useState<string | undefined>(inicial?.bordaNome || undefined)
  const [massaNome, setMassaNome] = useState<string | undefined>(inicial?.massaNome || undefined)
  const [escolhidas, setEscolhidas] = useState<Record<string, string[]>>(() => {
    const nomes = new Set((inicial?.complementos ?? []).map((c) => c.nome))
    return Object.fromEntries(grupos.map((g) => [g.id, g.complementos.filter((c) => nomes.has(c.nome)).map((c) => c.nome)]))
  })
  const [quantidade, setQuantidade] = useState(Math.max(1, Math.min(99, inicial?.quantidade ?? 1)))
  const [observacao, setObservacao] = useState(inicial?.observacao ?? '')

  const tamanhoPizza = ehPizza ? tamanhosPizza.find((t) => t.nome === tamanhoNome) : undefined
  const maxSabores = Math.max(1, tamanhoPizza?.maxSabores ?? 1)

  function precoDoSabor(nome: string): number | undefined {
    if (!tamanhoPizza) return undefined
    const p = sabores.find((s) => s.nome === nome)?.precos.find((x) => x.tamanhoPadraoId === tamanhoPizza.id)?.preco
    return p !== undefined && p > 0 ? p : undefined
  }

  function escolherTamanhoPizza(nome: string) {
    setTamanhoNome(nome)
    // Sabor sem preço no tamanho novo, ou além do limite de sabores, sai da escolha.
    const t = tamanhosPizza.find((x) => x.nome === nome)
    setSaboresEscolhidos((atual) =>
      atual
        .filter((n) => sabores.find((s) => s.nome === n)?.precos.some((p) => p.tamanhoPadraoId === t?.id && p.preco > 0))
        .slice(0, Math.max(1, t?.maxSabores ?? 1)),
    )
  }

  function alternarSabor(nome: string) {
    setSaboresEscolhidos((atual) => {
      if (atual.includes(nome)) return atual.filter((n) => n !== nome)
      if (maxSabores === 1) return [nome]
      if (atual.length >= maxSabores) return atual
      return [...atual, nome]
    })
  }

  function alternar(grupoId: string, nome: string, max: number) {
    setEscolhidas((atual) => {
      const doGrupo = atual[grupoId] ?? []
      if (max === 1) return { ...atual, [grupoId]: doGrupo[0] === nome ? [] : [nome] }
      if (doGrupo.includes(nome)) return { ...atual, [grupoId]: doGrupo.filter((n) => n !== nome) }
      if (doGrupo.length >= max) return atual
      return { ...atual, [grupoId]: [...doGrupo, nome] }
    })
  }

  const complementos = grupos.flatMap((g) =>
    g.complementos.filter((c) => (escolhidas[g.id] ?? []).includes(c.nome)).map((c) => ({ nome: c.nome, preco: c.preco })),
  )

  const pendencias: string[] = []
  if (ehPizza) {
    if (!tamanhoPizza) pendencias.push('Escolha o tamanho.')
    else if (saboresEscolhidos.length === 0) pendencias.push('Escolha o sabor.')
  } else if (tamanhosItem.length > 0 && !tamanhoNome) {
    pendencias.push('Escolha o tamanho.')
  }
  pendencias.push(...validarOpcoes(regrasDoItem(item), complementos.map((c) => c.nome)))

  let unitario: number
  if (ehPizza) {
    const precos = saboresEscolhidos.map(precoDoSabor).filter((p): p is number => p !== undefined)
    unitario =
      precoPizzaSabores(precos, pizza.regra) +
      (pizza.bordas.find((b) => b.nome === bordaNome)?.preco ?? 0) +
      (pizza.massas.find((m) => m.nome === massaNome)?.preco ?? 0) +
      complementos.reduce((s, c) => s + c.preco, 0)
  } else {
    unitario = precoEstimado(item, { complementos, tamanhoNome })
  }

  function confirmar() {
    if (pendencias.length > 0) return
    onConfirmar(
      {
        complementos,
        tamanhoNome,
        saborNome: ehPizza ? juntarSabores(saboresEscolhidos) : undefined,
        bordaNome: ehPizza ? bordaNome : undefined,
        massaNome: ehPizza ? massaNome : undefined,
        quantidade,
        observacao: observacao.trim().slice(0, 200),
      },
      unitario,
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:items-stretch sm:justify-end sm:p-0" onClick={onCancelar}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={item.nome}
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-menuzia bg-main shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-[56px] flex-shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-text-main">{item.nome}</div>
            {item.descricao && <div className="line-clamp-1 text-[11px] text-text-subtle">{item.descricao}</div>}
          </div>
          <button onClick={onCancelar} className="-mr-2 grid h-[44px] w-[44px] flex-shrink-0 place-items-center text-text-subtle hover:text-text-main" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {aviso && <p className="rounded-menuzia bg-warn-bg px-3 py-2 text-[12px] font-semibold text-text-main">{aviso}</p>}

          {ehPizza && (
            <>
              <Etapa titulo="Tamanho" obrigatorio ok={!!tamanhoPizza}>
                {tamanhosPizza.length === 0 && <p className="px-3 py-2.5 text-[12px] text-danger">Nenhum tamanho com preço cadastrado.</p>}
                {tamanhosPizza.map((t) => (
                  <Opcao key={t.id} radio marcada={tamanhoNome === t.nome} rotulo={t.nome} detalhe={t.maxSabores > 1 ? `até ${t.maxSabores} sabores` : undefined} onClick={() => escolherTamanhoPizza(t.nome)} />
                ))}
              </Etapa>
              {tamanhoPizza && (
                <Etapa titulo={maxSabores > 1 ? `Sabores (até ${maxSabores})` : 'Sabor'} obrigatorio ok={saboresEscolhidos.length > 0}>
                  {sabores.map((s) => {
                    const p = precoDoSabor(s.nome)
                    if (p === undefined) return null
                    const marcada = saboresEscolhidos.includes(s.nome)
                    return (
                      <Opcao
                        key={s.id}
                        radio={maxSabores === 1}
                        marcada={marcada}
                        rotulo={s.nome}
                        detalhe={brl(p)}
                        desabilitada={!marcada && maxSabores > 1 && saboresEscolhidos.length >= maxSabores}
                        onClick={() => alternarSabor(s.nome)}
                      />
                    )
                  })}
                </Etapa>
              )}
              {pizza.bordas.length > 0 && (
                <Etapa titulo="Borda" obrigatorio={false} ok dica="opcional">
                  <Opcao radio marcada={!bordaNome} rotulo="Sem borda" onClick={() => setBordaNome(undefined)} />
                  {pizza.bordas.map((b) => (
                    <Opcao key={b.id} radio marcada={bordaNome === b.nome} rotulo={b.nome} detalhe={b.preco > 0 ? `+ ${brl(b.preco)}` : undefined} onClick={() => setBordaNome(b.nome)} />
                  ))}
                </Etapa>
              )}
              {pizza.massas.length > 0 && (
                <Etapa titulo="Massa" obrigatorio={false} ok dica="opcional">
                  <Opcao radio marcada={!massaNome} rotulo="Tradicional" onClick={() => setMassaNome(undefined)} />
                  {pizza.massas.map((m) => (
                    <Opcao key={m.id} radio marcada={massaNome === m.nome} rotulo={m.nome} detalhe={m.preco > 0 ? `+ ${brl(m.preco)}` : undefined} onClick={() => setMassaNome(m.nome)} />
                  ))}
                </Etapa>
              )}
            </>
          )}

          {!ehPizza && tamanhosItem.length > 0 && (
            <Etapa titulo="Tamanho" obrigatorio ok={!!tamanhoNome}>
              {tamanhosItem.map((t) => (
                <Opcao key={t.id} radio marcada={tamanhoNome === t.nome} rotulo={t.nome} detalhe={brl(t.preco)} onClick={() => setTamanhoNome(t.nome)} />
              ))}
            </Etapa>
          )}

          {grupos.map((g) => {
            const max = maximoDoGrupo({ maxEscolhas: g.maxEscolhas, opcoes: g.complementos.map((c) => c.nome) })
            const min = minimoDoGrupo(g)
            const doGrupo = escolhidas[g.id] ?? []
            return (
              <Etapa key={g.id} titulo={g.nome} obrigatorio={min > 0} ok={doGrupo.length >= min} dica={`até ${max}`}>
                {g.complementos.map((c) => (
                  <Opcao
                    key={c.id}
                    radio={max === 1}
                    marcada={doGrupo.includes(c.nome)}
                    rotulo={c.nome}
                    detalhe={c.preco > 0 ? `+ ${brl(c.preco)}` : undefined}
                    onClick={() => alternar(g.id, c.nome, max)}
                  />
                ))}
              </Etapa>
            )
          })}

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-bold text-text-main">Observação</span>
            <input
              value={observacao}
              onChange={(e) => setObservacao(e.target.value.slice(0, 200))}
              placeholder="Ex.: sem cebola, bem passado"
              className="h-[44px] w-full rounded-menuzia border border-border px-3 text-[13px] outline-none focus:border-primary"
            />
          </label>
        </div>

        <div className="flex-shrink-0 space-y-2 border-t border-border p-3 sm:p-4 sm:pb-[max(env(safe-area-inset-bottom),1rem)]">
          {pendencias.length > 0 && <p className="text-[12px] font-semibold text-danger">{pendencias[0]}</p>}
          <div className="flex items-center gap-2">
            <div className="flex flex-shrink-0 items-center rounded-menuzia border border-border">
              <button aria-label="Diminuir quantidade" onClick={() => setQuantidade((q) => Math.max(1, q - 1))} className="grid h-[44px] w-[40px] place-items-center text-primary">
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[24px] text-center text-[14px] font-bold">{quantidade}</span>
              <button aria-label="Aumentar quantidade" onClick={() => setQuantidade((q) => Math.min(99, q + 1))} className="grid h-[44px] w-[40px] place-items-center text-primary">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <Button className="min-h-[44px] flex-1" disabled={pendencias.length > 0} onClick={confirmar}>
              {modo === 'editar' ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {modo === 'editar' ? 'Salvar' : 'Adicionar'} · {brl(unitario * quantidade)}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  )
}

// ── estado vazio ────────────────────────────────────────────────────────────

export function SemItens({
  resumo,
  foraDoHorario,
}: {
  resumo: { pausados: number; foraDoHorario: number; foraDoDia: number; semCategoria: number }
  foraDoHorario: GrupoCardapio[]
}) {
  const motivos: string[] = []
  const hhmm = (h: string | null) => (h ?? '').slice(0, 5)
  if (foraDoHorario.length > 0) {
    motivos.push(
      `Fora do horário agora: ${foraDoHorario.map((g) => `${g.nome} (${hhmm(g.horarioAtivoInicio)}–${hhmm(g.horarioAtivoFim)})`).join(', ')}.`,
    )
  }
  if (resumo.pausados > 0) motivos.push(`${resumo.pausados} ${resumo.pausados === 1 ? 'item pausado ou esgotado' : 'itens pausados ou esgotados'}.`)
  if (resumo.foraDoDia > 0) motivos.push(`${resumo.foraDoDia} ${resumo.foraDoDia === 1 ? 'item não é servido' : 'itens não são servidos'} hoje.`)
  if (resumo.semCategoria > 0) motivos.push(`${resumo.semCategoria} ${resumo.semCategoria === 1 ? 'item está' : 'itens estão'} sem categoria no cardápio.`)
  return (
    <div className="rounded-menuzia border border-dashed border-border bg-main px-4 py-6 text-center">
      <p className="text-[13px] font-semibold text-text-main">Nenhum item disponível para lançamento neste momento</p>
      {motivos.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-text-subtle">
          {motivos.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
