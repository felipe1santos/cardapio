'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, CircleDot, Layers2, Pencil, Pizza, Plus, Ruler, Scale, Trash2, X } from 'lucide-react'
import type { TomPainel } from '@/components/admin/cartao-numero'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { mensagemErroCardapio, nomeRepetidoNoCatalogo } from '@/lib/nomes-catalogo'
import { massaIgualAoPadrao } from '@/lib/massa-padrao'
import type { ItemCardapio } from '@/lib/queries/cardapio'
import {
  atualizarBordaPizza,
  atualizarMassaPizza,
  atualizarTamanhoPadraoMarmita,
  atualizarTamanhoPadraoPizza,
  buscarRegraPrecoPizza,
  criarBordaPizza,
  criarMassaPizza,
  criarTamanhoPadraoMarmita,
  criarTamanhoPadraoPizza,
  listarBordasPizza,
  listarMassasPizza,
  removerBordaPizza,
  removerMassaPizza,
  removerTamanhoPadraoMarmita,
  removerTamanhoPadraoPizza,
  type BordaPizza,
  type MassaPizza,
  type TamanhoPadraoMarmita,
  type TamanhoPadraoPizza,
} from '@/lib/queries/pizza'
import { Aviso, BotaoIcone, BotaoPainel, CabecalhoSecao, CartaoPainel, CLASSE_CAMPO, FaixaErro, Vazio, brl, lerPreco, precoParaCampo } from './ui'

/** Um campo além do nome (fatias, sabores, peso, preço). */
interface Campo {
  rotulo: string
  placeholder: string
  tipo: 'inteiro' | 'texto' | 'preco'
  largura?: string
}

interface Linha {
  id: string
  nome: string
  valores: string[]
  /** Texto pequeno à direita (ex.: "em 3 pizzas"). */
  uso?: string
}

/**
 * Lista de um catálogo da loja. Todo erro aparece no próprio cartão (antes a
 * falha era silenciosa e o dono achava que tinha salvado).
 */
