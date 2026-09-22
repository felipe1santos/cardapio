import { readFileSync } from 'node:fs'
import pg from 'pg'
const raw = readFileSync('C:/projetos/cardapio/.env.local', 'utf8')
const env = {}
for (const l of raw.split('\n')) {
  const t = l.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i < 0) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
export const client = new pg.Client({ connectionString: env.DATABASE_URL ?? env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
