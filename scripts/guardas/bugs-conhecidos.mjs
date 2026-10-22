// Guarda dos BUGS CONHECIDOS (docs/BUGS-CONHECIDOS.md): roda no `npm run build` (prebuild) e no vitest
// (lib/guardas/bugs-conhecidos.test.ts). Se falhar, o build falha e o deploy NÃO sobe — a versão antiga fica no ar.
//  B1  regex com a barra perdida: /^d{1,3}$/ em vez de /^\d{1,3}$/ (alarme do Assistente, robô, Dashboard — 22/10).
//  B2  o mesmo trabalho agendado em dois crons (push rodava no de campanhas E no próprio, 2× por minuto, 22/10).
//  B3  política RLS nova chamando auth_restaurante_id()/auth_papel()/auth_e_gestor() sem (select …) — roda 1 vez
//      POR LINHA (0218 corrigiu as antigas: pedidos 23,5 → 1,6 ms).
//  B4  caractere de controle invisível no código (um \b virou backspace no filtro de "pedido teste", 22/10).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZES = ['app', 'lib', 'components', 'middleware.ts', 'scripts/guardas']
const EXT = /\.(ts|tsx|js|jsx|mjs)$/
const PULAR = /(^|\/)(node_modules|\.next|dist|out)(\/|$)|\.test\.|\.spec\./

function arquivos(raiz, base) {
  const p = join(base, raiz)
  let st; try { st = statSync(p) } catch { return [] }
  if (st.isFile()) return EXT.test(p) ? [p] : []
  return readdirSync(p).flatMap((n) => { const rel = relative(base, join(p, n)).split(sep).join('/'); return PULAR.test(rel) ? [] : arquivos(rel, base) })
}
const rel = (base, p) => relative(base, p).split(sep).join('/')
const linhasDe = (f) => readFileSync(f, 'utf8').split(/\r?\n/)

// B1 — classe \d \s \w sem a barra logo no começo da regex: /^d{…}, /^d+, /^s*…
const B1 = /\/\^[dws][{+*]/
export function verificarB1(base) {
  const erros = []
  for (const f of RAIZES.flatMap((r) => arquivos(r, base))) {
    if (rel(base, f) === 'scripts/guardas/bugs-conhecidos.mjs') continue
    linhasDe(f).forEach((linha, i) => {
      if (B1.test(linha)) erros.push(`${rel(base, f)}:${i + 1} B1 regex com a barra perdida? (\\d, \\s, \\w) — ${linha.trim().slice(0, 90)}`)
    })
  }
  return erros
}

// B2 — função de trabalho importada por mais de uma rota de cron. Ajudantes (listas, relógio) são permitidos.
const AJUDANTES = new Set(['lojasComFinanceiro', 'lojaEstaAberta', 'provedorAtual'])
export function verificarB2(base) {
  const pasta = join(base, 'app/api/cron')
  let rotas = []
  try { rotas = readdirSync(pasta).map((d) => join(pasta, d, 'route.ts')).filter((f) => { try { return statSync(f).isFile() } catch { return false } }) } catch { return [] }
  const usos = new Map()
  for (const f of rotas) {
    for (const m of readFileSync(f, 'utf8').matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/(?!supabase\/|auditoria)[^'"]+['"]/g)) {
      for (const nome of m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean)) {
        if (AJUDANTES.has(nome) || /^[A-Z]/.test(nome)) continue
        usos.set(nome, [...(usos.get(nome) ?? []), rel(base, f)])
      }
    }
  }
  return [...usos].filter(([, l]) => l.length > 1).map(([nome, l]) => `B2 "${nome}" roda em ${l.length} crons (${l.join(', ')}) — o mesmo trabalho 2× por minuto`)
}

// B3 — migrations NOVAS (depois da 0218) com política chamando a função de sessão sem (select …).
const FUNCOES = /(?<!select\s{1,5}(public\.)?)\b(public\.)?(auth_restaurante_id|auth_papel|auth_e_gestor)\(\)/i
export function verificarB3(base, aPartirDe = 219) {
  const pasta = join(base, 'supabase/migrations')
  let lista = []
  try { lista = readdirSync(pasta).filter((n) => /^\d{4}_.*\.sql$/.test(n) && Number(n.slice(0, 4)) >= aPartirDe) } catch { return [] }
  const erros = []
  for (const n of lista) {
    const sql = readFileSync(join(pasta, n), 'utf8').replace(/--.*$/gm, '')
    for (const m of sql.matchAll(/\b(create|alter)\s+policy\b[\s\S]*?;/gi)) {
      if (FUNCOES.test(m[0])) erros.push(`supabase/migrations/${n} B3 política com auth_*() sem (select …): roda por linha — use (select public.auth_restaurante_id())`)
    }
  }
  return erros
}

// B4 — barra "comida" por script: \b vira backspace (0x08), \f vira form feed… Invisível no editor.
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/
export function verificarB4(base) {
  const erros = []
  for (const f of RAIZES.flatMap((r) => arquivos(r, base))) {
    linhasDe(f).forEach((linha, i) => {
      if (CONTROLE.test(linha)) erros.push(`${rel(base, f)}:${i + 1} B4 caractere de controle invisível (barra perdida?) — ${JSON.stringify(linha.trim().slice(0, 80))}`)
    })
  }
  return erros
}

export function verificarBugsConhecidos(base) {
  return [...verificarB1(base), ...verificarB2(base), ...verificarB3(base), ...verificarB4(base)]
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const erros = verificarBugsConhecidos(process.cwd())
  if (erros.length) {
    console.error(`\n✖ Bugs conhecidos voltaram (docs/BUGS-CONHECIDOS.md):\n  ${erros.join('\n  ')}\n`)
    process.exit(1)
  }
  console.log('✓ bugs conhecidos: nenhum voltou (B1 regex, B2 cron duplicado, B3 RLS por linha, B4 caractere invisível)')
}
