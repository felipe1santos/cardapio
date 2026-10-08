import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { criarFuncionario, validarSenha } from '@/lib/queries/equipe'
import { nomeComparavel, usuarioDoNome } from '@/lib/motoboy/login'

/**
 * "+ Motoboy" da tela de Despacho (item 61): cria o motoboy E o login do app de uma vez.
 *   POST { nome, senha, telefone? } → { ok, id, usuario }
 * O motoboy entra no app com o NOME e a senha. O nome não pode repetir na loja (é o que ele
 * digita). Quem cria precisa de logistica.operar + equipe.gerenciar (as mesmas do "Criar login").
 */
export async function POST(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!pode(sessao.papel, 'logistica.operar') || !pode(sessao.papel, 'equipe.gerenciar')) {
    return NextResponse.json({ error: 'Só quem gerencia a Equipe cadastra motoboy.' }, { status: 403 })
  }
  const corpo = (await request.json().catch(() => null)) as { nome?: unknown; senha?: unknown; telefone?: unknown } | null
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
  const senha = typeof corpo?.senha === 'string' ? corpo.senha : ''
  const telefone = typeof corpo?.telefone === 'string' ? corpo.telefone.replace(/\D/g, '').slice(0, 13) : ''
  if (nomeComparavel(nome).length < 2) return NextResponse.json({ error: 'Digite o nome do motoboy.' }, { status: 400 })
  const erros = validarSenha(senha)
  if (erros.length) return NextResponse.json({ error: erros[0] }, { status: 400 })

  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const loja = sessao.restauranteId
  const { data: existentes } = await admin.from('entregadores').select('nome').eq('restaurante_id', loja).is('desativado_em', null)
  if ((existentes ?? []).some((e) => nomeComparavel(e.nome as string) === nomeComparavel(nome))) {
    return NextResponse.json({ error: 'Já existe um motoboy com esse nome nesta loja. Use um nome diferente (ex.: com o sobrenome).' }, { status: 409 })
  }

  const { data: novo, error } = await admin.from('entregadores')
    .insert({ restaurante_id: loja, nome, telefone, status: 'online', veiculo: '', placa: '' })
    .select('id').single()
  if (error || !novo) return NextResponse.json({ error: 'Não foi possível cadastrar o motoboy.' }, { status: 500 })

  // Login técnico a partir do nome; se já existir em outra loja, tenta com um número no fim.
  const base = usuarioDoNome(nome)
  let criado: { id: string; usuario: string } | null = null
  let erroLogin = 'Não foi possível criar o login.'
  for (let i = 0; i < 6 && !criado; i++) {
    const usuario = i === 0 ? base : `${base.slice(0, 26)}.${Math.floor(Math.random() * 900 + 100)}`
    const r = await criarFuncionario(admin, { restauranteId: loja, nome, usuario, papel: 'entregador', senha, criadoPor: sessao.userId, cargo: 'motoboy', telefone })
    if (r.ok) criado = { id: r.valor.id, usuario: r.valor.usuario }
    else { erroLogin = r.erro; if (!/em uso/i.test(r.erro)) break }
  }
  if (!criado) {
    await admin.from('entregadores').delete().eq('id', novo.id)
    return NextResponse.json({ error: erroLogin }, { status: 409 })
  }
  await admin.from('entregadores').update({ usuario_id: criado.id }).eq('id', novo.id)
  await registrarAuditoria(admin, {
    restauranteId: loja, usuarioId: sessao.userId, usuarioNome: sessao.nome, acao: 'entregador.criou_login',
    entidade: 'entregador', entidadeId: novo.id as string, dados: { entregador: nome, login: criado.usuario, via: 'despacho' },
  }).catch(() => {})
  return NextResponse.json({ ok: true, id: novo.id, usuario: criado.usuario })
}
