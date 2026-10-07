'use client'

import { formatarCentavos } from '@/lib/financeiro/centavos'
import {
  COLUNAS, FORMAS, ORIGENS, ROTULO_CARTEIRA, ROTULO_FORMA, ROTULO_SITUACAO, ROTULO_TIPO, SITUACOES, dataBR, dataHoraBR,
  type FiltrosFluxo, type LancamentoExtrato, type LinhaFluxo, type Somavel,
} from '@/lib/financeiro/fluxo-regras'

/** Documento impresso (o navegador salva como PDF): cabeçalho com loja, período, filtros, quem gerou e quando. */
interface Opcao { id: string; nome: string }
export type DadosImpressao =
  | { loja: string; geradoPor: string; geradoEm: string; filtros: FiltrosFluxo; linhas: LinhaFluxo[]; totais: Record<Somavel, number>; opcoes: { operadores: Opcao[]; motoboys: Opcao[]; produtos: Opcao[] } }
  | { loja: string; geradoPor: string; geradoEm: string; turno: Record<string, unknown> & { aberto_em: string; fechado_em: string | null }; lancamentos: LancamentoExtrato[]; reaberturas: { em: string; por: string; motivo: string | null }[] }

const brl = (c: unknown) => (c === null || c === undefined ? '—' : formatarCentavos(Number(c)))
// No papel cabem menos colunas: as do relatório impresso.
const COLS_PDF = ['data', 'situacao', 'abertura', 'fechamento', 'vendido', 'recebido', 'dinheiro', 'pixConfirmado', 'pixAConferir', 'cartao', 'sangrias', 'despesas', 'esperado', 'informado', 'diferenca']

function descreverFiltros(f: FiltrosFluxo, o: { operadores: Opcao[]; motoboys: Opcao[]; produtos: Opcao[] }): string {
  const nome = (l: Opcao[], id: string | null) => l.find((x) => x.id === id)?.nome ?? id
  const p: string[] = []
  if (f.origens.length) p.push(`origem: ${f.origens.map((x) => ORIGENS.find((y) => y.id === x)?.rotulo ?? x).join(', ')}`)
  if (f.formas.length) p.push(`forma: ${f.formas.map((x) => FORMAS.find((y) => y.id === x)?.rotulo ?? x).join(', ')}`)
  if (f.situacoes.length) p.push(`status: ${f.situacoes.map((x) => SITUACOES.find((y) => y.id === x)?.rotulo ?? x).join(', ')}`)
  if (f.operador) p.push(`operador: ${nome(o.operadores, f.operador)}`)
  if (f.motoboy) p.push(`motoboy: ${nome(o.motoboys, f.motoboy)}`)
  if (f.produto) p.push(`produto: ${nome(o.produtos, f.produto)}`)
  return p.length ? p.join(' · ') : 'nenhum'
}

export function DocumentoFluxo({ dados }: { dados: DadosImpressao }) {
  const cab = 'border-b border-black px-1.5 py-1 text-left text-[9px] font-semibold uppercase'
  const cel = 'border-b border-[#ccc] px-1.5 py-[3px] text-[9.5px]'
  if ('turno' in dados) {
    const t = dados.turno
    return (
      <div className="bg-white p-2 font-sans text-black">
        <h1 className="text-[16px] font-semibold">Extrato do turno — {dados.loja}</h1>
        <p className="text-[10.5px]">Aberto {dataHoraBR(t.aberto_em)} por {String(t.aberto_por_nome ?? '—')} · {t.fechado_em ? `fechado ${dataHoraBR(t.fechado_em)} por ${String(t.fechado_por_nome ?? '—')}` : 'em andamento'}</p>
        <p className="text-[10.5px]">Esperado {brl(t.esperado_dinheiro_centavos)} · contado {brl(t.contado_dinheiro_centavos)} · diferença {brl(t.diferenca_centavos)} · maquininha {brl(t.contado_cartao_centavos)}</p>
        {dados.reaberturas.map((r, i) => <p key={i} className="text-[10.5px] font-semibold">Reaberto por {r.por} em {dataHoraBR(r.em)}{r.motivo ? ` — ${r.motivo}` : ''}</p>)}
        <p className="mb-2 text-[9.5px] text-[#444]">Gerado por {dados.geradoPor} em {dataHoraBR(dados.geradoEm)}</p>
        <table className="w-full border-collapse">
          <thead><tr>{['Data/hora', 'Tipo', 'Descrição', 'Forma', 'Carteira', 'Feito por', 'Aprovado por', 'Valor'].map((h) => <th key={h} className={cab}>{h}</th>)}</tr></thead>
          <tbody>
            {dados.lancamentos.map((l) => (
              <tr key={l.id}>
                <td className={cel}>{dataHoraBR(l.criadoEm)}</td><td className={cel}>{ROTULO_TIPO[l.tipo] ?? l.tipo}</td><td className={cel}>{l.descricao}</td>
                <td className={cel}>{l.forma ? ROTULO_FORMA[l.forma] ?? l.forma : ''}</td><td className={cel}>{ROTULO_CARTEIRA[l.carteira] ?? l.carteira}</td>
                <td className={cel}>{l.usuario ?? ''}</td><td className={cel}>{l.aprovadoPor ?? ''}</td><td className={`${cel} text-right`}>{formatarCentavos(l.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  const cols = COLUNAS.filter((c) => COLS_PDF.includes(c.id as string))
  const valor = (l: LinhaFluxo, id: string) => {
    if (id === 'data') return l.data ? dataBR(l.data) : 'Fora de turno'
    if (id === 'situacao') return ROTULO_SITUACAO[l.situacao]
    if (id === 'abertura') return l.abertoEm ? `${l.abertoPor ?? '—'} ${dataHoraBR(l.abertoEm).slice(11)}` : ''
    if (id === 'fechamento') return l.fechadoEm ? `${l.fechadoPor ?? '—'} ${dataHoraBR(l.fechadoEm)}` : ''
    return brl(l[id as keyof LinhaFluxo])
  }
  return (
    <div className="bg-white p-2 font-sans text-black">
      <h1 className="text-[16px] font-semibold">Fluxo de Caixa — {dados.loja}</h1>
      <p className="text-[10.5px]">Período: {dataBR(dados.filtros.de)} a {dataBR(dados.filtros.ate)} · Filtros: {descreverFiltros(dados.filtros, dados.opcoes)}</p>
      <p className="mb-2 text-[9.5px] text-[#444]">Gerado por {dados.geradoPor} em {dataHoraBR(dados.geradoEm)} · {dados.linhas.length} turno(s)</p>
      <table className="w-full border-collapse">
        <thead><tr>{cols.map((c) => <th key={c.id} className={cab}>{c.rotulo}</th>)}</tr></thead>
        <tbody>
          {dados.linhas.map((l) => <tr key={l.turnoId ?? 'x'}>{cols.map((c) => <td key={c.id} className={`${cel} ${c.tipo === 'centavos' || c.tipo === 'diferenca' ? 'text-right' : ''}`}>{valor(l, c.id as string)}</td>)}</tr>)}
          <tr className="font-semibold">{cols.map((c, i) => <td key={c.id} className={`border-t-2 border-black px-1.5 py-1 text-[9.5px] ${c.tipo === 'centavos' || c.tipo === 'diferenca' ? 'text-right' : ''}`}>{i === 0 ? 'TOTAL' : (c.id as string) in dados.totais && !['esperado', 'informado'].includes(c.id as string) ? brl(dados.totais[c.id as Somavel]) : ''}</td>)}</tr>
        </tbody>
      </table>
    </div>
  )
}
