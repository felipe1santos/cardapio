/**
 * Atualização automática do Assistente Beta (0.2.0-beta.11+, item 60). O Assistente pergunta
 * a cada hora a GET /api/agente/atualizacao/latest.yml e, se a versão daqui for mais nova, baixa
 * o instalador do release do GitHub (confere o SHA-512) e instala sozinho fora do horário de pico.
 *
 * Para LIBERAR uma versão nova para todas as lojas: publicar o release no GitHub e trocar
 * ATUALIZACAO_ASSISTENTE abaixo (versão, url, sha512 em base64 e tamanho em bytes do .exe:
 * `node -e "…createHash('sha512')…digest('base64')"`). Para SEGURAR (ex.: versão com problema): `ligada: false`
 * — ninguém mais atualiza; quem já instalou fica onde está.
 */
export const ATUALIZACAO_ASSISTENTE = {
  ligada: true,
  versao: '0.2.0-beta.13',
  url: 'https://github.com/felipe1santos/cardapio/releases/download/printer-agent-v0.2.0-beta.13/AssistenteMenuziaBeta-Setup-0.2.0-beta.13.exe',
  sha512: 'k2DXHfJI0a4nV0hLws3Il04rLqoEZ9yMB8qYeSwQk1LGOURTph4rIyWjwotbJ75j45EHa2VyWR4F+HlqEbK08w==',
  tamanho: 82454863,
  data: '2026-10-09T04:00:00.000Z',
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
