/**
 * Cidades do Brasil atendidas pela Lalamove (lista oficial do site lalamove.com/pt-br em 18/10/2026).
 * Client-safe. Serve para avisar ANTES de o lojista criar a conta; a palavra final é a cotação (a API recusa fora da
 * área) e a lista de GET /v3/cities quando a loja já tem chave.
 */
export const CIDADES_LALAMOVE_BR = [
  'São Paulo', 'Campinas', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Brasília', 'Goiânia', 'Salvador',
  'Recife', 'Fortaleza', 'Aracaju', 'Belém', 'Florianópolis', 'Ribeirão Preto', 'Maceió', 'São Luís', 'Manaus',
] as const

/** Regiões metropolitanas que a Lalamove costuma cobrir junto com a capital. Confirmar com uma cotação. */
const VIZINHAS: Record<string, string> = {
  guarulhos: 'São Paulo', osasco: 'São Paulo', 'santo andre': 'São Paulo', 'sao bernardo do campo': 'São Paulo', 'sao caetano do sul': 'São Paulo',
  diadema: 'São Paulo', barueri: 'São Paulo', 'taboao da serra': 'São Paulo', niteroi: 'Rio de Janeiro', 'sao goncalo': 'Rio de Janeiro',
  'duque de caxias': 'Rio de Janeiro', 'nova iguacu': 'Rio de Janeiro', contagem: 'Belo Horizonte', betim: 'Belo Horizonte',
  'sao jose dos pinhais': 'Curitiba', canoas: 'Porto Alegre', 'aparecida de goiania': 'Goiânia', 'lauro de freitas': 'Salvador',
  olinda: 'Recife', 'jaboatao dos guararapes': 'Recife', 'sao jose': 'Florianópolis', 'sao jose de ribamar': 'São Luís',
}

export const normalizarCidade = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()

export type Cobertura = { atende: true; cidade: string; vizinha?: string } | { atende: false; cidade: string } | { atende: 'desconhecida' }

/** A cidade da loja está na lista? `vizinha` = está na região metropolitana de uma atendida (provável, confirmar). */
export function coberturaLalamove(cidadeLoja: string | null | undefined): Cobertura {
  const c = normalizarCidade(cidadeLoja ?? '')
  if (!c) return { atende: 'desconhecida' }
  const oficial = CIDADES_LALAMOVE_BR.find((n) => normalizarCidade(n) === c)
  if (oficial) return { atende: true, cidade: oficial }
  const capital = VIZINHAS[c]
  if (capital) return { atende: true, cidade: cidadeLoja!.trim(), vizinha: capital }
  return { atende: false, cidade: cidadeLoja!.trim() }
}

/** Cidade da loja a partir do cadastro: campo próprio ou o fim do endereço livre ("…, Vila Velha - ES"). */
export function cidadeDaLoja(cfg: { enderecoCidade?: string | null; endereco?: string | null }): string {
  const direta = (cfg.enderecoCidade ?? '').trim()
  if (direta) return direta
  const m = /,\s*([^,]+?)\s*-\s*[A-Z]{2}\s*$/i.exec(cfg.endereco ?? '')
  return m ? m[1].trim() : ''
}
