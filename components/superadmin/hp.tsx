import Link from 'next/link'
import { ChevronRight, LogOut } from 'lucide-react'
import { sairAction } from '@/app/superadmin/actions'
import { InfoHp } from './info-hp'

/**
 * Visual do Super Admin igual à "Visão geral" da Hostinger (29/10/2026, pedido do dono): título de 24 px, painel branco
 * de cantos 24 px, cartões de 16 px com borda bem clara, valores de 20 px em negrito, roxo #673DE6 para ação e gráfico.
 * Celular (29/10, 2ª rodada): topo compacto (sem trilha), métricas em 2 colunas com o gráfico embaixo do número.
 * Medidas em px (a raiz do painel é 87,5%). Cores em app/globals.css › .sa-hp.
 */

export type Aba = 'visao' | 'saude' | 'gasto' | 'palavras'
const ABAS: { id: Aba; rotulo: string; href: string }[] = [
  { id: 'visao', rotulo: 'Visão geral', href: '/superadmin' },
  { id: 'saude', rotulo: 'Saúde do sistema', href: '/superadmin/saude' },
  { id: 'gasto', rotulo: 'Gasto por loja', href: '/superadmin/gasto' },
  { id: 'palavras', rotulo: 'Palavras do robô', href: '/superadmin/palavras' },
]

