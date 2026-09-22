import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const raiz = join(__dirname, '..')
const css = readFileSync(join(raiz, 'app', 'globals.css'), 'utf8')
const vitrine = readFileSync(join(raiz, 'app', 'loja', '[slug]', 'vitrine.tsx'), 'utf8')

/**
 * Barra `fixed` de fundo sólido que o navegador não promove a uma camada de
 * composição é redesenhada junto com a página a cada quadro de rolagem. No
 * Chrome do Android o cliente vê o menu inferior "ficar branco" no meio do
 * gesto: os ladrilhos chegam com o fundo pintado antes do texto e dos ícones.
 *
 * Diagnosticado pelo LayerTree do Chrome: sem isto, nenhuma camada aparece com
 * o motivo "will-change: transform"; com isto, a barra ganha a dela.
 */
describe('barras fixas da vitrine não piscam na rolagem', () => {
  it('o menu inferior e a classe compartilhada ganham camada própria', () => {
    const bloco = css.slice(css.indexOf('.nav-rodape,'))
    expect(bloco).toMatch(/\.nav-rodape,\s*\n\.camada-propria\s*\{/)
    expect(bloco).toMatch(/transform:\s*translateZ\(0\)/)
    expect(bloco).toMatch(/will-change:\s*transform/)
  })

  /**
   * As duas barras de baixo da vitrine: o rodapé do carrinho/checkout e a faixa
   * "Ver sacola". Elas são irmãs do menu — mesma posição fixa, mesmo fundo
   * sólido, mesmo sintoma.
   */
  it('o rodapé do carrinho e a faixa da sacola usam a classe', () => {
    const barras = [...vitrine.matchAll(/className="([^"]*fixed inset-x-0 bottom-[^"]*)"/g)].map((m) => m[1])
    expect(barras.length).toBeGreaterThanOrEqual(2)
    for (const classes of barras) {
      // Folhas que sobem do rodapé (sheet de prêmio, de aviso) são outra coisa:
      // elas já animam com transform, e por isso o navegador já as promove.
      if (/rounded-t-2xl/.test(classes)) continue
      // O menu já é promovido pelo próprio seletor `.nav-rodape`.
      if (/nav-rodape/.test(classes)) continue
      expect(classes, `barra fixa sem camada própria: ${classes.slice(0, 70)}`).toContain('camada-propria')
    }
  })
})
