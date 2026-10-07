'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, Loader2, Pencil } from 'lucide-react'
import type { ResultadoId } from '@/lib/pixels'

/**
 * Configuração de um código de medição (Facebook Pixel ou Google Tag) — a MESMA de antes da
 * repaginação de Integrações (2026-10-06); agora abre na janela da integração.
 */
export type Avisar = (tom: 'ok' | 'erro', texto: string) => void

const CARTAO = 'rounded-[12px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]'
const BOTAO = 'inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0688D4]'
const PRIMARIO = `${BOTAO} bg-[#0688D4] text-white hover:bg-[#0570AE]`
const SECUNDARIO = `${BOTAO} border border-[#D1D5DB] bg-white text-[#1F2937] hover:border-[#0688D4] hover:text-[#0688D4]`

type Status = 'ok' | 'neutro' | 'alerta' | 'erro' | 'carregando'
export function Selo({ status, children, testid }: { status: Status; children: React.ReactNode; testid?: string }) {
  const cor = { ok: 'bg-[#ECFDF5] text-[#047857]', neutro: 'bg-[#F3F4F6] text-[#4B5563]', alerta: 'bg-[#FFFBEB] text-[#92400E]', erro: 'bg-[#FEF2F2] text-[#B91C1C]', carregando: 'bg-[#F3F4F6] text-[#6B7280]' }[status]
  const ponto = { ok: 'bg-[#10B981]', neutro: 'bg-[#9CA3AF]', alerta: 'bg-[#F59E0B]', erro: 'bg-[#EF4444]', carregando: 'bg-[#9CA3AF] animate-pulse' }[status]
  return (
    <span className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-medium ${cor}`} data-testid={testid}>
      <span className={`h-[6px] w-[6px] rounded-full ${ponto}`} aria-hidden />
      {children}
    </span>
  )
}

export function CartaoPixel({ id, marca, nome, descricao, rotuloCampo, adicionar, placeholder, validar, valorInicial, carregado, onSalvar, avisar }: {
  id: 'facebook' | 'google'
  marca: string
  nome: string
  descricao: React.ReactNode
  rotuloCampo: string
  adicionar: string
  placeholder: string
  validar: (v: string) => ResultadoId
  valorInicial: string
  carregado: boolean
  onSalvar: (valor: string | null) => Promise<void>
  avisar: Avisar
}) {
  const [salvo, setSalvo] = useState(valorInicial)
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [confirmarRemover, setConfirmarRemover] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setSalvo(valorInicial), [valorInicial])
  useEffect(() => { if (editando) input.current?.focus() }, [editando])

  const ativo = carregado && salvo !== ''
  const invalido = ativo && !validar(salvo).ok

  function abrir() {
    setValor(salvo)
    setErro(null)
    setConfirmarRemover(false)
    setEditando(true)
  }
  function cancelar() {
    setEditando(false)
    setErro(null)
    setConfirmarRemover(false)
  }
  async function gravar(novo: string | null, msgOk: string) {
    setSalvando(true)
    try {
      await onSalvar(novo)
      setSalvo(novo ?? '')
      setEditando(false)
      setConfirmarRemover(false)
      avisar('ok', msgOk)
    } catch {
      avisar('erro', 'Não foi possível salvar. Verifique sua conexão e tente de novo.')
    } finally {
      setSalvando(false)
    }
  }
  async function salvar() {
    const r = validar(valor)
    if (!r.ok) {
      setErro(r.erro)
      input.current?.focus()
      return
    }
    setErro(null)
    await gravar(r.valor, `${nome} salvo.`)
  }

  return (
    <section className={`${CARTAO} flex h-full flex-col p-5`} data-testid={`pixel-${id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={marca} alt="" className="h-9 w-9 flex-shrink-0" />
          <h3 className="min-w-0 text-[15px] font-semibold text-[#111827]">{nome}</h3>
        </div>
        <Selo status={!carregado ? 'carregando' : ativo ? (invalido ? 'alerta' : 'ok') : 'neutro'} testid={`pixel-${id}-status`}>{!carregado ? 'Verificando…' : ativo ? 'Ativo' : 'Não configurado'}</Selo>
      </div>
      <p className="mt-3 text-[13px] leading-[19px] text-[#6B7280]">{descricao}</p>

      <div className="mt-auto pt-4">
        {!carregado ? (
          <div className="h-[36px] animate-pulse rounded-[8px] bg-[#F3F4F6]" />
        ) : editando ? (
          <div>
            <label htmlFor={`campo-${id}`} className="mb-1 block text-[12.5px] font-medium text-[#374151]">{rotuloCampo}</label>
            <input
              id={`campo-${id}`}
              ref={input}
              value={valor}
              onChange={(e) => { setValor(e.target.value); if (erro) setErro(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void salvar() }
                if (e.key === 'Escape') { e.preventDefault(); cancelar() }
              }}
              placeholder={placeholder}
              aria-invalid={!!erro}
              aria-describedby={erro ? `erro-${id}` : undefined}
              data-esc-local
              data-testid={`pixel-${id}-campo`}
              className={['w-full rounded-[8px] border bg-white px-3 py-2 font-mono text-[14px] tabular-nums text-[#111827] outline-none placeholder:font-sans placeholder:text-[#9CA3AF] focus:border-[#0688D4] focus:ring-2 focus:ring-[#0688D4]/15', erro ? 'border-[#DC2626]' : 'border-[#D1D5DB]'].join(' ')}
            />
            {erro && <p id={`erro-${id}`} className="mt-1.5 text-[12.5px] text-[#B91C1C]" data-testid={`pixel-${id}-erro`}>{erro}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={cancelar} disabled={salvando} className={SECUNDARIO} data-testid={`pixel-${id}-cancelar`}>Cancelar</button>
              <button type="button" onClick={() => void salvar()} disabled={salvando} className={PRIMARIO} data-testid={`pixel-${id}-salvar`}>
                {salvando ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</> : 'Salvar'}
              </button>
              {salvo && !confirmarRemover && (
                <button type="button" onClick={() => setConfirmarRemover(true)} disabled={salvando} className="ml-auto text-[12.5px] font-medium text-[#6B7280] hover:text-[#DC2626]" data-testid={`pixel-${id}-remover`}>Remover</button>
              )}
            </div>
            {confirmarRemover && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[8px] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#991B1B]">
                <span className="min-w-0 flex-1">Remover o {nome}? A medição para no cardápio.</span>
                <button type="button" onClick={() => void gravar(null, `${nome} removido.`)} disabled={salvando} className={`${BOTAO} bg-[#DC2626] text-white hover:bg-[#B91C1C]`} data-testid={`pixel-${id}-remover-confirmar`}>Remover</button>
                <button type="button" onClick={() => setConfirmarRemover(false)} className={SECUNDARIO}>Não</button>
              </div>
            )}
          </div>
        ) : ativo ? (
          <div>
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={marca} alt="" className="h-5 w-5 flex-shrink-0" />
              <span className="min-w-0 truncate font-mono text-[15px] tabular-nums tracking-[0.02em] text-[#111827]" data-testid={`pixel-${id}-valor`}>{salvo}</span>
              <button type="button" onClick={abrir} title="Editar" aria-label={`Editar ${rotuloCampo}`} className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]" data-testid={`pixel-${id}-editar`}>
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(salvo).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500) }) }}
                title="Copiar"
                aria-label={`Copiar ${rotuloCampo}`}
                className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]"
              >
                {copiado ? <Check className="h-4 w-4 text-[#059669]" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            {invalido && (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-[#92400E]" data-testid={`pixel-${id}-invalido`}>
                <AlertTriangle className="h-4 w-4 flex-shrink-0" /> ID parece inválido.
                <button type="button" onClick={abrir} className="font-semibold text-[#0688D4] hover:underline">Corrigir</button>
              </p>
            )}
          </div>
        ) : (
          <button type="button" onClick={abrir} className={SECUNDARIO} data-testid={`pixel-${id}-adicionar`}>{adicionar}</button>
        )}
      </div>
    </section>
  )
}
