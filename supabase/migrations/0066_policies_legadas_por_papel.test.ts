import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0066_policies_legadas_por_papel.sql'), 'utf8')

/** Extrai `tabela -> papéis` da lista de valores da migration. */
function lista(): Map<string, string[]> {
  const mapa = new Map<string, string[]>()
  for (const [, tabela, papeis] of sql.matchAll(/\('(\w+)',\s*'([\w,]+)'\)/g)) {
    mapa.set(tabela, papeis.split(','))
  }
  return mapa
}

describe('0066 — policies legadas ganham lista de papéis', () => {
  it('o dono está em TODAS as listas — as lojas de produção não perdem nada', () => {
    const m = lista()
    expect(m.size).toBeGreaterThan(20)
    for (const [tabela, papeis] of m) expect(papeis, tabela).toContain('dono')
  })

  it('garçom não escreve em nenhuma tabela legada', () => {
    for (const [tabela, papeis] of lista()) expect(papeis, tabela).not.toContain('garcom')
  })

  it('cobre o catálogo inteiro — a brecha era alterar preço', () => {
    const m = lista()
    for (const t of ['itens_cardapio', 'grupos_cardapio', 'item_complementos', 'grupos_item_complementos', 'tamanhos_item', 'pizza_sabores', 'pizza_sabor_precos']) {
      expect(m.get(t), t).toEqual(['dono', 'gerente'])
    }
  })

  it('cobre marketing, fidelidade e frete', () => {
    const m = lista()
    for (const t of ['cupons', 'campanhas', 'campanhas_fidelidade', 'fidelidade_recompensas', 'taxas_entrega_bairro', 'taxas_entrega_raio']) {
      expect(m.has(t), t).toBe(true)
    }
  })

  it('não reescreve condição à mão: mantém a original e acrescenta o papel', () => {
    expect(sql).toMatch(/format\('\(%s\) and public\.auth_papel\(\) in \(%s\)', pol\.qual, papeis\)/)
  })

  it('é idempotente — não empilha a condição ao rodar de novo', () => {
    expect(sql).toMatch(/like '%auth_papel\(\)%'/)
  })

  it('a loja (restaurantes) só é alterada por dono, gerente e atendente', () => {
    expect(sql).toMatch(/tablename = 'restaurantes' and cmd = 'UPDATE'/)
    expect(sql).toMatch(/in \(''dono'', ''gerente'', ''atendente''\)/)
  })

  it('não mexe em dado nenhum', () => {
    const semComentarios = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    expect(semComentarios).not.toMatch(/\b(insert into|delete from|truncate)\b/i)
    expect(semComentarios).not.toMatch(/^\s*update\s+public\./im)
  })
})
