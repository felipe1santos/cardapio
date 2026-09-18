import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * Guarda arquitetural: existe UM catálogo.
 *
 * O risco que este arquivo cobre não é um bug de runtime — é a tentação, numa sessão
 * futura, de "resolver" o salão criando `itens_mesa`, `cardapio_salao` ou um job que
 * copia produto de uma tabela para outra. No dia em que isso acontecer, o dono passa a
 * cadastrar o mesmo hambúrguer duas vezes e as duas cópias divergem na primeira troca de
 * preço. Estes testes falham antes disso chegar ao main.
 */

const raiz = join(__dirname, '..', '..')
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8')

/** Toda superfície que mostra cardápio: a de delivery e as duas do salão. */
const SUPERFICIES = [
  'app/loja/[slug]/page.tsx',
  'app/mesa/[token]/page.tsx',
  'app/api/mesa/[token]/selecao/route.ts',
  'app/admin/mesas/[id]/page.tsx',
  'app/admin/pdv/page.tsx',
]

describe('catálogo único entre delivery, mesa e balcão', () => {
  it('nenhuma migration cria tabela de catálogo paralela', () => {
    const dir = join(raiz, 'supabase', 'migrations')
    const proibidas = /create table (if not exists )?(public\.)?(itens_mesa|cardapio_mesa|cardapio_salao|itens_salao|produtos_mesa|menu_mesa)\b/i
    for (const arquivo of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      expect(readFileSync(join(dir, arquivo), 'utf8'), arquivo).not.toMatch(proibidas)
    }
  })

  it('todas as superfícies leem o cardápio de lib/queries/cardapio', () => {
    for (const arquivo of SUPERFICIES) {
      const fonte = ler(arquivo)
      expect(fonte, arquivo).toMatch(/from '@\/lib\/queries\/cardapio'/)
    }
  })

  it('só o catálogo canônico consulta itens_cardapio — nenhuma tela faz o seu próprio SELECT', () => {
    for (const arquivo of SUPERFICIES) {
      expect(ler(arquivo), arquivo).not.toMatch(/from\('itens_cardapio'\)/)
    }
  })

  it('as superfícies do salão filtram pelo canal, e não por cadastro separado', () => {
    for (const arquivo of ['app/mesa/[token]/page.tsx', 'app/api/mesa/[token]/selecao/route.ts', 'app/admin/mesas/[id]/page.tsx']) {
      expect(ler(arquivo), arquivo).toMatch(/itemDisponivelNoCanal\([\s\S]{0,40}'mesa'\)/)
    }
    expect(ler('lib/queries/cardapio.ts')).toMatch(/itemDisponivelNoCanal\(item, 'delivery'\)/)
  })

  it('o preço oficial é recalculado no servidor no lançamento — a mesa não grava preço do navegador', () => {
    const lancamento = ler('app/api/admin/mesas/[id]/lancamento/route.ts')
    // Quem repreço é `criarPedido`, que lê `itens_cardapio` de novo.
    expect(lancamento).toMatch(/criarPedido\(/)
    expect(lancamento).not.toMatch(/preco(Unitario)?:\s*(corpo|body)/)
    const pedidos = ler('lib/queries/pedidos.ts')
    expect(pedidos).toMatch(/itemDisponivelNoCanal\(/)
  })

  it('a seleção pública também reprecifica pelo catálogo: nada de preço inventado na tela do garçom', () => {
    const selecao = ler('app/api/mesa/[token]/selecao/route.ts')
    expect(selecao).toMatch(/listarItens\(/)
    expect(selecao).toMatch(/sanearSelecao\(/)
  })
})
