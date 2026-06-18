const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const LIST_SCRIPT = path.join(__dirname, 'list-printers.ps1')
const PRINT_SCRIPT = path.join(__dirname, 'print.ps1')

function runPowershell(args) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(stdout)
    })
  })
}

/** Lista os nomes das impressoras instaladas no Windows (as mesmas que aparecem em "Impressoras e scanners"). */
async function listarImpressorasWindows() {
  const stdout = await runPowershell(['-File', LIST_SCRIPT])
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Envia um texto pra impressora do Windows com o nome exato informado, via spooler (Out-Printer). */
async function imprimirTexto(nomeImpressora, texto, copias = 1) {
  const tmpFile = path.join(os.tmpdir(), `menuzia-recibo-${Date.now()}.txt`)
  fs.writeFileSync(tmpFile, texto, 'utf-8')
  try {
    await runPowershell(['-File', PRINT_SCRIPT, '-FilePath', tmpFile, '-PrinterName', nomeImpressora, '-Copies', String(copias)])
  } finally {
    fs.unlink(tmpFile, () => {})
  }
}

module.exports = { listarImpressorasWindows, imprimirTexto }
