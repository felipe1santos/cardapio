'use client'

import { useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Calendar, ChevronDown, Info, Minus, OctagonAlert, Receipt, Trash2, X, CheckCircle2, Wallet } from 'lucide-react'
import { Flutuante } from '@/components/ui/flutuante'

/**
 * Kit visual do Financeiro "estilo Meta" (item 4b, 2026-10-04). Peças únicas, reaproveitadas em todas
 * as telas do módulo; as cores e medidas estão em app/globals.css (.fin-meta, .fin-card, .fin-btn-*).
 * Só aparência: nenhuma peça calcula ou decide nada.
 *
 * Referência: prints do Gerenciador de Eventos / Business Suite (docs/financeiro-redesign/README.md).
 */

/** Classes prontas dos botões (normal, hover, clique, foco e desabilitado no CSS). */
export const FIN_BTN = {
  primario: 'fin-btn fin-btn-primario',
  acao: 'fin-btn fin-btn-acao',
  contorno: 'fin-btn fin-btn-contorno',
  perigo: 'fin-btn fin-btn-perigo',
  texto: 'fin-btn fin-btn-texto',
} as const

/** Cores de texto com contraste ≥ 4,5:1 no branco: entradas, saídas, atenção. */
export const FIN_COR = {
  texto: '#1C2B33', texto2: '#465A69', azul: '#0A78BE', azulTexto: '#0868A6', verde: '#006B4E', vermelho: '#D93616',
  atencaoTexto: '#8A4B00', ativoFundo: '#E1EDF7', destaque: '#E7F5FF', trilho: '#EFF1F3', borda: '#CBD2D9',
} as const

/** Cartão branco, cantos arredondados, sombra suave e respiro generoso. */
export function Card({ titulo, subtitulo, acoes, children, className = '', semPadding = false, testid, faixa }: {
  titulo?: ReactNode; subtitulo?: ReactNode; acoes?: ReactNode; children?: ReactNode; className?: string; semPadding?: boolean; testid?: string
  /** Faixa colorida à esquerda (como o card "Crie um anúncio" da Meta). */
  faixa?: 'sucesso' | 'atencao' | 'erro' | 'info'
}) {
  const cor = faixa ? { sucesso: '#4DBBA6', atencao: '#D47B04', erro: '#D93616', info: '#CBD2D9' }[faixa] : null
  return (
    <section className={`fin-card ${cor ? 'border-l-[3px]' : ''} ${className}`} style={cor ? { borderLeftColor: cor } : undefined} data-testid={testid}>
      {(titulo || acoes) && (
        <div className={`flex flex-wrap items-start justify-between gap-3 ${semPadding ? 'px-5 pt-4' : 'px-5 pt-4'} ${children ? 'pb-1' : 'pb-4'}`}>
          <CabecalhoSecao titulo={titulo} subtitulo={subtitulo} />
          {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
        </div>
      )}
      {children !== undefined && <div className={semPadding ? '' : 'px-5 pb-5 pt-3'}>{children}</div>}
    </section>
  )
}

/** Título forte + subtítulo explicativo. */
export function CabecalhoSecao({ titulo, subtitulo, grande = false }: { titulo?: ReactNode; subtitulo?: ReactNode; grande?: boolean }) {
  if (!titulo && !subtitulo) return null
  return (
    <div className="min-w-0">
      {titulo && <h2 className={`${grande ? 'text-[20px]' : 'text-[16px]'} font-bold leading-tight`} style={{ color: FIN_COR.texto }}>{titulo}</h2>}
      {subtitulo && <p className="mt-0.5 text-[13px] leading-[18px]" style={{ color: FIN_COR.texto2 }}>{subtitulo}</p>}
    </div>
  )
}

/**
 * Indicador: rótulo, valor grande, ícone e variação ▲▼ contra o período anterior.
 * `inverso`: subir é ruim (despesas, CMV) — a cor da seta inverte.
 */
export function Kpi({ rotulo, valor, icone, variacao, inverso = false, detalhe, testid, dica }: {
  rotulo: ReactNode; valor: ReactNode; icone?: ReactNode; variacao?: number | null; inverso?: boolean; detalhe?: ReactNode; testid?: string; dica?: ReactNode
}) {
  const temVar = variacao !== undefined && variacao !== null && Number.isFinite(variacao)
  const subiu = temVar && (variacao as number) > 0.05
  const desceu = temVar && (variacao as number) < -0.05
  const bom = inverso ? desceu : subiu
  const ruim = inverso ? subiu : desceu
  return (
    <div className="fin-card flex min-w-0 flex-col gap-1 px-4 py-3.5" data-testid={testid}>
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 break-words text-[13px] font-semibold leading-[17px]" style={{ color: FIN_COR.texto2 }}>{rotulo}</p>
        {icone && <span className="flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-full" style={{ background: FIN_COR.trilho, color: FIN_COR.texto2 }} aria-hidden="true">{icone}</span>}
      </div>
      <p className="whitespace-nowrap text-[22px] font-bold leading-tight" style={{ color: FIN_COR.texto }}>{valor}</p>
      {(temVar || detalhe) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
          {temVar && (
            <span className="inline-flex items-center gap-0.5 font-semibold" data-variacao={variacao}
              style={{ color: bom ? FIN_COR.verde : ruim ? FIN_COR.vermelho : FIN_COR.texto2 }}
              title="Comparado com o período anterior de mesmo tamanho">
              {subiu ? '▲' : desceu ? '▼' : <Minus className="h-3 w-3" />}
              {Math.abs(variacao as number).toFixed(1).replace('.', ',')}%
              <span className="font-normal" style={{ color: FIN_COR.texto2 }}>vs anterior</span>
            </span>
          )}
          {detalhe && <span style={{ color: FIN_COR.texto2 }}>{detalhe}</span>}
        </div>
      )}
      {dica}
    </div>
  )
}

