'use client'

import { CalendarClock } from 'lucide-react'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  AGENDAMENTO_PADRAO,
  COLUNAS_AGENDAMENTO,
  INTERVALOS_AGENDAMENTO,
  colunasAgendamento,
  configAgendamento,
  dataSaoPaulo,
  horaSaoPaulo,
  textoAgendado,
  validarConfigAgendamento,
  type ConfigAgendamento,
} from '@/lib/agendamento'
import { turnosDoDia, diaSemanaSaoPaulo, type HorarioFuncionamento } from '@/lib/timezone'

const INPUT = 'w-full rounded-menuzia border border-border px-2.5 py-1.5 text-[12.5px] outline-none focus:border-primary'

interface Agendado { id: string; numero: number; agendado_para: string; cliente_nome: string }

/** O horário agendado ainda cai dentro da grade atual? (aviso ao mudar o funcionamento) */
function dentroDaGrade(iso: string, grade: HorarioFuncionamento | null): boolean {
  if (!grade) return true
  const t = new Date(iso)
  const dia = diaSemanaSaoPaulo(t.toISOString())
  const h = horaSaoPaulo(t)
  if (turnosDoDia(grade, dia).some((x) => (x.abre <= x.fecha ? h >= x.abre && h < x.fecha : h >= x.abre) || x.abre === x.fecha)) return true
  return turnosDoDia(grade, (dia + 6) % 7).some((x) => x.abre > x.fecha && h < x.fecha)
}

/**
 * Agendamento de pedidos (Fase 7, 0121) em Ajustes › Loja. Desligado por padrão. Grava
 * direto nas colunas `agendamento_*` (grant de update por coluna; a RLS de restaurantes
 * só deixa a própria loja).
 */
