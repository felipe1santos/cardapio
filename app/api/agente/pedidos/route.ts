import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigImpressao, buscarLojaImpressao, listarImpressoras, listarPedidosParaImprimir, registrarHeartbeatAgente } from '@/lib/queries/impressao'
import { lerAgenteToken } from '@/lib/agente-token'
import { identificarAgente } from '@/lib/impressao/credenciais'
import { destinoCozinha } from '@/lib/impressao/servico'

/**
 * Fila da FICHA DA COZINHA, consultada periodicamente pelo Assistente de Impressão.
 *
 * Aceita os dois jeitos de identificação: o token antigo da loja (modo compatível) e a
 * credencial do computador (0.1.26+). Com identidade — cabeçalho X-Agente-Instancia no
 * modo antigo, ou o próprio agente autenticado — os pedidos entregues ficam RESERVADOS
 * para quem pediu (0086); sem identidade, só são listados (0087).
 */
export async function GET(request: Request) {
  if (!lerAgenteToken(request)) return NextResponse.json({ error: 'Token ausente' }, { status: 400 })

  const admin = getAdminSupabase()
  const quem = await identificarAgente(admin, request)
  if (!quem) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
  const restauranteId = quem.restauranteId

  let instancia: string | null
  if (quem.tipo === 'agente') {
    // Sinal de vida já registrado na autenticação do agente.
    instancia = `agente-${quem.agenteId}`
  } else {
    // Heartbeat do modo antigo: o painel acende a impressora "conectada". Best-effort.
    registrarHeartbeatAgente(admin, restauranteId, request.headers.get('x-impressora-id')).catch(() => {})
    const bruto = request.headers.get('x-agente-instancia') ?? ''
    instancia = /^[A-Za-z0-9-]{8,64}$/.test(bruto) ? bruto : null
  }

  const [config, impressoras, loja, rota] = await Promise.all([
    buscarConfigImpressao(admin, restauranteId),
    listarImpressoras(admin, restauranteId),
    buscarLojaImpressao(admin, restauranteId),
    destinoCozinha(admin, restauranteId),
  ])

  // Roteamento por função (opção da loja, desligada por padrão): SÓ o computador dono da
  // impressora de Cozinha consome a fila, e recebe o destino exato. Todos os outros —
  // Assistente antigo e demais computadores — recebem lista vazia: nada imprime em dobro
  // e a ficha nunca cai na impressora do caixa.
  if (rota.ativo) {
    const souDono = quem.tipo === 'agente' && quem.agenteId === rota.agenteId
    const pedidos = souDono && config?.impressaoAutomatica ? await listarPedidosParaImprimir(admin, restauranteId, instancia) : []
    return NextResponse.json({
      config,
      impressoras,
      pedidos,
      loja,
      destinoCozinha: souDono
        ? { nomeSistema: rota.nomeSistema, larguraMm: rota.larguraMm, tamanhoFonte: rota.tamanhoFonte, copias: rota.copias }
        : null,
    })
  }

  // Impressão automática desligada: o Assistente não imprime nada, então nada é
  // reservado — senão a fila ficaria presa em reservas de quem não vai imprimir.
  const pedidos = config?.impressaoAutomatica ? await listarPedidosParaImprimir(admin, restauranteId, instancia) : []

  return NextResponse.json({ config, impressoras, pedidos, loja })
}
