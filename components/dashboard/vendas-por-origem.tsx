'use client'

/**
 * "Vendas por origem" (Dashboard, 10/10/2026 — só com "Novidades em teste"). Pedidos e faturamento do período por origem,
 * pela PRIMEIRA ("como conheceu") ou pela ÚLTIMA ("de onde pediu"). Inclui PDV/balcão, Mesa e "Sem origem": o total
 * é o mesmo do Resumo do período (mesma lista de pedidos). Rosca e tabela do kit, como "Origem das visitas".
 */
import { useMemo, useState } from 'react'
import { Card, FIN_COR } from '@/components/graficos/kit-meta'
import { Rosca } from '@/components/graficos/rosca'
import { IconeOrigem } from '@/components/icones/origens'
import { vendasPorOrigem, type ModoOrigem } from '@/lib/dashboard-vendas-origem'

type Metrica = 'pedidos' | 'faturamento'
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const num = (v: number) => v.toLocaleString('pt-BR')

function Alternador<T extends string>({ valor, opcoes, onTrocar, rotulo, testid }: { valor: T; opcoes: [T, string][]; onTrocar: (v: T) => void; rotulo: string; testid: string }) {
  return (
    <div className="flex rounded-[6px] border border-[#CBD2D9] bg-white p-[2px]" role="tablist" aria-label={rotulo}>
      {opcoes.map(([v, r]) => (
        <button key={v} type="button" role="tab" aria-selected={valor === v} onClick={() => onTrocar(v)} data-testid={`${testid}-${v}`}
          className={`h-[32px] whitespace-nowrap rounded-[4px] px-[10px] text-[13px] font-semibold ${valor === v ? 'bg-[#0A78BE] text-white' : 'text-[#1C2B33] hover:bg-[#F5F6F7]'}`}>
          {r}
        </button>
      ))}
    </div>
  )
}

export function VendasPorOrigem({ pedidos }: { pedidos: { total: number; origemVenda: 'vitrine' | 'pdv' | 'mesa'; origemCanal: string | null; origemPrimeira?: string | null }[] }) {
  const [modo, setModo] = useState<ModoOrigem>('ultima')
  const [metrica, setMetrica] = useState<Metrica>('faturamento')
  const r = useMemo(() => vendasPorOrigem(pedidos, modo), [pedidos, modo])
  const ordenadas = useMemo(() => [...r.linhas].sort((a, b) => b[metrica] - a[metrica]), [r.linhas, metrica])
  const total = r.totais[metrica]
  const fatias = ordenadas.filter((l) => l[metrica] > 0).map((l) => ({
    id: l.chave, rotulo: l.rotulo, valor: l[metrica], cor: l.cor,
    linhas: [`${num(l.pedidos)} pedido${l.pedidos === 1 ? '' : 's'}`, `Faturamento ${brl(l.faturamento)}`, `${pct(total ? (l[metrica] / total) * 100 : 0)} d${metrica === 'faturamento' ? 'o faturamento' : 'os pedidos'}`],
  }))

  return (
    <section className="meta-tema" data-testid="dash-vendas-origem">
      <Card
        titulo="Vendas por origem"
        subtitulo={modo === 'ultima' ? 'De onde o cliente fez o pedido (a última origem antes de pedir). O total bate com o Resumo do período.' : 'Como o cliente conheceu a loja (a primeira vez que abriu o cardápio). O total bate com o Resumo do período.'}
        acoes={
          <div className="flex flex-wrap gap-[8px]">
            <Alternador valor={modo} onTrocar={setModo} rotulo="Primeira ou última origem" testid="vendas-origem-modo" opcoes={[['ultima', 'De onde pediu'], ['primeira', 'Como conheceu']]} />
            <Alternador valor={metrica} onTrocar={setMetrica} rotulo="O que mostrar" testid="vendas-origem-metrica" opcoes={[['faturamento', 'Faturamento'], ['pedidos', 'Pedidos']]} />
          </div>
        }
      >
        {r.linhas.length === 0 ? (
          <p className="py-[28px] text-center text-[14px]" style={{ color: FIN_COR.texto2 }} data-testid="vendas-origem-vazio">Nenhuma venda no período.</p>
        ) : (
          <div className="grid grid-cols-1 items-start gap-[20px] lg:grid-cols-[260px_1fr]">
            <div className="flex justify-center">
              <Rosca fatias={fatias} centro={metrica === 'faturamento' ? brl(r.totais.faturamento) : num(r.totais.pedidos)} subcentro={metrica} testid="vendas-origem-rosca" />
            </div>
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[380px] text-[13.5px]" style={{ color: FIN_COR.texto }} data-testid="vendas-origem-tabela">
                <thead>
                  <tr className="border-b border-[#E4E6EB] text-left text-[12px] font-semibold" style={{ color: FIN_COR.texto2 }}>
                    <th className="py-[8px] pr-[8px]">Origem</th>
                    <th className={`py-[8px] pr-[8px] text-right ${metrica === 'pedidos' ? 'text-[#0A78BE]' : ''}`}>Pedidos</th>
                    <th className={`py-[8px] pr-[8px] text-right ${metrica === 'faturamento' ? 'text-[#0A78BE]' : ''}`}>Faturamento</th>
                    <th className="py-[8px] text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenadas.map((l) => (
                    <tr key={l.chave} className="border-b border-[#F0F2F5]" data-testid={`vendas-origem-linha-${l.chave}`}>
                      <td className="py-[9px] pr-[8px]"><span className="flex items-center gap-[8px] font-semibold"><span className="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-[2px]" style={{ background: l.cor }} />{l.chave !== 'sem_origem' && <IconeOrigem canal={l.chave} className="h-[16px] w-[16px] flex-shrink-0" />}{l.rotulo}</span></td>
                      <td className="py-[9px] pr-[8px] text-right tabular-nums">{num(l.pedidos)}</td>
                      <td className="py-[9px] pr-[8px] text-right tabular-nums">{brl(l.faturamento)}</td>
                      <td className="py-[9px] text-right tabular-nums">{pct(total ? (l[metrica] / total) * 100 : 0)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-[9px] pr-[8px]">Total</td>
                    <td className="py-[9px] pr-[8px] text-right tabular-nums" data-testid="vendas-origem-total-pedidos">{num(r.totais.pedidos)}</td>
                    <td className="py-[9px] pr-[8px] text-right tabular-nums" data-testid="vendas-origem-total-faturamento">{brl(r.totais.faturamento)}</td>
                    <td className="py-[9px] text-right">100%</td>
                  </tr>
                </tfoot>
              </table>
              {modo === 'primeira' && r.linhas.some((l) => l.chave === 'sem_origem') && (
                <p className="mt-[8px] text-[12px]" style={{ color: FIN_COR.texto2 }}>&quot;Sem origem&quot;: pedidos de antes de 10/10/2026, quando a primeira origem começou a ser gravada.</p>
              )}
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}
