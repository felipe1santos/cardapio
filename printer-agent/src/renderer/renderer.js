const $token = document.getElementById('token')
const $impressoraWindows = document.getElementById('impressoraWindows')
const $impressoraCloud = document.getElementById('impressoraCloud')
const $status = document.getElementById('status')
const $statusWindows = document.getElementById('statusWindows')
const $statusPareamento = document.getElementById('statusPareamento')
const $cardImpressora = document.getElementById('cardImpressora')
const $log = document.getElementById('log')

let conectado = false

function mostrarStatus(el, ok, mensagem) {
  el.textContent = mensagem
  el.className = mensagem ? `feedback ${ok ? 'ok' : 'erro'}` : ''
}

/** Libera (ou trava) o Passo 2 conforme a conexão. */
function definirConectado(ok) {
  conectado = ok
  $cardImpressora.classList.toggle('locked', !ok)
}

async function carregarImpressoras(selecionada) {
  const r = await window.agente.listarImpressorasWindows()
  $impressoraWindows.innerHTML = ''
  if (!r || r.ok === false) {
    mostrarStatus($statusWindows, false, `Não foi possível ler as impressoras do Windows: ${r?.erro || 'erro desconhecido'}`)
    return
  }
  const lista = r.lista || []
  if (lista.length === 0) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'Nenhuma impressora instalada no Windows'
    $impressoraWindows.appendChild(opt)
    mostrarStatus($statusWindows, false, 'Nenhuma impressora encontrada. Instale a impressora no Windows e clique em "Atualizar lista".')
    return
  }
  for (const nome of lista) {
    const opt = document.createElement('option')
    opt.value = nome
    opt.textContent = nome
    if (nome === selecionada) opt.selected = true
    $impressoraWindows.appendChild(opt)
  }
  mostrarStatus($statusWindows, true, '')
}

async function carregarImpressorasCloud(selecionadaId) {
  $impressoraCloud.innerHTML = ''
  const token = $token.value.trim()
  const lista = await window.agente.buscarImpressorasCloud(token)
  if (lista && lista.erro) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = `Erro ao buscar: ${lista.erro}`
    $impressoraCloud.appendChild(opt)
    return
  }
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

/** Após conexão ok, carrega as duas listas e libera o Passo 2. */
async function aposConectar(config) {
  definirConectado(true)
  await carregarImpressoras(config?.impressoraWindows)
  await carregarImpressorasCloud(config?.impressoraCloudId)
}

async function init() {
  const config = await window.agente.carregarConfig()
  $token.value = config.token || ''
  // Se já tem token salvo, testa sozinho e libera o Passo 2 se conectar.
  if (config.token) {
    const r = await window.agente.testarPareamento(config.token)
    mostrarStatus($statusPareamento, r.ok, r.ok ? 'Conexão ok!' : `Falhou: ${r.erro}`)
    if (r.ok) await aposConectar(config)
  }
}

// "Atualizar lista" recarrega tanto as impressoras do Windows quanto as cadastradas no
// painel — assim, depois de cadastrar uma impressora nova no painel, ela aparece aqui
// sem precisar refazer o teste de conexão.
document.getElementById('atualizarImpressoras').addEventListener('click', async () => {
  await carregarImpressoras($impressoraWindows.value)
  if (conectado) await carregarImpressorasCloud($impressoraCloud.value)
})

document.getElementById('testarPareamento').addEventListener('click', async () => {
  const token = $token.value.trim()
  const r = await window.agente.testarPareamento(token)
  mostrarStatus($statusPareamento, r.ok, r.ok ? 'Conexão ok! Agora configure a impressora abaixo.' : `Falhou: ${r.erro}`)
  if (r.ok) {
    // Salva o token já validado e libera o Passo 2.
    const config = await window.agente.salvarConfig({ token })
    await aposConectar(config)
  } else {
    definirConectado(false)
  }
})

document.getElementById('salvar').addEventListener('click', async () => {
  if (!conectado) return
  await window.agente.salvarConfig({
    token: $token.value.trim(),
    impressoraWindows: $impressoraWindows.value,
    impressoraCloudId: $impressoraCloud.value,
  })
  mostrarStatus($status, true, 'Configuração salva.')
})

document.getElementById('testarImpressora').addEventListener('click', async () => {
  if (!conectado) return
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
