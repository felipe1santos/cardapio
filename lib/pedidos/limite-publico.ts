import { criarLimitador } from '@/lib/limite-taxa'

/**
 * Limite do POST do pedido da vitrine (28/10/2026, varredura Etapa 6; revisado na auditoria das travas).
 * Rota pública sem login: um robô em laço criaria pedidos falsos, tocaria o alarme e imprimiria fichas.
 *  · 15/min por IP DENTRO de cada loja — antes era por IP no sistema todo, e um IP de operadora (CGNAT) ou Wi-Fi
 *    compartilhado somava os pedidos de lojas diferentes;
 *  · 200/min por loja (bem acima de qualquer pico real).
 * Em memória do processo (o app roda em um container só): reiniciar zera; durante um deploy, 2 containers dobram o
 * limite por alguns segundos. O IP vem do proxy (Traefik reescreve o X-Forwarded-For — testado em 28/10).
 */
export function criarLimitePedidoPublico() {
  const porIp = criarLimitador({ max: 15, janelaMs: 60_000 })
  const porLoja = criarLimitador({ max: 200, janelaMs: 60_000 })
  return {
    permitir(ip: string, slug: string, agora = Date.now()): boolean {
      const chave = `${slug}|${ip}`
      if (porIp.excedeu(chave, agora) || porLoja.excedeu(slug, agora)) return false
      porIp.registrar(chave, agora)
      porLoja.registrar(slug, agora)
      return true
    },
  }
}
