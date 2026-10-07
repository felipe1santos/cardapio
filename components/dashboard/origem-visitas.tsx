'use client'

import { useState } from 'react'
import { Card, FIN_COR } from '@/components/graficos/kit-meta'
import { Rosca } from '@/components/graficos/rosca'
import { IconeOrigem } from '@/components/icones/origens'
import type { LinhaOrigem } from '@/lib/dashboard-origem'

/**
 * Área própria "Origem das visitas" (item 55), logo acima de "Análises do período": rosca do kit + tabela
 * por canal, alternando Visitas / Pedidos / Faturamento. Mesmo período do Dashboard.
 */
type Metrica = 'visitas' | 'pedidos' | 'faturamento'
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const num = (v: number) => v.toLocaleString('pt-BR')

export function OrigemVisitas({ linhas, totais, semOrigem }: { linhas: LinhaOrigem[]; totais: { visitas: number; pedidos: number; faturamento: number }; semOrigem: number }) {
  const [metrica, setMetrica] = useState<Metrica>('visitas')
  const totalMetrica = totais[metrica]
  const ordenadas = [...linhas].sort((a, b) => b[metrica] - a[metrica] || b.visitas - a.visitas)
  const fatias = ordenadas.filter((l) => l[metrica] > 0).map((l) => ({
    id: l.canal, rotulo: l.rotulo, valor: l[metrica], cor: l.cor,
    linhas: [
      `${num(l.visitas)} visita${l.visitas === 1 ? '' : 's'}`,
      `${num(l.pedidos)} pedido${l.pedidos === 1 ? '' : 's'} · conversão ${pct(l.conversao)}`,
      `Faturamento ${brl(l.faturamento)}`,
      `${pct(totalMetrica ? (l[metrica] / totalMetrica) * 100 : 0)} d${metrica === 'faturamento' ? 'o faturamento' : metrica === 'pedidos' ? 'os pedidos' : 'as visitas'}`,
    ],
  }))
  const vazio = linhas.length === 0
  const centro = metrica === 'faturamento' ? brl(totais.faturamento) : num(totalMetrica)
  const rotuloCentro = metrica === 'visitas' ? 'visitas' : metrica === 'pedidos' ? 'pedidos' : 'faturamento'

  return (
    <section className="meta-tema" data-testid="dash-origem">
      <Card
        titulo="Origem das visitas"
        subtitulo="De onde vêm as visitas e os pedidos do cardápio online (Instagram, WhatsApp, Google, QR Code…) no período escolhido."
        acoes={
          <div className="flex rounded-[6px] border border-[#CBD2D9] bg-white p-[2px]" role="tablist" aria-label="O que mostrar">
            {(['visitas', 'pedidos', 'faturamento'] as Metrica[]).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={metrica === m} onClick={() => setMetrica(m)} data-testid={`origem-metrica-${m}`}
                className={`h-[32px] rounded-[4px] px-[12px] text-[13px] font-semibold ${metrica === m ? 'bg-[#0A78BE] text-white' : 'text-[#1C2B33] hover:bg-[#F5F6F7]'}`}>
                {m === 'visitas' ? 'Visitas' : m === 'pedidos' ? 'Pedidos' : 'Faturamento'}
              </button>
            ))}
          </div>
        }
      >
        {vazio ? (
          <div className="py-[28px] text-center" data-testid="origem-vazio">
            <p className="text-[15px] font-semibold" style={{ color: FIN_COR.texto }}>Ainda não há visitas neste período</p>
            <p className="mt-[4px] text-[13px]" style={{ color: FIN_COR.texto2 }}>Quando alguém abrir o seu cardápio, a origem aparece aqui. Dica: use os links das Campanhas e o QR Code do cardápio — eles já vêm marcados.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-[20px] lg:grid-cols-[260px_1fr]">
            <div className="flex justify-center">
              {fatias.length ? (
                <Rosca fatias={fatias} centro={centro} subcentro={rotuloCentro} testid="origem-rosca" />
              ) : (
                <p className="py-[40px] text-center text-[13px]" style={{ color: FIN_COR.texto2 }} data-testid="origem-rosca-vazia">Nenhum{metrica === 'faturamento' ? ' faturamento' : metrica === 'pedidos' ? ' pedido' : 'a visita'} com origem no período.</p>
              )}
            </div>
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[460px] text-[13.5px]" style={{ color: FIN_COR.texto }} data-testid="origem-tabela">
                <thead>
                  <tr className="border-b border-[#E4E6EB] text-left text-[12px] font-semibold" style={{ color: FIN_COR.texto2 }}>
                    <th className="py-[8px] pr-[8px]">Origem</th>
                    <th className={`py-[8px] pr-[8px] text-right ${metrica === 'visitas' ? 'text-[#0A78BE]' : ''}`}>Visitas</th>
                    <th className={`py-[8px] pr-[8px] text-right ${metrica === 'pedidos' ? 'text-[#0A78BE]' : ''}`}>Pedidos</th>
                    <th className="py-[8px] pr-[8px] text-right">Conversão</th>
                    <th className={`py-[8px] text-right ${metrica === 'faturamento' ? 'text-[#0A78BE]' : ''}`}>Faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenadas.map((l) => (
                    <tr key={l.canal} className="border-b border-[#F0F2F5]" data-testid={`origem-linha-${l.canal}`}>
                      <td className="py-[9px] pr-[8px]"><span className="flex items-center gap-[8px] font-semibold"><span className="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-[2px]" style={{ background: l.cor }} /><IconeOrigem canal={l.canal} className="h-[16px] w-[16px] flex-shrink-0" />{l.rotulo}</span></td>
                      <td className="py-[9px] pr-[8px] text-right tabular-nums">{num(l.visitas)}</td>
                      <td className="py-[9px] pr-[8px] text-right tabular-nums">{num(l.pedidos)}</td>
                      <td className="py-[9px] pr-[8px] text-right tabular-nums">{l.visitas ? pct(l.conversao) : '—'}</td>
                      <td className="py-[9px] text-right tabular-nums">{brl(l.faturamento)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-[9px] pr-[8px]">Total</td>
                    <td className="py-[9px] pr-[8px] text-right tabular-nums" data-testid="origem-total-visitas">{num(totais.visitas)}</td>
                    <td className="py-[9px] pr-[8px] text-right tabular-nums" data-testid="origem-total-pedidos">{num(totais.pedidos)}</td>
                    <td className="py-[9px] pr-[8px] text-right tabular-nums">{totais.visitas ? pct((totais.pedidos / totais.visitas) * 100) : '—'}</td>
                    <td className="py-[9px] text-right tabular-nums" data-testid="origem-total-faturamento">{brl(totais.faturamento)}</td>
                  </tr>
                </tfoot>
              </table>
              {semOrigem > 0 && (
                <p className="mt-[8px] text-[12px]" style={{ color: FIN_COR.texto2 }} data-testid="origem-sem-registro">
                  {semOrigem} pedido{semOrigem === 1 ? '' : 's'} do cardápio sem origem registrada (feitos antes de 05/10/2026) — fora da tabela.
                </p>
              )}
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}
