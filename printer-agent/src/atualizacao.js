'use strict'

/**
 * Atualização automática do Assistente Beta (0.2.0-beta.11, item 60).
 *
 * O servidor da Menuzia diz qual é a versão atual (GET <api>/api/agente/atualizacao/latest.yml,
 * formato do electron-updater; o instalador mora no release do GitHub). O Assistente:
 *   1. pergunta 2 min depois de abrir e depois a cada hora;
 *   2. baixa a versão nova em segundo plano (confere o SHA-512 antes de usar);
 *   3. só instala quando está PARADO (nenhuma impressão nos últimos 10 min e nada sendo impresso)
 *      e FORA DO PICO (03:00–10:30 ou 14:30–17:00, hora do computador). O instalador roda em
 *      silêncio por cima e abre o Assistente de novo, já conectado (os dados ficam em %APPDATA%).
 * Nada disso para a impressão: se não der para instalar agora, tenta no próximo minuto livre.
 *
 * Testes: MENUZIA_ATUALIZACAO_URL troca o endereço; MENUZIA_ATUALIZACAO_SEMPRE=1 ignora o horário.
 */

const JANELAS = [
  [3 * 60, 10 * 60 + 30], // madrugada e manhã, antes do almoço
  [14 * 60 + 30, 17 * 60], // tarde, entre o almoço e o jantar
]
const PARADO_MS = 10 * 60_000

/** Pode instalar agora? Fora do pico e com o Assistente parado. Pura (testada). */
function podeInstalar({ agora, ultimaAtividadeEm, imprimindo, sempre = false }) {
  if (imprimindo) return false
  if (ultimaAtividadeEm && agora.getTime() - ultimaAtividadeEm < PARADO_MS) return false
  if (sempre) return true
  const m = agora.getHours() * 60 + agora.getMinutes()
  return JANELAS.some(([ini, fim]) => m >= ini && m < fim)
}

/**
 * Liga a atualização automática. `estado()` devolve { imprimindo, ultimaAtividadeEm }.
 * Devolve uma função que diz em que pé está (para a janela e para o servidor).
 */
function iniciarAtualizacao({ baseUrl, versaoAtual, estado, log, env = process.env }) {
  let situacao = { fase: 'parado', versao: null }
  let autoUpdater
  try {
    ;({ autoUpdater } = require('electron-updater'))
  } catch (e) {
    log(`Atualização automática indisponível: ${e?.message || e}`)
    return () => situacao
  }
  const url = env.MENUZIA_ATUALIZACAO_URL || `${baseUrl}/api/agente/atualizacao`
  const sempre = env.MENUZIA_ATUALIZACAO_SEMPRE === '1'
  autoUpdater.setFeedURL({ provider: 'generic', url })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.logger = { info: (m) => log(`ATUALIZACAO: ${m}`), warn: (m) => log(`ATUALIZACAO aviso: ${m}`), error: (m) => log(`ATUALIZACAO erro: ${m}`), debug: () => {} }

  autoUpdater.on('update-available', (i) => { situacao = { fase: 'baixando', versao: i.version }; log(`Versão nova ${i.version} encontrada — baixando em segundo plano (a impressão continua).`) })
  autoUpdater.on('update-not-available', () => { if (situacao.fase !== 'baixada') situacao = { fase: 'atual', versao: versaoAtual } })
  autoUpdater.on('update-downloaded', (i) => { situacao = { fase: 'baixada', versao: i.version }; log(`Versão ${i.version} baixada. Instala sozinha fora do horário de pico, com o Assistente parado.`) })
  autoUpdater.on('error', (e) => { if (situacao.fase === 'baixando') situacao = { fase: 'parado', versao: null }; log(`ATUALIZACAO: ${String(e?.message || e).slice(0, 200)}`) })

  const verificar = () => { autoUpdater.checkForUpdates().catch(() => {}) }
  setTimeout(verificar, Number(env.MENUZIA_ATUALIZACAO_PRIMEIRA_MS || 2 * 60_000))
  setInterval(verificar, 60 * 60_000)

  let instalando = false
  setInterval(() => {
    if (instalando || situacao.fase !== 'baixada') return
    const e = estado()
    if (!podeInstalar({ agora: new Date(), ultimaAtividadeEm: e.ultimaAtividadeEm, imprimindo: e.imprimindo, sempre })) return
    instalando = true
    situacao = { ...situacao, fase: 'instalando' }
    log(`Instalando a versão ${situacao.versao}. O Assistente fecha e abre de novo sozinho em alguns segundos.`)
    try { autoUpdater.quitAndInstall(true, true) } catch (err) { instalando = false; situacao = { ...situacao, fase: 'baixada' }; log(`ATUALIZACAO: não instalou (${err?.message || err})`) }
  }, Number(env.MENUZIA_ATUALIZACAO_CONFERIR_MS || 60_000))

  return () => situacao
}

module.exports = { podeInstalar, iniciarAtualizacao, JANELAS, PARADO_MS }
