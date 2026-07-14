'use client'

import { useMemo, useRef, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  adicionarItemPreset,
  atualizarItem,
  atualizarItemPreset,
  criarItem,
  enviarImagemItem,
  type ItemCardapio,
} from '@/lib/queries/cardapio'
import { limparNomeArquivo } from './bulk-upload-nome'

const MAX_ARQUIVOS = 50
const MAX_TAMANHO_MB = 10
const CONCORRENCIA = 3
const PRECO_PADRAO_COMPLEMENTO = 9.9

export type BulkUploadTarget =
  | { tipo: 'item'; grupoId: string; nome: string }
  | { tipo: 'complemento'; presetId: string; nome: string; posicaoInicial: number }

export interface ComplementoCriado {
  id: string
  nome: string
  preco: number
  imagemUrl: string | null
}

interface LinhaRevisao {
  registroId: string
  imagemUrl: string
  nome: string
  preco: string
  /** Registro completo do item — necessário pro atualizarItem, que exige todos os campos. */
  item: ItemCardapio | null
}

interface ArquivoComErro {
  file: File
  motivo: string
}

type Fase = 'soltar' | 'enviando' | 'revisao'

function precoParaNumero(texto: string, fallback: number): number {
  const val = parseFloat(texto.replace(',', '.'))
  return Number.isFinite(val) && val >= 0 ? val : fallback
}