export function ShellHp({ aba, titulo, email, children }: { aba: Aba; titulo: string; email?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#F5F5F6] pb-[40px]" data-testid="sa-shell">
      <div className="mx-auto max-w-[1280px] px-[12px] pt-[10px] sm:px-[32px] sm:pt-[24px]">
        <div className="flex items-center gap-[8px]">
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-normal leading-[28px] text-[#18181A] sm:text-[24px] sm:leading-[32px]">{titulo}</h1>
          {email && <span className="hidden max-w-[260px] truncate text-[14px] text-[#58585E] md:inline" title={email}>{email}</span>}
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

/** Linha de informações com divisórias (o "Nome de usuário SSH / IPv4 / Acesso root"). No celular: 2 colunas. */
export function LinhaInfoHp({ itens }: { itens: { rotulo: string; valor: React.ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-[12px] gap-y-[8px] border-y-[0.8px] border-[rgba(0,0,0,0.1)] px-[16px] py-[12px] text-[13px] leading-[18px] sm:flex sm:flex-wrap sm:items-center sm:gap-0 sm:px-[24px] sm:py-[20px] sm:text-[14px] sm:leading-[20px]">
      {itens.map((i, n) => (
        <span key={i.rotulo} className={`flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-[4px] sm:pr-[24px] ${n > 0 ? 'sm:border-l-[0.8px] sm:border-[rgba(0,0,0,0.1)] sm:pl-[24px]' : ''}`}>
          <span className="text-[#58585E]">{i.rotulo}</span> <span className="text-[#18181A]">{i.valor}</span>
        </span>
      ))}
    </div>
  )
}

/** Cartão de métrica (o "Uso da CPU"): branco, cantos 16 px, borda rgba(0,0,0,.05). */
export function CartaoHp({ children, className = '', href, testid }: { children: React.ReactNode; className?: string; href?: string; testid?: string }) {
  const cls = `block rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.08)] bg-white px-[12px] py-[10px] sm:px-[16px] sm:py-[12px] ${href ? 'hover:border-[rgba(103,61,230,0.35)]' : ''} ${className}`
  return href ? <Link href={href} className={cls} data-testid={testid}>{children}</Link> : <div className={cls} data-testid={testid}>{children}</div>
}

/**
 * Métrica: rótulo com ›, valor 20/28 700 (18 no celular), unidade 14 300. Gráfico à direita no computador e EMBAIXO no
 * celular (2 colunas cabem). `info` mostra o "i" com a explicação.
 */
export function MetricaHp({ rotulo, valor, unidade, grafico, testid, nota, info }: { rotulo: string; valor: React.ReactNode; unidade?: string; grafico?: React.ReactNode; testid?: string; nota?: React.ReactNode; info?: React.ReactNode }) {
  return (
    <CartaoHp testid={testid} className="flex min-w-0 flex-col gap-[6px] sm:min-h-[88px] sm:flex-row sm:items-center sm:gap-[12px]">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-[4px] text-[12px] leading-[16px] text-[#18181A] sm:text-[14px] sm:leading-[20px]">
          <span className="min-w-0 truncate">{rotulo}</span>
          {info && <InfoHp titulo={rotulo}>{info}</InfoHp>}
        </p>
        <p className="mt-[2px] text-[18px] font-bold leading-[24px] text-[#18181A] sm:mt-[8px] sm:text-[20px] sm:leading-[28px]">
          {valor}{unidade && <span className="ml-[3px] text-[12px] font-light text-[#1D1E20] sm:text-[14px]">{unidade}</span>}
        </p>
        {nota && <p className="truncate text-[11px] leading-[14px] text-[#58585E] sm:text-[12px] sm:leading-[16px]">{nota}</p>}
      </div>
      {grafico && <div className="w-full flex-shrink-0 sm:w-[150px]">{grafico}</div>}
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

/** Minigráfico (sparkline) roxo com preenchimento claro; ocupa a largura do espaço (100%). */
export function SparklineHp({ valores, cor = '#673DE6', altura = 48, rotulo }: { valores: number[]; cor?: string; altura?: number; rotulo: string }) {
  const v = valores.filter((n) => Number.isFinite(n))
  const L = 150
  if (v.length < 2) return <div style={{ height: altura }} aria-hidden />
  const max = Math.max(...v), min = Math.min(...v), faixa = max - min || 1
  const pontos = v.map((n, i) => [(i / (v.length - 1)) * L, altura - 4 - ((n - min) / faixa) * (altura - 10)] as const)
  const linha = pontos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const id = `sp-${rotulo.replace(/\W/g, '')}`
  return (
    <svg viewBox={`0 0 ${L} ${altura}`} preserveAspectRatio="none" className="block h-[40px] w-full sm:h-[48px]" role="img" aria-label={`${rotulo}: de ${Math.round(min)} a ${Math.round(max)}`}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={cor} stopOpacity="0.18" /><stop offset="100%" stopColor={cor} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,${altura} ${linha} ${L},${altura}`} fill={`url(#${id})`} />
      <polyline points={linha} fill="none" stroke={cor} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Anel de uso (o "Uso do disco"): trilha lilás clara e arco roxo (vermelho a partir de 90%). */
export function AnelHp({ pct, rotulo }: { pct: number; rotulo: string }) {
  const T = 72, r = T / 2 - 5, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct))
  const cor = p >= 90 ? '#E73A47' : '#673DE6'
  return (
    <div className="flex sm:justify-end">
      <svg viewBox={`0 0 ${T} ${T}`} className="h-[44px] w-[44px] sm:h-[72px] sm:w-[72px]" role="img" aria-label={`${rotulo}: ${Math.round(p)}%`}>
        <circle cx={T / 2} cy={T / 2} r={r} fill="none" stroke="#EBE4FF" strokeWidth="6" />
        <circle cx={T / 2} cy={T / 2} r={r} fill="none" stroke={cor} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${T / 2} ${T / 2})`} />
      </svg>
    </div>
  )
}

/** Cartão pequeno de atalho (o "Chave SSH › Gerenciar"): cantos 20 px, título 14 e valor 16/24 500. */
export function AtalhoHp({ titulo, valor, href, testid }: { titulo: string; valor: React.ReactNode; href: string; testid?: string }) {
  return (
    <Link href={href} data-testid={testid} className="flex min-h-[56px] items-center gap-[8px] rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white px-[12px] py-[10px] hover:border-[rgba(103,61,230,0.35)] sm:rounded-[20px] sm:px-[16px] sm:py-[12px]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] leading-[16px] text-[#18181A] sm:text-[14px] sm:leading-[20px]">{titulo}</p>
        <p className="truncate text-[14px] font-medium leading-[20px] text-[#18181A] sm:text-[16px] sm:leading-[24px]">{valor}</p>
      </div>
      <ChevronRight className="h-[18px] w-[18px] flex-shrink-0 text-[#18181A]" aria-hidden />
    </Link>
  )
}
