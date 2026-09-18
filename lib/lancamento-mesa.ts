import type { NovoPedidoItemInput } from '@/lib/queries/pedidos'

/**
 * Allowlist do corpo de um lançamento de mesa.
 *
 * O navegador do garçom manda "qual item, quantos, quais opções, observação". Nada além
 * disso passa: preço, total, canal, loja, comanda, autor, status, pago e impresso são
 * decididos no servidor. Campo desconhecido é descartado em silêncio; campo conhecido
 * com tipo ou tamanho errado reprova a linha inteira — melhor o garçom ver o erro do
 * que a cozinha receber meio pedido.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const LIMITES_LANCAMENTO = {
  linhas: 60,
  quantidade: 99,
  observacao: 200,
  complementos: 40,
  nome: 120,
} as const

export type ResultadoSaneamento = { ok: true; itens: NovoPedidoItemInput[] } | { ok: false; erro: string }

function textoOpcional(v: unknown, max: number): string | undefined | null {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string' || v.length > max) return null
  return v.trim()
}

export function sanearItensLancamento(bruto: unknown): ResultadoSaneamento {
  if (!Array.isArray(bruto) || bruto.length === 0) return { ok: false, erro: 'Nenhum item no lançamento' }
  if (bruto.length > LIMITES_LANCAMENTO.linhas) return { ok: false, erro: 'Lançamento grande demais. Divida em dois envios.' }

  const itens: NovoPedidoItemInput[] = []
  for (const linha of bruto) {
    if (!linha || typeof linha !== 'object' || Array.isArray(linha)) return { ok: false, erro: 'Item inválido no lançamento' }
    const l = linha as Record<string, unknown>

    if (typeof l.itemId !== 'string' || !UUID.test(l.itemId)) return { ok: false, erro: 'Item inválido no lançamento' }
    const quantidade = typeof l.quantidade === 'number' ? l.quantidade : Number.NaN
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > LIMITES_LANCAMENTO.quantidade) {
      return { ok: false, erro: `Quantidade deve ser um número inteiro de 1 a ${LIMITES_LANCAMENTO.quantidade}.` }
    }

    const observacao = l.observacao === undefined || l.observacao === null ? '' : l.observacao
    if (typeof observacao !== 'string' || observacao.length > LIMITES_LANCAMENTO.observacao) {
      return { ok: false, erro: 'Observação inválida.' }
    }

    const complementos = l.complementos === undefined || l.complementos === null ? [] : l.complementos
    if (
      !Array.isArray(complementos) ||
      complementos.length > LIMITES_LANCAMENTO.complementos ||
      !complementos.every((c) => typeof c === 'string' && c.length > 0 && c.length <= LIMITES_LANCAMENTO.nome)
    ) {
      return { ok: false, erro: 'Opções inválidas.' }
    }

    const saida: NovoPedidoItemInput = {
      itemId: l.itemId,
      quantidade,
      observacao: observacao.trim(),
      complementos: complementos as string[],
    }
    for (const campo of ['tamanhoNome', 'saborNome', 'bordaNome', 'massaNome'] as const) {
      const v = textoOpcional(l[campo], LIMITES_LANCAMENTO.nome)
      if (v === null) return { ok: false, erro: 'Opções inválidas.' }
      if (v) saida[campo] = v
    }
    itens.push(saida)
  }
  return { ok: true, itens }
}
