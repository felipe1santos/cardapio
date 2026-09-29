import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigImpressao, buscarLojaImpressao, listarImpressoras, listarPedidosParaImprimir, registrarHeartbeatAgente } from '@/lib/queries/impressao'
import { lerAgenteToken } from '@/lib/agente-token'
import { identificarAgente } from '@/lib/impressao/credenciais'
import { destinoCozinha } from '@/lib/impressao/servico'
import { aposCorteDaTransferencia } from '@/lib/impressao/transferencia'
import { extrasDaCozinhaBeta, lojaDaCozinhaBeta, lojaImpressao, qrDaCozinha, type LojaImpressao } from '@/lib/impressao/cozinha-beta'
import { esperarComBusca } from '@/lib/impressao/despertador'

export const dynamic = 'force-dynamic'

/**
 * Fila da FICHA DA COZINHA, consultada periodicamente pelo Assistente de Impressão.
 *
 * Aceita os dois jeitos de identificação: o token antigo da loja (modo compatível) e a
 * credencial do computador (0.1.26+). Com identidade — cabeçalho X-Agente-Instancia no
 * modo antigo, ou o próprio agente autenticado — os pedidos entregues ficam RESERVADOS
 * para quem pediu (0086); sem identidade, só são listados (0087).
 *
 * Assistente Beta (0100): um computador PAREADO só consome a cozinha quando a loja está
 * em "Cozinha e Caixa" e ele é o dono da impressora de Cozinha. Em qualquer outro modo
 * recebe lista vazia — a cozinha continua no Assistente antigo e nada imprime em dobro.
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
    // `?esperar=N` (Beta 0.2.0-beta.7+, até 20 s): sem pedido para imprimir, espera o aviso
    // em tempo real de um pedido novo em vez de o Assistente perguntar a cada 5 s.
    const esperar = souDono ? Math.max(0, Math.min(20, Number(new URL(request.url).searchParams.get('esperar')) || 0)) : 0
    // Durante a espera, a loja pode sair de "Cozinha e Caixa" ou trocar a impressora da
    // Cozinha: antes de cada nova busca, confere de novo — senão o Beta reservaria fichas
    // que agora são do Assistente antigo.
    const aindaDono = async () => {
      const [r2, c2] = await Promise.all([destinoCozinha(admin, restauranteId), buscarConfigImpressao(admin, restauranteId)])
      return r2.ativo && r2.agenteId === rota.agenteId && r2.transferidaEm === rota.transferidaEm && !!c2?.impressaoAutomatica
    }
    const pedidos = souDono && config?.impressaoAutomatica
      ? await esperarComBusca(restauranteId, esperar, request.signal, async () =>
          aposCorteDaTransferencia(await listarPedidosParaImprimir(admin, restauranteId, instancia) as { criadoEm?: string | null }[], rota.transferidaEm), aindaDono)
      : []
    // Modelo novo da comanda (Beta 0.2.0-beta.2+): desconto, horários, comanda, atendente
    // e o QR do fim. Só para o dono da Cozinha — a resposta do Assistente antigo não muda.
    // Nome, telefone e endereço da loja para o rodapé (0.2.0-beta.6+).
    let beta: { extras: Record<string, unknown>; qr: ReturnType<typeof qrDaCozinha> | null; loja: LojaImpressao | null } | undefined
    if (souDono) {
      const ids = (pedidos as { id?: string }[]).map((p) => p.id).filter((id): id is string => typeof id === 'string')
      const [extras, lojaBeta, dadosLoja] = await Promise.all([
        extrasDaCozinhaBeta(admin, restauranteId, ids).catch(() => ({})),
        lojaDaCozinhaBeta(admin, restauranteId).catch(() => null),
        lojaImpressao(admin, restauranteId).catch(() => null),
      ])
      let qr: ReturnType<typeof qrDaCozinha> | null = null
      try { qr = lojaBeta?.slug ? qrDaCozinha(lojaBeta) : null } catch { qr = null }
      beta = { extras, qr, loja: dadosLoja }
    }
    return NextResponse.json({
      config,
      impressoras,
      pedidos,
      loja,
      ...(beta ? { cozinhaBeta: beta } : {}),
      ...(esperar ? { esperaAte: 20 } : {}),
      destinoCozinha: souDono
        ? { nomeSistema: rota.nomeSistema, larguraMm: rota.larguraMm, tamanhoFonte: rota.tamanhoFonte, copias: rota.copias,
            larguraPontos: rota.larguraPontos, deslocamentoPontos: rota.deslocamentoPontos,
            // Como a impressora recebe (0109 / 0.2.0-beta.7): intensidade, envio direto e modo.
            intensidade: rota.intensidade, envio: rota.envio, modoImpressao: rota.modoImpressao, redeIp: rota.redeIp, redePorta: rota.redePorta }
        : null,
    })
  }

  // Computador pareado (Assistente Beta) fora do modo "Cozinha e Caixa": não consome a
  // cozinha. Sem isso, Beta e Assistente antigo imprimiriam a mesma ficha.
  if (quem.tipo === 'agente') return NextResponse.json({ config, impressoras, pedidos: [], loja })

  // Impressão automática desligada: o Assistente não imprime nada, então nada é
  // reservado — senão a fila ficaria presa em reservas de quem não vai imprimir.
  const pedidos = config?.impressaoAutomatica ? await listarPedidosParaImprimir(admin, restauranteId, instancia) : []

  return NextResponse.json({ config, impressoras, pedidos, loja })
}
