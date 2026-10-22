import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * 99Food — protocolo próprio (22/10/2026; docs em developer-food.99app.com › 99Food Protocol). Peças puras:
 *  - IDs de app, loja e pedido são inteiros de 64 bits: JSON.parse arredonda (5764607801871631353 → …1000). Aqui todo
 *    inteiro com 16+ dígitos FORA de texto vira string antes do parse.
 *  - Webhook: cabeçalho `didi-header-sign` = MD5(corpo cru + app_secret).
 *  - Chamadas assinadas: parâmetros não vazios em ordem alfabética, "k=v" unidos por "&", app_secret no fim, MD5.
 */

/** JSON.parse que preserva inteiros grandes como string. Lança se o texto não for JSON. */
export function lerJsonComIdsGrandes(texto: string): unknown {
  let saida = ''
  let emTexto = false
  let escapado = false
  let i = 0
  while (i < texto.length) {
    const ch = texto[i]
    if (emTexto) {
      saida += ch
      if (escapado) escapado = false
      else if (ch === '\\') escapado = true
      else if (ch === '"') emTexto = false
      i++
      continue
    }
    if (ch === '"') { emTexto = true; saida += ch; i++; continue }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1
      while (j < texto.length && /[0-9.eE+-]/.test(texto[j])) j++
      const numero = texto.slice(i, j)
      saida += /^-?\d{16,}$/.test(numero) ? `"${numero}"` : numero
      i = j
      continue
    }
    saida += ch
    i++
  }
  return JSON.parse(saida)
}

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')

/** Webhook veio mesmo da 99Food? Sem segredo ou sem cabeçalho → não. */
export function assinaturaWebhook99Valida(corpoCru: string, cabecalho: string | null | undefined, appSecret: string): boolean {
  if (!cabecalho || !appSecret) return false
  const esperado = Buffer.from(md5(corpoCru + appSecret), 'utf8')
  const recebido = Buffer.from(cabecalho.trim().toLowerCase(), 'utf8')
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido)
}

/** Assinatura das chamadas que a pedem (parâmetros vazios/nulos ficam de fora). */
export function assinarParametros99(params: Record<string, unknown>, appSecret: string): string {
  const pares = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${typeof params[k] === 'object' ? 'Array' : String(params[k])}`)
  return md5(pares.join('&') + appSecret)
}
