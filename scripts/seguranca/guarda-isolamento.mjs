// GUARDA DE ISOLAMENTO ENTRE LOJAS (10/10/2026): roda no `npm run build` (prebuild) e no vitest.
// Toda rota de app/api/admin tira a loja da SESSÃO (middleware + helpers). É proibido escolher a loja pelo que vem na
// requisição: corpo, query string ou cabeçalho com restauranteId/restaurante_id. A prova completa (banco + rotas com
// dados reais de duas lojas) é scripts/seguranca/isolamento-todas-rotas.mjs (local).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROIBIDOS = [
  /searchParams\.get\(\s*['"]restaurante(_id|Id)?['"]/,
  /\b(corpo|body|dados|json|input|payload|entrada)\??\.restaurante(_id|Id)\b/,
  /headers\.get\(\s*['"]x-restaurante/i,
  /\{\s*[^}]*\brestaurante(_id|Id)\b[^}]*\}\s*=\s*(await\s+)?(req|request)\.json\(\)/,
]

function rotas(base, dir = 'app/api/admin') {
  const p = join(base, dir)
  let st; try { st = statSync(p) } catch { return [] }
  if (st.isFile()) return p.endsWith('route.ts') ? [relative(base, p).split(sep).join('/')] : []
  return readdirSync(p).flatMap((n) => rotas(base, join(dir, n)))
}

/** Lista de problemas (vazia = ok). */
export function verificarIsolamento(base) {
  const problemas = []
  for (const arq of rotas(base)) {
    const src = readFileSync(join(base, arq), 'utf8')
    for (const re of PROIBIDOS) if (re.test(src)) problemas.push(`${arq}: escolhe a loja pela requisição (${re.source})`)
  }
  return problemas
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const p = verificarIsolamento(process.cwd())
  if (p.length) {
    console.error('❌ Isolamento entre lojas: rota escolhendo a loja pela requisição:\n' + p.map((x) => `   - ${x}`).join('\n'))
    process.exit(1)
  }
  console.log('✅ Isolamento: nenhuma rota do painel escolhe a loja pela requisição.')
}
