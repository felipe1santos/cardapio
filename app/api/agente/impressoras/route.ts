import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { identificarAgente } from '@/lib/impressao/credenciais'
import { descobrir } from '@/lib/impressao/servico'
import { tentarPassarParaNovo } from '@/lib/impressao/passar-para-novo'
import { marcarDescobertaGravada, precisaGravarDescoberta } from '@/lib/impressao/descoberta-memo'

/**
 * Descoberta: o Assistente pareado manda os nomes das impressoras instaladas no Windows.
 * Ficam ligadas a ESTE computador. As que sumiram viram indisponíveis — nenhuma é trocada
 * por outra automaticamente.
 */
export async function POST(request: Request) {
  const admin = getAdminSupabase()
  const quem = await identificarAgente(admin, request)
  if (!quem) return NextResponse.json({ error: 'Credencial inválida' }, { status: 401 })
  if (quem.tipo !== 'agente') return NextResponse.json({ error: 'Pareie este computador com um código para usar várias impressoras.' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  // Beta 0.2+: `diagnosticos` = o que o Windows informa de cada impressora (DPI, papel, área).
  // Lista igual à última gravada (e há menos de 30 min): não toca no banco. Lista inválida segue para
  // `descobrir`, que devolve o erro de sempre.
  const nomes = Array.isArray(corpo?.impressoras) && corpo.impressoras.every((n) => typeof n === 'string') ? (corpo.impressoras as string[]) : null
  if (nomes && !precisaGravarDescoberta(quem.agenteId, nomes, corpo?.diagnosticos)) {
    // A passagem automática decide quem imprime e rodava a cada minuto dentro de `descobrir`: continua rodando.
    await tentarPassarParaNovo(admin, quem.agenteId).catch((e) => console.error('[passagem automática]', (e as Error).message))
    return NextResponse.json({ ok: true, total: nomes.length, semMudanca: true })
  }
  const r = await descobrir(admin, quem.agenteId, corpo?.impressoras, corpo?.diagnosticos)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  if (nomes) marcarDescobertaGravada(quem.agenteId, nomes, corpo?.diagnosticos)
  return NextResponse.json({ ok: true, total: r.valor })
}
