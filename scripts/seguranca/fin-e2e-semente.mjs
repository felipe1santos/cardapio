/**
 * Semente das suítes do financeiro (local). Lojas PRÓPRIAS — fin-e2e-a e fin-e2e-b — porque o
 * livro-caixa e a auditoria são imutáveis: os lançamentos de teste ficam para sempre e não podem
 * prender turnos de outras suítes (ex.: e2e-caixa-turnos apaga os turnos da cantina-pdv2).
 * Idempotente: roda quantas vezes precisar.
 */
import { createClient } from '@supabase/supabase-js'

export const SENHA_DONO_FIN = 'demo-local-123456'
export const DONO_FIN = 'dono@fin-a.local'

export async function semearFin(db, { API_URL, SERVICE_KEY }) {
  const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const um = async (s, p = []) => (await db.query(s, p)).rows[0]
  async function loja(slug, nome) {
    return (await um(`insert into restaurantes (nome, slug, status_loja) values ($1,$2,'aberto_manual')
      on conflict (slug) do update set nome=excluded.nome returning id`, [nome, slug])).id
  }
  async function usuario(email, login, papel, restaurante) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA_DONO_FIN, email_confirm: true })
    if (error && !/already/i.test(error.message)) throw error
    let uid = data?.user?.id
    if (!uid) {
      const { data: l } = await admin.auth.admin.listUsers({ perPage: 1000 })
      uid = l.users.find((u) => u.email === email).id
      await admin.auth.admin.updateUserById(uid, { password: SENHA_DONO_FIN, ban_duration: 'none' })
    }
    await db.query(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,$3::papel_usuario,$4,$5,$6,true)
      on conflict (id) do update set restaurante_id=excluded.restaurante_id, papel=excluded.papel, autorizado=true, desativado_em=null, situacao=null, acessos=null, usuario=excluded.usuario,
        pin_hash=null, pin_falhas=0, pin_bloqueado_ate=null, pin_definido_em=null`,
    [uid, restaurante, papel, login === 'dono.fina' ? 'Dono Fin' : login, email, login])
    return uid
  }
  const A = await loja('fin-e2e-a', 'Lanchonete Financeiro A')
  const B = await loja('fin-e2e-b', 'Lanchonete Financeiro B')
  await usuario(DONO_FIN, 'dono.fina', 'dono', A)
  await usuario('dono@fin-b.local', 'dono.finb', 'dono', B)
  // Uma conta fechada para pendurar os pagamentos de teste (o gatilho não olha o status).
  let comanda = await um(`select id from comandas where restaurante_id=$1 and status='fechada' limit 1`, [A])
  if (!comanda) comanda = await um(`insert into comandas (restaurante_id, status, tipo, cliente_nome) values ($1,'fechada','balcao','TESTE financeiro') returning id`, [A])
  // Nenhum caixa aberto ao começar.
  await db.query(`update caixa_turnos set fechado_em=now(), fechado_por_nome='e2e (limpeza)' where restaurante_id in ($1,$2) and fechado_em is null`, [A, B])
  return { A, B, comandaId: comanda.id }
}
