/**
 * GOLDEN do Assistente antigo 0.1.23 — prova que o Beta não muda nada do que ele imprime.
 *
 * O 0.1.23 instalado nas lojas roda o recibo.js e o print.ps1 DA TAG printer-agent-v0.1.23.
 * Este teste extrai esses dois arquivos da tag e compara, pixel a pixel (sha256 do PNG):
 *   · a ficha montada pelo recibo.js da tag, desenhada pelo print.ps1 da tag;
 *   · a MESMA ficha desenhada pelo print.ps1 atual com os argumentos de sempre (sem
 *     perfil) — é o que o 0.1.26/Beta usa por baixo.
 * Cobre 58 e 80 mm, fonte grande e pequena, as duas configurações da loja e pedidos com
 * nome longo, muitos complementos, endereço longo, acentos e total acima de R$ 1.000,00.
 *
 * Também confere que o recibo.js atual é o mesmo de produção (5c2a0a6), que o perfil
 * calibrado só muda a largura quando é pedido e que o log do Beta não escreve no log
 * do Assistente antigo. Nada imprime: -DebugPng, com %TEMP% isolado (o log real do
 * 0.1.23 deste computador não é tocado).
 *
 *   node scripts/impressao/golden-assistente-0123.mjs [pasta-saida]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const RAIZ = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const TAG = 'printer-agent-v0.1.23'
const PRODUCAO = '5c2a0a6'
const SAIDA = resolve(process.argv[2] ?? join(tmpdir(), `golden-0123-${Date.now()}`))
mkdirSync(SAIDA, { recursive: true })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}
const sha = (b) => createHash('sha256').update(b).digest('hex')
const git = (...a) => execFileSync('git', a, { cwd: RAIZ, maxBuffer: 1 << 26 })

// %TEMP% isolado: o print.ps1 grava log em $env:TEMP. O log real do 0.1.23 fica intocado.
const TEMP_ISOLADO = mkdtempSync(join(tmpdir(), 'golden-0123-temp-'))
const { exigirIsolamento, fotografarReais, diferencas } = require('./isolamento-teste.cjs')
try {
  exigirIsolamento({ temp: TEMP_ISOLADO, pastas: [SAIDA], rotulo: 'golden 0.1.23' })
} catch (e) {
  console.error(e.message)
  process.exit(3)
}
const fotoReaisAntes = fotografarReais()

// ── arquivos da tag ─────────────────────────────────────────────────────────
const DIR_TAG = join(SAIDA, 'tag-0.1.23')
mkdirSync(DIR_TAG, { recursive: true })
for (const f of ['print.ps1', 'recibo.js']) writeFileSync(join(DIR_TAG, f), git('show', `${TAG}:printer-agent/src/${f}`))
const PS1_TAG = join(DIR_TAG, 'print.ps1')
const PS1_ATUAL = join(RAIZ, 'printer-agent', 'src', 'print.ps1')
const reciboTag = require(join(DIR_TAG, 'recibo.js'))

function colsParaFonte(tamanho, largura) {
  // Mesma regra do main.js (colsParaFonte), igual na tag e hoje.
  const t = String(tamanho || '').toLowerCase()
  const base = Number(largura) > 0 ? Number(largura) : 48
  if (t.includes('grand')) return Math.max(14, Math.round(base * 0.55))
  if (t.includes('med') || t.includes('norm')) return Math.max(16, Math.round(base * 0.72))
  return base
}

let n = 0
function renderizar(ps1, texto, { cols, paperMm, fonteMaior, extra = [] }) {
  const id = String(++n).padStart(4, '0')
  const txt = join(SAIDA, `${id}.txt`)
  const png = join(SAIDA, `${id}.png`)
  writeFileSync(txt, texto, 'utf-8')
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-FilePath', txt, '-PrinterName', 'Microsoft Print to PDF',
    '-Cols', String(cols), '-PaperWidthMm', String(paperMm), ...(fonteMaior ? ['-FonteMaior', '1'] : []), ...extra, '-DebugPng', png],
  { stdio: 'pipe', env: { ...process.env, TEMP: TEMP_ISOLADO, TMP: TEMP_ISOLADO } })
  rmSync(txt)
  return { png, sha: sha(readFileSync(png)) }
}
// Largura do PNG (cabeçalho IHDR).
const larguraPng = (p) => readFileSync(p).readUInt32BE(16)

// ── pedidos ─────────────────────────────────────────────────────────────────
const { FIXTURES, CONFIGS } = require(join(RAIZ, 'printer-agent', 'test', 'fixtures-recibo.cjs'))
const comp = (nome, preco) => ({ nome, preco })
const PEDIDOS = {
  ...FIXTURES,
  grande: {
    ...FIXTURES.delivery_completo, numero: 9876, clienteNome: 'Maria Aparecida dos Santos Conceição de Albuquerque Figueiredo',
    enderecoRua: 'Avenida Nossa Senhora da Penha, Condomínio Residencial Jardim das Orquídeas Bloco C',
    enderecoNumero: '1500', enderecoComplemento: 'Apartamento 1203, interfone 1203, portaria 24h — entregar ao porteiro',
    enderecoBairro: 'Santa Lúcia', observacao: 'Troco para cem reais. Não tocar a campainha: bebê dormindo.',
    subtotal: 1219.56, taxaEntrega: 15, total: 1234.56, trocoPara: null, formaPagamento: 'pix', pago: true,
    itens: [
      { quantidade: 3, nome: 'Combo Família Gigante com Pizza Grande Meio a Meio, Refrigerante 2 L e Sobremesa', precoUnitario: 289.9, observacao: 'Uma das pizzas sem cebola',
        tamanhoNome: 'Gigante', saborNome: 'Portuguesa / Quatro Queijos', bordaNome: 'Catupiry', massaNome: 'Tradicional',
        complementos: [comp('Bacon', 6), comp('Bacon', 6), comp('Cheddar', 5), comp('Azeitona', 2), comp('Orégano', 0), comp('Cebola roxa', 2),
          comp('Pimenta calabresa', 0), comp('Milho', 2), comp('Ervilha', 2), comp('Palmito', 7), comp('Champignon', 6), comp('Tomate seco', 5)] },
      { quantidade: 1, nome: 'Açaí 1 L', precoUnitario: 49.86, observacao: '', tamanhoNome: '1 L', saborNome: '', bordaNome: '', massaNome: '',
        complementos: [comp('Granola', 3), comp('Leite condensado', 3), comp('Paçoca', 3), comp('Morango', 4), comp('Banana', 2)] },
    ],
  },
}
const LARGURAS = [{ paperMm: 80, largura: 48 }, { paperMm: 58, largura: 32 }]

console.log(`\n── Arquivos do 0.1.23 ──`)
// Fim de linha não conta (checkout no Windows grava CRLF).
const semCr = (b) => String(b).replace(/\r\n/g, '\n')
const reciboAtual = readFileSync(join(RAIZ, 'printer-agent', 'src', 'recibo.js'))
ok('recibo.js atual é o mesmo de produção (5c2a0a6)', semCr(reciboAtual) === semCr(git('show', `${PRODUCAO}:printer-agent/src/recibo.js`)))
ok('print.ps1 de produção (5c2a0a6) é o mesmo da tag 0.1.23', sha(git('show', `${PRODUCAO}:printer-agent/src/print.ps1`)) === sha(readFileSync(PS1_TAG)))

console.log(`\n── Ficha da cozinha: print.ps1 da tag × print.ps1 atual (sem perfil) ──`)
let iguais = 0
let total = 0
const diferentes = []
for (const [nome, pedido] of Object.entries(PEDIDOS)) {
  for (const [nc, config] of Object.entries(CONFIGS)) {
    for (const { paperMm, largura } of LARGURAS) {
      for (const fonte of ['grande', 'pequena']) {
        const cols = colsParaFonte(fonte, largura)
        const texto = reciboTag.montarRecibo(pedido, config, cols, 'Cantina Demonstração', false)
        const a = renderizar(PS1_TAG, texto, { cols, paperMm, fonteMaior: config.fonteMaiorProducao })
        const b = renderizar(PS1_ATUAL, texto, { cols, paperMm, fonteMaior: config.fonteMaiorProducao })
        total++
        if (a.sha === b.sha) {
          iguais++
          rmSync(b.png)
        } else diferentes.push(`${nome}.${nc}.${paperMm}mm.${fonte}`)
      }
    }
  }
}
ok(`${total} fichas idênticas pixel a pixel (58/80 mm, fonte grande/pequena, 2 configurações)`, iguais === total, diferentes.join(', '))

console.log(`\n── Perfil do Beta só vale quando é pedido ──`)
const tGrande = reciboTag.montarRecibo(PEDIDOS.grande, CONFIGS.padrao, 48, 'Cantina Demonstração', false)
const ref = renderizar(PS1_TAG, tGrande, { cols: 48, paperMm: 80 })
const zero = renderizar(PS1_ATUAL, tGrande, { cols: 48, paperMm: 80, extra: ['-LarguraPontos', '0', '-DeslocamentoPontos', '0'] })
ok('perfil zerado explícito: idêntico ao 0.1.23', ref.sha === zero.sha)
const p512 = renderizar(PS1_ATUAL, tGrande, { cols: 48, paperMm: 80, extra: ['-LarguraPontos', '512', '-LogNome', 'menuzia-beta-print.log'] })
ok('perfil 512 pontos: bitmap de 512 de largura (o do 0.1.23 é 576)', larguraPng(p512.png) === 512 && larguraPng(ref.png) === 576)
const fora = renderizar(PS1_ATUAL, tGrande, { cols: 48, paperMm: 80, extra: ['-LarguraPontos', '5000', '-DeslocamentoPontos', '999'] })
ok('perfil fora do limite é ignorado (volta ao padrão)', fora.sha === ref.sha)
const logBeta = join(TEMP_ISOLADO, 'menuzia-beta-print.log')
ok('Beta grava no próprio log (menuzia-beta-print.log)', existsSync(logBeta) && /PERFIL: larguraPontos=512/.test(readFileSync(logBeta, 'utf8')))

console.log(`\n── Página de calibração (só Beta) ──`)
const { montarCalibracao } = require(join(RAIZ, 'printer-agent', 'src', 'calibracao.js'))
const snap = { calibracao: true, loja: 'Cantina Demonstração', impressora: 'Caixa POS-8370', nome_sistema: 'POS-8370', computador: 'PC Caixa', largura_mm: 80, operador: 'Gerente Demo' }
const diag = { driver: 'POS-80C', porta: 'USB001', dpiX: 203, dpiY: 203, papelNome: '80(72.1) x 3276 mm', papelLarguraMm: 80, areaImprimivelLarguraMm: 72.1, margemEsquerdaMm: 0, margemDireitaMm: 7.9, pontosImprimiveis: 575 }
for (const [rotulo, s, mm, extra] of [
  ['80 mm padrão', snap, 80, []],
  ['80 mm calibrada em 512', { ...snap, largura_pontos: 512, deslocamento_pontos: 0 }, 80, ['-LarguraPontos', '512']],
  ['58 mm padrão', { ...snap, largura_mm: 58 }, 58, []],
]) {
  const r = renderizar(PS1_ATUAL, montarCalibracao(s, diag), { cols: mm <= 58 ? 32 : 48, paperMm: mm, extra })
  const destino = join(SAIDA, `calibracao-${rotulo.replace(/\W+/g, '-')}.png`)
  writeFileSync(destino, readFileSync(r.png))
  ok(`calibração ${rotulo}: largura ${larguraPng(r.png)}`, larguraPng(r.png) === (extra.length ? 512 : mm <= 58 ? 384 : 576), destino)
}
const texto = montarCalibracao({ ...snap, largura_pontos: 512 }, diag)
ok('calibração mostra driver, DPI, papel, área imprimível, margem e largura aplicada',
  ['POS-80C', '203 x 203', '72.1 mm', '7.9 mm', '512 pontos', '1:1', 'TOTAL', 'R$ 12.345,67'].every((t) => texto.includes(t)))

// Recibo/Extrato do Beta: layout próprio (pre-conta-beta.js + print-beta.ps1), medido em
// scripts/impressao/matriz-recibo-beta.mjs.
rmSync(TEMP_ISOLADO, { recursive: true, force: true })
const difReais = diferencas(fotoReaisAntes, fotografarReais())
ok('arquivos reais do Assistente intactos (log, config e instalação: hash, tamanho e data)', difReais.length === 0, difReais.join(' | '))
const falhas = res.filter((r) => !r).length
console.log(`\nSaída: ${SAIDA}`)
console.log(`${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
