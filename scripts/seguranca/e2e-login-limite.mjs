/**
 * E2E — limite de tentativas de login (B16). Servidor local em 127.0.0.1:3999.
 * Usa um usuário que não existe: 10 senhas erradas travam o 11º (mesmo com "senha certa"
 * não haveria como entrar, mas a mensagem muda para "Muitas tentativas"). Outro usuário
 * do mesmo IP continua podendo tentar (o IP só trava com 30).
 *
 *   node scripts/seguranca/e2e-login-limite.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE)) { console.error('Só servidor local.'); process.exit(2) }
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const b = await chromium.launch()
const p = await b.newPage()
const tentar = async (login) => {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', 'senha-errada-qa')
  await Promise.all([p.waitForURL(/error=/, { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  return decodeURIComponent(new URL(p.url()).searchParams.get('error') ?? '')
}
try {
  const alvo = `qa-limite-${Date.now()}`
  let ultimas = []
  for (let i = 0; i < 10; i++) ultimas.push(await tentar(alvo))
  ok('10 primeiras: "Usuário ou senha inválidos."', ultimas.every((m) => /inválidos/.test(m)), ultimas.at(-1))
  ok('11ª no mesmo usuário: "Muitas tentativas"', /Muitas tentativas/.test(await tentar(alvo)))
  ok('outro usuário do mesmo IP ainda tenta normalmente', /inválidos/.test(await tentar(`qa-outro-${Date.now()}`)))
} catch (e) { console.error(e); res.push(false) } finally { await b.close() }
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