export function BulkUploadModal({
  restauranteId,
  target,
  onClose,
}: {
  restauranteId: string
  target: BulkUploadTarget
  /** Chamado ao fechar, com o estado final das linhas criadas (vazio se nada foi criado). */
  onClose: (criados: ComplementoCriado[]) => void
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const inputRef = useRef<HTMLInputElement>(null)

  const [fase, setFase] = useState<Fase>('soltar')
  const [dragOver, setDragOver] = useState(false)
  const [ignorados, setIgnorados] = useState<ArquivoComErro[]>([])
  const [falhas, setFalhas] = useState<ArquivoComErro[]>([])
  const [enviados, setEnviados] = useState(0)
  const [total, setTotal] = useState(0)
  const [linhas, setLinhas] = useState<LinhaRevisao[]>([])
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  const precoPadrao = target.tipo === 'complemento' ? PRECO_PADRAO_COMPLEMENTO : 0

  function linhasParaCriados(lista: LinhaRevisao[]): ComplementoCriado[] {
    return lista.map((l) => ({
      id: l.registroId,
      nome: l.nome.trim() || 'Item',
      preco: precoParaNumero(l.preco, precoPadrao),
      imagemUrl: l.imagemUrl,
    }))
  }

  function fechar() {
    onClose(linhas.length > 0 ? linhasParaCriados(linhas) : [])
  }

  /** Sobe um arquivo e cria o registro correspondente. Retorna a linha pra revisão. */
  async function processarArquivo(file: File, indice: number, jaExistentes: number): Promise<LinhaRevisao> {
    const url = await enviarImagemItem(supabase, restauranteId, file)
    const nome = limparNomeArquivo(file.name) ?? `Item ${indice + 1}`

    if (target.tipo === 'item') {
      const item = await criarItem(supabase, restauranteId, {
        grupoId: target.grupoId,
        nome,
        descricao: 'Sem descrição',
        preco: 0,
        status: 'pausado',
        diasDisponiveis: [0, 1, 2, 3, 4, 5, 6],
        promocaoPreco: null,
        maisVendido: false,
        tag: null,
        tipoItem: 'simples',
        imagemUrl: url,
      })
      return { registroId: item.id, imagemUrl: url, nome: item.nome, preco: '0,00', item }
    }

    const criado = await adicionarItemPreset(
      supabase,
      target.presetId,
      nome,
      PRECO_PADRAO_COMPLEMENTO,
      target.posicaoInicial + jaExistentes + indice,
      url,
    )
    return { registroId: criado.id, imagemUrl: url, nome: criado.nome, preco: '9,90', item: null }
  }

  /** Pool simples de uploads: CONCORRENCIA por vez, falha de um não trava o lote. */
  async function enviarLote(files: File[], jaExistentes: number) {
    setFase('enviando')
    setTotal(files.length)
    setEnviados(0)
    setFalhas([])

    const novasLinhas: LinhaRevisao[] = []
    const novasFalhas: ArquivoComErro[] = []
    let cursor = 0

    async function worker() {
      while (cursor < files.length) {
        const indice = cursor
        cursor += 1
        const file = files[indice]
        try {
          const linha = await processarArquivo(file, jaExistentes + indice, jaExistentes)
          novasLinhas[indice] = linha
        } catch {
          novasFalhas.push({ file, motivo: 'Falha no envio' })
        } finally {
          setEnviados((prev) => prev + 1)
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, files.length) }, () => worker()))

    setLinhas((prev) => [...prev, ...novasLinhas.filter(Boolean)])
    setFalhas(novasFalhas)
    setFase('revisao')
  }

  function receberArquivos(fileList: FileList | File[]) {
    const todos = Array.from(fileList)
    const invalidos: ArquivoComErro[] = []
    const validos: File[] = []

    for (const file of todos) {
      if (!file.type.startsWith('image/')) {
        invalidos.push({ file, motivo: 'Não é imagem' })
      } else if (file.size > MAX_TAMANHO_MB * 1024 * 1024) {
        invalidos.push({ file, motivo: `Maior que ${MAX_TAMANHO_MB}MB` })
      } else {
        validos.push(file)
      }
    }

    const excedentes = validos.splice(MAX_ARQUIVOS)
    for (const file of excedentes) invalidos.push({ file, motivo: `Limite de ${MAX_ARQUIVOS} por lote` })

    setIgnorados(invalidos)
    if (validos.length === 0) return
    void enviarLote(validos, linhas.length)
  }

  function tentarNovamente() {
    const files = falhas.map((f) => f.file)
    setFalhas([])
    void enviarLote(files, linhas.length)
  }

  async function salvarTudo() {
    setSalvando(true)
    setErroSalvar(null)
    setSalvo(false)
    try {
      for (const linha of linhas) {
        const nome = linha.nome.trim() || 'Item'
        const preco = precoParaNumero(linha.preco, precoPadrao)
        if (target.tipo === 'item' && linha.item) {
          await atualizarItem(supabase, linha.registroId, {
            grupoId: linha.item.grupoId,
            nome,
            descricao: linha.item.descricao,
            preco,
            status: linha.item.status,
            diasDisponiveis: linha.item.diasDisponiveis,
            imagemUrl: linha.item.imagemUrl,
            promocaoPreco: linha.item.promocaoPreco,
            maisVendido: linha.item.maisVendido,
            tag: linha.item.tag,
            tipoItem: linha.item.tipoItem,
          })
        } else {
          await atualizarItemPreset(supabase, linha.registroId, nome, preco, linha.imagemUrl)
        }
      }
      setSalvo(true)
    } catch {
      setErroSalvar('Não foi possível salvar algumas edições. Tente de novo.')
    } finally {
      setSalvando(false)
    }
  }

  const progresso = total > 0 ? Math.round((enviados / total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={fase !== 'enviando' ? fechar : undefined}>
      <div
        className="flex max-h-[85vh] w-full max-w-[600px] flex-col overflow-hidden rounded-menuzia border border-border bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-[14px] font-bold text-text-main">Subir fotos em massa</h3>
            <p className="text-[12px] text-text-subtle">
              {target.tipo === 'item' ? 'Categoria' : 'Grupo de complementos'}: <b className="text-text-main">{target.nome}</b>
            </p>
          </div>
          {fase !== 'enviando' && (
            <button onClick={fechar} title="Fechar" className="rounded-menuzia px-2 py-1 text-[16px] text-text-subtle hover:bg-page hover:text-text-main">✕</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Fase 1 — soltar */}
          {fase === 'soltar' && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); receberArquivos(e.dataTransfer.files) }}
                onClick={() => inputRef.current?.click()}
                className={[
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-menuzia border-2 border-dashed px-6 py-14 text-center transition-colors',
                  dragOver ? 'border-primary bg-primary/5' : 'border-border bg-page hover:border-primary',
                ].join(' ')}
              >
                <span className="text-[32px]">🖼️</span>
                <p className="text-[13px] font-semibold text-text-main">Arraste as fotos aqui ou clique para selecionar</p>
                <p className="text-[12px] text-text-subtle">
                  Cada foto vira um {target.tipo === 'item' ? 'item da categoria' : 'complemento do grupo'} automaticamente.
                  <br />
                  Máx. {MAX_ARQUIVOS} fotos por lote, {MAX_TAMANHO_MB}MB cada.
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { if (e.target.files?.length) receberArquivos(e.target.files); e.target.value = '' }}
                />
              </div>
              <p className="mt-3 rounded-menuzia bg-alert-bg px-3 py-2 text-[12px] leading-relaxed text-alert-text">
                {target.tipo === 'item'
                  ? 'Os itens são criados Pausados com preço R$ 0,00 — não aparecem na vitrine até você revisar nome, preço e ativar.'
                  : 'Os complementos são criados com preço R$ 9,90 — revise nome e preço na tela seguinte.'}
              </p>
            </>
          )}

          {/* Fase 2 — enviando */}
          {fase === 'enviando' && (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="text-[13px] font-semibold text-text-main">Enviando {Math.min(enviados + 1, total)} de {total}...</p>
              <div className="h-2 w-full max-w-[420px] overflow-hidden rounded-full bg-page">
                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progresso}%` }} />
              </div>
              <p className="text-[12px] text-text-subtle">Não feche esta janela enquanto o envio estiver em andamento.</p>
            </div>
          )}

          {/* Fase 3 — revisão */}
          {fase === 'revisao' && (
            <>
              {falhas.length > 0 && (
                <div className="mb-3 rounded-menuzia border border-danger bg-danger-bg px-3 py-2 text-[12px] text-danger">
                  <b>{falhas.length} arquivo(s) falharam:</b> {falhas.map((f) => f.file.name).join(', ')}
                  <button onClick={tentarNovamente} className="ml-2 rounded-menuzia bg-danger px-2 py-0.5 text-[11px] font-semibold uppercase text-white hover:opacity-90">
                    Tentar de novo
                  </button>
                </div>
              )}
              {linhas.length > 0 && (
                <>
                  <p className="mb-3 text-[12px] text-text-subtle">
                    <b className="text-text-main">{linhas.length}</b> {target.tipo === 'item' ? 'item(ns) criado(s)' : 'complemento(s) criado(s)'}. Ajuste nome e preço e salve tudo de uma vez.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {linhas.map((linha, idx) => (
                      <div key={linha.registroId} className="flex items-center gap-2.5 rounded-menuzia border border-border px-2.5 py-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={linha.imagemUrl} alt={linha.nome} className="h-10 w-10 flex-shrink-0 rounded-menuzia object-cover" />
                        <input
                          value={linha.nome}
                          onChange={(e) => setLinhas((prev) => prev.map((l, i) => (i === idx ? { ...l, nome: e.target.value } : l)))}
                          placeholder="Nome"
                          className="min-w-0 flex-1 rounded-menuzia border border-border px-2.5 py-1.5 text-[13px] outline-none focus:border-primary"
                        />
                        <div className="flex items-center gap-1 text-[12px] text-text-subtle">
                          R$
                          <input
                            value={linha.preco}
                            onChange={(e) => setLinhas((prev) => prev.map((l, i) => (i === idx ? { ...l, preco: e.target.value } : l)))}
                            inputMode="decimal"
                            className="w-[74px] rounded-menuzia border border-border px-2 py-1.5 text-right text-[13px] text-text-main outline-none focus:border-primary"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {linhas.length === 0 && falhas.length === 0 && (
                <p className="py-8 text-center text-[13px] text-text-subtle">Nenhum arquivo processado.</p>
              )}
            </>
          )}

          {/* Arquivos ignorados na validação */}
          {ignorados.length > 0 && fase !== 'enviando' && (
            <div className="mt-3 rounded-menuzia border border-warn bg-warn-bg px-3 py-2 text-[12px] text-[#92400E]">
              <b>Ignorados:</b> {ignorados.map((f) => `${f.file.name} (${f.motivo})`).join(', ')}
            </div>
          )}
        </div>

        {/* Footer */}
        {fase === 'revisao' && (
          <div className="flex items-center gap-2.5 border-t border-border px-4 py-3">
            {erroSalvar && <span className="flex-1 text-[12px] text-danger">{erroSalvar}</span>}
            {salvo && !erroSalvar && <span className="flex-1 text-[12px] font-semibold text-price-text">Tudo salvo ✓</span>}
            {!erroSalvar && !salvo && <span className="flex-1" />}
            <button onClick={fechar} className="rounded-menuzia border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:bg-page">
              Fechar
            </button>
            {linhas.length > 0 && (
              <button
                onClick={salvarTudo}
                disabled={salvando}
                className="rounded-menuzia bg-primary px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {salvando ? 'Salvando…' : 'Salvar tudo'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
