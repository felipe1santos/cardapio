'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { SubmenuVertical, type ItemSubmenu } from '@/components/admin/submenu-vertical'
import type { AcaoFin } from '@/lib/financeiro/permissoes'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { SecaoCaixa } from '@/components/financeiro/caixa'
import { SecaoMotoboys, SecaoPix } from '@/components/financeiro/motoboys'
import { FluxoCaixa } from '@/components/financeiro/fluxo/fluxo-caixa'
import { SecaoCmv } from '@/components/financeiro/cmv/secao-cmv'
import { SecaoContas } from '@/components/financeiro/contas/secao-contas'
import { SecaoDashboard } from '@/components/financeiro/dashboard/secao-dashboard'
import { SecaoRisco } from '@/components/financeiro/risco/secao-risco'
import { SecaoRegras } from '@/components/financeiro/regras'

/**
 * Financeiro (0132). Só existe com o módulo ligado na loja (o servidor responde 404 sem a flag).
 * Cada seção aparece para quem tem a permissão; o servidor confere de novo em toda ação.
 * Fase 1 entrega Auditoria e Alertas; as demais seções chegam nas fases seguintes.
 */
type Secao = 'caixa' | 'fluxo' | 'motoboys' | 'pix' | 'movimentacoes' | 'cmv' | 'contas' | 'dashboard' | 'risco' | 'regras' | 'auditoria'

const SECOES: { id: Secao; label: string; exige: AcaoFin; fase: string }[] = [
  { id: 'caixa', label: 'Caixa', exige: 'caixa_abrir', fase: '' },
  { id: 'fluxo', label: 'Fluxo de Caixa', exige: 'financeiro', fase: '' },
  { id: 'motoboys', label: 'Acerto de Motoboys', exige: 'acerto_motoboy', fase: '' },
  { id: 'pix', label: 'Conferir Pix', exige: 'pix_conferir', fase: '' },
  { id: 'movimentacoes', label: 'Movimentações', exige: 'sangria', fase: '' },
  { id: 'cmv', label: 'Precificação / CMV', exige: 'custos_ver', fase: '' },
  { id: 'contas', label: 'Contas e DRE', exige: 'contas_pagar', fase: '' },
  { id: 'dashboard', label: 'Dashboard', exige: 'financeiro', fase: '' },
  { id: 'auditoria', label: 'Auditoria e Alertas', exige: 'auditoria_ver', fase: '' },
  { id: 'risco', label: 'Risco por funcionário', exige: 'auditoria_ver', fase: '' },
  { id: 'regras', label: 'Regras e limites', exige: 'financeiro', fase: '' },
]

interface Alerta { id: string; tipo: string; gravidade: 'info' | 'atencao' | 'grave'; mensagem: string; usuario_nome: string | null; lido_por_nome: string | null; lido_em: string | null; whatsapp_enviado_em: string | null; criado_em: string }
interface Sessao { id: string; usuario_nome: string; ip: string | null; dispositivo: string | null; criado_em: string; visto_em: string; encerrada_em: string | null; motivo_encerramento: string | null; bloqueada_em: string | null }
interface Aprovacao { id: string; acao: string; solicitante_nome: string; aprovador_nome: string; valor_centavos: number | null; motivo: string | null; criado_em: string }

const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const TOM: Record<Alerta['gravidade'], string> = {
  grave: 'bg-[#FEE2E2] text-[#EF4444]',
  atencao: 'bg-[#FEF3C7] text-[#B45309]',
  info: 'bg-[#E0F2FE] text-[#0369A1]',
}
const ROTULO_GRAVIDADE: Record<Alerta['gravidade'], string> = { grave: 'Grave', atencao: 'Atenção', info: 'Info' }

