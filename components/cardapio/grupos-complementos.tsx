'use client'

import { useMemo, useRef, useState } from 'react'
import { Check, ImagePlus, Images, Layers, Pause, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  adicionarItemPreset,
  atualizarItemPreset,
  atualizarRegrasPreset,
  criarPreset,
  enviarImagemItem,
  removerItemPreset,
  removerPreset,
  renomearPreset,
  type PresetComplementos,
} from '@/lib/queries/cardapio'
import { mensagemErroCardapio } from '@/lib/nomes-catalogo'
import { BulkUploadModal } from '@/app/admin/cardapio/bulk-upload-modal'
import { FoodIcon } from './icone-comida'
import { BotaoIcone, BotaoPainel, CabecalhoSecao, CartaoPainel, CLASSE_CAMPO, FaixaErro, Vazio, brl, lerPreco, precoParaCampo } from './ui'

export function textoDaRegra(g: { obrigatorio: boolean; minEscolhas: number; maxEscolhas: number }): string {
  if (g.maxEscolhas === 0) {
    return g.obrigatorio && g.minEscolhas > 0 ? `Escolha no mínimo ${g.minEscolhas}` : 'Escolha quantos quiser'
  }
  if (g.obrigatorio) {
    return g.minEscolhas === g.maxEscolhas ? `Escolha ${g.minEscolhas}` : `Escolha de ${g.minEscolhas} a ${g.maxEscolhas}`
  }
  return g.maxEscolhas === 1 ? 'Escolha até 1' : `Escolha até ${g.maxEscolhas}`
}

type OpcaoPreset = PresetComplementos['itens'][number]

/**
 * Aba "Grupos de complementos": conjuntos reutilizáveis de adicionais que o item
 * importa com um clique (a cópia no item não altera o grupo daqui).
 */
