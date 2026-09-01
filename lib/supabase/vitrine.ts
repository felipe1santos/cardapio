import { PostgrestClient } from '@supabase/postgrest-js'

/**
 * Client de LEITURA da vitrine pública.
 *
 * A vitrine usava `createBrowserClient` (@supabase/ssr), que instancia o
 * `SupabaseClient` inteiro — e o construtor dele monta Auth, Realtime, Storage e
 * Functions de uma vez. Resultado medido no bundle da rota `/loja/[slug]`:
 * 208 KB descompactados de auth-js, realtime-js, phoenix, storage-js,
 * functions-js e buffer que a vitrine nunca chama (59 KB transferidos, 28% do
 * JS inicial).
 *
 * A vitrine faz exatamente oito `select` e mais nada: não usa Supabase Auth (a
 * sessão do cliente é telefone + token em localStorage, validada pelas rotas
 * `/api/loja/[slug]/...`), não abre canal Realtime e não sobe arquivo. As nove
 * tabelas que ela lê têm policy de SELECT para `public`, então a chave anon
 * basta — é o mesmo acesso que o client antigo tinha, sem sessão.
 *
 * Por isso aqui entra só o PostgREST. O admin continua em
 * `lib/supabase/client.ts` com o client completo: nada muda para ele.
 */

let client: PostgrestClient | undefined

export function getVitrineSupabase(): PostgrestClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    client = new PostgrestClient(`${url}/rest/v1`, {
      // O gateway do Supabase exige `apikey`; o `Authorization` é o que define o
      // papel da requisição. Sem sessão, os dois carregam a anon — idêntico ao
      // que o supabase-js enviava nesta página.
      headers: { apikey: chave, Authorization: `Bearer ${chave}` },
    })
  }
  return client
}

/**
 * O mínimo que uma função de consulta precisa receber.
 *
 * Existe para que os helpers públicos de `lib/queries` aceitem tanto este client
 * enxuto quanto o `SupabaseClient` completo que o admin e o servidor usam — o
 * `buscarRestaurantePorSlug`, por exemplo, roda nos dois lados.
 */
export type ClienteLeitura = Pick<PostgrestClient, 'from'>
