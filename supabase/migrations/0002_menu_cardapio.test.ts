import { Client } from 'pg'

describe.skipIf(!process.env.SUPABASE_DB_URL)('0002_menu_cardapio migration', () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  it('creates the menu tables', async () => {
    const { rows } = await client.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name in (
         'grupos_cardapio', 'itens_cardapio', 'presets_complementos',
         'preset_complemento_itens', 'item_complementos'
       )`
    )
    const names = rows.map((r) => r.table_name).sort()
    expect(names).toEqual([
      'grupos_cardapio',
      'item_complementos',
      'itens_cardapio',
      'preset_complemento_itens',
      'presets_complementos',
    ])
  })

  it('enables row level security on every menu table', async () => {
    const { rows } = await client.query(
      `select relname, relrowsecurity from pg_class
       where relname in (
         'grupos_cardapio', 'itens_cardapio', 'presets_complementos',
         'preset_complemento_itens', 'item_complementos'
       )`
    )
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true)
    }
  })

  it('creates the public cardapio storage bucket', async () => {
    const { rows } = await client.query(
      `select id, public from storage.buckets where id = 'cardapio'`
    )
    expect(rows).toEqual([{ id: 'cardapio', public: true }])
  })
})
