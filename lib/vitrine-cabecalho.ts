/**
 * O que o cabeçalho da loja mostra na vitrine (21/10/2026), escolhido em Ajustes › Perfil › "O que mostrar na
 * vitrine". Tudo ligado por padrão (o que já aparecia continua aparecendo); a loja desliga o que não quer.
 */
export interface CabecalhoVitrine {
  /** "Aberta agora" / "Fechada" com o pontinho. */
  status: boolean
  /** Tempo de entrega. */
  tempo: boolean
  /** Nota e quantidade de avaliações (só aparece se a loja preencheu a Prova social). */
  avaliacao: boolean
  /** Bairro e cidade. */
  endereco: boolean
}

export const CABECALHO_PADRAO: CabecalhoVitrine = { status: true, tempo: true, avaliacao: true, endereco: true }

export function cabecalhoVitrine(raw: unknown): CabecalhoVitrine {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof CabecalhoVitrine, unknown>>
  const lido = (k: keyof CabecalhoVitrine) => (typeof v[k] === 'boolean' ? (v[k] as boolean) : CABECALHO_PADRAO[k])
  return { status: lido('status'), tempo: lido('tempo'), avaliacao: lido('avaliacao'), endereco: lido('endereco') }
}
