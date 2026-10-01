/**
 * Boot do servidor Next (roda uma vez por processo). Só no runtime Node: liga o push do app do
 * cardápio ao aviso de status do pedido (0127) sem levar sharp/web-push para o navegador.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registrarPush } = await import('./lib/push/gancho')
    registrarPush()
  }
}
