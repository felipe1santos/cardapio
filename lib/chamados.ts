/**
 * Vocabulário dos chamados de mesa — puro, sem Supabase.
 *
 * Mora fora de `lib/queries/chamados.ts` de propósito: a tela do cliente (que é um
 * bundle de celular) importa só isto, e não arrasta o cliente do banco junto. Mesma
 * separação de `lib/conta.ts` × `lib/queries/conta.ts`.
 */

export type MotivoChamado = 'garcom' | 'conta' | 'ajuda'
export type StatusChamado = 'pendente' | 'assumido' | 'concluido' | 'expirado'

export const ROTULO_MOTIVO: Record<MotivoChamado, string> = {
  garcom: 'Chamou o garçom',
  conta: 'Pediu a conta',
  ajuda: 'Pediu ajuda',
}

export const MOTIVOS_CHAMADO: { id: MotivoChamado; rotulo: string; descricao: string }[] = [
  { id: 'garcom', rotulo: 'Chamar o garçom', descricao: 'Alguém vem até a mesa' },
  { id: 'conta', rotulo: 'Pedir a conta', descricao: 'O garçom traz o fechamento' },
  { id: 'ajuda', rotulo: 'Preciso de ajuda', descricao: 'Dúvida no cardápio, talher, guardanapo…' },
]

export function ehMotivo(valor: unknown): valor is MotivoChamado {
  return valor === 'garcom' || valor === 'conta' || valor === 'ajuda'
}

/**
 * "há 3 min" — o salão precisa ver a espera, não o timestamp. Abaixo de um minuto vira
 * "agora" para a etiqueta não piscar a cada tick.
 */
export function esperaTexto(criadoEm: string, agora: number = Date.now()): string {
  const minutos = Math.floor((agora - new Date(criadoEm).getTime()) / 60000)
  if (!Number.isFinite(minutos) || minutos < 1) return 'agora'
  if (minutos === 1) return 'há 1 min'
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 48) return horas === 1 ? 'há 1 h' : `há ${horas} h`
  // Conta esquecida aberta há semanas: "há 82 dias" em vez de "há 1981 h".
  return `há ${Math.floor(horas / 24)} dias`
}

/** Espera longa fica em destaque: mesa esquecida é reclamação na porta. */
export function esperaCritica(criadoEm: string, agora: number = Date.now(), limiteMinutos = 5): boolean {
  return agora - new Date(criadoEm).getTime() >= limiteMinutos * 60000
}
