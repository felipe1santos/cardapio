const $apiBaseUrl = document.getElementById('apiBaseUrl')
const $token = document.getElementById('token')
const $impressoraWindows = document.getElementById('impressoraWindows')
const $impressoraCloud = document.getElementById('impressoraCloud')
const $status = document.getElementById('status')
const $statusPareamento = document.getElementById('statusPareamento')
const $log = document.getElementById('log')

function mostrarStatus(el, ok, mensagem) {
  el.textContent = mensagem
  el.className = ok ? 'ok' : 'erro'
}

async function carregarImpressoras(selecionada) {
  const lista = await window.agente.listarImpressorasWindows()
  $impressoraWindows.innerHTML = ''
  if (Array.isArray(lista)) {
    for (const nome of lista) {
      const opt = document.createElement('option')
      opt.value = nome
      opt.textContent = nome
      if (nome === selecionada) opt.selected = true
      $impressoraWindows.appendChild(opt)
    }
  }
}

async function carregarImpressorasCloud(selecionadaId) {
  $impressoraCloud.innerHTML = ''
  const apiBaseUrl = $apiBaseUrl.value.trim().replace(/\/$/, '')
  const token = $token.value.trim()
  if (!apiBaseUrl || !token) {
    const opt = document.createElement('option')
    opt.textContent = 'Preencha URL e token primeiro'
    $impressoraCloud.appendChild(opt)
    return
  }
  const lista = await window.agente.buscarImpressorasCloud({ apiBaseUrl, token })
  if (!Array.isArray(lista) || lista.length === 0) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'Nenhuma cadastrada — vá em Ajustes > Impressão no painel'
    $impressoraCloud.appendChild(opt)
    return
  }
  for (const imp of lista) {
    const opt = document.createElement('option')
    opt.value = imp.id
    opt.textContent = `${imp.nome} (largura ${imp.largura}, ${imp.copias}x cópia${imp.copias > 1 ? 's' : ''})`
    if (imp.id === selecionadaId) opt.selected = true
    $impressoraCloud.appendChild(opt)
  }
}

async function init() {
  const config = await window.agente.carregarConfig()
  $apiBaseUrl.value = config.apiBaseUrl || ''
  $token.value = config.token || ''
  await carregarImpressoras(config.impressoraWindows)
  if (config.apiBaseUrl && config.token) await carregarImpressorasCloud(config.impressoraCloudId)
}

document.getElementById('atualizarImpressoras').addEventListener('click', () => carregarImpressoras($impressoraWindows.value))

document.getElementById('testarPareamento').addEventListener('click', async () => {
  const r = await window.agente.testarPareamento({ apiBaseUrl: $apiBaseUrl.value.trim(), token: $token.value.trim() })
  mostrarStatus($statusPareamento, r.ok, r.ok ? 'Conexão ok!' : `Falhou: ${r.erro}`)
  if (r.ok) await carregarImpressorasCloud()
})

document.getElementById('salvar').addEventListener('click', async () => {
  await window.agente.salvarConfig({
    apiBaseUrl: $apiBaseUrl.value.trim().replace(/\/$/, ''),
    token: $token.value.trim(),
    impressoraWindows: $impressoraWindows.value,
    impressoraCloudId: $impressoraCloud.value,
  })
  mostrarStatus($status, true, 'Configuração salva.')
})

document.getElementById('testarImpressora').addEventListener('click', async () => {
  const r = await window.agente.testarImpressora({ impressoraWindows: $impressoraWindows.value })
  mostrarStatus($status, r.ok, r.ok ? 'Teste enviado pra impressora.' : `Falhou: ${r.erro}`)
})

window.agente.onLog(({ ts, mensagem }) => {
  const linha = document.createElement('div')
  linha.textContent = `[${new Date(ts).toLocaleTimeString()}] ${mensagem}`
  $log.appendChild(linha)
  $log.scrollTop = $log.scrollHeight
})

init()
