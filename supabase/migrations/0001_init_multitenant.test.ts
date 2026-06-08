import { Client } from 'pg'

describe.skipIf(!process.env.SUPABASE_DB_URL)('0001_init_multitenant migration', () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  it('creates the restaurantes and usuarios tables', async () => {
    const { rows } = await client.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name in ('restaurantes', 'usuarios')`
    )
    const names = rows.map((r) => r.table_name).sort()
    expect(names).toEqual(['restaurantes', 'usuarios'])
  })

  it('enables row level security on both tables', async () => {
    const { rows } = await client.query(
      `select relname, relrowsecurity from pg_class
       where relname in ('restaurantes', 'usuarios')`
    )
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true)
    }
  })

  it('creates the auth_restaurante_id helper function', async () => {
    const { rows } = await client.query(
      `select proname from pg_proc where proname = 'auth_restaurante_id'`
    )
    expect(rows).toHaveLength(1)
  })
})
