import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, sep } from 'path'

/**
 * Guarda arquitetural: nenhuma rota do salão (painel) ou da mesa pública lê do CORPO da
 * requisição um campo que só o servidor pode decidir.
 *
 * Loja, papel e autor vêm da sessão; mesa, da URL (ou do token); comanda, do banco;
 * preço e totais, do catálogo e de `comanda_totais()`; status, pago e impresso, do
 * fluxo. Se alguém escrever `corpo.restauranteId` aqui, este teste reprova antes da
 * revisão.
 */

const RAIZES = ['app/api/admin/mesas', 'app/api/mesa', 'app/api/admin/modulos', 'app/api/admin/equipe']

const PROIBIDOS = [
  'restauranteId', 'restaurante_id', 'canal', 'origem', 'comandaId', 'comanda_id', 'criadoPor', 'criado_por',
  'preco', 'precoUnitario', 'preco_unitario', 'total', 'subtotal', 'pago', 'impresso', 'status', 'usuarioId',
  'responsavel_id', 'fechada_por', 'numero', 'token',
]

function rotas(dir: string): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) saida.push(...rotas(p))
    else if (nome === 'route.ts') saida.push(p)
  }
  return saida
}

const arquivos = RAIZES.flatMap((r) => rotas(join(process.cwd(), r)))

describe('mass assignment nas rotas do salão', () => {
  it('encontra as rotas (a varredura não está olhando para o vazio)', () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(10)
  })

  for (const arquivo of arquivos) {
    const nome = arquivo.slice(process.cwd().length + 1).split(sep).join('/')
    it(`${nome} não lê do corpo campo decidido pelo servidor`, () => {
      const codigo = readFileSync(arquivo, 'utf8')
      const lidos = [...codigo.matchAll(/\bcorpo\??\.(\w+)/g)].map((m) => m[1]!)
      const proibidosLidos = lidos.filter((c) => PROIBIDOS.includes(c))
      expect(proibidosLidos, nome).toEqual([])
    })
  }

  it('o lançamento passa o corpo por allowlist antes de chegar a criarPedido', () => {
    const codigo = readFileSync(join(process.cwd(), 'app/api/admin/mesas/[id]/lancamento/route.ts'), 'utf8')
    expect(codigo).toMatch(/sanearItensLancamento\(corpo\.itens\)/)
    expect(codigo).not.toMatch(/corpo\.itens as/)
  })

  it('toda rota do painel do salão entra por contextoSalao (sessão + flag + permissão)', () => {
    for (const arquivo of arquivos.filter((a) => a.split(sep).join('/').includes('app/api/admin/mesas'))) {
      expect(readFileSync(arquivo, 'utf8'), arquivo).toMatch(/contextoSalao\(/)
    }
  })
})
