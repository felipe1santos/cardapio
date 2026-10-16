'use client'

import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { TONS_PAINEL, type TomPainel } from '@/components/admin/cartao-numero'
import { BalaoInfo } from '@/components/admin/balao-info'

/**
 * Topo compacto das telas do painel (16/10/2026, docs/relatorios/2026-10-16-compactar-topo.md): no máximo 2 linhas
 * antes da tabela.
 *   Linha 1 — <LinhaResumos> (números em pílulas) à esquerda e <SeletorSecao> (lista suspensa) à direita.
 *   Linha 2 — <BarraFiltros>: <Segmentado>, busca, ordenação à esquerda; CSV e botão principal à direita.
 * Avisos que pedem ação vão para a barra do topo com <AvisoTopo> (prop `aviso` da TopBar).
 * Só aparência: nenhuma peça busca dados nem decide nada. Medidas em px (a raiz do painel é 87,5%).
 */

/** Foco de teclado do guia visual (anel azul a 40%), por cima do anel forte do tema do Financeiro. */
export const FOCO_GUIA = 'focus-visible:!outline-none focus-visible:!shadow-[0_0_0_2px_rgba(6,136,212,0.4)]'

/** Busca e listas suspensas da barra de filtros (34px; 44px no toque). */
export const CAMPO_FILTRO = `h-[34px] min-w-0 rounded-[6px] border border-[var(--adm-borda-forte,#d6dae1)] bg-white px-[10px] text-[13px] text-[var(--adm-texto,#1f2937)] hover:border-[#9AA6B1] max-lg:h-[44px] ${FOCO_GUIA}`

/**
 * Uma linha do topo: conteúdo à esquerda (quebra se faltar espaço) e ações à direita. No celular cada parte ocupa a
 * largura toda; `direitaPrimeiro` põe a parte da direita em cima (o seletor da sub-seção vem antes dos números).
 */
