import { processarWebhookNexta } from '@/lib/nexta-webhook'

/**
 * Eventos de entrega do Nexta (aceito, coletado, entregue...). ENDPOINT PÚBLICO — é o
 * Nexta quem chama, e a URL é registrada manualmente com o suporte deles.
 *
 * O Nexta anexa um sufixo à URL registrada (ex.: `/deliveryUpdate`), atendido pela rota
 * catch-all irmã `[token]/[...evento]`. Esta aqui cobre o POST no token puro. Ambas
 * delegam para `processarWebhookNexta`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return processarWebhookNexta(request, token)
}
