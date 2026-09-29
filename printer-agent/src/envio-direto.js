// ─────────────────────────────────────────────────────────────────────────────
// ENVIO DIRETO pela REDE (Assistente Beta 0.2.0-beta.7): bytes ESC/POS para IP:porta
// (padrão 9100, "RAW"/JetDirect — o que as térmicas com LAN aceitam), sem o Windows no
// meio. Só abre, escreve, fecha. Com prazo: impressora desligada não trava a fila.
// ─────────────────────────────────────────────────────────────────────────────
const net = require('net')

function enviarRede(ip, porta, bytes, { prazoMs = 10_000 } = {}) {
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
    const t = setTimeout(() => fim(new Error(`a impressora ${ip}:${porta} não respondeu em ${Math.round(prazoMs / 1000)} s`)), prazoMs)
    socket.on('error', (e) => fim(new Error(`rede ${ip}:${porta}: ${e.code || e.message}`)))
    socket.on('connect', () => {
      socket.end(bytes, () => {
        // A impressora costuma fechar do lado dela; se não fechar, damos um respiro.
        setTimeout(() => fim(null), 300)
      })
    })
    socket.on('close', () => fim(null))
  })
}

module.exports = { enviarRede }
