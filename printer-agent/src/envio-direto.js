// ─────────────────────────────────────────────────────────────────────────────
// ENVIO DIRETO pela REDE (Assistente Beta 0.2.0-beta.7): bytes ESC/POS para IP:porta
// (padrão 9100, "RAW"/JetDirect — o que as térmicas com LAN aceitam), sem o Windows no
// meio. Só abre, escreve, fecha. Com prazo: impressora desligada não trava a fila.
// Pausa entre blocos: padrão ZERO (tudo de uma vez); só para impressora que engasga.
// ─────────────────────────────────────────────────────────────────────────────
const net = require('net')

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms))

function enviarRede(ip, porta, bytes, { prazoMs = 10_000, bloco = 0, pausaMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let terminou = false
    const fim = (erro) => {
      if (terminou) return
      terminou = true
      clearTimeout(t)
      socket.destroy()
      if (erro) reject(erro)
      else resolve({ bytes: bytes.length })
    }
    const socket = net.createConnection({ host: ip, port: Number(porta) || 9100 })
    socket.setNoDelay(true)
    const t = setTimeout(() => fim(new Error(`a impressora ${ip}:${porta} não respondeu em ${Math.round(prazoMs / 1000)} s`)), prazoMs)
    socket.on('error', (e) => fim(new Error(`rede ${ip}:${porta}: ${e.code || e.message}`)))
    socket.on('connect', async () => {
      try {
        if (bloco > 0 && pausaMs > 0) {
          for (let i = 0; i < bytes.length; i += bloco) {
            if (i > 0) await esperar(pausaMs)
            if (!socket.write(bytes.subarray(i, i + bloco))) await new Promise((ok) => socket.once('drain', ok))
          }
        } else if (!socket.write(bytes)) {
          await new Promise((ok) => socket.once('drain', ok))
        }
        // Tudo entregue ao sistema: fecha a escrita. A impressora costuma fechar do lado
        // dela; se não fechar, damos um respiro curto.
        socket.end(() => setTimeout(() => fim(null), 150))
      } catch (e) {
        fim(e)
      }
    })
    socket.on('close', () => fim(null))
  })
}

module.exports = { enviarRede }
