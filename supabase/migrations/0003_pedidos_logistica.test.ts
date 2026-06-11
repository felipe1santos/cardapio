import { Client } from 'pg'

describe.skipIf(!process.env.SUPABASE_DB_URL)('0003_pedidos_logistica migration', () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  it('creates the order pipeline tables', async () => {
    const { rows } = await client.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name in (
         'pedidos', 'pedido_itens', 'entregadores', 'fechamentos_caixa'
       )`
    )
    const names = rows.map((r) => r.table_name).sort()
    expect(names).toEqual(['entregadores', 'fechamentos_caixa', 'pedido_itens', 'pedidos'])
  })

  it('enables row level security on every pipeline table', async () => {
    const { rows } = await client.query(
      `select relname, relrowsecurity from pg_class
       where relname in ('pedidos', 'pedido_itens', 'entregadores', 'fechamentos_caixa')`
    )
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true)
    }
  })

  it('numbers orders sequentially per restaurant', async () => {
    const { rows: lojas } = await client.query(`select id from restaurantes limit 1`)
    if (!lojas.length) return
    const restauranteId = lojas[0].id

    await client.query('begin')
    try {
      const a = await client.query(
        `insert into pedidos (restaurante_id, tipo, forma_pagamento, total) values ($1,'retirada','pix',10) returning numero`,
        [restauranteId]
      )
      const b = await client.query(
        `insert into pedidos (restaurante_id, tipo, forma_pagamento, total) values ($1,'retirada','pix',10) returning numero`,
        [restauranteId]
      )
      expect(b.rows[0].numero).toBe(a.rows[0].numero + 1)
    } finally {
      await client.query('rollback')
    }
  })

  it('lets anyone read a restaurant by slug (anonymous storefront)', async () => {
    const { rows } = await client.query(
      `select policyname from pg_policies
       where tablename = 'restaurantes' and policyname = 'Anyone can read restaurant storefront'`
    )
    expect(rows).toHaveLength(1)
  })
})
