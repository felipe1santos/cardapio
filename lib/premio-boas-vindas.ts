import type { FidelidadeCliente } from '@/lib/queries/fidelidade'

/**
 * O prêmio que a vitrine mostra num modal na primeira visita.
 *
 * Cupom e prêmio de fidelidade já existiam, mas viviam atrás de um banner
 * amarelo que muita gente rola direto. Quem chega com benefício ativo precisa
 * ver isso antes de montar a sacola — é o que muda a decisão de comprar.
 */
export interface PremioBoasVindas {
  /** Prêmio de campanha (fidelidade) ou cupom público da loja. */
  origem: 'fidelidade' | 'cupom'
  titulo: string
  descricao: string
  /** Código a digitar no checkout — só cupom tem. */
  codigo?: string
  imagemUrl?: string | null
}

function brl(valor: number) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** "50% de desconto", "R$ 10,00 de desconto", "Frete grátis", "X Burger grátis". */
function descreverBeneficio(
  tipo: 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis' | 'item_gratis',
  valor: number | null,
  itemNome?: string
): string {
  switch (tipo) {
    case 'item_gratis':
      return itemNome ? `${itemNome} grátis` : 'Um item grátis'
    case 'entrega_gratis':
      return 'Frete grátis'
    case 'desconto_percentual':
      return `${valor ?? 0}% de desconto`
    case 'desconto_valor':
      return `${brl(valor ?? 0)} de desconto`
  }
}

/**
 * Escolhe UM benefício pra anunciar. Prêmio de fidelidade vem antes de cupom:
 * é o que o cliente já conquistou, não uma oferta genérica da loja. Prêmio que
 * não pode ser resgatado hoje fica de fora — anunciar o que não dá pra usar
 * agora frustra mais do que ajuda.
 */
export function premioDeBoasVindas(fidelidade: FidelidadeCliente | null): PremioBoasVindas | null {
  if (!fidelidade) return null

  const recompensa = fidelidade.recompensas.find((r) => r.podeResgatarHoje)
  if (recompensa) {
    return {
      origem: 'fidelidade',
      titulo: 'Você tem um prêmio!',
      descricao: descreverBeneficio(recompensa.premioTipo, recompensa.premioValor, recompensa.premioItemNome),
      imagemUrl: recompensa.premioItemImagemUrl ?? null,
    }
  }

  const cupom = fidelidade.cuponsPublicos[0]
  if (cupom) {
    return {
      origem: 'cupom',
      titulo: 'Tem cupom pra você',
      descricao: cupom.descricao?.trim() || descreverBeneficio(cupom.tipo, cupom.valor, cupom.itemNome),
      codigo: cupom.codigo,
      imagemUrl: cupom.itemImagemUrl ?? null,
    }
  }

  return null
}

/**
 * Assinatura do que está ativo pro cliente. O modal é mostrado uma vez por
 * conjunto: fechou hoje, não volta a cada visita — mas volta quando a loja
 * solta um cupom novo ou o cliente ganha outro prêmio.
 */
export function assinaturaPremios(fidelidade: FidelidadeCliente | null): string {
  if (!fidelidade) return ''
  const premios = fidelidade.recompensas.filter((r) => r.podeResgatarHoje).map((r) => `p:${r.id}`)
  const cupons = fidelidade.cuponsPublicos.map((c) => `c:${c.id}`)
  return [...premios, ...cupons].sort().join('|')
}

/**
 * Deve abrir o lembrete de prêmio quando o cliente chega na sacola?
 *
 * Só faz sentido com sacola cheia, prêmio resgatável HOJE e nenhum benefício já
 * aplicado — oferecer um prêmio por cima de um cupom que o cliente escolheu
 * seria tirar dele a escolha (os dois são exclusivos no checkout).
 */
export function deveLembrarPremioNaSacola(estado: {
  aba: string
  itensNaSacola: number
  jaMostrado: boolean
  temBeneficioAplicado: boolean
  fidelidade: FidelidadeCliente | null
}): boolean {
  if (estado.aba !== 'cart' || estado.itensNaSacola === 0) return false
  if (estado.jaMostrado || estado.temBeneficioAplicado) return false
  return Boolean(estado.fidelidade?.recompensas.some((r) => r.podeResgatarHoje))
}
