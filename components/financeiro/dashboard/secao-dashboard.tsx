'use client'

import { useCallback, useEffect, useState } from 'react'
import { CartaoNumero } from '@/components/admin/cartao-numero'
import { ICONES } from '@/lib/icones-painel'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { ATALHOS, periodoDoAtalho, type Atalho } from '@/lib/financeiro/fluxo-regras'
import { Chip } from '../ui/blocos'
import { CORES_GRAFICO, GraficoFinanceiro, Medidor, dataCurta } from '../ui/grafico'

/**
 * Financeiro › Dashboard (Fase 6). Números do livro-caixa e do custo guardado na venda; o gráfico usa o
 * componente único (cores do Gerenciador de Eventos da Meta). O resto da tela segue o padrão atual do painel.
 */
interface Dados {
  periodo: { de: string; ate: string; grupo: 'dia' | 'semana' | 'mes' }
  cards: {
    faturamentoBrutoCentavos: number; vendas: number; ticketMedioCentavos: number | null; pagosCentavos: number; naoPagosCentavos: number; aConferirCentavos: number
    despesasCentavos: number; sangriasCentavos: number; divergenciasCentavos: number; turnosDivergentes: number; motoboyAgoraCentavos: number
    cmvCentavos: number | null; lucroBrutoCentavos: number | null; lucroLiquidoCentavos: number | null; cmvPct: number | null; cmvAlvoPct: number; semCustoRegistrado: number | null
  }
  porOrigem: Record<string, number>; porForma: Record<string, number>
  itens: { maisVendido: { nome: string; quantidade: number; receitaCentavos: number } | null; maisLucrativo: { nome: string; lucroCentavos: number; margemPct: number } | null; piorMargem: { nome: string; margemPct: number; quantidade: number } | null }
  serie: { bucket: string; faturamentoCentavos: number; despesasCentavos: number; vendas: number; lucroBrutoCentavos: number | null; metaCentavos: number | null }[]
}
const brl = (c: number | null | undefined) => (c === null || c === undefined ? '—' : formatarCentavos(c))
const brlCurto = (c: number) => (Math.abs(c) >= 100000 ? `R$ ${(c / 100000).toFixed(Math.abs(c) >= 1000000 ? 0 : 1).replace('.', ',')} mil` : formatarCentavos(c).replace(',00', ''))
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1).replace('.', ',')}%`)
const ROT_ORIGEM: Record<string, string> = { balcao: 'Balcão / PDV', mesa: 'Mesas', delivery: 'Delivery', online: 'Cardápio online', manual: 'Manual', outros: 'Outros' }
const ROT_FORMA: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', outros: 'Outros' }
const MESES_LONGOS = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.']

export function SecaoDashboard() {
  const [atalho, setAtalho] = useState<Atalho>('30d')
  const [grupo, setGrupo] = useState<'dia' | 'semana' | 'mes'>('dia')
  const [d, setD] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const p = periodoDoAtalho(atalho)
    const r = await fetch(`/api/admin/financeiro/dashboard?de=${p.de}&ate=${p.ate}&grupo=${grupo}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErro(j.error ?? 'Não foi possível carregar.'); return }
    setErro(null); setD(j)
  }, [atalho, grupo])
  useEffect(() => { void carregar() }, [carregar])

  const c = d?.cards
  const periodoDo = (b: string) => {
    const [a, m, dd] = b.split('-').map(Number)
    if (grupo === 'mes') return `${MESES_LONGOS[m - 1]} de ${a}`
    if (grupo === 'semana') { const fim = new Date(Date.UTC(a, m - 1, dd + 6)); return `${dd} de ${MESES_LONGOS[m - 1]} a ${fim.getUTCDate()} de ${MESES_LONGOS[fim.getUTCMonth()]}` }
    return `${dd} de ${MESES_LONGOS[m - 1]} de ${a}`
  }
  const serie = d?.serie ?? []
  const media = serie.length ? Math.round(serie.reduce((s, x) => s + x.faturamentoCentavos, 0) / serie.length) : 0
  const meta = serie.find((x) => x.metaCentavos !== null)?.metaCentavos ?? null
  const totalOrigem = Object.values(d?.porOrigem ?? {}).reduce((s, v) => s + v, 0)
  const totalForma = Object.values(d?.porForma ?? {}).reduce((s, v) => s + v, 0)

  return (
    <div className="flex flex-col gap-3" data-testid="secao-dashboard-fin">
      <div className="flex flex-wrap items-center gap-1.5">
        {ATALHOS.map((a) => <Chip key={a.id} ativo={atalho === a.id} onClick={() => setAtalho(a.id)} testid={`dash-atalho-${a.id}`}>{a.rotulo}</Chip>)}
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        {([['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']] as const).map(([g, r]) => <Chip key={g} ativo={grupo === g} onClick={() => setGrupo(g)} testid={`dash-grupo-${g}`}>{r}</Chip>)}
      </div>
      {erro && <p role="alert" className="rounded-[4px] bg-[#FEE2E2] px-3 py-2 text-[13px] text-[#B91C1C]">{erro}</p>}
      {c && d && (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-testid="dash-cards">
            <CartaoNumero icone={ICONES.dinheiro} tom="azul" rotulo="Faturamento bruto" valor={<span data-testid="dash-faturamento" data-valor={c.faturamentoBrutoCentavos}>{brl(c.faturamentoBrutoCentavos)}</span>} />
            {c.cmvCentavos !== null && <CartaoNumero icone={ICONES.cozinha} tom="laranja" rotulo="CMV (custo vendido)" valor={<span data-testid="dash-cmv" data-valor={c.cmvCentavos}>{brl(c.cmvCentavos)}</span>} />}
            {c.lucroBrutoCentavos !== null && <CartaoNumero icone={ICONES.subindo} tom="verde" rotulo="Lucro bruto" valor={<span data-testid="dash-lucro-bruto" data-valor={c.lucroBrutoCentavos}>{brl(c.lucroBrutoCentavos)}</span>} />}
            {c.lucroLiquidoCentavos !== null && <CartaoNumero icone={ICONES.concluido} tom={c.lucroLiquidoCentavos < 0 ? 'vermelho' : 'verde'} rotulo="Lucro líquido estimado" valor={<span data-testid="dash-lucro-liquido" data-valor={c.lucroLiquidoCentavos}>{brl(c.lucroLiquidoCentavos)}</span>} />}
            <CartaoNumero icone={ICONES.ticket} tom="roxo" rotulo={`Ticket médio (${c.vendas} vendas)`} valor={<span data-testid="dash-ticket" data-valor={c.ticketMedioCentavos ?? ''}>{brl(c.ticketMedioCentavos)}</span>} />
            <CartaoNumero icone={ICONES.cartao} tom="verde" rotulo="Pagos" valor={<span data-testid="dash-pagos" data-valor={c.pagosCentavos}>{brl(c.pagosCentavos)}</span>} />
            <CartaoNumero icone={ICONES.aviso} tom="vermelho" rotulo="Não pagos (a receber)" valor={<span data-testid="dash-nao-pagos" data-valor={c.naoPagosCentavos}>{brl(c.naoPagosCentavos)}</span>} />
            <CartaoNumero icone={ICONES.relogio} tom="ambar" rotulo="Pix a conferir" valor={<span data-testid="dash-a-conferir" data-valor={c.aConferirCentavos}>{brl(c.aConferirCentavos)}</span>} />
            <CartaoNumero icone={ICONES.caindo} tom="cinza" rotulo="Despesas" valor={<span data-testid="dash-despesas" data-valor={c.despesasCentavos}>{brl(c.despesasCentavos)}</span>} />
            <CartaoNumero icone={ICONES.loja} tom="cinza" rotulo="Sangrias e retiradas" valor={<span data-testid="dash-sangrias" data-valor={c.sangriasCentavos}>{brl(c.sangriasCentavos)}</span>} />
            <CartaoNumero icone={ICONES.aviso} tom={c.turnosDivergentes ? 'ambar' : 'cinza'} rotulo={`Divergências (${c.turnosDivergentes} caixa${c.turnosDivergentes === 1 ? '' : 's'})`} valor={<span data-testid="dash-divergencias" data-valor={c.divergenciasCentavos}>{brl(c.divergenciasCentavos)}</span>} />
            <CartaoNumero icone={ICONES.moto} tom={c.motoboyAgoraCentavos ? 'laranja' : 'cinza'} rotulo="Dinheiro com motoboy (agora)" valor={<span data-testid="dash-motoboy" data-valor={c.motoboyAgoraCentavos}>{brl(c.motoboyAgoraCentavos)}</span>} />
          </div>

          <section className="rounded-[6px] border border-border bg-white p-4" data-testid="dash-evolucao">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[14px] font-bold" style={{ color: CORES_GRAFICO.texto }}>Evolução {grupo === 'dia' ? 'diária' : grupo === 'semana' ? 'semanal' : 'mensal'}</p>
                <p className="text-[12px]" style={{ color: CORES_GRAFICO.eixo }}>Faturamento{c.lucroBrutoCentavos !== null ? ', lucro bruto' : ''} e despesas por {grupo === 'mes' ? 'mês' : grupo}</p>
              </div>
              {c.cmvPct !== null && (
                <Medidor valor={Math.min(100, c.cmvPct)} alerta={c.cmvPct > c.cmvAlvoPct} rotulo={`CMV do faturamento (alvo ${c.cmvAlvoPct.toFixed(0)}%)`} texto={pct(c.cmvPct)} testid="dash-medidor-cmv" />
              )}
            </div>
            <GraficoFinanceiro testid="dash-grafico" rotulos={serie.map((s) => (grupo === 'mes' ? dataCurta(s.bucket).split(' ')[0] : dataCurta(s.bucket)))} periodos={serie.map((s) => periodoDo(s.bucket))}
              formatar={brl} formatarEixo={brlCurto}
              series={[
                { nome: 'Faturamento', tipo: 'linha', cor: 1, secao: 'Vendas', valores: serie.map((s) => s.faturamentoCentavos) },
                ...(c.lucroBrutoCentavos !== null ? [{ nome: 'Lucro bruto', tipo: 'linha' as const, cor: 2 as const, secao: 'Vendas', valores: serie.map((s) => s.lucroBrutoCentavos) }] : []),
                { nome: 'Despesas', tipo: 'barra', secao: 'Saídas', valores: serie.map((s) => s.despesasCentavos) },
              ]}
              metas={[...(meta !== null ? [{ valor: meta, rotulo: 'Meta', estilo: 'solida' as const }] : []), { valor: media, rotulo: 'Média do período', estilo: 'tracejada' as const }]} />
          </section>

          <div className="grid gap-3 lg:grid-cols-3">
            <section className="rounded-[6px] border border-border bg-white p-4" data-testid="dash-origem">
              <p className="mb-2 text-[13px] font-bold">Vendas por origem</p>
              {Object.entries(d.porOrigem).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Barra key={k} rotulo={ROT_ORIGEM[k] ?? k} valor={v} total={totalOrigem} />)}
              {!totalOrigem && <p className="text-[12.5px] text-text-subtle">Sem vendas no período.</p>}
            </section>
            <section className="rounded-[6px] border border-border bg-white p-4" data-testid="dash-forma">
              <p className="mb-2 text-[13px] font-bold">Formas de pagamento</p>
              {Object.entries(d.porForma).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Barra key={k} rotulo={ROT_FORMA[k] ?? k} valor={v} total={totalForma} />)}
              {!totalForma && <p className="text-[12.5px] text-text-subtle">Sem vendas no período.</p>}
            </section>
            <section className="rounded-[6px] border border-border bg-white p-4" data-testid="dash-itens">
              <p className="mb-2 text-[13px] font-bold">Produtos</p>
              <Item rotulo="Mais vendido" testid="dash-mais-vendido" nome={d.itens.maisVendido?.nome} detalhe={d.itens.maisVendido ? `${d.itens.maisVendido.quantidade.toLocaleString('pt-BR')} un · ${brl(d.itens.maisVendido.receitaCentavos)}` : null} />
              {c.cmvCentavos !== null || d.itens.maisLucrativo ? (
                <>
                  <Item rotulo="Mais lucrativo" testid="dash-mais-lucrativo" nome={d.itens.maisLucrativo?.nome} detalhe={d.itens.maisLucrativo ? `lucro ${brl(d.itens.maisLucrativo.lucroCentavos)} · margem ${pct(d.itens.maisLucrativo.margemPct)}` : 'Sem custo registrado'} />
                  <Item rotulo="Pior margem" testid="dash-pior-margem" nome={d.itens.piorMargem?.nome} detalhe={d.itens.piorMargem ? `margem ${pct(d.itens.piorMargem.margemPct)}` : 'Sem custo registrado'} alerta />
                </>
              ) : null}
              {c.semCustoRegistrado ? <p className="mt-2 text-[11.5px] text-text-subtle">{c.semCustoRegistrado} item(ns) vendido(s) sem custo registrado.</p> : null}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function Barra({ rotulo, valor, total }: { rotulo: string; valor: number; total: number }) {
  const p = total > 0 ? Math.max(0, (valor / total) * 100) : 0
  return (
    <div className="mb-2">
      <div className="flex justify-between text-[12.5px]"><span>{rotulo}</span><b>{brl(valor)} <span className="font-normal text-text-subtle">{p.toFixed(0)}%</span></b></div>
      <div className="mt-1 h-[6px] rounded-full" style={{ background: CORES_GRAFICO.trilho }}><div className="h-full rounded-full" style={{ width: `${p}%`, background: CORES_GRAFICO.serie1 }} /></div>
    </div>
  )
}

function Item({ rotulo, nome, detalhe, alerta, testid }: { rotulo: string; nome?: string | null; detalhe: string | null; alerta?: boolean; testid?: string }) {
  return (
    <div className="mb-2 border-b border-border pb-2 last:border-b-0" data-testid={testid}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">{rotulo}</p>
      <p className="text-[13.5px] font-semibold" style={alerta && nome ? { color: CORES_GRAFICO.medidorAlerta } : undefined}>{nome ?? '—'}</p>
      {detalhe && <p className="text-[12px] text-text-subtle">{detalhe}</p>}
    </div>
  )
}
