import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0058_canal_do_pedido.sql'), 'utf8')

describe('0058 — canal do pedido', () => {
  it('cria a coluna com default delivery e lista fechada', () => {
    expect(sql).toMatch(/add column if not exists canal text not null default 'delivery'/)
    const check = sql.match(/check \(canal in \(([^)]*)\)\)/)
    expect(check).not.toBeNull()
    const valores = check![1].split(',').map((v) => v.trim().replace(/'/g, ''))
    expect(valores.sort()).toEqual(['balcao', 'delivery', 'mesa'])
  })

  it('classifica mesa, balcão e delivery no backfill', () => {
    expect(sql).toMatch(/when origem = 'pdv' and comanda_id is not null then 'mesa'/)
    expect(sql).toMatch(/when origem = 'pdv'\s+then 'balcao'/)
    expect(sql).toMatch(/else 'delivery'/)
  })

  it('pedido com origem cardapio NUNCA vira mesa pelo backfill', () => {
    // Antes do checkpoint S qualquer um podia inserir pedido com comanda_id arbitrário.
    // Um pedido desses tem origem='cardapio' e precisa cair em 'delivery' — fora do
    // alcance do garçom.
    const caso = sql.match(/case([\s\S]*?)end/)![1]
    const ramoMesa = caso.match(/when ([^\n]*) then 'mesa'/)![1]
    expect(ramoMesa).toContain("origem = 'pdv'")
  })

  it('mesa exige comanda, por constraint', () => {
    expect(sql).toMatch(/check \(canal <> 'mesa' or comanda_id is not null\)/)
  })

  it('derruba a constraint antes de recriar (idempotência)', () => {
    expect(sql.indexOf('drop constraint if exists pedidos_canal_check'))
      .toBeLessThan(sql.indexOf('add constraint pedidos_canal_check'))
    expect(sql.indexOf('drop constraint if exists pedidos_canal_mesa_exige_comanda'))
      .toBeLessThan(sql.indexOf('add constraint pedidos_canal_mesa_exige_comanda'))
  })

  it('o backfill só toca linhas ainda no default', () => {
    // Reaplicar a migration não pode reclassificar pedido que o servidor já gravou.
    expect(sql).toMatch(/where canal = 'delivery'/)
  })
})
