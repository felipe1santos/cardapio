// REGRA Nº 1 automática (docs/REGRAS-DE-CUSTO.md): roda no `npm run build` (prebuild) e no vitest.
//  (a) nenhum arquivo fora de lib/custo/ e lib/geocode/ chama API paga direto (Google Maps web services, objetos
//      pagos do Maps JS, OpenAI, Gemini, Anthropic...). Exceção nomeada: o carregador do mapa no navegador.
//  (b) nenhuma chave de servidor vira NEXT_PUBLIC (nome NEXT_PUBLIC_*SERVER*/SECRET/... nem mapeada no next.config).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PAGAS = [
  /maps\.googleapis\.com/, /places\.googleapis\.com/, /routes\.googleapis\.com/, /addressvalidation\.googleapis\.com/,
  /generativelanguage\.googleapis\.com/, /aiplatform\.googleapis\.com/, /api\.openai\.com/, /api\.anthropic\.com/,
  /\bnew\s+google\.maps\.(Geocoder|DirectionsService|DistanceMatrixService|ElevationService)\b/,
  /\bgoogle\.maps\.places\b/, /\b(PlacesService|AutocompleteService|DistanceMatrixService)\b/,
  /\bnew\s+(OpenAI|Anthropic|GoogleGenerativeAI)\s*\(/, /from\s+['"](openai|@anthropic-ai\/sdk|@google\/generative-ai|@google\/genai)['"]/,
]
const PASTAS_LIVRES = ['lib/custo/', 'lib/geocode/']
// Única exceção: o script do Maps JavaScript (desenhar o mapa no navegador; contado em /api/mapa/carregou).
const EXCECOES = { 'lib/maps/loader.ts': [/maps\.googleapis\.com\/maps\/api\/js\?/] }
const RAIZES = ['app', 'lib', 'components', 'middleware.ts', 'instrumentation.ts', 'printer-agent/src']
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const PULAR = /(^|\/)(node_modules|\.next|dist|out)(\/|$)|\.test\.|\.spec\./

// Tira comentários (o "//" de URL fica: vem depois de ':' ou dentro de string).
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')

function arquivos(raiz, base) {
  const p = join(base, raiz)
  let st; try { st = statSync(p) } catch { return [] }
  if (st.isFile()) return EXT.test(p) ? [p] : []
  return readdirSync(p).flatMap((n) => { const rel = relative(base, join(p, n)).split(sep).join('/'); return PULAR.test(rel) ? [] : arquivos(rel, base) })
}

export function verificarRegra1(base) {
  const erros = []
  for (const f of RAIZES.flatMap((r) => arquivos(r, base))) {
    const rel = relative(base, f).split(sep).join('/')
    const texto = semComentarios(readFileSync(f, 'utf8'))
    // (b) nome de variável pública com cara de segredo, em qualquer arquivo
    for (const m of texto.matchAll(/NEXT_PUBLIC_[A-Z0-9_]*(SERVER|SECRET|SERVICE_ROLE|PRIVATE|OPENAI|PASSWORD|SENHA)[A-Z0-9_]*/g)) erros.push(`${rel}: chave de servidor como NEXT_PUBLIC (${m[0]})`)
    if (PASTAS_LIVRES.some((d) => rel.startsWith(d))) continue
    const linhas = texto.split('\n')
    linhas.forEach((linha, i) => {
      for (const re of PAGAS) {
        if (!re.test(linha)) continue
        if ((EXCECOES[rel] ?? []).some((ok) => ok.test(linha))) continue
        erros.push(`${rel}:${i + 1}: API paga chamada fora de lib/custo|lib/geocode (${re.source}) — passe por chamarApiPaga()`)
      }
    })
  }
  // (b) next.config: o bloco env só pode expor variáveis de navegador.
  let cfg = ''; try { cfg = semComentarios(readFileSync(join(base, 'next.config.ts'), 'utf8')) } catch { /* sem next.config */ }
  const env = cfg.match(/\benv\s*:\s*\{([\s\S]*?)\}/)?.[1] ?? ''
  for (const m of env.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    if (/SERVER|SECRET|SERVICE_ROLE|PRIVATE|OPENAI|TOKEN|PASSWORD|SENHA|_API_KEY$/.test(m[1]) && m[1] !== 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY') erros.push(`next.config.ts: ${m[1]} exposta ao navegador pelo bloco env`)
  }
  for (const m of env.matchAll(/\b([A-Z0-9_]+)\s*:/g)) if (!m[1].startsWith('NEXT_PUBLIC_')) erros.push(`next.config.ts: env.${m[1]} vai para o navegador sem o prefixo NEXT_PUBLIC_`)
  return erros
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const erros = verificarRegra1(process.cwd())
  if (erros.length) { console.error('🛑 REGRA Nº 1 (docs/REGRAS-DE-CUSTO.md) violada:\n' + erros.map((e) => '  - ' + e).join('\n')); process.exit(1) }
  console.log('✅ Regra nº 1: nenhuma API paga fora da guarda e nenhuma chave de servidor pública.')
}
