const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

// Os .ps1 ficam empacotados, mas o PowerShell -File precisa de um arquivo real no
// disco — e nada dentro do app.asar existe como arquivo de verdade. Por isso eles são
// marcados em "asarUnpack" (package.json), o que os extrai pra app.asar.unpacked. O
// __dirname ainda aponta pra dentro do .asar, então trocamos o segmento pelo caminho
// desempacotado. Em dev (sem asar) o replace é no-op e usa o caminho normal.
function scriptReal(nome) {
  return path.join(__dirname, nome).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

const LIST_SCRIPT = scriptReal('list-printers.ps1')
const PRINT_SCRIPT = scriptReal('print.ps1')

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

/** Envia um texto pra impressora do Windows. `cols` (nº de colunas do recibo) dimensiona
 * a fonte pra preencher o papel — menos colunas = fonte maior. */
async function imprimirTexto(nomeImpressora, texto, copias = 1, cols, logoPath) {
  const tmpFile = path.join(os.tmpdir(), `menuzia-recibo-${Date.now()}.txt`)
  fs.writeFileSync(tmpFile, texto, 'utf-8')
  try {
    const args = ['-File', PRINT_SCRIPT, '-FilePath', tmpFile, '-PrinterName', nomeImpressora, '-Copies', String(copias)]
    if (cols && cols > 0) args.push('-Cols', String(cols))
    if (logoPath) args.push('-LogoPath', logoPath)
    await runPowershell(args)
  } finally {
    fs.unlink(tmpFile, () => {})
  }
}

module.exports = { listarImpressorasWindows, imprimirTexto }
