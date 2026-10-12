import { pedidoLiberado } from './agendamento'
import type { Pedido, PedidoItem } from './queries/pedidos'

/**
 * KDS — tela da cozinha (prévia, 12/10/2026, só com "Novidades em teste"). Regras puras: cor do cronômetro, quais pedidos
 * aparecem, filtro por setor (categoria do cardápio) e os pedidos fictícios do modo demonstração (prints).
 */
export type CorTempo = 'verde' | 'amarelo' | 'vermelho'
export interface LimitesTempo { amarelo: number; vermelho: number }
export const LIMITES_PADRAO: LimitesTempo = { amarelo: 10, vermelho: 20 }

/** Verde abaixo de `amarelo` min; amarelo até `vermelho` min; vermelho depois. */
export function corDoTempo(minutos: number, limites: LimitesTempo = LIMITES_PADRAO): CorTempo {
  if (minutos < limites.amarelo) return 'verde'
  if (minutos <= limites.vermelho) return 'amarelo'
  return 'vermelho'
}

/** Limites guardados no aparelho (JSON). Inválido ou ausente: o padrão. */
export function lerLimites(bruto: string | null): LimitesTempo {
  try {
    const j = JSON.parse(bruto ?? '') as Partial<LimitesTempo>
    const a = Number(j.amarelo), v = Number(j.vermelho)
    if (Number.isInteger(a) && Number.isInteger(v) && a >= 1 && v > a && v <= 180) return { amarelo: a, vermelho: v }
  } catch { /* padrão */ }
  return LIMITES_PADRAO
}

export const minutosDesde = (iso: string, agora: number) => (agora - Date.parse(iso)) / 60_000

/** Pedidos que a cozinha faz agora: recebido e preparando (agendado só quando liberado), mais antigos primeiro. */
export function pedidosDaCozinha(lista: Pedido[], agora: Date, liberaMin: number): Pedido[] {
  return lista
    .filter((p) => (p.status === 'recebido' || p.status === 'preparando') && pedidoLiberado(p.agendadoPara, liberaMin, agora))
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
}

export function setoresDosPedidos(lista: Pedido[], setorDoItem: Map<string, string>): string[] {
  const s = new Set<string>()
  for (const p of lista) for (const i of p.itens) { const nome = i.itemId ? setorDoItem.get(i.itemId) : undefined; if (nome) s.add(nome) }
  return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/** Só os itens do setor; pedido sem item dele some. `null` = todos. */
export function filtrarPorSetor(lista: Pedido[], setorDoItem: Map<string, string>, setor: string | null): Pedido[] {
  if (!setor) return lista
  return lista
    .map((p) => ({ ...p, itens: p.itens.filter((i) => i.itemId && setorDoItem.get(i.itemId) === setor) }))
    .filter((p) => p.itens.length > 0)
}

// ── Demonstração: pedidos fictícios para os prints (não lê nem grava nada) ─────────────────────────────────────────
export type CenarioDemo = 'novo' | 'atrasado' | 'varios'
export const SETORES_DEMO = new Map([['d-burger', 'Lanches'], ['d-batata', 'Porções'], ['d-coca', 'Bebidas'], ['d-pizza', 'Pizzas'], ['d-acai', 'Açaí']])

const it = (id: string, itemId: string, nome: string, quantidade: number, extra: Partial<PedidoItem> = {}): PedidoItem => ({
  id, itemId, nome, descricao: '', precoUnitario: 0, quantidade, observacao: '', complementos: [], tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', ...extra,
})
const add = (...nomes: string[]) => nomes.map((nome) => ({ nome, preco: 0 }))

export function pedidosDemo(cenario: CenarioDemo, agora: number): Pedido[] {
  const ha = (min: number) => new Date(agora - min * 60_000).toISOString()
  const base = (id: string, numero: number, min: number, x: Partial<Pedido>): Pedido =>
    ({ id, numero, tipo: 'entrega', status: 'recebido', criadoEm: ha(min), agendadoPara: null, clienteNome: 'Cliente', canal: 'delivery', mesa: null, comandaSenha: null, itens: [], ...x } as Pedido)
  const novo = base('d1', 1042, 1, {
    itens: [
      it('d1a', 'd-burger', 'X-Bacon artesanal', 2, { complementos: add('Bacon extra', 'Cheddar'), observacao: 'Um SEM cebola' }),
      it('d1b', 'd-batata', 'Batata frita grande', 1),
      it('d1c', 'd-coca', 'Coca-Cola 2 L', 1),
    ],
  })
  if (cenario === 'novo') return [novo]
  const atrasado = base('d2', 1031, 27, {
    status: 'preparando', tipo: 'retirada',
    itens: [it('d2a', 'd-pizza', 'Pizza grande', 1, { tamanhoNome: 'Grande', saborNome: 'Calabresa / Portuguesa', bordaNome: 'Catupiry' }), it('d2b', 'd-coca', 'Guaraná lata', 2)],
  })
  if (cenario === 'atrasado') return [atrasado, { ...novo, criadoEm: ha(4) }]
  return [
    atrasado,
    base('d3', 1035, 16, { status: 'preparando', itens: [it('d3a', 'd-burger', 'Smash duplo', 3, { complementos: add('Sem picles') }), it('d3b', 'd-batata', 'Onion rings', 1)] }),
    base('d4', 1038, 12, { tipo: 'retirada', itens: [it('d4a', 'd-acai', 'Açaí 500 ml', 2, { complementos: add('Leite em pó', 'Morango', 'Granola'), observacao: 'Granola separada' })] }),
    base('d5', 1040, 7, { canal: 'mesa', mesa: '5', itens: [it('d5a', 'd-burger', 'X-Salada', 1), it('d5b', 'd-batata', 'Batata média', 1), it('d5c', 'd-coca', 'Suco de laranja', 2)] }),
    { ...novo, criadoEm: ha(2) },
    base('d6', 1043, 0.5, { itens: [it('d6a', 'd-pizza', 'Pizza média', 1, { tamanhoNome: 'Média', saborNome: 'Margherita', observacao: 'Bem assada' })] }),
  ]
}
