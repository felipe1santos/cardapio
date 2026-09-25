/**
 * ISOLAMENTO dos testes de impressão — nenhum teste escreve no Assistente REAL deste PC.
 *
 * O 0.1.23 instalado grava o log em %TEMP%\menuzia-print.log e a configuração em
 * %APPDATA%\menuzia-printer-agent. Em 2026-09-25 um e2e (agentes virtuais sem %TEMP%
 * próprio) anexou 8 linhas de diagnóstico da loja de demonstração nesse log real
 * (02:04:03–02:04:43; ver docs/incidentes/2026-09-25-log-real-assistente.md).
 *
 * Os caminhos REAIS vêm da pasta do usuário, nunca de variável de ambiente (que o
 * próprio teste troca). Qualquer script que roda o Assistente ou o print.ps1 chama
 * `exigirIsolamento` ANTES de começar: se a pasta temporária, os dados ou a saída
 * apontarem para o lugar real, ele aborta sem fazer nada.
 */
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

const HOME = os.homedir()
const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase()

const REAIS = {
  temp: path.join(HOME, 'AppData', 'Local', 'Temp'),
  log: path.join(HOME, 'AppData', 'Local', 'Temp', 'menuzia-print.log'),
  logBeta: path.join(HOME, 'AppData', 'Local', 'Temp', 'menuzia-beta-print.log'),
  dados: [
    path.join(HOME, 'AppData', 'Roaming', 'menuzia-printer-agent'),
    path.join(HOME, 'AppData', 'Roaming', 'menuzia-assistente-beta'),
  ],
  instalacoes: [
    path.join(HOME, 'AppData', 'Local', 'Programs', 'menuzia-printer-agent'),
    path.join(HOME, 'AppData', 'Local', 'Programs', 'menuzia-assistente-beta'),
  ],
}

const dentro = (p, raiz) => norm(p) === norm(raiz) || norm(p).startsWith(norm(raiz) + path.sep)

/**
 * Aborta se o teste for usar o lugar real. `temp` = pasta que vira %TEMP% (log do
 * print.ps1 e do Assistente); `pastas` = dados/saída do teste.
 */
function exigirIsolamento({ temp, pastas = [], rotulo = 'teste' }) {
  const erros = []
  if (!temp) erros.push('sem pasta temporária própria')
  else {
    if (norm(temp) === norm(REAIS.temp)) erros.push(`%TEMP% do teste é o %TEMP% real (${REAIS.temp})`)
    if (norm(path.join(temp, 'menuzia-print.log')) === norm(REAIS.log)) erros.push(`log do teste seria o log real (${REAIS.log})`)
  }
  for (const p of [temp, ...pastas].filter(Boolean)) {
    for (const r of [...REAIS.dados, ...REAIS.instalacoes]) if (dentro(p, r)) erros.push(`${p} está dentro da pasta real ${r}`)
    if (norm(p) === norm(REAIS.temp)) erros.push(`${p} é o %TEMP% real`)
  }
  if (erros.length) {
    const msg = `ABORTADO (${rotulo}): o teste usaria arquivos reais do Assistente — ${erros.join('; ')}`
    const e = new Error(msg)
    e.code = 'ISOLAMENTO'
    throw e
  }
}

/** Confere, depois de trocar %TEMP%, que o Node realmente usa a pasta do teste. */
function exigirTempAtivo(temp, rotulo = 'teste') {
  if (norm(os.tmpdir()) !== norm(temp)) {
    const e = new Error(`ABORTADO (${rotulo}): os.tmpdir() = ${os.tmpdir()}, esperado ${temp}`)
    e.code = 'ISOLAMENTO'
    throw e
  }
}

function fotoArquivo(p) {
  if (!fs.existsSync(p)) return { existe: false }
  const st = fs.statSync(p)
  return { existe: true, tamanho: st.size, modificadoEm: st.mtime.toISOString(), sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') }
}
function fotoPasta(p) {
  if (!fs.existsSync(p)) return { existe: false }
  const linhas = []
  const andar = (d) => {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, n.name)
      if (n.isDirectory()) andar(f)
      else { const st = fs.statSync(f); linhas.push(`${path.relative(p, f)}|${st.size}|${st.mtimeMs}`) }
    }
  }
  andar(p)
  linhas.sort()
  return { existe: true, arquivos: linhas.length, sha256: crypto.createHash('sha256').update(linhas.join('\n')).digest('hex') }
}

/** Fotografia dos arquivos REAIS do Assistente (hash, tamanho e data). Só leitura. */
function fotografarReais() {
  return {
    log: fotoArquivo(REAIS.log),
    logBeta: fotoArquivo(REAIS.logBeta),
    config: fotoArquivo(path.join(REAIS.dados[0], 'config.json')),
    configBeta: fotoArquivo(path.join(REAIS.dados[1], 'config.json')),
    instalacao: fotoPasta(REAIS.instalacoes[0]),
  }
}

/** Diferenças entre duas fotografias (vazio = nada mudou). */
function diferencas(a, b) {
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`)
}

module.exports = { REAIS, exigirIsolamento, exigirTempAtivo, fotografarReais, diferencas }
