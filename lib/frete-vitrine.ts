/**
 * Frete no checkout da vitrine (29/10/2026, pedido do dono): só calcula com o endereço COMPLETO (rua + número + bairro),
 * ~800 ms depois de parar de digitar, e guarda por endereço — o mesmo endereço não consulta de novo. Antes bastava o
 * bairro, e cada pausa na digitação da rua/número consultava o servidor (que pode geocodificar, API paga): 28/10 teve
 * 13 geocodificações para 4 pedidos de entrega. Puro (o cache vive no módulo da vitrine, por aba).
 */
export interface EnderecoFrete { cep: string; rua: string; numero: string; bairro: string; cidade: string }

export const ESPERA_FRETE_MS = 800

export function enderecoCompletoParaFrete(e: EnderecoFrete): boolean {
  return e.rua.trim() !== '' && e.numero.trim() !== '' && e.bairro.trim() !== ''
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export function chaveFrete(e: EnderecoFrete): string {
  return [e.cep.replace(/\D/g, ''), norm(e.rua), norm(e.numero), norm(e.bairro), norm(e.cidade)].join('|')
}

/** Cache por loja + endereço. Só guarde resposta boa (erro de rede consulta de novo na próxima). */
export function criarCacheFrete<T>(max = 50) {
  const m = new Map<string, T>()
  return {
    ler: (slug: string, e: EnderecoFrete): T | undefined => m.get(`${slug}#${chaveFrete(e)}`),
    guardar(slug: string, e: EnderecoFrete, v: T) {
      m.set(`${slug}#${chaveFrete(e)}`, v)
      if (m.size > max) m.delete(m.keys().next().value as string)
    },
  }
}
