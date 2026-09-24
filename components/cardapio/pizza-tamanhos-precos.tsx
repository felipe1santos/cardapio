'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ImagePlus, PaintBucket, Pencil, Pizza, Plus, Trash2, X } from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { mensagemErroCardapio, nomeRepetidoNoCatalogo } from '@/lib/nomes-catalogo'
import { situacaoTamanhoPizza, tamanhosVendidosDaPizza, type SituacaoTamanhoPizza } from '@/lib/pizza-tamanhos'
import {
  atualizarSabor,
  criarSabor,
  definirPrecoSabor,
  definirTamanhosOcultosPizza,
  enviarImagemItem,
  removerSabor,
  type ItemCardapio,
  type PizzaSabor,
  type StatusItem,
} from '@/lib/queries/cardapio'
import { criarTamanhoPadraoPizza, type TamanhoPadraoPizza } from '@/lib/queries/pizza'
import { Aviso, BotaoIcone, BotaoPainel, CLASSE_CAMPO, Chave, FaixaErro, Vazio, lerPreco, precoParaCampo } from './ui'

const CICLO_STATUS: StatusItem[] = ['disponivel', 'pausado', 'esgotado']
const ROTULO_STATUS: Record<StatusItem, string> = { disponivel: 'Ativo', pausado: 'Inativo', esgotado: 'Em falta' }

const SITUACAO: Record<SituacaoTamanhoPizza, { texto: (n: number, total: number) => string; classe: string }> = {
  completo: { texto: () => 'Todos com preço', classe: 'bg-price-bg text-price-text' },
  parcial: { texto: (n, t) => `${n} de ${t} com preço`, classe: 'bg-alert-bg text-alert-text' },
  sem_preco: { texto: () => 'Sem preço · não aparece para o cliente', classe: 'bg-warn-bg text-[#92400E]' },
  desligado: { texto: () => 'Desligado · não aparece para o cliente', classe: 'bg-[#f1f2f4] text-[var(--adm-texto-medio)]' },
}

const chave = (saborId: string, tamanhoId: string) => `${saborId}:${tamanhoId}`

function semChave(o: Record<string, string>, k: string): Record<string, string> {
  const copia = { ...o }
  delete copia[k]
  return copia
}

function precoDe(sabor: PizzaSabor, tamanhoId: string): number {
  return sabor.precos.find((p) => p.tamanhoPadraoId === tamanhoId)?.preco ?? 0
}

/**
 * Etapa "Tamanhos e preços" do cadastro da pizza: uma tabela sabores × tamanhos.
 *
 * - Cada coluna é um tamanho da LOJA. A chave "Vende" liga/desliga o tamanho só
 *   nesta pizza (grava `pizza_tamanhos_ocultos`; nenhum preço é apagado).
 * - Cada célula é o preço do sabor naquele tamanho; salva ao sair do campo.
 * - "Preencher coluna" aplica um preço a todos os sabores de uma vez.
 * - Tamanho novo da loja pode ser criado aqui mesmo, sem sair do item.
 */
