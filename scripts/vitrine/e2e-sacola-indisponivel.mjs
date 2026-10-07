/**
 * E2E — sacola guardada com item indisponível (noite 5). Stack LOCAL. Vitrine nova (p8-longa) e
 * clássica (ordem-qr-e2e). A sacola é posta no aparelho (localStorage, como a vitrine guarda) e o
 * item é pausado / tem o preço mudado no banco, como acontece de verdade.
 *   · sacola: linha apagada com "Indisponível no momento" + "Remover"; Continuar bloqueado com o
 *     motivo; o resto da sacola fica;
 *   · preço mudou: avisa e atualiza;
 *   · ficou indisponível na revisão: "Remover item e continuar" e o pedido sai com o resto;
 *   · agendado: a conferência usa o dia agendado (API).
 * Devolve preços/status e apaga os pedidos que cria.
 *
 *   node scripts/vitrine/e2e-sacola-indisponivel.mjs [prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? '.shots/sacola-indisponivel'
mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const todos = async (s, p = []) => (await db.query(s, p)).rows
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const TEL = '27999883301'

const lojas = [
  { slug: 'p8-longa', nova: true },
  { slug: 'ordem-qr-e2e', nova: false },
]
const restaurar = []
const criados = []

/** Itens simples (sem tamanho, sem opção obrigatória, sem pizza), disponíveis todo dia. */
async function itensSimples(lojaId, n) {
  return todos(`select i.id, i.nome, i.preco::float preco, i.status, i.promocao_preco from itens_cardapio i
    where i.restaurante_id=$1 and i.status='disponivel' and (i.tipo_item is null or i.tipo_item::text <> 'pizza') and coalesce(i.preco,0) > 0
      and i.promocao_preco is null
      and not exists (select 1 from tamanhos_item t where t.item_id=i.id)
      and not exists (select 1 from grupos_item_complementos g where g.item_id=i.id and g.obrigatorio)
      and (i.dias_disponiveis is null or cardinality(i.dias_disponiveis)=0 or cardinality(i.dias_disponiveis)=7)
    order by i.nome limit $2`, [lojaId, n])
}
const linha = (it) => ({ key: `k-${it.id}`, itemId: it.id, name: it.nome, imagemUrl: null, qty: 1, unit: it.preco, addons: [], obs: '', tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '' })

