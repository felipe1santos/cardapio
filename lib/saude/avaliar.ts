/**
 * Vigia da saúde do sistema (28/10/2026, Etapa 7 da varredura — docs/relatorios/2026-10-28-varredura.md): regras puras.
 * Recebe os números de uma rodada e devolve os alertas. Amarelo = 70% de um limite ou 2× a média; vermelho = 90% ou 4×.
 * Cada alerta diz, em português simples, o que está acontecendo, quanto e o que fazer.
 */

export type Nivel = 'amarelo' | 'vermelho'
export interface Alerta { assunto: string; nivel: Nivel; titulo: string; texto: string }

export interface Medidas {
  em: string
  /** Requisições PostgREST por minuto desde a última foto, e a média dos últimos 7 dias. */
  reqPorMin: number | null
  reqMediaPorMin: number | null
  /** Egress estimado para o mês (GB) a partir da média de requisições, e a cota do plano. */
  egressMesGb: number | null
  egressCotaGb: number
  dbBytes: number | null
  dbCotaBytes: number
  /** Mensagem de erro quando o Supabase recusa o projeto (402 exceed_egress_quota de 27/10). */
  bancoRestrito: string | null
  apis: { api: string; chamadas: number; limite: number }[]
  iaUsd: { gasto: number; teto: number } | null
  lojasApi: { loja: string; api: string; chamadas: number; totalApi: number; limite: number }[]
  /** % de CPU da VPS entre esta foto e a anterior (/proc/stat — o mesmo número do painel da Hostinger). */
  cpuPct: number | null
  /** Fotos seguidas com CPU ≥ 90% (alerta só a partir de 3 = 15 min: um deploy não vira alarme). */
  cpuAltaSeguidas: number
  /** Contadores de /proc/stat desta foto (para calcular o % na próxima). */
  cpuStat?: { total: number; ocioso: number } | null
  memLivrePct: number | null
  discoUsadoPct: number | null
  cronsAtrasados: { nome: string; minutos: number }[]
  whatsappCaido: { loja: string; minutos: number }[]
  /** Soma exata dos arquivos do Storage (storage.objects). */
  storageBytes?: number | null
  /** Números das fontes oficiais (lib/saude/oficial.ts); cada um com a hora em que foi lido. */
  oficial?: Oficial
}

export interface Oficial {
  prom?: { em: string; cpuTotal: number; cpuIdle: number; memTotal: number; memDisp: number; discoTotal: number; discoLivre: number; ops: number; ioBytes: number; tx: number; dbBytes: number; cpuPct: number | null; iops: number | null; ioMBs: number | null; txDelta: number | null }
  supabase?: { em: string; req24h: { rest: number; auth: number; storage: number; realtime: number; total: number } | null; disco: { usado: number; total: number } | null }
  hostinger?: { em: string; cpuPct: number | null; ramBytes: number | null; discoBytes: number | null; saidaBytes: number | null; entradaBytes: number | null; amostraEm: string | null; ramTotal: number | null; discoTotal: number | null }
  erros?: Record<string, string>
}

export function medidasVazias(em: string): Medidas {
  return {
    em, reqPorMin: null, reqMediaPorMin: null, egressMesGb: null, egressCotaGb: 250, dbBytes: null, dbCotaBytes: 8e9,
    bancoRestrito: null, apis: [], iaUsd: null, lojasApi: [], cpuPct: null, cpuAltaSeguidas: 0, memLivrePct: null, discoUsadoPct: null,
    cronsAtrasados: [], whatsappCaido: [],
  }
}

/** CPU ≥ 90% por 3 fotos (15 min) = amarelo; por 6 (30 min) = vermelho. */
export const CPU_ALTA_PCT = 90
const CPU_SEGUIDAS_AMARELO = 3
const CPU_SEGUIDAS_VERMELHO = 6
const AMARELO = 0.7
const VERMELHO = 0.9
/** Abaixo disso o "2× a média" é ruído (madrugada, 1 loja aberta). */
const REQ_MIN_PARA_ALERTA = 150
const n0 = (v: number) => Math.round(v).toLocaleString('pt-BR')
const pct = (v: number) => `${Math.round(v * 100)}%`

function porLimite(uso: number, limite: number): Nivel | null {
  if (!(limite > 0)) return null
  const r = uso / limite
  return r >= VERMELHO ? 'vermelho' : r >= AMARELO ? 'amarelo' : null
}

function alerta(assunto: string, nivel: Nivel, titulo: string, oque: string, quanto: string, fazer: string): Alerta {
  return { assunto, nivel, titulo, texto: `${nivel === 'vermelho' ? '🔴' : '🟡'} Menuzia — ${titulo}\n${oque}\nQuanto: ${quanto}\nO que fazer: ${fazer}` }
}

