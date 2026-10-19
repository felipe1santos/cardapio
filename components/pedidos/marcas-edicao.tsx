import type { ReactNode } from 'react'
import type { AlteracaoPedido, EdicaoRegistro } from '@/lib/pedido-edicao-regras'

/**
 * Marcas de EDIÇÃO do pedido (Bloco A, 19/10/2026), as mesmas no card do Kanban e no painel:
 *  - o que foi EDITADO = AMARELO (fundo amarelo-claro com borda amarela, como o card antigo do Menuzia);
 *  - item removido = riscado + etiqueta "removido" em VERMELHO;
 *  - valor antigo = riscado, pequeno, em cinza, ao lado do novo.
 * Vermelho fica reservado à observação/aviso do CLIENTE.
 */
export const AMARELO_EDICAO = 'rounded-[2px] border border-[#F59E0B] bg-[#FEF3C7] px-1 text-[#92400E]'

/** Valor novo com fundo amarelo. */
export function Editado({ children, testid }: { children: ReactNode; testid?: string }) {
  return <span className={AMARELO_EDICAO} data-testid={testid}>{children}</span>
}

/** Valor antigo riscado, pequeno, ao lado. */
export function Antigo({ children }: { children: ReactNode }) {
  return <s className="ml-1 text-[0.85em] font-normal text-[#9CA3AF]">{children}</s>
}

/** Etiqueta "adicionado" (amarela) ou "removido" (vermelha). */
export function EtiquetaEdicao({ tipo }: { tipo: 'adicionado' | 'removido' }) {
  const cor = tipo === 'removido' ? 'border-[#FCA5A5] bg-[#FEE2E2] text-[#B91C1C]' : 'border-[#F59E0B] bg-[#FEF3C7] text-[#92400E]'
  return <span className={`ml-1 inline-block rounded-[2px] border px-1 align-[1px] text-[9.5px] font-semibold uppercase leading-[13px] tracking-[0.04em] ${cor}`} data-testid={`etiqueta-${tipo}`}>{tipo}</span>
}

/** Quantidade atual de cada item que teve a quantidade alterada (a última alteração vale). */
export function quantidadesAlteradas(edicoes: EdicaoRegistro[] | null | undefined): Map<string, Extract<AlteracaoPedido, { tipo: 'item_quantidade' }>> {
  const m = new Map<string, Extract<AlteracaoPedido, { tipo: 'item_quantidade' }>>()
  for (const e of edicoes ?? []) for (const a of e.alteracoes ?? []) if (a.tipo === 'item_quantidade') m.set(a.itemId, a)
  return m
}
