const $token = document.getElementById('token')
const $status = document.getElementById('status')
const $statusWindows = document.getElementById('statusWindows')
const $statusPareamento = document.getElementById('statusPareamento')
const $cardImpressora = document.getElementById('cardImpressora')
const $log = document.getElementById('log')

let conectado = false

/**
 * Dropdown custom (substitui o <select> nativo). Dá padding generoso, hover amarelo
 * com texto preto e destaca a opção selecionada — o que o <option> nativo do Chromium
 * não permite estilizar de forma confiável.
 */
function criarDropdown(container, { placeholder }) {
  let opcoes = []
  let valor = ''
  let aberto = false

  const field = document.createElement('div')
  field.className = 'dd-field'
  const valueEl = document.createElement('span')
  valueEl.className = 'dd-value placeholder'
  valueEl.textContent = placeholder
  const caret = document.createElement('span')
  caret.className = 'dd-caret'
  caret.textContent = '▼'
  field.append(valueEl, caret)

  const menu = document.createElement('div')
  menu.className = 'dd-menu'

  container.append(field, menu)

  function rotuloDe(v) {
    const o = opcoes.find((x) => x.value === v)
    return o ? o.label : ''
  }

  function pintarValor() {
    const rotulo = rotuloDe(valor)
    if (rotulo) {
      valueEl.textContent = rotulo
      valueEl.classList.remove('placeholder')
    } else {
      valueEl.textContent = placeholder
      valueEl.classList.add('placeholder')
    }
  }

  function fechar() {
    aberto = false
    container.classList.remove('open')
  }

  function abrir() {
    if (opcoes.length === 0) return
    aberto = true
    container.classList.add('open')
  }

  function montarMenu() {
    menu.innerHTML = ''
    if (opcoes.length === 0) {
      const vazio = document.createElement('div')
      vazio.className = 'dd-empty'
      vazio.textContent = placeholder
      menu.appendChild(vazio)
      return
    }
    for (const o of opcoes) {
      const opt = document.createElement('div')
      opt.className = 'dd-opt' + (o.value === valor ? ' selected' : '')
      opt.textContent = o.label
      opt.addEventListener('click', () => {
        valor = o.value
        pintarValor()
        montarMenu()
        fechar()
      })
      menu.appendChild(opt)
    }
  }

  field.addEventListener('click', () => (aberto ? fechar() : abrir()))
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) fechar()
  })

  return {
    setOpcoes(lista, selecionado) {
      opcoes = lista || []
      // Mantém a seleção se ainda existir; senão pega a passada; senão a primeira.
      if (selecionado !== undefined && opcoes.some((o) => o.value === selecionado)) valor = selecionado
      else if (!opcoes.some((o) => o.value === valor)) valor = opcoes[0] ? opcoes[0].value : ''
      pintarValor()
      montarMenu()
    },
    valor: () => valor,
  }
}

const ddWindows = criarDropdown(document.getElementById('ddImpressoraWindows'), {
  placeholder: 'Nenhuma impressora encontrada',
})
const ddCloud = criarDropdown(document.getElementById('ddImpressoraCloud'), {
  placeholder: 'Nenhuma cadastrada — vá em Ajustes > Impressão no painel',
})

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
  if (!r || r.ok === false) {
    ddWindows.setOpcoes([])
    mostrarStatus($statusWindows, false, `Não foi possível ler as impressoras do Windows: ${r?.erro || 'erro desconhecido'}`)
    return
  }
  const lista = r.lista || []
  if (lista.length === 0) {
    ddWindows.setOpcoes([])
    mostrarStatus($statusWindows, false, 'Nenhuma impressora encontrada. Instale a impressora no Windows e clique em "Atualizar lista".')
    return
  }
  ddWindows.setOpcoes(lista.map((nome) => ({ value: nome, label: nome })), selecionada)
  mostrarStatus($statusWindows, true, '')
}

async function carregarImpressorasCloud(selecionadaId) {
  const token = $token.value.trim()
  const lista = await window.agente.buscarImpressorasCloud(token)
  if (lista && lista.erro) {
    ddCloud.setOpcoes([])
    return
  }
  if (!Array.isArray(lista) || lista.length === 0) {
    ddCloud.setOpcoes([])
    return
  }
  ddCloud.setOpcoes(
    lista.map((imp) => ({
      value: imp.id,
      label: `${imp.nome} (largura ${imp.largura}, ${imp.copias}x cópia${imp.copias > 1 ? 's' : ''})`,
    })),
    selecionadaId,
  )
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
  await carregarImpressoras(ddWindows.valor())
  if (conectado) await carregarImpressorasCloud(ddCloud.valor())
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
    impressoraWindows: ddWindows.valor(),
    impressoraCloudId: ddCloud.valor(),
  })
  mostrarStatus($status, true, 'Configuração salva.')
})

document.getElementById('testarImpressora').addEventListener('click', async () => {
  if (!conectado) return
  const r = await window.agente.testarImpressora({ impressoraWindows: ddWindows.valor() })
  mostrarStatus($status, r.ok, r.ok ? 'Teste enviado pra impressora.' : `Falhou: ${r.erro}`)
})

window.agente.onLog(({ ts, mensagem }) => {
  const linha = document.createElement('div')
  linha.textContent = `[${new Date(ts).toLocaleTimeString()}] ${mensagem}`
  $log.appendChild(linha)
  $log.scrollTop = $log.scrollHeight
})

init()