export function avaliar(m: Medidas): Alerta[] {
  const out: Alerta[] = []
  if (m.bancoRestrito) {
    out.push(alerta('supabase-bloqueado', 'vermelho', 'banco fora do ar',
      'O Supabase está recusando as chamadas do sistema: pedidos, painel e vitrine param.',
      m.bancoRestrito.slice(0, 160),
      'abrir supabase.com › Organização › Billing/Usage; se for cota (egress), subir o plano ou o teto de gasto.'))
  }
  if (m.reqPorMin !== null && m.reqMediaPorMin && m.reqPorMin >= REQ_MIN_PARA_ALERTA) {
    const x = m.reqPorMin / m.reqMediaPorMin
    const nivel: Nivel | null = x >= 4 ? 'vermelho' : x >= 2 ? 'amarelo' : null
    if (nivel) out.push(alerta('requisicoes', nivel, 'requisições ao banco acima do normal',
      'O banco está recebendo muito mais chamadas que a média — pode ser uma tela ou robô em repetição.',
      `${n0(m.reqPorMin)}/min (média ${n0(m.reqMediaPorMin)}/min, ${x.toFixed(1)}×)`,
      'abrir Super Admin › Saúde do sistema; se continuar por 15 min, chamar o suporte técnico para achar a origem.'))
  }
  if (m.egressMesGb !== null) {
    const nivel = porLimite(m.egressMesGb, m.egressCotaGb)
    if (nivel) out.push(alerta('egress', nivel, 'tráfego do banco perto da cota do mês',
      'No ritmo atual o tráfego (egress) do Supabase passa da cota do plano neste mês. Em 27/10 isso derrubou o sistema.',
      `${m.egressMesGb.toFixed(0)} GB projetados de ${m.egressCotaGb} GB (${pct(m.egressMesGb / m.egressCotaGb)})`,
      'conferir supabase.com › Usage; se a projeção passar de 100%, reduzir consultas ou subir o plano antes do fim do ciclo.'))
  }
  if (m.dbBytes !== null) {
    const nivel = porLimite(m.dbBytes, m.dbCotaBytes)
    if (nivel) out.push(alerta('banco-tamanho', nivel, 'banco de dados crescendo',
      'O tamanho do banco está perto do disco incluído no plano (acima disso o Supabase cobra por GB).',
      `${(m.dbBytes / 1e9).toFixed(1)} GB de ${(m.dbCotaBytes / 1e9).toFixed(0)} GB`,
      'ver as tabelas que mais crescem (logs, eventos) e ligar a limpeza automática delas.'))
  }
  for (const a of m.apis) {
    const nivel = porLimite(a.chamadas, a.limite)
    if (nivel) out.push(alerta(`api-${a.api}`, nivel, `API paga "${a.api}" perto do limite do dia`,
      nivel === 'vermelho' ? 'Ao bater o limite, a guarda bloqueia novas chamadas até a meia-noite (nada é cobrado a mais).' : 'O uso de hoje está acima do normal.',
      `${n0(a.chamadas)} de ${n0(a.limite)} chamadas hoje (${pct(a.chamadas / a.limite)})`,
      'abrir Super Admin › contador de APIs e ver qual loja está usando; se for repetição, avisar o suporte técnico.'))
  }
  if (m.iaUsd) {
    const nivel = porLimite(m.iaUsd.gasto, m.iaUsd.teto)
    if (nivel) out.push(alerta('ia-usd', nivel, 'gasto da IA perto do teto do dia',
      'O Agente de IA e a transcrição de áudio estão perto do teto diário em dólar; ao bater, o robô padrão assume.',
      `US$ ${m.iaUsd.gasto.toFixed(2)} de US$ ${m.iaUsd.teto.toFixed(2)} (${pct(m.iaUsd.gasto / m.iaUsd.teto)})`,
      'abrir Super Admin › Gasto da IA e ver a loja; subir o teto só se o uso for real.'))
  }
  for (const l of m.lojasApi) {
    if (l.totalApi > 0 && l.chamadas / l.totalApi >= 0.6 && l.totalApi >= l.limite * 0.5) {
      out.push(alerta(`loja-api-${l.api}`, 'amarelo', `loja fora do padrão em "${l.api}"`,
        `A loja ${l.loja} sozinha está usando quase toda a API paga "${l.api}" de hoje.`,
        `${n0(l.chamadas)} de ${n0(l.totalApi)} chamadas do dia (limite ${n0(l.limite)})`,
        'abrir a loja e ver se alguma tela ficou aberta em repetição (ex.: mapa do despacho).'))
    }
  }
  if (m.discoUsadoPct !== null) {
    const nivel = porLimite(m.discoUsadoPct, 100)
    if (nivel) out.push(alerta('vps-disco', nivel, 'Disco da VPS enchendo',
      'Com o disco cheio, os deploys falham e o servidor pode travar.',
      `${Math.round(m.discoUsadoPct)}% usado`,
      'limpar imagens antigas do Docker (Coolify › Servers › Cleanup) ou pedir ao suporte técnico.'))
  }
  if (m.memLivrePct !== null) {
    const nivel: Nivel | null = m.memLivrePct <= 10 ? 'vermelho' : m.memLivrePct <= 20 ? 'amarelo' : null
    if (nivel) out.push(alerta('vps-memoria', nivel, 'memória da VPS acabando',
      'Sem memória o servidor fica lento e pode congelar (como em 23/10).',
      `${Math.round(m.memLivrePct)}% livre`,
      'não rodar build de outro projeto agora; se continuar, reiniciar o app pelo Coolify fora do horário de pico.'))
  }
  if (m.cpuPct !== null && m.cpuAltaSeguidas >= CPU_SEGUIDAS_AMARELO) {
    const nivel: Nivel = m.cpuAltaSeguidas >= CPU_SEGUIDAS_VERMELHO ? 'vermelho' : 'amarelo'
    out.push(alerta('vps-cpu', nivel, 'processador da VPS sobrecarregado',
      'O processador do servidor está quase no máximo há um tempo: páginas e impressão podem atrasar.',
      `${Math.round(m.cpuPct)}% há ${m.cpuAltaSeguidas * 5} min`,
      'ver no Coolify se há build rodando; se não houver, chamar o suporte técnico.'))
  }
  for (const c of m.cronsAtrasados) {
    out.push(alerta(`cron-${c.nome}`, 'vermelho', `rotina automática "${c.nome}" parada`,
      'Uma tarefa que devia rodar sozinha não roda há algum tempo (mensagens, Pix, entregas ou financeiro podem parar).',
      `sem rodar há ${n0(c.minutos)} min`,
      'abrir Coolify › app › Scheduled Tasks e ver o último resultado dela.'))
  }
  // WhatsApp de loja desconectado: NÃO alerta aqui (28/10, regra do dono — é opcional). O aviso único sai do monitor
  // (lib/whatsapp-monitor.ts) quando uma loja em uso cai sozinha; a lista só aparece na tela.
  return out
}

