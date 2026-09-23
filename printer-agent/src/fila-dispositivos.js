// ─────────────────────────────────────────────────────────────────────────────
// Filas independentes por impressora (0.1.26).
//
// Cada impressora do Windows tem a sua fila: uma impressora lenta, sem papel ou
// travada segura só os trabalhos DELA — a do caixa parada não para a cozinha.
// Um trabalho só é impresso se ainda estiver no prazo (o servidor manda os segundos
// restantes; o relógio do computador não entra na conta).
// ─────────────────────────────────────────────────────────────────────────────

class FilasPorDispositivo {
  /**
   * @param {(trabalho) => Promise<void>} imprimir  lança erro se o Windows recusar
   * @param {(id, ok, erro) => Promise<void>} informar  resultado para o servidor
   */
  constructor(imprimir, informar, agora = () => Date.now()) {
    this.imprimir = imprimir
    this.informar = informar
    this.agora = agora
    this.filas = new Map() // nomeSistema -> Promise (cauda da fila)
    this.emAndamento = new Set() // ids já aceitos nesta execução
  }

  /** Entrega trabalhos reservados. Não espera: cada fila anda no seu ritmo. */
  receber(trabalhos) {
    const recebidoEm = this.agora()
    for (const t of trabalhos) {
      if (this.emAndamento.has(t.id)) continue
      this.emAndamento.add(t.id)
      const prazo = recebidoEm + Math.max(0, Number(t.segundosRestantes) || 0) * 1000
      const cauda = this.filas.get(t.nomeSistema) ?? Promise.resolve()
      const proxima = cauda.then(() => this.processar(t, prazo)).catch(() => {})
      this.filas.set(t.nomeSistema, proxima)
    }
  }

  async processar(t, prazo) {
    try {
      if (this.agora() >= prazo) {
        await this.informar(t.id, false, 'vencido antes de imprimir (não impresso)')
        return
      }
      await this.imprimir(t)
      await this.informar(t.id, true, null)
    } catch (err) {
      await this.informar(t.id, false, (err && err.message) || String(err)).catch(() => {})
    } finally {
      this.emAndamento.delete(t.id)
    }
  }

  /** Para testes e para o encerramento: espera todas as filas esvaziarem. */
  async esvaziar() {
    await Promise.all([...this.filas.values()])
  }
}

module.exports = { FilasPorDispositivo }
