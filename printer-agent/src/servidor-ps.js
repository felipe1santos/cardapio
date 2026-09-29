// ─────────────────────────────────────────────────────────────────────────────
// SERVIDOR DE IMPRESSÃO residente (Assistente Beta 0.2.0-beta.7).
//
// Antes: cada impressão abria um PowerShell novo (~0,2 s), carregava o System.Drawing,
// perguntava ao Windows pela impressora com Get-Printer (~0,35 s) e, no envio RAW,
// compilava o C# do spooler (~0,4 s). Agora UM PowerShell por impressora fica aberto
// (servidor-impressao.ps1) com tudo pronto, e recebe os pedidos por linha JSON.
//   • um processo por impressora: impressora lenta não segura a outra;
//   • pedidos em fila, com prazo; travou → fecha o processo e avisa (quem chama cai no
//     caminho antigo, um PowerShell por impressão);
//   • fecha sozinho depois de 20 min sem imprimir (PC fraco: não fica ocupando memória).
// ─────────────────────────────────────────────────────────────────────────────
const { spawn } = require('child_process')
const readline = require('readline')

const OCIOSO_MS = 20 * 60_000
const PRAZO_PRONTO_MS = 20_000
const PRAZO_PEDIDO_MS = 60_000

/**
 * Erro do servidor de impressão. `antesDeEnviar` = a impressão NÃO chegou a ser entregue a
 * ele (não subiu, não ficou pronto): quem chama pode tentar pelo caminho antigo. Depois de
 * entregue (prazo estourado, processo caiu no meio), NUNCA repetir aqui — o papel pode ter
 * saído; vira erro normal e o servidor decide a nova tentativa, como sempre.
 */
class ErroDoServidor extends Error {
  constructor(msg, antesDeEnviar = false) { super(msg); this.doServidor = true; this.antesDeEnviar = antesDeEnviar }
}

class ServidorImpressao {
  constructor(script, { logNome, ociosoMs = OCIOSO_MS, prazoMs = PRAZO_PEDIDO_MS, executavel = 'powershell.exe' } = {}) {
    this.script = script
    this.logNome = logNome
    this.ociosoMs = ociosoMs
    this.prazoMs = prazoMs
    this.executavel = executavel
    this.proc = null
    this.pronto = null
    this.espera = new Map()
    this.seq = 0
    this.fila = Promise.resolve()
    this.timerOcioso = null
  }

  get vivo() { return !!this.proc && this.proc.exitCode === null && !this.proc.killed }

  /** Sobe o processo (se preciso) e espera ele avisar que está pronto. */
  garantir() {
    if (this.vivo && this.pronto) return this.pronto
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script]
    if (this.logNome) args.push('-LogNome', this.logNome)
    const proc = spawn(this.executavel, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    const rl = readline.createInterface({ input: proc.stdout })
    this.pronto = new Promise((resolve, reject) => {
      const t = setTimeout(() => { reject(new ErroDoServidor('servidor de impressão não ficou pronto', true)); this.fechar() }, PRAZO_PRONTO_MS)
      rl.on('line', (l) => {
        if (l === 'MENUZIA-PRONTO') { clearTimeout(t); resolve() ; return }
        if (!l.startsWith('MENUZIA-RESP:')) return
        let r
        try { r = JSON.parse(l.slice('MENUZIA-RESP:'.length)) } catch { return }
        const p = this.espera.get(String(r.id))
        if (p) { this.espera.delete(String(r.id)); p.resolve(r) }
      })
      proc.on('error', (e) => { clearTimeout(t); reject(new ErroDoServidor(e.message, true)) })
    })
    this.pronto.catch(() => {})
    let erroTexto = ''
    proc.stderr.on('data', (d) => { erroTexto = (erroTexto + d).slice(-500) })
    proc.on('exit', () => {
      for (const p of this.espera.values()) p.reject(new ErroDoServidor(`servidor de impressão saiu ${erroTexto ? `(${erroTexto.trim()})` : ''}`))
      this.espera.clear()
      if (this.proc === proc) { this.proc = null; this.pronto = null }
    })
    return this.pronto
  }

  /** Um pedido (acao imagem | raw | texto | ping). Em fila: um de cada vez neste processo. */
  pedir(pedido) {
    const vez = this.fila.then(() => this._pedir(pedido))
    this.fila = vez.catch(() => {})
    return vez
  }

  async _pedir(pedido) {
    clearTimeout(this.timerOcioso)
    await this.garantir()
    if (!this.vivo) throw new ErroDoServidor('servidor de impressão fechou antes do pedido', true)
    const id = String(++this.seq)
    const resposta = new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.espera.delete(id)
        reject(new ErroDoServidor('a impressão passou de 60 s sem resposta do Windows'))
        this.fechar()
      }, this.prazoMs)
      this.espera.set(id, { resolve: (r) => { clearTimeout(t); resolve(r) }, reject: (e) => { clearTimeout(t); reject(e) } })
    })
    this.proc.stdin.write(JSON.stringify({ ...pedido, id }) + '\n')
    const r = await resposta
    this.timerOcioso = setTimeout(() => this.fechar(), this.ociosoMs)
    if (this.timerOcioso.unref) this.timerOcioso.unref()
    return r
  }

  fechar() {
    clearTimeout(this.timerOcioso)
    const p = this.proc
    this.proc = null
    this.pronto = null
    if (p && p.exitCode === null) { try { p.stdin.end() } catch { /* já fechou */ } setTimeout(() => { if (p.exitCode === null) p.kill() }, 1500).unref?.() }
  }
}

/** Um servidor por impressora (no máximo 4; os mais antigos fecham). */
class PoolServidores {
  constructor(script, opcoes = {}) { this.script = script; this.opcoes = opcoes; this.mapa = new Map() }
  de(impressora) {
    let s = this.mapa.get(impressora)
    if (!s) {
      if (this.mapa.size >= 4) { const [velho, sv] = this.mapa.entries().next().value; sv.fechar(); this.mapa.delete(velho) }
      s = new ServidorImpressao(this.script, this.opcoes)
      this.mapa.set(impressora, s)
    }
    return s
  }
  fecharTodos() { for (const s of this.mapa.values()) s.fechar(); this.mapa.clear() }
}

module.exports = { ServidorImpressao, PoolServidores, ErroDoServidor }