function Linha({ children, direita, testid, direitaPrimeiro = false }: { children?: ReactNode; direita?: ReactNode; testid?: string; direitaPrimeiro?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-[8px]" data-testid={testid}>
      {children && <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[6px] max-md:basis-full">{children}</div>}
      {direita && (
        <div className={`ml-auto flex flex-shrink-0 flex-wrap items-center justify-end gap-[8px] max-md:ml-0 max-md:w-full max-md:justify-start ${direitaPrimeiro ? 'max-md:order-first' : ''}`}>
          {direita}
        </div>
      )}
    </div>
  )
}

export interface ItemResumo {
  rotulo: string
  valor: ReactNode
  /** Caminhos do ícone (lib/icones-painel). */
  icone?: string[]
  tom?: TomPainel
  /** Pinta o valor na cor do tom (ex.: vencidas > 0). */
  destaque?: boolean
  /** Explicação no hover. */
  dica?: string
  testid?: string
  /** Número que também é filtro rápido (ex.: "Sem ficha 27"): vira botão liga/desliga. */
  filtro?: { ativo: boolean; onClick: () => void }
}

/**
 * Linha 1: resumos numa linha só (ícone 14px + rótulo + valor, separados por um traço fino) e, à direita, o seletor
 * da sub-seção. No celular os números rolam de lado numa faixa só.
 */
export function LinhaResumos({ itens, children, direita, testid }: { itens?: ItemResumo[]; children?: ReactNode; direita?: ReactNode; testid?: string }) {
  return (
    <Linha direita={direita} testid={testid} direitaPrimeiro>
      {itens && itens.length > 0 && (
        <ul className="flex min-w-0 flex-wrap items-center gap-y-[4px] max-md:-mx-[16px] max-md:flex-nowrap max-md:overflow-x-auto max-md:px-[16px] max-md:[scrollbar-width:none]" aria-label="Resumo">
          {itens.map((i, n) => {
            const t = TONS_PAINEL[i.tom ?? 'cinza']
            const corpo = (
              <>
                {i.icone && (
                  <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] flex-shrink-0 fill-current" style={{ color: t.cor }} aria-hidden="true">
                    {i.icone.map((d) => <path key={d} d={d} />)}
                  </svg>
                )}
                <span className="text-[var(--adm-texto-medio,#4b5563)]">{i.rotulo}</span>
                <b className="font-semibold tabular-nums" style={{ color: i.destaque ? t.cor : 'var(--adm-texto, #1f2937)' }}>{i.valor}</b>
              </>
            )
            return (
              <li key={i.rotulo} title={i.dica} className={`flex flex-shrink-0 items-center ${n > 0 ? 'before:mx-[8px] before:h-[16px] before:w-px before:bg-[var(--adm-borda-forte,#d6dae1)]' : ''}`}>
                {i.filtro ? (
                  <button type="button" onClick={i.filtro.onClick} aria-pressed={i.filtro.ativo} data-testid={i.testid}
                    title={i.filtro.ativo ? 'Mostrando só estes. Toque para ver todos.' : 'Mostrar só estes'}
                    className={`inline-flex h-[30px] !min-h-0 items-center gap-[6px] whitespace-nowrap rounded-[6px] border px-[8px] text-[12px] transition-colors duration-150 max-lg:h-[40px] ${FOCO_GUIA} ${i.filtro.ativo ? 'border-[#0A78BE] bg-[#E1EDF7]' : 'border-dashed border-[var(--adm-borda-forte,#d6dae1)] bg-white hover:border-[#9AA6B1]'}`}>
                    {corpo}
                  </button>
                ) : (
                  <span className="inline-flex h-[30px] items-center gap-[5px] whitespace-nowrap text-[12px]" data-testid={i.testid}>{corpo}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {children}
    </Linha>
  )
}

/** Linha 2: filtros à esquerda (segmentado, busca, ordenação) e ações à direita (CSV, botão principal). */
export function BarraFiltros({ children, acoes, testid }: { children?: ReactNode; acoes?: ReactNode; testid?: string }) {
  return <Linha direita={acoes} testid={testid}>{children}</Linha>
}

export interface OpcaoSecao<T extends string> { id: T; rotulo: string }

/** Lista suspensa que troca a sub-seção (no lugar da fileira de abas). Nativa: teclado e celular de graça. */
export function SeletorSecao<T extends string>({ valor, opcoes, onMudar, rotulo = 'Ver', testid }: {
  valor: T; opcoes: OpcaoSecao<T>[]; onMudar: (v: T) => void; rotulo?: string; testid?: string
}) {
  return (
    <label className="relative inline-flex flex-shrink-0 items-center max-md:w-full">
      <span className="sr-only">{rotulo}</span>
      <select value={valor} onChange={(e) => onMudar(e.target.value as T)} data-testid={testid}
        className={`h-[36px] cursor-pointer max-md:w-full appearance-none rounded-[6px] border border-[var(--adm-borda-forte,#d6dae1)] bg-white pl-[12px] pr-[34px] text-[13px] font-semibold text-[var(--adm-texto,#1f2937)] hover:border-[#9AA6B1] max-lg:h-[44px] ${FOCO_GUIA}`}>
        {opcoes.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-[10px] h-[16px] w-[16px] text-[var(--adm-texto-medio,#4b5563)]" aria-hidden="true" />
    </label>
  )
}

/** Controle segmentado pequeno (situação, período): um botão por opção, o ativo em branco sobre o trilho cinza. */
export function Segmentado<T extends string>({ valor, opcoes, onMudar, rotulo, testidPrefixo }: {
  /** null: nenhuma opção ativa (ex.: período digitado à mão). */
  valor: T | null; opcoes: OpcaoSecao<T>[]; onMudar: (v: T) => void; rotulo: string; testidPrefixo?: string
}) {
  return (
    <div role="group" aria-label={rotulo} className="flex max-w-full flex-shrink-0 overflow-x-auto [scrollbar-width:none] max-md:w-full">
      <div className="inline-flex h-[32px] items-center rounded-[6px] border border-[var(--adm-borda,#e5e7eb)] bg-[#F3F4F6] p-[2px] max-lg:h-[44px]">
        {opcoes.map((o) => {
          const ativo = o.id === valor
          return (
            <button key={o.id} type="button" aria-pressed={ativo} onClick={() => onMudar(o.id)} data-testid={testidPrefixo ? `${testidPrefixo}${o.id}` : undefined}
              className={`h-full !min-h-0 whitespace-nowrap rounded-[4px] px-[10px] text-[12.5px] font-semibold transition-colors duration-150 ${FOCO_GUIA} ${ativo ? 'bg-white text-[var(--adm-texto,#1f2937)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-[var(--adm-texto-medio,#4b5563)] hover:text-[var(--adm-texto,#1f2937)]'}`}>
              {o.rotulo}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Aviso comprido e baixo para a barra do topo, no amarelo da conversa que pede atendente na central do WhatsApp
 * (components/ui/tokens-central.ts: DESTAQUE_NOVO + FAIXA_NOVO). Texto curto + ação; a explicação inteira no "i".
 * No celular a TopBar o põe numa faixa fina logo abaixo da barra.
 */
export function AvisoTopo({ texto, acao, info, testid }: {
  texto: ReactNode; acao?: ReactNode; info?: { titulo: string; conteudo: ReactNode }; testid?: string
}) {
  return (
    <div role="status" data-testid={testid}
      className="flex min-h-[34px] w-full min-w-0 items-center gap-[6px] rounded-[6px] border border-l-[3px] border-[#FCD34D] border-l-[#F59E0B] bg-[#FEF3C7] py-[2px] pl-[10px] pr-[3px] text-[12.5px] font-semibold text-[#92400E]">
      <span className="min-w-0 flex-1 truncate">{texto}</span>
      {info && <BalaoInfo titulo={info.titulo}>{info.conteudo}</BalaoInfo>}
      {acao}
    </div>
  )
}

/** Botão pequeno do AvisoTopo (cabe na faixa de 34px). */
export const BOTAO_AVISO_TOPO = `inline-flex h-[28px] !min-h-0 flex-shrink-0 items-center whitespace-nowrap rounded-[4px] bg-[#0688D4] px-[10px] text-[12px] font-semibold text-white hover:bg-[#0570AE] max-lg:h-[36px] ${FOCO_GUIA}`
