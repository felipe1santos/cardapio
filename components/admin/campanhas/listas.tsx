'use client'

import { useEffect, useMemo, useState } from 'react'
import { Ban, Copy, Eye, Image as ImageIcon, ListChecks, Mic, MessageSquareText, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { Campanha, TipoMensagem } from '@/lib/queries/campanhas'
import { progressoCampanha, situacaoCampanha } from '@/lib/mensageria/campanhas'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { DetalheCampanha, type MetricaCampanha } from '@/components/admin/campanhas-metricas'
import { IlustracaoVazio, Paginacao, SeloStatusCampanha, formatarDataHora, formatarDiaSemana } from './comum'

/** Campanhas e Agendamentos (repaginação 2026-10). A lógica de salvar/cancelar fica na página. */

export interface AcoesCampanha {
  onVer: (c: Campanha) => void
  onEditar: (c: Campanha) => void
  onDuplicar: (c: Campanha) => void
  onCancelar: (c: Campanha) => void
  onExcluir: (c: Campanha) => void
}

const TIPO: Record<TipoMensagem, { rotulo: string; icone: typeof MessageSquareText }> = {
  texto: { rotulo: 'Texto', icone: MessageSquareText },
  imagem: { rotulo: 'Imagem + texto', icone: ImageIcon },
  audio: { rotulo: 'Áudio', icone: Mic },
}

const editavel = (c: Campanha) => c.status === 'rascunho' || c.status === 'agendada'
const cancelavel = (c: Campanha) => c.status === 'agendada' || c.status === 'enviando'
const excluivel = (c: Campanha) => c.status === 'rascunho' || c.status === 'concluida' || c.status === 'cancelada'

function Progresso({ c }: { c: Campanha }) {
  const p = progressoCampanha(c)
  if (!p.total) return <span className="text-[12px] text-[#9ca3af]">—</span>
  const w = (n: number) => `${(n / p.total) * 100}%`
  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex h-1.5 w-20 overflow-hidden rounded-full bg-[#e5e7eb]">
          <div className="h-full bg-[#10B981]" style={{ width: w(p.enviados) }} />
          <div className="h-full bg-[#EF4444]" style={{ width: w(p.falhas) }} />
        </div>
        <span className="text-[12px] tabular-nums text-[#5b6472]">{p.enviados}/{p.total}</span>
      </div>
      {p.falhas > 0 && <span className="mt-0.5 block text-[11px] text-[#b91c1c]">{p.falhas} {p.falhas === 1 ? 'falha' : 'falhas'}</span>}
      {c.status === 'pausada' && <span className="mt-0.5 block text-[11px] text-[#b45309]">WhatsApp desconectado — volta sozinha ao reconectar</span>}
    </div>
  )
}

function BotaoAcao({ titulo, onClick, icone: Icone, perigo, testid }: { titulo: string; onClick: () => void; icone: typeof Eye; perigo?: boolean; testid: string }) {
  return (
    <button type="button" title={titulo} aria-label={titulo} onClick={onClick} className={`equipe-acao toque-icone ${perigo ? 'perigo' : ''}`} data-testid={testid}>
      <Icone className="h-4 w-4" />
    </button>
  )
}

function Acoes({ c, a, destinatarios }: { c: Campanha; a: AcoesCampanha; destinatarios?: () => void }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      {editavel(c) ? <BotaoAcao titulo="Editar" icone={Pencil} onClick={() => a.onEditar(c)} testid="campanha-editar" /> : <BotaoAcao titulo="Ver mensagem" icone={Eye} onClick={() => a.onVer(c)} testid="campanha-ver" />}
      <BotaoAcao titulo="Duplicar" icone={Copy} onClick={() => a.onDuplicar(c)} testid="campanha-duplicar" />
      {destinatarios && <BotaoAcao titulo="Ver destinatários" icone={ListChecks} onClick={destinatarios} testid="campanha-destinatarios" />}
      {cancelavel(c) && <BotaoAcao titulo="Cancelar envio" icone={Ban} perigo onClick={() => a.onCancelar(c)} testid="campanha-cancelar" />}
      {excluivel(c) && <BotaoAcao titulo="Excluir" icone={Trash2} perigo onClick={() => a.onExcluir(c)} testid="campanha-excluir" />}
    </div>
  )
}

