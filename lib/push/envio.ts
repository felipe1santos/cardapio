/**
 * Envio das notificações push (2026-10-01): fila em `push_envios` (0127), web-push com VAPID.
 *
 * Chaves só em variável de ambiente (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) —
 * nunca no repositório. Trocar as chaves invalida TODAS as assinaturas: não trocar.
 *
 * PUSH_PROVEDOR=simulado (só testes locais): não sai nada pela rede; cada envio vira uma linha em
 * PUSH_SIMULADO_ARQUIVO, e endpoint com "expirada" responde 410.
 */
import { appendFileSync } from 'node:fs'
import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'

export const MAX_TENTATIVAS = 3
export const FALHAS_PARA_INVALIDAR = 5

export function chavePublicaVapid(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null
}

/** Push só existe com as duas chaves configuradas no servidor. */
export function pushConfigurado(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim())
}

export interface DestinoPush { endpoint: string; p256dh: string; auth: string }
export type ResultadoEnvio = { ok: true } | { ok: false; status?: number; erro: string }
export type Remetente = (destino: DestinoPush, payload: string, opcoes: { ttl: number; urgente: boolean }) => Promise<ResultadoEnvio>

let vapidPronto = false
function prepararVapid() {
  if (vapidPronto) return
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || 'mailto:suporte@menuzia.com.br',
    process.env.VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim(),
  )
  vapidPronto = true
}

const remetenteWebPush: Remetente = async (d, payload, o) => {
  prepararVapid()
  try {
    await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, {
      TTL: o.ttl,
      urgency: o.urgente ? 'high' : 'normal',
      timeout: 15_000,
    })
    return { ok: true }
  } catch (e) {
    const err = e as { statusCode?: number; body?: string; message?: string }
    return { ok: false, status: err.statusCode, erro: String(err.body || err.message || 'falha').slice(0, 300) }
  }
}

const remetenteSimulado: Remetente = async (d, payload) => {
  const arquivo = process.env.PUSH_SIMULADO_ARQUIVO
  if (arquivo) appendFileSync(arquivo, JSON.stringify({ em: new Date().toISOString(), endpoint: d.endpoint, payload: JSON.parse(payload) }) + '\n')
  if (d.endpoint.includes('expirada')) return { ok: false, status: 410, erro: 'expirada (simulado)' }
  if (d.endpoint.includes('instavel')) return { ok: false, status: 503, erro: 'indisponível (simulado)' }
  return { ok: true }
}

export function remetenteAtual(): Remetente {
  return process.env.PUSH_PROVEDOR === 'simulado' ? remetenteSimulado : remetenteWebPush
}

/** 404/410: o navegador desfez a assinatura — não adianta tentar de novo. */
export function assinaturaExpirada(status?: number): boolean {
  return status === 404 || status === 410
}

/** Espera antes da próxima tentativa: 2, 4, 8… minutos. */
export function esperaRetentativaMs(tentativas: number): number {
  return Math.min(60, 2 ** Math.max(1, tentativas)) * 60_000
}

export interface ResumoFila { processados: number; enviados: number; falhas: number; invalidas: number }

/**
 * Processa um lote da fila: reserva (função atômica da 0127), envia e grava o resultado.
 * Assinatura expirada → `invalida` e o envio também; falha temporária → nova tentativa com
 * espera crescente até MAX_TENTATIVAS; 5 falhas seguidas → assinatura `invalida`.
 */
export async function processarFilaPush(admin: SupabaseClient, opcoes: { limite?: number; remetente?: Remetente; ids?: string[] } = {}): Promise<ResumoFila> {
  const resumo: ResumoFila = { processados: 0, enviados: 0, falhas: 0, invalidas: 0 }
  if (!pushConfigurado() && process.env.PUSH_PROVEDOR !== 'simulado') return resumo
  const remetente = opcoes.remetente ?? remetenteAtual()

  const { data: reservados, error } = await admin.rpc('push_reservar_envios', { p_limite: opcoes.limite ?? 100 })
  if (error) throw new Error(`fila push: ${error.message}`)
  const ids = (reservados as string[] | null) ?? []
  if (!ids.length) return resumo

  const { data: envios } = await admin
    .from('push_envios')
    .select('id, origem, tentativas, payload, assinatura:push_assinaturas!inner(id, endpoint, p256dh, auth, status, falhas_seguidas), loja:restaurantes!inner(push_liberado)')
    .in('id', ids)

  for (const e of (envios ?? []) as unknown as Array<{
    id: string; origem: string; tentativas: number; payload: unknown
    assinatura: { id: string; endpoint: string; p256dh: string; auth: string; status: string; falhas_seguidas: number }
    loja: { push_liberado: boolean }
  }>) {
    resumo.processados++
    // Loja desligada ou assinatura que deixou de valer: descarta sem enviar.
    if (!e.loja.push_liberado || e.assinatura.status !== 'ativa') {
      await admin.from('push_envios').update({ status: 'descartado', erro: !e.loja.push_liberado ? 'loja sem push' : `assinatura ${e.assinatura.status}` }).eq('id', e.id)
      continue
    }
    const transacional = e.origem === 'status' || e.origem === 'teste'
    const r = await remetente(e.assinatura, JSON.stringify(e.payload), { ttl: transacional ? 3600 : 12 * 3600, urgente: transacional })
    const agora = new Date().toISOString()
    if (r.ok) {
      resumo.enviados++
      await admin.from('push_envios').update({ status: 'enviado', enviado_em: agora, erro: null }).eq('id', e.id)
      await admin.from('push_assinaturas').update({ ultimo_sucesso_em: agora, falhas_seguidas: 0, atualizado_em: agora }).eq('id', e.assinatura.id)
      continue
    }
    if (assinaturaExpirada(r.status)) {
      resumo.invalidas++
      await admin.from('push_envios').update({ status: 'invalida', erro: r.erro }).eq('id', e.id)
      await admin.from('push_assinaturas').update({ status: 'invalida', atualizado_em: agora }).eq('id', e.assinatura.id)
      continue
    }
    resumo.falhas++
    const falhas = e.assinatura.falhas_seguidas + 1
    const desistir = e.tentativas >= MAX_TENTATIVAS
    await admin.from('push_envios').update(
      desistir
        ? { status: 'falhou', erro: r.erro }
        : { erro: r.erro, proxima_tentativa_em: new Date(Date.now() + esperaRetentativaMs(e.tentativas)).toISOString() },
    ).eq('id', e.id)
    await admin.from('push_assinaturas').update({
      falhas_seguidas: falhas,
      ...(falhas >= FALHAS_PARA_INVALIDAR ? { status: 'invalida' } : {}),
      atualizado_em: agora,
    }).eq('id', e.assinatura.id)
  }
  return resumo
}
