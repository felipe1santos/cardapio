import { processarWebhookNexta } from '@/lib/nexta-webhook'

/**
 * O Nexta chama a URL registrada com um sufixo de evento no fim — visto em produção:
 * `POST /api/nexta/webhook/{token}/deliveryUpdate`. Este catch-all atende esse sufixo
 * (e qualquer outro que venham a usar); o tipo real do evento vem no corpo (`event.type`),
 * então o segmento da URL é ignorado e o processamento é o mesmo da rota base.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string; evento: string[] }> }) {
  const { token } = await params
  return processarWebhookNexta(request, token)
}
