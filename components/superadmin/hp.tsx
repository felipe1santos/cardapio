import Link from 'next/link'
import { LogOut, MessageSquareText } from 'lucide-react'
import { sairAction } from '@/app/superadmin/actions'
import { InfoHp } from './info-hp'

/**
 * Visual do Super Admin igual à "Visão geral" da Hostinger (29/10/2026, pedido do dono): título de 24 px, painel branco
 * de cantos 24 px, cartões de 16 px com borda bem clara, valores de 20 px em negrito, roxo #673DE6 para ação e gráfico.
 * Celular (29/10, 2ª rodada): topo compacto (sem trilha), métricas em 2 colunas com o gráfico embaixo do número.
 * Medidas em px (a raiz do painel é 87,5%). Cores em app/globals.css › .sa-hp.
 */

// Duas abas (30/10/2026). Palavras do robô é ferramenta, não seção: fica num botão ao lado do Sair.
export type Aba = 'visao' | 'gasto' | 'palavras'
const ABAS: { id: Aba; rotulo: string; href: string }[] = [
  { id: 'visao', rotulo: 'Visão geral', href: '/superadmin' },
  { id: 'gasto', rotulo: 'Gastos de API', href: '/superadmin/gasto' },
]

export function ShellHp({ aba, titulo, email, children }: { aba: Aba; titulo: string; email?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#F5F5F6] pb-[40px]" data-testid="sa-shell">
      <div className="mx-auto max-w-[1280px] px-[12px] pt-[10px] sm:px-[32px] sm:pt-[24px]">
        <div className="flex items-center gap-[8px]">
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-normal leading-[28px] text-[#18181A] sm:text-[24px] sm:leading-[32px]">{titulo}</h1>
          {email && <span className="hidden max-w-[260px] truncate text-[14px] text-[#58585E] md:inline" title={email}>{email}</span>}
          <Link href="/superadmin/palavras" aria-label="Palavras do robô" data-testid="link-palavras"
            className="inline-flex h-[40px] items-center justify-center gap-[6px] rounded-[12px] border border-[rgba(103,61,230,0.45)] bg-white px-[10px] text-[14px] font-bold text-[#18181A] hover:bg-[#EBE4FF] sm:px-[12px]">
            <MessageSquareText className="h-[16px] w-[16px]" aria-hidden /><span className="max-sm:hidden">Palavras do robô</span>
          </Link>
          <form action={sairAction}>
            <button type="submit" data-testid="plataforma-sair" aria-label="Sair"
              className="inline-flex h-[40px] items-center justify-center gap-[6px] rounded-[12px] border border-[rgba(103,61,230,0.45)] bg-white px-[10px] text-[14px] font-bold text-[#18181A] hover:bg-[#EBE4FF] sm:px-[12px]">
              <LogOut className="h-[16px] w-[16px]" aria-hidden /><span className="max-sm:hidden">Sair</span>
            </button>
          </form>
        </div>
        <div role="tablist" aria-label="Seções do Super Admin" className="-mx-[12px] mt-[4px] flex overflow-x-auto border-b border-[rgba(0,0,0,0.1)] px-[4px] [scrollbar-width:none] sm:mx-0 sm:mt-[12px] sm:px-0 [&::-webkit-scrollbar]:hidden">
          {ABAS.map((a) => (
            <Link key={a.id} href={a.href} role="tab" aria-selected={a.id === aba} data-testid={`aba-${a.id}`}
              className={`-mb-px flex h-[44px] flex-shrink-0 items-center whitespace-nowrap border-b-2 px-[10px] text-[14px] font-semibold leading-[20px] sm:px-[12px] ${a.id === aba ? 'border-[#673DE6] text-[#673DE6]' : 'border-transparent text-[#58585E] hover:text-[#18181A]'}`}>
              {a.rotulo}
            </Link>
          ))}
        </div>
        <div className="mt-[12px] flex flex-col gap-[12px] sm:mt-[20px] sm:gap-[20px]">{children}</div>
      </div>
    </div>
  )
}

/** Painel grande (o "Ubuntu 24.04 LTS" da Hostinger): branco, cantos 24 px, borda rgba(0,0,0,.1). */
export function PainelHp({ children, className = '', id, testid }: { children: React.ReactNode; className?: string; id?: string; testid?: string }) {
  return <section id={id} data-testid={testid} className={`rounded-[20px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white sm:rounded-[24px] ${className}`}>{children}</section>
}

/** Cabeçalho de seção dentro do painel: título 16/24 600 e subtítulo 14/20 cinza; ações à direita. */
export function CabecalhoHp({ titulo, sub, icone, selo, acoes, info }: { titulo: string; sub?: React.ReactNode; icone?: React.ReactNode; selo?: React.ReactNode; acoes?: React.ReactNode; info?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-[12px] px-[16px] py-[14px] sm:gap-[16px] sm:px-[24px] sm:py-[20px]">
      {icone && <div className="flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-[12px] bg-[#F5F5F6] text-[#673DE6] sm:h-[48px] sm:w-[48px]">{icone}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-[8px]">
          <h2 className="text-[16px] font-semibold leading-[24px] text-[#18181A]">{titulo}</h2>
          {info && <InfoHp titulo={titulo}>{info}</InfoHp>}
          {selo}
        </div>
        {sub && <p className="text-[13px] leading-[18px] text-[#58585E] sm:text-[14px] sm:leading-[20px]">{sub}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-[8px]">{acoes}</div>}
    </div>
  )
}

/** Cartão de métrica (o "Uso da CPU"): branco, cantos 16 px, borda rgba(0,0,0,.05). `alerta`: fundo vermelho claro. */
export function CartaoHp({ children, className = '', href, testid, alerta = false }: { children: React.ReactNode; className?: string; href?: string; testid?: string; alerta?: boolean }) {
  const cls = `block rounded-[16px] border-[0.8px] px-[12px] py-[10px] transition-colors sm:px-[16px] sm:py-[12px] ${alerta ? 'border-[rgba(179,18,45,0.45)] bg-[#FFE8EF]' : 'border-[rgba(0,0,0,0.08)] bg-white'} ${href ? 'hover:border-[rgba(103,61,230,0.35)]' : ''} ${className}`
  return href ? <Link href={href} className={cls} data-testid={testid}>{children}</Link> : <div className={cls} data-testid={testid}>{children}</div>
}

/**
 * Métrica: rótulo com ›, valor 20/28 700 (18 no celular), unidade 14 300. Gráfico à direita no computador e EMBAIXO no
 * celular (2 colunas cabem). `info` mostra o "i" com a explicação.
 */
export function MetricaHp({ rotulo, valor, unidade, grafico, anel, testid, nota, info, alerta = false }: { rotulo: string; valor: React.ReactNode; unidade?: string; grafico?: React.ReactNode; anel?: React.ReactNode; testid?: string; nota?: React.ReactNode; info?: React.ReactNode; alerta?: boolean }) {
  return (
    <CartaoHp testid={testid} alerta={alerta} className="flex min-w-0 flex-col gap-[6px]">
      <p className="flex items-center gap-[4px] text-[12px] leading-[16px] text-[#18181A] sm:text-[14px] sm:leading-[20px]">
        <span className="min-w-0">{rotulo}</span>
        {info && <InfoHp titulo={rotulo}>{info}</InfoHp>}
      </p>
      <div className="flex min-w-0 flex-wrap items-start gap-[8px]">
        <div className="min-w-0 flex-[1_0_auto]">
          <p data-alerta={alerta || undefined} className="whitespace-nowrap text-[18px] font-bold leading-[24px] tabular-nums text-[#18181A] data-[alerta]:text-[#B3122D] sm:text-[20px] sm:leading-[28px]">
            {valor}{unidade && <span className="ml-[3px] text-[12px] font-light text-[#1D1E20] sm:text-[14px]">{unidade}</span>}
          </p>
          {nota && <p className={`text-[11px] leading-[14px] sm:text-[12px] sm:leading-[16px] ${alerta ? 'text-[#8F0E24]' : 'text-[#58585E]'}`}>{nota}</p>}
        </div>
        {anel}
      </div>
      {grafico && <div className="w-full">{grafico}</div>}
    </CartaoHp>
  )
}

export type TomSelo = 'verde' | 'ambar' | 'vermelho' | 'roxo' | 'cinza'
const SELO: Record<TomSelo, string> = {
  verde: 'bg-[#DEF4F0] text-[#008361]', ambar: 'bg-[#FFF8E2] text-[#8A6100]', vermelho: 'bg-[#FFE8EF] text-[#B3122D]',
  roxo: 'bg-[#EBE4FF] text-[#673DE6]', cinza: 'bg-[#F2F3F6] text-[#58585E]',
}
export function SeloHp({ tom, children, testid }: { tom: TomSelo; children: React.ReactNode; testid?: string }) {
  return <span data-testid={testid} className={`inline-flex items-center whitespace-nowrap rounded-[8px] px-[8px] py-[2px] text-[12px] font-semibold leading-[20px] ${SELO[tom]}`}>{children}</span>
}

type PropsBotao = React.ButtonHTMLAttributes<HTMLButtonElement> & { 'data-testid'?: string }
export const CLASSE_BOTAO_PRIMARIO = 'inline-flex h-[40px] items-center justify-center gap-[6px] rounded-[12px] bg-[#673DE6] px-[12px] text-[14px] font-bold leading-[24px] text-white transition-colors hover:bg-[#5025D1] disabled:opacity-50'
export const CLASSE_BOTAO_SECUNDARIO = 'inline-flex h-[40px] items-center justify-center gap-[6px] rounded-[12px] border border-[rgba(103,61,230,0.45)] bg-white px-[12px] text-[14px] font-bold leading-[24px] text-[#18181A] transition-colors hover:bg-[#EBE4FF] disabled:opacity-50'
export function BotaoPrimario({ className = '', ...p }: PropsBotao) { return <button type="button" {...p} className={`${CLASSE_BOTAO_PRIMARIO} ${className}`} /> }
export function BotaoSecundario({ className = '', ...p }: PropsBotao) { return <button type="button" {...p} className={`${CLASSE_BOTAO_SECUNDARIO} ${className}`} /> }

/**
 * Minigráfico (sparkline) roxo com preenchimento claro; ocupa a largura do espaço (100%). Passar o mouse (ou tocar) mostra
 * o valor de cada ponto e, com `rotulos`, a hora dele. Só CSS: serve em página de servidor.
 */
export function SparklineHp({ valores, rotulos, cor = '#673DE6', altura = 48, rotulo, formato = (n) => Math.round(n).toLocaleString('pt-BR') }: { valores: number[]; rotulos?: string[]; cor?: string; altura?: number; rotulo: string; formato?: (n: number) => string }) {
  const itens = valores.map((n, i) => ({ n, quando: rotulos?.[i] })).filter((p) => Number.isFinite(p.n))
  const v = itens.map((p) => p.n)
  const L = 150
  if (v.length < 2) return <div style={{ height: altura }} aria-hidden />
  const max = Math.max(...v), min = Math.min(...v), faixa = max - min || 1
  const pontos = v.map((n, i) => [(i / (v.length - 1)) * L, altura - 4 - ((n - min) / faixa) * (altura - 10)] as const)
  const linha = pontos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const id = `sp-${rotulo.replace(/\W/g, '')}`
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${L} ${altura}`} preserveAspectRatio="none" className="block h-[40px] w-full sm:h-[48px]" role="img" aria-label={`${rotulo}: de ${formato(min)} a ${formato(max)}`}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={cor} stopOpacity="0.18" /><stop offset="100%" stopColor={cor} stopOpacity="0" /></linearGradient></defs>
        <polygon points={`0,${altura} ${linha} ${L},${altura}`} fill={`url(#${id})`} />
        <polyline points={linha} fill="none" stroke={cor} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute inset-0 flex" aria-hidden>
        {itens.map((p, i) => {
          const lado = i < itens.length / 3 ? 'left-0' : i >= (itens.length * 2) / 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'
          return (
            <div key={i} className="group relative h-full min-w-0 flex-1" data-testid="spark-ponto">
              <span className="absolute hidden h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white group-hover:block" style={{ top: `${(pontos[i][1] / altura) * 100}%`, left: '50%', background: cor }} />
              <span role="tooltip" className={`pointer-events-none absolute bottom-[calc(100%+4px)] z-30 hidden w-max rounded-[8px] bg-[#18181A] px-[8px] py-[4px] text-[12px] leading-[16px] tabular-nums text-white shadow-[0_8px_20px_rgba(24,24,26,0.25)] group-hover:block ${lado}`}>
                {p.quando ? `${p.quando} · ` : ''}{formato(p.n)}
              </span>
            </div>
          )
        })}
      </div>
      {itens[0].quando && (
        <p className="mt-[2px] flex justify-between text-[11px] leading-[14px] tabular-nums text-[#58585E]"><span>{itens[0].quando}</span><span>{itens[itens.length - 1].quando}</span></p>
      )}
    </div>
  )
}

/** Anel de uso (o "Uso do disco"): trilha lilás clara e arco roxo (vermelho a partir de 90%). */
export function AnelHp({ pct, rotulo, alerta = false }: { pct: number; rotulo: string; alerta?: boolean }) {
  const T = 72, r = T / 2 - 5, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct))
  const cor = alerta || p >= 90 ? '#E73A47' : '#673DE6'
  return (
    <div className="flex flex-shrink-0">
      <svg viewBox={`0 0 ${T} ${T}`} className="h-[44px] w-[44px] sm:h-[60px] sm:w-[60px]" role="img" aria-label={`${rotulo}: ${Math.round(p)}%`}>
        <circle cx={T / 2} cy={T / 2} r={r} fill="none" stroke="#EBE4FF" strokeWidth="6" />
        <circle cx={T / 2} cy={T / 2} r={r} fill="none" stroke={cor} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${T / 2} ${T / 2})`} />
      </svg>
    </div>
  )
}
