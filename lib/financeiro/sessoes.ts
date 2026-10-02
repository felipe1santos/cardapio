import type { SupabaseClient } from '@supabase/supabase-js'
import { criarAlerta } from './alertas'

/**
 * Sessões de login (0132): cada entrada fica registrada com IP e dispositivo; o painel avisa a
 * cada poucos minutos que continua aberto (ping). O MESMO login ativo em dois terminais ao mesmo
 * tempo gera alerta para o dono (login compartilhado).
 */
export const JANELA_ATIVA_MIN = 10

export interface DadosSessao { usuarioId: string; usuarioNome: string; restauranteId: string | null; ip: string | null; dispositivo: string; terminal: string | null }

export async function registrarSessao(admin: SupabaseClient, s: DadosSessao): Promise<string | null> {
  // Novo login neste terminal substitui o anterior do mesmo usuário (e desfaz uma trava antiga).
  if (s.terminal) await encerrarSessoes(admin, s.usuarioId, 'novo_login', s.terminal)
  const { data, error } = await admin.from('usuarios_sessoes').insert({
    restaurante_id: s.restauranteId, usuario_id: s.usuarioId, ip: s.ip, dispositivo: s.dispositivo.slice(0, 300), terminal: s.terminal,
  }).select('id').single()
  if (error) { console.error('[sessões] não registrei:', error.message); return null }
  await conferirSimultaneo(admin, s)
  return data.id as string
}

/** Atualiza o "visto em" da sessão deste terminal (ou cria) e confere login simultâneo. */
export async function pingSessao(admin: SupabaseClient, s: DadosSessao): Promise<void> {
  const q = admin.from('usuarios_sessoes').select('id').eq('usuario_id', s.usuarioId).is('encerrada_em', null).order('visto_em', { ascending: false }).limit(1)
  const { data } = s.terminal ? await q.eq('terminal', s.terminal) : await q.is('terminal', null)
  if (data?.[0]) await admin.from('usuarios_sessoes').update({ visto_em: new Date().toISOString(), ip: s.ip }).eq('id', data[0].id)
  else await admin.from('usuarios_sessoes').insert({ restaurante_id: s.restauranteId, usuario_id: s.usuarioId, ip: s.ip, dispositivo: s.dispositivo.slice(0, 300), terminal: s.terminal })
  await conferirSimultaneo(admin, s)
}

export async function encerrarSessoes(admin: SupabaseClient, usuarioId: string, motivo: string, terminal?: string | null): Promise<void> {
  let q = admin.from('usuarios_sessoes').update({ encerrada_em: new Date().toISOString(), motivo_encerramento: motivo.slice(0, 80) }).eq('usuario_id', usuarioId).is('encerrada_em', null)
  if (terminal) q = q.eq('terminal', terminal)
  await q
}

/** Trava (true) ou destrava (false) a sessão deste terminal. */
export async function travarSessao(admin: SupabaseClient, s: DadosSessao, travar: boolean): Promise<void> {
  if (!s.terminal) return
  const { data } = await admin.from('usuarios_sessoes').select('id').eq('usuario_id', s.usuarioId).eq('terminal', s.terminal).is('encerrada_em', null).limit(1)
  if (data?.[0]) await admin.from('usuarios_sessoes').update({ bloqueada_em: travar ? new Date().toISOString() : null }).eq('usuario_id', s.usuarioId).eq('terminal', s.terminal).is('encerrada_em', null)
  else if (travar) await admin.from('usuarios_sessoes').insert({ restaurante_id: s.restauranteId, usuario_id: s.usuarioId, ip: s.ip, dispositivo: s.dispositivo.slice(0, 300), terminal: s.terminal, bloqueada_em: new Date().toISOString() })
}

async function conferirSimultaneo(admin: SupabaseClient, s: DadosSessao) {
  if (!s.restauranteId || !s.terminal) return
  const desde = new Date(Date.now() - JANELA_ATIVA_MIN * 60_000).toISOString()
  const { data } = await admin.from('usuarios_sessoes').select('terminal, ip, dispositivo').eq('usuario_id', s.usuarioId).is('encerrada_em', null)
    .gte('visto_em', desde).neq('terminal', s.terminal).limit(3)
  if (!data?.length) return
  await criarAlerta(admin, {
    restauranteId: s.restauranteId, tipo: 'login_simultaneo', gravidade: 'atencao',
    mensagem: `O login de ${s.usuarioNome} está aberto em ${data.length + 1} aparelhos ao mesmo tempo (${[s.dispositivo, ...data.map((d) => d.dispositivo)].join(' / ')}). Cada pessoa deve usar o próprio login.`,
    usuario: { id: s.usuarioId, nome: s.usuarioNome }, dados: { usuario_id: s.usuarioId }, dedupeMin: 30, dedupeChave: s.usuarioId,
  })
}
