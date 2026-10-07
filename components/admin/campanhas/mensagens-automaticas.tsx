'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Info, RotateCcw } from 'lucide-react'
import { ToggleSwitch } from '@/components/admin/campos-ajustes'
import { problemaNoTexto, type Etapa, type TipoAutomatico } from '@/lib/mensagens-automaticas'
import { TextoComVariaveis } from './comum'

/**
 * Mensagens automáticas de status (0129). Um cartão por etapa do pedido: liga/desliga,
 * texto com as variáveis destacadas, "Mensagem padrão" e editor com "Restaurar padrão".
 * Sem mexer em nada, sai exatamente o que já saía.
 */

interface ConfigTela {
  ativo: boolean
  tipos: Record<TipoAutomatico, boolean>
  etapas: Record<Etapa, { ativo: boolean; texto: string | null }>
}
interface Resposta {
  config: ConfigTela
  padrao: Partial<Record<Etapa, string>>
  etapas: { chave: Etapa; titulo: string; quando: string; personalizavel: boolean }[]
  variaveis: { chave: string; rotulo: string }[]
  whatsappConectado: boolean
}

const TIPOS: { chave: TipoAutomatico; rotulo: string }[] = [
  { chave: 'entrega', rotulo: 'Entrega' },
  { chave: 'retirada', rotulo: 'Retirada' },
  { chave: 'local', rotulo: 'Consumo no local' },
]

