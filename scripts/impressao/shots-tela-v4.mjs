/**
 * Prints da tela de Impressão (servidor e banco LOCAIS) lado a lado com o protótipo aprovado.
 * Prepara a cantina-demo como uma loja no Assistente novo (computador conectado no beta.7, duas
 * impressoras: Cozinha e Caixa) e, depois, como uma loja no antigo; devolve o estado no fim.
 *
 *   node scripts/impressao/shots-tela-v4.mjs
 *
 * Saída: docs/impressao-tela-nova/v4/<modo>-<largura>.png, modal-<…>.png e lado-a-lado-*.png.
 */
import { mkdirSync, existsSync } from 'node:fs'
import pg from 'pg'
import sharp from 'sharp'
import { chromium } from 'playwright'
import { USU } from '../seguranca/e2e-ambiente.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE) || !/@(127\.0\.0\.1|localhost):/.test(DB)) throw new Error('só local')
const SAIDA = 'docs/impressao-tela-nova/v4'
const PROTO = 'docs/impressao-tela-nova/prototipo'
mkdirSync(SAIDA, { recursive: true })

export async function prepararBeta(db, L, nome = 'E2E Tela v4', versao = '0.2.0-beta.7') {
  const ag = (await db.query("insert into impressao_agentes (restaurante_id, nome, versao, credencial_hash, visto_em) values ($1, $2, $3, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), now()) returning id", [L, nome, versao])).rows[0]
  const d1 = (await db.query("insert into impressao_dispositivos (restaurante_id, agente_id, nome_sistema, apelido, largura_mm, disponivel, visto_em, envio, ultimo_uso_em, calibrado_em) values ($1, $2, 'POS-80', 'POS-80 Cozinha', 80, true, now(), 'raw_fila', now() - interval '20 minutes', now() - interval '32 days') returning id", [L, ag.id])).rows[0]
  const d2 = (await db.query("insert into impressao_dispositivos (restaurante_id, agente_id, nome_sistema, apelido, largura_mm, disponivel, visto_em, envio, rede_ip, calibrado_em) values ($1, $2, 'ELGIN i9', 'Elgin i9 Balcão', 80, true, now(), 'raw_rede', '192.168.0.120', now() - interval '3 days') returning id", [L, ag.id])).rows[0]
  await db.query('delete from impressao_funcoes where restaurante_id = $1', [L])
  await db.query("insert into impressao_funcoes (restaurante_id, funcao, dispositivo_id) values ($1, 'cozinha', $2), ($1, 'caixa', $3)", [L, d1.id, d2.id])
  await db.query("update restaurantes set impressao_beta_modo = 'cozinha_caixa', impressao_cozinha_por_funcao = true, impressao_beta_liberado = true where id = $1", [L])
  return { ag: ag.id, d1: d1.id, d2: d2.id }
}

