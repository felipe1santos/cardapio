// Aplica as migrations SQL e cria a loja + usuário admin inicial no Supabase.
//
// Uso:
//   1. Preencha .env.local (veja .env.local.example)
//   2. node scripts/setup-db.mjs
//
// É seguro rodar mais de uma vez: migrations já aplicadas são puladas e o seed
// não duplica a loja nem o usuário.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// --- carrega .env.local (parser mínimo, sem dependências) -----------------
function loadEnv() {
  let raw
  try {
    raw = readFileSync(join(root, '.env.local'), 'utf8')
  } catch {
    fail('Arquivo .env.local não encontrado. Copie .env.local.example para .env.local e preencha as chaves.')
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}

function require(name) {
  const v = process.env[name]
  if (!v || v.includes('YOUR_') || v.includes('your-')) {
    fail(`Variável ${name} ausente ou ainda com o valor de exemplo no .env.local.`)
  }
  return v
}

loadEnv()

const DATABASE_URL = require('DATABASE_URL')

const ADMIN_EMAIL = require('SEED_ADMIN_EMAIL')
const ADMIN_PASSWORD = require('SEED_ADMIN_PASSWORD')
const ADMIN_NOME = process.env.SEED_ADMIN_NOME || 'Administrador'
const LOJA_NOME = require('SEED_LOJA_NOME')
const LOJA_SLUG = require('SEED_LOJA_SLUG')

// --- 1. migrations --------------------------------------------------------
async function runMigrations() {
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        aplicada_em timestamptz not null default now()
      )
    `)

    const dir = join(root, 'supabase', 'migrations')
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

    for (const file of files) {
      const { rows } = await client.query('select 1 from schema_migrations where name = $1', [file])
      if (rows.length) {
        console.log(`  ⏭️  ${file} (já aplicada)`)
        continue
      }
      const sql = readFileSync(join(dir, file), 'utf8')
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query('insert into schema_migrations (name) values ($1)', [file])
        await client.query('commit')
        console.log(`  ✅ ${file}`)
      } catch (err) {
        await client.query('rollback')
        fail(`Falha ao aplicar ${file}: ${err.message}`)
      }
    }
  } finally {
    await client.end()
  }
}

// --- 2. seed: loja + usuário admin ---------------------------------------
// Cria o usuário de auth diretamente em auth.users/auth.identities (o mesmo que
// a Admin API faria), porque a API HTTPS pode estar inacessível em alguns
// ambientes — a conexão direta ao banco basta.
async function seed() {
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    // loja (tenant)
    let { rows } = await client.query('select id from restaurantes where slug = $1', [LOJA_SLUG])
    let restauranteId = rows[0]?.id
    if (!restauranteId) {
      const inserted = await client.query(
        'insert into restaurantes (nome, slug) values ($1, $2) returning id',
        [LOJA_NOME, LOJA_SLUG]
      )
      restauranteId = inserted.rows[0].id
      console.log(`  ✅ loja "${LOJA_NOME}" criada (slug: ${LOJA_SLUG})`)
    } else {
      console.log(`  ⏭️  loja "${LOJA_SLUG}" já existe`)
    }

    // usuário de auth (email + senha) via SQL
    await client.query('create extension if not exists pgcrypto with schema extensions')

    const userRes = await client.query(
      `
      with novo as (
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at, confirmation_token, recovery_token,
          email_change_token_new, email_change
        )
        select
          '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
          'authenticated', 'authenticated', $1::text,
          extensions.crypt($2::text, extensions.gen_salt('bf')),
          now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          now(), now(), '', '', '', ''
        where not exists (select 1 from auth.users where email = $1::text)
        returning id
      )
      select id, true as criado from novo
      union all
      select id, false as criado from auth.users where email = $1::text
      limit 1
      `,
      [ADMIN_EMAIL, ADMIN_PASSWORD]
    )
    const userId = userRes.rows[0].id
    console.log(`  ${userRes.rows[0].criado ? '✅ usuário ' + ADMIN_EMAIL + ' criado no Auth' : '⏭️  usuário ' + ADMIN_EMAIL + ' já existe no Auth'}`)

    // identidade de email (necessária para login por senha)
    await client.query(
      `
      insert into auth.identities (
        provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      )
      select $1::text, $2::uuid, jsonb_build_object('sub', $2::text, 'email', $3::text), 'email', now(), now(), now()
      where not exists (
        select 1 from auth.identities where provider = 'email' and user_id = $2::uuid
      )
      `,
      [userId, userId, ADMIN_EMAIL]
    )

    // vínculo usuário -> loja (papel: dono)
    await client.query(
      `insert into usuarios (id, restaurante_id, papel, nome)
       values ($1, $2, 'dono', $3)
       on conflict (id) do update set restaurante_id = excluded.restaurante_id, nome = excluded.nome`,
      [userId, restauranteId, ADMIN_NOME]
    )
    console.log(`  ✅ ${ADMIN_EMAIL} vinculado à loja como "dono"`)
  } finally {
    await client.end()
  }
}

console.log('\n▶ Aplicando migrations...')
await runMigrations()
console.log('\n▶ Criando loja e usuário admin...')
await seed()
console.log(`\n✅ Tudo pronto!`)
console.log(`   • Painel:  http://localhost:3000/login   (${ADMIN_EMAIL})`)
console.log(`   • Vitrine: http://localhost:3000/loja/${LOJA_SLUG}\n`)
