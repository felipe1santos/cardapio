/**
 * Status REAL do motoboy na tela Pedidos (redesign 14/10): vem do sinal do app (heartbeat < 2 min = `online`, ver
 * listarEntregadores) e das entregas em rota — não do seletor manual "Disponível/Ocupado/Offline", que é só a
 * disponibilidade que a loja marca. Antes a tela contava o seletor ("4 de 5 disponíveis") e o Kanban o sinal
 * ("Nenhum motoboy online"), e as duas se contradiziam.
 */
export type TipoStatusReal = 'em_rota' | 'online' | 'offline' | 'desativado'

interface SinalMotoboy {
  online: boolean
  emRota: number
  desativado?: boolean
  ultimoAcessoEm?: string | null
}

export function vistoHa(iso: string, agora: number): string {
  const min = Math.floor((agora - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return `há ${d} dia${d === 1 ? '' : 's'}`
}

export function statusReal(m: SinalMotoboy, numerosEmRota: number[], agora: number): { tipo: TipoStatusReal; texto: string } {
  if (m.desativado) return { tipo: 'desativado', texto: 'Desativado' }
  if (m.emRota > 0) {
    const texto = numerosEmRota.length
      ? numerosEmRota.map((n) => `#${n}`).join(', ')
      : `${m.emRota} entrega${m.emRota === 1 ? '' : 's'}`
    return { tipo: 'em_rota', texto: `Em rota · ${texto}` }
  }
  if (m.online) return { tipo: 'online', texto: 'Online' }
  return { tipo: 'offline', texto: m.ultimoAcessoEm ? `Offline · visto ${vistoHa(m.ultimoAcessoEm, agora)}` : 'Offline · nunca abriu o app' }
}

/** "Online agora X de Y": X = app aberto agora; Y = motoboys ativos (desativado não entra). */
export function contarOnline(lista: SinalMotoboy[]): { online: number; total: number } {
  const ativos = lista.filter((m) => !m.desativado)
  return { online: ativos.filter((m) => m.online).length, total: ativos.length }
}
