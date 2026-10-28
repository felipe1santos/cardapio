// Gera a miniatura (perfil "thumb", 400 px WebP) dos itens que têm foto e não têm miniatura — todas as lojas, 28/10/2026.
// Sem miniatura, a lista da vitrine baixa a foto grande (até 1200 px) para mostrar 120 px (itens importados, ex. Villa).
// Nada é apagado: a miniatura sobe ao lado ("<nome>-mini.webp") e só a coluna vazia é preenchida.
//   node scripts/imagens/gerar-miniaturas.mjs             → ENSAIO: só mostra a economia
//   node scripts/imagens/gerar-miniaturas.mjs --aplicar   → sobe e grava imagem_thumb_url
//   node scripts/imagens/gerar-miniaturas.mjs --desfazer ~/menuzia-backups/miniaturas-….json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { otimizarBuffer } from './otimizar.mjs'

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const aplicar = process.argv.includes('--aplicar')
const idxDesfazer = process.argv.indexOf('--desfazer')

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const kb = (b) => `${(b / 1024).toFixed(0)} KB`

if (idxDesfazer > 0) {
  const { ids } = JSON.parse(readFileSync(process.argv[idxDesfazer + 1].replace(/^~/, homedir()), 'utf8'))
  const r = await db.query('update public.itens_cardapio set imagem_thumb_url = null where id = any($1)', [ids])
  console.log('desfeito: miniaturas removidas do banco =', r.rowCount)
  await db.end(); process.exit(0)
}

const nomeDe = (url) => { const m = /\/object\/public\/cardapio\/([^?]+)/.exec(url ?? ''); return m ? decodeURIComponent(m[1]) : null }
const itens = (await db.query('select id, imagem_url from public.itens_cardapio where imagem_url is not null and imagem_thumb_url is null')).rows
console.log(`${itens.length} itens com foto e sem miniatura (${aplicar ? 'APLICANDO' : 'ENSAIO — nada é gravado'})`)

const ids = []
let antes = 0, depois = 0, falhas = 0
for (const { id, imagem_url } of itens) {
  const nome = nomeDe(imagem_url)
  try {
    if (!nome) throw new Error('fora do bucket cardapio')
    const { data, error } = await sb.storage.from('cardapio').download(nome)
    if (error) throw error
    const original = Buffer.from(await data.arrayBuffer())
    const r = await otimizarBuffer(original, 'thumb', data.type)
    antes += original.length; depois += r.buffer.length
    if (!r.mudou) continue // a própria foto já é pequena: a lista continua usando ela
    if (aplicar) {
      const novo = nome.replace(/\.[a-z0-9]+$/i, '') + '-mini.webp'
      const up = await sb.storage.from('cardapio').upload(novo, r.buffer, { contentType: 'image/webp', cacheControl: '31536000', upsert: true })
      if (up.error) throw up.error
      const url = sb.storage.from('cardapio').getPublicUrl(novo).data.publicUrl
      const u = await db.query('update public.itens_cardapio set imagem_thumb_url = $2 where id = $1 and imagem_thumb_url is null', [id, url])
      if (u.rowCount) ids.push(id)
    }
  } catch (e) { falhas++; console.log('  falhou', id, (e?.message ?? e).toString().slice(0, 80)) }
}
console.log(`lista da vitrine: ${kb(antes)} → ${kb(depois)} (${antes ? Math.round((1 - depois / antes) * 100) : 0}% menor) · falhas: ${falhas}`)
if (aplicar && ids.length) {
  const pasta = join(homedir(), 'menuzia-backups'); mkdirSync(pasta, { recursive: true })
  const arq = join(pasta, `miniaturas-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`)
  writeFileSync(arq, JSON.stringify({ criado: new Date().toISOString(), ids }, null, 1))
  console.log(`gravadas ${ids.length}; para desfazer: ${arq}`)
}
await db.end()
