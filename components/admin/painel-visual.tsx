import type { LucideIcon } from 'lucide-react'

/**
 * Peças visuais no idioma do Dashboard (cartão de 6px com borda fina, ícone em bolha
 * clara, título forte + subtítulo discreto), para as telas que ainda eram "tabela crua":
 * Campanhas › Métricas e Integrações. Só aparência — nenhuma regra mora aqui.
 */

/** Tons do Dashboard: fundo claro da bolha + cor do ícone/traço. */
export const TONS = {
  azul: { fundo: '#E0F2FE', cor: '#0688D4', forte: '#0688D4' },
  ceu: { fundo: '#E0F2FE', cor: '#0369A1', forte: '#0EA5E9' },
  verde: { fundo: '#DCFCE7', cor: '#16A34A', forte: '#10B981' },
  laranja: { fundo: '#FFEDD5', cor: '#EA580C', forte: '#F97316' },
  roxo: { fundo: '#F3E8FF', cor: '#9333EA', forte: '#A855F7' },
  ambar: { fundo: '#FEF3C7', cor: '#B45309', forte: '#F59E0B' },
  vermelho: { fundo: '#FEE2E2', cor: '#DC2626', forte: '#EF4444' },
  cinza: { fundo: '#F1F5F9', cor: '#475569', forte: '#94A3B8' },
} as const
export type Tom = keyof typeof TONS

/** Cartão branco padrão do painel: borda fina, canto de 6px, sem sombra. */
export function Cartao({ children, className = '', ...resto }: React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }) {
  return (
    <section className={`min-w-0 rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white ${className}`} {...resto}>
      {children}
    </section>
  )
}

/** Título de bloco (14px, forte) com subtítulo discreto e ação opcional à direita. */
export function TituloBloco({ titulo, subtitulo, acao }: { titulo: string; subtitulo?: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-[var(--adm-texto-forte)]">{titulo}</h3>
        {subtitulo && <p className="mt-0.5 text-[12px] text-[var(--adm-texto-suave)]">{subtitulo}</p>}
      </div>
      {acao}
    </div>
  )
}

export function BolhaIcone({ icone: Icone, tom, tamanho = 40 }: { icone: LucideIcon; tom: Tom; tamanho?: number }) {
  const t = TONS[tom]
  return (
    <span
      className="flex flex-shrink-0 items-center justify-center rounded-full"
      style={{ width: tamanho, height: tamanho, backgroundColor: t.fundo, color: t.cor }}
      aria-hidden="true"
    >
      <Icone style={{ width: tamanho / 2, height: tamanho / 2 }} strokeWidth={2.2} />
    </span>
  )
}

export type EstadoIntegracao = 'conectado' | 'desconectado' | 'aguardando' | 'erro' | 'verificando'

const SELO: Record<EstadoIntegracao, { tom: Tom; rotulo: string }> = {
  conectado: { tom: 'verde', rotulo: 'Conectado' },
  desconectado: { tom: 'cinza', rotulo: 'Desconectado' },
  aguardando: { tom: 'ambar', rotulo: 'Aguardando ação' },
  erro: { tom: 'vermelho', rotulo: 'Erro' },
  verificando: { tom: 'cinza', rotulo: 'Verificando…' },
}

/** Selo de status em pílula: bolinha colorida + rótulo (o rótulo pode ser trocado). */
export function SeloStatus({ estado, rotulo, testid }: { estado: EstadoIntegracao; rotulo?: string; testid?: string }) {
  const s = SELO[estado]
  const t = TONS[s.tom]
  return (
    <span
      className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-semibold"
      style={{ backgroundColor: t.fundo, color: t.cor }}
      data-estado={estado}
    >
      <span className={`h-[7px] w-[7px] rounded-full ${estado === 'aguardando' || estado === 'verificando' ? 'animate-pulse' : ''}`} style={{ backgroundColor: t.forte }} />
      <span data-testid={testid}>{rotulo ?? s.rotulo}</span>
    </span>
  )
}

/** Etiqueta pequena que diz a natureza do número: real, estimado, mínimo… */
export function Etiqueta({ tom, children, title }: { tom: Tom; children: React.ReactNode; title?: string }) {
  const t = TONS[tom]
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-[2px] text-[10.5px] font-semibold" style={{ backgroundColor: t.fundo, color: t.cor }} title={title}>
      {children}
    </span>
  )
}