export function MensagensAutomaticas({ onToast, onAtivoMudou }: { onToast: (tom: 'ok' | 'erro', texto: string) => void; onAtivoMudou?: (ativo: boolean) => void }) {
  const [dados, setDados] = useState<Resposta | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [editando, setEditando] = useState<Etapa | null>(null)
  const [rascunho, setRascunho] = useState('')
  const [salvando, setSalvando] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/campanhas/automaticas', { cache: 'no-store' })
    const j = await r.json().catch(() => null)
    if (!r.ok) { setErro(j?.error ?? 'Não foi possível carregar.'); return }
    setDados(j)
    onAtivoMudou?.(j.config.ativo)
  }, [onAtivoMudou])
  useEffect(() => { void carregar() }, [carregar])

  async function gravar(config: ConfigTela, msg: string): Promise<boolean> {
    // Otimista: a chave muda na hora; se o servidor recusar, volta ao que era.
    const anterior = dados?.config
    setDados((d) => (d ? { ...d, config } : d))
    setSalvando(true)
    const r = await fetch('/api/admin/campanhas/automaticas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) })
    const j = await r.json().catch(() => null)
    setSalvando(false)
    if (!r.ok) {
      if (anterior) setDados((d) => (d ? { ...d, config: anterior } : d))
      onToast('erro', j?.error ?? 'Não foi possível salvar.')
      return false
    }
    setDados((d) => (d ? { ...d, config: j.config } : d))
    onAtivoMudou?.(j.config.ativo)
    onToast('ok', msg)
    return true
  }

  if (erro) return <p className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">{erro}</p>
  if (!dados) return <p className="text-[13px] text-[#5b6472]">Carregando…</p>
  const cfg = dados.config

  const inserirVariavel = (chave: string) => {
    const el = area.current
    const v = `{${chave}}`
    if (!el) { setRascunho((t) => t + v); return }
    const ini = el.selectionStart ?? rascunho.length
    const fim = el.selectionEnd ?? ini
    const novo = rascunho.slice(0, ini) + v + rascunho.slice(fim)
    setRascunho(novo)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(ini + v.length, ini + v.length) })
  }

  const problema = editando ? problemaNoTexto(rascunho) : null

  return (
    <div className="space-y-3" data-testid="mensagens-automaticas">
      {/* Geral */}
      <section className="campanha-cartao rounded-[6px] border border-[#e5e7eb] bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-[#eef0f3] px-4 py-3.5">
          <div>
            <h3 className="text-[14px] font-semibold text-[#1f2937]">Avisos de status do pedido</h3>
            <p className="mt-0.5 text-[12.5px] text-[#5b6472]">O cliente recebe no WhatsApp cada etapa do pedido, sempre que o WhatsApp da loja estiver conectado. Edite os textos abaixo.</p>
            {/* Sem chave geral desde a noite 5: loja que já tinha desligado continua sem envio até o suporte decidir. */}
            {cfg.ativo === false && <p className="mt-1.5 inline-flex rounded-[4px] bg-[#fff7ed] px-2 py-1 text-[12px] font-semibold text-[#9a3412]" data-testid="envio-pausado-suporte">Envio pausado nesta loja. Fale com o suporte para religar.</p>}
          </div>
        </div>
        <div className="grid gap-4 px-4 py-3.5 md:grid-cols-2">
          {!dados.whatsappConectado ? (
            <div className="flex gap-2.5 rounded-[6px] border border-[#bae6fd] bg-[#f0f9ff] px-3.5 py-3 text-[12.5px] text-[#0369a1]">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p><strong>WhatsApp da loja não conectado.</strong> As mensagens só saem depois de conectar em Integrações › WhatsApp.</p>
            </div>
          ) : (
            <div className="flex gap-2.5 rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] px-3.5 py-3 text-[12.5px] text-[#15803d]">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>WhatsApp da loja conectado. As mensagens saem pelo número da loja.</p>
            </div>
          )}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#5b6472]">Enviar para os tipos de pedido</div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {TIPOS.map((t) => (
                <label key={t.chave} className="inline-flex cursor-pointer items-center gap-2 text-[13.5px] text-[#1f2937]">
                  <input type="checkbox" className="h-4 w-4 accent-[#0688d4]" checked={cfg.tipos[t.chave]} disabled={salvando || !cfg.ativo} data-testid={`tipo-${t.chave}`}
                    onChange={(e) => void gravar({ ...cfg, tipos: { ...cfg.tipos, [t.chave]: e.target.checked } }, `${t.rotulo}: ${e.target.checked ? 'recebe' : 'não recebe mais'} as mensagens.`)} />
                  {t.rotulo}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Etapas */}
      {dados.etapas.map((e) => {
        const est = cfg.etapas[e.chave]
        const textoAtual = est.texto ?? dados.padrao[e.chave] ?? ''
        const aberto = editando === e.chave
        return (
          <section key={e.chave} className={`campanha-cartao rounded-[6px] border border-[#e5e7eb] bg-white ${!cfg.ativo ? 'opacity-60' : ''}`} data-testid={`etapa-${e.chave}`} data-ativo={est.ativo ? 'sim' : 'nao'}>
            <div className="flex items-center justify-between gap-3 border-b border-[#eef0f3] px-4 py-3">
              <div className="min-w-0">
                <h4 className="text-[14px] font-semibold text-[#1f2937]">{e.titulo}</h4>
                <p className="text-[12px] text-[#6b7280]">{e.quando}</p>
              </div>
              <div className="flex items-center gap-2.5">
                <SeloAtivo ativo={est.ativo} />
                <ToggleSwitch checked={est.ativo} disabled={salvando || !cfg.ativo} rotulo={e.titulo}
                  onChange={(v) => void gravar({ ...cfg, etapas: { ...cfg.etapas, [e.chave]: { ...est, ativo: v } } }, `${e.titulo}: ${v ? 'ligada' : 'desligada'}.`)} />
              </div>
            </div>
            <div className="px-4 py-3.5">
              {!e.personalizavel ? (
                <p className="rounded-[6px] border border-[#eef0f3] bg-[#f9fafb] px-3.5 py-3 text-[13px] text-[#5b6472]">Resumo completo do pedido (itens, total, pagamento e endereço). Essa mensagem não permite personalização.</p>
              ) : aberto ? (
                <div className="space-y-2.5">
                  <textarea ref={area} value={rascunho} onChange={(ev) => setRascunho(ev.target.value)} rows={4} className="campanha-texto w-full" data-testid="editor-texto" aria-invalid={!!problema} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] text-[#5b6472]">Inserir:</span>
                    {dados.variaveis.filter((v) => v.chave !== 'horario' || e.chave === 'agendado').map((v) => (
                      <button key={v.chave} type="button" onClick={() => inserirVariavel(v.chave)} title={v.rotulo} className="h-7 rounded-[4px] border border-[#bae6fd] bg-[#f0f9ff] px-2 text-[12px] font-semibold text-[#0570ae] hover:border-[#0688d4]" data-testid={`var-${v.chave}`}>{`{${v.chave}}`}</button>
                    ))}
                  </div>
                  {problema && <p className="text-[12px] font-semibold text-[#b91c1c]" data-testid="erro-texto">{problema}</p>}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#5b6472] hover:text-[#0688d4]" onClick={() => setRascunho(dados.padrao[e.chave] ?? '')} data-testid="restaurar-padrao">
                      <RotateCcw className="h-3.5 w-3.5" /> Restaurar padrão
                    </button>
                    <div className="flex gap-2">
                      <button type="button" className="h-9 rounded-[5px] border border-[#d6dae1] px-4 text-[13px] font-semibold text-[#374151] hover:bg-[#f3f4f6]" onClick={() => setEditando(null)}>Cancelar</button>
                      <button type="button" disabled={!!problema || salvando} className="h-9 rounded-[5px] bg-[#0688d4] px-4 text-[13px] font-semibold text-white hover:bg-[#0570ae] disabled:opacity-50" data-testid="salvar-texto"
                        onClick={async () => {
                          const igualPadrao = rascunho.trim() === (dados.padrao[e.chave] ?? '').trim()
                          if (await gravar({ ...cfg, etapas: { ...cfg.etapas, [e.chave]: { ...est, texto: igualPadrao ? null : rascunho } } }, igualPadrao ? `${e.titulo}: voltou à mensagem padrão.` : `${e.titulo}: mensagem salva.`)) setEditando(null)
                        }}>Salvar</button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-[6px] border border-[#e5e7eb] px-3.5 py-3 text-[13px] leading-relaxed text-[#374151]" data-testid="texto-etapa"><TextoComVariaveis texto={textoAtual} /></div>
                  <div className="mt-2.5 flex items-center justify-between">
                    {est.texto ? <span className="rounded-[4px] bg-[#E0F2FE] px-2 py-[3px] text-[11.5px] font-semibold text-[#0570AE]" data-testid="selo-personalizada">Personalizada</span>
                      : <span className="rounded-[4px] bg-[#f1f5f9] px-2 py-[3px] text-[11.5px] font-semibold text-[#64748b]" data-testid="selo-padrao">Mensagem padrão</span>}
                    <button type="button" className="h-9 rounded-[5px] border border-[#d6dae1] px-4 text-[13px] font-semibold text-[#374151] hover:border-[#0688d4] hover:text-[#0688d4]" onClick={() => { setEditando(e.chave); setRascunho(textoAtual) }} data-testid="editar-etapa">Editar</button>
                  </div>
                </>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function SeloAtivo({ ativo }: { ativo: boolean }) {
  return ativo
    ? <span className="rounded-full bg-[#DCFCE7] px-2.5 py-[3px] text-[11.5px] font-semibold text-[#15803D]" data-testid="selo-ativo">Ativo</span>
    : <span className="rounded-full bg-[#F1F5F9] px-2.5 py-[3px] text-[11.5px] font-semibold text-[#64748b]" data-testid="selo-inativo">Inativo</span>
}
