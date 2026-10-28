// Conecta a instância de WhatsApp dos ALERTAS DO SISTEMA ("menuzia-alertas", 28/10/2026 — lib/saude/enviar.ts).
// Mostra o QR Code (abre a imagem) e espera até 3 min o celular ler; renova o QR a cada 30 s.
//   node scripts/saude/qr-alertas.mjs
// No celular que vai MANDAR os alertas: WhatsApp › Aparelhos conectados › Conectar aparelho › ler o QR.
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exec } from 'node:child_process'

for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const BASE = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '')
const H = { apikey: process.env.EVOLUTION_API_KEY ?? '' }
const INST = 'menuzia-alertas'
const arquivo = join(tmpdir(), 'menuzia-alertas-qr.png')

async function estado() {
  const r = await fetch(`${BASE}/instance/connectionState/${INST}`, { headers: H })
  return (await r.json())?.instance?.state ?? 'desconhecido'
}
async function mostrarQr() {
  const r = await fetch(`${BASE}/instance/connect/${INST}`, { headers: H })
  const j = await r.json()
  const b64 = String(j?.base64 ?? '').replace(/^data:image\/png;base64,/, '')
  if (!b64) { console.log('Evolution não devolveu QR:', JSON.stringify(j).slice(0, 200)); return }
  writeFileSync(arquivo, Buffer.from(b64, 'base64'))
  exec(process.platform === 'win32' ? `start "" "${arquivo}"` : `open "${arquivo}"`)
  console.log('QR aberto:', arquivo)
}

if ((await estado()) === 'open') { console.log('Já conectada.'); process.exit(0) }
const fim = Date.now() + 3 * 60_000
let proximoQr = 0
while (Date.now() < fim) {
  if (Date.now() >= proximoQr) { await mostrarQr(); proximoQr = Date.now() + 30_000 }
  await new Promise((ok) => setTimeout(ok, 3000))
  if ((await estado()) === 'open') { console.log('Conectada! Os alertas do sistema saem por ela.'); process.exit(0) }
}
console.log('Não conectou em 3 min — rode de novo.')
