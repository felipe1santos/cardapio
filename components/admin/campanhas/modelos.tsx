'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Pencil, Plus, Send, Trash2, X } from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { problemasDasVariaveis } from '@/lib/mensageria/campanhas'
import { Confirmar, IlustracaoVazio, TextoComVariaveis } from './comum'

/** Modelos de mensagem (0129): textos prontos para começar uma campanha. RLS: dono/gerente da loja. */

export interface ModeloMensagem { id: string; nome: string; mensagem: string; imagem_url: string | null; atualizado_em: string }

export function useModelos(restauranteId: string | null) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [modelos, setModelos] = useState<ModeloMensagem[]>([])
  const [carregando, setCarregando] = useState(true)
  const carregar = useCallback(async () => {
    if (!restauranteId) return
    const { data } = await supabase.from('campanha_modelos').select('id, nome, mensagem, imagem_url, atualizado_em').eq('restaurante_id', restauranteId).order('atualizado_em', { ascending: false })
    setModelos((data ?? []) as ModeloMensagem[])
    setCarregando(false)
  }, [supabase, restauranteId])
  useEffect(() => { void carregar() }, [carregar])

  async function salvar(m: { id?: string; nome: string; mensagem: string; imagem_url?: string | null }): Promise<string | null> {
    if (!restauranteId) return 'Loja não encontrada.'
    const linha = { nome: m.nome.trim(), mensagem: m.mensagem, imagem_url: m.imagem_url ?? null, atualizado_em: new Date().toISOString() }
    const { error } = m.id
      ? await supabase.from('campanha_modelos').update(linha).eq('id', m.id)
      : await supabase.from('campanha_modelos').insert({ ...linha, restaurante_id: restauranteId })
    if (error) return 'Não foi possível salvar o modelo.'
    await carregar()
    return null
  }
  async function excluir(id: string): Promise<string | null> {
    const { error } = await supabase.from('campanha_modelos').delete().eq('id', id)
    if (error) return 'Não foi possível excluir.'
    await carregar()
    return null
  }
  return { modelos, carregando, salvar, excluir }
}

