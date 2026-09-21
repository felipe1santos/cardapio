const fs = require('fs')
const path = require('path')
const { app } = require('electron')

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json')

// A URL do Menuzia é fixa para todas as lojas (multi-tenant por token) — não fica em config.
const DEFAULTS = {
  token: '',
  impressoraWindows: '',
  impressoraCloudId: '',
  intervaloSegundos: 5,
}

function carregarConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH(), 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

function salvarConfig(patch) {
  const atual = carregarConfig()
  const novo = { ...atual, ...patch }
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(novo, null, 2), 'utf-8')
  return novo
}

// ── Pedidos que já saíram no papel ──────────────────────────────────────────
//
// Imprimir e avisar o servidor são dois passos. Quando o papel sai e o aviso
// falha (internet caiu naquele segundo), o pedido volta na consulta 5s depois e
// era impresso DE NOVO — via já entregue na cozinha, duas comandas do mesmo
// pedido. Este arquivo é a memória local entre os dois passos: o id entra aqui
// assim que o papel sai, e o ciclo seguinte pula quem está na lista, tentando
// reavisar o servidor.
//
// Em disco, e não em memória, porque o agente é fechado e reaberto o tempo todo
// no balcão. Guarda no máximo os 200 últimos: o que passou disso já foi avisado
// há muito tempo, e o arquivo não pode crescer para sempre.

const IMPRESSOS_PATH = () => path.join(app.getPath('userData'), 'impressos.json')
const LIMITE_IMPRESSOS = 200

function carregarImpressos() {
  try {
    const lista = JSON.parse(fs.readFileSync(IMPRESSOS_PATH(), 'utf-8'))
    return Array.isArray(lista) ? lista.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

function marcarImpressoLocal(pedidoId) {
  const atual = carregarImpressos().filter((id) => id !== pedidoId)
  atual.push(pedidoId)
  const novo = atual.slice(-LIMITE_IMPRESSOS)
  try {
    fs.writeFileSync(IMPRESSOS_PATH(), JSON.stringify(novo), 'utf-8')
  } catch {
    // Disco cheio ou sem permissão: o pior caso volta a ser a reimpressão, que é
    // o comportamento antigo. Não vale derrubar o ciclo de impressão por isso.
  }
  return novo
}

function esquecerImpressoLocal(pedidoId) {
  try {
    fs.writeFileSync(IMPRESSOS_PATH(), JSON.stringify(carregarImpressos().filter((id) => id !== pedidoId)), 'utf-8')
  } catch {
    /* ver acima */
  }
}

module.exports = { carregarConfig, salvarConfig, carregarImpressos, marcarImpressoLocal, esquecerImpressoLocal }
