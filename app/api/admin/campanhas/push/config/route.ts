import { NextResponse } from 'next/server'
import { lojaDoPainel } from '@/lib/push/painel'
import { TETO_DIA, TETO_SEMANA } from '@/lib/push/regras'
import { soDigitos } from '@/lib/push/motor'

/** Limites de frequência, antecedência antes de abrir e telefone de teste da loja. */
export async function PUT(request: Request) {
  const c = await lojaDoPainel()
  if ('erro' in c) return c.erro
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const limiteDia = Math.round(Number(b.limiteDia))
  const limiteSemana = Math.round(Number(b.limiteSemana))
  const antecedenciaMin = Math.round(Number(b.antecedenciaMin))
  if (!(limiteDia >= 0 && limiteDia <= TETO_DIA)) return NextResponse.json({ error: `Por dia: de 0 a ${TETO_DIA}.` }, { status: 400 })
  if (!(limiteSemana >= 0 && limiteSemana <= TETO_SEMANA)) return NextResponse.json({ error: `Por semana: de 0 a ${TETO_SEMANA}.` }, { status: 400 })
  if (limiteSemana < limiteDia) return NextResponse.json({ error: 'O limite da semana não pode ser menor que o do dia.' }, { status: 400 })
  if (!(antecedenciaMin >= 0 && antecedenciaMin <= 120)) return NextResponse.json({ error: 'Antes de abrir: de 0 a 120 minutos.' }, { status: 400 })
  const telBruto = typeof b.telefoneTeste === 'string' ? b.telefoneTeste.trim() : ''
  const telefoneTeste = telBruto ? soDigitos(telBruto) : null
  if (telBruto && !telefoneTeste) return NextResponse.json({ error: 'Telefone de teste inválido. Use DDD + número.' }, { status: 400 })
  const { error } = await c.admin.from('push_config').upsert({
    restaurante_id: c.loja.id, limite_dia: limiteDia, limite_semana: limiteSemana, antecedencia_min: antecedenciaMin, telefone_teste: telefoneTeste, atualizado_em: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  return NextResponse.json({ ok: true, telefoneTeste })
}
