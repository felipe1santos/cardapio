// ─────────────────────────────────────────────────────────────────────────────
// PAREAMENTO SEM CÓDIGO (Assistente Beta 0.2.0-beta.10). O convite (24 caracteres, 24 h, uso
// único) chega de dois jeitos, sem ninguém digitar:
//   · link do painel: menuzia://parear?c=<convite> (o Windows abre o Assistente com o link);
//   · nome do instalador baixado pelo painel: AssistenteMenuziaBeta-Setup-<versão>-c<convite>.exe
//     — na primeira abertura sem pareamento, procura em Downloads o mais novo de até 24 h.
// O servidor é quem decide se o convite vale (usado/vencido = recusado).
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs')
const path = require('path')

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const VALIDADE_MS = 24 * 3_600_000
const ehConvite = (v) => typeof v === 'string' && v.length === 24 && [...v].every((c) => ALFABETO.includes(c))

/** menuzia://parear?c=XXXX → XXXX (ou null). Aceita o link em qualquer posição do argv. */
function conviteDoLink(link) {
  const m = /^menuzia:\/\/parear\/?\?(?:.*&)?c=([A-Za-z0-9]+)/i.exec(String(link || '').trim())
  const c = m ? m[1].toUpperCase() : null
  return ehConvite(c) ? c : null
}
function conviteDosArgumentos(argv = []) {
  for (const a of argv) { const c = conviteDoLink(a); if (c) return c }
  return null
}

/** Nome do instalador → convite. O navegador pode acrescentar " (1)" antes do .exe. */
function conviteDoNomeArquivo(nome) {
  const m = /-c([A-Z0-9]{24})(?: ?\(\d+\))?\.exe$/i.exec(String(nome || ''))
  const c = m ? m[1].toUpperCase() : null
  return ehConvite(c) ? c : null
}

/** O convite do instalador mais novo (até 24 h) na pasta de Downloads, ou null. */
function conviteNosDownloads(pasta, agora = Date.now()) {
  let melhor = null
  let nomes = []
  try { nomes = fs.readdirSync(pasta) } catch { return null }
  for (const nome of nomes) {
    if (!/^AssistenteMenuzia(Beta|Alfa1)-Setup-/i.test(nome)) continue
    const c = conviteDoNomeArquivo(nome)
    if (!c) continue
    let em = 0
    try { em = fs.statSync(path.join(pasta, nome)).mtimeMs } catch { continue }
    if (agora - em > VALIDADE_MS) continue
    if (!melhor || em > melhor.em) melhor = { convite: c, em }
  }
  return melhor ? melhor.convite : null
}

module.exports = { conviteDoLink, conviteDosArgumentos, conviteDoNomeArquivo, conviteNosDownloads }
