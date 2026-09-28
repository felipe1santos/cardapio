// Soma (gzip) dos JS da primeira visita a rotas do admin, lida do .next depois do build.
//   node scripts/seguranca/tamanho-bundle-admin.mjs /admin /admin/pedidos /admin/integracoes
import { readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
const m = JSON.parse(readFileSync('.next/app-build-manifest.json', 'utf8')).pages
const rotas = process.argv.slice(2)
for (const r of rotas) {
  const chaves = ['/layout', '/admin/layout', `${r}/page`].filter((k) => m[k])
  const arquivos = [...new Set(chaves.flatMap((k) => m[k]).filter((f) => f.endsWith('.js')))]
  let bruto = 0, gz = 0
  for (const f of arquivos) { const p = join('.next', f); if (!existsSync(p)) continue; const b = readFileSync(p); bruto += b.length; gz += gzipSync(b).length }
  console.log(`${r}: ${arquivos.length} arquivos, ${(bruto / 1024).toFixed(1)} KB (${(gz / 1024).toFixed(1)} KB gzip)`)
}
