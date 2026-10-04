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
import { Card, FIN_BTN, FIN_COR, SeloMeta } from '@/components/graficos/kit-meta'

/**
 * Financeiro (0132). Só existe com o módulo ligado na loja (o servidor responde 404 sem a flag).
 * Cada seção aparece para quem tem a permissão; o servidor confere de novo em toda ação.
 * Fase 1 entrega Auditoria e Alertas; as demais seções chegam nas fases seguintes.
 * Visual "estilo Meta" (item 4b, 2026-10-04): o tema .fin-meta vale do menu lateral para dentro; o topo não muda.
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
const TOM: Record<Alerta['gravidade'], 'vermelho' | 'laranja' | 'azul'> = { grave: 'vermelho', atencao: 'laranja', info: 'azul' }
const FAIXA: Record<Alerta['gravidade'], string> = { grave: '#D93616', atencao: '#D47B04', info: '#CBD2D9' }
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

  // Celular: o menu de seções é um trilho horizontal — traz a seção ativa para a vista.
  useEffect(() => {
    const ativo = document.querySelector<HTMLElement>('nav[aria-label="Seções do financeiro"] [aria-current="page"]')
    if (ativo && window.matchMedia('(max-width: 1023px)').matches) ativo.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [secao, acoes])

  // Risco por funcionário: só dono e gerente (o servidor confere de novo).
  const visiveis = SECOES.filter((s) => acoes?.includes(s.exige) && (s.id !== 'risco' || papel === 'dono' || papel === 'gerente'))
  const itens: ItemSubmenu<Secao>[] = visiveis.map((s) => ({ id: s.id, label: s.label }))
  const atual = SECOES.find((s) => s.id === secao)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Financeiro" breadcrumb="Caixa, acertos, custos e auditoria" />
      {erro ? (
        <div className="fin-meta fin-fundo flex-1 p-5"><p className="text-[14px]" style={{ color: FIN_COR.texto2 }} data-testid="fin-erro">{erro}</p></div>
      ) : !acoes ? (
        <div className="fin-meta fin-fundo flex-1 p-5"><p className="text-[14px]" style={{ color: FIN_COR.texto2 }}>Carregando…</p></div>
      ) : (
        <div className="fin-meta flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row" data-financeiro-raiz>
          <SubmenuVertical itens={itens} ativo={secao} onSelecionar={setSecao} titulo="Seções do financeiro" />
          <div className="flex min-w-0 flex-1 flex-col space-y-4 overflow-y-auto p-4 sm:p-5 lg:p-6" data-financeiro-area>
            {secao === 'fluxo' && acoes.includes('financeiro') ? (
              <Suspense fallback={<p className="text-[14px]" style={{ color: FIN_COR.texto2 }}>Carregando…</p>}><FluxoCaixa usuarioId={usuarioId} /></Suspense>
            ) : secao === 'cmv' && acoes.includes('custos_ver') ? <SecaoCmv /> : secao === 'contas' && acoes.includes('contas_pagar') ? <SecaoContas /> : secao === 'dashboard' && acoes.includes('financeiro') ? <SecaoDashboard /> : secao === 'risco' && acoes.includes('auditoria_ver') ? <SecaoRisco /> : secao === 'regras' && acoes.includes('financeiro') ? <SecaoRegras /> : secao === 'motoboys' ? <SecaoMotoboys /> : secao === 'pix' ? <SecaoPix /> : (secao === 'caixa' || secao === 'movimentacoes') ? (
              <SecaoCaixa key={secao} modo={secao} />
            ) : secao === 'auditoria' && acoes.includes('auditoria_ver') ? (
              <AuditoriaAlertas />
            ) : (
              <Card titulo={atual?.label} subtitulo={`Em construção — chega na ${atual?.fase}.`} />
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
  const vazio = (t: string) => <p className="px-5 pb-4 text-[14px]" style={{ color: FIN_COR.texto2 }}>{t}</p>

  return (
    <>
      {erro && <p role="alert" className="text-[14px] font-medium" style={{ color: FIN_COR.vermelho }}>{erro}</p>}

      <Card testid="fin-integridade" titulo="Integridade dos registros"
        subtitulo="Confere a corrente de assinaturas do caixa e da auditoria. Qualquer registro alterado ou apagado aparece aqui."
        acoes={<button type="button" onClick={() => void verificar()} disabled={verificando} data-testid="fin-verificar" className={FIN_BTN.primario}>{verificando ? 'Verificando…' : 'Verificar integridade'}</button>}>
        {resultado ? (
          <div className="border-l-[3px] pl-3 text-[14px]" style={{ borderLeftColor: resultado.ok ? '#4DBBA6' : '#D93616', color: resultado.ok ? FIN_COR.verde : FIN_COR.vermelho }} data-testid="fin-integridade-resultado">
            {resultado.ok ? `Tudo íntegro (verificado em ${dataHora(resultado.verificadoEm)}).` : (
              <>
                <p className="font-semibold">{resultado.problemas.length} problema(s) encontrado(s):</p>
                <ul className="mt-1 list-disc pl-5">
                  {resultado.problemas.slice(0, 20).map((p, i) => <li key={i}>{p.tabela} #{p.registro}: {p.motivo}</li>)}
                </ul>
              </>
            )}
          </div>
        ) : undefined}
      </Card>

      <Card testid="fin-alertas" semPadding
        titulo={<>Alertas {naoLidos > 0 && <span className="ml-1 align-middle"><SeloMeta tom="vermelho">{naoLidos} novo(s)</SeloMeta></span>}</>}
        subtitulo="O que o sistema vigia no caixa, nos motoboys e nas ações sensíveis. Os graves também vão para o WhatsApp do dono.">
        {!dados ? vazio('Carregando…')
          : dados.alertas.length === 0 ? vazio('Nenhum alerta.')
          : (
            <ul className="mt-2 divide-y divide-border border-t border-border">
              {dados.alertas.map((a) => (
                <li key={a.id} className={`flex flex-wrap items-start gap-3 border-l-[3px] px-5 py-3 transition-colors hover:bg-[#F5F7F9] ${a.lido_em ? 'opacity-70' : ''}`}
                  style={{ borderLeftColor: a.lido_em ? 'transparent' : FAIXA[a.gravidade] }} data-testid="fin-alerta">
                  <SeloMeta tom={TOM[a.gravidade]}>{ROTULO_GRAVIDADE[a.gravidade]}</SeloMeta>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px]" style={{ color: FIN_COR.texto }}>{a.mensagem}</p>
                    <p className="mt-0.5 text-[12.5px]" style={{ color: FIN_COR.texto2 }}>
                      {dataHora(a.criado_em)}{a.whatsapp_enviado_em ? ' · enviado no WhatsApp' : ''}{a.lido_em ? ` · lido por ${a.lido_por_nome ?? '—'}` : ''}
                    </p>
                  </div>
                  {!a.lido_em && (
                    <button type="button" onClick={() => void marcarLido(a.id)} className={FIN_BTN.contorno}>
                      Marcar lido
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card testid="fin-sessoes" semPadding titulo="Acessos recentes" subtitulo="Quem entrou no painel, de qual aparelho e quando foi visto pela última vez.">
        {!dados ? null : dados.sessoes.length === 0 ? vazio('Nenhum acesso registrado ainda.') : (
          <div className="mt-2 overflow-x-auto border-t border-border">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr><th className="px-5 py-2.5">Quem</th><th className="px-4 py-2.5">Aparelho</th><th className="px-4 py-2.5">Entrou</th><th className="px-4 py-2.5">Visto</th><th className="px-4 py-2.5">Situação</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dados.sessoes.map((s) => (
                  <tr key={s.id}>
                    <td className="px-5 py-2.5 font-semibold text-text-main">{s.usuario_nome}</td>
                    <td className="px-4 py-2.5 text-text-subtle">{s.dispositivo ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">{dataHora(s.criado_em)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">{dataHora(s.visto_em)}</td>
                    <td className="px-4 py-2.5">{s.encerrada_em ? `Encerrada (${s.motivo_encerramento ?? '—'})` : s.bloqueada_em ? 'Tela bloqueada' : 'Aberta'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card testid="fin-aprovacoes" semPadding titulo="Aprovações por PIN" subtitulo="Ações acima do limite que um gerente ou o dono liberou com o próprio PIN.">
        {!dados ? null : dados.aprovacoes.length === 0 ? vazio('Nenhuma aprovação ainda.') : (
          <ul className="mt-2 divide-y divide-border border-t border-border">
            {dados.aprovacoes.map((a) => (
              <li key={a.id} className="px-5 py-2.5 text-[13px] transition-colors hover:bg-[#F5F7F9]">
                <b className="text-text-main">{a.aprovador_nome}</b> aprovou <b>{a.acao}</b> pedido por {a.solicitante_nome}
                {a.valor_centavos != null ? ` · ${formatarCentavos(a.valor_centavos)}` : ''}{a.motivo ? ` · ${a.motivo}` : ''}
                <span className="ml-1 text-text-subtle">· {dataHora(a.criado_em)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
