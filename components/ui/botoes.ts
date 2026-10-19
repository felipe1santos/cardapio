/**
 * Botões do sistema (Bloco C, 19/10/2026): as classes que usam os tokens `--btn-*` de app/globals.css, copiados da
 * barra "Ver no mapa" do Despacho de rotas. Um tom por intenção — azul (seguir: Aceitar, Despachar, Saiu p/ entrega),
 * verde (concluir: Pronto, Entregue), vermelho (cancelar/avisos), grafite (neutro), preto (em rota).
 */
export type TomBotao = 'grafite' | 'azul' | 'preto' | 'verde' | 'vermelho'

const BASE = 'inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-[2px] font-semibold text-white transition-colors disabled:opacity-50'
const TOM: Record<TomBotao, string> = {
  grafite: 'bg-[var(--btn-grafite)] hover:bg-[var(--btn-grafite-escuro)]',
  azul: 'bg-[var(--btn-azul)] hover:bg-[var(--btn-azul-escuro)]',
  preto: 'bg-[var(--btn-preto)] hover:bg-[var(--btn-preto-escuro)]',
  verde: 'bg-[var(--btn-verde)] hover:bg-[var(--btn-verde-escuro)]',
  vermelho: 'bg-[var(--btn-vermelho)] hover:bg-[var(--btn-vermelho-escuro)]',
}
const BADGE: Record<TomBotao, string> = {
  grafite: 'bg-[var(--btn-grafite-escuro)]', azul: 'bg-[var(--btn-azul-escuro)]', preto: 'bg-[var(--btn-preto-escuro)]',
  verde: 'bg-[var(--btn-verde-escuro)]', vermelho: 'bg-[var(--btn-vermelho-escuro)]',
}

/** Botão sólido no tom. `tamanho`: card 26px/11,5px (padrão) · normal 32px/12px · grande 46px/14px. */
export function classeBotao(tom: TomBotao, tamanho: 'card' | 'normal' | 'grande' = 'card'): string {
  const t = tamanho === 'grande' ? 'h-[46px] px-5 text-[14px]' : tamanho === 'normal' ? 'h-[32px] px-3 text-[12px]' : 'h-[26px] min-w-0 px-2.5 text-[11.5px]'
  return `${BASE} ${t} ${TOM[tom]}`
}

/** Contador dentro do botão: badge de tom mais escuro, como na barra do despacho. */
export function classeBadge(tom: TomBotao): string {
  return `grid h-[18px] min-w-[18px] place-items-center rounded-[3px] px-1 text-[11px] font-semibold text-white ${BADGE[tom]}`
}

/** Neutro vazado em grafite (ícones: imprimir, editar, "···"). */
export const BOTAO_NEUTRO = 'inline-flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[2px] border border-[#D1D5DB] bg-white text-[var(--btn-grafite)] transition-colors hover:bg-[#E5E7EB] disabled:opacity-50'

/** Cor dos valores em dinheiro (card e painel): o verde dos Entregues. */
export const DINHEIRO = 'text-[var(--valor-dinheiro)]'