function Vazio({ titulo, texto, onNovo }: { titulo: string; texto: string; onNovo?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" data-testid="lista-vazia">
      <IlustracaoVazio />
      <p className="mt-3 text-[15px] font-semibold text-[#374151]">{titulo}</p>
      <p className="mt-1 text-[12.5px] text-[#5b6472]">{texto}</p>
      {onNovo && <button type="button" onClick={onNovo} className="mt-4 h-10 rounded-[5px] bg-[#0688d4] px-4 text-[13px] font-semibold text-white hover:bg-[#0570ae]">Disparar mensagem</button>}
    </div>
  )
}

// ─── Campanhas ───────────────────────────────────────────────────────────────

const FILTRO_STATUS: { id: string; rotulo: string; casa: (s: string) => boolean }[] = [
  { id: 'todas', rotulo: 'Todos os status', casa: () => true },
  { id: 'agendada', rotulo: 'Agendadas', casa: (s) => s === 'agendada' },
  { id: 'enviando', rotulo: 'Enviando ou pausadas', casa: (s) => s === 'enviando' || s === 'pausada' },
  { id: 'concluida', rotulo: 'Processadas', casa: (s) => s === 'concluida' || s === 'concluida_com_falhas' },
  { id: 'falhou', rotulo: 'Com falha', casa: (s) => s === 'falhou' || s === 'concluida_com_falhas' },
  { id: 'cancelada', rotulo: 'Canceladas', casa: (s) => s === 'cancelada' },
  { id: 'rascunho', rotulo: 'Rascunhos', casa: (s) => s === 'rascunho' },
]

