import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { processarFila } from '@/lib/mensageria/fila'
import { garantirWebhookDeTempoEmTempo } from '@/lib/mensageria/webhook-loja'
import { avisarAtendentesPendentes } from '@/lib/agente-ia/avisos'
import { escalarSolicitacoesPendentes } from '@/lib/pedidos/solicitacoes'
import { sugerirComIaUmaLoja } from '@/lib/robo-auto/sugestao-ia'
import { monitorarTodas } from '@/lib/whatsapp-monitor'
import { devolverConversasAbandonadas } from '@/lib/mensageria/abandono'
import { expirarCashbackVencidos } from '@/lib/queries/cashback'
import { criarPortaoHorario } from '@/lib/manutencao-horaria'
import { baterCron, umaPorVez } from '@/lib/saude/cron'
import { rodarVigia } from '@/lib/saude/vigia'

const manutencao = criarPortaoHorario(60 * 60_000)

/**
 * Cron da fila do WhatsApp: novas tentativas (espera crescente) e retenção de 90 dias.
 * Protegido por CRON_SECRET, como o de campanhas. Sugestão no Coolify: a cada 1 minuto.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const admin = getAdminSupabase()
  void baterCron('whatsapp')
  // Pediu atendente pela IA e ninguém respondeu em 10 min: avisa o cliente uma vez (12/10). Antes da fila: sai nesta mesma rodada.
  await avisarAtendentesPendentes(admin).catch((e) => console.error('[whatsapp] aviso de atendente:', (e as Error).message))
  // Solicitação de alteração/cancelamento do cliente sem resposta da loja há 5 min (18/10): vai para o atendente.
  await escalarSolicitacoesPendentes(admin).catch((e) => console.error('[whatsapp] escalar solicitações:', (e as Error).message))
  // Loja assumiu e sumiu (Etapa 4, 20/10): humano parou de responder há X min → robô/IA volta com pedido de desculpas (antes da fila: sai nesta rodada).
  await devolverConversasAbandonadas(admin).catch((e) => console.error('[whatsapp] retorno automático:', (e as Error).message))
  const fila = await processarFila(admin, { limite: 20 })
  // Manutenção sem pressa: 1 vez por hora (revisão de escala 26/10). A limpeza lê as tabelas do WhatsApp inteiras.
  let limpeza: unknown = null
  if (manutencao.liberar()) {
    const { data, error } = await admin.rpc('whatsapp_limpar_antigos')
    if (error) console.error('[whatsapp] limpeza falhou:', error.message)
    limpeza = data
    // Cashback (Etapa 7, 0211): o que venceu vira "expirado" (o saldo já ignora vencidos; isto é só arrumação).
    await expirarCashbackVencidos(admin).catch(() => null)
    // "Perguntas que o robô não entendeu" ficam 30 dias (0177).
    await admin.from('whatsapp_auto_nao_entendidas').delete().lt('ultima_em', new Date(Date.now() - 30 * 24 * 3600_000).toISOString())
  }
  // Sugestão pela IA das mensagens não entendidas (16/10): 1 loja por rodada, 1 lote por dia por loja, com o módulo e dentro do teto.
  await sugerirComIaUmaLoja(admin).catch((e) => console.error('[whatsapp] sugestão IA:', (e as Error).message))
  // Webhook de toda loja com WhatsApp (a cada 30 min por loja): reconectar pelo celular,
  // sem passar pelo painel, também deixa o SAIR e a central funcionando.
  // Loja com o WhatsApp desconectado fica de fora (28/10): ao ler o QR em Integrações o webhook é refeito na hora.
  const { data: lojas } = await admin.from('restaurantes').select('id').not('evolution_instance', 'is', null).or('whatsapp_estado.is.null,whatsapp_estado.neq.close')
  for (const l of (lojas ?? []) as { id: string }[]) await garantirWebhookDeTempoEmTempo(admin, l.id, 30 * 60_000).catch(() => null)
  // Monitor da conexão (Etapa 3, 20/10): 1 GET connectionState por loja a cada 2 min (throttle interno); caiu sozinha → faixa, push e alerta; voltou → reenvia avisos que falharam.
  const monitor = await monitorarTodas(admin).catch((e) => { console.error('[whatsapp] monitor:', (e as Error).message); return null })
  // Vigia da saúde do sistema (28/10, Etapa 7): no máximo a cada 5 min, sem API paga; alerta no WhatsApp do dono.
  // Uma rodada por vez: duas chamadas juntas passariam as duas pela trava da última foto (auditoria 28/10).
  const saude = await umaPorVez('vigia', () => rodarVigia(admin)).catch((e) => { console.error('[whatsapp] vigia:', (e as Error).message); return null })
  return NextResponse.json({ enviados: fila.enviados, falhas: fila.falhas, limpeza: limpeza ?? null, monitor, saude })
}
