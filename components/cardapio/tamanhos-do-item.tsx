'use client'

import { useMemo, useState } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { chaveNomeCatalogo, mensagemErroCardapio, nomeRepetidoNoCatalogo } from '@/lib/nomes-catalogo'
import { atualizarTamanho, criarTamanho, removerTamanho, type ItemCardapio, type TamanhoItem } from '@/lib/queries/cardapio'
import type { TamanhoPadraoMarmita } from '@/lib/queries/pizza'
import { Aviso, BotaoIcone, BotaoPainel, CLASSE_CAMPO, FaixaErro, lerPreco, precoParaCampo } from './ui'

/** Nome com que um tamanho da loja entra na marmita: "Pequena (500 g)". */
export function nomeImportadoMarmita(t: Pick<TamanhoPadraoMarmita, 'nome' | 'peso'>): string {
  const peso = t.peso.trim()
  return peso ? `${t.nome.trim()} (${peso})` : t.nome.trim()
}

/**
 * Tamanhos da loja que ainda faltam no item. Casa pelo nome importado e pelo nome
 * puro, sem diferenciar caixa/espaço: importar duas vezes não duplica, e um "P"
 * que o dono já tinha digitado à mão não vira "P (300 g)" repetido.
 */
export function tamanhosFaltandoNoItem(catalogo: TamanhoPadraoMarmita[], existentes: Pick<TamanhoItem, 'nome'>[]): TamanhoPadraoMarmita[] {
  const ja = new Set(existentes.map((t) => chaveNomeCatalogo(t.nome)))
  return catalogo.filter((t) => !ja.has(chaveNomeCatalogo(nomeImportadoMarmita(t))) && !ja.has(chaveNomeCatalogo(t.nome)))
}

function semChave<T>(o: Record<string, T>, k: string): Record<string, T> {
  const copia = { ...o }
  delete copia[k]
  return copia
}

/**
 * Etapa de tamanhos da marmita e do açaí: cada tamanho tem o próprio preço, que
 * SUBSTITUI o preço-base. Preço editado direto na linha, salvo ao sair do campo.
 */
