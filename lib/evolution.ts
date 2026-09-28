/**
 * Cliente para a Evolution API (gerenciador de instâncias WhatsApp self-hosted).
 * EVOLUTION_API_URL/EVOLUTION_API_KEY são globais (servidor); cada restaurante
 * tem sua própria `instance` (string salva em `restaurantes.evolution_instance`).
 */

export function evolutionConfigurado(): boolean {
  return Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY)
}

function evolutionUrl(path: string): string {
  const base = process.env.EVOLUTION_API_URL!
  return `${base.replace(/\/$/, '')}${path}`
}

function evolutionHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_API_KEY! }
}

/** Nome da instância Evolution para um restaurante — estável e único. */
export function nomeInstancia(restauranteId: string): string {
  return `menuzia-${restauranteId}`
}

export interface QrCode {
  base64: string | null
  pairingCode: string | null
}

/** Cria a instância (se ainda não existir) e/ou busca o QR code para conectar o WhatsApp. */
export async function obterQrCode(instance: string): Promise<QrCode> {
  const createRes = await fetch(evolutionUrl('/instance/create'), {
    method: 'POST',
    headers: evolutionHeaders(),
    body: JSON.stringify({ instanceName: instance, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
  })

  if (createRes.ok) {
    const data = await createRes.json()
    const qrcode = data?.qrcode
    if (qrcode?.base64) return { base64: qrcode.base64, pairingCode: qrcode.pairingCode ?? null }
  }

  // Instância já existe (ou create não devolveu QR direto) — busca QR pra (re)conectar.
  const connectRes = await fetch(evolutionUrl(`/instance/connect/${instance}`), { headers: evolutionHeaders() })
  if (!connectRes.ok) throw new Error(`Evolution API respondeu ${connectRes.status} ao conectar instância`)
  const data = await connectRes.json()
  return { base64: data?.base64 ?? null, pairingCode: data?.pairingCode ?? null }
}

export type EstadoConexao = 'open' | 'connecting' | 'close'

/** Estado atual da conexão WhatsApp da instância. `null` se a instância não existe ainda. */
export async function estadoConexao(instance: string): Promise<EstadoConexao | null> {
  const res = await fetch(evolutionUrl(`/instance/connectionState/${instance}`), { headers: evolutionHeaders() })
  if (!res.ok) return null
  const data = await res.json()
  return (data?.instance?.state as EstadoConexao | undefined) ?? null
}

/** Desconecta o WhatsApp da instância (mantém a instância para reconectar depois). */
export async function desconectarInstancia(instance: string): Promise<void> {
  await fetch(evolutionUrl(`/instance/logout/${instance}`), { method: 'DELETE', headers: evolutionHeaders() })
}

/**
 * Número do WhatsApp conectado na instância ("5527999990000"), para o painel mostrar
 * "Conectado · (27) 99999-0000". Melhor esforço: a Evolution v2 manda `ownerJid`, a v1
 * `owner`; qualquer falha devolve null e o painel mostra só "Conectado".
 */
export async function numeroConectado(instance: string): Promise<string | null> {
  try {
    const res = await fetch(evolutionUrl(`/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`), { headers: evolutionHeaders(), signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data = await res.json()
    const lista = Array.isArray(data) ? data : [data]
    for (const item of lista) {
      const i = item?.instance ?? item
      const jid = String(i?.ownerJid ?? i?.owner ?? '')
      const numero = jid.split('@')[0].replace(/\D/g, '')
      if (numero.length >= 10 && numero.length <= 15) return numero
    }
    return null
  } catch {
    return null
  }
}

/** "5527999990000" → "(27) 99999-0000" (sem o 55); outro formato volta como veio. */
export function formatarNumeroWhatsapp(numero: string | null): string | null {
  if (!numero) return null
  let d = numero.replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return numero
}
