import Link from 'next/link'
import { ChevronRight, Home, LogOut } from 'lucide-react'
import { sairAction } from '@/app/superadmin/actions'

/**
 * Visual do Super Admin igual à "Visão geral" da Hostinger (29/10/2026, pedido do dono): trilha, título de 24 px,
 * painel branco de cantos 24 px, cartões de 16 px com borda bem clara, valores de 20 px em negrito, roxo #673DE6 para
 * ação e gráfico. Medidas em px (a raiz do painel é 87,5%). Cores em app/globals.css › .sa-hp.
 */

export type Aba = 'visao' | 'saude' | 'gasto' | 'palavras'
const ABAS: { id: Aba; rotulo: string; href: string }[] = [
  { id: 'visao', rotulo: 'Visão geral', href: '/superadmin' },
  { id: 'saude', rotulo: 'Saúde do sistema', href: '/superadmin/saude' },
  { id: 'gasto', rotulo: 'Gasto por loja', href: '/superadmin/gasto' },
  { id: 'palavras', rotulo: 'Palavras do robô', href: '/superadmin/palavras' },
]

export function ShellHp({ aba, titulo, email, children }: { aba: Aba; titulo: string; email?: string; children: React.ReactNode }) {
  const atual = ABAS.find((a) => a.id === aba)!
  return (
    <div className="min-h-dvh bg-[#F5F5F6] pb-[48px]" data-testid="sa-shell">
      <div className="mx-auto max-w-[1280px] px-[16px] pt-[20px] sm:px-[32px] sm:pt-[28px]">
        <div className="flex flex-wrap items-center justify-between gap-[12px]">
          <nav aria-label="Trilha" className="flex min-w-0 items-center gap-[8px] text-[12px] font-semibold leading-[16px] text-[#18181A]">
            <Link href="/superadmin" aria-label="Início" className="text-[#58585E] hover:text-[#673DE6]"><Home className="h-[16px] w-[16px]" /></Link>
            <ChevronRight className="h-[14px] w-[14px] text-[#58585E]" />
            <span className="text-[#58585E]">Super Admin</span>
            <ChevronRight className="h-[14px] w-[14px] text-[#58585E]" />
            <span className="truncate text-[14px] leading-[20px]">Menuzia - {atual.rotulo}</span>
          </nav>
          <div className="flex items-center gap-[12px]">
            {email && <span className="hidden max-w-[260px] truncate text-[14px] text-[#58585E] md:inline" title={email}>{email}</span>}
            <form action={sairAction}>
              <BotaoSecundario type="submit" data-testid="plataforma-sair"><LogOut className="h-[16px] w-[16px]" /> Sair</BotaoSecundario>
            </form>
          </div>
        </div>
        <h1 className="mt-[16px] text-[24px] font-normal leading-[32px] text-[#18181A]">{titulo}</h1>
        <div role="tablist" aria-label="Seções do Super Admin" className="mt-[12px] flex gap-[4px] overflow-x-auto border-b border-[rgba(0,0,0,0.1)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ABAS.map((a) => (
            <Link key={a.id} href={a.href} role="tab" aria-selected={a.id === aba} data-testid={`aba-${a.id}`}
              className={`-mb-px flex h-[40px] flex-shrink-0 items-center whitespace-nowrap border-b-2 px-[12px] text-[14px] font-semibold leading-[20px] ${a.id === aba ? 'border-[#673DE6] text-[#673DE6]' : 'border-transparent text-[#58585E] hover:text-[#18181A]'}`}>
              {a.rotulo}
            </Link>
          ))}
        </div>
        <div className="mt-[20px] flex flex-col gap-[20px]">{children}</div>
      </div>
    </div>
  )
}

/** Painel grande (o "Ubuntu 24.04 LTS" da Hostinger): branco, cantos 24 px, borda rgba(0,0,0,.1). */
export function PainelHp({ children, className = '', id, testid }: { children: React.ReactNode; className?: string; id?: string; testid?: string }) {
  return <section id={id} data-testid={testid} className={`overflow-hidden rounded-[24px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white ${className}`}>{children}</section>
}

