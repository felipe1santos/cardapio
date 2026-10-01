import { NextResponse } from 'next/server'
import { lojaDoPainel } from '@/lib/push/painel'
import { TEXTOS_PADRAO, VARIAVEIS_DO_TIPO } from '@/lib/push/conteudo'
import type { TipoAutomacao } from '@/lib/push/regras'

/** Parâmetros numéricos aceitos por automação (dias etc.) com os limites de cada um. */
const PARAMS: Partial<Record<TipoAutomacao, Record<string, [number, number]>>> = {
  recompra: { dias: [1, 60] },
  inativo: { dias: [2, 180], repetir_dias: [3, 90] },
}

/** Liga/desliga uma automação, com título, texto e parâmetros. */
export async function PUT(request: Request) {
  const c = await lojaDoPainel()
  if ('erro' in c) return c.erro
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const tipo = String(b.tipo ?? '') as TipoAutomacao
  if (!(tipo in TEXTOS_PADRAO)) return NextResponse.json({ error: 'Automação desconhecida.' }, { status: 400 })
  const titulo = String(b.titulo ?? '').trim().slice(0, 60)
  const texto = String(b.texto ?? '').trim()
  if (tipo !== 'status_pedido' && !texto) return NextResponse.json({ error: 'Escreva o texto da notificação.' }, { status: 400 })
  if (texto.length > 200) return NextResponse.json({ error: 'Texto com até 200 caracteres.' }, { status: 400 })
  // Variável que a automação não conhece sairia em branco: avisa antes de salvar.
  const aceitas = new Set(VARIAVEIS_DO_TIPO[tipo])
  const desconhecidas = [...`${titulo} ${texto}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => !aceitas.has(v))
  if (desconhecidas.length) return NextResponse.json({ error: `Variável que esta automação não usa: {${desconhecidas[0]}}.` }, { status: 400 })

  const params: Record<string, unknown> = {}
  const entrada = (b.params && typeof b.params === 'object' ? b.params : {}) as Record<string, unknown>
  for (const [k, [min, max]] of Object.entries(PARAMS[tipo] ?? {})) {
    if (entrada[k] === undefined) continue
    const v = Math.round(Number(entrada[k]))
    if (!(v >= min && v <= max)) return NextResponse.json({ error: `${k.replace('_', ' ')}: de ${min} a ${max}.` }, { status: 400 })
    params[k] = v
  }
  if (tipo === 'fidelidade' && typeof entrada.texto_premio === 'string') params.texto_premio = entrada.texto_premio.trim().slice(0, 200)

  const { error } = await c.admin.from('push_automacoes').upsert({
    restaurante_id: c.loja.id, tipo, ativo: Boolean(b.ativo), titulo, texto, params, atualizado_em: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
