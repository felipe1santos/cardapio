/**
 * Sugestões de cliente (2026-10-01): agrupa os pedidos por telefone (o mais recente manda
 * no nome), ignora sem telefone e nomes genéricos, e ordena por relevância (começa com o
 * termo > contém) e depois pela compra mais recente. Máx. 8.
 */
export interface LinhaPedidoCliente { cliente_nome: string | null; cliente_telefone: string | null; criado_em: string }
export interface SugestaoCliente { nome: string; telefone: string; ultimaCompraEm: string }

const GENERICOS = /^(cliente( balc[aã]o)?|balc[aã]o|mesa\s*\d*)$/i

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function sugestoesDeClientes(linhas: LinhaPedidoCliente[], termo: string, max = 8): SugestaoCliente[] {
  const t = semAcento(termo.trim())
  const dig = termo.replace(/\D/g, '')
  const porTel = new Map<string, SugestaoCliente>()
  for (const l of linhas) {
    const tel = (l.cliente_telefone ?? '').replace(/\D/g, '')
    const nome = (l.cliente_nome ?? '').trim()
    if (tel.length < 8 || !nome || GENERICOS.test(nome)) continue
    const atual = porTel.get(tel)
    if (!atual || l.criado_em > atual.ultimaCompraEm) porTel.set(tel, { nome, telefone: tel, ultimaCompraEm: l.criado_em })
  }
  const nota = (s: SugestaoCliente) => {
    const n = semAcento(s.nome)
    if (n.startsWith(t) || (dig.length >= 2 && s.telefone.replace(/^55/, '').startsWith(dig))) return 2
    if (n.includes(t) || (dig.length >= 2 && s.telefone.includes(dig))) return 1
    return 0
  }
  return [...porTel.values()]
    .filter((s) => nota(s) > 0)
    .sort((a, b) => nota(b) - nota(a) || b.ultimaCompraEm.localeCompare(a.ultimaCompraEm))
    .slice(0, max)
}
