// ─────────────────────────────────────────────────────────────────────────────
// ENVIO AUTOMÁTICO (Assistente Beta 0.2.0-beta.10, migration 0157). Regra pura: por qual
// caminho TENTAR a impressão quando a impressora está em "Automático".
//   · impressora virtual do Windows (PDF/XPS/Fax/OneNote) → driver (bytes ESC/POS viram lixo);
//   · com IP (rede) → direto pela rede, IP:9100;
//   · driver de térmica (POS-80, Generic/Text Only, Epson TM, Elgin, Bematech…) → direto pela
//     fila USB (RAW);
//   · qualquer outra → driver do Windows.
// Se o direto falhar, quem chama imprime pelo driver e lembra a falha por 10 min (a próxima
// comanda não espera o direto falhar de novo).
// ─────────────────────────────────────────────────────────────────────────────
const VIRTUAL = /^(fax|microsoft print to pdf|microsoft xps document writer|onenote.*|enviar para o onenote.*|send to onenote.*)$/i
const TERMICA = /(pos[-\s_]?\d{2}|\bpos\b|generic.*text|text only|somente texto|thermal|t[ée]rmica|receipt|\btm[-\s]?[a-z]?\d|epson tm|elgin|bematech|daruma|sweda|tanca|knup|jetway|xprinter|xp-\d|control ?id|diebold|gertec|zjiang|rongta|hprt|\b(58|80) ?mm\b)/i
const ESQUECER_FALHA_MS = 10 * 60_000

const ehIp = (v) => typeof v === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(v.trim())

function escolherEnvioAuto({ nomeSistema = '', redeIp = null, diagnostico = null, falhouEm = null, agora = Date.now() } = {}) {
  const nome = String(nomeSistema || '').trim()
  if (VIRTUAL.test(nome)) return { envio: 'driver', motivo: 'impressora virtual do Windows' }
  if (falhouEm && agora - falhouEm < ESQUECER_FALHA_MS) return { envio: 'driver', motivo: 'o envio direto falhou há pouco' }
  if (ehIp(redeIp)) return { envio: 'raw_rede', motivo: `impressora na rede (${redeIp.trim()})` }
  const driver = String(diagnostico?.driver || '')
  if (TERMICA.test(driver) || TERMICA.test(nome)) return { envio: 'raw_fila', motivo: driver ? `driver de térmica (${driver})` : 'impressora térmica' }
  return { envio: 'driver', motivo: driver ? `driver não é de térmica (${driver})` : 'driver desconhecido' }
}

module.exports = { escolherEnvioAuto, ESQUECER_FALHA_MS }
