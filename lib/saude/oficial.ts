/**
 * Números OFICIAIS para o Super Admin › Saúde do sistema (28/10/2026, pedido do dono). Cada fonte é opcional: sem a
 * variável, o card mostra a estimativa do sistema marcada como "estimado".
 *  · Prometheus do projeto Supabase (chave de serviço que já existe): CPU, memória, disco, disk IO, rede de saída da
 *    instância do banco e tamanho do banco. ~430 KB por leitura → no máximo a cada 15 min (~1,2 GB/mês de 250).
 *  · Management API do Supabase (SUPABASE_ACCESS_TOKEN): requisições das últimas 24 h por tipo e uso do disco.
 *    Não existe endpoint de egress do ciclo nem da cota da organização (OpenAPI de 28/10): esses ficam "estimado".
 *  · API da Hostinger (HOSTINGER_API_TOKEN; HOSTINGER_VPS_ID opcional): CPU, RAM, disco e tráfego da VPS.
 */
const REF = () => /^https:\/\/([a-z0-9]{20})\.supabase\.co/.exec(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')?.[1] ?? null

export interface Prom { cpuTotal: number; cpuIdle: number; memTotal: number; memDisp: number; discoTotal: number; discoLivre: number; ops: number; ioBytes: number; tx: number; dbBytes: number }

/** Lê o texto Prometheus (puro). Disco = /data (onde fica o banco); rede sem `lo`; banco = "postgres". */
export function lerProm(texto: string): Prom {
  const p: Prom = { cpuTotal: 0, cpuIdle: 0, memTotal: 0, memDisp: 0, discoTotal: 0, discoLivre: 0, ops: 0, ioBytes: 0, tx: 0, dbBytes: 0 }
  for (const linha of texto.split('\n')) {
    if (!linha || linha[0] === '#') continue
    const m = /^([a-zA-Z_:]+)(\{[^}]*\})?\s+(\S+)/.exec(linha)
    if (!m) continue
    const [, nome, rot = '', bruto] = m
    const v = Number(bruto)
    if (!Number.isFinite(v)) continue
    const tem = (s: string) => rot.includes(s)
    switch (nome) {
      case 'node_cpu_seconds_total': p.cpuTotal += v; if (tem('mode="idle"')) p.cpuIdle += v; break
      case 'node_memory_MemTotal_bytes': p.memTotal = v; break
      case 'node_memory_MemAvailable_bytes': p.memDisp = v; break
      case 'node_filesystem_size_bytes': if (tem('mountpoint="/data"')) p.discoTotal = v; break
      case 'node_filesystem_avail_bytes': if (tem('mountpoint="/data"')) p.discoLivre = v; break
      case 'node_disk_reads_completed_total': case 'node_disk_writes_completed_total': p.ops += v; break
      case 'node_disk_read_bytes_total': case 'node_disk_written_bytes_total': p.ioBytes += v; break
      case 'node_network_transmit_bytes_total': if (!tem('device="lo"')) p.tx += v; break
      case 'pg_database_size_bytes': if (tem('datname="postgres"')) p.dbBytes = v; break
    }
  }
  return p
}

/** Taxas entre duas leituras (puro). Contador que voltou (reinício) → null, nunca negativo. */
export function derivarProm(atual: Prom, anterior: Prom | null, segundos: number) {
  const nada = { cpuPct: null, iops: null, ioMBs: null, txDelta: null }
  if (!anterior || segundos <= 0) return nada
  const d = (k: keyof Prom) => atual[k] - anterior[k]
  if (d('cpuTotal') <= 0 || d('ops') < 0 || d('ioBytes') < 0 || d('tx') < 0) return nada
  const r1 = (n: number) => Math.round(n * 10) / 10
  return { cpuPct: r1((1 - d('cpuIdle') / d('cpuTotal')) * 100), iops: r1(d('ops') / segundos), ioMBs: r1(d('ioBytes') / segundos / 1e6), txDelta: d('tx') }
}

export function somarApiCounts(j: unknown): { rest: number; auth: number; storage: number; realtime: number; total: number } | null {
  const lista = (j as { result?: Record<string, number>[] } | null)?.result
  if (!Array.isArray(lista)) return null
  const s = { rest: 0, auth: 0, storage: 0, realtime: 0, total: 0 }
  for (const r of lista) {
    s.rest += Number(r.total_rest_requests) || 0
    s.auth += Number(r.total_auth_requests) || 0
    s.storage += Number(r.total_storage_requests) || 0
    s.realtime += Number(r.total_realtime_requests) || 0
  }
  s.total = s.rest + s.auth + s.storage + s.realtime
  return s
}

