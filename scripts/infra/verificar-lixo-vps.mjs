/**
 * Verificador de lixo na VPS (04/11/2026). Rodar DEPOIS DE CADA DEPLOY (regra no CLAUDE.md) — só LEITURA, não apaga nada.
 * Doc: docs/infra/LIMPEZA-VPS.md
 *
 * Confere, por SSH:
 *   · disco e memória;
 *   · quantas imagens de cada app do Coolify existem (o Menuzia guarda 2: a no ar e a anterior);
 *   · tamanho do cache de build;
 *   · se a limpeza automática do Coolify (a cada 6 h) rodou recentemente e se foi efetiva ou pulou o cache.
 * Saída: relatório + "OK" ou a lista do que precisa de atenção (e o comando sugerido para limpar).
 *
 *   npm run vps:lixo
 *
 * Precisa de VPS_HOST e VPS_SSH_KEY no .env.local (fora do git: o repositório é público).
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MENUZIA_APP = 'co0swg8ko4scg0g4ssgwosww'
const IMAGENS_GUARDADAS = 2 // a no ar + a anterior (docker_images_to_keep no Coolify)
const CACHE_ALERTA_GB = 8 // cache de build acima disso: a limpeza não está dando conta
const DISCO_ALERTA_PCT = 70
const LIMPEZA_MAX_HORAS = 7 // roda a cada 6 h; mais que 7 h sem rodar = parou

if (existsSync('.env.local')) {
  for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const i = l.indexOf('=')
    if (i > 0 && !l.trim().startsWith('#')) {
      const k = l.slice(0, i).trim()
      const v = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!(k in process.env)) process.env[k] = v
    }
  }
}
const host = process.env.VPS_HOST
const chave = (process.env.VPS_SSH_KEY ?? '').replace(/^~/, homedir())
if (!host || !chave) {
  console.error('Faltam VPS_HOST e VPS_SSH_KEY no .env.local. Nada foi verificado.')
  process.exit(2)
}

const ssh = (cmd) => execFileSync('ssh', ['-i', chave, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host, cmd], { encoding: 'utf8', timeout: 90_000 })

const remoto = ssh([
  `echo "#DISCO"; df -P / | tail -1`,
  `echo "#MEM"; free -m | sed -n 2p`,
  `echo "#IMAGENS"; docker images --format '{{.Repository}}|{{.Tag}}|{{.Size}}'`,
  `echo "#EMUSO"; docker ps --format '{{.Image}}'`,
  `echo "#CACHE"; docker system df --format '{{.Type}}|{{.Size}}|{{.Reclaimable}}'`,
  `echo "#LIMPEZA"; docker exec coolify php artisan tinker --execute='echo json_encode(\\App\\Models\\DockerCleanupExecution::orderByDesc("id")->limit(3)->get(["status","message","created_at"]));' 2>/dev/null | tail -1`,
].join('; '))

const blocos = {}
let atual = null
for (const linha of remoto.split('\n')) {
  if (linha.startsWith('#')) { atual = linha.slice(1).trim(); blocos[atual] = []; continue }
  if (atual && linha.trim()) blocos[atual].push(linha.trim())
}

const atencao = []
const gb = (s) => { const m = /([\d.]+)\s*([KMGT]?B)/i.exec(s ?? ''); if (!m) return 0; const f = { B: 1e-9, KB: 1e-6, MB: 1e-3, GB: 1, TB: 1e3 }[m[2].toUpperCase()] ?? 0; return Number(m[1]) * f }

// Disco
const disco = (blocos.DISCO?.[0] ?? '').split(/\s+/)
const pct = Number((disco[4] ?? '0').replace('%', ''))
console.log(`Disco: ${pct}% usado (${(Number(disco[2]) / 1e6).toFixed(1)} GB de ${(Number(disco[1]) / 1e6).toFixed(1)} GB)`)
if (pct >= DISCO_ALERTA_PCT) atencao.push(`Disco em ${pct}% (limite de atenção ${DISCO_ALERTA_PCT}%).`)

// Memória
const mem = (blocos.MEM?.[0] ?? '').split(/\s+/)
console.log(`Memória: ${mem[6] ?? '?'} MB disponíveis de ${mem[1] ?? '?'} MB`)

// Imagens por app
const emUso = new Set(blocos.EMUSO ?? [])
const porRepo = new Map()
for (const l of blocos.IMAGENS ?? []) {
  const [repo, tag, tam] = l.split('|')
  if (!porRepo.has(repo)) porRepo.set(repo, [])
  porRepo.get(repo).push({ tag, tam, emUso: emUso.has(`${repo}:${tag}`) })
}
const menuzia = porRepo.get(MENUZIA_APP) ?? []
console.log(`Imagens do Menuzia: ${menuzia.length} (guardar ${IMAGENS_GUARDADAS}) — em uso: ${menuzia.filter((i) => i.emUso).map((i) => i.tag.slice(0, 8)).join(', ') || 'nenhuma?'}`)
if (menuzia.length > IMAGENS_GUARDADAS + 1) {
  atencao.push(`Menuzia com ${menuzia.length} imagens (normal: ${IMAGENS_GUARDADAS}; a limpeza do Coolify apaga as sobras na próxima rodada).`)
}
// coolify-helper fica parado de propósito: o Coolify usa só durante o deploy.
const parados = [...porRepo.entries()].filter(([r, l]) => r !== 'coollabsio/coolify-helper' && l.every((i) => !i.emUso) && l.length > 0)
if (parados.length) console.log(`Imagens sem nenhum container usando: ${parados.map(([r, l]) => `${r} (${l.length})`).join(', ')}`)

// Cache de build
const cache = (blocos.CACHE ?? []).map((l) => l.split('|')).find(([t]) => /build cache/i.test(t))
const cacheGb = gb(cache?.[2])
console.log(`Cache de build: ${cache?.[1] ?? '?'} (liberável ${cache?.[2] ?? '?'})`)

// Limpeza automática do Coolify
let execs = []
try { execs = JSON.parse(blocos.LIMPEZA?.[0] ?? '[]') } catch { execs = [] }
if (!execs.length) {
  atencao.push('Não consegui ler as execuções da limpeza do Coolify.')
} else {
  const ultima = execs[0]
  const horas = (Date.now() - Date.parse(ultima.created_at)) / 3600_000
  console.log(`Última limpeza do Coolify: há ${horas.toFixed(1)} h — ${ultima.status} — ${ultima.message}`)
  if (horas > LIMPEZA_MAX_HORAS) atencao.push(`A limpeza do Coolify não roda há ${horas.toFixed(1)} h (deveria rodar a cada 6 h).`)
  if (ultima.status !== 'success') atencao.push(`A última limpeza do Coolify terminou com status "${ultima.status}".`)
  if (/Skipped/i.test(ultima.message ?? '') && cacheGb > CACHE_ALERTA_GB) {
    atencao.push(`Cache de build com ${cacheGb.toFixed(1)} GB e a última limpeza pulou o cache (havia deploy rodando). Fora de deploy: ssh … "docker builder prune -f"`)
  }
}
if (cacheGb > CACHE_ALERTA_GB * 2) atencao.push(`Cache de build muito grande (${cacheGb.toFixed(1)} GB).`)

console.log('')
if (atencao.length === 0) {
  console.log('OK — sem lixo acumulado; a limpeza automática do Coolify está dando conta.')
} else {
  console.log('Atenção:')
  for (const a of atencao) console.log(` - ${a}`)
  process.exitCode = 1
}
