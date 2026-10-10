// Atraso da impressão (10/10/2026): o ciclo de pedidos baixava a logo da loja da internet A CADA rodada com pedido,
// antes de imprimir — e no Beta/Alfa 1 esse arquivo nunca era usado (a comanda usa logoParaDesenho, com cache).
// Só o Assistente antigo (recibo de texto, imprimirTexto) precisa do arquivo baixado.
function deveBaixarLogoDoCiclo({ ehBeta, imprimirLogo, logoUrl }) {
  return !ehBeta && !!imprimirLogo && !!logoUrl
}
module.exports = { deveBaixarLogoDoCiclo }
