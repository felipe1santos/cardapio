'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { ATALHOS, periodoDoAtalho, type Atalho } from '@/lib/financeiro/fluxo-regras'
import { METRICAS, ROTULO_METRICA, type Metrica } from '@/lib/financeiro/risco-regras'
import { Chip, Selo } from '../ui/blocos'

/**
 * Financeiro › Risco por funcionário (Fase 6). Cancelamentos, descontos, estornos, reimpressões, divergências e
 * ajustes por pessoa no período; destaca quem foge do padrão da equipe (≥ 3 e acima de 2× a mediana).
 * Só dono e gerente. Não acusa ninguém — é um sinal para olhar a auditoria.
 */
interface Linha {
  usuarioId: string; nome: string; papel: string | null; valores: Record<Metrica, number>; valorCentavos: Record<Metrica, number>
  foraDoPadrao: Metrica[]; pontos: number; acoes: Record<string, number>
}
const ROT_PAPEL: Record<string, string> = { dono: 'Dono', gerente: 'Gerente', caixa: 'Caixa', garcom: 'Garçom', atendente: 'Atendente', cozinha: 'Cozinha', motoboy: 'Motoboy', entregador: 'Motoboy', logistica: 'Logística', personalizado: 'Personalizado' }

export function SecaoRisco() {
  const [atalho, setAtalho] = useState<Atalho>('30d')
  const [d, setD] = useState<{ linhas: Linha[]; medianas: Record<Metrica, number> } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const p = periodoDoAtalho(atalho)
    const r = await fetch(`/api/admin/financeiro/risco?de=${p.de}&ate=${p.ate}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErro(j.error ?? 'Não foi possível carregar.'); return }
    setErro(null); setD(j)
  }, [atalho])
  useEffect(() => { void carregar() }, [carregar])

  const cel = (l: Linha, k: Metrica) => {
    const fora = l.foraDoPadrao.includes(k)
    return (
      <td key={k} className="whitespace-nowrap px-3 py-2 text-right" data-testid={`risco-${k}`} data-fora={fora ? '1' : '0'}>
        {l.valores[k] ? (fora ? <span className="inline-flex rounded-[4px] bg-[#D93616] px-1.5 py-[1px] font-semibold text-white">{l.valores[k]}</span> : l.valores[k]) : <span className="text-text-subtle">0</span>}
        {l.valorCentavos[k] ? <span className="block text-[11px] text-text-subtle">{formatarCentavos(l.valorCentavos[k])}</span> : null}
      </td>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-testid="secao-risco">
      <div className="flex flex-wrap gap-1.5">{ATALHOS.map((a) => <Chip key={a.id} ativo={atalho === a.id} onClick={() => setAtalho(a.id)} testid={`risco-atalho-${a.id}`}>{a.rotulo}</Chip>)}</div>
      <p className="text-[12.5px] text-text-subtle">Destaque em vermelho: pelo menos 3 no período e mais que o dobro do “normal” da equipe (a mediana). É um sinal para conferir na Auditoria — não uma acusação.</p>
      {erro && <p role="alert" className="fin-card border-l-[3px] !border-l-[#D93616] px-4 py-2.5 text-[14px] font-medium text-[#D93616]">{erro}</p>}
      {d && (
        <>
          <div className="hidden overflow-x-auto fin-card md:block">
            <table className="w-full border-separate border-spacing-0 text-[13px]" data-testid="risco-tabela">
              <thead className="bg-[#F5F7F9] text-left text-[12.5px] font-semibold text-text-subtle">
                <tr className="[&>th]:border-b [&>th]:border-border">
                  <th className="px-3 py-2.5">Funcionário</th>
                  {METRICAS.map((k) => <th key={k} className="px-3 py-2.5 text-right">{ROTULO_METRICA[k]}<span className="block font-normal normal-case">normal: {d.medianas[k]}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {d.linhas.length === 0 && <tr><td colSpan={METRICAS.length + 1} className="px-4 py-10 text-center text-text-subtle">Nenhuma ação sensível no período.</td></tr>}
                {d.linhas.map((l) => (
                  <tr key={l.usuarioId} className="[&>td]:border-b [&>td]:border-border" data-testid="risco-linha" data-nome={l.nome} data-fora={l.foraDoPadrao.join(',')}>
                    <td className="px-3 py-2"><b>{l.nome}</b><span className="ml-2 text-[12px] text-text-subtle">{ROT_PAPEL[l.papel ?? ''] ?? l.papel ?? ''}</span>{l.foraDoPadrao.length ? <span className="ml-2"><Selo cor="#D93616" testid="risco-selo">Fora do padrão</Selo></span> : null}</td>
                    {METRICAS.map((k) => cel(l, k))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 md:hidden" data-testid="risco-cartoes">
            {d.linhas.length === 0 && <p className="fin-card px-4 py-8 text-center text-[13px] text-text-subtle">Nenhuma ação sensível no período.</p>}
            {d.linhas.map((l) => (
              <button key={l.usuarioId} type="button" onClick={() => setAberto(aberto === l.usuarioId ? null : l.usuarioId)} className="fin-card p-3 text-left" data-testid="risco-cartao">
                <span className="flex items-center justify-between gap-2"><b className="text-[14px]">{l.nome}</b>{l.foraDoPadrao.length ? <Selo cor="#D93616">Fora do padrão</Selo> : null}</span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
                  {METRICAS.filter((k) => l.valores[k] > 0).map((k) => <span key={k} className={l.foraDoPadrao.includes(k) ? 'font-bold text-[#D93616]' : 'text-text-subtle'}>{ROTULO_METRICA[k]}: {l.valores[k]}</span>)}
                </span>
                {aberto === l.usuarioId && (
                  <span className="mt-2 block border-t border-border pt-2 text-[12px] text-text-subtle">{Object.entries(l.acoes).map(([a, n]) => `${a}: ${n}`).join(' · ')}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
