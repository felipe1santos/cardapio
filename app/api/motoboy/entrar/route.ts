import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getServerSupabase } from '@/lib/supabase/server'
import { buscarEmailPorUsuario, registrarLogin } from '@/lib/queries/lojistas'
import { criarLimitador, ipDaRequisicao } from '@/lib/limite-taxa'
import { pedidoDoCodigo } from '@/lib/motoboy/qr-rota'
import { registrarAuditoria } from '@/lib/auditoria'
import { nomeComparavel } from '@/lib/motoboy/login'
import { ehMotoboy, garantirEntregador } from '@/lib/motoboy/cadastro'

/**
 * Login do app do motoboy (item 61): NOME + senha, cadastrados pela loja no "+ Motoboy".
 * A senha é a do login do motoboy no Supabase Auth (hash bcrypt do próprio Auth); a sessão fica
 * nos cookies do celular até ele tocar em "Sair".
 *   · Chegou pelo QR da comanda (?qr=…): procura o nome entre os motoboys da loja do pedido.
 *   · Sem QR: o nome tem que ser de um motoboy só (senão pede o login de usuário da loja).
 *   · Também aceita o "usuário" do login da Equipe.
 * Força bruta: 10 erros por nome ou 30 por IP em 15 min travam. Motoboy desativado ou com o
 * acesso pausado não entra.
 */
const falhasPorNome = criarLimitador({ max: 10, janelaMs: 15 * 60_000 })
const falhasPorIp = criarLimitador({ max: 30, janelaMs: 15 * 60_000 })
const INVALIDO = 'Nome ou senha não conferem.'

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as { nome?: unknown; senha?: unknown; qr?: unknown } | null
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim().slice(0, 60) : ''
  const senha = typeof corpo?.senha === 'string' ? corpo.senha.slice(0, 72) : ''
  if (!nome || !senha) return NextResponse.json({ error: 'Digite o seu nome e a senha.' }, { status: 400 })
  const chaveIp = `motoboy-ip:${ipDaRequisicao(request.headers)}`
  const chaveNome = `motoboy-nome:${nomeComparavel(nome)}`
  if (falhasPorIp.excedeu(chaveIp) || falhasPorNome.excedeu(chaveNome)) {
    return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' }, { status: 429 })
  }
  const falhou = (msg = INVALIDO, status = 401) => { falhasPorIp.registrar(chaveIp); falhasPorNome.registrar(chaveNome); return NextResponse.json({ error: msg }, { status }) }

  const admin = getAdminSupabase()
  // Loja do pedido do QR (quando veio da comanda): o nome só precisa ser único lá.
  let lojaDoQr: string | null = null
  const pedidoId = typeof corpo?.qr === 'string' ? pedidoDoCodigo(corpo.qr) : null
  if (pedidoId) {
    const { data } = await admin.from('pedidos').select('restaurante_id').eq('id', pedidoId).maybeSingle()
    lojaDoQr = (data as { restaurante_id?: string } | null)?.restaurante_id ?? null
  }
  let q = admin.from('entregadores').select('id, nome, restaurante_id, usuario_id').is('desativado_em', null).not('usuario_id', 'is', null)
  if (lojaDoQr) q = q.eq('restaurante_id', lojaDoQr)
  const { data: lista } = await q.limit(2000)
  const alvo = nomeComparavel(nome)
  const candidatos = ((lista ?? []) as { id: string; nome: string; restaurante_id: string; usuario_id: string }[]).filter((e) => nomeComparavel(e.nome) === alvo)
  if (candidatos.length > 1) return falhou('Tem mais de um motoboy com esse nome. Entre pelo QR da comanda ou peça para a loja ajustar o nome.', 409)

  let email: string | null = null
  let usuarioId: string | null = candidatos[0]?.usuario_id ?? null
  if (usuarioId) {
    const { data } = await admin.auth.admin.getUserById(usuarioId)
    email = data?.user?.email ?? null
  } else if (!nome.includes(' ')) {
    email = await buscarEmailPorUsuario(admin, nome).catch(() => null)
  }
  if (!email) return falhou()

  const supabase = await getServerSupabase()
  const { data: entrou, error } = await supabase.auth.signInWithPassword({ email, password: senha })
  if (error || !entrou.user) return falhou()
  usuarioId = entrou.user.id

  const [{ data: perfil }, { data: ent0 }] = await Promise.all([
    admin.from('usuarios').select('nome, desativado_em, situacao, papel, cargo, restaurante_id').eq('id', usuarioId).maybeSingle(),
    admin.from('entregadores').select('id, restaurante_id').eq('usuario_id', usuarioId).is('desativado_em', null).maybeSingle(),
  ])
  const p = perfil as { nome?: string; desativado_em?: string | null; situacao?: string | null; papel?: string; cargo?: string | null; restaurante_id?: string } | null
  if (p?.desativado_em || ['pausado', 'bloqueado', 'excluido'].includes(p?.situacao ?? '')) {
    await supabase.auth.signOut()
    return NextResponse.json({ error: 'Seu acesso está pausado. Fale com a loja.' }, { status: 403 })
  }
  // Motoboy criado pela Equipe sem o registro de entregador (causa do "acesso pausado" de 10/10): cria agora.
  let ent = ent0
  if (!ent && ehMotoboy(p) && p?.restaurante_id) {
    const id = await garantirEntregador(admin, p.restaurante_id, usuarioId)
    if (id) ent = { id, restaurante_id: p.restaurante_id }
  }
  if (!ent) {
    await supabase.auth.signOut()
    return NextResponse.json({ error: 'Este login não é de motoboy. Entre pelo painel (app.menuzia.com.br/login) ou peça à loja o seu login de motoboy.' }, { status: 403 })
  }
  falhasPorNome.limpar(chaveNome)
  // Entrou com login e senha (10/10): o link mágico dele para de valer (token novo, ninguém conhece).
  await admin.from('entregadores').update({ token: crypto.randomUUID() }).eq('id', ent.id)
  await registrarLogin(admin, usuarioId).catch(() => {})
  registrarAuditoria(admin, {
    restauranteId: (ent as { restaurante_id: string }).restaurante_id, usuarioId, usuarioNome: `Motoboy ${p?.nome ?? nome}`.slice(0, 120),
    acao: 'sessao.entrou', entidade: 'usuario', entidadeId: usuarioId, dados: { app: 'motoboy', via: pedidoId ? 'qr' : 'nome' },
  }).catch(() => {})
  return NextResponse.json({ ok: true })
}
