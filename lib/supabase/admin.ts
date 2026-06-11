import { createClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase com a chave service_role — IGNORA RLS. Uso EXCLUSIVO no
 * servidor (route handlers / server actions). Nunca importe em componentes
 * client. Usado, por exemplo, para a vitrine pública criar um pedido sem login
 * e para o servidor calcular o total a partir dos preços reais do banco.
 */
export function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
