import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { identificarAgente } from '@/lib/impressao/credenciais'
import { reservarTrabalhos, type TrabalhoAgente } from '@/lib/impressao/servico'
import { esperarComBusca } from '@/lib/impressao/despertador'

export const dynamic = 'force-dynamic'

class FalhaReserva extends Error {
  constructor(public erro: string, public status: number) { super(erro) }
}

/**
 * Fila de trabalhos (pré-conta e teste) deste computador. Só agente pareado; cada um
 * recebe apenas os trabalhos das SUAS impressoras, já reservados por 60 s
 * (FOR UPDATE SKIP LOCKED). Vencidos não voltam.
 *
 * `?esperar=N` (Assistente 0.2.0-beta.7+, até 20 s): sem trabalho, a resposta espera até
 * surgir um (aviso em tempo real — lib/impressao/despertador.ts) em vez de o Assistente
 * perguntar de novo a cada 3 s. Sem o parâmetro, responde na hora, como sempre.
 */
export async function GET(request: Request) {
  const admin = getAdminSupabase()
  const quem = await identificarAgente(admin, request)
  if (!quem) return NextResponse.json({ error: 'Credencial inválida' }, { status: 401 })
  if (quem.tipo !== 'agente') return NextResponse.json({ trabalhos: [] })
  const esperar = Math.max(0, Math.min(20, Number(new URL(request.url).searchParams.get('esperar')) || 0))
  try {
    const trabalhos = await esperarComBusca<TrabalhoAgente>(quem.restauranteId, esperar, request.signal, async () => {
      const r = await reservarTrabalhos(admin, quem.agenteId)
      if (!r.ok) throw new FalhaReserva(r.erro, r.status)
      return r.valor
    })
    return NextResponse.json({ trabalhos }, { headers: { 'Cache-Control': 'no-store', 'X-Menuzia-Espera': '20' } })
  } catch (e) {
    if (e instanceof FalhaReserva) return NextResponse.json({ error: e.erro }, { status: e.status })
    throw e
  }
}