async function main() {
  const db = new pg.Client(DB)
  await db.connect()
  const L = (await db.query("select id from restaurantes where slug = 'cantina-demo'")).rows[0].id
  const antes = (await db.query('select impressao_beta_modo, impressao_beta_liberado, impressao_cozinha_por_funcao from restaurantes where id = $1', [L])).rows[0]
  const funcoesAntes = (await db.query('select funcao, dispositivo_id from impressao_funcoes where restaurante_id = $1', [L])).rows
  const NOME = 'E2E Tela v4'
  const limpar = async () => {
    await db.query('delete from impressao_funcoes where restaurante_id = $1', [L])
    for (const f of funcoesAntes) await db.query('insert into impressao_funcoes (restaurante_id, funcao, dispositivo_id) values ($1, $2, $3)', [L, f.funcao, f.dispositivo_id])
    await db.query('delete from impressao_dispositivos where agente_id in (select id from impressao_agentes where restaurante_id = $1 and nome = $2)', [L, NOME])
    await db.query('delete from impressao_agentes where restaurante_id = $1 and nome = $2', [L, NOME])
    await db.query('update restaurantes set impressao_beta_modo = $2, impressao_beta_liberado = $3, impressao_cozinha_por_funcao = $4 where id = $1', [L, antes.impressao_beta_modo, antes.impressao_beta_liberado, antes.impressao_cozinha_por_funcao])
  }
  await limpar()
  const browser = await chromium.launch()
  try {
    const { ag } = await prepararBeta(db, L, NOME)
    const sinal = setInterval(() => db.query('update impressao_agentes set visto_em = now() where id = $1', [ag]).catch(() => {}), 3000)
    for (const modo of ['beta', 'antigo']) {
      if (modo === 'antigo') await db.query("update restaurantes set impressao_beta_modo = 'teste', impressao_cozinha_por_funcao = false where id = $1", [L])
      for (const [w, h] of [[1366, 900], [390, 844]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR' })
        const p = await ctx.newPage()
        await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
        await p.fill('input[name="email"]', USU.dono)
        await p.fill('input[name="password"]', 'demo-local-123456')
        await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
        await p.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
        await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
        await p.getByTestId('passo-1').waitFor({ timeout: 20000 })
        await p.waitForTimeout(1200)
        // O conteúdo rola dentro do contêiner: estica para o print pegar a página inteira.
        const altura = await p.evaluate(() => document.querySelector('[data-testid="impressao-rolagem"]').scrollHeight + 60)
        await p.setViewportSize({ width: w, height: altura })
        await p.waitForTimeout(500)
        await p.screenshot({ path: `${SAIDA}/${modo}-${w}.png` })
        await p.setViewportSize({ width: w, height: h })
        await p.getByTestId('ver-modelo').click()
        await p.getByTestId('modal-previa').waitFor({ timeout: 8000 })
        await p.waitForFunction(() => !document.querySelector('[data-testid="modal-previa-carregando"]'), null, { timeout: 15000 }).catch(() => {})
        await p.waitForTimeout(600)
        await p.screenshot({ path: `${SAIDA}/modal-${modo}-${w}.png` })
        await ctx.close()
      }
    }
    clearInterval(sinal)
    // Lado a lado com o protótipo (mesma largura de tela).
    for (const [nome, a, b] of [
      ['lado-a-lado-1366', `${PROTO}/prototipo-1366.png`, `${SAIDA}/beta-1366.png`],
      ['lado-a-lado-390', `${PROTO}/prototipo-390.png`, `${SAIDA}/beta-390.png`],
      ['lado-a-lado-modal-1366', `${PROTO}/prototipo-modal-1366.png`, `${SAIDA}/modal-beta-1366.png`],
      ['lado-a-lado-modal-390', `${PROTO}/prototipo-modal-390.png`, `${SAIDA}/modal-beta-390.png`],
    ]) {
      if (!existsSync(a) || !existsSync(b)) continue
      const ma = await sharp(a).metadata(), mb = await sharp(b).metadata()
      const cab = 40, gap = 24
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ma.width + mb.width + gap}" height="${cab}"><text x="${ma.width / 2}" y="28" font-family="Arial" font-size="22" font-weight="600" text-anchor="middle">Protótipo</text><text x="${ma.width + gap + mb.width / 2}" y="28" font-family="Arial" font-size="22" font-weight="600" text-anchor="middle">Tela real</text></svg>`)
      await sharp({ create: { width: ma.width + mb.width + gap, height: Math.max(ma.height, mb.height) + cab, channels: 3, background: '#bbbbbb' } })
        .composite([{ input: svg, left: 0, top: 0 }, { input: a, left: 0, top: cab }, { input: b, left: ma.width + gap, top: cab }]).png().toFile(`${SAIDA}/${nome}.png`)
    }
  } finally {
    await limpar()
    await db.end()
    await browser.close()
  }
  console.log('prints em', SAIDA)
}
if (import.meta.url === new URL(process.argv[1], 'file:').href || process.argv[1]?.endsWith('shots-tela-v4.mjs')) await main()
