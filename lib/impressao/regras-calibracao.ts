/**
 * Calibrar impressora (0109): como cada impressora recebe a impressão — regras puras,
 * usadas pelo servidor (validação) e pela tela (aviso do driver). Padrões = comportamento
 * de sempre: imagem pelo driver do Windows, intensidade normal.
 */

export type Intensidade = 'normal' | 'escura' | 'mais_escura'
export type Envio = 'driver' | 'raw_fila' | 'raw_rede' | 'auto'
/** Caminho que a impressão realmente usou (o "auto" vira um destes). */
export type CaminhoEnvio = 'driver' | 'raw_fila' | 'raw_rede'
export type ModoImpressao = 'imagem' | 'texto'

export interface PerfilEnvio {
  intensidade: Intensidade
  envio: Envio
  modoImpressao: ModoImpressao
  redeIp: string | null
  redePorta: number
}

export const COLUNAS_ENVIO = 'intensidade, envio, modo_impressao, rede_ip, rede_porta'
export const PERFIL_ENVIO_PADRAO: PerfilEnvio = { intensidade: 'normal', envio: 'driver', modoImpressao: 'imagem', redeIp: null, redePorta: 9100 }
export const LARGURAS_PONTOS = [384, 512, 576] as const

export const ROTULO_INTENSIDADE: Record<Intensidade, string> = { normal: 'Normal', escura: 'Escura', mais_escura: 'Mais escura' }
// Impressão v3: para impressora ESC/POS (a maioria das térmicas), o envio DIRETO é o
// recomendado — quem manda na largura e no preto e branco é o sistema, não o driver. O
// padrão gravado continua "driver" (comportamento de sempre); a tela recomenda o direto.
export const ROTULO_ENVIO: Record<Envio, string> = {
  // Automático (0157, Assistente 0.2.0-beta.10+): direto ESC/POS e, se falhar, o driver.
  auto: 'Automático — direto (ESC/POS) e, se falhar, pelo driver do Windows',
  raw_fila: 'Direto pela fila (USB, ESC/POS) — recomendado',
  raw_rede: 'Direto pela rede (IP:9100, ESC/POS) — recomendado',
  driver: 'Driver do Windows (alternativa)',
}
export const ROTULO_MODO: Record<ModoImpressao, string> = { imagem: 'Imagem (padrão)', texto: 'Texto (compatibilidade)' }

/** Envio direto para "Tentar envio direto": pela rede quando a impressora já tem IP; senão, pela fila (USB). */
export function envioDiretoSugerido(d: { redeIp?: string | null }): Envio {
  return d.redeIp && ehIpv4(d.redeIp) ? 'raw_rede' : 'raw_fila'
}

/**
 * Papel efetivo do driver, em mm, pelo que o Assistente leu: o papel declarado ou, sem ele,
 * os pontos imprimíveis (até ~400 pontos = 58 mm; 8 pontos por mm a 203 dpi).
 */
export function papelDoDriver(diag: Record<string, unknown> | null | undefined): number | null {
  if (!diag) return null
  const papel = Number(diag.papelLarguraMm)
  if (Number.isFinite(papel) && papel > 0) return Math.round(papel)
  const pontos = Number(diag.pontosImprimiveis)
  if (Number.isFinite(pontos) && pontos > 0) return pontos <= 400 ? 58 : 80
  return null
}

/** Linha do banco → perfil (coluna ausente ou valor estranho = padrão). */
export function perfilEnvio(d: Record<string, unknown> | null | undefined): PerfilEnvio {
  const r = d ?? {}
  const intensidade = r.intensidade === 'escura' || r.intensidade === 'mais_escura' ? r.intensidade : 'normal'
  const envio = r.envio === 'raw_fila' || r.envio === 'raw_rede' || r.envio === 'auto' ? r.envio : 'driver'
  const modoImpressao = r.modo_impressao === 'texto' ? 'texto' : 'imagem'
  const redeIp = typeof r.rede_ip === 'string' && ehIpv4(r.rede_ip) ? r.rede_ip : null
  const porta = Number(r.rede_porta)
  return { intensidade, envio, modoImpressao, redeIp, redePorta: Number.isInteger(porta) && porta >= 1 && porta <= 65535 ? porta : 9100 }
}

