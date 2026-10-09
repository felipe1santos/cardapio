/**
 * Largura do papel automática (08/10): vem do que o driver informa ao assistente (diagnóstico).
 * 80 mm → 576 pontos; 58 mm → 384. Papel até 64 mm conta como 58; sem informação, 80 mm.
 * Só vale para impressora sem ajuste manual (largura_manual): o Avançado é para o suporte.
 */
export function larguraDoDriver(diag: Record<string, unknown> | null | undefined): { larguraMm: 58 | 80; larguraPontos: 384 | 576 } {
  const mm = Number(diag?.papelLarguraMm)
  const area = Number(diag?.areaImprimivelLarguraMm)
  const ref = Number.isFinite(mm) && mm > 20 && mm < 400 ? mm : Number.isFinite(area) && area > 20 && area < 400 ? area : NaN
  if (Number.isFinite(ref) && ref <= 64) return { larguraMm: 58, larguraPontos: 384 }
  return { larguraMm: 80, larguraPontos: 576 }
}
