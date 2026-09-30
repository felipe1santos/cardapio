/**
 * Webhook do WhatsApp de TODAS as lojas com instância — conferência e registro.
 * Mesma regra de lib/mensageria/webhook-loja.ts (decidirWebhook):
 *   - só instâncias gravadas em restaurantes.evolution_instance (órfãs e NR13 nunca);
 *   - webhook ativo de outro host não é sobrescrito;
 *   - registrar não desconecta a loja.
 * Sem --aplicar só mostra o estado e o que faria. Segredos e URLs saem mascarados.
 *
 *   node scripts/seguranca/webhooks-lojas-producao.mjs
 *   node scripts/seguranca/webhooks-lojas-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = Object.fromEntries(readFileSync(join(raiz, '.env.local'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')] }))
const aplicar = process.argv.includes('--aplicar')
if (aplicar && !process.argv.includes('--confirmar-producao')) { console.error('❌ --aplicar exige --confirmar-producao'); process.exit(1) }
const BASE = (env.EVOLUTION_API_URL ?? '').replace(/\/$/, '')
const H = { apikey: env.EVOLUTION_API_KEY }
const PUBLICA = (env.MENUZIA_URL_PUBLICA ?? 'https://app.menuzia.com.br').replace(/\/$/, '')
const EVENTOS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE']
if (!BASE || !H.apikey || !env.DATABASE_URL) { console.error('❌ faltam EVOLUTION_API_URL/KEY ou DATABASE_URL'); process.exit(1) }

function decidir(atual, nossa) {
  const url = atual?.url?.trim() ?? ''
  if (!url) return 'registrar'
  let host = ''
  try { host = new URL(url).host } catch { return 'registrar' }
  if (host !== new URL(nossa).host) return atual?.enabled === false ? 'registrar' : 'outro_uso'
  const ev = new Set((atual?.events ?? []).map((e) => String(e).toUpperCase()))
  return url === nossa && atual?.enabled !== false && EVENTOS.every((e) => ev.has(e)) ? 'ja_estava' : 'registrar'
}
const mascarar = (u) => (u ? u.replace(/[0-9a-f]{16,}/gi, '<segredo>') : '—')
const achar = async (inst) => { const r = await fetch(`${BASE}/webhook/find/${encodeURIComponent(inst)}`, { headers: H }); return r.ok ? r.json().catch(() => null) : null }
const estado = async (inst) => { const r = await fetch(`${BASE}/instance/connectionState/${encodeURIComponent(inst)}`, { headers: H }); return r.ok ? (await r.json().catch(() => null))?.instance?.state ?? '?' : String(r.status) }

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
const lojas = (await db.query(`select r.id, r.slug, r.evolution_instance, c.webhook_segredo from restaurantes r
  left join whatsapp_robo_config c on c.restaurante_id = r.id where r.evolution_instance is not null order by r.slug`)).rows

console.log(aplicar ? '(APLICAR)' : '(SÓ CONFERÊNCIA)')
for (const l of lojas) {
  let segredo = l.webhook_segredo
  if (!segredo && aplicar) {
    segredo = (await db.query(`insert into whatsapp_robo_config (restaurante_id) values ($1) on conflict (restaurante_id) do update set restaurante_id = excluded.restaurante_id returning webhook_segredo`, [l.id])).rows[0].webhook_segredo
  }
  const nossa = segredo ? `${PUBLICA}/api/whatsapp/webhook/${segredo}` : null
  const antes = await achar(l.evolution_instance)
  const decisao = nossa ? decidir(antes, nossa) : 'sem_segredo'
  let depois = antes
  if (aplicar && decisao === 'registrar') {
    const r = await fetch(`${BASE}/webhook/set/${encodeURIComponent(l.evolution_instance)}`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook: { enabled: true, url: nossa, byEvents: false, base64: false, events: EVENTOS } }),
    })
    if (!r.ok) console.log(`   ⚠ ${l.slug}: webhook/set respondeu ${r.status}`)
    depois = await achar(l.evolution_instance)
  }
  const final = nossa ? decidir(depois, nossa) : 'sem_segredo'
  console.log(`${l.slug.padEnd(24)} ${String(await estado(l.evolution_instance)).padEnd(11)} antes: ${mascarar(antes?.url)} ${antes?.enabled === false ? '(off)' : ''} → ${decisao}${aplicar ? ` → agora: ${final === 'ja_estava' ? '✅ registrado' : final}` : ''}`)
}
await db.end()
