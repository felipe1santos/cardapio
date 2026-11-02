'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { validarAssinar } from '@/lib/assinatura/cadastro'
import { iniciarAssinatura } from '@/lib/assinatura/fluxo'
import { criarLimitador, ipDaRequisicao } from '@/lib/limite-taxa'

// Cada envio cria usuário e cobrança no Asaas: 5 por IP a cada 10 min segura script e dedo nervoso.
const enviosPorIp = criarLimitador({ max: 5, janelaMs: 10 * 60_000 })

export async function assinar(formData: FormData) {
  const plano = String(formData.get('plano') ?? '')
  const voltar = (msg: string): never => redirect(`/assinar?plano=${encodeURIComponent(plano)}&error=${encodeURIComponent(msg)}`)

  const ip = ipDaRequisicao(await headers())
  if (enviosPorIp.excedeu(ip)) voltar('Muitas tentativas. Aguarde alguns minutos e tente de novo.')

  const v = validarAssinar(Object.fromEntries(formData.entries()), formData.get('confirmarSenha'))
  if (!v.ok) return voltar(v.erro)

  enviosPorIp.registrar(ip)
  const r = await iniciarAssinatura(getAdminSupabase(), v.dados)
  if (!r.ok) return voltar(r.erro)
  redirect(r.faturaUrl)
}
