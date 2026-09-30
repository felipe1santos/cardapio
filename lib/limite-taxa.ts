/**
 * Limite de tentativas em memória (janela deslizante). O app roda num contêiner só, então
 * a memória do processo basta; reiniciar zera os contadores, o que é aceitável para o uso
 * (frear força bruta e enxurrada, não contabilidade).
 */
export interface Limitador {
  /** Já passou do limite nesta janela? */
  excedeu(chave: string, agora?: number): boolean
  /** Conta mais uma ocorrência. */
  registrar(chave: string, agora?: number): void
  /** Esquece a chave (ex.: login deu certo). */
  limpar(chave: string): void
}

export function criarLimitador({ max, janelaMs, maxChaves = 10_000 }: { max: number; janelaMs: number; maxChaves?: number }): Limitador {
  const mapa = new Map<string, number[]>()
  const recentes = (chave: string, agora: number) => {
    const lista = (mapa.get(chave) ?? []).filter((t) => agora - t < janelaMs)
    if (lista.length) mapa.set(chave, lista)
    else mapa.delete(chave)
    return lista
  }
  return {
    excedeu(chave, agora = Date.now()) {
      return recentes(chave, agora).length >= max
    },
    registrar(chave, agora = Date.now()) {
      const lista = recentes(chave, agora)
      lista.push(agora)
      mapa.set(chave, lista)
      // Enxurrada de chaves diferentes não pode crescer a memória sem fim: sai a mais antiga.
      if (mapa.size > maxChaves) mapa.delete(mapa.keys().next().value as string)
    },
    limpar(chave) {
      mapa.delete(chave)
    },
  }
}

/** IP de quem chamou, pelo proxy (Coolify/Traefik põe o cliente no primeiro do x-forwarded-for). */
export function ipDaRequisicao(h: { get(nome: string): string | null }): string {
  return (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'desconhecido'
}