export function AgendamentoAjustes({ restauranteId }: { restauranteId: string }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [cfg, setCfg] = useState<ConfigAgendamento>(AGENDAMENTO_PADRAO)
  const [grade, setGrade] = useState<HorarioFuncionamento | null>(null)
  const [futuros, setFuturos] = useState<Agendado[]>([])
  const [carregado, setCarregado] = useState(false)
  const [indisponivel, setIndisponivel] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('restaurantes').select(`horario_funcionamento, ${COLUNAS_AGENDAMENTO}`).eq('id', restauranteId).maybeSingle()
    if (error || !data) { setIndisponivel(true); setCarregado(true); return }
    setCfg(configAgendamento(data as Record<string, unknown>))
    setGrade((data as { horario_funcionamento: HorarioFuncionamento | null }).horario_funcionamento ?? null)
    const { data: peds } = await supabase
      .from('pedidos')
      .select('id, numero, agendado_para, cliente_nome')
      .eq('restaurante_id', restauranteId)
      .gt('agendado_para', new Date().toISOString())
      .neq('status', 'cancelado')
      .order('agendado_para', { ascending: true })
      .limit(50)
    setFuturos((peds ?? []) as Agendado[])
    setCarregado(true)
  }, [supabase, restauranteId])

  useEffect(() => {
    void carregar()
    // Volta à aba depois de mexer no horário: confere de novo os agendados fora da grade.
    const onFocus = () => void carregar()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [carregar])

  async function salvar() {
    const erro = validarConfigAgendamento(cfg)
    if (erro) { setMsg({ tipo: 'erro', texto: erro }); return }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('restaurantes').update(colunasAgendamento(cfg)).eq('id', restauranteId)
    setSalvando(false)
    setMsg(error ? { tipo: 'erro', texto: 'Não foi possível salvar o agendamento.' } : { tipo: 'ok', texto: 'Agendamento salvo.' })
  }

  if (!carregado || indisponivel) return null
  const set = <K extends keyof ConfigAgendamento>(k: K, v: ConfigAgendamento[K]) => setCfg((c) => ({ ...c, [k]: v }))
  const foraDaGrade = futuros.filter((p) => !dentroDaGrade(p.agendado_para, grade))

  return (
    // Card no kit dos Ajustes (2026-10-06): ícone, título 16/600 e frase de ajuda.
    <section className="fin-card min-w-0 xl:col-span-2" data-testid="ajustes-agendamento">
      <div className="flex items-start gap-3 border-b border-[#E4E7EA] px-5 py-4">
        <span aria-hidden className="mt-[1px] flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[8px] bg-[#E1EDF7] text-[#0868A6]">
          <CalendarClock className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold leading-tight text-[#1C2B33]">Pedidos agendados</h3>
          <p className="mt-1 text-[13px] leading-[18px] text-[#465A69]">
            O cliente escolhe dia e horário no checkout. O pedido fica na faixa &quot;Agendados&quot; do Painel de Pedidos e só entra no
            painel, na cozinha e na impressão perto do horário.
          </p>
        </div>
      </div>
      <div className="space-y-4.5 px-5 py-4">

      <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-text-main">
        <input type="checkbox" checked={cfg.ativo} onChange={(e) => set('ativo', e.target.checked)} className="h-4 w-4 accent-primary" data-testid="agendamento-ativo" />
        Aceitar pedidos agendados
      </label>

      {cfg.ativo && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <div className="mb-1 text-[11px] font-medium text-text-subtle">Quando aceitar</div>
            <select value={cfg.quando} onChange={(e) => set('quando', e.target.value as 'fechada' | 'sempre')} className={INPUT} data-testid="agendamento-quando">
              <option value="fechada">Só com a loja fechada</option>
              <option value="sempre">Sempre (aberta ou fechada)</option>
            </select>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-text-subtle">Até quantos dias à frente</div>
            <input type="number" min={1} max={30} value={cfg.dias} onChange={(e) => set('dias', Number(e.target.value))} className={INPUT} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-text-subtle">Antecedência mínima (minutos)</div>
            <input type="number" min={0} max={1440} value={cfg.antecedenciaMin} onChange={(e) => set('antecedenciaMin', Number(e.target.value))} className={INPUT} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-text-subtle">Intervalo entre horários</div>
            <select value={cfg.intervaloMin} onChange={(e) => set('intervaloMin', Number(e.target.value))} className={INPUT}>
              {INTERVALOS_AGENDAMENTO.map((i) => <option key={i} value={i}>{i} min</option>)}
            </select>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-text-subtle">Limite de pedidos por horário</div>
            <input type="number" min={1} max={999} placeholder="Sem limite" value={cfg.limite ?? ''} onChange={(e) => set('limite', e.target.value === '' ? null : Number(e.target.value))} className={INPUT} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-text-subtle">Entra no painel (minutos antes)</div>
            <input type="number" min={0} max={240} value={cfg.liberaMin} onChange={(e) => set('liberaMin', Number(e.target.value))} className={INPUT} />
          </div>
          <div className="flex items-center gap-4 sm:col-span-2 lg:col-span-3">
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={cfg.entrega} onChange={(e) => set('entrega', e.target.checked)} className="h-3.5 w-3.5 accent-primary" /> Entrega
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={cfg.retirada} onChange={(e) => set('retirada', e.target.checked)} className="h-3.5 w-3.5 accent-primary" /> Retirada
            </label>
          </div>
        </div>
      )}

      {foraDaGrade.length > 0 && (
        <div className="rounded-menuzia bg-warn-bg px-3 py-2 text-[12px] text-text-main" data-testid="agendados-fora-da-grade">
          <strong>Atenção:</strong> {foraDaGrade.length} pedido(s) agendado(s) ficaram fora do horário de funcionamento atual e continuam
          valendo — avise o cliente se não for atender:{' '}
          {foraDaGrade.slice(0, 5).map((p) => `#${p.numero} (${textoAgendado(p.agendado_para)})`).join(', ')}
        </div>
      )}
      {futuros.length > 0 && (
        <p className="text-[11px] text-text-subtle">
          {futuros.length} pedido(s) agendado(s) a partir de hoje ({dataSaoPaulo(new Date()).split('-').reverse().join('/')}).
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => void salvar()} disabled={salvando} data-testid="agendamento-salvar">{salvando ? 'Salvando…' : 'Salvar agendamento'}</Button>
        {msg && <span className={`text-[12px] font-semibold ${msg.tipo === 'ok' ? 'text-status-ready' : 'text-danger'}`}>{msg.texto}</span>}
      </div>
      </div>
    </section>
  )
}