export function TamanhosDoItem({
  item,
  rotulo,
  catalogoMarmita,
  onAtualizar,
}: {
  item: ItemCardapio
  /** "tamanho" (marmita) ou "volume" (açaí). */
  rotulo: 'tamanho' | 'volume'
  /** Só a marmita importa da loja. */
  catalogoMarmita?: TamanhoPadraoMarmita[]
  onAtualizar: () => Promise<void>
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [erro, setErro] = useState<string | null>(null)
  const [rascunhos, setRascunhos] = useState<Record<string, { nome: string; preco: string }>>({})
  const [novo, setNovo] = useState({ nome: '', preco: '' })
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [importados, setImportados] = useState(0)

  const tamanhos = item.tamanhos
  const faltando = catalogoMarmita ? tamanhosFaltandoNoItem(catalogoMarmita, tamanhos) : []
  const semPreco = tamanhos.filter((t) => !(t.preco > 0))
  const plural = rotulo === 'tamanho' ? 'tamanhos' : 'volumes'

  async function tentar(chave: string, acao: () => Promise<void>, padrao: string) {
    setOcupado(chave)
    setErro(null)
    try {
      await acao()
      return true
    } catch (e) {
      setErro(mensagemErroCardapio(e, padrao))
      return false
    } finally {
      setOcupado(null)
    }
  }

  async function salvarLinha(t: TamanhoItem) {
    const r = rascunhos[t.id]
    if (!r) return
    const nome = r.nome.trim()
    const preco = lerPreco(r.preco)
    if (!nome) {
      setErro('O nome não pode ficar vazio.')
      return
    }
    if (preco === null && r.preco.trim()) {
      setErro(`Preço inválido em "${nome}". Use números, ex.: 24,90.`)
      return
    }
    if (nome === t.nome && (preco ?? 0) === t.preco) {
      setRascunhos((p) => semChave(p, t.id))
      return
    }
    if (nomeRepetidoNoCatalogo(tamanhos, nome, t.id)) {
      setErro(`Este item já tem ${rotulo === 'tamanho' ? 'o tamanho' : 'o volume'} "${nome}".`)
      return
    }
    const ok = await tentar(t.id, async () => {
      await atualizarTamanho(supabase, t.id, nome, preco ?? 0)
      await onAtualizar()
    }, 'Não foi possível salvar.')
    if (ok) setRascunhos((p) => semChave(p, t.id))
  }

  async function adicionar() {
    const nome = novo.nome.trim()
    if (!nome) return
    const preco = lerPreco(novo.preco)
    if (preco === null && novo.preco.trim()) {
      setErro('Preço inválido. Use números, ex.: 24,90.')
      return
    }
    if (nomeRepetidoNoCatalogo(tamanhos, nome)) {
      setErro(`Este item já tem "${nome}".`)
      return
    }
    const ok = await tentar('novo', async () => {
      await criarTamanho(supabase, item.id, nome, preco ?? 0, tamanhos.length)
      await onAtualizar()
    }, 'Não foi possível adicionar.')
    if (ok) setNovo({ nome: '', preco: '' })
  }

  async function importar() {
    if (faltando.length === 0) return
    let criados = 0
    await tentar('importar', async () => {
      try {
        for (const [i, t] of faltando.entries()) {
          await criarTamanho(supabase, item.id, nomeImportadoMarmita(t), 0, tamanhos.length + i)
          criados++
        }
      } finally {
        await onAtualizar()
      }
    }, 'Não foi possível importar os tamanhos da loja.')
    setImportados(criados)
  }

  async function excluir(t: TamanhoItem) {
    if (!confirm(`Excluir "${t.nome}" deste item?`)) return
    await tentar(t.id, async () => {
      await removerTamanho(supabase, t.id)
      await onAtualizar()
    }, 'Não foi possível excluir.')
  }

  return (
    <div className="flex flex-col gap-3" data-testid="tamanhos-do-item">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] leading-relaxed text-[var(--adm-texto-suave)]">
          O cliente escolhe um {rotulo} e o preço dele <b>substitui</b> o preço-base. Edite nome e preço direto na linha.
        </p>
        {catalogoMarmita && catalogoMarmita.length > 0 && (
          <BotaoPainel onClick={importar} disabled={faltando.length === 0 || ocupado === 'importar'} title={faltando.length === 0 ? 'Todos os tamanhos da loja já estão neste item' : undefined}>
            <Download className="h-4 w-4" />
            {faltando.length === 0 ? 'Tamanhos da loja já importados' : `Importar da loja (${faltando.length})`}
          </BotaoPainel>
        )}
      </div>

      <FaixaErro mensagem={erro} onFechar={() => setErro(null)} />

      {importados > 0 && semPreco.length > 0 && (
        <Aviso>
          {importados} {importados === 1 ? 'tamanho importado' : 'tamanhos importados'} sem preço. Informe o preço de cada um — {rotulo} a R$ 0,00 sai de graça para o
          cliente.
        </Aviso>
      )}

      <div className="overflow-hidden rounded-[6px] border-[0.8px] border-[var(--adm-borda-cartao)]">
        {tamanhos.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-[var(--adm-texto-suave)]">
            Nenhum {rotulo} ainda. {catalogoMarmita?.length ? 'Importe os da loja ou adicione abaixo.' : 'Adicione abaixo.'}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--adm-borda)]">
            {tamanhos.map((t) => {
              const r = rascunhos[t.id] ?? { nome: t.nome, preco: precoParaCampo(t.preco) }
              const zerado = !(lerPreco(r.preco) ?? 0)
              const mudar = (patch: Partial<typeof r>) => setRascunhos((p) => ({ ...p, [t.id]: { ...r, ...patch } }))
              return (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                  <input
                    value={r.nome}
                    onChange={(e) => mudar({ nome: e.target.value })}
                    onBlur={() => salvarLinha(t)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    aria-label={`Nome do ${rotulo}`}
                    className={`${CLASSE_CAMPO} min-w-0 flex-1`}
                  />
                  <div className="relative w-32 flex-shrink-0">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--adm-texto-suave)]">R$</span>
                    <input
                      value={r.preco}
                      inputMode="decimal"
                      placeholder="0,00"
                      onChange={(e) => mudar({ preco: e.target.value })}
                      onBlur={() => salvarLinha(t)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      aria-label={`Preço de ${t.nome}`}
                      data-testid={`preco-tamanho-${t.nome}`}
                      className={`${CLASSE_CAMPO} pl-8 text-right tabular-nums ${zerado ? 'border-[#fcd34d] bg-warn-bg' : ''}`}
                    />
                  </div>
                  <BotaoIcone rotulo={`Excluir ${t.nome}`} perigo disabled={ocupado === t.id} onClick={() => excluir(t)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </BotaoIcone>
                </li>
              )
            })}
          </ul>
        )}
        <form
          className="flex flex-wrap items-center gap-2 border-t border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault()
            adicionar()
          }}
        >
          <input
            value={novo.nome}
            onChange={(e) => setNovo((p) => ({ ...p, nome: e.target.value }))}
            placeholder={rotulo === 'volume' ? 'Novo volume (ex.: 500 ml)' : 'Novo tamanho (ex.: Grande)'}
            aria-label={`Nome do novo ${rotulo}`}
            className={`${CLASSE_CAMPO} min-w-[140px] flex-1`}
          />
          <div className="relative w-32">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--adm-texto-suave)]">R$</span>
            <input value={novo.preco} inputMode="decimal" onChange={(e) => setNovo((p) => ({ ...p, preco: e.target.value }))} placeholder="0,00" aria-label={`Preço do novo ${rotulo}`} className={`${CLASSE_CAMPO} pl-8 text-right tabular-nums`} />
          </div>
          <BotaoPainel type="submit" variante="primario" disabled={ocupado === 'novo' || !novo.nome.trim()}>
            <Plus className="h-4 w-4" /> Adicionar
          </BotaoPainel>
        </form>
      </div>

      {semPreco.length > 0 && importados === 0 && (
        <Aviso>
          {semPreco.length === 1 ? `"${semPreco[0].nome}" está` : `${semPreco.length} ${plural} estão`} a R$ 0,00. Defina o preço antes de deixar o item disponível.
        </Aviso>
      )}
    </div>
  )
}
