/**
 * Repositório real (Supabase, chave de serviço) do fluxo de assinatura — a implementação do `Repositorio` que
 * lib/assinatura/webhook.ts recebe. Também guarda as leituras que a tela de login e o Super Admin usam.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { gerarSlugUnico } from '@/lib/queries/lojistas'
import type { Plano } from './planos'
import type { AssinaturaRegistro, Repositorio, UsuarioRegistro } from './webhook'

export function repoSupabase(admin: SupabaseClient): Repositorio {
  return {
    async registrarEvento(e) {
      const { error } = await admin.from('asaas_eventos').insert({ id: e.id, evento: e.evento, cobranca_id: e.cobrancaId, assinatura_id: e.assinaturaId })
      if (error && (error as { code?: string }).code === '23505') return 'repetido'
      if (error) throw error
      return 'novo'
    },
    async marcarEvento(id, resultado) {
      await admin.from('asaas_eventos').update({ resultado }).eq('id', id)
    },
    async desfazerEvento(id) {
      await admin.from('asaas_eventos').delete().eq('id', id).is('resultado', null)
    },
    async buscarAssinatura(asaasAssinaturaId): Promise<AssinaturaRegistro | null> {
      const { data, error } = await admin.from('assinaturas').select('id, usuario_id, restaurante_id, plano, status').eq('asaas_assinatura_id', asaasAssinaturaId).maybeSingle()
      if (error) throw error
      if (!data) return null
      return { id: data.id, usuarioId: data.usuario_id, restauranteId: data.restaurante_id, plano: data.plano as Plano, status: data.status as AssinaturaRegistro['status'] }
    },
    async buscarUsuario(usuarioId): Promise<UsuarioRegistro | null> {
      const { data, error } = await admin.from('usuarios').select('id, email, nome, usuario, nome_loja, restaurante_id, acesso_expira_em').eq('id', usuarioId).maybeSingle()
      if (error) throw error
      if (!data) return null
      return { id: data.id, email: data.email ?? '', nome: data.nome ?? '', usuario: data.usuario ?? '', nomeLoja: data.nome_loja ?? '', restauranteId: data.restaurante_id, acessoExpiraEm: data.acesso_expira_em }
    },
    async criarLoja(usuarioId, nomeLoja, acessoExpiraEm) {
      const nome = nomeLoja.trim() || 'Minha loja'
      const slug = await gerarSlugUnico(admin, nome)
      const { data: r, error } = await admin.from('restaurantes').insert({ nome, slug }).select('id').single()
      if (error || !r) throw error ?? new Error('loja não criada')
      const { error: e2 } = await admin.from('usuarios').update({ restaurante_id: r.id, papel: 'dono', autorizado: true, acesso_expira_em: acessoExpiraEm }).eq('id', usuarioId)
      if (e2) {
        await admin.from('restaurantes').delete().eq('id', r.id)
        throw e2
      }
      return { restauranteId: r.id as string, slug }
    },
    async renovarAcesso(usuarioId, acessoExpiraEm) {
      const { error } = await admin.from('usuarios').update({ autorizado: true, acesso_expira_em: acessoExpiraEm }).eq('id', usuarioId)
      if (error) throw error
    },
    async encerrarAcesso(usuarioId, quandoIso) {
      const { error } = await admin.from('usuarios').update({ acesso_expira_em: quandoIso }).eq('id', usuarioId)
      if (error) throw error
    },
    async ligarModulos(restauranteId, modulos) {
      const agora = new Date().toISOString()
      const linhas = Object.entries(modulos).map(([modulo, liberado]) => ({ restaurante_id: restauranteId, modulo, liberado, alterado_por: 'Assinatura (Asaas)', alterado_em: agora }))
      const { error } = await admin.from('loja_modulos').upsert(linhas, { onConflict: 'restaurante_id,modulo' })
      if (error) throw error
    },
    async atualizarAssinatura(id, c) {
      const campos: Record<string, unknown> = { atualizado_em: new Date().toISOString() }
      if (c.restauranteId !== undefined) campos.restaurante_id = c.restauranteId
      if (c.status !== undefined) campos.status = c.status
      if (c.ultimaCobrancaId !== undefined) campos.ultima_cobranca_id = c.ultimaCobrancaId
      if (c.ultimaFaturaUrl !== undefined) campos.ultima_fatura_url = c.ultimaFaturaUrl
      if (c.proximoVencimento !== undefined) campos.proximo_vencimento = c.proximoVencimento
      if (c.pagoEm !== undefined) campos.pago_em = c.pagoEm
      const { error } = await admin.from('assinaturas').update(campos).eq('id', id)
      if (error) throw error
    },
  }
}

export interface ResumoAssinatura { id: string; asaasAssinaturaId: string; ultimaCobrancaId: string | null; plano: Plano; status: 'aguardando' | 'em_dia' | 'atrasada' | 'cancelada'; faturaUrl: string | null; proximoVencimento: string | null }

/** Assinatura do usuário (dono), para a tela de login mostrar "Pagar agora", a conferência no login e o Super Admin. */
export async function buscarAssinaturaDoUsuario(admin: SupabaseClient, usuarioId: string): Promise<ResumoAssinatura | null> {
  const { data } = await admin.from('assinaturas').select('id, asaas_assinatura_id, ultima_cobranca_id, plano, status, ultima_fatura_url, proximo_vencimento').eq('usuario_id', usuarioId).maybeSingle()
  if (!data) return null
  return { id: data.id, asaasAssinaturaId: data.asaas_assinatura_id, ultimaCobrancaId: data.ultima_cobranca_id, plano: data.plano as Plano, status: data.status as ResumoAssinatura['status'], faturaUrl: data.ultima_fatura_url, proximoVencimento: data.proximo_vencimento }
}

/** Só links de fatura do próprio Asaas entram num botão "Pagar agora". */
export function urlDeFaturaAsaas(url: string | null | undefined): string | null {
  if (!url) return null
  return /^https:\/\/(www\.|sandbox\.)?asaas\.com\//.test(url) ? url : null
}
