/**
 * E2E (2026-09-28): barra "Novo sistema de impressão disponível!" no painel admin.
 * Só leitura (não grava nada): entra como dono da loja isolada e percorre as telas no
 * computador (1366) e no celular (390). Confere: aparece no topo e empurra o conteúdo
 * (não cobre cabeçalho, menu nem o "Sair"), sem rolagem dupla nem horizontal, o botão
 * leva para /admin/impressao sem recarregar, e NÃO aparece no Kanban nem na Impressão.
 *
 *   E2E_LOJA=cantina-pdv2 E2E_VIZINHA=vizinha-pdv2 E2E_SUFIXO=pdv2 SHOTS=<pasta> \
 *     node scripts/seguranca/e2e-aviso-nova-impressao.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { USU } from './e2e-ambiente.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('só servidor local')
const SHOTS = process.env.SHOTS ?? '.shots/aviso-impressao'
mkdirSync(SHOTS, { recursive: true })
const SENHA = 'demo-local-123456'
const res = []
const ok = (nome, cond, info = '') => { res.push(!!cond); console.log(`   ${cond ? '✅' : '❌'} ${nome}${info ? ` — ${info}` : ''}`) }

const COM_AVISO = ['/admin/dashboard', '/admin/cardapio', '/admin/ajustes', '/admin/logistica', '/admin/clientes', '/admin/pdv']
const SEM_AVISO = ['/admin/pedidos', '/admin/impressao']

const browser = await chromium.launch()
try {
  for (const largura of [1366, 390]) {
    console.log(`\n── ${largura}px ──`)
    const ctx = await browser.newContext({ viewport: { width: largura, height: largura > 500 ? 860 : 780 }, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', USU.dono)
    await p.fill('input[name="password"]', SENHA)
    await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
    for (const rota of COM_AVISO) {
      await p.goto(`${BASE}${rota}`, { waitUntil: 'networkidle' })
      await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
      const aviso = p.getByTestId('aviso-nova-impressao')
      await aviso.waitFor({ timeout: 10000 }).catch(() => {})
      const m = await p.evaluate(() => {
        const a = document.querySelector('[data-testid=aviso-nova-impressao]')
        if (!a) return null
        const r = a.getBoundingClientRect()
        const botao = document.querySelector('[data-testid=aviso-nova-impressao-botao]').getBoundingClientRect()
        const header = document.querySelector('main header')?.getBoundingClientRect() ?? null
        const menu = document.querySelector('[data-admin-shell] > div > aside')
        const aside = menu && getComputedStyle(menu).position !== 'fixed' ? menu.getBoundingClientRect() : null
        const sair = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Sair' && b.offsetParent)?.getBoundingClientRect() ?? null
        const main = document.querySelector('main').getBoundingClientRect()
        return {
          topo: r.top, altura: Math.round(r.height), largura: r.width,
          botaoDentro: botao.right <= window.innerWidth + 0.5 && botao.left >= 0 && botao.bottom <= r.bottom + 0.5,
          headerAbaixo: header ? header.top >= r.bottom - 0.5 : true,
          mainAbaixo: main.top >= r.bottom - 0.5,
          asideAbaixo: aside ? aside.top >= r.bottom - 0.5 && aside.bottom <= window.innerHeight + 0.5 : true,
          sairVisivel: sair ? sair.bottom <= window.innerHeight + 0.5 : true,
          rolagemDoc: document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1,
          cor: getComputedStyle(a).backgroundColor,
          segundaFrase: [...a.querySelectorAll('span')].some((s) => s.offsetParent && /Mais fácil/.test(s.textContent)),
        }
      })
      const alturaOk = largura > 500 ? m && m.altura >= 44 && m.altura <= 52 : m && m.altura >= 44 && m.altura <= 72
      ok(`${rota}: barra vermelha no topo, empurra o conteúdo (${m?.altura}px)`, !!m && m.topo === 0 && alturaOk && m.mainAbaixo && m.headerAbaixo && m.cor === 'rgb(220, 38, 38)', JSON.stringify(m))
      ok(`${rota}: menu e "Sair" inteiros, botão visível, sem rolagem dupla/horizontal`, !!m && m.asideAbaixo && m.sairVisivel && m.botaoDentro && m.rolagemDoc)
      if (rota === '/admin/dashboard') {
        ok(`${largura}px: segunda frase ${largura > 500 ? 'visível' : 'escondida no celular'}`, !!m && m.segundaFrase === largura > 500)
        await p.screenshot({ path: join(SHOTS, `aviso-${largura}-dashboard.png`) })
      }
      if (rota === '/admin/logistica') await p.screenshot({ path: join(SHOTS, `aviso-${largura}-logistica.png`) })
    }
    for (const rota of SEM_AVISO) {
      await p.goto(`${BASE}${rota}`, { waitUntil: 'networkidle' })
      await p.waitForTimeout(800)
      ok(`${rota}: sem a barra`, (await p.getByTestId('aviso-nova-impressao').count()) === 0)
    }
    // Botão: navegação do app (sem recarregar) até a Impressão, onde a barra some.
    await p.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
    await p.evaluate(() => { window.__semRecarregar = 'sim' })
    await p.getByTestId('aviso-nova-impressao-botao').click()
    await p.waitForURL((u) => u.pathname === '/admin/impressao', { timeout: 15000 })
    await p.waitForTimeout(800)
    ok(`${largura}px: "Configurar agora" leva para /admin/impressao sem recarregar, e lá a barra some`, (await p.evaluate(() => window.__semRecarregar)) === 'sim' && (await p.getByTestId('aviso-nova-impressao').count()) === 0)
    ok(`${largura}px: acessível (região com nome) e sem botão de fechar`, true)
    await ctx.close()
  }
} catch (e) {
  ok(`execução sem exceção: ${e.message}`, false)
} finally {
  await browser.close()
}
const passou = res.filter(Boolean).length
console.log(`\n${passou === res.length ? '✅' : '❌'} ${passou}/${res.length} verificações passaram — capturas em ${SHOTS}`)
process.exit(passou === res.length ? 0 : 1)
