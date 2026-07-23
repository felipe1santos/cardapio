import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

// Singleton: cada chamada usada a criar um client (e uma conexão Realtime)
// novos, mesmo que o componente que os invocava já tivesse um aberto — em
// remontagens (trocar de aba do admin e voltar) isso vazava conexões/canais
// WebSocket ao longo do turno.
export function getBrowserSupabase() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}
