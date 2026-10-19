import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { roboLiberadoNoServidor } from '@/lib/mensageria/robo'
import { ASSUNTOS, normalizarTexto, PALAVRAS_PADRAO, type Assunto } from '@/lib/robo-auto/classificador'
import { CAMPOS, camposDesconhecidos, ROTULO_TEXTO, TEXTOS_PADRAO, type ChaveTexto } from '@/lib/robo-auto/textos'
import { COLUNAS_CONFIG_AUTO } from '@/lib/robo-auto/motor'

/**
 * Robô de autoatendimento (0177) — configuração da loja da sessão (Integrações › Robô de atendimento).
 * Dono (integracoes.gerenciar). A loja vem só da sessão.
 *   GET → configuração + textos padrão (para "Restaurar padrão" e prévia) + palavras padrão
 *   PUT { ativo?, assuntosDesligados?, textos?, palavras?, tempoEntrega?, pixChave?, pixTipo? }
 */
async function contexto() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  return { sessao, admin: getAdminSupabase() }
}

const semCache = { 'Cache-Control': 'no-store' }
const CHAVES_TEXTO = Object.keys(TEXTOS_PADRAO) as ChaveTexto[]

export async function GET() {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  await admin.from('whatsapp_robo_config').upsert({ restaurante_id: sessao.restauranteId, robo_ativo: false }, { onConflict: 'restaurante_id', ignoreDuplicates: true })
  const [{ data: cfg }, { data: loja }] = await Promise.all([
    admin.from('whatsapp_robo_config').select(COLUNAS_CONFIG_AUTO).eq('restaurante_id', sessao.restauranteId).maybeSingle(),
    admin.from('restaurantes').select('nome, slug, evolution_instance').eq('id', sessao.restauranteId).maybeSingle(),
  ])
  const c = (cfg ?? {}) as Record<string, unknown>
  return NextResponse.json({
    ativo: c.autoatendimento_ativo === true,
    liberadoNoServidor: roboLiberadoNoServidor(),
    instancia: (loja?.evolution_instance as string | null) ?? null,
    nomeLoja: (loja?.nome as string) ?? '',
    assuntosDesligados: (c.auto_assuntos_desligados as string[] | null) ?? [],
    textos: (c.auto_textos as Record<string, string> | null) ?? {},
    palavras: (c.auto_palavras as Record<string, string[]> | null) ?? {},
    padrao: { textos: TEXTOS_PADRAO, rotulos: ROTULO_TEXTO, palavras: PALAVRAS_PADRAO, campos: CAMPOS, assuntos: ASSUNTOS },
  }, { headers: semCache })
}

export async function PUT(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  const patch: Record<string, unknown> = {
    restaurante_id: sessao.restauranteId, atualizado_em: new Date().toISOString(), atualizado_por: sessao.userId,
    atualizado_por_nome: (sessao.nome ?? '').slice(0, 120) || null,
  }
  const resumo: string[] = []

  if (corpo.ativo !== undefined) {
    if (typeof corpo.ativo !== 'boolean') return NextResponse.json({ error: 'Valor inválido.' }, { status: 400 })
    if (corpo.ativo && !roboLiberadoNoServidor()) return NextResponse.json({ error: 'O robô ainda não foi liberado pela Menuzia.', codigo: 'nao_liberado' }, { status: 409 })
    patch.autoatendimento_ativo = corpo.ativo
    resumo.push(corpo.ativo ? 'autoatendimento ligado' : 'autoatendimento desligado')
  }
  if (corpo.assuntosDesligados !== undefined) {
    const l = corpo.assuntosDesligados
    if (!Array.isArray(l) || l.some((a) => !(ASSUNTOS as unknown[]).includes(a))) return NextResponse.json({ error: 'Assuntos inválidos.' }, { status: 400 })
    patch.auto_assuntos_desligados = [...new Set(l as Assunto[])].filter((a) => a !== 'atendente' && a !== 'parar' && a !== 'reclamacao')
    resumo.push('assuntos')
  }
  if (corpo.textos !== undefined) {
    const t = corpo.textos as Record<string, unknown>
    if (!t || typeof t !== 'object' || Array.isArray(t)) return NextResponse.json({ error: 'Textos inválidos.' }, { status: 400 })
    const limpo: Record<string, string> = {}
    for (const [k, v] of Object.entries(t)) {
      if (!CHAVES_TEXTO.includes(k as ChaveTexto)) return NextResponse.json({ error: `Texto desconhecido: ${k}` }, { status: 400 })
      if (typeof v !== 'string') return NextResponse.json({ error: 'Texto inválido.' }, { status: 400 })
      const s = v.trim()
      if (!s || s === TEXTOS_PADRAO[k as ChaveTexto]) continue // vazio ou igual ao padrão = padrão
      if (s.length > 1500) return NextResponse.json({ error: `"${ROTULO_TEXTO[k as ChaveTexto]}": até 1500 caracteres.` }, { status: 400 })
      const desconhecidos = camposDesconhecidos(s)
      if (desconhecidos.length) return NextResponse.json({ error: `"${ROTULO_TEXTO[k as ChaveTexto]}": campo desconhecido {${desconhecidos[0]}}.` }, { status: 400 })
      if (k === 'saudacao' && !s.includes('{link_cardapio}')) return NextResponse.json({ error: 'A saudação precisa ter o {link_cardapio}.' }, { status: 400 })
      limpo[k] = s
    }
    patch.auto_textos = limpo
    resumo.push('textos')
  }
  if (corpo.palavras !== undefined) {
    const p = corpo.palavras as Record<string, unknown>
    if (!p || typeof p !== 'object' || Array.isArray(p)) return NextResponse.json({ error: 'Palavras inválidas.' }, { status: 400 })
    const limpo: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(p)) {
      if (!(ASSUNTOS as string[]).includes(k) || !Array.isArray(v)) return NextResponse.json({ error: 'Palavras inválidas.' }, { status: 400 })
      const lista = [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => normalizarTexto(x)).filter((x) => x.length >= 2 && x.length <= 60))]
      if (lista.length > 100) return NextResponse.json({ error: 'Até 100 palavras por assunto.' }, { status: 400 })
      if (lista.length) limpo[k] = lista
    }
    patch.auto_palavras = limpo
    resumo.push('palavras-chave')
  }
  // 0205: tempo de entrega e chave Pix agora são do Perfil da loja (lib/queries/ajustes.ts); aqui não se grava mais.
  if (!resumo.length) return NextResponse.json({ error: 'Nada para salvar.' }, { status: 400 })
  const { error } = await admin.from('whatsapp_robo_config').upsert(patch, { onConflict: 'restaurante_id' })
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
    acao: 'whatsapp.autoatendimento_configurado', entidade: 'restaurante', entidadeId: sessao.restauranteId, dados: { resumo: resumo.join(' · ') },
  })
  return NextResponse.json({ ok: true })
}
