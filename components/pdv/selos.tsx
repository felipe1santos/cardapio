import { ROTULO_FINANCEIRO, type ResumoDimensoes, type SituacaoFinanceira } from '@/lib/pdv-v2'

/**
 * Selos de status do PDV/Mesas (2026-10-01): pílula com fundo claro, texto forte e ícone
 * pequeno — as MESMAS cores na Central de Balcão, nas Mesas e na conta.
 */
export type TomSelo = 'ambar' | 'azul' | 'verde' | 'cinza' | 'vermelho' | 'laranja'

const TOM: Record<TomSelo, { fundo: string; texto: string }> = {
  ambar: { fundo: '#FEF3C7', texto: '#B45309' },
  azul: { fundo: '#E0F2FE', texto: '#0369A1' },
  verde: { fundo: '#DCFCE7', texto: '#15803D' },
  cinza: { fundo: '#F1F2F4', texto: '#4B5563' },
  vermelho: { fundo: '#FEE2E2', texto: '#B91C1C' },
  laranja: { fundo: '#FFEDD5', texto: '#C2410C' },
}

const ICONE = {
  relogio: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  fogo: 'M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  alerta: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  x: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
} as const

export function Selo({ tom, icone, children, testid }: { tom: TomSelo; icone?: keyof typeof ICONE; children: React.ReactNode; testid?: string }) {
  const t = TOM[tom]
  return (
    <span className="inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-bold leading-[14px]" style={{ backgroundColor: t.fundo, color: t.texto }} data-selo={tom} data-testid={testid}>
      {icone && <svg viewBox="0 0 24 24" className="h-3 w-3 flex-shrink-0 fill-current" aria-hidden><path d={ICONE[icone]} /></svg>}
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Cozinha: Aguardando aceite (âmbar) · Em preparo (azul) · Pronto (verde) · Entregue (cinza ✓). */
export function SeloCozinha({ dim, total }: { dim: ResumoDimensoes; total: number }) {
  const c = dim.cozinha
  if (total === 0) return <Selo tom="cinza">Sem pedidos</Selo>
  if (dim.texto.cozinha === 'Cancelado') return <Selo tom="cinza" icone="x">Cancelado</Selo>
  const tom: TomSelo = c.aguardando ? 'ambar' : c.preparo ? 'azul' : c.pronto || c.rota ? 'verde' : 'cinza'
  const icone = c.aguardando ? 'relogio' : c.preparo ? 'fogo' : 'check'
  return <Selo tom={tom} icone={icone} testid="selo-cozinha">{dim.texto.cozinha}</Selo>
}

/** Atendimento: Aguardando (âmbar) · Tudo entregue/servido (verde). */
export function SeloAtendimento({ dim }: { dim: ResumoDimensoes }) {
  if (dim.texto.atendimento === '—') return <Selo tom="cinza">—</Selo>
  return dim.atendimento.aguardando
    ? <Selo tom="ambar" icone="relogio" testid="selo-atendimento">{dim.texto.atendimento}</Selo>
    : <Selo tom="verde" icone="check" testid="selo-atendimento">{dim.texto.atendimento}</Selo>
}

/** Financeiro: Pago (verde) · A receber / Entregue a receber (vermelho/laranja) · Parcial (âmbar) · Cancelado (cinza). */
export function SeloFinanceiro({ situacao, aAcertar = false }: { situacao: SituacaoFinanceira; aAcertar?: boolean }) {
  if (aAcertar) return <Selo tom="vermelho" icone="alerta" testid="selo-financeiro">Entregue · a receber</Selo>
  const mapa: Record<SituacaoFinanceira, { tom: TomSelo; icone: keyof typeof ICONE; texto: string }> = {
    pago: { tom: 'verde', icone: 'check', texto: ROTULO_FINANCEIRO.pago },
    nao_pago: { tom: 'laranja', icone: 'relogio', texto: 'A receber' },
    parcial: { tom: 'ambar', icone: 'alerta', texto: 'Parcial · a conferir' },
    estornado: { tom: 'vermelho', icone: 'alerta', texto: ROTULO_FINANCEIRO.estornado },
    cancelado: { tom: 'cinza', icone: 'x', texto: ROTULO_FINANCEIRO.cancelado },
    pago_a_mais: { tom: 'vermelho', icone: 'alerta', texto: ROTULO_FINANCEIRO.pago_a_mais },
  }
  const m = mapa[situacao]
  return <Selo tom={m.tom} icone={m.icone} testid="selo-financeiro">{m.texto}</Selo>
}
