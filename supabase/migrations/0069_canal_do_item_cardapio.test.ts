import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0069_canal_do_item_cardapio.sql'), 'utf8')

describe('0069 — canal do item de cardápio', () => {
  it('as duas colunas nascem `true`: nenhuma loja perde item por causa da migration', () => {
    expect(sql).toMatch(/disponivel_delivery boolean not null default true/)
    expect(sql).toMatch(/disponivel_salao boolean not null default true/)
  })

  it('não cria tabela de catálogo paralela para mesa — o catálogo é um só', () => {
    expect(sql).not.toMatch(/create table/i)
    expect(sql).not.toMatch(/insert into/i)
    // Nada de copiar item para lugar nenhum.
    expect(sql).not.toMatch(/select .* from public\.itens_cardapio/i)
  })

  it('item fora dos dois canais é recusado pelo banco', () => {
    expect(sql).toMatch(/check \(disponivel_delivery or disponivel_salao\)/)
  })

  it('mexe só em itens_cardapio: preço, foto e complemento seguem onde estavam', () => {
    const tabelas = [...sql.matchAll(/alter table public\.(\w+)/g)].map((m) => m[1])
    expect([...new Set(tabelas)]).toEqual(['itens_cardapio'])
  })
})
