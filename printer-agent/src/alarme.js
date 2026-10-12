/**
 * Alarme de pedido novo (Alfa 1 1.2.0, 12/10/2026): um alarme só na loja. Quando este computador é o dono da Cozinha, o
 * servidor manda na MESMA consulta de pedidos quantos esperam aceite (`alarme.aguardando`); com algum, o som toca em
 * repetição — por cima de tudo, mesmo com o navegador fechado — até aceitarem/recusarem. O painel fica mudo enquanto
 * este Assistente está online. Nenhuma chamada de rede nova: o som vem do instalador (renderer/alarme.mp3).
 */
'use strict'
const path = require('path')

/** Sem resposta do servidor por 60 s: para o som (o painel assume, porque o sinal deste computador some). */
const SEM_RESPOSTA_MS = 60_000

function decidirAlarme(estado, alarme, agora) {
  // Puro (testado): o que fazer com a resposta do servidor.
  if (!alarme || typeof alarme.aguardando !== 'number' || alarme.aguardando < 0) return { ...estado, tocar: false, sabido: 0, okEm: agora, novos: [] }
  const numeros = Array.isArray(alarme.numeros) ? alarme.numeros.filter((n) => Number.isInteger(n)) : []
  const novos = numeros.filter((n) => !estado.avisados.includes(n))
  return { tocar: alarme.aguardando > 0, sabido: Math.min(999, alarme.aguardando), okEm: agora, avisados: numeros, novos }
}

function criarAlarme({ volume, registrar = () => {} }) {
  const { BrowserWindow, Notification } = require('electron')
  let janela = null
  let tocando = false
  let estado = { tocar: false, sabido: 0, okEm: 0, avisados: [], novos: [] }

  function janelaAlarme() {
    if (janela && !janela.isDestroyed()) return janela
    janela = new BrowserWindow({
      show: false, width: 120, height: 80, skipTaskbar: true, focusable: false,
      webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', contextIsolation: true },
    })
    janela.loadFile(path.join(__dirname, 'renderer', 'alarme.html'))
    return janela
  }
  async function executar(js) {
    const w = janelaAlarme()
    if (w.webContents.isLoading()) await new Promise((ok) => w.webContents.once('did-finish-load', ok))
    return w.webContents.executeJavaScript(js).catch(() => false)
  }
  function tocar() { if (tocando) return; tocando = true; registrar(`Alarme tocando: pedido esperando aceite (${estado.sabido})`); void executar(`tocar(${volume()})`) }
  function parar() { if (!tocando) return; tocando = false; registrar('Alarme parado'); void executar('parar()') }

  // Rede caiu com o som tocando: no máximo 60 s (depois o painel toca, porque este computador some do ar).
  const vigia = setInterval(() => { if (tocando && Date.now() - estado.okEm > SEM_RESPOSTA_MS) parar() }, 5_000)
  if (vigia.unref) vigia.unref()

  return {
    /** Contagem que este computador já conhece (vai na consulta: o servidor devolve na hora se ela mudar). */
    sabido: () => estado.sabido,
    /** Resposta do servidor (dono da Cozinha manda `alarme`; os outros, nada → sem som). */
    atualizar(alarme) {
      estado = decidirAlarme(estado, alarme, Date.now())
      if (estado.tocar) tocar()
      else parar()
      if (estado.novos.length && Notification.isSupported()) {
        try { new Notification({ title: 'Pedido novo!', body: `Pedido #${estado.novos.join(', #')} esperando aceite`, silent: true }).show() } catch { /* sem notificação */ }
      }
    },
    testar: () => executar(`testar(${volume()})`),
    /** Volume mudou com o som tocando: aplica já. */
    reaplicarVolume: () => { if (tocando) { tocando = false; void executar('parar()').then(() => tocar()) } },
    parar,
  }
}

module.exports = { criarAlarme, decidirAlarme, SEM_RESPOSTA_MS }
