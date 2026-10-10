/**
 * Largura do papel automática (08/10): vem do que o driver informa ao assistente (diagnóstico).
 * 80 mm → 576 pontos; 58 mm → 384. Papel até 64 mm conta como 58; sem informação, 80 mm.
 * 09/10: se o driver informa a área imprimível em pontos (`pontosImprimiveis`, ex.: POS-80 da Villa = 574) e ela é
 * MENOR que a padrão, vale a do driver, arredondada para baixo em múltiplo de 8 (o comando de imagem GS v 0 manda
 * a linha em bytes): 574 → 568. Imagem mais larga que a cabeça podia ser descartada pela impressora.
 * Só vale para impressora sem ajuste manual (largura_manual): o Avançado é para o suporte.
 */
export function larguraDoDriver(diag: Record<string, unknown> | null | undefined): { larguraMm: 58 | 80; larguraPontos: number } {
  const mm = Number(diag?.papelLarguraMm)
  const area = Number(diag?.areaImprimivelLarguraMm)
  const ref = Number.isFinite(mm) && mm > 20 && mm < 400 ? mm : Number.isFinite(area) && area > 20 && area < 400 ? area : NaN
  const base = Number.isFinite(ref) && ref <= 64 ? { larguraMm: 58 as const, larguraPontos: 384 } : { larguraMm: 80 as const, larguraPontos: 576 }
  const real = Number(diag?.pontosImprimiveis)
  if (Number.isFinite(real) && real >= base.larguraPontos * 0.75 && real < base.larguraPontos) {
    return { larguraMm: base.larguraMm, larguraPontos: Math.floor(real / 8) * 8 }
  }
  return base
}
