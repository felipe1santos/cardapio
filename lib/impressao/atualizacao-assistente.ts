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
  // 1.2.1 (12/10): alarme toca UMA vez por pedido novo (5/8/15 s, padrão 8) e para sozinho. 1.2.0 tocava até aceitar.
  versao: '1.2.1',
  url: 'https://github.com/felipe1santos/cardapio/releases/download/printer-agent-v1.2.1/AssistenteMenuziaAlfa1-Setup-1.2.1.exe',
  sha512: 'tIBt8oEX8BmKQYWigdBSYVAjsO6wYfkFkowhS8xA9FYiYjArQFpkcOjNu2oO2Fh6oP0bmXaSPaTEro3ceqbu0Q==',
  tamanho: 82586196,
  data: '2026-10-12T05:32:18.460Z',
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
