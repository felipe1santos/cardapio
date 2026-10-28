import { describe, expect, it } from 'vitest'
import { derivarProm, diasAteFimDoCiclo, lerHostinger, lerProm, somarApiCounts } from './oficial'

const L = 'supabase_project_ref="x",service_type="db"'
const PROM = [
  '# HELP node_cpu_seconds_total x',
  `node_cpu_seconds_total{${L},cpu="0",mode="idle"} 900`,
  `node_cpu_seconds_total{${L},cpu="0",mode="user"} 100`,
  `node_cpu_seconds_total{${L},cpu="1",mode="idle"} 1.8e+03`,
  `node_memory_MemTotal_bytes{${L}} 2e+09`,
  `node_memory_MemAvailable_bytes{${L}} 1.5e+09`,
  `node_filesystem_size_bytes{${L},device="/dev/nvme0n1p2",mountpoint="/"} 1e+10`,
  `node_filesystem_size_bytes{${L},device="/dev/nvme1n1",mountpoint="/data"} 8e+09`,
  `node_filesystem_avail_bytes{${L},device="/dev/nvme1n1",mountpoint="/data"} 6e+09`,
  `node_disk_reads_completed_total{${L},device="nvme0n1"} 100`,
  `node_disk_reads_completed_total{${L},device="nvme1n1"} 50`,
  `node_disk_writes_completed_total{${L},device="nvme1n1"} 1000`,
  `node_disk_read_bytes_total{${L},device="nvme1n1"} 1e+06`,
  `node_disk_written_bytes_total{${L},device="nvme1n1"} 9e+06`,
  `node_network_transmit_bytes_total{${L},device="ens5"} 3e+09`,
  `node_network_transmit_bytes_total{${L},device="lo"} 5e+09`,
  `pg_database_size_bytes{${L},datname="postgres"} 1.38e+08`,
  `pg_database_size_bytes{${L},datname="template0"} 7e+06`,
].join('\n')

describe('Prometheus oficial do Supabase', () => {
  it('lê os contadores: disco /data, banco "postgres", rede sem lo, CPU somada', () => {
    const p = lerProm(PROM)
    expect(p).toMatchObject({ cpuTotal: 2800, cpuIdle: 2700, memTotal: 2e9, memDisp: 1.5e9, discoTotal: 8e9, discoLivre: 6e9, ops: 1150, ioBytes: 1e7, tx: 3e9, dbBytes: 1.38e8 })
  })
  it('deriva CPU %, IOPS, MB/s e bytes que saíram entre duas leituras', () => {
    const a = lerProm(PROM)
    const b = { ...a, cpuTotal: a.cpuTotal + 200, cpuIdle: a.cpuIdle + 150, ops: a.ops + 9000, ioBytes: a.ioBytes + 90e6, tx: a.tx + 6e6 }
    expect(derivarProm(b, a, 900)).toEqual({ cpuPct: 25, iops: 10, ioMBs: 0.1, txDelta: 6e6 })
    // Contador zerou (reinício da instância): sem número, nunca negativo.
    expect(derivarProm(a, b, 900)).toEqual({ cpuPct: null, iops: null, ioMBs: null, txDelta: null })
    expect(derivarProm(a, null, 0)).toEqual({ cpuPct: null, iops: null, ioMBs: null, txDelta: null })
  })
})

describe('Management API e Hostinger', () => {
  it('usage.api-counts: soma por tipo', () => {
    const r = somarApiCounts({ result: [
      { timestamp: 'a', total_rest_requests: 10, total_auth_requests: 2, total_storage_requests: 3, total_realtime_requests: 1 },
      { timestamp: 'b', total_rest_requests: 5, total_auth_requests: 1, total_storage_requests: 0, total_realtime_requests: 0 },
    ] })
    expect(r).toEqual({ rest: 15, auth: 3, storage: 3, realtime: 1, total: 22 })
    expect(somarApiCounts({ error: 'x' })).toBeNull()
  })
  it('métricas da VPS: o ponto mais recente de cada série', () => {
    const r = lerHostinger({
      cpu_usage: { unit: '%', usage: { 100: 10, 200: 35.5 } },
      ram_usage: { unit: 'bytes', usage: { 200: 3e9 } },
      disk_space: { unit: 'bytes', usage: { 200: 34e9 } },
      outgoing_traffic: { unit: 'bytes', usage: { 100: 1, 200: 5e6 } },
      incoming_traffic: { unit: 'bytes', usage: { 200: 2e6 } },
    })
    expect(r).toEqual({ cpuPct: 35.5, ramBytes: 3e9, discoBytes: 34e9, saidaBytes: 5e6, entradaBytes: 2e6, amostraEm: new Date(200_000).toISOString() })
  })
  it('dias até o fim do ciclo (ciclo vira no dia 28)', () => {
    expect(diasAteFimDoCiclo(new Date('2026-10-28T23:00:00Z'), 28)).toBe(31)
    expect(diasAteFimDoCiclo(new Date('2026-11-20T12:00:00Z'), 28)).toBe(8)
  })
})
