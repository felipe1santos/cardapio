/**
 * Aviso do botão Despachar quando o despacho automático não achou ninguém (12/10). "Disponível" = app aberto agora (sinal nos
 * últimos 2 min) — o "online" da lista é o status cadastrado e não diz que o app está aberto. Dá para despachar à mão
 * escolhendo um motoboy no painel; ele recebe quando abrir o app.
 */
export function avisoSemMotoboy(cadastrados: number): string {
  if (cadastrados <= 0) return 'Nenhum motoboy cadastrado'
  return `Nenhum motoboy online agora (${cadastrados} ${cadastrados === 1 ? 'cadastrado' : 'cadastrados'})`
}