const browser = await chromium.launch()
async function abrir(slug, cart, largura = 390) {
  const ctx = largura < 700
    ? await browser.newContext({ ...devices['iPhone 13'], viewport: { width: largura, height: 844 }, locale: 'pt-BR' })
    : await browser.newContext({ viewport: { width: largura, height: 900 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.addInitScript(() => { window.__vistos = []; const re = new RegExp("O preço de .*mudou para.*|Alguns preços da sacola mudaram.*"); new MutationObserver(() => { const m = (document.body?.innerText ?? "").match(re); if (m && !window.__vistos.includes(m[0])) window.__vistos.push(m[0]) }).observe(document, { subtree: true, childList: true, characterData: true }) })
  await p.goto(`${BASE}/loja/${slug}`, { waitUntil: 'networkidle' })
  await p.evaluate(([s, c]) => { localStorage.clear(); localStorage.setItem(`menuzia_carrinho_${s}`, JSON.stringify({ em: Date.now(), linhas: c })) }, [slug, cart])
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  for (const alvo of [p.getByText('Continuar no cardápio'), p.getByText('Agora não')]) {
    if (await alvo.first().isVisible().catch(() => false)) { await alvo.first().click().catch(() => {}); await p.waitForTimeout(300) }
  }
  return { ctx, p }
}
async function irSacola(p) {
  const bs = [p.getByRole('button', { name: 'Ver sacola' }), p.locator('[data-testid="nav-botoes"] button', { hasText: 'Sacola' }), p.getByRole('button', { name: /Sacola|Carrinho/ })]
  for (const b of bs) { const n = await b.count(); for (let i = 0; i < n; i++) if (await b.nth(i).isVisible()) { await b.nth(i).click(); await p.waitForTimeout(1200); return } }
}

try {
  for (const L of lojas) {
    const loja = await um(`select id, vitrine_nova vn, aceita_retirada ar, status_loja sl from restaurantes where slug=$1`, [L.slug])
    restaurar.push(async () => db.query(`update restaurantes set vitrine_nova=$2, aceita_retirada=$3, status_loja=$4 where id=$1`, [loja.id, loja.vn, loja.ar, loja.sl]))
    await db.query(`update restaurantes set vitrine_nova=$2, aceita_retirada=true, status_loja='aberto_manual' where id=$1`, [loja.id, L.nova])
    const [a, b, c] = await itensSimples(loja.id, 3)
    if (!c) { ok(`${L.slug}: 3 itens simples para o teste`, false); continue }
    for (const it of [a, b, c]) restaurar.push(async () => db.query(`update itens_cardapio set status=$2, preco=$3 where id=$1`, [it.id, it.status, it.preco]))
    const rot = L.nova ? 'nova' : 'clássica'

    secao(`${rot}: item pausado na sacola guardada`)
    await db.query(`update itens_cardapio set status='pausado' where id=$1`, [b.id])
    {
      const { ctx, p } = await abrir(L.slug, [linha(a), linha(b)])
      await irSacola(p)
      const ind = p.locator('[data-indisponivel="sim"]')
      await ind.first().waitFor({ timeout: 8000 }).catch(() => {})
      ok(`${rot}: linha pausada aparece com o aviso`, (await ind.count()) >= 1 && /Indisponível no momento/.test(await ind.first().innerText()))
      ok(`${rot}: o outro item continua normal`, (await p.locator('[data-linha-sacola]:not([data-indisponivel])').count()) >= 1)
      const cont = p.getByRole('button', { name: /^(Continuar|Continuar para pagamento|Remova o item indisponível)/ })
      let visiveis = 0, habilitados = 0
      for (let i = 0; i < await cont.count(); i++) if (await cont.nth(i).isVisible() && !/comprando|no cardápio/i.test(await cont.nth(i).innerText())) { visiveis++; if (await cont.nth(i).isEnabled()) habilitados++ }
      ok(`${rot}: "Continuar" bloqueado`, visiveis > 0 && habilitados === 0, `${visiveis} visíveis, ${habilitados} habilitados`)
      const visivel = async (loc) => { for (let i = 0; i < await loc.count(); i++) if (await loc.nth(i).isVisible()) return true; return false }
      ok(`${rot}: motivo do bloqueio em linguagem simples`, L.nova ? await visivel(p.getByTestId('bloqueio-sacola')) : await visivel(p.getByText('Remova o item indisponível')))
      await p.screenshot({ path: join(PRINTS, `${L.slug}-indisponivel-390.png`) })
      { const rm = p.getByTestId('remover-indisponivel'); for (let i = 0; i < await rm.count(); i++) if (await rm.nth(i).isVisible()) { await rm.nth(i).click(); break } }
      await p.waitForTimeout(1500)
      ok(`${rot}: "Remover" tira só o item indisponível`, (await p.locator('[data-indisponivel="sim"]').count()) === 0 && (await p.locator('[data-linha-sacola]').count()) >= 1)
      const guardada = await p.evaluate((s) => JSON.parse(localStorage.getItem(`menuzia_carrinho_${s}`) ?? '{}').linhas?.map((l) => l.itemId), L.slug)
      ok(`${rot}: sacola guardada fica só com o item bom`, JSON.stringify(guardada) === JSON.stringify([a.id]), JSON.stringify(guardada))
      await ctx.close()
    }
    await db.query(`update itens_cardapio set status='disponivel' where id=$1`, [b.id])

    secao(`${rot}: preço mudou`)
    await db.query(`update itens_cardapio set preco=$2 where id=$1`, [a.id, a.preco + 2])
    {
      const { ctx, p } = await abrir(L.slug, [linha(a)])
      await irSacola(p)
      await p.waitForTimeout(1500)
      const guardada = await p.evaluate((s) => JSON.parse(localStorage.getItem(`menuzia_carrinho_${s}`) ?? '{}').linhas?.[0]?.unit, L.slug)
      ok(`${rot}: preço atualizado na sacola`, Math.abs(guardada - (a.preco + 2)) < 0.001, String(guardada))
      const vistos = await p.evaluate(() => window.__vistos)
      ok(`${rot}: aviso de preço novo`, vistos.length > 0, JSON.stringify(vistos))
      await ctx.close()
    }
    await db.query(`update itens_cardapio set preco=$2 where id=$1`, [a.id, a.preco])

    secao(`${rot}: ficou indisponível na revisão`)
    {
      const { ctx, p } = await abrir(L.slug, [linha(a), linha(c)])
      await irSacola(p)
      const clicarVisivel = async (loc) => { for (let i = (await loc.count()) - 1; i >= 0; i--) if (await loc.nth(i).isVisible() && await loc.nth(i).isEnabled()) { await loc.nth(i).click(); return true } return false }
      const entrar = async () => {
        const tel = p.locator('div').filter({ has: p.getByText('Informe seu telefone') }).last().getByPlaceholder('(00) 00000-0000')
        if (await tel.isVisible().catch(() => false)) {
          await tel.fill(TEL)
          await p.locator('div').filter({ has: p.getByText('Informe seu telefone') }).last().getByRole('button', { name: /^Continuar$/i }).click()
          await p.waitForTimeout(1500)
        }
      }
      if (L.nova) {
        await p.locator('[data-testid="barra-sacola-continuar"] button').last().click()
        await p.waitForTimeout(900); await entrar()
        await p.getByTestId('opcao-retirada').click().catch(() => {})
        await p.waitForTimeout(500)
        const nome = p.getByPlaceholder('Seu nome'); if (await nome.isVisible().catch(() => false)) await nome.fill('TESTE Sacola')
        await clicarVisivel(p.locator('[data-barra-checkout] button').filter({ hasText: /^Continuar$/ }))
        await p.waitForTimeout(900)
        await p.getByTestId('pagamento-cartao').click().catch(() => {})
        await clicarVisivel(p.locator('[data-barra-checkout] button').filter({ hasText: /Revisar pedido/ }))
        await p.waitForTimeout(900)
      } else {
        await clicarVisivel(p.getByRole('button', { name: /^Retirada/ }))
        await clicarVisivel(p.getByRole('button', { name: /Continuar para pagamento/ }))
        await p.waitForTimeout(900); await entrar()
        await p.getByText(/^Cartão na retirada$/).first().click().catch(() => {})
        await clicarVisivel(p.getByRole('button', { name: /^(Continuar|Ir para endereço)/ }))
        await p.waitForTimeout(700)
        const nome = p.getByPlaceholder('Seu nome'); if (await nome.isVisible().catch(() => false)) await nome.fill('TESTE Sacola')
        await clicarVisivel(p.getByRole('button', { name: /Revisar pedido/ }))
        await p.waitForTimeout(900)
      }
      await db.query(`update itens_cardapio set status='pausado' where id=$1`, [c.id])
      const fazer = p.getByRole('button', { name: /Fazer pedido/ }).last()
      await fazer.click().catch(() => {})
      await p.getByTestId('remover-e-continuar').waitFor({ timeout: 10000 }).catch(() => {})
      ok(`${rot}: revisão mostra o item que ficou indisponível e "Remover item e continuar"`, await p.getByTestId('remover-e-continuar').isVisible())
      await p.screenshot({ path: join(PRINTS, `${L.slug}-revisao-390.png`) })
      await p.getByTestId('remover-e-continuar').click().catch(() => {})
      await p.waitForTimeout(800)
      await p.getByRole('button', { name: /Fazer pedido/ }).last().click().catch(() => {})
      await p.waitForTimeout(3000)
      const ped = await um(`select id, status from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2 and criado_em > now() - interval '2 minutes' order by criado_em desc limit 1`, [loja.id, TEL])
      if (ped) criados.push(ped.id)
      const itensPed = ped ? (await todos(`select item_id from pedido_itens where pedido_id=$1`, [ped.id])).map((r) => r.item_id) : []
      ok(`${rot}: pedido sai só com o item disponível`, !!ped && JSON.stringify(itensPed) === JSON.stringify([a.id]), JSON.stringify({ ped, itensPed }))
      await ctx.close()
    }
    await db.query(`update itens_cardapio set status='disponivel' where id=$1`, [c.id])
  }

  secao('agendado: confere para o dia agendado (API)')
  {
    const loja = await um(`select id from restaurantes where slug='p8-longa'`)
    const [it] = await itensSimples(loja.id, 1)
    const amanha = new Date(Date.now() + 26 * 3600_000)
    const diaAmanha = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(amanha)
    const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(diaAmanha)
    const outros = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== idx)
    const antes = await um(`select dias_disponiveis from itens_cardapio where id=$1`, [it.id])
    await db.query(`update itens_cardapio set dias_disponiveis=$2 where id=$1`, [it.id, outros])
    const corpo = (agendadoPara) => JSON.stringify({ agendadoPara, itens: [{ chave: 'x', itemId: it.id, complementos: [], precoUnitario: it.preco }] })
    const r1 = await fetch(`${BASE}/api/loja/p8-longa/sacola/conferir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo(amanha.toISOString()) }).then((r) => r.json())
    const r2 = await fetch(`${BASE}/api/loja/p8-longa/sacola/conferir`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo(undefined) }).then((r) => r.json())
    await db.query(`update itens_cardapio set dias_disponiveis=$2 where id=$1`, [it.id, antes.dias_disponiveis])
    ok('item fora do dia agendado: indisponível com "Não é vendido no dia agendado."', r1.linhas?.[0]?.ok === false && r1.linhas[0].motivo === 'Não é vendido no dia agendado.', JSON.stringify(r1))
    ok('o mesmo item sem agendamento (hoje): disponível', r2.linhas?.[0]?.ok === true, JSON.stringify(r2))
  }
} catch (e) {
  ok('execução sem exceção', false, String(e?.message ?? e).slice(0, 400))
} finally {
  await browser.close()
  if (criados.length) { await db.query(`delete from pedido_itens where pedido_id = any($1)`, [criados]).catch(() => {}); await db.query(`delete from pedidos where id = any($1)`, [criados]).catch((e) => console.log('   (limpeza)', e.message)) }
  for (const f of restaurar.reverse()) await f().catch(() => {})
  await db.end()
}
const passou = res.filter(Boolean).length
console.log(`\n${passou === res.length ? '✅' : '❌'} ${passou}/${res.length} verificações passaram`)
process.exit(passou === res.length ? 0 : 1)