export function PizzaTamanhosPrecos({
  item,
  tamanhos,
  restauranteId,
  podeEditarCatalogo,
  onTamanhoCriado,
  onAtualizar,
}: {
  item: ItemCardapio
  tamanhos: TamanhoPadraoPizza[]
  restauranteId: string
  /** Só dono/gerente gravam no catálogo da loja (0066). Para os outros o botão some. */
  podeEditarCatalogo: boolean
  onTamanhoCriado: (t: TamanhoPadraoPizza) => void
  onAtualizar: () => Promise<void>
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [erro, setErro] = useState<string | null>(null)
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<Set<string>>(new Set())
  const [falhas, setFalhas] = useState<Set<string>>(new Set())
  const [preenchendo, setPreenchendo] = useState<string | null>(null)
  const [valorColuna, setValorColuna] = useState('')
  const [novoTamanho, setNovoTamanho] = useState<{ nome: string; fatias: string; sabores: string } | null>(null)
  const [novoSabor, setNovoSabor] = useState('')
  const [editandoSabor, setEditandoSabor] = useState<string | null>(null)
  const [edicaoSabor, setEdicaoSabor] = useState({ nome: '', descricao: '' })
  const [ocupado, setOcupado] = useState<string | null>(null)
  const novoSaborRef = useRef<HTMLInputElement>(null)

  const ocultos = useMemo(() => item.pizzaTamanhosOcultos ?? [], [item.pizzaTamanhosOcultos])
  const sabores = item.sabores
  const vendidos = useMemo(() => tamanhosVendidosDaPizza(tamanhos, sabores, ocultos), [tamanhos, sabores, ocultos])
  const algumComPreco = tamanhos.some((t) => !ocultos.includes(t.id) && sabores.some((s) => precoDe(s, t.id) > 0))

  // Preço que voltou do servidor (depois do refresh) derruba o rascunho da célula.
  useEffect(() => {
    setRascunhos((prev) => {
      const prox: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) {
        const [sid, tid] = k.split(':')
        const s = sabores.find((x) => x.id === sid)
        if (s && lerPreco(v) !== precoDe(s, tid) && !salvando.has(k)) prox[k] = v
      }
      return prox
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sabores])

  function falhou(e: unknown, padrao: string) {
    setErro(mensagemErroCardapio(e, padrao))
  }

  async function salvarCelula(sabor: PizzaSabor, tamanhoId: string) {
    const k = chave(sabor.id, tamanhoId)
    const texto = rascunhos[k]
    if (texto === undefined) return
    const preco = lerPreco(texto)
    if (preco === null && texto.trim() !== '') {
      setFalhas((p) => new Set(p).add(k))
      setErro(`Preço inválido em "${sabor.nome}". Use números, ex.: 45,90.`)
      return
    }
    const valor = preco ?? 0
    if (valor === precoDe(sabor, tamanhoId)) {
      setRascunhos((p) => semChave(p, k))
      return
    }
    setSalvando((p) => new Set(p).add(k))
    setFalhas((p) => {
      const n = new Set(p)
      n.delete(k)
      return n
    })
    try {
      await definirPrecoSabor(supabase, sabor.id, tamanhoId, valor)
      await onAtualizar()
    } catch (e) {
      setFalhas((p) => new Set(p).add(k))
      falhou(e, 'Não foi possível salvar o preço.')
    } finally {
      setSalvando((p) => {
        const n = new Set(p)
        n.delete(k)
        return n
      })
    }
  }

  async function preencherColuna(t: TamanhoPadraoPizza) {
    const preco = lerPreco(valorColuna)
    if (preco === null || preco <= 0) {
      setErro('Informe um preço maior que zero para preencher a coluna.')
      return
    }
    const diferentes = sabores.filter((s) => precoDe(s, t.id) > 0 && precoDe(s, t.id) !== preco)
    if (diferentes.length > 0 && !confirm(`${diferentes.length} sabor(es) já têm outro preço em "${t.nome}". Trocar todos para ${valorColuna}?`)) return
    setOcupado(`col:${t.id}`)
    setErro(null)
    try {
      for (const s of sabores) {
        if (precoDe(s, t.id) !== preco) await definirPrecoSabor(supabase, s.id, t.id, preco)
      }
      setPreenchendo(null)
      setValorColuna('')
      await onAtualizar()
    } catch (e) {
      falhou(e, 'Não foi possível preencher a coluna.')
      await onAtualizar()
    } finally {
      setOcupado(null)
    }
  }

  async function alternarTamanho(t: TamanhoPadraoPizza, vende: boolean) {
    const proximo = vende ? ocultos.filter((id) => id !== t.id) : [...ocultos, t.id]
    if (!vende && vendidos.length === 1 && vendidos[0].id === t.id && algumComPreco) {
      if (!confirm(`"${t.nome}" é o único tamanho à venda desta pizza. Desligando, ninguém consegue pedir esta pizza até outro tamanho ter preço. Continuar?`)) return
    }
    setOcupado(`tam:${t.id}`)
    setErro(null)
    try {
      await definirTamanhosOcultosPizza(supabase, item.id, proximo)
      await onAtualizar()
    } catch (e) {
      falhou(e, 'Não foi possível ligar/desligar o tamanho.')
    } finally {
      setOcupado(null)
    }
  }

  async function criarTamanhoDaLoja() {
    if (!novoTamanho) return
    const nome = novoTamanho.nome.trim()
    if (!nome) return
    if (nomeRepetidoNoCatalogo(tamanhos, nome)) {
      setErro(`A loja já tem o tamanho "${nome}".`)
      return
    }
    setOcupado('novo-tamanho')
    setErro(null)
    try {
      const t = await criarTamanhoPadraoPizza(
        supabase,
        restauranteId,
        nome,
        Math.max(0, Math.floor(Number(novoTamanho.fatias) || 0)),
        tamanhos.length,
        Math.max(1, Math.floor(Number(novoTamanho.sabores) || 1)),
      )
      onTamanhoCriado(t)
      setNovoTamanho(null)
    } catch (e) {
      falhou(e, 'Não foi possível criar o tamanho.')
    } finally {
      setOcupado(null)
    }
  }

  async function adicionarSabor() {
    const nome = novoSabor.trim()
    if (!nome) return
    if (nomeRepetidoNoCatalogo(sabores, nome)) {
      setErro(`Esta pizza já tem o sabor "${nome}".`)
      return
    }
    setOcupado('novo-sabor')
    setErro(null)
    try {
      await criarSabor(supabase, item.id, nome, sabores.length)
      setNovoSabor('')
      await onAtualizar()
      novoSaborRef.current?.focus()
    } catch (e) {
      falhou(e, 'Não foi possível criar o sabor.')
    } finally {
      setOcupado(null)
    }
  }

  async function gravarSabor(sabor: PizzaSabor, patch: Partial<Pick<PizzaSabor, 'nome' | 'descricao' | 'status' | 'imagemUrl'>>) {
    setOcupado(`sabor:${sabor.id}`)
    setErro(null)
    try {
      await atualizarSabor(supabase, sabor.id, {
        nome: patch.nome ?? sabor.nome,
        descricao: patch.descricao ?? sabor.descricao,
        status: patch.status ?? sabor.status,
        imagemUrl: patch.imagemUrl !== undefined ? patch.imagemUrl : sabor.imagemUrl,
      })
      await onAtualizar()
      return true
    } catch (e) {
      falhou(e, 'Não foi possível salvar o sabor.')
      return false
    } finally {
      setOcupado(null)
    }
  }

  async function salvarEdicaoSabor(sabor: PizzaSabor) {
    const nome = edicaoSabor.nome.trim()
    if (!nome) return
    if (nomeRepetidoNoCatalogo(sabores, nome, sabor.id)) {
      setErro(`Esta pizza já tem o sabor "${nome}".`)
      return
    }
    if (await gravarSabor(sabor, { nome, descricao: edicaoSabor.descricao })) setEditandoSabor(null)
  }

  async function enviarFotoSabor(sabor: PizzaSabor, arquivo: File) {
    setOcupado(`sabor:${sabor.id}`)
    try {
      const url = await enviarImagemItem(supabase, restauranteId, arquivo, 'thumb')
      await gravarSabor(sabor, { imagemUrl: url })
    } catch (e) {
      falhou(e, 'Não foi possível enviar a foto do sabor.')
      setOcupado(null)
    }
  }

  async function excluirSabor(sabor: PizzaSabor) {
    if (!confirm(`Remover o sabor "${sabor.nome}" desta pizza? Os preços dele saem junto.`)) return
    setOcupado(`sabor:${sabor.id}`)
    try {
      await removerSabor(supabase, sabor.id)
      await onAtualizar()
    } catch (e) {
      falhou(e, 'Não foi possível remover o sabor.')
    } finally {
      setOcupado(null)
    }
  }

  const formNovoTamanho = novoTamanho && (
    <form
      className="flex flex-wrap items-end gap-2 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] p-3"
      onSubmit={(e) => {
        e.preventDefault()
        criarTamanhoDaLoja()
      }}
    >
      <label className="flex min-w-[120px] flex-1 flex-col gap-1">
        <span className="text-[11px] font-semibold text-[var(--adm-texto-medio)]">Novo tamanho da loja</span>
        <input autoFocus value={novoTamanho.nome} onChange={(e) => setNovoTamanho({ ...novoTamanho, nome: e.target.value })} placeholder="Ex.: Pequena" className={CLASSE_CAMPO} />
      </label>
      <label className="flex w-20 flex-col gap-1">
        <span className="text-[11px] font-semibold text-[var(--adm-texto-medio)]">Fatias</span>
        <input value={novoTamanho.fatias} inputMode="numeric" onChange={(e) => setNovoTamanho({ ...novoTamanho, fatias: e.target.value })} placeholder="4" className={`${CLASSE_CAMPO} text-right`} />
      </label>
      <label className="flex w-24 flex-col gap-1">
        <span className="text-[11px] font-semibold text-[var(--adm-texto-medio)]">Até sabores</span>
        <input value={novoTamanho.sabores} inputMode="numeric" onChange={(e) => setNovoTamanho({ ...novoTamanho, sabores: e.target.value })} placeholder="1" className={`${CLASSE_CAMPO} text-right`} />
      </label>
      <BotaoPainel type="submit" variante="primario" disabled={ocupado === 'novo-tamanho' || !novoTamanho.nome.trim()}>
        <Check className="h-4 w-4" /> Criar tamanho
      </BotaoPainel>
      <BotaoPainel onClick={() => setNovoTamanho(null)}>Cancelar</BotaoPainel>
      <p className="w-full text-[11px] text-[var(--adm-texto-suave)]">O tamanho vale para todas as pizzas da loja. Em cada pizza ele só aparece depois de ter preço.</p>
    </form>
  )

  return (
    <div className="flex flex-col gap-3" data-testid="pizza-tamanhos-precos">
      <FaixaErro mensagem={erro} onFechar={() => setErro(null)} />

      {tamanhos.length === 0 ? (
        <div className="rounded-[6px] border-[0.8px] border-[var(--adm-borda-cartao)]">
          <Vazio
            icone={<Pizza className="h-5 w-5" />}
            titulo="Sua loja ainda não tem tamanhos de pizza"
            texto="Crie os tamanhos (ex.: Pequena, Média, Grande) para dar preço a cada sabor."
            acao={
              podeEditarCatalogo && !novoTamanho ? (
                <BotaoPainel variante="primario" onClick={() => setNovoTamanho({ nome: '', fatias: '', sabores: '1' })}>
                  <Plus className="h-4 w-4" /> Criar tamanho
                </BotaoPainel>
              ) : undefined
            }
          />
          {formNovoTamanho && <div className="px-3 pb-3">{formNovoTamanho}</div>}
        </div>
      ) : (
        <>
          <p className="text-[12px] leading-relaxed text-[var(--adm-texto-suave)]">
            Digite o preço de cada sabor em cada tamanho — salva sozinho ao sair do campo. Tamanho <b>sem preço</b> ou <b>desligado</b> não
            aparece para o cliente, no PDV nem no salão.
          </p>

          <div className="overflow-x-auto rounded-[6px] border-[0.8px] border-[var(--adm-borda-cartao)]">
            <table className="w-full min-w-max border-collapse text-[13px]">
              <thead>
                <tr className="bg-[var(--adm-superficie-2)]">
                  <th className="sticky left-0 z-10 min-w-[170px] border-b border-r border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] px-3 py-2 text-left align-bottom text-[11px] font-semibold uppercase tracking-wide text-[var(--adm-texto-suave)]">
                    Sabor
                  </th>
                  {tamanhos.map((t) => {
                    const vende = !ocultos.includes(t.id)
                    const situacao = situacaoTamanhoPizza(t.id, sabores, ocultos)
                    const n = sabores.filter((s) => precoDe(s, t.id) > 0).length
                    const s = SITUACAO[situacao]
                    return (
                      <th key={t.id} data-testid={`coluna-${t.nome}`} className="min-w-[150px] border-b border-[var(--adm-borda)] px-3 py-2 text-left align-top font-normal">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-[13px] font-bold ${vende ? 'text-[var(--adm-texto)]' : 'text-[var(--adm-texto-suave)] line-through'}`}>{t.nome}</span>
                          <Chave ligada={vende} rotulo={vende ? `Parar de vender ${t.nome} nesta pizza` : `Vender ${t.nome} nesta pizza`} disabled={ocupado === `tam:${t.id}`} onMudar={(v) => alternarTamanho(t, v)} />
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--adm-texto-suave)]">
                          {t.fatias} fatias · {t.maxSabores > 1 ? `até ${t.maxSabores} sabores` : '1 sabor'}
                        </div>
                        <span className={`mt-1 inline-block rounded-full px-2 py-[1px] text-[10.5px] font-bold ${s.classe}`}>{s.texto(n, sabores.length)}</span>
                        {vende && sabores.length > 0 && (
                          preenchendo === t.id ? (
                            <form
                              className="mt-1.5 flex items-center gap-1"
                              onSubmit={(e) => {
                                e.preventDefault()
                                preencherColuna(t)
                              }}
                            >
                              <input autoFocus value={valorColuna} inputMode="decimal" onChange={(e) => setValorColuna(e.target.value)} placeholder="R$" aria-label={`Preço para todos os sabores em ${t.nome}`} className={`${CLASSE_CAMPO} w-20 px-2 text-right`} />
                              <BotaoIcone rotulo="Aplicar a todos os sabores" type="submit" disabled={ocupado === `col:${t.id}`}>
                                <Check className="h-3.5 w-3.5" />
                              </BotaoIcone>
                              <BotaoIcone rotulo="Cancelar" onClick={() => setPreenchendo(null)}>
                                <X className="h-3.5 w-3.5" />
                              </BotaoIcone>
                            </form>
                          ) : (
                            <button
                              type="button"
                              data-toque-livre
                              onClick={() => {
                                setPreenchendo(t.id)
                                setValorColuna('')
                              }}
                              className="mt-1.5 flex items-center gap-1 text-[11.5px] font-semibold text-[var(--adm-azul)] hover:underline"
                            >
                              <PaintBucket className="h-3 w-3" /> Preencher coluna
                            </button>
                          )
                        )}
                      </th>
                    )
                  })}
                  {podeEditarCatalogo && (
                    <th className="border-b border-[var(--adm-borda)] px-3 py-2 align-top">
                      <BotaoPainel onClick={() => setNovoTamanho({ nome: '', fatias: '', sabores: '1' })} disabled={!!novoTamanho}>
                        <Plus className="h-4 w-4" /> Tamanho
                      </BotaoPainel>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {sabores.length === 0 && (
                  <tr>
                    <td colSpan={tamanhos.length + 2} className="px-3 py-6 text-center text-[12px] text-[var(--adm-texto-suave)]">
                      Nenhum sabor ainda. Adicione o primeiro abaixo.
                    </td>
                  </tr>
                )}
                {sabores.map((sabor) => {
                  const ocupadoSabor = ocupado === `sabor:${sabor.id}`
                  return (
                    <Fragment key={sabor.id}>
                      <tr className="group">
                        <td className="sticky left-0 z-10 border-b border-r border-[var(--adm-borda)] bg-white px-3 py-2">
                          <div className="flex items-center gap-2">
                            <label title="Foto do sabor" className={`relative flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-[4px] border border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] text-[var(--adm-texto-suave)] ${ocupadoSabor ? 'animate-pulse' : ''}`}>
                              {sabor.imagemUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={sabor.imagemUrl} alt={sabor.nome} className="h-full w-full object-cover" />
                              ) : (
                                <ImagePlus className="h-3.5 w-3.5" />
                              )}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                aria-label={`Foto de ${sabor.nome}`}
                                onChange={(e) => {
                                  const f = e.target.files?.[0]
                                  e.target.value = ''
                                  if (f) enviarFotoSabor(sabor, f)
                                }}
                              />
                            </label>
                            <div className="min-w-0 flex-1">
                              <p className={`truncate text-[13px] font-semibold ${sabor.status === 'disponivel' ? 'text-[var(--adm-texto)]' : 'text-[var(--adm-texto-suave)]'}`}>{sabor.nome}</p>
                              <button
                                type="button"
                                data-toque-livre
                                disabled={ocupadoSabor}
                                onClick={() => gravarSabor(sabor, { status: CICLO_STATUS[(CICLO_STATUS.indexOf(sabor.status) + 1) % CICLO_STATUS.length] })}
                                title="Tocar para mudar: Ativo → Inativo → Em falta"
                                className={`mt-0.5 rounded-full px-1.5 py-[1px] text-[10px] font-bold ${
                                  sabor.status === 'disponivel' ? 'bg-price-bg text-price-text' : sabor.status === 'pausado' ? 'bg-warn-bg text-[#92400E]' : 'bg-danger-bg text-danger'
                                }`}
                              >
                                {ROTULO_STATUS[sabor.status]}
                              </button>
                            </div>
                            <div className="flex flex-shrink-0 items-center gap-0.5">
                              <BotaoIcone
                                rotulo={`Editar ${sabor.nome}`}
                                className="h-6 w-6 border-transparent"
                                onClick={() => {
                                  setEditandoSabor(editandoSabor === sabor.id ? null : sabor.id)
                                  setEdicaoSabor({ nome: sabor.nome, descricao: sabor.descricao })
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </BotaoIcone>
                              <BotaoIcone rotulo={`Remover ${sabor.nome}`} perigo className="h-6 w-6 border-transparent" disabled={ocupadoSabor} onClick={() => excluirSabor(sabor)}>
                                <Trash2 className="h-3 w-3" />
                              </BotaoIcone>
                            </div>
                          </div>
                        </td>
                        {tamanhos.map((t) => {
                          const k = chave(sabor.id, t.id)
                          const vende = !ocultos.includes(t.id)
                          const valorServidor = precoDe(sabor, t.id)
                          const texto = rascunhos[k] ?? precoParaCampo(valorServidor)
                          const semPreco = !(lerPreco(texto) ?? 0)
                          return (
                            <td key={t.id} className={`border-b border-[var(--adm-borda)] px-3 py-2 ${!vende ? 'bg-[#f7f7f8]' : ''}`}>
                              <div className="relative">
                                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11.5px] text-[var(--adm-texto-suave)]">R$</span>
                                <input
                                  value={texto}
                                  inputMode="decimal"
                                  placeholder="—"
                                  data-testid={`preco-${sabor.nome}-${t.nome}`}
                                  aria-label={`Preço de ${sabor.nome} em ${t.nome}`}
                                  onChange={(e) => setRascunhos((p) => ({ ...p, [k]: e.target.value }))}
                                  onBlur={() => salvarCelula(sabor, t.id)}
                                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                                  className={`${CLASSE_CAMPO} pl-7 text-right tabular-nums ${falhas.has(k) ? 'border-danger bg-danger-bg' : semPreco && vende ? 'border-dashed' : ''} ${
                                    salvando.has(k) ? 'opacity-60' : ''
                                  } ${!vende ? 'text-[var(--adm-texto-suave)]' : ''}`}
                                />
                              </div>
                            </td>
                          )
                        })}
                        {podeEditarCatalogo && <td className="border-b border-[var(--adm-borda)]" />}
                      </tr>
                      {editandoSabor === sabor.id && (
                        <tr>
                          <td colSpan={tamanhos.length + 2} className="border-b border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] px-3 py-2.5">
                            <form
                              className="flex flex-wrap items-center gap-2"
                              onSubmit={(e) => {
                                e.preventDefault()
                                salvarEdicaoSabor(sabor)
                              }}
                            >
                              <input autoFocus value={edicaoSabor.nome} onChange={(e) => setEdicaoSabor((p) => ({ ...p, nome: e.target.value }))} aria-label="Nome do sabor" className={`${CLASSE_CAMPO} w-48`} />
                              <input
                                value={edicaoSabor.descricao}
                                onChange={(e) => setEdicaoSabor((p) => ({ ...p, descricao: e.target.value }))}
                                placeholder="Ingredientes (opcional)"
                                aria-label="Descrição do sabor"
                                className={`${CLASSE_CAMPO} min-w-[200px] flex-1`}
                              />
                              <BotaoPainel type="submit" variante="primario" disabled={ocupadoSabor || !edicaoSabor.nome.trim()}>
                                Salvar
                              </BotaoPainel>
                              <BotaoPainel onClick={() => setEditandoSabor(null)}>Cancelar</BotaoPainel>
                              {sabor.imagemUrl && (
                                <BotaoPainel variante="perigo" onClick={() => gravarSabor(sabor, { imagemUrl: null })}>
                                  Tirar foto
                                </BotaoPainel>
                              )}
                            </form>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {formNovoTamanho}

          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              adicionarSabor()
            }}
          >
            <input ref={novoSaborRef} value={novoSabor} onChange={(e) => setNovoSabor(e.target.value)} placeholder="Novo sabor (ex.: Calabresa)" aria-label="Nome do novo sabor" className={`${CLASSE_CAMPO} min-w-[200px] flex-1`} />
            <BotaoPainel type="submit" variante="primario" disabled={ocupado === 'novo-sabor' || !novoSabor.trim()}>
              <Plus className="h-4 w-4" /> Adicionar sabor
            </BotaoPainel>
          </form>

          {sabores.length > 0 && vendidos.length > 0 && algumComPreco && (
            <Aviso tom="azul">
              O cliente vê: <b>{vendidos.map((t) => t.nome).join(', ')}</b>.
            </Aviso>
          )}
          {sabores.length > 0 && !algumComPreco && (
            <Aviso>Nenhum tamanho tem preço ainda — a pizza não pode ser pedida. Preencha pelo menos uma coluna.</Aviso>
          )}
        </>
      )}
    </div>
  )
}