export default function FinanceiroPage() {
  const [acoes, setAcoes] = useState<AcaoFin[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [secao, setSecao] = useState<Secao>('auditoria')
  const [usuarioId, setUsuarioId] = useState('')
  const [papel, setPapel] = useState('')

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/admin/financeiro', { cache: 'no-store' }).catch(() => null)
      const j = r ? await r.json().catch(() => ({})) : {}
      if (!r?.ok) { setErro(j.error ?? 'Não foi possível abrir o financeiro.'); return }
      const lista = j.acoes as AcaoFin[]
      setAcoes(lista)
      setUsuarioId(String(j.id ?? ''))
      setPapel(String(j.papel ?? ''))
      // ?secao=caixa (aviso do topo, "Ir fechar o caixa"); senão o Caixa, se puder; senão a primeira.
      const pedida = new URLSearchParams(window.location.search).get('secao')
      const alvo = SECOES.find((s) => s.id === pedida && lista.includes(s.exige)) ?? SECOES.find((s) => lista.includes(s.exige))
      if (alvo) setSecao(alvo.id)
    })()
  }, [])

  // Risco por funcionário: só dono e gerente (o servidor confere de novo).
  const visiveis = SECOES.filter((s) => acoes?.includes(s.exige) && (s.id !== 'risco' || papel === 'dono' || papel === 'gerente'))
  const itens: ItemSubmenu<Secao>[] = visiveis.map((s) => ({ id: s.id, label: s.label }))
  const atual = SECOES.find((s) => s.id === secao)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Financeiro" breadcrumb="Caixa, acertos, custos e auditoria" />
      {erro ? (
        <div className="p-5"><p className="text-[13px] text-text-subtle" data-testid="fin-erro">{erro}</p></div>
      ) : !acoes ? (
        <div className="p-5"><p className="text-[13px] text-text-subtle">Carregando…</p></div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <SubmenuVertical itens={itens} ativo={secao} onSelecionar={setSecao} titulo="Seções do financeiro" />
          <div className="flex min-w-0 flex-1 flex-col space-y-4 overflow-y-auto p-5">
            {secao === 'fluxo' && acoes.includes('financeiro') ? (
              <Suspense fallback={<p className="text-[13px] text-text-subtle">Carregando…</p>}><FluxoCaixa usuarioId={usuarioId} /></Suspense>
            ) : secao === 'cmv' && acoes.includes('custos_ver') ? <SecaoCmv /> : secao === 'contas' && acoes.includes('contas_pagar') ? <SecaoContas /> : secao === 'dashboard' && acoes.includes('financeiro') ? <SecaoDashboard /> : secao === 'risco' && acoes.includes('auditoria_ver') ? <SecaoRisco /> : secao === 'regras' && acoes.includes('financeiro') ? <SecaoRegras /> : secao === 'motoboys' ? <SecaoMotoboys /> : secao === 'pix' ? <SecaoPix /> : (secao === 'caixa' || secao === 'movimentacoes') ? (
              <SecaoCaixa key={secao} modo={secao} />
            ) : secao === 'auditoria' && acoes.includes('auditoria_ver') ? (
              <AuditoriaAlertas />
            ) : (
              <div className="rounded-[3px] border border-border bg-white p-6 text-center">
                <p className="text-[14px] font-semibold text-text-main">{atual?.label}</p>
                <p className="mt-1 text-[13px] text-text-subtle">Em construção — chega na {atual?.fase}.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AuditoriaAlertas() {
  const [dados, setDados] = useState<{ alertas: Alerta[]; sessoes: Sessao[]; aprovacoes: Aprovacao[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [verificando, setVerificando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; problemas: { tabela: string; registro: string; motivo: string }[]; verificadoEm: string } | null>(null)

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/financeiro/auditoria', { cache: 'no-store' }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r?.ok) { setErro(j.error ?? 'Não foi possível carregar.'); return }
    setErro(null); setDados(j)
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  async function verificar() {
    setVerificando(true)
    try {
      const r = await fetch('/api/admin/financeiro/auditoria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'verificar' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error ?? 'Não foi possível verificar.'); return }
      setResultado(j)
    } finally {
      setVerificando(false)
    }
  }

  async function marcarLido(id: string) {
    await fetch('/api/admin/financeiro/auditoria', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alertaId: id }) }).catch(() => {})
    await carregar()
  }

  const naoLidos = dados?.alertas.filter((a) => !a.lido_em).length ?? 0
  const cartao = 'rounded-[3px] border border-border bg-white'
  const titulo = 'border-b border-border px-4 py-3 text-[13px] font-bold text-text-main'

  return (
    <>
      {erro && <p role="alert" className="text-[13px] font-medium text-danger">{erro}</p>}

      <section className={cartao} data-testid="fin-integridade">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-text-main">Integridade dos registros</p>
            <p className="text-[12px] text-text-subtle">Confere a corrente de assinaturas do caixa e da auditoria. Qualquer registro alterado ou apagado aparece aqui.</p>
          </div>
          <button type="button" onClick={() => void verificar()} disabled={verificando} data-testid="fin-verificar"
            className="h-[34px] rounded-[3px] bg-primary px-4 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark disabled:opacity-60">
            {verificando ? 'Verificando…' : 'Verificar integridade'}
          </button>
        </div>
        {resultado && (
          <div className={`border-t border-border px-4 py-3 text-[13px] ${resultado.ok ? 'text-[#16A34A]' : 'text-[#EF4444]'}`} data-testid="fin-integridade-resultado">
            {resultado.ok ? `Tudo íntegro (verificado em ${dataHora(resultado.verificadoEm)}).` : (
              <>
                <p className="font-semibold">{resultado.problemas.length} problema(s) encontrado(s):</p>
                <ul className="mt-1 list-disc pl-5">
                  {resultado.problemas.slice(0, 20).map((p, i) => <li key={i}>{p.tabela} #{p.registro}: {p.motivo}</li>)}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      <section className={cartao} data-testid="fin-alertas">
        <h2 className={titulo}>Alertas {naoLidos > 0 && <span className="ml-1 rounded-[3px] bg-[#FEE2E2] px-1.5 py-0.5 text-[11px] text-[#EF4444]">{naoLidos} novo(s)</span>}</h2>
        {!dados ? <p className="px-4 py-3 text-[13px] text-text-subtle">Carregando…</p>
          : dados.alertas.length === 0 ? <p className="px-4 py-3 text-[13px] text-text-subtle">Nenhum alerta.</p>
          : (
            <ul className="divide-y divide-border">
              {dados.alertas.map((a) => (
                <li key={a.id} className={`flex flex-wrap items-start gap-3 px-4 py-3 ${a.lido_em ? 'opacity-60' : ''}`} data-testid="fin-alerta">
                  <span className={`rounded-[3px] px-1.5 py-0.5 text-[11px] font-semibold ${TOM[a.gravidade]}`}>{ROTULO_GRAVIDADE[a.gravidade]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-text-main">{a.mensagem}</p>
                    <p className="mt-0.5 text-[11.5px] text-text-subtle">
                      {dataHora(a.criado_em)}{a.whatsapp_enviado_em ? ' · enviado no WhatsApp' : ''}{a.lido_em ? ` · lido por ${a.lido_por_nome ?? '—'}` : ''}
                    </p>
                  </div>
                  {!a.lido_em && (
                    <button type="button" onClick={() => void marcarLido(a.id)} className="h-[30px] rounded-[3px] border border-border px-3 text-[11px] font-semibold uppercase tracking-wide text-text-main hover:border-primary hover:text-primary">
                      Marcar lido
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className={cartao} data-testid="fin-sessoes">
        <h2 className={titulo}>Acessos recentes</h2>
        {!dados ? null : dados.sessoes.length === 0 ? <p className="px-4 py-3 text-[13px] text-text-subtle">Nenhum acesso registrado ainda.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[11px] uppercase tracking-wide text-text-subtle">
                <tr><th className="px-4 py-2">Quem</th><th className="px-4 py-2">Aparelho</th><th className="px-4 py-2">Entrou</th><th className="px-4 py-2">Visto</th><th className="px-4 py-2">Situação</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dados.sessoes.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2 font-semibold text-text-main">{s.usuario_nome}</td>
                    <td className="px-4 py-2 text-text-subtle">{s.dispositivo ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2">{dataHora(s.criado_em)}</td>
                    <td className="whitespace-nowrap px-4 py-2">{dataHora(s.visto_em)}</td>
                    <td className="px-4 py-2">{s.encerrada_em ? `Encerrada (${s.motivo_encerramento ?? '—'})` : s.bloqueada_em ? 'Tela bloqueada' : 'Aberta'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={cartao} data-testid="fin-aprovacoes">
        <h2 className={titulo}>Aprovações por PIN</h2>
        {!dados ? null : dados.aprovacoes.length === 0 ? <p className="px-4 py-3 text-[13px] text-text-subtle">Nenhuma aprovação ainda.</p> : (
          <ul className="divide-y divide-border">
            {dados.aprovacoes.map((a) => (
              <li key={a.id} className="px-4 py-2 text-[12.5px]">
                <b className="text-text-main">{a.aprovador_nome}</b> aprovou <b>{a.acao}</b> pedido por {a.solicitante_nome}
                {a.valor_centavos != null ? ` · ${formatarCentavos(a.valor_centavos)}` : ''}{a.motivo ? ` · ${a.motivo}` : ''}
                <span className="ml-1 text-text-subtle">· {dataHora(a.criado_em)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
