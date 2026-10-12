/**
 * Atualização automática do Assistente Beta (0.2.0-beta.11+, item 60). O Assistente pergunta
 * a cada hora a GET /api/agente/atualizacao/latest.yml e, se a versão daqui for mais nova, baixa
 * o instalador (servido pela Menuzia desde 12/10, lib/impressao/instaladores.ts; confere o SHA-512) e instala sozinho fora do horário de pico.
 *
 * Para LIBERAR uma versão nova para todas as lojas: subir o .exe (node .medidas/subir-partes.mjs), cadastrar em
 * lib/impressao/instaladores.ts e trocar
 * ATUALIZACAO_ASSISTENTE abaixo (versão, url, sha512 em base64 e tamanho em bytes do .exe:
 * `node -e "…createHash('sha512')…digest('base64')"`). Para SEGURAR (ex.: versão com problema): `ligada: false`
 * — ninguém mais atualiza; quem já instalou fica onde está.
 */
export const ATUALIZACAO_ASSISTENTE = {
  ligada: true,
  // 1.2.2 (12/10): alarme = um som único de 3 s (1,5x o antigo), UMA vez por pedido, sem loop. 1.2.1 repetia 5/8/15 s.
  versao: '1.2.2',
  // 12/10: servido pela Menuzia (lib/impressao/instaladores.ts), não mais pelo release do GitHub (repositório vai ficar privado).
  url: 'https://app.menuzia.com.br/api/agente/instalador/AssistenteMenuziaAlfa1-Setup-1.2.2.exe',
  sha512: 'Cqjf4c4wBws2P3RprCm3SMyOERvvLjHxoChptOfR9P+WzZ4K8mP66OGOscybsgswVq2mRrDPxpEfoMDn7oaVbw==',
  tamanho: 82601718,
  data: '2026-10-12T05:50:59.022Z',
}

/** O `latest.yml` no formato que o electron-updater lê (provedor genérico). */
export function latestYml(a: typeof ATUALIZACAO_ASSISTENTE = ATUALIZACAO_ASSISTENTE): string | null {
  if (!a.ligada || !a.sha512 || !a.tamanho) return null
  return [
    `version: ${a.versao}`,
    'files:',
    `  - url: ${a.url}`,
    `    sha512: ${a.sha512}`,
    `    size: ${a.tamanho}`,
    `path: ${a.url}`,
    `sha512: ${a.sha512}`,
    `releaseDate: '${a.data}'`,
    '',
  ].join('\n')
}