type Serie = { unit?: string; usage?: Record<string, number> } | null | undefined
const ultimo = (s: Serie): [number, number] | null => {
  const pares = Object.entries(s?.usage ?? {}).map(([t, v]) => [Number(t), Number(v)] as [number, number]).filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
  return pares.length ? pares.sort((a, b) => b[0] - a[0])[0] : null
}

/** Último ponto de cada série da Hostinger (puro). */
export function lerHostinger(j: Record<string, Serie>) {
  const cpu = ultimo(j.cpu_usage), ram = ultimo(j.ram_usage), disco = ultimo(j.disk_space), saida = ultimo(j.outgoing_traffic), entrada = ultimo(j.incoming_traffic)
  const t = Math.max(...[cpu, ram, disco, saida, entrada].map((x) => x?.[0] ?? 0))
  return { cpuPct: cpu?.[1] ?? null, ramBytes: ram?.[1] ?? null, discoBytes: disco?.[1] ?? null, saidaBytes: saida?.[1] ?? null, entradaBytes: entrada?.[1] ?? null, amostraEm: t ? new Date(t * 1000).toISOString() : null }
}

/** Dias até virar o ciclo de cobrança (o Supabase não expõe o ciclo; dia vem de SUPABASE_CICLO_DIA, padrão 28). */
export function diasAteFimDoCiclo(agora: Date, diaVira: number): number {
  const y = agora.getUTCFullYear(), m = agora.getUTCMonth()
  let fim = Date.UTC(y, m, diaVira)
  if (fim <= agora.getTime()) fim = Date.UTC(y, m + 1, diaVira)
  return Math.ceil((fim - agora.getTime()) / 86400_000)
}

/** Limites do plano Pro (página Usage do Supabase em 28/10/2026). */
export const PLANO_PRO = { egressGb: 250, storageGb: 100, discoGb: 8, logGb: 20, mau: 100_000, realtimeConexoes: 500 }

async function json(url: string, headers: Record<string, string>): Promise<unknown> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function lerPromOficial(): Promise<Prom | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) return null
  const r = await fetch(`${url}/customer/v1/privileged/metrics`, { headers: { Authorization: `Basic ${Buffer.from(`service_role:${chave}`).toString('base64')}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return lerProm(await r.text())
}

export async function lerSupabaseGestao(): Promise<{ req24h: ReturnType<typeof somarApiCounts>; disco: { usado: number; total: number } | null } | null> {
  const token = process.env.SUPABASE_ACCESS_TOKEN, ref = REF()
  if (!token || !ref) return null
  const h = { Authorization: `Bearer ${token}` }
  const base = `https://api.supabase.com/v1/projects/${ref}`
  const [contagem, util] = await Promise.all([
    json(`${base}/analytics/endpoints/usage.api-counts?interval=1day`, h).catch(() => null),
    json(`${base}/config/disk/util`, h).catch(() => null),
  ])
  const m = (util as { metrics?: { fs_used_bytes?: number; fs_size_bytes?: number } } | null)?.metrics
  return { req24h: somarApiCounts(contagem), disco: m?.fs_size_bytes ? { usado: Number(m.fs_used_bytes), total: Number(m.fs_size_bytes) } : null }
}

let vps: { id: string; ramTotal: number | null; discoTotal: number | null; em: number } | null = null
export async function lerHostingerOficial(agora = new Date()) {
  const token = process.env.HOSTINGER_API_TOKEN
  if (!token) return null
  const h = { Authorization: `Bearer ${token}` }
  const base = 'https://developers.hostinger.com/api/vps/v1/virtual-machines'
  if (!vps || agora.getTime() - vps.em > 3600_000) {
    const lista = (await json(base, h)) as { id: number | string; memory?: number; disk?: number }[]
    const vm = lista.find((v) => String(v.id) === process.env.HOSTINGER_VPS_ID) ?? lista[0]
    if (!vm) return null
    // memory/disk vêm em MB na Hostinger.
    vps = { id: String(vm.id), ramTotal: vm.memory ? vm.memory * 1048576 : null, discoTotal: vm.disk ? vm.disk * 1048576 : null, em: agora.getTime() }
  }
  const de = new Date(agora.getTime() - 60 * 60_000).toISOString().slice(0, 19) + 'Z'
  const ate = agora.toISOString().slice(0, 19) + 'Z'
  const m = (await json(`${base}/${vps.id}/metrics?date_from=${de}&date_to=${ate}`, h)) as Record<string, Serie>
  return { ...lerHostinger(m), ramTotal: vps.ramTotal, discoTotal: vps.discoTotal }
}
