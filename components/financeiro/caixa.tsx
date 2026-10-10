'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtualizacaoAutomatica } from './usar-atualizacao'
import { AprovacaoPin, CampoDinheiro, Janela, botao, brl, type AprovacaoDada, type PedidoRemoto } from './apoio'
import { DESCRICAO_MOVIMENTO, MOVIMENTOS, ROTULO_MOVIMENTO, tempoAberto, type Movimento } from '@/lib/financeiro/caixa-regras'
import { BotaoGaveta, Card, FIN_COR, Kpi, SeloMeta, ValorSinal } from '@/components/graficos/kit-meta'
import { GraficoFinanceiro } from '@/components/graficos/grafico'

/**
 * Financeiro › Caixa e Movimentações (Fase 2). A tela só mostra e pede; quem calcula, confere
 * permissão, limite e PIN é o servidor (/api/admin/financeiro/caixa). Quem só opera o caixa NÃO
 * vê o esperado antes de contar (contagem cega).
 * Visual "estilo Meta" (item 4b): cards, saldos como indicadores, botões da gaveta com ícone e o gráfico de
 * entradas por hora do turno (só para quem vê valores — a contagem cega continua cega).
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
  contasAbertasCentavos?: number; naoPagos?: number; naoPagosCentavos?: number
  /** Pix online (0148): informativo — dinheiro na conta do Mercado Pago, não na gaveta. */
  pixOnline?: { turno: ResumoPixOnline; caixaFechado: ResumoPixOnline }
}
interface ResumoPixOnline { qtd: number; brutoCentavos: number; taxaCentavos: number }

