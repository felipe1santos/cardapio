/**
 * Sobe o Next apontado para a STACK LOCAL, nunca para produção.
 *
 * O `.env.local` deste repositório aponta para o Supabase real. `next build` inlina as
 * `NEXT_PUBLIC_*` no bundle, então buildar sem cuidado gera um servidor "local" que fala
 * com o banco de produção. Este script resolve as chaves locais pela CLI do Supabase,
 * recusa qualquer alvo que não seja loopback e só então chama build/start.
 *
 *   node scripts/seguranca/servidor-local.mjs build     # compila com as chaves locais
 *   node scripts/seguranca/servidor-local.mjs start     # sobe em 127.0.0.1:3999
 */

import { spawn } from 'node:child_process'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const acao = process.argv[2]
if (!['build', 'start'].includes(acao)) {
  console.error('\nUso: node scripts/seguranca/servidor-local.mjs build|start\n')
  process.exit(1)
}

const { DB_URL, API_URL, ANON_KEY, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, API_URL)
if (!SERVICE_KEY) {
  console.error('\n❌ SERVICE_KEY ausente. Rode `npx supabase start` ou exporte as chaves.\n')
  process.exit(1)
}

const PORTA = process.env.PORTA ?? '3999'

// process.env tem precedência sobre .env.local no carregador do Next, então isto
// sobrescreve as chaves de produção do arquivo.
const ambiente = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  DATABASE_URL: DB_URL,
  // Integrações externas ficam de fora: teste local não manda WhatsApp para ninguém.
  EVOLUTION_API_URL: '',
  EVOLUTION_API_KEY: '',
  NODE_ENV: 'production',
}

// Sem `-H`: com o host fixado, `request.nextUrl` do middleware passa a montar as
// URLs de redirecionamento com o hostname da flag em vez do Host da requisição.
// Quem entra por 127.0.0.1 é jogado em localhost e perde o cookie de sessão, que é
// preso ao host — e todo teste de redirecionamento por papel cai no login.
const args = acao === 'build' ? ['next', 'build'] : ['next', 'start', '-p', PORTA]
const filho = spawn('npx', args, { env: ambiente, stdio: 'inherit', shell: process.platform === 'win32' })
filho.on('exit', (codigo) => process.exit(codigo ?? 1))
