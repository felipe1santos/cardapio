/**
 * IDs de medição da loja (Integrações): Facebook/Meta Pixel e Google Tag.
 * Validação ANTES de salvar; um ID antigo que não passa continua salvo (e aparece com
 * "ID parece inválido" para a loja corrigir) — nunca some sozinho.
 */

export type ResultadoId = { ok: true; valor: string } | { ok: false; erro: string }

/** Meta Pixel: só números, 15 ou 16 dígitos (espaços são tirados). */
export function validarPixelFacebook(bruto: string): ResultadoId {
  const valor = String(bruto ?? '').replace(/\s+/g, '')
  if (!valor) return { ok: false, erro: 'Digite o Pixel ID.' }
  if (!/^\d+$/.test(valor)) return { ok: false, erro: 'O Pixel ID tem só números.' }
  if (valor.length < 15 || valor.length > 16) return { ok: false, erro: `O Pixel ID tem 15 ou 16 dígitos (este tem ${valor.length}).` }
  return { ok: true, valor }
}

/** Google Tag: GA4 "G-XXXXXXXXXX" ou Tag Manager "GTM-XXXXXXX", em maiúsculas e sem espaços. */
export function validarGoogleTag(bruto: string): ResultadoId {
  const valor = String(bruto ?? '').replace(/\s+/g, '').toUpperCase()
  if (!valor) return { ok: false, erro: 'Digite o Tag ID.' }
  if (/^G-[A-Z0-9]{6,12}$/.test(valor) || /^GTM-[A-Z0-9]{4,10}$/.test(valor)) return { ok: true, valor }
  return { ok: false, erro: 'Use o ID do GA4 (G-XXXXXXXXXX) ou do Tag Manager (GTM-XXXXXXX).' }
}
