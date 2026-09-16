/**
 * Resolve as chaves da stack local SEM versionar credencial nenhuma.
 *
 * Ordem: variáveis de ambiente → `supabase status -o json`. As chaves do
 * ambiente local são geradas pela CLI na máquina de quem roda; nada disso mora
 * no repositório.
 */

import { execFileSync } from 'node:child_process'

let cacheStatus

function status() {
  if (cacheStatus) return cacheStatus
  try {
    const saida = execFileSync('npx', ['--no-install', 'supabase', 'status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    })
    cacheStatus = JSON.parse(saida.slice(saida.indexOf('{')))
  } catch {
    console.error(
      '\n❌ Stack local não respondeu. Suba com `npx supabase start` ou exporte ' +
        'DB_URL, API_URL, ANON_KEY e SERVICE_KEY.\n',
    )
    process.exit(1)
  }
  return cacheStatus
}

export function chavesLocais() {
  const env = process.env
  if (env.DB_URL && env.API_URL && env.ANON_KEY) {
    return {
      DB_URL: env.DB_URL,
      API_URL: env.API_URL,
      ANON_KEY: env.ANON_KEY,
      SERVICE_KEY: env.SERVICE_KEY ?? '',
    }
  }
  const s = status()
  return {
    DB_URL: env.DB_URL ?? s.DB_URL,
    API_URL: env.API_URL ?? s.API_URL,
    ANON_KEY: env.ANON_KEY ?? s.ANON_KEY,
    SERVICE_KEY: env.SERVICE_KEY ?? s.SERVICE_ROLE_KEY,
  }
}

/** Recusa qualquer alvo que não seja loopback — estes scripts sondam escrita. */
export function exigirLoopback(...urls) {
  for (const u of urls) {
    if (!u) continue
    const host = new URL(u.replace(/^postgres(ql)?:/, 'http:')).hostname
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      console.error(`\n❌ "${host}" não é loopback. Estes scripts só rodam no ambiente local.\n`)
      process.exit(1)
    }
  }
}
