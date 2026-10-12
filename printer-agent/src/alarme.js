/**
 * Alarme de pedido novo (Alfa 1 1.2.0, 12/10/2026): um alarme só na loja. Quando este computador é o dono da Cozinha, o
 * servidor manda na MESMA consulta de pedidos quantos esperam aceite (`alarme.aguardando`) e os números. O painel fica
 * mudo enquanto este Assistente está online. Nenhuma chamada de rede nova: o som vem do instalador (renderer/alarme.mp3).
 *
 * 1.2.1 (pedido do dono): cada pedido novo toca UMA vez, por N s (5/8/15, padrão 8), e para sozinho — sem repetir e sem
 * precisar aceitar. Vale igual com aceite automático ou manual. Vários pedidos juntos = um toque só para o lote; pedido
 * chegando com o som ainda tocando recomeça a contagem do mesmo toque (nunca dois sons por cima).
 */
'use strict'
const path = require('path')

const DURACOES = [5, 8, 15]
const DURACAO_PADRAO = 8
const duracaoValida = (s) => (DURACOES.includes(Number(s)) ? Number(s) : DURACAO_PADRAO)

function decidirAlarme(estado, alarme, agora) {
  // Puro (testado): o que fazer com a resposta do servidor. Só pedido que este computador ainda não viu toca.
  if (!alarme || typeof alarme.aguardando !== 'number' || alarme.aguardando < 0) return { ...estado, tocar: false, sabido: 0, okEm: agora, novos: [] }
  const numeros = Array.isArray(alarme.numeros) ? alarme.numeros.filter((n) => Number.isInteger(n)) : []
  const novos = numeros.filter((n) => !estado.avisados.includes(n))
  // Mais de 10 esperando (a lista vem cortada): a contagem subiu também é pedido novo.
  const tocar = novos.length > 0 || alarme.aguardando > estado.sabido
  return { tocar, sabido: Math.min(999, alarme.aguardando), okEm: agora, avisados: numeros, novos }
}

function criarAlarme({ volume, duracao = () => DURACAO_PADRAO, registrar = () => {} }) {
  const { BrowserWindow, Notification } = require('electron')
  let janela = null
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
  const tocarUmaVez = () => executar(`tocar(${volume()}, ${duracaoValida(duracao())})`)

  return {
    /** Contagem que este computador já conhece (vai na consulta: o servidor devolve na hora se ela mudar). */
    sabido: () => estado.sabido,
    /** Resposta do servidor (dono da Cozinha manda `alarme`; os outros, nada → sem som). */
    atualizar(alarme) {
      estado = decidirAlarme(estado, alarme, Date.now())
      if (!estado.tocar) return
      registrar(`Alarme tocando (${duracaoValida(duracao())} s): pedido novo ${estado.novos.length ? `#${estado.novos.join(', #')}` : `(${estado.sabido} esperando)`}`)
      void tocarUmaVez()
      if (estado.novos.length && Notification.isSupported()) {
        try { new Notification({ title: 'Pedido novo!', body: `Pedido #${estado.novos.join(', #')} esperando aceite`, silent: true }).show() } catch { /* sem notificação */ }
      }
    },
    testar: () => tocarUmaVez(),
    /** Volume mudou: aplica já, se estiver tocando. */
    reaplicarVolume: () => executar(`volume(${volume()})`),
  }
}

module.exports = { criarAlarme, decidirAlarme, duracaoValida, DURACOES, DURACAO_PADRAO }