/** Aviso com faixa colorida à esquerda (atenção, informação, erro, sucesso) e ação opcional. */
export function Aviso({ tipo = 'info', titulo, children, acao, onFechar, testid }: {
  tipo?: 'info' | 'atencao' | 'erro' | 'sucesso'; titulo?: ReactNode; children?: ReactNode; acao?: ReactNode; onFechar?: () => void; testid?: string
}) {
  const faixa = { info: '#CBD2D9', atencao: '#D47B04', erro: '#D93616', sucesso: '#4DBBA6' }[tipo]
  const Icone = { info: Info, atencao: AlertTriangle, erro: OctagonAlert, sucesso: CheckCircle2 }[tipo]
  const corIcone = { info: '#465A69', atencao: '#D47B04', erro: '#D93616', sucesso: '#006B4E' }[tipo]
  return (
    <div role={tipo === 'erro' ? 'alert' : undefined} className="fin-card flex gap-2.5 border-l-[3px] px-4 py-3" style={{ borderLeftColor: faixa }} data-testid={testid} data-aviso={tipo}>
      <Icone className="mt-[1px] h-[18px] w-[18px] flex-shrink-0" style={{ color: corIcone }} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-[13px] leading-[19px]" style={{ color: FIN_COR.texto }}>
        {titulo && <p className="font-bold">{titulo}</p>}
        {children && <div className={titulo ? 'mt-0.5' : ''} style={{ color: titulo ? FIN_COR.texto : FIN_COR.texto }}>{children}</div>}
        {acao && <div className="mt-2.5 flex flex-wrap gap-2">{acao}</div>}
      </div>
      {onFechar && (
        <button type="button" onClick={onFechar} aria-label="Fechar aviso" className="-mr-1 -mt-0.5 flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-[6px] hover:bg-[#F5F6F7]" style={{ color: FIN_COR.texto2 }}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/** Bloco de destaque azul-claro (como a "Estimativa de resultados diários"). */
export function Destaque({ titulo, subtitulo, children, testid }: { titulo: ReactNode; subtitulo?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <div className="rounded-[6px] px-4 py-3" style={{ background: FIN_COR.destaque }} data-testid={testid}>
      <p className="text-[15px] font-bold leading-tight" style={{ color: FIN_COR.texto }}>{titulo}</p>
      {subtitulo && <p className="text-[12px]" style={{ color: FIN_COR.texto2 }}>{subtitulo}</p>}
      <div className="mt-2">{children}</div>
    </div>
  )
}

/** Abas (como "Pessoas | Ativos conectados"): a selecionada em azul-claro. */
export function Abas<T extends string>({ itens, ativo, onSelecionar, testidPrefixo }: { itens: [T, ReactNode][]; ativo: T; onSelecionar: (id: T) => void; testidPrefixo: string }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="tablist">
      {itens.map(([id, r]) => (
        <button key={id} type="button" role="tab" aria-selected={ativo === id} className="fin-aba flex-shrink-0" onClick={() => onSelecionar(id)} data-testid={`${testidPrefixo}-${id}`}>{r}</button>
      ))}
    </div>
  )
}

/**
 * Filtro de período no padrão Meta: botão branco com calendário, texto do período e seta; abre a lista de
 * atalhos por cima (Flutuante, camada máxima). Cada atalho guarda o testid antigo (`<prefixo>-<id>`).
 */
export function FiltroPeriodo<T extends string>({ atalhos, ativo, onSelecionar, texto, testidPrefixo }: {
  atalhos: readonly { id: T; rotulo: string }[]; ativo: T; onSelecionar: (id: T) => void; texto?: ReactNode; testidPrefixo: string
}) {
  const [aberto, setAberto] = useState(false)
  const ancora = useRef<HTMLButtonElement>(null)
  const atual = atalhos.find((a) => a.id === ativo)
  return (
    <>
      <button ref={ancora} type="button" className={FIN_BTN.contorno} aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto((v) => !v)} data-testid={`${testidPrefixo}-filtro`}>
        <Calendar className="h-4 w-4" style={{ color: FIN_COR.texto2 }} aria-hidden="true" />
        <span>{texto ?? atual?.rotulo}</span>
        <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${aberto ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <Flutuante ancora={ancora} aberto={aberto} onFechar={() => setAberto(false)} alinhar="inicio" largura={220} rotulo="Período" className="fin-meta !bg-white py-1.5">
        <div role="listbox" aria-label="Período">
          {atalhos.map((a) => (
            <button key={a.id} type="button" role="option" aria-selected={a.id === ativo} data-testid={`${testidPrefixo}-${a.id}`}
              onClick={() => { onSelecionar(a.id); setAberto(false) }}
              className={`flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[14px] hover:bg-[#F5F6F7] active:bg-[#E4E7EA] ${a.id === ativo ? 'font-semibold' : ''}`}
              style={{ color: a.id === ativo ? FIN_COR.azulTexto : FIN_COR.texto, background: a.id === ativo ? FIN_COR.ativoFundo : undefined }}>
              {a.rotulo}
            </button>
          ))}
        </div>
      </Flutuante>
    </>
  )
}

/** Selo de status: fundo sólido vivo e texto branco (≥ 4,5:1). */
export function SeloMeta({ tom, children, testid }: { tom: 'verde' | 'vermelho' | 'azul' | 'laranja' | 'cinza'; children: ReactNode; testid?: string }) {
  const fundo = { verde: '#006B4E', vermelho: '#D93616', azul: '#0A78BE', laranja: '#8A4B00', cinza: '#465A69' }[tom]
  return <span className="inline-flex items-center whitespace-nowrap rounded-[4px] px-2 py-[2px] text-[12px] font-semibold text-white" style={{ background: fundo }} data-testid={testid}>{children}</span>
}

/** Valor com sinal: entradas em verde, saídas em vermelho (cores com contraste no branco). */
export function ValorSinal({ centavos, children, className = '' }: { centavos: number; children: ReactNode; className?: string }) {
  return <span className={`whitespace-nowrap font-semibold ${className}`} style={{ color: centavos < 0 ? FIN_COR.vermelho : centavos > 0 ? FIN_COR.verde : FIN_COR.texto }}>{children}</span>
}

/** Botões da gaveta: ícone e cor por tipo (sangria, reforço, despesa, retirada, perda). */
const GAVETA: Record<string, { icone: typeof Wallet; cor: string; fundo: string }> = {
  sangria: { icone: ArrowUpFromLine, cor: '#0868A6', fundo: '#E7F5FF' },
  reforco: { icone: ArrowDownToLine, cor: '#006B4E', fundo: '#E6F4EF' },
  despesa: { icone: Receipt, cor: '#8A4B00', fundo: '#FDF2E2' },
  retirada: { icone: Wallet, cor: '#5B3FA8', fundo: '#F1ECFB' },
  perda: { icone: Trash2, cor: '#B3260F', fundo: '#FCEBE7' },
}
export function BotaoGaveta({ tipo, rotulo, onClick, testid }: { tipo: string; rotulo: ReactNode; onClick: () => void; testid?: string }) {
  const g = GAVETA[tipo] ?? GAVETA.sangria
  const Icone = g.icone
  return (
    <button type="button" onClick={onClick} data-testid={testid} data-gaveta={tipo}
      className="group flex min-h-[64px] min-w-[120px] flex-1 flex-col items-center justify-center gap-1.5 rounded-[8px] border border-[#CBD2D9] bg-white px-3 py-2.5 text-[14px] font-semibold hover:bg-[#F5F6F7] active:bg-[#E4E7EA] sm:flex-none"
      style={{ color: FIN_COR.texto }}>
      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full transition-transform duration-150 group-hover:scale-105" style={{ background: g.fundo, color: g.cor }} aria-hidden="true">
        <Icone className="h-[17px] w-[17px]" strokeWidth={2} />
      </span>
      {rotulo}
    </button>
  )
}