export function ListaCampanhas({ campanhas, carregando, acoes, onNovo }: { campanhas: Campanha[]; carregando: boolean; acoes: AcoesCampanha; onNovo: () => void }) {
  const [busca, setBusca] = useState('')
  const [status, setStatus] = useState('todas')
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState(10)
  const termo = busca.trim().toLowerCase()
  const filtradas = useMemo(() => {
    const f = FILTRO_STATUS.find((x) => x.id === status)!
    return campanhas.filter((c) => f.casa(situacaoCampanha(c)) && (!termo || c.nome.toLowerCase().includes(termo) || c.mensagem.toLowerCase().includes(termo)))
  }, [campanhas, status, termo])
  useEffect(() => setPagina(0), [termo, status])
  const visiveis = filtradas.slice(pagina * porPagina, (pagina + 1) * porPagina)

  return (
    <div className="space-y-3" data-testid="lista-campanhas">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-[340px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar campanha" className="campanha-busca w-full" data-testid="busca-campanha" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="campanha-filtro" data-testid="filtro-status" aria-label="Filtrar por status">
          {FILTRO_STATUS.map((f) => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
        </select>
      </div>

      <section className="overflow-hidden rounded-[6px] border border-[#e5e7eb] bg-white">
        {carregando ? <p className="px-4 py-8 text-center text-[13px] text-[#5b6472]">Carregando…</p>
          : filtradas.length === 0 ? <Vazio titulo={campanhas.length ? 'Nenhuma campanha encontrada' : 'Nenhuma campanha ainda'} texto={campanhas.length ? 'Mude a busca ou o filtro de status.' : 'Monte a primeira mensagem para seus clientes.'} onNovo={campanhas.length ? undefined : onNovo} />
          : (
            <>
              {/* Celular: cartão por campanha. */}
              <ul className="divide-y divide-[#f0f1f3] lg:hidden">
                {visiveis.map((c) => {
                  const T = TIPO[c.tipoMensagem]
                  return (
                    <li key={c.id} className="p-3.5" data-testid="campanha-cartao">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 break-words text-[14px] font-semibold text-[#1f2937]">{c.nome}</span>
                        <SeloStatusCampanha status={situacaoCampanha(c)} />
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[#5b6472]"><T.icone className="h-3.5 w-3.5" />{T.rotulo} · {formatarDataHora(c.agendadoEm ?? c.criadoEm)}</div>
                      <div className="mt-2"><Progresso c={c} /></div>
                      <div className="mt-2 border-t border-[#f0f1f3] pt-1.5"><Acoes c={c} a={acoes} /></div>
                    </li>
                  )
                })}
              </ul>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b border-[#e5e7eb] bg-[#f9fafb] text-[12px] font-semibold text-[#5b6472]">
                    <tr><th className="px-4 py-3">Campanha</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Envio</th><th className="px-4 py-3">Progresso</th><th className="px-4 py-3 text-right">Ações</th></tr>
                  </thead>
                  <tbody>
                    {visiveis.map((c) => {
                      const T = TIPO[c.tipoMensagem]
                      return (
                        <tr key={c.id} className="campanha-linha border-b border-[#f0f1f3] last:border-0" data-testid="campanha-linha" data-nome={c.nome}>
                          <td className="max-w-[300px] px-4 py-3">
                            <div className="truncate font-semibold text-[#1f2937]">{c.nome}</div>
                            <div className="truncate text-[12px] text-[#6b7280]">{c.mensagem || (c.tipoMensagem === 'audio' ? 'Mensagem de voz' : '')}</div>
                          </td>
                          <td className="px-4 py-3"><SeloStatusCampanha status={situacaoCampanha(c)} /></td>
                          <td className="px-4 py-3 text-[#5b6472]"><span className="inline-flex items-center gap-1.5"><T.icone className="h-4 w-4" />{T.rotulo}</span></td>
                          <td className="whitespace-nowrap px-4 py-3 text-[#374151]">{formatarDataHora(c.agendadoEm ?? c.criadoEm)}</td>
                          <td className="px-4 py-3"><Progresso c={c} /></td>
                          <td className="px-4 py-2"><Acoes c={c} a={acoes} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Paginacao total={filtradas.length} pagina={pagina} porPagina={porPagina} onPagina={setPagina} onPorPagina={setPorPagina} />
            </>
          )}
      </section>
    </div>
  )
}

// ─── Agendamentos ────────────────────────────────────────────────────────────

const GRUPOS = {
  ativas: { rotulo: 'Ativas', casa: (s: string) => s === 'agendada' || s === 'enviando' || s === 'pausada', fundo: '#DCFCE7', cor: '#15803D', borda: '#86EFAC' },
  processadas: { rotulo: 'Processadas', casa: (s: string) => s === 'concluida' || s === 'concluida_com_falhas' || s === 'falhou', fundo: '#F1F5F9', cor: '#334155', borda: '#CBD5E1' },
  canceladas: { rotulo: 'Canceladas', casa: (s: string) => s === 'cancelada', fundo: '#FEE2E2', cor: '#B91C1C', borda: '#FCA5A5' },
} as const
type Grupo = keyof typeof GRUPOS

interface UltimoEnvio { ultimo_envio: string | null; enviadas: number; falhas: number }

export function Agendamentos({ campanhas, carregando, acoes, onNovo }: { campanhas: Campanha[]; carregando: boolean; acoes: AcoesCampanha; onNovo: () => void }) {
  const [busca, setBusca] = useState('')
  const [grupo, setGrupo] = useState<Grupo | null>(null)
  const [filtroAberto, setFiltroAberto] = useState(false)
  const [tipo, setTipo] = useState<TipoMensagem | ''>('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState(10)
  const [ultimos, setUltimos] = useState<Record<string, UltimoEnvio>>({})
  const [detalhe, setDetalhe] = useState<MetricaCampanha | null>(null)
  const [erroDetalhe, setErroDetalhe] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    getBrowserSupabase().rpc('campanhas_ultimo_envio').then(({ data }) => {
      if (!vivo || !Array.isArray(data)) return
      setUltimos(Object.fromEntries((data as (UltimoEnvio & { campanha_id: string })[]).map((u) => [u.campanha_id, u])))
    }, () => {})
    return () => { vivo = false }
  }, [campanhas])

  const agendadas = useMemo(() => campanhas.filter((c) => !!c.agendadoEm), [campanhas])
  const termo = busca.trim().toLowerCase()
  const filtradas = useMemo(() => agendadas
    .filter((c) => !grupo || GRUPOS[grupo].casa(situacaoCampanha(c)))
    .filter((c) => !termo || c.nome.toLowerCase().includes(termo))
    .filter((c) => !tipo || c.tipoMensagem === tipo)
    .filter((c) => !de || (c.agendadoEm ?? '') >= new Date(`${de}T00:00:00`).toISOString())
    .filter((c) => !ate || (c.agendadoEm ?? '') <= new Date(`${ate}T23:59:59`).toISOString())
    .sort((a, b) => (b.agendadoEm ?? '').localeCompare(a.agendadoEm ?? '')), [agendadas, grupo, termo, tipo, de, ate])
  useEffect(() => setPagina(0), [termo, grupo, tipo, de, ate])
  const visiveis = filtradas.slice(pagina * porPagina, (pagina + 1) * porPagina)
  const filtrosAtivos = [tipo, de, ate].filter(Boolean).length

  async function verDestinatarios(c: Campanha) {
    setErroDetalhe(null)
    const inicio = new Date(new Date(c.agendadoEm ?? c.criadoEm).getTime() - 86_400_000).toISOString()
    const r = await fetch(`/api/admin/campanhas/metricas?de=${inicio}&ate=${new Date().toISOString()}&campanha=${c.id}`)
    const j = await r.json().catch(() => null)
    const m = j?.campanhas?.[0] as MetricaCampanha | undefined
    if (!r.ok || !m) { setErroDetalhe(j?.error ?? 'Não foi possível abrir os destinatários.'); return }
    setDetalhe(m)
  }

  return (
    <div className="space-y-3" data-testid="agendamentos">
      <section className="space-y-3 rounded-[6px] border border-[#e5e7eb] bg-white p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-[300px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome da campanha" className="campanha-busca w-full" data-testid="busca-agendamento" />
          </div>
          <div className="relative">
            <button type="button" onClick={() => setFiltroAberto((v) => !v)} className="inline-flex h-10 items-center gap-1.5 rounded-[5px] border border-[#d6dae1] bg-white px-3 text-[13px] font-semibold text-[#374151] hover:border-[#0688d4]" data-testid="mais-filtro">
              <Plus className="h-4 w-4" /> Filtro{filtrosAtivos > 0 && <span className="ml-1 rounded-full bg-[#0688d4] px-1.5 text-[11px] text-white">{filtrosAtivos}</span>}
            </button>
            {filtroAberto && (
              <div className="absolute left-0 top-[46px] z-30 w-[280px] space-y-3 rounded-[8px] border border-[#e5e7eb] bg-white p-3.5 shadow-[0_12px_32px_rgba(15,23,42,0.16)]" data-testid="painel-filtro">
                <label className="block text-[11.5px] font-semibold text-[#5b6472]">Tipo de mensagem
                  <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoMensagem | '')} className="campanha-filtro mt-1 w-full" data-testid="filtro-tipo">
                    <option value="">Todos</option><option value="texto">Texto</option><option value="imagem">Imagem + texto</option><option value="audio">Áudio</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2 text-[11.5px] font-semibold text-[#5b6472]">
                  <label>Programada de<input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="campanha-data mt-1 w-full" /></label>
                  <label>até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="campanha-data mt-1 w-full" /></label>
                </div>
                <div className="flex justify-between">
                  <button type="button" className="text-[12.5px] font-semibold text-[#5b6472] hover:text-[#1f2937]" onClick={() => { setTipo(''); setDe(''); setAte('') }}>Limpar</button>
                  <button type="button" className="text-[12.5px] font-semibold text-[#0688d4]" onClick={() => setFiltroAberto(false)}>Pronto</button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por situação">
          {(Object.keys(GRUPOS) as Grupo[]).map((g) => {
            const G = GRUPOS[g]
            const n = agendadas.filter((c) => G.casa(situacaoCampanha(c))).length
            const on = grupo === g
            return (
              <button key={g} type="button" onClick={() => setGrupo(on ? null : g)} aria-pressed={on} data-testid={`contador-${g}`}
                className="inline-flex h-9 items-center overflow-hidden rounded-[6px] border-2 text-[13px] font-semibold transition-shadow" style={{ borderColor: on ? G.cor : G.borda, boxShadow: on ? `0 0 0 2px ${G.fundo}` : undefined }}>
                <span className="flex h-full min-w-[34px] items-center justify-center px-2 tabular-nums" style={{ backgroundColor: G.fundo, color: G.cor }} data-n>{n}</span>
                <span className="bg-white px-3" style={{ color: G.cor }}>{G.rotulo}</span>
              </button>
            )
          })}
        </div>
      </section>
      {erroDetalhe && <p className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-4 py-2.5 text-[13px] text-[#b91c1c]">{erroDetalhe}</p>}

      <section className="overflow-hidden rounded-[6px] border border-[#e5e7eb] bg-white">
        {carregando ? <p className="px-4 py-8 text-center text-[13px] text-[#5b6472]">Carregando…</p>
          : filtradas.length === 0 ? <Vazio titulo={agendadas.length ? 'Nenhum agendamento encontrado' : 'Nenhum agendamento'} texto={agendadas.length ? 'Mude a busca ou os filtros.' : 'Programe uma mensagem para um dia e horário.'} onNovo={agendadas.length ? undefined : onNovo} />
          : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[13px]" data-testid="tabela-agendamentos">
                  <thead className="border-b border-[#e5e7eb] bg-[#f9fafb] text-[12px] font-semibold text-[#5b6472]">
                    <tr><th className="px-4 py-3">Campanha</th><th className="px-4 py-3">Status</th><th className="hidden px-4 py-3 2xl:table-cell">Data de criação</th><th className="px-4 py-3">Programada para</th><th className="px-4 py-3">Enviada em</th><th className="px-4 py-3 text-right">Ações</th></tr>
                  </thead>
                  <tbody>
                    {visiveis.map((c) => {
                      const u = ultimos[c.id]
                      const s = situacaoCampanha(c)
                      return (
                        <tr key={c.id} className="campanha-linha border-b border-[#f0f1f3] last:border-0" data-testid="agendamento-linha" data-nome={c.nome}>
                          <td className="max-w-[280px] px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <Miniatura c={c} />
                              <div className="min-w-0">
                                <div className="truncate font-semibold uppercase tracking-[0.01em] text-[#1f2937]">{c.nome}</div>
                                <div className="truncate text-[12px] text-[#6b7280]">{c.mensagem || 'Mensagem de voz'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3"><SeloStatusCampanha status={s} /></td>
                          <td className="hidden whitespace-nowrap px-4 py-3 text-[#374151] 2xl:table-cell">{formatarDataHora(c.criadoEm)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-[#374151]">{formatarDiaSemana(c.agendadoEm)}<div className="text-[12px] text-[#6b7280]">{c.agendadoEm ? new Date(c.agendadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</div></td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {u?.ultimo_envio ? (
                              <>
                                <div className="text-[#374151]">{formatarDiaSemana(u.ultimo_envio)}</div>
                                <div className="flex items-center gap-1.5 text-[12px]">
                                  {new Date(u.ultimo_envio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  <span className={`inline-flex items-center gap-1 font-semibold ${u.falhas > 0 ? 'text-[#c2410c]' : 'text-[#15803d]'}`} data-testid="resultado-envio">
                                    <span className={`h-1.5 w-1.5 rounded-full ${u.falhas > 0 ? 'bg-[#f97316]' : 'bg-[#10b981]'}`} />
                                    {u.falhas > 0 ? `${u.enviadas} ok, ${u.falhas} falhas` : 'Sucesso'}
                                  </span>
                                </div>
                              </>
                            ) : <span className="rounded-[4px] bg-[#f1f5f9] px-2 py-[3px] text-[12px] text-[#64748b]">Sem dados</span>}
                          </td>
                          <td className="px-4 py-2"><Acoes c={c} a={acoes} destinatarios={() => void verDestinatarios(c)} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Paginacao total={filtradas.length} pagina={pagina} porPagina={porPagina} onPagina={setPagina} onPorPagina={setPorPagina} />
            </>
          )}
      </section>
      {detalhe && <DetalheCampanha campanha={detalhe} onClose={() => setDetalhe(null)} />}
    </div>
  )
}

function Miniatura({ c }: { c: Campanha }) {
  if (c.tipoMensagem === 'imagem' && c.imagemUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={c.imagemUrl} alt="" loading="lazy" className="h-10 w-10 flex-shrink-0 rounded-[5px] border border-[#e5e7eb] object-cover" />
  }
  const T = TIPO[c.tipoMensagem]
  return <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[5px] bg-[#E0F2FE] text-[#0688d4]"><T.icone className="h-5 w-5" /></span>
}

export function FecharX({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label="Fechar" className="text-[#6b7280] hover:text-[#1f2937]"><X className="h-5 w-5" /></button>
}