/** Intervalo de cada cron em minutos (Coolify). Atrasado = sem rodar há mais de 3× isso (mínimo 10 min). */
export const CRONS: Record<string, number> = {
  whatsapp: 1, campanhas: 1, push: 1, canais: 1, entregas: 1, 'loja-horario': 1, 'pix-online': 1,
  'financeiro-vigia': 15, 'financeiro-diario': 60, 'ancora-integridade': 1440,
}

export function cronsAtrasados(batidas: { nome: string; ultima_em: string }[], agora: number): { nome: string; minutos: number }[] {
  const out: { nome: string; minutos: number }[] = []
  for (const b of batidas) {
    const intervalo = CRONS[b.nome]
    if (!intervalo) continue
    const minutos = Math.floor((agora - Date.parse(b.ultima_em)) / 60_000)
    if (minutos > Math.max(10, intervalo * 3)) out.push({ nome: b.nome, minutos })
  }
  return out
}

export const JANELA_ALERTA_MS = 6 * 3600_000

/** Sem spam: no máximo 1 alerta do mesmo assunto a cada 6 h; amarelo que vira vermelho sai na hora. */
export function podeEnviar(historico: { assunto: string; nivel: string; criado_em: string }[], a: { assunto: string; nivel: Nivel }, agora: number): boolean {
  const recentes = historico.filter((h) => h.assunto === a.assunto && agora - Date.parse(h.criado_em) < JANELA_ALERTA_MS)
  if (!recentes.length) return true
  return a.nivel === 'vermelho' && !recentes.some((h) => h.nivel === 'vermelho')
}

const diaSP = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const horaSP = (d: Date) => Number(d.toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).slice(0, 2))

/** Resumo diário a partir das 09:00 de Brasília, uma vez por dia. */
export function horaDoResumo(agora: Date, ultimoResumo: string | null): boolean {
  if (horaSP(agora) < 9) return false
  return !ultimoResumo || diaSP(new Date(ultimoResumo)) !== diaSP(agora)
}

export function textoResumo(m: Medidas, alertas: Alerta[]): string {
  const linhas = ['☀️ Menuzia — resumo do dia']
  if (!alertas.length) linhas.push('Tudo ok: banco, APIs pagas, VPS, rotinas e WhatsApp das lojas dentro do normal.')
  else {
    linhas.push(`Precisa de atenção (${alertas.length}):`)
    for (const a of alertas) linhas.push(`${a.nivel === 'vermelho' ? '🔴' : '🟡'} ${a.titulo.charAt(0).toUpperCase()}${a.titulo.slice(1)}`)
  }
  const nums: string[] = []
  if (m.reqMediaPorMin !== null) nums.push(`banco ${n0(m.reqMediaPorMin)} req/min (média 7 dias)`)
  if (m.egressMesGb !== null) nums.push(`egress ~${m.egressMesGb.toFixed(0)}/${m.egressCotaGb} GB no mês`)
  if (m.discoUsadoPct !== null) nums.push(`disco VPS ${Math.round(m.discoUsadoPct)}%`)
  if (nums.length) linhas.push(nums.join(' · '))
  return linhas.join('\n')
}