/** Linhas do Pix online no fechamento (o que entrou no turno e o que entrou com o caixa fechado). */
function LinhasPixOnline({ p }: { p?: Pendencias['pixOnline'] }) {
  if (!p || (!p.turno.qtd && !p.caixaFechado.qtd)) return null
  return (
    <div className="mt-[10px] rounded-[3px] bg-[#F0F7FF] px-[10px] py-[8px] text-[12.5px] text-text-main" data-testid="fechar-pix-online">
      {p.turno.qtd > 0 && <p>Pix online no turno: {p.turno.qtd}, {brl(p.turno.brutoCentavos)} (taxa do Mercado Pago {brl(p.turno.taxaCentavos)}; líquido {brl(p.turno.brutoCentavos - p.turno.taxaCentavos)})</p>}
      {p.caixaFechado.qtd > 0 && <p data-testid="fechar-pix-online-fechado">Pix online recebido com o caixa fechado: {p.caixaFechado.qtd}, {brl(p.caixaFechado.brutoCentavos)}</p>}
      <p className="text-text-subtle">Fica na conta do Mercado Pago: não entra na conferência da gaveta.</p>
    </div>
  )
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

  const temDados = useRef(false)
  // Nível 2 (controle de caixa) ou nível 1 (automático): muda só o aviso do "Caixa fechado".
  const [estrito, setEstrito] = useState<boolean | null>(null)
  useEffect(() => {
    void fetch('/api/admin/financeiro/controle-caixa', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => setEstrito(j ? Boolean(j.ativo) : null)).catch(() => {})
  }, [])
  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/financeiro/caixa', { cache: 'no-store' }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    // Falha numa atualização automática (rede caiu um instante) não apaga a tela que já estava certa.
    if (!r?.ok) { if (!temDados.current) setErro(j.error ?? 'Não foi possível carregar o caixa.'); return }
    temDados.current = true
    setErro(null); setE(j)
  }, [])
  useEffect(() => { void carregar() }, [carregar])
  // Outro aparelho vendeu, fez sangria ou fechou o caixa: aparece aqui sem recarregar (pausa com janela aberta).
  useAtualizacaoAutomatica(carregar, janela === null)
  const fechar = () => { setJanela(null); void carregar(); window.dispatchEvent(new Event('menuzia:caixa-mudou')) }

  if (erro) return <p className="text-[13px] text-danger" data-testid="caixa-erro">{erro}</p>
  if (!e) return <p className="text-[13px] text-text-subtle">Carregando…</p>
  const pode = (a: string) => e.acoes.includes(a)
  const t = e.turno

  return (
    <>
      {/* Situação do caixa */}
      <section className="fin-card border-l-[3px]" style={{ borderLeftColor: t ? '#4DBBA6' : '#D93616' }} data-testid="caixa-situacao">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          {t ? (
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[18px] font-semibold text-text-main">
                <span className="h-[9px] w-[9px] rounded-full bg-[#006B4E]" /> Caixa aberto
                {t.status === 'reaberto' && <SeloMeta tom="laranja">Reaberto</SeloMeta>}
              </p>
              <p className="mt-0.5 text-[13px] text-text-subtle">
                Aberto por <b className="text-text-main">{t.aberto_por_nome ?? '—'}</b> em {hora(t.aberto_em)} · há {tempoAberto(t.aberto_em)} · fundo de troco {brl(t.valor_inicial_centavos)}
              </p>
              {t.status === 'reaberto' && <p className="text-[12px] text-[#8A4B00]">Reaberto por {t.reaberto_por_nome}: {t.reaberto_motivo}</p>}
            </div>
          ) : (
            <div>
              <p className="flex items-center gap-2 text-[18px] font-semibold text-text-main"><span className="h-[9px] w-[9px] rounded-full bg-[#D93616]" /> Caixa fechado</p>
              <p className="mt-0.5 text-[13px] text-text-subtle">{estrito === false ? 'Caixa automático: ele abre sozinho na primeira venda do dia. PDV, balcão e mesas recebem normalmente.' : 'Sem caixa aberto a loja não recebe pagamentos no PDV, no balcão e nas mesas.'}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!t && pode('caixa_abrir') && <button type="button" className={botao.sucesso} onClick={() => setJanela('abrir')} data-testid="caixa-abrir">Abrir caixa</button>}
            {t && pode('fechar_caixa') && modo === 'caixa' && <button type="button" className={botao.primario} onClick={() => setJanela('fechar')} data-testid="caixa-fechar">Fechar caixa</button>}
          </div>
        </div>
        {t && e.veValores && e.saldos && (
          <div className="grid grid-cols-1 gap-3 px-5 pb-5 min-[400px]:grid-cols-2 lg:grid-cols-4" data-testid="caixa-saldos">
            {(['gaveta', 'cartao', 'pix_conferir', 'a_receber'] as const).map((k) => (
              <Kpi key={k} rotulo={k === 'gaveta' ? 'Dinheiro na gaveta' : ROTULO_CARTEIRA[k]} valor={brl(e.saldos![k] ?? 0)} />
            ))}
          </div>
        )}
        {t && !e.veValores && (
          <p className="border-t border-[#E4E7EA] px-5 py-2.5 text-[13px] text-text-subtle">O valor esperado fica escondido até a contagem do fechamento (conferência cega).</p>
        )}
      </section>

      {/* Movimentos manuais */}
      {t && (pode('sangria') || pode('despesa')) && (
        <Card titulo="Movimentar a gaveta" subtitulo={`Saídas acima de ${brl(e.limiteSaidaCentavos)} precisam do PIN de um gerente (não do seu).`}>
          <div className="flex flex-wrap gap-2.5">
            {MOVIMENTOS.filter((m) => pode(m === 'despesa' ? 'despesa' : 'sangria')).map((m) => (
              <BotaoGaveta key={m} tipo={m} rotulo={ROTULO_MOVIMENTO[m]} onClick={() => setJanela(m)} testid={`mov-${m}`} />
            ))}
          </div>
        </Card>
      )}

      {/* Entradas por hora do turno (gráfico de barras da Meta) — só para quem vê valores. */}
      {t && e.veValores && e.extrato?.length ? <EntradasPorHora abertoEm={t.aberto_em} linhas={e.extrato} /> : null}

      {/* Extrato do turno */}
      {t && (
        <Card testid="caixa-extrato" semPadding titulo={e.veValores ? 'Lançamentos do caixa' : 'Movimentos do caixa'} subtitulo="Tudo o que entrou e saiu neste turno, com quem fez.">
          {!e.extrato?.length ? <p className="px-5 pb-4 text-[14px] text-text-subtle">Nada lançado ainda.</p> : (
            <div className="mt-2 overflow-x-auto border-t border-[#E4E7EA]">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr><th className="px-5 py-2.5">Quando</th><th className="px-4 py-2.5">O quê</th><th className="px-4 py-2.5">Onde</th><th className="px-4 py-2.5 text-right">Valor</th><th className="px-4 py-2.5">Quem</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {e.extrato.map((l) => (
                    <tr key={l.id} data-testid="caixa-linha">
                      <td className="whitespace-nowrap px-5 py-2.5">{hora(l.criado_em)}</td>
                      <td className="px-4 py-2"><b className="text-text-main">{ROTULO_TIPO[l.tipo] ?? l.tipo}</b>{l.motivo ? <span className="text-text-subtle"> · {l.motivo}</span> : null}</td>
                      <td className="px-4 py-2 text-text-subtle">{ROTULO_CARTEIRA[l.carteira] ?? l.carteira}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right"><ValorSinal centavos={l.valor_centavos}>{brl(l.valor_centavos)}</ValorSinal></td>
                      <td className="px-4 py-2">{l.usuario_nome}{l.aprovado_por_nome ? <span className="text-text-subtle"> · aprovado por {l.aprovado_por_nome}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
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
    <section className="fin-card" data-testid="caixa-ultimo">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h2 className="text-[16px] font-semibold text-text-main">Último fechamento · {hora(f.fechado_em)} por {f.fechado_por_nome ?? '—'}</h2>
        <div className="flex gap-2">
          <button type="button" className={botao.secundario} onClick={() => window.open(`/admin/financeiro/caixa/${f.id}`, '_blank')} data-testid="caixa-relatorio">Relatório</button>
          {podeReabrir && <button type="button" className={botao.secundario} onClick={onReabrir} data-testid="caixa-reabrir">Reabrir</button>}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 px-5 pb-5 pt-3 min-[400px]:grid-cols-2 lg:grid-cols-4">
        {[['Esperado (dinheiro)', brl(f.esperado_dinheiro_centavos)], ['Contado (dinheiro)', brl(f.contado_dinheiro_centavos)], ['Diferença', brl(dif)], ['Cartão (contado)', brl(f.contado_cartao_centavos)]].map(([r, v], i) => (
          <Kpi key={r} rotulo={r} valor={<span style={{ color: i === 2 && dif !== 0 ? (dif < 0 ? FIN_COR.vermelho : FIN_COR.atencaoTexto) : undefined }}>{v}</span>} />
        ))}
      </div>
      {(f.justificativa || f.fechamento_aprovado_por_nome) && (
        <p className="border-t border-[#E4E7EA] px-5 py-2.5 text-[13px] text-text-subtle">{f.justificativa}{f.fechamento_aprovado_por_nome ? ` · aprovado por ${f.fechamento_aprovado_por_nome}` : ''}</p>
      )}
    </section>
  )
}

/**
 * Entradas por hora do turno: soma dos recebimentos (o que entrou) em cada hora, desde a abertura. É só uma
 * leitura do extrato que a tela já tem — nada é recalculado no servidor.
 */
function EntradasPorHora({ abertoEm, linhas }: { abertoEm: string; linhas: Linha[] }) {
  const inicio = new Date(abertoEm); inicio.setMinutes(0, 0, 0)
  const ultimo = Math.max(Date.now(), ...linhas.map((l) => new Date(l.criado_em).getTime()))
  const horas: number[] = []
  for (let h = inicio.getTime(); h <= ultimo && horas.length < 48; h += 3_600_000) horas.push(h)
  const valores = horas.map((h) => linhas.filter((l) => l.tipo === 'recebimento' && l.valor_centavos > 0 && new Date(l.criado_em).getTime() >= h && new Date(l.criado_em).getTime() < h + 3_600_000).reduce((s, l) => s + l.valor_centavos, 0))
  const hh = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  const dia = (ms: number) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'short' }).replace('.', '')
  return (
    <Card testid="caixa-grafico-horas" titulo="Entradas por hora do turno" subtitulo="O que entrou em cada hora desde a abertura (recebimentos de todas as formas).">
      <GraficoFinanceiro testid="caixa-grafico" altura={200} rotulos={horas.map((h) => hh(h).slice(0, 2) + 'h')}
        periodos={horas.map((h) => `${dia(h)} ${hh(h)} a ${hh(h + 3_600_000)}`)} rodapeTooltip="Fuso horário — America/Sao_Paulo"
        formatar={brl} formatarEixo={(c) => brl(c).replace(',00', '')}
        series={[{ nome: 'Entradas', tipo: 'barra', valores }]} />
    </Card>
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
  const [remoto, setRemoto] = useState<PedidoRemoto | null>(null)
  const [chave] = useState(() => crypto.randomUUID())
  async function enviar(aprovacao?: AprovacaoDada) {
    if (!c || c <= 0) return setErro('Informe o valor.')
    if (motivo.trim().length < 3) return setErro('Diga o motivo.')
    setOcupado(true); setErro(null); setErroPin(null)
    const r = await chamar({ acao: 'movimento', movimento, valorCentavos: c, motivo, chave, aprovacao })
    setOcupado(false)
    if (r.status === 200) return onFechar()
    if (r.j.codigo === 'aprovacao_necessaria') { setRemoto((r.j.pedidoRemoto as PedidoRemoto) ?? null); setPedirPin(true); return }
    if (aprovacao) return setErroPin((r.j.error as string) ?? 'Não aprovado.')
    setErro((r.j.error as string) ?? 'Não foi possível lançar.')
  }
  return (
    <Janela titulo={ROTULO_MOVIMENTO[movimento]} onFechar={onFechar} testid="janela-movimento">
      <p className="mb-[10px] text-[13px] text-text-subtle">{DESCRICAO_MOVIMENTO[movimento]}</p>
      <div className="space-y-[10px]">
        <CampoDinheiro rotulo="Valor" valor={txt} onMudar={(t, v) => { setTxt(t); setC(v) }} testid="mov-valor" autoFocus />
        <label className="block">
          <span className="mb-[6px] block text-[13px] font-semibold text-text-main">Motivo</span>
          <input className="h-[40px] w-full rounded-[6px] border border-border px-[12px] text-[14px] outline-none hover:border-[#9AA6B1] focus:border-primary" value={motivo} onChange={(ev) => setMotivo(ev.target.value.slice(0, 200))} data-testid="mov-motivo" />
        </label>
        {c !== null && c > limite && movimento !== 'reforco' && !pedirPin && <p className="text-[12px] text-[#8A4B00]">Acima de {brl(limite)}: vai pedir o PIN de um gerente.</p>}
        {pedirPin && <AprovacaoPin titulo={`Aprovar ${ROTULO_MOVIMENTO[movimento].toLowerCase()} de ${brl(c)}`} erro={erroPin} ocupado={ocupado} remoto={remoto} onCancelar={() => setPedirPin(false)} onConfirmar={(a) => void enviar(a)} />}
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
  const [dif, setDif] = useState<{ diferencaCentavos: number; diferencaCartaoCentavos: number; limiteCentavos: number; textos?: string[]; pedidoRemoto?: PedidoRemoto } | null>(null)
  const [soPendencias, setSoPendencias] = useState(false)
  const [just, setJust] = useState(''); const [erro, setErro] = useState<string | null>(null); const [erroPin, setErroPin] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false); const [fim, setFim] = useState<Fechado | null>(null)

  async function enviar(extra: { aceitarPendencias?: boolean; aprovacao?: AprovacaoDada } = {}) {
    if (d === null) return setErro('Informe quanto dinheiro você contou.')
    setOcupado(true); setErro(null); setErroPin(null)
    const r = await chamar({ acao: 'fechar', contadoDinheiroCentavos: d, contadoCartaoCentavos: cc ?? 0, justificativa: just || null, aceitarPendencias: extra.aceitarPendencias ?? aceitar, aprovacao: extra.aprovacao })
    setOcupado(false)
    if (r.status === 200) { setFim(r.j.turno as Fechado); setEtapa('feito'); return }
    const cod = r.j.codigo
    if (cod === 'pendencias') { setPend(r.j.pendencias as Pendencias); setEtapa('pendencias'); return }
    if (cod === 'divergencia' || cod === 'justificativa_necessaria') { setDif(r.j as never); setSoPendencias(cod === 'justificativa_necessaria'); setEtapa('divergencia'); return }
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
            {pend.contasAbertas > 0 && <li>{pend.contasAbertas} conta(s) de mesa/balcão ainda aberta(s){pend.contasAbertasCentavos ? ` (${brl(pend.contasAbertasCentavos)})` : ''} — passam para o próximo turno</li>}
            {(pend.naoPagos ?? 0) > 0 && <li>{pend.naoPagos} entrega(s) marcada(s) como não paga(s){pend.naoPagosCentavos ? ` (${brl(pend.naoPagosCentavos)})` : ''}</li>}
            {(pend.pixAConferirCentavos ?? 0) > 0 && <li>{brl(pend.pixAConferirCentavos)} em Pix a conferir — não trava: vai para a lista do dono</li>}
          </ul>
          <LinhasPixOnline p={pend.pixOnline} />
          <p className="text-[12px] text-text-subtle">O ideal é resolver (acerto do motoboy na Logística, fechar as contas) e voltar. Fechar mesmo assim fica registrado e o dono é avisado.</p>
        </div>
      )}
      {etapa === 'divergencia' && dif && (
        <div data-testid="fechar-divergencia">
          {soPendencias
            ? <p className="text-[14px] font-semibold text-[#8A4B00]">Explique as pendências antes de fechar.</p>
            : <p className="text-[14px] font-semibold text-[#D93616]">A contagem não bateu: diferença de {brl(dif.diferencaCentavos)} no dinheiro{dif.diferencaCartaoCentavos ? ` e ${brl(dif.diferencaCartaoCentavos)} no cartão` : ''}.</p>}
          {dif.textos?.length ? <ul className="mt-[4px] list-disc pl-5 text-[12.5px] text-text-main" data-testid="fechar-motivos">{dif.textos.map((t) => <li key={t}>{t}</li>)}</ul> : null}
          <p className="mb-[10px] mt-[2px] text-[12.5px] text-text-subtle">{soPendencias ? 'A justificativa fica no fechamento e o dono recebe o aviso.' : 'Conte de novo, ou explique a diferença (o dono recebe o aviso). Cada contagem fica registrada.'}</p>
          <textarea className="min-h-[80px] w-full rounded-[3px] border border-border p-[10px] text-[13px] outline-none focus:border-primary" placeholder="O que aconteceu?" value={just} onChange={(ev) => setJust(ev.target.value.slice(0, 500))} data-testid="fechar-justificativa" />
        </div>
      )}
      {etapa === 'pin' && dif && (
        <AprovacaoPin titulo={dif.diferencaCentavos ? `Diferença de ${brl(dif.diferencaCentavos)}: o gerente precisa aprovar` : 'Fechar com pendências: o gerente precisa aprovar'} erro={erroPin} ocupado={ocupado} remoto={dif.pedidoRemoto ?? null} onCancelar={() => setEtapa('divergencia')} onConfirmar={(a) => void enviar({ aprovacao: a })} />
      )}
      {etapa === 'feito' && fim && (
        <div data-testid="fechar-feito">
          <p className="text-[14px] font-semibold text-[#006B4E]">Caixa fechado.</p>
          <div className="mt-[8px] grid grid-cols-3 gap-[8px] text-[12.5px]">
            <div><p className="text-text-subtle">Esperado</p><p className="font-semibold">{brl(fim.esperado_dinheiro_centavos)}</p></div>
            <div><p className="text-text-subtle">Contado</p><p className="font-semibold">{brl(fim.contado_dinheiro_centavos)}</p></div>
            <div><p className="text-text-subtle">Diferença</p><p className="font-semibold">{brl(fim.diferenca_centavos)}</p></div>
          </div>
          <LinhasPixOnline p={(fim as unknown as { resumo?: { pix_online?: Pendencias["pixOnline"] } }).resumo?.pix_online ?? fim.pendencias?.pixOnline} />
        </div>
      )}
      {erro && <p className="mt-[8px] text-[12px] font-medium text-danger" data-testid="fechar-erro">{erro}</p>}
      <div className="mt-[14px] flex flex-wrap justify-end gap-2">
        {etapa === 'contar' && <><button type="button" className={botao.secundario} onClick={onFechar}>Cancelar</button><button type="button" className={botao.primario} disabled={ocupado} onClick={() => void enviar()} data-testid="fechar-conferir">Conferir e fechar</button></>}
        {etapa === 'pendencias' && <><button type="button" className={botao.secundario} onClick={onFechar}>Resolver primeiro</button><button type="button" className={botao.perigo} disabled={ocupado} onClick={() => { setAceitar(true); void enviar({ aceitarPendencias: true }) }} data-testid="fechar-mesmo-assim">Fechar mesmo assim</button></>}
        {etapa === 'divergencia' && <><button type="button" className={botao.secundario} onClick={() => { setEtapa('contar'); setJust('') }} data-testid="fechar-recontar">Contar de novo</button><button type="button" className={botao.perigo} disabled={ocupado || just.trim().length < 10} onClick={() => void enviar()} data-testid="fechar-com-justificativa">{soPendencias ? 'Fechar com a justificativa' : 'Fechar com a diferença'}</button></>}
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