export const ROTULO_CAMINHO: Record<CaminhoEnvio, string> = {
  raw_fila: 'direto pela fila USB (ESC/POS)',
  raw_rede: 'direto pela rede (ESC/POS)',
  driver: 'pelo driver do Windows',
}
export const ehCaminho = (v: unknown): v is CaminhoEnvio => v === 'driver' || v === 'raw_fila' || v === 'raw_rede'

export function ehIpv4(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const p = v.trim().split('.')
  return p.length === 4 && p.every((x) => /^(0|[1-9]\d{0,2})$/.test(x) && Number(x) <= 255)
}

/**
 * Valida o que a tela mandou mudar. Devolve o patch em colunas do banco ou o erro.
 * `atual` = como está hoje (para "rede sem IP").
 */
export function validarPerfilEnvio(
  a: { intensidade?: unknown; envio?: unknown; modoImpressao?: unknown; redeIp?: unknown; redePorta?: unknown },
  atual: PerfilEnvio = PERFIL_ENVIO_PADRAO,
): { ok: true; patch: Record<string, unknown> } | { ok: false; erro: string } {
  const patch: Record<string, unknown> = {}
  if (a.intensidade !== undefined) {
    if (a.intensidade !== 'normal' && a.intensidade !== 'escura' && a.intensidade !== 'mais_escura') return { ok: false, erro: 'Intensidade inválida.' }
    patch.intensidade = a.intensidade
  }
  if (a.envio !== undefined) {
    if (a.envio !== 'driver' && a.envio !== 'raw_fila' && a.envio !== 'raw_rede' && a.envio !== 'auto') return { ok: false, erro: 'Forma de envio inválida.' }
    patch.envio = a.envio
  }
  if (a.modoImpressao !== undefined) {
    if (a.modoImpressao !== 'imagem' && a.modoImpressao !== 'texto') return { ok: false, erro: 'Modo de impressão inválido.' }
    patch.modo_impressao = a.modoImpressao
  }
  if (a.redeIp !== undefined) {
    if (a.redeIp === null || a.redeIp === '') patch.rede_ip = null
    else if (ehIpv4(a.redeIp)) patch.rede_ip = (a.redeIp as string).trim()
    else return { ok: false, erro: 'IP inválido (ex.: 192.168.0.50).' }
  }
  if (a.redePorta !== undefined) {
    const n = Number(a.redePorta)
    if (!Number.isInteger(n) || n < 1 || n > 65535) return { ok: false, erro: 'Porta inválida (padrão 9100).' }
    patch.rede_porta = n
  }
  const envio = (patch.envio as Envio | undefined) ?? atual.envio
  const ip = 'rede_ip' in patch ? (patch.rede_ip as string | null) : atual.redeIp
  if (envio === 'raw_rede' && !ip) return { ok: false, erro: 'Informe o IP da impressora para enviar pela rede.' }
  return { ok: true, patch }
}

/**
 * O driver do Windows está numa largura diferente da impressora? Só vale para o envio
 * pelo driver (no envio direto, quem manda na largura é o sistema). Usa o que o
 * Assistente leu do driver (diagnóstico): papel e pontos imprimíveis.
 */
export function avisoDriver(d: {
  larguraMm: number
  larguraPontos: number | null
  envio?: Envio
  diagnostico: Record<string, unknown> | null
}): string | null {
  // No automático o driver é a reserva: o aviso continua valendo.
  if (((d.envio ?? 'driver') !== 'driver' && d.envio !== 'auto') || !d.diagnostico) return null
  const papel = papelDoDriver(d.diagnostico)
  const pontos = Number(d.diagnostico.pontosImprimiveis)
  const aplicada = d.larguraPontos ?? (d.larguraMm <= 58 ? 384 : 576)
  if (papel !== null && Math.abs(papel - d.larguraMm) >= 10) {
    return `Seu driver está em ${papel} mm, mas a impressora é de ${d.larguraMm} mm. A comanda sai cortada à direita.`
  }
  if (Number.isFinite(pontos) && pontos > 0 && pontos + 16 < aplicada) {
    return `O driver só imprime ${pontos} pontos de largura, e a comanda tem ${aplicada}. A comanda sai cortada à direita.`
  }
  return null
}