function ListaCatalogo({
  icone,
  tom,
  titulo,
  descricao,
  campos,
  exibir,
  linhas,
  exemploNome,
  onCriar,
  onSalvar,
  onRemover,
}: {
  icone: React.ReactNode
  tom: TomPainel
  titulo: string
  descricao: React.ReactNode
  campos: Campo[]
  /** Como mostrar os valores de uma linha fora da edição. */
  exibir: (valores: string[]) => React.ReactNode
  linhas: Linha[]
  exemploNome: string
  onCriar: (nome: string, valores: string[]) => Promise<void>
  onSalvar: (id: string, nome: string, valores: string[]) => Promise<void>
  onRemover: (linha: Linha) => Promise<void>
}) {
  const vazio = () => campos.map(() => '')
  const [nome, setNome] = useState('')
  const [valores, setValores] = useState<string[]>(vazio)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [edNome, setEdNome] = useState('')
  const [edValores, setEdValores] = useState<string[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function repetido(n: string, ignorarId?: string) {
    return nomeRepetidoNoCatalogo(linhas, n, ignorarId)
  }

  async function executar(acao: () => Promise<void>, padrao: string) {
    setOcupado(true)
    setErro(null)
    try {
      await acao()
      return true
    } catch (e) {
      setErro(mensagemErroCardapio(e, padrao))
      return false
    } finally {
      setOcupado(false)
    }
  }

  async function criar() {
    const n = nome.trim()
    if (!n) return
    if (repetido(n)) {
      setErro(`"${n}" já está cadastrado. Use outro nome — o pedido identifica o tamanho pelo nome.`)
      return
    }
    if (await executar(() => onCriar(n, valores), 'Não foi possível adicionar.')) {
      setNome('')
      setValores(vazio())
    }
  }

  async function salvar() {
    const n = edNome.trim()
    if (!editandoId || !n) return
    if (repetido(n, editandoId)) {
      setErro(`"${n}" já está cadastrado. Use outro nome.`)
      return
    }
    if (await executar(() => onSalvar(editandoId, n, edValores), 'Não foi possível salvar.')) setEditandoId(null)
  }

  function campoInput(c: Campo, valor: string, mudar: (v: string) => void, onEnter: () => void, rotuloAria: string) {
    const input = (
      <input
        value={valor}
        onChange={(e) => mudar(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter()}
        placeholder={c.placeholder}
        aria-label={rotuloAria}
        inputMode={c.tipo === 'inteiro' ? 'numeric' : c.tipo === 'preco' ? 'decimal' : undefined}
        className={`${CLASSE_CAMPO} ${c.tipo !== 'texto' ? 'text-right tabular-nums' : ''} ${c.tipo === 'preco' ? 'pl-8' : ''}`}
      />
    )
    return c.tipo === 'preco' ? (
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--adm-texto-suave)]">R$</span>
        {input}
      </div>
    ) : (
      input
    )
  }

  return (
    <CartaoPainel className="flex flex-col">
      <CabecalhoSecao icone={icone} tom={tom} titulo={titulo} contador={linhas.length} descricao={descricao} />
      <FaixaErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />
      {linhas.length === 0 ? (
        <Vazio icone={icone} titulo="Nada cadastrado" texto={`Adicione abaixo — ex.: "${exemploNome}".`} />
      ) : (
        <ul className="divide-y divide-[var(--adm-borda)] px-4">
          {linhas.map((l) =>
            editandoId === l.id ? (
              <li key={l.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <input
                  autoFocus
                  value={edNome}
                  onChange={(e) => setEdNome(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') salvar()
                    if (e.key === 'Escape') setEditandoId(null)
                  }}
                  aria-label="Nome"
                  className={`${CLASSE_CAMPO} min-w-[120px] flex-1`}
                />
                {campos.map((c, i) => (
                  <div key={c.rotulo} className={c.largura ?? 'w-24'}>
                    {campoInput(c, edValores[i] ?? '', (v) => setEdValores((p) => p.map((x, j) => (j === i ? v : x))), salvar, c.rotulo)}
                  </div>
                ))}
                <BotaoIcone rotulo="Salvar" onClick={salvar} disabled={ocupado}>
                  <Check className="h-3.5 w-3.5" />
                </BotaoIcone>
                <BotaoIcone rotulo="Cancelar" onClick={() => setEditandoId(null)}>
                  <X className="h-3.5 w-3.5" />
                </BotaoIcone>
              </li>
            ) : (
              <li key={l.id} className="flex items-center gap-2.5 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--adm-texto)]">{l.nome}</span>
                <span className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">{exibir(l.valores)}</span>
                {l.uso && <span className="hidden flex-shrink-0 text-[11px] text-[var(--adm-texto-suave)] sm:inline">{l.uso}</span>}
                <div className="flex flex-shrink-0 items-center gap-1">
                  <BotaoIcone
                    rotulo={`Editar ${l.nome}`}
                    onClick={() => {
                      setEditandoId(l.id)
                      setEdNome(l.nome)
                      setEdValores(l.valores)
                      setErro(null)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </BotaoIcone>
                  <BotaoIcone rotulo={`Excluir ${l.nome}`} perigo disabled={ocupado} onClick={() => executar(() => onRemover(l), 'Não foi possível excluir.')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </BotaoIcone>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      <form
        className="mt-auto border-t border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          criar()
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[130px] flex-1 flex-col gap-1">
            <span className="text-[11px] font-semibold text-[var(--adm-texto-medio)]">Nome</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={`Ex.: ${exemploNome}`} className={CLASSE_CAMPO} />
          </label>
          {campos.map((c, i) => (
            <label key={c.rotulo} className={`flex flex-col gap-1 ${c.largura ?? 'w-24'}`}>
              <span className="text-[11px] font-semibold text-[var(--adm-texto-medio)]">{c.rotulo}</span>
              {campoInput(c, valores[i] ?? '', (v) => setValores((p) => p.map((x, j) => (j === i ? v : x))), criar, c.rotulo)}
            </label>
          ))}
          <BotaoPainel type="submit" variante="primario" disabled={ocupado || !nome.trim()} className="max-sm:w-full">
            <Plus className="h-4 w-4" /> Adicionar
          </BotaoPainel>
        </div>
      </form>
    </CartaoPainel>
  )
}

function Pilula({ children, preco = false }: { children: React.ReactNode; preco?: boolean }) {
  return (
    <span
      className={`rounded-[4px] px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums ${
        preco ? 'bg-price-bg text-price-text' : 'bg-[#f1f2f4] text-[var(--adm-texto-medio)]'
      }`}
    >
      {children}
    </span>
  )
}

/**
 * Aba "Tamanhos": o que Pequena/Média/Grande significa na loja, mais bordas e
 * massas. Os catálogos moram no state da página porque o cadastro de item lê de
 * lá — criar um tamanho aqui já aparece na pizza sem recarregar.
 */
export function TamanhosLoja({
  restauranteId,
  itens,
  tamanhosPizza,
  setTamanhosPizza,
  tamanhosMarmita,
  setTamanhosMarmita,
}: {
  restauranteId: string
  itens: ItemCardapio[]
  tamanhosPizza: TamanhoPadraoPizza[]
  setTamanhosPizza: React.Dispatch<React.SetStateAction<TamanhoPadraoPizza[]>>
  tamanhosMarmita: TamanhoPadraoMarmita[]
  setTamanhosMarmita: React.Dispatch<React.SetStateAction<TamanhoPadraoMarmita[]>>
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [carregado, setCarregado] = useState(false)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [bordas, setBordas] = useState<BordaPizza[]>([])
  const [massas, setMassas] = useState<MassaPizza[]>([])
  const [regra, setRegra] = useState<'media' | 'maior'>('media')
  const [erroRegra, setErroRegra] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    Promise.all([listarBordasPizza(supabase, restauranteId), listarMassasPizza(supabase, restauranteId), buscarRegraPrecoPizza(supabase, restauranteId)])
      .then(([b, m, r]) => {
        if (cancelado) return
        setBordas(b)
        setMassas(m)
        setRegra(r)
        setCarregado(true)
      })
      .catch(() => !cancelado && setErroCarga('Não foi possível carregar bordas e massas. Recarregue a página.'))
    return () => {
      cancelado = true
    }
  }, [supabase, restauranteId])

  const pizzas = useMemo(() => itens.filter((i) => i.tipoItem === 'pizza'), [itens])

  /** Em quantas pizzas o tamanho tem preço em algum sabor — para avisar antes de excluir. */
  function usoDoTamanho(id: string) {
    const comPreco = pizzas.filter((p) => p.sabores.some((s) => s.precos.some((x) => x.tamanhoPadraoId === id && x.preco > 0)))
    const sabores = pizzas.reduce((n, p) => n + p.sabores.filter((s) => s.precos.some((x) => x.tamanhoPadraoId === id && x.preco > 0)).length, 0)
    return { pizzas: comPreco.length, sabores }
  }

  async function mudarRegra(nova: 'media' | 'maior') {
    if (nova === regra) return
    const anterior = regra
    setRegra(nova)
    setErroRegra(null)
    const { data, error } = await supabase.from('restaurantes').update({ pizza_calculo_preco: nova }).eq('id', restauranteId).select('id')
    if (error || !data?.length) {
      setRegra(anterior)
      setErroRegra(error ? mensagemErroCardapio(error, 'Não foi possível salvar a regra.') : 'Sem permissão para mudar a regra. Peça ao dono ou gerente.')
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 max-lg:p-3">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
        <CartaoPainel>
          <CabecalhoSecao
            icone={<Ruler className="h-4 w-4" />}
            tom="azul"
            titulo="Tamanhos da loja"
            descricao={
              <>
                Defina uma vez o que é <b>Pequena</b>, <b>Média</b> e <b>Grande</b> na sua loja. <b>Pizza:</b> o preço de cada tamanho fica em
                cada sabor, no cadastro da pizza (etapa <i>Tamanhos e preços</i>). <b>Marmita:</b> importe os tamanhos no item e informe o preço
                de cada um.
              </>
            }
          />
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="text-[12.5px] font-semibold text-[var(--adm-texto-forte)]">Pizza com mais de um sabor cobra:</span>
            <div role="radiogroup" aria-label="Regra de preço da pizza com mais de um sabor" className="inline-flex overflow-hidden rounded-[4px] border border-[var(--adm-borda)]">
              {(
                [
                  { v: 'media', r: 'Média dos sabores' },
                  { v: 'maior', r: 'Sabor mais caro' },
                ] as const
              ).map(({ v, r }) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={regra === v}
                  disabled={!carregado}
                  onClick={() => mudarRegra(v)}
                  className={`px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                    regra === v ? 'bg-[var(--adm-azul)] text-white' : 'bg-white text-[var(--adm-texto-medio)] hover:bg-[var(--adm-hover)]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <span className="text-[11.5px] text-[var(--adm-texto-suave)]">
              Ex.: meia Calabresa ({brl(50)}) + meia Camarão ({brl(70)}) = {regra === 'media' ? brl(60) : brl(70)}
            </span>
          </div>
          <FaixaErro mensagem={erroRegra} onFechar={() => setErroRegra(null)} className="mx-4 mb-3" />
        </CartaoPainel>

        {erroCarga && <FaixaErro mensagem={erroCarga} onFechar={() => setErroCarga(null)} />}

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <ListaCatalogo
            icone={<Pizza className="h-4 w-4" />}
            tom="laranja"
            titulo="Tamanhos de pizza"
            descricao="Quantas fatias e até quantos sabores cabem em cada tamanho. Tamanho novo aparece em todas as pizzas, mas só é vendido depois que você der preço a ele na pizza."
            exemploNome="Pequena"
            campos={[
              { rotulo: 'Fatias', placeholder: '8', tipo: 'inteiro', largura: 'w-20' },
              { rotulo: 'Até sabores', placeholder: '1', tipo: 'inteiro', largura: 'w-24' },
            ]}
            exibir={([fatias, sab]) => (
              <>
                <Pilula>{Number(fatias) || 0} fatias</Pilula>
                <Pilula>{Number(sab) > 1 ? `até ${sab} sabores` : '1 sabor'}</Pilula>
              </>
            )}
            linhas={tamanhosPizza.map((t) => {
              const u = usoDoTamanho(t.id)
              return {
                id: t.id,
                nome: t.nome,
                valores: [String(t.fatias), String(t.maxSabores)],
                uso: u.pizzas === 0 ? 'sem preço em pizzas' : `com preço em ${u.pizzas} pizza${u.pizzas === 1 ? '' : 's'}`,
              }
            })}
            onCriar={async (nome, [fatias, sab]) => {
              const novo = await criarTamanhoPadraoPizza(
                supabase,
                restauranteId,
                nome,
                Math.max(0, Math.floor(Number(fatias) || 0)),
                tamanhosPizza.length,
                Math.max(1, Math.floor(Number(sab) || 1)),
              )
              setTamanhosPizza((prev) => [...prev, novo])
            }}
            onSalvar={async (id, nome, [fatias, sab]) => {
              const f = Math.max(0, Math.floor(Number(fatias) || 0))
              const m = Math.max(1, Math.floor(Number(sab) || 1))
              await atualizarTamanhoPadraoPizza(supabase, id, nome, f, m)
              setTamanhosPizza((prev) => prev.map((t) => (t.id === id ? { ...t, nome: nome.trim(), fatias: f, maxSabores: m } : t)))
            }}
            onRemover={async (l) => {
              const u = usoDoTamanho(l.id)
              const aviso =
                u.sabores > 0
                  ? `\n\nAtenção: ${u.sabores} preço(s) de sabor em ${u.pizzas} pizza(s) usam este tamanho e serão apagados junto.`
                  : ''
              if (!confirm(`Excluir o tamanho "${l.nome}"?${aviso}`)) return
              await removerTamanhoPadraoPizza(supabase, l.id)
              setTamanhosPizza((prev) => prev.filter((t) => t.id !== l.id))
            }}
          />
          <ListaCatalogo
            icone={<Scale className="h-4 w-4" />}
            tom="verde"
            titulo="Tamanhos de marmita"
            descricao='Nome e peso (ex.: "Pequena" 500 g). No cadastro da marmita, "Importar da loja" traz estes tamanhos e você só informa o preço.'
            exemploNome="Pequena"
            campos={[{ rotulo: 'Peso', placeholder: '500 g', tipo: 'texto', largura: 'w-28' }]}
            exibir={([peso]) => (peso ? <Pilula>{peso}</Pilula> : null)}
            linhas={tamanhosMarmita.map((t) => ({ id: t.id, nome: t.nome, valores: [t.peso] }))}
            onCriar={async (nome, [peso]) => {
              const novo = await criarTamanhoPadraoMarmita(supabase, restauranteId, nome, (peso ?? '').trim(), tamanhosMarmita.length)
              setTamanhosMarmita((prev) => [...prev, novo])
            }}
            onSalvar={async (id, nome, [peso]) => {
              await atualizarTamanhoPadraoMarmita(supabase, id, nome, (peso ?? '').trim())
              setTamanhosMarmita((prev) => prev.map((t) => (t.id === id ? { ...t, nome: nome.trim(), peso: (peso ?? '').trim() } : t)))
            }}
            onRemover={async (l) => {
              if (!confirm(`Excluir o tamanho "${l.nome}"? As marmitas que já importaram este tamanho continuam com ele.`)) return
              await removerTamanhoPadraoMarmita(supabase, l.id)
              setTamanhosMarmita((prev) => prev.filter((t) => t.id !== l.id))
            }}
          />
          {carregado && (
            <>
              <ListaCatalogo
                icone={<CircleDot className="h-4 w-4" />}
                tom="ambar"
                titulo="Bordas de pizza"
                descricao="Oferecidas em todas as pizzas da loja, com o valor somado ao preço."
                exemploNome="Catupiry"
                campos={[{ rotulo: 'Valor extra', placeholder: '0,00', tipo: 'preco', largura: 'w-28' }]}
                exibir={([p]) => <Pilula preco>{(lerPreco(p) ?? 0) > 0 ? `+ ${brl(lerPreco(p) ?? 0)}` : 'Grátis'}</Pilula>}
                linhas={bordas.map((b) => ({ id: b.id, nome: b.nome, valores: [precoParaCampo(b.preco)] }))}
                onCriar={async (nome, [p]) => {
                  const novo = await criarBordaPizza(supabase, restauranteId, nome, lerPreco(p ?? '') ?? 0, bordas.length)
                  setBordas((prev) => [...prev, novo])
                }}
                onSalvar={async (id, nome, [p]) => {
                  const preco = lerPreco(p ?? '') ?? 0
                  await atualizarBordaPizza(supabase, id, nome, preco)
                  setBordas((prev) => prev.map((b) => (b.id === id ? { ...b, nome: nome.trim(), preco } : b)))
                }}
                onRemover={async (l) => {
                  if (!confirm(`Excluir a borda "${l.nome}"?`)) return
                  await removerBordaPizza(supabase, l.id)
                  setBordas((prev) => prev.filter((b) => b.id !== l.id))
                }}
              />
              <ListaCatalogo
                icone={<Layers2 className="h-4 w-4" />}
                tom="cinza"
                titulo="Massas de pizza"
                descricao="Tipos de massa oferecidos em todas as pizzas, com o valor somado ao preço."
                exemploNome="Integral"
                campos={[{ rotulo: 'Valor extra', placeholder: '0,00', tipo: 'preco', largura: 'w-28' }]}
                exibir={([p]) => <Pilula preco>{(lerPreco(p) ?? 0) > 0 ? `+ ${brl(lerPreco(p) ?? 0)}` : 'Grátis'}</Pilula>}
                linhas={massas.map((m) => ({
                  id: m.id,
                  nome: m.nome,
                  valores: [precoParaCampo(m.preco)],
                  // Cadastro antigo com o nome da opção padrão: não é apagado, só não se repete no pedido.
                  uso: massaIgualAoPadrao(m.nome) && !(m.preco > 0) ? 'igual à opção padrão · não se repete no pedido' : undefined,
                }))}
                onCriar={async (nome, [p]) => {
                  const novo = await criarMassaPizza(supabase, restauranteId, nome, lerPreco(p ?? '') ?? 0, massas.length)
                  setMassas((prev) => [...prev, novo])
                }}
                onSalvar={async (id, nome, [p]) => {
                  const preco = lerPreco(p ?? '') ?? 0
                  await atualizarMassaPizza(supabase, id, nome, preco)
                  setMassas((prev) => prev.map((m) => (m.id === id ? { ...m, nome: nome.trim(), preco } : m)))
                }}
                onRemover={async (l) => {
                  if (!confirm(`Excluir a massa "${l.nome}"?`)) return
                  await removerMassaPizza(supabase, l.id)
                  setMassas((prev) => prev.filter((m) => m.id !== l.id))
                }}
              />
            </>
          )}
        </div>
        {tamanhosPizza.length > 0 && pizzas.length > 0 && (
          <Aviso tom="azul">
            Criou um tamanho novo? Abra a pizza no cardápio e, na etapa <b>Tamanhos e preços</b>, preencha a coluna dele. Tamanho sem preço não
            aparece para o cliente.
          </Aviso>
        )}
      </div>
    </div>
  )
}
