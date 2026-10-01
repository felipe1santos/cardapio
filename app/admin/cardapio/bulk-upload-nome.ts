/**
 * Deriva um nome de produto a partir do nome do arquivo de imagem.
 * Retorna null quando o nome é genérico (IMG_1234, WhatsApp Image, só números...) —
 * nesse caso o chamador usa o fallback sequencial ("Item 1", "Item 2"...).
 */

const PADROES_GENERICOS = [
  /^img[\s\-_]*[\d\s\-_.()]*$/i,
  /^image[\s\-_]*[\d\s\-_.()]*$/i,
  /^imagem[\s\-_]*[\d\s\-_.()]*$/i,
  /^photo[\s\-_]*[\d\s\-_.()]*$/i,
  /^foto[\s\-_]*[\d\s\-_.()]*$/i,
  /^picture[\s\-_]*[\d\s\-_.()]*$/i,
  /^dsc\w*$/i,
  /^dscn\w*$/i,
  /^pxl[\s\-_]*[\d\s\-_.()]*$/i,
  /^whatsapp[\s\-_]*image[\s\S]*$/i,
  /^screenshot[\s\S]*$/i,
  /^captura[\s\S]*$/i,
  /^[\d\s\-_.()]*$/,
  // Nomes que são códigos: UUID (arquivo baixado de app/CDN) e hash hexadecimal longo.
  // Viravam produtos "B2ab1fe1 Dd8c 4b89 9070 35c9b6531642" na vitrine (2026-09-30).
  /^[0-9a-f]{8}[\s\-_]?[0-9a-f]{4}[\s\-_]?[0-9a-f]{4}[\s\-_]?[0-9a-f]{4}[\s\-_]?[0-9a-f]{12}[\s\-_.()\d]*$/i,
  /^[0-9a-f]{16,}$/i,
  /^(download|untitled|sem[\s\-_]*t[ií]tulo)[\s\-_]*[\d\s\-_.()]*$/i,
]

export function limparNomeArquivo(fileName: string): string | null {
  const semExtensao = fileName.replace(/\.[^.]+$/, '')
  if (PADROES_GENERICOS.some((padrao) => padrao.test(semExtensao))) return null

  const limpo = semExtensao.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!limpo) return null

  return limpo
    .split(' ')
    .map((palavra) => palavra.charAt(0).toUpperCase() + palavra.slice(1))
    .join(' ')
}