export function GruposComplementos({
  restauranteId,
  presets,
  setPresets,
}: {
  restauranteId: string
  presets: PresetComplementos[]
  setPresets: React.Dispatch<React.SetStateAction<PresetComplementos[]>>
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [novoNome, setNovoNome] = useState('')
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function criarGrupo() {
    const nome = novoNome.trim()
    if (!nome) return
    if (presets.some((p) => p.nome.trim().toLowerCase() === nome.toLowerCase())) {
      setErro(`Já existe um grupo chamado "${nome}".`)
      return
    }
    setCriando(true)
    setErro(null)
    try {
      const p = await criarPreset(supabase, restauranteId, nome)
      setPresets((prev) => [...prev, p])
      setNovoNome('')
    } catch (e) {
      setErro(mensagemErroCardapio(e, 'Não foi possível criar o grupo de complementos.'))
    } finally {
      setCriando(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 max-lg:p-3">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
        <CartaoPainel>
          <CabecalhoSecao
            icone={<Layers className="h-4 w-4" />}
            tom="roxo"
            titulo="Grupos de complementos"
            contador={presets.length}
            descricao={
              <>
                Monte uma vez e reaproveite em vários itens (ex.: <b>Adicionais de lanche</b>, <b>Molhos</b>, <b>Ponto da carne</b>). No
                cadastro do item, use <b>Importar grupo</b>: as opções são copiadas com as regras, e ajustar a cópia não muda o grupo daqui.
              </>
            }
          />
          <form
            className="flex flex-wrap items-center gap-2 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault()
              criarGrupo()
            }}
          >
            <input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Nome do novo grupo (ex.: Adicionais de lanche)"
              aria-label="Nome do novo grupo"
              className={`${CLASSE_CAMPO} min-w-[220px] flex-1`}
            />
            <BotaoPainel variante="primario" type="submit" disabled={criando || !novoNome.trim()} className="max-sm:w-full">
              <Plus className="h-4 w-4" /> {criando ? 'Criando…' : 'Criar grupo'}
            </BotaoPainel>
          </form>
          <FaixaErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mb-3" />
        </CartaoPainel>

        {presets.length === 0 ? (
          <CartaoPainel>
            <Vazio
              icone={<Layers className="h-5 w-5" />}
              titulo="Nenhum grupo ainda"
              texto="Crie o primeiro grupo acima. Depois é só importar nos itens que usam essas opções."
            />
          </CartaoPainel>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
            {presets.map((preset) => (
              <CartaoGrupo
                key={preset.id}
                preset={preset}
                restauranteId={restauranteId}
                nomesOutros={presets.filter((p) => p.id !== preset.id).map((p) => p.nome)}
                onRemovido={(id) => setPresets((prev) => prev.filter((p) => p.id !== id))}
                onMudou={(id, patch) => setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CartaoGrupo({
  preset,
  restauranteId,
  nomesOutros,
  onRemovido,
  onMudou,
}: {
  preset: PresetComplementos
  restauranteId: string
  nomesOutros: string[]
  onRemovido: (id: string) => void
  /** Propaga para o state da página — o modal de importar lê de lá. */
  onMudou: (id: string, patch: Partial<PresetComplementos>) => void
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [erro, setErro] = useState<string | null>(null)
  const [renomeando, setRenomeando] = useState(false)
  const [nome, setNome] = useState(preset.nome)
  const [minTexto, setMinTexto] = useState(String(preset.minEscolhas))
  const [maxTexto, setMaxTexto] = useState(preset.maxEscolhas === 0 ? '' : String(preset.maxEscolhas))
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [edicao, setEdicao] = useState({ nome: '', preco: '' })
  const [nova, setNova] = useState({ nome: '', preco: '' })
  const [fotosEmMassa, setFotosEmMassa] = useState(false)
  const novaRef = useRef<HTMLInputElement>(null)

  const itens = preset.itens
  const semMaximo = preset.maxEscolhas === 0

  function falhou(e: unknown, padrao: string) {
    setErro(mensagemErroCardapio(e, padrao))
  }

  async function salvarNome() {
    const limpo = nome.trim()
    setRenomeando(false)
    if (!limpo || limpo === preset.nome) { setNome(preset.nome); return }
    if (nomesOutros.some((n) => n.trim().toLowerCase() === limpo.toLowerCase())) {
      setNome(preset.nome)
      setErro(`Já existe um grupo chamado "${limpo}".`)
      return
    }
    try {
      await renomearPreset(supabase, preset.id, limpo)
      onMudou(preset.id, { nome: limpo })
    } catch (e) {
      setNome(preset.nome)
      falhou(e, 'Não foi possível renomear o grupo.')
    }
  }

  /** Grava as regras. Mínimo nunca passa do máximo; opcional não tem mínimo. */
  async function salvarRegras(patch: Partial<Pick<PresetComplementos, 'obrigatorio' | 'minEscolhas' | 'maxEscolhas' | 'permiteQuantidade'>>) {
    const prox = {
      obrigatorio: patch.obrigatorio ?? preset.obrigatorio,
      minEscolhas: patch.minEscolhas ?? preset.minEscolhas,
      maxEscolhas: patch.maxEscolhas ?? preset.maxEscolhas,
      permiteQuantidade: patch.permiteQuantidade ?? preset.permiteQuantidade,
    }
    if (!prox.obrigatorio) prox.minEscolhas = 0
    else if (prox.minEscolhas < 1) prox.minEscolhas = 1
    if (prox.maxEscolhas > 0 && prox.minEscolhas > prox.maxEscolhas) prox.minEscolhas = prox.maxEscolhas
    setMinTexto(String(prox.minEscolhas))
    setMaxTexto(prox.maxEscolhas === 0 ? '' : String(prox.maxEscolhas))
    const anterior = { obrigatorio: preset.obrigatorio, minEscolhas: preset.minEscolhas, maxEscolhas: preset.maxEscolhas, permiteQuantidade: preset.permiteQuantidade }
    onMudou(preset.id, prox)
    try {
      await atualizarRegrasPreset(supabase, preset.id, prox.obrigatorio, prox.minEscolhas, prox.maxEscolhas, prox.permiteQuantidade)
    } catch (e) {
      onMudou(preset.id, anterior)
      setMinTexto(String(anterior.minEscolhas))
      setMaxTexto(anterior.maxEscolhas === 0 ? '' : String(anterior.maxEscolhas))
      falhou(e, 'Não foi possível salvar as regras do grupo.')
    }
  }

  async function excluirGrupo() {
    if (!confirm(`Excluir o grupo "${preset.nome}"? Os complementos já importados nos itens continuam lá.`)) return
    try {
      await removerPreset(supabase, preset.id)
      onRemovido(preset.id)
    } catch (e) {
      falhou(e, 'Não foi possível excluir o grupo.')
    }
  }

  function atualizarItens(lista: OpcaoPreset[]) {
    onMudou(preset.id, { itens: lista })
  }

  async function adicionar() {
    const nomeNovo = nova.nome.trim()
    if (!nomeNovo) return
    if (itens.some((i) => i.nome.trim().toLowerCase() === nomeNovo.toLowerCase())) {
      setErro(`"${nomeNovo}" já está neste grupo.`)
      return
    }
    const preco = lerPreco(nova.preco) ?? 0
    setOcupado('novo')
    setErro(null)
    try {
      const criado = await adicionarItemPreset(supabase, preset.id, nomeNovo, preco, itens.length)
      atualizarItens([...itens, { id: criado.id, nome: criado.nome, preco: criado.preco, imagemUrl: criado.imagemUrl, pausado: criado.pausado }])
      setNova({ nome: '', preco: '' })
      novaRef.current?.focus()
    } catch (e) {
      falhou(e, 'Não foi possível adicionar a opção.')
    } finally {
      setOcupado(null)
    }
  }

  async function gravarOpcao(opcao: OpcaoPreset, patch: Partial<OpcaoPreset>) {
    const prox = { ...opcao, ...patch }
    setOcupado(opcao.id)
    setErro(null)
    try {
      await atualizarItemPreset(supabase, opcao.id, prox.nome.trim(), prox.preco, prox.imagemUrl, prox.pausado)
      atualizarItens(itens.map((i) => (i.id === opcao.id ? prox : i)))
      return true
    } catch (e) {
      falhou(e, 'Não foi possível salvar a opção.')
      return false
    } finally {
      setOcupado(null)
    }
  }

  async function salvarEdicao(opcao: OpcaoPreset) {
    const nomeEd = edicao.nome.trim()
    if (!nomeEd) return
    if (itens.some((i) => i.id !== opcao.id && i.nome.trim().toLowerCase() === nomeEd.toLowerCase())) {
      setErro(`"${nomeEd}" já está neste grupo.`)
      return
    }
    if (await gravarOpcao(opcao, { nome: nomeEd, preco: lerPreco(edicao.preco) ?? 0 })) setEditandoId(null)
  }

  async function enviarFoto(opcao: OpcaoPreset, arquivo: File) {
    setOcupado(opcao.id)
    try {
      const url = await enviarImagemItem(supabase, restauranteId, arquivo, 'thumb')
      await gravarOpcao(opcao, { imagemUrl: url })
    } catch (e) {
      falhou(e, 'Não foi possível enviar a foto.')
      setOcupado(null)
    }
  }

  async function remover(opcao: OpcaoPreset) {
    if (!confirm(`Remover "${opcao.nome}" deste grupo?`)) return
    setOcupado(opcao.id)
    try {
      await removerItemPreset(supabase, opcao.id)
      atualizarItens(itens.filter((i) => i.id !== opcao.id))
    } catch (e) {
      falhou(e, 'Não foi possível remover a opção.')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <CartaoPainel className="flex flex-col">
      {/* Cabeçalho do grupo */}
      <div className="flex items-center gap-3 border-b border-[var(--adm-borda)] px-4 py-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#F3E8FF]">
          <FoodIcon name={preset.nome} size={26} />
        </span>
        <div className="min-w-0 flex-1">
          {renomeando ? (
            <input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onBlur={salvarNome}
              onKeyDown={(e) => {
                if (e.key === 'Enter') salvarNome()
                if (e.key === 'Escape') { setNome(preset.nome); setRenomeando(false) }
              }}
              aria-label="Nome do grupo"
              className={CLASSE_CAMPO}
            />
          ) : (
            <h4 className="truncate text-[14.5px] font-bold text-[var(--adm-texto)]">{preset.nome}</h4>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--adm-texto-suave)]">
            <span
              className={`rounded-full px-2 py-[1px] text-[10.5px] font-bold ${
                preset.obrigatorio ? 'bg-danger-bg text-danger' : 'bg-[#f1f2f4] text-[var(--adm-texto-medio)]'
              }`}
            >
              {preset.obrigatorio ? 'Obrigatório' : 'Opcional'}
            </span>
            <span>{textoDaRegra(preset)}</span>
            <span aria-hidden>·</span>
            <span>
              {itens.length} {itens.length === 1 ? 'opção' : 'opções'}
            </span>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <BotaoIcone rotulo="Subir fotos em massa" onClick={() => setFotosEmMassa(true)}>
            <Images className="h-3.5 w-3.5" />
          </BotaoIcone>
          <BotaoIcone rotulo="Renomear grupo" onClick={() => setRenomeando(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </BotaoIcone>
          <BotaoIcone rotulo="Excluir grupo" perigo onClick={excluirGrupo}>
            <Trash2 className="h-3.5 w-3.5" />
          </BotaoIcone>
        </div>
      </div>

      {/* Regras */}
      <div className="flex flex-col gap-2.5 border-b border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div role="radiogroup" aria-label="O cliente precisa escolher?" className="inline-flex overflow-hidden rounded-[4px] border border-[var(--adm-borda)] bg-white">
            {[
              { v: false, r: 'Opcional' },
              { v: true, r: 'Obrigatório' },
            ].map(({ v, r }) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={preset.obrigatorio === v}
                onClick={() => preset.obrigatorio !== v && salvarRegras({ obrigatorio: v })}
                className={`px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                  preset.obrigatorio === v ? 'bg-[var(--adm-azul)] text-white' : 'text-[var(--adm-texto-medio)] hover:bg-[var(--adm-hover)]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {preset.obrigatorio && (
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--adm-texto-medio)]">
              Mínimo
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={minTexto}
                onChange={(e) => setMinTexto(e.target.value)}
                onBlur={() => Number(minTexto) !== preset.minEscolhas && salvarRegras({ minEscolhas: Math.max(1, Math.floor(Number(minTexto) || 1)) })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className={`${CLASSE_CAMPO} w-16 text-center`}
              />
            </label>
          )}
          <label className={`flex items-center gap-1.5 text-[12px] font-medium text-[var(--adm-texto-medio)] ${semMaximo ? 'opacity-50' : ''}`}>
            Máximo
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={maxTexto}
              disabled={semMaximo}
              placeholder="—"
              onChange={(e) => setMaxTexto(e.target.value)}
              onBlur={() => !semMaximo && Number(maxTexto) !== preset.maxEscolhas && salvarRegras({ maxEscolhas: Math.max(1, Math.floor(Number(maxTexto) || 1)) })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className={`${CLASSE_CAMPO} w-16 text-center disabled:bg-[#f5f5f6]`}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-[var(--adm-texto-medio)]">
            <input
              type="checkbox"
              checked={semMaximo}
              onChange={(e) => salvarRegras({ maxEscolhas: e.target.checked ? 0 : Math.max(1, preset.minEscolhas, 1) })}
              className="h-3.5 w-3.5 accent-[var(--adm-azul)]"
            />
            Sem limite
          </label>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-[var(--adm-texto-medio)]">
          <input
            type="checkbox"
            checked={preset.permiteQuantidade}
            onChange={(e) => salvarRegras({ permiteQuantidade: e.target.checked })}
            className="h-3.5 w-3.5 accent-[var(--adm-azul)]"
          />
          Cliente escolhe a quantidade de cada opção (− 1 +)
        </label>
      </div>

      <FaixaErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />

      {/* Opções */}
      <ul className="flex flex-col divide-y divide-[var(--adm-borda)] px-4">
        {itens.length === 0 && <li className="py-5 text-center text-[12px] text-[var(--adm-texto-suave)]">Nenhuma opção ainda. Adicione abaixo.</li>}
        {itens.map((opcao) =>
          editandoId === opcao.id ? (
            <li key={opcao.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <input
                autoFocus
                value={edicao.nome}
                onChange={(e) => setEdicao((p) => ({ ...p, nome: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && salvarEdicao(opcao)}
                aria-label="Nome da opção"
                className={`${CLASSE_CAMPO} min-w-[140px] flex-1`}
              />
              <div className="relative w-28">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--adm-texto-suave)]">R$</span>
                <input
                  value={edicao.preco}
                  inputMode="decimal"
                  onChange={(e) => setEdicao((p) => ({ ...p, preco: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && salvarEdicao(opcao)}
                  placeholder="0,00"
                  aria-label="Preço da opção"
                  className={`${CLASSE_CAMPO} pl-8 text-right tabular-nums`}
                />
              </div>
              <BotaoIcone rotulo="Salvar opção" onClick={() => salvarEdicao(opcao)} disabled={ocupado === opcao.id}>
                <Check className="h-3.5 w-3.5" />
              </BotaoIcone>
              <BotaoIcone rotulo="Cancelar edição" onClick={() => setEditandoId(null)}>
                <X className="h-3.5 w-3.5" />
              </BotaoIcone>
            </li>
          ) : (
            <li key={opcao.id} className={`flex items-center gap-2.5 py-2 ${opcao.pausado ? 'opacity-60' : ''}`}>
              <FotoOpcao
                url={opcao.imagemUrl}
                nome={opcao.nome}
                ocupado={ocupado === opcao.id}
                onArquivo={(f) => enviarFoto(opcao, f)}
                onRemover={() => gravarOpcao(opcao, { imagemUrl: null })}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--adm-texto)]">{opcao.nome}</span>
              {opcao.pausado && <span className="rounded-full bg-warn-bg px-2 py-[1px] text-[10.5px] font-bold text-[#92400E]">Pausado</span>}
              <span className="rounded-[4px] bg-price-bg px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-price-text">
                {opcao.preco > 0 ? `+ ${brl(opcao.preco)}` : 'Grátis'}
              </span>
              <div className="flex items-center gap-1">
                <BotaoIcone
                  rotulo={`Editar ${opcao.nome}`}
                  onClick={() => {
                    setEditandoId(opcao.id)
                    setEdicao({ nome: opcao.nome, preco: precoParaCampo(opcao.preco) })
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </BotaoIcone>
                <BotaoIcone
                  rotulo={opcao.pausado ? `Retomar ${opcao.nome}` : `Pausar ${opcao.nome}`}
                  disabled={ocupado === opcao.id}
                  onClick={() => gravarOpcao(opcao, { pausado: !opcao.pausado })}
                >
                  {opcao.pausado ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                </BotaoIcone>
                <BotaoIcone rotulo={`Remover ${opcao.nome}`} perigo disabled={ocupado === opcao.id} onClick={() => remover(opcao)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </BotaoIcone>
              </div>
            </li>
          ),
        )}
      </ul>

      {/* Nova opção */}
      <form
        className="mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          adicionar()
        }}
      >
        <input
          ref={novaRef}
          value={nova.nome}
          onChange={(e) => setNova((p) => ({ ...p, nome: e.target.value }))}
          placeholder="Nova opção (ex.: Bacon extra)"
          aria-label="Nome da nova opção"
          className={`${CLASSE_CAMPO} min-w-[160px] flex-1`}
        />
        <div className="relative w-28">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--adm-texto-suave)]">R$</span>
          <input
            value={nova.preco}
            inputMode="decimal"
            onChange={(e) => setNova((p) => ({ ...p, preco: e.target.value }))}
            placeholder="0,00"
            aria-label="Preço da nova opção"
            className={`${CLASSE_CAMPO} pl-8 text-right tabular-nums`}
          />
        </div>
        <BotaoPainel type="submit" variante="primario" disabled={ocupado === 'novo' || !nova.nome.trim()}>
          <Plus className="h-4 w-4" /> Adicionar
        </BotaoPainel>
      </form>

      {fotosEmMassa && (
        <BulkUploadModal
          restauranteId={restauranteId}
          target={{ tipo: 'complemento', presetId: preset.id, nome: preset.nome, posicaoInicial: itens.length }}
          onClose={(criados) => {
            setFotosEmMassa(false)
            if (criados.length === 0) return
            atualizarItens([...itens, ...criados.map((c) => ({ id: c.id, nome: c.nome, preco: c.preco, imagemUrl: c.imagemUrl, pausado: false }))])
          }}
        />
      )}
    </CartaoPainel>
  )
}

/** Miniatura clicável: toca para trocar a foto; o "×" remove. */
export function FotoOpcao({
  url,
  nome,
  ocupado,
  onArquivo,
  onRemover,
  tamanho = 36,
}: {
  url: string | null
  nome: string
  ocupado?: boolean
  onArquivo: (f: File) => void
  onRemover: () => void
  tamanho?: number
}) {
  return (
    <div className="relative flex-shrink-0" style={{ width: tamanho, height: tamanho }}>
      <label
        title={url ? 'Trocar foto' : 'Adicionar foto'}
        className={`flex h-full w-full cursor-pointer items-center justify-center overflow-hidden rounded-[4px] border border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] text-[var(--adm-texto-suave)] hover:border-[var(--adm-azul)] ${ocupado ? 'animate-pulse' : ''}`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={nome} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-4 w-4" />
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={`Foto de ${nome}`}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) onArquivo(f)
          }}
        />
      </label>
      {url && (
        <button
          type="button"
          data-toque-livre
          onClick={onRemover}
          title="Remover foto"
          aria-label={`Remover foto de ${nome}`}
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-white shadow-sm"
        >
          <X className="h-2.5 w-2.5" strokeWidth={3} />
        </button>
      )}
    </div>
  )
}