/** Cabeçalho de seção dentro do painel: título 16/24 600 e subtítulo 14/20 cinza; ações à direita. */
export function CabecalhoHp({ titulo, sub, icone, selo, acoes }: { titulo: string; sub?: React.ReactNode; icone?: React.ReactNode; selo?: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-[16px] px-[24px] py-[20px]">
      {icone && <div className="flex h-[48px] w-[48px] flex-shrink-0 items-center justify-center rounded-[12px] bg-[#F5F5F6] text-[#673DE6]">{icone}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-[8px]">
          <h2 className="text-[16px] font-semibold leading-[24px] text-[#18181A]">{titulo}</h2>
          {selo}
        </div>
        {sub && <p className="text-[14px] leading-[20px] text-[#58585E]">{sub}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-[8px]">{acoes}</div>}
    </div>
  )
}

/** Linha de informações com divisórias (o "Nome de usuário SSH / IPv4 / Acesso root"). */
export function LinhaInfoHp({ itens }: { itens: { rotulo: string; valor: React.ReactNode }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-y-[8px] border-y-[0.8px] border-[rgba(0,0,0,0.1)] px-[24px] py-[20px] text-[14px] leading-[20px]">
      {itens.map((i, n) => (
        <span key={i.rotulo} className={`flex items-center gap-[4px] ${n > 0 ? 'sm:border-l-[0.8px] sm:border-[rgba(0,0,0,0.1)] sm:pl-[24px]' : ''} pr-[24px]`}>
          <span className="text-[#58585E]">{i.rotulo}</span> <span className="text-[#18181A]">{i.valor}</span>
        </span>
      ))}
    </div>
  )
}

/** Cartão de métrica (o "Uso da CPU"): branco, cantos 16 px, borda rgba(0,0,0,.05). */
export function CartaoHp({ children, className = '', href, testid }: { children: React.ReactNode; className?: string; href?: string; testid?: string }) {
  const cls = `block rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.05)] bg-white px-[16px] py-[12px] ${href ? 'hover:border-[rgba(103,61,230,0.35)]' : ''} ${className}`
  return href ? <Link href={href} className={cls} data-testid={testid}>{children}</Link> : <div className={cls} data-testid={testid}>{children}</div>
}

/** Métrica: rótulo 14/20 com ›, valor 20/28 700, unidade 14 300, gráfico à direita. */
export function MetricaHp({ rotulo, valor, unidade, grafico, href, testid, nota }: { rotulo: string; valor: React.ReactNode; unidade?: string; grafico?: React.ReactNode; href?: string; testid?: string; nota?: React.ReactNode }) {
  return (
    <CartaoHp href={href} testid={testid} className="flex min-h-[88px] items-center gap-[12px]">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-[4px] text-[14px] leading-[20px] text-[#18181A]">{rotulo}{href && <ChevronRight className="h-[14px] w-[14px] text-[#58585E]" />}</p>
        <p className="mt-[8px] text-[20px] font-bold leading-[28px] text-[#18181A]">{valor}{unidade && <span className="ml-[4px] text-[14px] font-light text-[#1D1E20]">{unidade}</span>}</p>
        {nota && <p className="text-[12px] leading-[16px] text-[#58585E]">{nota}</p>}
      </div>
      {grafico && <div className="flex-shrink-0">{grafico}</div>}
    </CartaoHp>
  )
}

export type TomSelo = 'verde' | 'ambar' | 'vermelho' | 'roxo' | 'cinza'
const SELO: Record<TomSelo, string> = {
  verde: 'bg-[#DEF4F0] text-[#008361]', ambar: 'bg-[#FFF8E2] text-[#8A6100]', vermelho: 'bg-[#FFE8EF] text-[#D63163]',
  roxo: 'bg-[#EBE4FF] text-[#673DE6]', cinza: 'bg-[#F2F3F6] text-[#58585E]',
}
export function SeloHp({ tom, children, testid }: { tom: TomSelo; children: React.ReactNode; testid?: string }) {
  return <span data-testid={testid} className={`inline-flex items-center whitespace-nowrap rounded-[8px] px-[8px] py-[2px] text-[12px] font-semibold leading-[20px] ${SELO[tom]}`}>{children}</span>
}

type PropsBotao = React.ButtonHTMLAttributes<HTMLButtonElement> & { 'data-testid'?: string }
export const CLASSE_BOTAO_PRIMARIO = 'inline-flex h-[36px] items-center justify-center gap-[6px] rounded-[12px] bg-[#673DE6] px-[12px] text-[14px] font-bold leading-[24px] text-white transition-colors hover:bg-[#5025D1] disabled:opacity-50'
export const CLASSE_BOTAO_SECUNDARIO = 'inline-flex h-[36px] items-center justify-center gap-[6px] rounded-[12px] border border-[rgba(103,61,230,0.45)] bg-white px-[12px] text-[14px] font-bold leading-[24px] text-[#18181A] transition-colors hover:bg-[#EBE4FF] disabled:opacity-50'
export function BotaoPrimario({ className = '', ...p }: PropsBotao) { return <button type="button" {...p} className={`${CLASSE_BOTAO_PRIMARIO} ${className}`} /> }
export function BotaoSecundario({ className = '', ...p }: PropsBotao) { return <button type="button" {...p} className={`${CLASSE_BOTAO_SECUNDARIO} ${className}`} /> }

/** Minigráfico (sparkline) roxo com preenchimento claro, como o "Uso da CPU". `cor` vermelha para tráfego de entrada. */
export function SparklineHp({ valores, cor = '#673DE6', largura = 150, altura = 56, rotulo }: { valores: number[]; cor?: string; largura?: number; altura?: number; rotulo: string }) {
  const v = valores.filter((n) => Number.isFinite(n))
  if (v.length < 2) return <div style={{ width: largura, height: altura }} aria-hidden />
  const max = Math.max(...v), min = Math.min(...v), faixa = max - min || 1
  const pontos = v.map((n, i) => [(i / (v.length - 1)) * largura, altura - 4 - ((n - min) / faixa) * (altura - 10)] as const)
  const linha = pontos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const id = `sp-${rotulo.replace(/\W/g, '')}`
  return (
    <svg width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label={rotulo}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={cor} stopOpacity="0.18" /><stop offset="100%" stopColor={cor} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,${altura} ${linha} ${largura},${altura}`} fill={`url(#${id})`} />
      <polyline points={linha} fill="none" stroke={cor} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Anel de uso (o "Uso do disco"): trilha lilás clara e arco roxo. */
export function AnelHp({ pct, rotulo, tamanho = 72 }: { pct: number; rotulo: string; tamanho?: number }) {
  const r = tamanho / 2 - 5, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct))
  const cor = p >= 90 ? '#E73A47' : '#673DE6'
  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} role="img" aria-label={`${rotulo}: ${Math.round(p)}%`}>
      <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke="#EBE4FF" strokeWidth="6" />
      <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke={cor} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${tamanho / 2} ${tamanho / 2})`} />
    </svg>
  )
}

/** Cartão pequeno de atalho (o "Chave SSH › Gerenciar"): cantos 20 px, título 14 e valor 16/24 500. */
export function AtalhoHp({ titulo, valor, href, testid }: { titulo: string; valor: React.ReactNode; href: string; testid?: string }) {
  return (
    <Link href={href} data-testid={testid} className="flex items-center gap-[12px] rounded-[20px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white px-[16px] py-[12px] hover:border-[rgba(103,61,230,0.35)]">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-[20px] text-[#18181A]">{titulo}</p>
        <p className="text-[16px] font-medium leading-[24px] text-[#18181A]">{valor}</p>
      </div>
      <ChevronRight className="h-[18px] w-[18px] flex-shrink-0 text-[#18181A]" />
    </Link>
  )
}
