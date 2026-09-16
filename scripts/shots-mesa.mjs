/**
 * Screenshots do cardápio presencial da mesa, nos viewports que importam.
 *
 * Playwright não é dependência do projeto (baixa um Chromium de ~150 MB). Instale só
 * para conferir o visual:  npm i -D playwright && npx playwright install chromium
 *
 *   node scripts/shots-mesa.mjs http://127.0.0.1:3999 <token-da-mesa>
 *
 * Sai em .shots/ (fora do git). É ferramenta de conferência, não teste: quem decide se
 * ficou bom é gente olhando.
 */
import { chromium } from 'playwright'
import fs from 'fs'

const base = process.argv[2] ?? 'http://127.0.0.1:3999'
const token = process.argv[3]
if (!token) {
  console.error('\nUso: node scripts/shots-mesa.mjs <base> <token-da-mesa>\n')
  process.exit(1)
}

const dir = '.shots'
fs.mkdirSync(dir, { recursive: true })

const VIEWPORTS = [
  { nome: 'celular-390x844', width: 390, height: 844, mobile: true },
  { nome: 'tablet-768x1024', width: 768, height: 1024, mobile: true },
  { nome: 'tablet-h-1024x768', width: 1024, height: 768, mobile: false },
]

const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    locale: 'pt-BR',
  })
  const page = await context.newPage()
  const shot = async (nome) => {
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${dir}/mesa-${vp.nome}-${nome}.png` })
    console.log('•', `mesa-${vp.nome}-${nome}`)
  }

  await page.goto(`${base}/mesa/${token}`, { waitUntil: 'networkidle' })
  await shot('01-cardapio')

  // Abre um item COM etapas, senão o configurador aparece só com a quantidade e a
  // demonstração não mostra o que interessa.
  const comEtapas = page.locator('.mesa-categoria', { hasText: 'Burgers' })
  if (await comEtapas.count()) {
    await comEtapas.first().click()
    await page.waitForTimeout(300)
    await shot('01b-categoria')
  }

  // Configurador do produto, etapa a etapa.
  await page.locator('text=Selecionar item').first().click()
  await shot('02-configurador')

  // Marca a primeira opção da etapa, se houver alguma.
  const primeiraOpcao = page.locator('.mesa-opcao').first()
  if (await primeiraOpcao.count()) {
    await primeiraOpcao.click()
    await shot('03-opcao-marcada')
    const avancar = page.locator('.mesa-avancar')
    while ((await avancar.count()) && (await avancar.getAttribute('class'))?.includes('ativo')) {
      const texto = (await avancar.textContent())?.trim()
      await avancar.click()
      await page.waitForTimeout(250)
      if (texto?.includes('Adicionar')) break
      const opcao = page.locator('.mesa-opcao').first()
      if (await opcao.count()) await opcao.click()
    }
  } else {
    await shot('03-quantidade')
    await page.locator('.mesa-avancar.ativo').click()
  }

  // Garante que a linha entrou na seleção.
  await page.waitForTimeout(400)
  if (await page.locator('.mesa-avancar.ativo').count()) {
    await page.locator('.mesa-avancar.ativo').click()
    await page.waitForTimeout(400)
  }

  await shot('04-apos-adicionar')

  // Painel "Minha seleção".
  const abrir = page.locator('.mesa-barra-flutuante, .mesa-botao-selecao').first()
  if (await abrir.count()) {
    await abrir.click()
    await shot('05-minha-selecao')
    const concluir = page.locator('text=Concluir seleção')
    if (await concluir.count()) {
      await concluir.click()
      await shot('06-selecao-salva')
    }
  }

  await context.close()
}

// Token inválido, no viewport de celular.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: 'pt-BR' })
  const page = await context.newPage()
  await page.goto(`${base}/mesa/token-que-nao-existe`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${dir}/mesa-celular-390x844-07-token-invalido.png` })
  console.log('•', 'mesa-celular-390x844-07-token-invalido')
  await context.close()
}

await browser.close()
console.log(`\nImagens em ${dir}/\n`)