export function Modelos({ api, onUsar, onToast }: { api: ReturnType<typeof useModelos>; onUsar: (m: ModeloMensagem) => void; onToast: (tom: 'ok' | 'erro', t: string) => void }) {
  const [editor, setEditor] = useState<{ id?: string; nome: string; mensagem: string; imagem_url: string | null } | null>(null)
  const [excluir, setExcluir] = useState<ModeloMensagem | null>(null)
  return (
    <div className="space-y-3" data-testid="modelos">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-[#5b6472]">Textos prontos para começar uma campanha sem digitar tudo de novo.</p>
        <button type="button" onClick={() => setEditor({ nome: '', mensagem: '', imagem_url: null })} className="inline-flex h-10 items-center gap-1.5 rounded-[5px] bg-[#0688d4] px-4 text-[13px] font-semibold text-white hover:bg-[#0570ae]" data-testid="novo-modelo">
          <Plus className="h-4 w-4" /> Novo modelo
        </button>
      </div>
      {api.carregando ? <p className="text-[13px] text-[#5b6472]">Carregando…</p>
        : api.modelos.length === 0 ? (
          <div className="flex flex-col items-center rounded-[6px] border border-[#e5e7eb] bg-white px-6 py-12 text-center" data-testid="modelos-vazio">
            <IlustracaoVazio />
            <p className="mt-3 text-[15px] font-semibold text-[#374151]">Nenhum modelo ainda</p>
            <p className="mt-1 text-[12.5px] text-[#5b6472]">Crie aqui ou use “Salvar como modelo” ao montar uma campanha.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {api.modelos.map((m) => (
              <article key={m.id} className="campanha-cartao flex flex-col rounded-[6px] border border-[#e5e7eb] bg-white" data-testid="modelo-cartao" data-nome={m.nome}>
                <header className="flex items-center gap-3 px-4 pt-4">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[8px] bg-[#E0F2FE] text-[#0688d4]"><FileText className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <h4 className="truncate text-[14px] font-bold text-[#1f2937]">{m.nome}</h4>
                    <p className="text-[11.5px] text-[#6b7280]">Atualizado em {new Date(m.atualizado_em).toLocaleDateString('pt-BR')}</p>
                  </div>
                </header>
                <div className="mx-4 mt-3 line-clamp-4 flex-1 rounded-[6px] bg-[#f9fafb] px-3 py-2.5 text-[12.5px] leading-relaxed text-[#374151]"><TextoComVariaveis texto={m.mensagem} /></div>
                <footer className="mt-3 flex items-center justify-between border-t border-[#f0f1f3] px-3 py-2">
                  <div className="flex gap-0.5">
                    <button type="button" className="equipe-acao toque-icone" title="Editar" aria-label={`Editar ${m.nome}`} onClick={() => setEditor({ id: m.id, nome: m.nome, mensagem: m.mensagem, imagem_url: m.imagem_url })} data-testid="modelo-editar"><Pencil className="h-4 w-4" /></button>
                    <button type="button" className="equipe-acao perigo toque-icone" title="Excluir" aria-label={`Excluir ${m.nome}`} onClick={() => setExcluir(m)} data-testid="modelo-excluir"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] font-semibold text-[#0688d4] hover:bg-[#eef6fc]" onClick={() => onUsar(m)} data-testid="modelo-usar"><Send className="h-3.5 w-3.5" /> Usar modelo</button>
                </footer>
              </article>
            ))}
          </div>
        )}

      {editor && (
        <EditorModelo inicial={editor} onCancelar={() => setEditor(null)} onSalvar={async (m) => {
          const e = await api.salvar(m)
          if (e) return e
          onToast('ok', m.id ? 'Modelo atualizado.' : 'Modelo criado.')
          setEditor(null)
          return null
        }} />
      )}
      {excluir && (
        <Confirmar titulo="Excluir modelo" texto={`O modelo "${excluir.nome}" será apagado. Campanhas já enviadas não mudam.`} botao="Excluir" perigo onCancelar={() => setExcluir(null)}
          onConfirmar={async () => { const m = excluir; setExcluir(null); const e = await api.excluir(m.id); onToast(e ? 'erro' : 'ok', e ?? 'Modelo excluído.') }} />
      )}
    </div>
  )
}

function EditorModelo({ inicial, onCancelar, onSalvar }: { inicial: { id?: string; nome: string; mensagem: string; imagem_url: string | null }; onCancelar: () => void; onSalvar: (m: { id?: string; nome: string; mensagem: string; imagem_url: string | null }) => Promise<string | null> }) {
  const [nome, setNome] = useState(inicial.nome)
  const [mensagem, setMensagem] = useState(inicial.mensagem)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  async function salvar() {
    if (!nome.trim()) { setErro('Dê um nome ao modelo.'); return }
    if (!mensagem.trim()) { setErro('Escreva a mensagem.'); return }
    const v = problemasDasVariaveis(mensagem, { incluirLink: true })
    if (v) { setErro(v); return }
    setSalvando(true)
    const e = await onSalvar({ id: inicial.id, nome, mensagem, imagem_url: inicial.imagem_url })
    setSalvando(false)
    if (e) setErro(e)
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4" onMouseDown={onCancelar}>
      <div role="dialog" aria-modal="true" className="w-full max-w-[560px] overflow-hidden rounded-[8px] bg-white shadow-[0_24px_64px_rgba(15,23,42,0.28)]" onMouseDown={(e) => e.stopPropagation()} data-testid="editor-modelo">
        <div className="flex h-[54px] items-center justify-between border-b border-[#e5e7eb] px-5">
          <span className="text-[15px] font-bold text-[#1f2937]">{inicial.id ? 'Editar modelo' : 'Novo modelo'}</span>
          <button type="button" onClick={onCancelar} aria-label="Fechar" className="text-[#6b7280] hover:text-[#1f2937]"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 p-5">
          <label className="cf"><input className="cf-campo" placeholder=" " value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} data-testid="modelo-nome" /><span className="cf-rotulo">Nome do modelo</span></label>
          <label className="cf"><textarea className="cf-campo" placeholder=" " rows={6} value={mensagem} onChange={(e) => setMensagem(e.target.value)} data-testid="modelo-mensagem" /><span className="cf-rotulo">Mensagem</span></label>
          <p className="text-[12px] text-[#5b6472]">Use <code className="rounded bg-[#E0F2FE] px-1 text-[#0570AE]">{'{nome}'}</code> para o primeiro nome do cliente e <code className="rounded bg-[#E0F2FE] px-1 text-[#0570AE]">{'{link}'}</code> para o link do cardápio. *negrito* e _itálico_ funcionam no WhatsApp.</p>
          {erro && <p className="text-[12.5px] font-semibold text-[#b91c1c]" data-testid="modelo-erro">{erro}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e5e7eb] px-5 py-3">
          <button type="button" className="h-10 rounded-[5px] border border-[#d6dae1] px-4 text-[13px] font-semibold text-[#374151] hover:bg-[#f3f4f6]" onClick={onCancelar}>Cancelar</button>
          <button type="button" disabled={salvando} className="h-10 rounded-[5px] bg-[#0688d4] px-4 text-[13px] font-semibold text-white hover:bg-[#0570ae] disabled:opacity-50" onClick={() => void salvar()} data-testid="modelo-salvar">{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
