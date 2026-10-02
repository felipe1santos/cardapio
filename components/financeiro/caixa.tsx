'use client'

import { useCallback, useEffect, useState } from 'react'
import { AprovacaoPin, CampoDinheiro, Janela, botao, brl } from './apoio'
import { DESCRICAO_MOVIMENTO, MOVIMENTOS, ROTULO_MOVIMENTO, tempoAberto, type Movimento } from '@/lib/financeiro/caixa-regras'

/**
 * Financeiro › Caixa e Movimentações (Fase 2). A tela só mostra e pede; quem calcula, confere
 * permissão, limite e PIN é o servidor (/api/admin/financeiro/caixa). Quem só opera o caixa NÃO
 * vê o esperado antes de contar (contagem cega).
 */
interface Turno {
  id: string; status: string; aberto_em: string; aberto_por_nome: string | null; valor_inicial_centavos: number
  reaberto_por_nome?: string | null; reaberto_motivo?: string | null
}
interface Fechado extends Turno {
  fechado_em: string; fechado_por_nome: string | null; contado_dinheiro_centavos: number | null; contado_cartao_centavos: number | null
  esperado_dinheiro_centavos: number | null; esperado_cartao_centavos: number | null; diferenca_centavos: number | null; diferenca_cartao_centavos: number | null
  justificativa: string | null; fechamento_aprovado_por_nome: string | null; pendencias: Pendencias | null
}
interface Pendencias {
  motoboys: { entregadorId: string; nome: string; pedidos: number; emRota: number; esperadoCentavos: number | null }[]
  contasAbertas: number; pixAConferirCentavos: number | null
}
interface Linha {
  id: number; criado_em: string; carteira: string; tipo: string; valor_centavos: number; forma: string | null; origem: string
  motivo: string | null; usuario_nome: string; aprovado_por_nome: string | null
}
interface Estado {
  acoes: string[]; veValores: boolean; papel: string; limiteSaidaCentavos: number; limiteDivergenciaCentavos: number
  turno: Turno | null; ultimoFechado: Fechado | null; saldos?: Record<string, number> | null; pendencias?: Pendencias; extrato?: Linha[]
}

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const ROTULO_TIPO: Record<string, string> = {
  abertura: 'Fundo de troco', recebimento: 'Recebimento', estorno: 'Estorno', sangria: 'Sangria', reforco: 'Reforço', despesa: 'Despesa',
  retirada: 'Retirada', perda: 'Perda', ajuste: 'Ajuste do fechamento', acerto_motoboy: 'Acerto do motoboy',
}
const ROTULO_CARTEIRA: Record<string, string> = { gaveta: 'Dinheiro', cartao: 'Cartão', pix_conferir: 'Pix (a conferir)', a_receber: 'A receber', motoboy: 'Com motoboy' }

