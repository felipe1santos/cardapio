import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * O Next comprime as respostas em gzip por conta própria (`compress: true` é o
   * padrão). Quando ele faz isso, o proxy à frente recebe o corpo já comprimido
   * e só repassa — mesmo sabendo Brotli.
   *
   * Medido em produção pedindo o mesmo chunk com cabeçalhos diferentes:
   *
   *   Accept-Encoding: gzip, deflate, br, zstd  -> gzip  51.771 B
   *   Accept-Encoding: br, gzip                 -> gzip  51.771 B
   *   Accept-Encoding: br;q=1.0, gzip;q=0.1     -> gzip  51.771 B
   *   Accept-Encoding: br                       -> br    47.738 B
   *
   * Ou seja: o Brotli só aparecia quando o cliente recusava gzip — e o Chrome
   * nunca recusa. Desligando a compressão do Next, o proxy passa a escolher, e
   * o JS inicial da vitrine cai de ~148 KB para ~125 KB sem tocar em uma linha
   * de código de aplicação.
   *
   * Se algum dia o proxy deixar de comprimir, isto vira "sem compressão nenhuma"
   * — por isso a validação depois do deploy é conferir `content-encoding: br`
   * nos chunks, não só o tamanho.
   */
  compress: false,
}

export default nextConfig
