/**
 * E2E — Repaginação da Equipe (2026-10-01). Stack local, dono da cantina-pdv2.
 *   · validações do modal (nome, login repetido, senha mínima, ≥ 1 permissão);
 *   · um usuário TESTE por cargo, pela tela; papel deduzido e cargo gravados;
 *   · trocar cargo pergunta antes de substituir; editar; copiar permissões;
 *   · pausar, bloquear (não entra) e reativar; excluir (só desativa, some da lista);
 *   · dono com "Acesso total" e sem ações; cada cargo vê só o menu permitido, URL e API barradas;
 *   · ação sensível "taxa" barrada sem a permissão;
 *   · lista e modal em desktop, tablet e celular (sem rolagem lateral, rodapé à vista).
 *   No fim, os TESTE ficam excluídos (desativados).
 *
 *   node scripts/seguranca/e2e-equipe-repaginada.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id from restaurantes where slug='cantina-pdv2'`)
const SENHA = 'teste-equipe-123'
const SUF = String(Date.now()).slice(-5)
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const browser = await chromium.launch()
const criados = []
const foto = async (p, nome, full = false) => { if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`), fullPage: full }) }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function logar(login, senha, viewport = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', senha)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 15000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}
const menu = async (p) => (await p.locator('aside nav a').allInnerTexts()).map((t) => t.trim().split('\n')[0])
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return { status: r.status, json: await r.json().catch(() => null) }
}, { url: `${BASE}${url}`, metodo, corpo })
const linha = (p, login) => p.locator(`[data-testid="usuario-linha"][data-login="${login}"]`)
const usuarioDb = (login) => um(`select id, papel, cargo, situacao, desativado_em, telefone, acessos from usuarios where usuario=$1`, [login])
const permOn = async (p, chave) => (await p.getByTestId(chave).getAttribute('data-on')) === 'sim'
async function alternar(p, chave) { await p.getByTestId(chave).getByRole('switch').click() }

try {
  const dono = await logar('dono.pdv2@local.test', 'demo-local-123456')
  const pd = dono.p
  await pd.goto(`${BASE}/admin/equipe`, { waitUntil: 'networkidle' })
  await foto(pd, '01-equipe-lista-desktop')

  console.log('\n── lista ──')
  const donoLinha = pd.locator('[data-testid="usuario-linha"]', { has: pd.locator('[data-testid="cargo"]', { hasText: 'Dono' }) }).first()
  ok('dono aparece com "Acesso total"', /Acesso total/.test(await donoLinha.innerText()))
  ok('dono sem ações limitantes', (await donoLinha.getByTestId('acao-excluir').count()) === 0 && (await donoLinha.getByTestId('acao-pausar-bloquear').count()) === 0)
  ok('busca com o texto pedido', (await pd.getByPlaceholder('Pesquisar pelo nome ou login do usuário').count()) === 1)
  const cab = await pd.locator('thead th').allInnerTexts()
  ok('colunas Nome, Login, Cargo, Permissões, Situação, Último acesso', ['Nome', 'Login', 'Cargo', 'Permissões', 'Situação', 'Último acesso'].every((c) => cab.some((t) => t.trim() === c)), cab.join(' | '))

  console.log('\n── validações do modal ──')
  await pd.getByTestId('adicionar-usuario').click()
  await pd.getByTestId('modal-usuario').waitFor()
  ok('modal abre com "Adicionar usuário" e duas colunas', (await pd.getByText('Informações do usuário').count()) === 1 && (await pd.getByRole('heading', { name: 'Permissões' }).count()) === 1)
  await pd.getByTestId('usuario-salvar').click()
  const txtModal = await pd.getByTestId('modal-usuario').innerText()
  ok('salvar vazio mostra erros de nome, login e senha', /Informe o nome/.test(txtModal) && /De 3 a 30 caracteres/.test(txtModal) && /Pelo menos 8 caracteres/.test(txtModal))
  const loginExistente = (await um(`select usuario from usuarios where restaurante_id=$1 and usuario is not null and desativado_em is null limit 1`, [loja.id])).usuario
  await pd.getByTestId('usuario-login').fill(loginExistente)
  ok('login repetido avisa na hora', /já está em uso/.test(await pd.getByTestId('modal-usuario').innerText()))
  // Garçom vem com 1 permissão (Mesas); tirando, fica 0.
  ok('cargo padrão Garçom traz o modelo (1 permissão)', /^1 permissão/.test((await pd.getByTestId('permissoes-total').innerText()).trim()))
  await alternar(pd, 'perm-area-mesas')
  ok('contador atualiza (0 permissões concedidas)', /0 permissões/.test(await pd.getByTestId('permissoes-total').innerText()))
  ok('sem permissão nenhuma: erro "pelo menos uma permissão"', (await pd.getByTestId('erro-permissoes').count()) === 1)
  // Trocar cargo com permissões diferentes do modelo pergunta antes.
  await alternar(pd, 'perm-area-clientes')
  await pd.getByTestId('usuario-cargo').selectOption('caixa')
  ok('trocar o cargo pergunta antes de substituir', (await pd.getByTestId('troca-cargo').count()) === 1)
  await pd.getByTestId('troca-manter').click()
  ok('"Manter as atuais" não mexe nas permissões', (await permOn(pd, 'perm-area-clientes')) && !(await permOn(pd, 'perm-area-pdv')))
  await pd.getByTestId('usuario-cargo').selectOption('garcom')
  await pd.getByTestId('troca-substituir').click()
  ok('"Substituir" aplica o modelo do cargo', (await permOn(pd, 'perm-area-mesas')) && !(await permOn(pd, 'perm-area-clientes')))
  await pd.getByTestId('busca-permissao').fill('cupom')
  ok('busca de permissões filtra os cartões', (await pd.locator('[data-testid^="perm-"]').count()) <= 3 && (await pd.getByTestId('perm-sensivel-desconto').count()) === 1)
  await pd.getByTestId('busca-permissao').fill('')
  ok('dono pode liberar a área Equipe (cartão habilitado)', !(await pd.getByTestId('perm-area-equipe').getByRole('switch').isDisabled()))
  await foto(pd, '02-modal-adicionar-desktop')
  await pd.getByTestId('usuario-cancelar').click()
  ok('Cancelar fecha o modal', (await pd.getByTestId('modal-usuario').count()) === 0)

  console.log('\n── um usuário TESTE por cargo ──')
  const CARGOS = {
    gerente: 'gerente', caixa: 'atendente', garcom: 'garcom', cozinha: 'atendente', motoboy: 'logistica', atendente: 'atendente', personalizado: 'gerente',
  }
  for (const [cargo, papel] of Object.entries(CARGOS)) {
    const login = `teste.${cargo}.${SUF}`
    await pd.getByTestId('adicionar-usuario').click()
    await pd.getByTestId('usuario-nome').fill(`TESTE ${cargo}`)
    await pd.getByTestId('usuario-login').fill(login)
    await pd.getByTestId('usuario-senha').fill(SENHA)
    await pd.getByTestId('usuario-telefone').fill('27999990000')
    await pd.getByTestId('usuario-cargo').selectOption(cargo)
    if (await pd.getByTestId('troca-substituir').count()) await pd.getByTestId('troca-substituir').click()
    if (cargo === 'personalizado') { await alternar(pd, 'perm-area-cardapio'); await alternar(pd, 'perm-area-clientes') }
    await pd.getByTestId('usuario-salvar').click()
    await pd.getByTestId('modal-usuario').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    const u = await usuarioDb(login)
    if (u) criados.push(u.id)
    ok(`${cargo}: criado com papel ${papel}, cargo gravado e permissões`, !!u && u.papel === papel && u.cargo === cargo && (u.acessos?.areas?.length ?? 0) > 0 && u.telefone === '27999990000', JSON.stringify({ papel: u?.papel, cargo: u?.cargo, a: u?.acessos }))
  }
  ok('toast de confirmação ao salvar', (await pd.getByTestId('toast').count()) > 0)
  await pd.reload({ waitUntil: 'networkidle' })
  const cargosVistos = await pd.getByTestId('cargo').allInnerTexts()
  ok('badges de cargo na lista', ['Gerente', 'Caixa', 'Garçom', 'Cozinha', 'Motoboy', 'Atendente', 'Personalizado'].every((c) => cargosVistos.includes(c)), cargosVistos.join(','))
  const permCaixa = await linha(pd, `teste.caixa.${SUF}`).getByTestId('acessos-resumo').innerText()
  ok('coluna Permissões mostra a contagem', /^\d+ permissões$/.test(permCaixa.trim()), permCaixa)
  await foto(pd, '03-equipe-lista-com-cargos', true)

  console.log('\n── editar ──')
  await linha(pd, `teste.caixa.${SUF}`).getByTestId('acao-editar').click()
  ok('modal "Editar usuário" com login travado', (await pd.getByText('Editar usuário').count()) === 1 && (await pd.getByTestId('usuario-login').isDisabled()))
  ok('Salvar desabilitado enquanto nada mudou', await pd.getByTestId('usuario-salvar').isDisabled())
  ok('editar tem "Redefinir senha" no lugar da senha', (await pd.getByTestId('usuario-redefinir-senha').count()) === 1 && (await pd.getByTestId('usuario-senha').count()) === 0)
  await pd.getByTestId('usuario-telefone').fill('27988887777')
  await alternar(pd, 'perm-area-pdv')
  await foto(pd, '04-modal-editar-desktop')
  await pd.getByTestId('usuario-salvar').click()
  await pd.getByTestId('modal-usuario').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  const cx = await usuarioDb(`teste.caixa.${SUF}`)
  ok('edição gravou telefone e tirou o PDV', cx.telefone === '27988887777' && !cx.acessos.areas.includes('pdv'), JSON.stringify(cx.acessos))
  // Redefinir senha pelo modal.
  await linha(pd, `teste.caixa.${SUF}`).getByTestId('acao-editar').click()
  await pd.getByTestId('usuario-redefinir-senha').click()
  await pd.getByTestId('usuario-nova-senha').fill('curta')
  await pd.getByTestId('usuario-confirmar-senha').click()
  ok('senha curta recusada', /Pelo menos 8/.test(await pd.getByTestId('usuario-senha-msg').innerText()))
  await pd.getByTestId('usuario-nova-senha').fill(SENHA + 'x')
  await pd.getByTestId('usuario-confirmar-senha').click()
  await pd.getByTestId('usuario-senha-msg').filter({ hasText: 'redefinida' }).waitFor({ timeout: 8000 }).catch(() => {})
  ok('senha redefinida pelo modal', /redefinida/.test(await pd.getByTestId('usuario-senha-msg').innerText()))
  await pd.getByTestId('usuario-cancelar').click()
  const cxNova = await logar(`teste.caixa.${SUF}`, SENHA + 'x')
  ok('caixa entra com a senha nova', cxNova.p.url().includes('/admin') && !cxNova.p.url().includes('/login'), cxNova.p.url())
  await cxNova.ctx.close()
  // Senha pelo ícone da lista.
  await linha(pd, `teste.caixa.${SUF}`).getByTestId('acao-senha').click()
  await pd.getByTestId('senha-nova').fill(SENHA)
  await pd.getByTestId('senha-salvar').click()
  await pd.getByTestId('janela-pequena').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  ok('redefinir senha pelo ícone da lista', (await pd.getByTestId('janela-pequena').count()) === 0)

  console.log('\n── copiar permissões ──')
  await linha(pd, `teste.atendente.${SUF}`).getByTestId('acao-editar').click()
  const idCozinha = (await usuarioDb(`teste.cozinha.${SUF}`)).id
  await pd.getByTestId('copiar-permissoes').selectOption(idCozinha)
  ok('copiar traz as permissões do outro usuário', (await permOn(pd, 'perm-area-pedidos')) && !(await permOn(pd, 'perm-area-pdv')))
  await pd.getByTestId('usuario-salvar').click()
  await pd.getByTestId('modal-usuario').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  const at = await usuarioDb(`teste.atendente.${SUF}`)
  const coz = await usuarioDb(`teste.cozinha.${SUF}`)
  ok('copiado e gravado igual', JSON.stringify([...at.acessos.areas].sort()) === JSON.stringify([...coz.acessos.areas].sort()) && at.cargo === 'personalizado', JSON.stringify(at.acessos))

  console.log('\n── pausar, bloquear, reativar, excluir ──')
  const gar = await logar(`teste.garcom.${SUF}`, SENHA)
  ok('garçom ativo entra', gar.p.url().includes('/admin'))
  await linha(pd, `teste.garcom.${SUF}`).getByTestId('acao-pausar-bloquear').click()
  await linha(pd, `teste.garcom.${SUF}`).getByTestId('menu-pausar').click()
  await foto(pd, '05-confirmar-pausa')
  await pd.getByTestId('confirmar-ok').click()
  await esperar(1200)
  let g = await usuarioDb(`teste.garcom.${SUF}`)
  ok('pausado: situação gravada e acesso cortado', g.situacao === 'pausado' && !!g.desativado_em)
  ok('lista mostra "Pausado"', /Pausado/.test(await linha(pd, `teste.garcom.${SUF}`).innerText()))
  const stPaus = await api(gar.p, '/api/admin/pdv/mesas')
  ok('sessão aberta do pausado cai na próxima ação', stPaus.status === 401 || stPaus.status === 403 || stPaus.status === 404, String(stPaus.status))
  await gar.ctx.close()
  const gar2 = await logar(`teste.garcom.${SUF}`, SENHA)
  ok('pausado não entra', !/\/admin\/(mesas|dashboard|pedidos)/.test(gar2.p.url()), gar2.p.url())
  await gar2.ctx.close()
  await linha(pd, `teste.garcom.${SUF}`).getByTestId('acao-reativar').click()
  await esperar(1200)
  g = await usuarioDb(`teste.garcom.${SUF}`)
  ok('reativar limpa situação e corte', g.situacao === null && g.desativado_em === null)
  const gar3 = await logar(`teste.garcom.${SUF}`, SENHA)
  ok('reativado entra de novo', gar3.p.url().includes('/admin/mesas'), gar3.p.url())
  await gar3.ctx.close()

  await linha(pd, `teste.cozinha.${SUF}`).getByTestId('acao-pausar-bloquear').click()
  await linha(pd, `teste.cozinha.${SUF}`).getByTestId('menu-bloquear').click()
  await pd.getByTestId('confirmar-ok').click()
  await esperar(1200)
  const cz = await usuarioDb(`teste.cozinha.${SUF}`)
  ok('bloqueado: situação gravada', cz.situacao === 'bloqueado' && !!cz.desativado_em)
  ok('lista mostra "Bloqueado"', /Bloqueado/.test(await linha(pd, `teste.cozinha.${SUF}`).innerText()))
  const cz2 = await logar(`teste.cozinha.${SUF}`, SENHA)
  ok('bloqueado não entra', !/\/admin\/(pedidos|dashboard)/.test(cz2.p.url()), cz2.p.url())
  await cz2.ctx.close()

  await linha(pd, `teste.motoboy.${SUF}`).getByTestId('acao-excluir').click()
  ok('excluir pede confirmação', /Nada é apagado/.test(await pd.getByTestId('janela-pequena').innerText()))
  await pd.getByTestId('confirmar-ok').click()
  await esperar(1200)
  const mb = await usuarioDb(`teste.motoboy.${SUF}`)
  ok('excluir só desativa (linha continua no banco)', !!mb && mb.situacao === 'excluido' && !!mb.desativado_em)
  ok('excluído some da lista', (await linha(pd, `teste.motoboy.${SUF}`).count()) === 0)
  await pd.getByTestId('ver-excluidos').click()
  ok('"Ver excluídos" mostra o excluído', (await linha(pd, `teste.motoboy.${SUF}`).count()) === 1)
  await pd.getByTestId('ver-excluidos').click()
  const aud = await um(`select array_agg(distinct acao) a from eventos_auditoria where entidade_id = any($1)`, [criados])
  ok('auditoria: criou, pausou, reativou, bloqueou, excluiu', ['equipe.criou', 'equipe.pausou', 'equipe.reativou', 'equipe.bloqueou', 'equipe.excluiu'].every((x) => aud.a?.includes(x)), (aud.a ?? []).join(', '))

  console.log('\n── cada cargo vê só o que pode ──')
  const esperado = {
    gerente: { tem: ['Campanhas', 'Cardápio'], nao: ['Equipe'], proibida: '/admin/equipe', apiProibida: '/api/admin/equipe' },
    caixa: { tem: ['Painel de Pedidos', 'Mesas e Comandas'], nao: ['PDV', 'Campanhas'], proibida: '/admin/pdv', apiProibida: '/api/admin/pdv/mesas' },
    garcom: { tem: ['Mesas e Comandas'], nao: ['Painel de Pedidos', 'Campanhas'], proibida: '/admin/campanhas', apiProibida: '/api/admin/campanhas' },
    atendente: { tem: ['Painel de Pedidos'], nao: ['PDV', 'Clientes'], proibida: '/admin/clientes', apiProibida: '/api/admin/campanhas' },
    personalizado: { tem: ['Mesas e Comandas', 'Cardápio', 'Clientes'], nao: ['Campanhas', 'Dashboard'], proibida: '/admin/campanhas', apiProibida: '/api/admin/campanhas' },
  }
  for (const [cargo, e] of Object.entries(esperado)) {
    const s = await logar(`teste.${cargo}.${SUF}`, SENHA)
    const m = await menu(s.p)
    ok(`${cargo}: menu tem ${e.tem.join(', ')} e não tem ${e.nao.join(', ')}`, e.tem.every((t) => m.includes(t)) && e.nao.every((t) => !m.includes(t)), m.join(' | '))
    await s.p.goto(`${BASE}${e.proibida}`, { waitUntil: 'networkidle' })
    ok(`${cargo}: URL proibida → "Você não tem acesso a esta área"`, /sem-acesso/.test(s.p.url()) || !s.p.url().includes(e.proibida), s.p.url())
    const st = await api(s.p, e.apiProibida)
    ok(`${cargo}: API proibida bloqueada`, st.status === 403 || st.status === 404, `${st.status} ${st.json?.error ?? ''}`)
    if (cargo === 'garcom') await foto(s.p, '06-garcom-sem-acesso')
    if (cargo === 'garcom') {
      // Ação sensível nova: taxas da conta sem a permissão "taxa".
      const tx = await api(s.p, '/api/admin/mesas/00000000-0000-0000-0000-000000000000/conta', 'POST', { acao: 'taxa_extra', nome: 'x', valor: 1 })
      ok('garçom sem "taxa" não aplica taxa na conta (403)', tx.status === 403 && tx.json?.acao === 'taxa', `${tx.status} ${JSON.stringify(tx.json)}`)
    }
    await s.ctx.close()
  }

  console.log('\n── tablet e celular ──')
  for (const [nome, vp] of [['tablet', { width: 820, height: 1180 }], ['celular', { width: 390, height: 844 }]]) {
    const s = await logar('dono.pdv2@local.test', 'demo-local-123456', vp)
    await s.p.goto(`${BASE}/admin/equipe`, { waitUntil: 'networkidle' })
    const sobra = await s.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(`${nome}: lista sem rolagem lateral`, sobra <= 1, String(sobra))
    ok(`${nome}: cartões com ações à vista`, (await s.p.locator(`[data-testid="usuario-cartao"][data-login="teste.caixa.${SUF}"] [data-testid="acao-editar"]`).isVisible()))
    await foto(s.p, `07-lista-${nome}`)
    await s.p.locator(`[data-testid="usuario-cartao"][data-login="teste.caixa.${SUF}"] [data-testid="acao-editar"]`).click()
    const rod = await s.p.getByTestId('usuario-salvar').boundingBox()
    ok(`${nome}: modal com rodapé fixo à vista`, !!rod && rod.y + rod.height <= vp.height + 1, JSON.stringify(rod))
    const sobraM = await s.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(`${nome}: modal sem rolagem lateral`, sobraM <= 1, String(sobraM))
    await foto(s.p, `08-modal-${nome}`)
    await s.ctx.close()
  }
} catch (e) {
  console.error(e); res.push(false)
} finally {
  if (criados.length) await db.query(`update usuarios set desativado_em = coalesce(desativado_em, now()), situacao = 'excluido' where id = any($1)`, [criados])
  console.log(`   (usuários TESTE excluídos/desativados: ${criados.length})`)
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