async function chamar(corpo: Record<string, unknown>) {
  const r = await fetch('/api/admin/financeiro/caixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  return { status: r.status, j: await r.json().catch(() => ({})) as Record<string, unknown> }
}

export function SecaoCaixa({ modo }: { modo: 'caixa' | 'movimentacoes' }) {
  const [e, setE] = useState<Estado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [janela, setJanela] = useState<null | 'abrir' | 'fechar' | 'reabrir' | Movimento>(null)

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/financeiro/caixa', { cache: 'no-store' }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) { setErro(j.error ?? 'Não foi possível carregar o caixa.'); return }
    setErro(null); setE(j)
  }, [])
  useEffect(() => { void carregar() }, [carregar])
  const fechar = () => { setJanela(null); void carregar(); window.dispatchEvent(new Event('menuzia:caixa-mudou')) }

  if (erro) return <p className="text-[13px] text-danger" data-testid="caixa-erro">{erro}</p>
  if (!e) return <p className="text-[13px] text-text-subtle">Carregando…</p>
  const pode = (a: string) => e.acoes.includes(a)
  const t = e.turno
  const cartao = 'rounded-[3px] border border-border bg-white'

  return (
    <>
      {/* Situação do caixa */}
      <section className={cartao} data-testid="caixa-situacao">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          {t ? (
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[14px] font-bold text-text-main">
                <span className="h-[8px] w-[8px] rounded-full bg-[#10B981]" /> Caixa aberto
                {t.status === 'reaberto' && <span className="rounded-[3px] bg-[#FEF3C7] px-1.5 py-0.5 text-[11px] font-semibold text-[#B45309]">Reaberto</span>}
              </p>
              <p className="text-[12.5px] text-text-subtle">
                Aberto por <b className="text-text-main">{t.aberto_por_nome ?? '—'}</b> em {hora(t.aberto_em)} · há {tempoAberto(t.aberto_em)} · fundo de troco {brl(t.valor_inicial_centavos)}
              </p>
              {t.status === 'reaberto' && <p className="text-[12px] text-[#B45309]">Reaberto por {t.reaberto_por_nome}: {t.reaberto_motivo}</p>}
            </div>
          ) : (
            <div>
              <p className="flex items-center gap-2 text-[14px] font-bold text-text-main"><span className="h-[8px] w-[8px] rounded-full bg-[#EF4444]" /> Caixa fechado</p>
              <p className="text-[12.5px] text-text-subtle">Sem caixa aberto a loja não recebe pagamentos no PDV, no balcão e nas mesas.</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!t && pode('caixa_abrir') && <button type="button" className={botao.sucesso} onClick={() => setJanela('abrir')} data-testid="caixa-abrir">Abrir caixa</button>}
            {t && pode('fechar_caixa') && modo === 'caixa' && <button type="button" className={botao.primario} onClick={() => setJanela('fechar')} data-testid="caixa-fechar">Fechar caixa</button>}
          </div>
        </div>
        {t && e.veValores && e.saldos && (
          <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4" data-testid="caixa-saldos">
            {(['gaveta', 'cartao', 'pix_conferir', 'a_receber'] as const).map((k) => (
              <div key={k} className="bg-white px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">{k === 'gaveta' ? 'Dinheiro na gaveta' : ROTULO_CARTEIRA[k]}</p>
                <p className="text-[17px] font-bold text-text-main">{brl(e.saldos![k] ?? 0)}</p>
              </div>
            ))}
          </div>
        )}
        {t && !e.veValores && (
          <p className="border-t border-border px-4 py-2 text-[12px] text-text-subtle">O valor esperado fica escondido até a contagem do fechamento (conferência cega).</p>
        )}
      </section>

      {/* Movimentos manuais */}
      {t && (pode('sangria') || pode('despesa')) && (
        <section className={cartao}>
          <h2 className="border-b border-border px-4 py-3 text-[13px] font-bold text-text-main">Movimentar a gaveta</h2>
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {MOVIMENTOS.filter((m) => pode(m === 'despesa' ? 'despesa' : 'sangria')).map((m) => (
              <button key={m} type="button" className={botao.secundario} onClick={() => setJanela(m)} data-testid={`mov-${m}`}>{ROTULO_MOVIMENTO[m]}</button>
            ))}
          </div>
          <p className="px-4 pb-3 text-[12px] text-text-subtle">Saídas acima de {brl(e.limiteSaidaCentavos)} precisam do PIN de um gerente (não do seu).</p>
        </section>
      )}

      {/* Extrato do turno */}
      {t && (
        <section className={cartao} data-testid="caixa-extrato">
          <h2 className="border-b border-border px-4 py-3 text-[13px] font-bold text-text-main">{e.veValores ? 'Lançamentos do caixa' : 'Movimentos do caixa'}</h2>
          {!e.extrato?.length ? <p className="px-4 py-3 text-[13px] text-text-subtle">Nada lançado ainda.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead className="text-[11px] uppercase tracking-wide text-text-subtle">
                  <tr><th className="px-4 py-2">Quando</th><th className="px-4 py-2">O quê</th><th className="px-4 py-2">Onde</th><th className="px-4 py-2 text-right">Valor</th><th className="px-4 py-2">Quem</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {e.extrato.map((l) => (
                    <tr key={l.id} data-testid="caixa-linha">
                      <td className="whitespace-nowrap px-4 py-2">{hora(l.criado_em)}</td>
                      <td className="px-4 py-2"><b className="text-text-main">{ROTULO_TIPO[l.tipo] ?? l.tipo}</b>{l.motivo ? <span className="text-text-subtle"> · {l.motivo}</span> : null}</td>
                      <td className="px-4 py-2 text-text-subtle">{ROTULO_CARTEIRA[l.carteira] ?? l.carteira}</td>
                      <td className={`whitespace-nowrap px-4 py-2 text-right font-semibold ${l.valor_centavos < 0 ? 'text-[#EF4444]' : 'text-[#16A34A]'}`}>{brl(l.valor_centavos)}</td>
                      <td className="px-4 py-2">{l.usuario_nome}{l.aprovado_por_nome ? <span className="text-text-subtle"> · aprovado por {l.aprovado_por_nome}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Último fechamento */}
      {modo === 'caixa' && e.ultimoFechado && <UltimoFechado f={e.ultimoFechado} podeReabrir={!t && pode('caixa_reabrir')} onReabrir={() => setJanela('reabrir')} />}

      {janela === 'abrir' && <JanelaAbrir onFechar={fechar} />}
      {janela === 'fechar' && <JanelaFechar onFechar={fechar} />}
      {janela === 'reabrir' && e.ultimoFechado && <JanelaReabrir turnoId={e.ultimoFechado.id} onFechar={fechar} />}
      {janela && (MOVIMENTOS as readonly string[]).includes(janela) && <JanelaMovimento movimento={janela as Movimento} limite={e.limiteSaidaCentavos} onFechar={fechar} />}
    </>
  )
}

function UltimoFechado({ f, podeReabrir, onReabrir }: { f: Fechado; podeReabrir: boolean; onReabrir: () => void }) {
  const dif = f.diferenca_centavos ?? 0
  return (
    <section className="rounded-[3px] border border-border bg-white" data-testid="caixa-ultimo">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-bold text-text-main">Último fechamento · {hora(f.fechado_em)} por {f.fechado_por_nome ?? '—'}</h2>
        <div className="flex gap-2">
          <button type="button" className={botao.secundario} onClick={() => window.open(`/admin/financeiro/caixa/${f.id}`, '_blank')} data-testid="caixa-relatorio">Relatório</button>
          {podeReabrir && <button type="button" className={botao.secundario} onClick={onReabrir} data-testid="caixa-reabrir">Reabrir</button>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {[['Esperado (dinheiro)', brl(f.esperado_dinheiro_centavos)], ['Contado (dinheiro)', brl(f.contado_dinheiro_centavos)], ['Diferença', brl(dif)], ['Cartão (contado)', brl(f.contado_cartao_centavos)]].map(([r, v], i) => (
          <div key={r} className="bg-white px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">{r}</p>
            <p className={`text-[16px] font-bold ${i === 2 && dif !== 0 ? (dif < 0 ? 'text-[#EF4444]' : 'text-[#B45309]') : 'text-text-main'}`}>{v}</p>
          </div>
        ))}
      </div>
      {(f.justificativa || f.fechamento_aprovado_por_nome) && (
        <p className="border-t border-border px-4 py-2 text-[12.5px] text-text-subtle">{f.justificativa}{f.fechamento_aprovado_por_nome ? ` · aprovado por ${f.fechamento_aprovado_por_nome}` : ''}</p>
      )}
    </section>
  )
}

function JanelaAbrir({ onFechar }: { onFechar: () => void }) {
  const [txt, setTxt] = useState(''); const [c, setC] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false)
  async function abrir() {
    if (c === null) return setErro('Informe o fundo de troco (pode ser 0).')
    setOcupado(true)
    const r = await chamar({ acao: 'abrir', fundoCentavos: c })
    setOcupado(false)
    if (r.status !== 200) return setErro((r.j.error as string) ?? 'Não foi possível abrir.')
    onFechar()
  }
  return (
    <Janela titulo="Abrir caixa" onFechar={onFechar} testid="janela-abrir">
      <p className="mb-[10px] text-[13px] text-text-subtle">Conte o dinheiro que está na gaveta para começar (o fundo de troco). Fica registrado em seu nome.</p>
      <CampoDinheiro rotulo="Fundo de troco" valor={txt} onMudar={(t, v) => { setTxt(t); setC(v) }} testid="abrir-fundo" autoFocus />
      {erro && <p className="mt-[8px] text-[12px] font-medium text-danger">{erro}</p>}
      <div className="mt-[14px] flex justify-end gap-2">
        <button type="button" className={botao.secundario} onClick={onFechar}>Cancelar</button>
        <button type="button" className={botao.sucesso} disabled={ocupado} onClick={() => void abrir()} data-testid="abrir-confirmar">Abrir caixa</button>
      </div>
    </Janela>
  )
}

function JanelaMovimento({ movimento, limite, onFechar }: { movimento: Movimento; limite: number; onFechar: () => void }) {
  const [txt, setTxt] = useState(''); const [c, setC] = useState<number | null>(null); const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false)
  const [pedirPin, setPedirPin] = useState(false); const [erroPin, setErroPin] = useState<string | null>(null)
  const [chave] = useState(() => crypto.randomUUID())
  async function enviar(aprovacao?: { aprovadorId: string; pin: string }) {
    if (!c || c <= 0) return setErro('Informe o valor.')
    if (motivo.trim().length < 3) return setErro('Diga o motivo.')
    setOcupado(true); setErro(null); setErroPin(null)
    const r = await chamar({ acao: 'movimento', movimento, valorCentavos: c, motivo, chave, aprovacao })
    setOcupado(false)
    if (r.status === 200) return onFechar()
    if (r.j.codigo === 'aprovacao_necessaria') { setPedirPin(true); return }
    if (aprovacao) return setErroPin((r.j.error as string) ?? 'Não aprovado.')
    setErro((r.j.error as string) ?? 'Não foi possível lançar.')
  }
  return (
    <Janela titulo={ROTULO_MOVIMENTO[movimento]} onFechar={onFechar} testid="janela-movimento">
      <p className="mb-[10px] text-[13px] text-text-subtle">{DESCRICAO_MOVIMENTO[movimento]}</p>
      <div className="space-y-[10px]">
        <CampoDinheiro rotulo="Valor" valor={txt} onMudar={(t, v) => { setTxt(t); setC(v) }} testid="mov-valor" autoFocus />
        <label className="block">
          <span className="mb-[4px] block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Motivo</span>
          <input className="h-[40px] w-full rounded-[3px] border border-border px-[10px] text-[14px] outline-none focus:border-primary" value={motivo} onChange={(ev) => setMotivo(ev.target.value.slice(0, 200))} data-testid="mov-motivo" />
        </label>
        {c !== null && c > limite && movimento !== 'reforco' && !pedirPin && <p className="text-[12px] text-[#B45309]">Acima de {brl(limite)}: vai pedir o PIN de um gerente.</p>}
        {pedirPin && <AprovacaoPin titulo={`Aprovar ${ROTULO_MOVIMENTO[movimento].toLowerCase()} de ${brl(c)}`} erro={erroPin} ocupado={ocupado} onCancelar={() => setPedirPin(false)} onConfirmar={(a) => void enviar(a)} />}
        {erro && <p className="text-[12px] font-medium text-danger" data-testid="mov-erro">{erro}</p>}
      </div>
      {!pedirPin && (
        <div className="mt-[14px] flex justify-end gap-2">
          <button type="button" className={botao.secundario} onClick={onFechar}>Cancelar</button>
          <button type="button" className={botao.primario} disabled={ocupado} onClick={() => void enviar()} data-testid="mov-confirmar">Lançar</button>
        </div>
      )}
    </Janela>
  )
}

function JanelaFechar({ onFechar }: { onFechar: () => void }) {
  const [etapa, setEtapa] = useState<'contar' | 'pendencias' | 'divergencia' | 'pin' | 'feito'>('contar')
  const [dTxt, setDTxt] = useState(''); const [d, setD] = useState<number | null>(null)
  const [cTxt, setCTxt] = useState(''); const [cc, setCc] = useState<number | null>(null)
  const [pend, setPend] = useState<Pendencias | null>(null); const [aceitar, setAceitar] = useState(false)
  const [dif, setDif] = useState<{ diferencaCentavos: number; diferencaCartaoCentavos: number; limiteCentavos: number } | null>(null)
  const [just, setJust] = useState(''); const [erro, setErro] = useState<string | null>(null); const [erroPin, setErroPin] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false); const [fim, setFim] = useState<Fechado | null>(null)

  async function enviar(extra: { aceitarPendencias?: boolean; aprovacao?: { aprovadorId: string; pin: string } } = {}) {
    if (d === null) return setErro('Informe quanto dinheiro você contou.')
    setOcupado(true); setErro(null); setErroPin(null)
    const r = await chamar({ acao: 'fechar', contadoDinheiroCentavos: d, contadoCartaoCentavos: cc ?? 0, justificativa: just || null, aceitarPendencias: extra.aceitarPendencias ?? aceitar, aprovacao: extra.aprovacao })
    setOcupado(false)
    if (r.status === 200) { setFim(r.j.turno as Fechado); setEtapa('feito'); return }
    const cod = r.j.codigo
    if (cod === 'pendencias') { setPend(r.j.pendencias as Pendencias); setEtapa('pendencias'); return }
    if (cod === 'divergencia') { setDif(r.j as never); setEtapa('divergencia'); return }
    if (cod === 'aprovacao_necessaria') { setDif(r.j as never); setEtapa('pin'); return }
    if (extra.aprovacao) return setErroPin((r.j.error as string) ?? 'Não aprovado.')
    setErro((r.j.error as string) ?? 'Não foi possível fechar.')
  }

  return (
    <Janela titulo="Fechar caixa" onFechar={onFechar} testid="janela-fechar" largura={480}>
      {etapa === 'contar' && (
        <>
          <p className="mb-[10px] text-[13px] text-text-subtle">Conte o dinheiro da gaveta e some o total das maquininhas de cartão. O sistema só mostra se bateu <b>depois</b> que você informar.</p>
          <div className="space-y-[10px]">
            <CampoDinheiro rotulo="Dinheiro contado na gaveta" valor={dTxt} onMudar={(t, v) => { setDTxt(t); setD(v) }} testid="fechar-dinheiro" autoFocus />
            <CampoDinheiro rotulo="Total das maquininhas (crédito + débito)" valor={cTxt} onMudar={(t, v) => { setCTxt(t); setCc(v) }} testid="fechar-cartao" />
          </div>
        </>
      )}
      {etapa === 'pendencias' && pend && (
        <div data-testid="fechar-pendencias">
          <p className="mb-[8px] text-[13px] font-semibold text-text-main">Antes de fechar, confira:</p>
          <ul className="mb-[10px] list-disc space-y-1 pl-5 text-[13px] text-text-main">
            {pend.motoboys.map((m) => <li key={m.entregadorId}>{m.nome}: {m.pedidos} entrega(s) em dinheiro sem acerto{m.emRota ? ` e ${m.emRota} em rota` : ''}{m.esperadoCentavos != null ? ` (${brl(m.esperadoCentavos)})` : ''}</li>)}
            {pend.contasAbertas > 0 && <li>{pend.contasAbertas} conta(s) de mesa/balcão ainda aberta(s)</li>}
          </ul>
          <p className="text-[12px] text-text-subtle">O ideal é resolver (acerto do motoboy na Logística, fechar as contas) e voltar. Fechar mesmo assim fica registrado e o dono é avisado.</p>
        </div>
      )}
      {etapa === 'divergencia' && dif && (
        <div data-testid="fechar-divergencia">
          <p className="text-[14px] font-bold text-[#EF4444]">A contagem não bateu: diferença de {brl(dif.diferencaCentavos)} no dinheiro{dif.diferencaCartaoCentavos ? ` e ${brl(dif.diferencaCartaoCentavos)} no cartão` : ''}.</p>
          <p className="mb-[10px] mt-[2px] text-[12.5px] text-text-subtle">Conte de novo, ou explique a diferença (o dono recebe o aviso). Cada contagem fica registrada.</p>
          <textarea className="min-h-[80px] w-full rounded-[3px] border border-border p-[10px] text-[13px] outline-none focus:border-primary" placeholder="O que aconteceu?" value={just} onChange={(ev) => setJust(ev.target.value.slice(0, 500))} data-testid="fechar-justificativa" />
        </div>
      )}
      {etapa === 'pin' && dif && (
        <AprovacaoPin titulo={`Diferença de ${brl(dif.diferencaCentavos)}: o gerente precisa aprovar`} erro={erroPin} ocupado={ocupado} onCancelar={() => setEtapa('divergencia')} onConfirmar={(a) => void enviar({ aprovacao: a })} />
      )}
      {etapa === 'feito' && fim && (
        <div data-testid="fechar-feito">
          <p className="text-[14px] font-bold text-[#16A34A]">Caixa fechado.</p>
          <div className="mt-[8px] grid grid-cols-3 gap-[8px] text-[12.5px]">
            <div><p className="text-text-subtle">Esperado</p><p className="font-bold">{brl(fim.esperado_dinheiro_centavos)}</p></div>
            <div><p className="text-text-subtle">Contado</p><p className="font-bold">{brl(fim.contado_dinheiro_centavos)}</p></div>
            <div><p className="text-text-subtle">Diferença</p><p className="font-bold">{brl(fim.diferenca_centavos)}</p></div>
          </div>
        </div>
      )}
      {erro && <p className="mt-[8px] text-[12px] font-medium text-danger" data-testid="fechar-erro">{erro}</p>}
      <div className="mt-[14px] flex flex-wrap justify-end gap-2">
        {etapa === 'contar' && <><button type="button" className={botao.secundario} onClick={onFechar}>Cancelar</button><button type="button" className={botao.primario} disabled={ocupado} onClick={() => void enviar()} data-testid="fechar-conferir">Conferir e fechar</button></>}
        {etapa === 'pendencias' && <><button type="button" className={botao.secundario} onClick={onFechar}>Resolver primeiro</button><button type="button" className={botao.perigo} disabled={ocupado} onClick={() => { setAceitar(true); void enviar({ aceitarPendencias: true }) }} data-testid="fechar-mesmo-assim">Fechar mesmo assim</button></>}
        {etapa === 'divergencia' && <><button type="button" className={botao.secundario} onClick={() => { setEtapa('contar'); setJust('') }} data-testid="fechar-recontar">Contar de novo</button><button type="button" className={botao.perigo} disabled={ocupado || just.trim().length < 10} onClick={() => void enviar()} data-testid="fechar-com-justificativa">Fechar com a diferença</button></>}
        {etapa === 'feito' && <><button type="button" className={botao.secundario} onClick={() => fim && window.open(`/admin/financeiro/caixa/${fim.id}`, '_blank')}>Ver relatório</button><button type="button" className={botao.primario} onClick={onFechar} data-testid="fechar-ok">OK</button></>}
      </div>
    </Janela>
  )
}

function JanelaReabrir({ turnoId, onFechar }: { turnoId: string; onFechar: () => void }) {
  const [motivo, setMotivo] = useState(''); const [erro, setErro] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false)
  async function reabrir() {
    setOcupado(true)
    const r = await chamar({ acao: 'reabrir', turnoId, motivo })
    setOcupado(false)
    if (r.status !== 200) return setErro((r.j.error as string) ?? 'Não foi possível reabrir.')
    onFechar()
  }
  return (
    <Janela titulo="Reabrir caixa fechado" onFechar={onFechar} testid="janela-reabrir">
      <p className="mb-[10px] text-[13px] text-text-subtle">Só o dono reabre. O fechamento anterior fica guardado e o motivo vai para a auditoria e para os alertas.</p>
      <textarea className="min-h-[80px] w-full rounded-[3px] border border-border p-[10px] text-[13px] outline-none focus:border-primary" placeholder="Por que reabrir?" value={motivo} onChange={(ev) => setMotivo(ev.target.value.slice(0, 500))} data-testid="reabrir-motivo" />
      {erro && <p className="mt-[8px] text-[12px] font-medium text-danger">{erro}</p>}
      <div className="mt-[14px] flex justify-end gap-2">
        <button type="button" className={botao.secundario} onClick={onFechar}>Cancelar</button>
        <button type="button" className={botao.perigo} disabled={ocupado || motivo.trim().length < 10} onClick={() => void reabrir()} data-testid="reabrir-confirmar">Reabrir</button>
      </div>
    </Janela>
  )
}
