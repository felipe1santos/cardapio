'use client'

import { useMemo, useState, useEffect } from 'react'
import {
  AlertTriangle, Check, CheckCircle2, ChefHat, CircleHelp, Download, History, Info, Laptop, Link2, Loader2, Pencil, Printer, ReceiptText,
  RefreshCw, Ruler, Stethoscope, Unplug, Wifi, WifiOff,
} from 'lucide-react'
import { ModalBase } from '@/components/impressao/modal-base'
import {
  AVISO_PAPEL, DOWNLOAD_ASSISTENTE_BETA, ROTULO_ESTADO_IMPRESSAO, ROTULO_SUBTIPO_TESTE, ROTULO_TIPO_TRABALHO,
} from '@/lib/impressao/rotulos'
import { agenteOnline, avaliarModos, ehImpressoraVirtual, motivoProblema, pareamentoAntigo, type AvaliacaoModos, type ProblemaFuncao } from '@/lib/impressao/regras-modo'
import type { AgenteVisao, DispositivoVisao, Funcao, ModoBeta, TrabalhoVisao } from '@/lib/impressao/servico'

/**
 * Tela Impressão (Assistente Beta), em etapas — 2026-09-28:
 *   ① Conectar computador  ② Impressoras (escolha em pop-up)  ③ Modo de operação
 *   · Testes num pop-up (botão "Testar impressão" no topo) · Ajuda e diagnóstico recolhidos.
 * Visual neutro: cartões brancos, borda cinza clara, uma cor de destaque (#0688D4) e cor
 * de status só onde significa algo. A regra dos modos é a mesma do servidor
 * (lib/impressao/regras-modo); estes componentes só mostram e chamam os handlers da página.
 */

export interface PainelDados {
  agentes: AgenteVisao[]
  dispositivos: DispositivoVisao[]
  funcoes: Record<Funcao, string | null>
  trabalhos: TrabalhoVisao[]
  cozinhaPorFuncao: boolean
  betaLiberado: boolean
  modo: ModoBeta
  cozinhaTransferidaEm: string | null
  assistenteAntigoVistoEm: string | null
  assistenteAntigoOnline: boolean
}

export const nomeDisp = (d: DispositivoVisao) => d.apelido || d.nomeSistema

/** Tamanho da letra do Assistente Beta (comanda e pré-conta). Grande = o modelo oficial. */
export type TamanhoLetra = 'grande' | 'media' | 'pequena'
export const TAMANHOS_LETRA: { valor: TamanhoLetra; rotulo: string; curto: string }[] = [
  { valor: 'grande', rotulo: 'Grande (modelo)', curto: 'G' },
  { valor: 'media', rotulo: 'Média', curto: 'M' },
  { valor: 'pequena', rotulo: 'Pequena', curto: 'P' },
]
export const rotuloLetra = (v: string) => TAMANHOS_LETRA.find((t) => t.valor === v)?.rotulo ?? 'Grande (modelo)'
const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export const ROTULO_FUNCAO_CURTO: Record<Funcao, string> = { cozinha: 'Cozinha', caixa: 'Recibo/Extrato' }
export const TEXTO_MODO: Record<ModoBeta, { titulo: string; curto: string }> = {
  teste: { titulo: 'Somente teste', curto: 'Beta só imprime testes. Pedidos reais continuam no Assistente atual.' },
  caixa: { titulo: 'Somente Caixa', curto: 'Recibo/Extrato sai pelo Beta. Cozinha continua no Assistente atual.' },
  cozinha_caixa: { titulo: 'Cozinha e Caixa', curto: 'Cozinha e Recibo/Extrato saem pelo Beta.' },
}

/** Avaliação da regra dos modos no navegador (a mesma do servidor). */
export function avaliar(p: PainelDados): AvaliacaoModos {
  return avaliarModos({
    agentes: p.agentes.map((a) => ({ id: a.id, nome: a.nome, vistoEm: a.vistoEm, revogado: a.revogado, criadoEm: a.criadoEm })),
    dispositivos: p.dispositivos.map((d) => ({ id: d.id, agenteId: d.agenteId, nomeSistema: d.nomeSistema })),
    funcoes: p.funcoes,
  })
}

function agentesRegra(p: PainelDados) {
  return p.agentes.map((a) => ({ id: a.id, nome: a.nome, vistoEm: a.vistoEm, revogado: a.revogado, criadoEm: a.criadoEm }))
}

/** Computadores pareados (não revogados) e quais têm sinal agora. */
export function situacaoComputadores(p: PainelDados) {
  const ags = agentesRegra(p)
  const ativos = p.agentes.filter((a) => !a.revogado)
  const conectados = ativos.filter((a) => {
    const r = ags.find((x) => x.id === a.id)!
    return agenteOnline(r) && !pareamentoAntigo(r, ags)
  })
  return { ativos, conectados }
}

const BOTAO = 'inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0688D4]'
export const PRIMARIO = `${BOTAO} bg-[#0688D4] text-white hover:bg-[#0570AE]`
export const SECUNDARIO = `${BOTAO} border border-[#D1D5DB] bg-white text-[#1F2937] hover:border-[#0688D4] hover:text-[#0688D4]`
const LINK = 'inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[13px] font-semibold text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#111827] disabled:opacity-45'

// ─── moldura das etapas ──────────────────────────────────────────────────────

/** Cartão de etapa: número num círculo neutro que vira ✓ quando concluída. */
export function Etapa({ numero, titulo, texto, concluida, desabilitada, acao, children, testid }: {
  numero: number
  titulo: string
  texto?: React.ReactNode
  concluida?: boolean
  desabilitada?: boolean
  acao?: React.ReactNode
  children: React.ReactNode
  testid?: string
}) {
  return (
    <section className={['min-w-0 rounded-[12px] border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5', desabilitada ? 'opacity-60' : ''].join(' ')} data-testid={testid} data-desabilitada={desabilitada ? "sim" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={['mt-[1px] flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full text-[13px] font-semibold', concluida ? 'bg-[#0688D4] text-white' : 'border border-[#D1D5DB] text-[#4B5563]'].join(' ')}
            aria-label={concluida ? `Etapa ${numero} concluída` : `Etapa ${numero}`}
            data-concluida={concluida ? 'sim' : 'nao'}
          >
            {concluida ? <Check className="h-4 w-4" strokeWidth={3} /> : numero}
          </span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-[26px] text-[#111827]">{numero}. {titulo}</h2>
            {texto && <p className="mt-0.5 text-[13px] leading-[19px] text-[#6B7280]">{texto}</p>}
          </div>
        </div>
        {acao}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Ponto verde com anel pulsando (computador conectado). */
function PontoConectado() {
  return (
    <span className="relative flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center" aria-hidden>
      <span className="absolute inline-flex h-full w-full rounded-full bg-[#10B981]/30" style={{ animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite' }} />
      <span className="relative flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#ECFDF5]">
        <Wifi className="h-[18px] w-[18px] text-[#059669]" />
      </span>
    </span>
  )
}

// ─── ① Conectar computador ───────────────────────────────────────────────────

export function EtapaConectar({ p, ocupado, onParear, onRevogar, onRenomear }: {
  p: PainelDados
  ocupado: boolean
  onParear: () => void
  onRevogar: (a: AgenteVisao) => void
  onRenomear: (a: AgenteVisao) => void
}) {
  const ags = agentesRegra(p)
  const { ativos, conectados } = situacaoComputadores(p)
  return (
    <Etapa numero={1} titulo="Conectar computador" texto="Instale o Assistente no computador ligado às impressoras e pareie com o sistema." concluida={conectados.length > 0} testid="cartao-assistente">
      {!p.betaLiberado ? (
        <p className="flex items-start gap-2 rounded-[8px] border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5 text-[13px] text-[#92400E]" data-testid="beta-nao-liberado">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" /> A ativação do Beta nesta loja é feita pelo suporte Menuzia. Até lá, a impressão continua pelo Assistente antigo.
        </p>
      ) : ativos.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2.5 text-[14px] text-[#4B5563]" data-testid="assistente-status">
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#F3F4F6]"><WifiOff className="h-[18px] w-[18px] text-[#9CA3AF]" /></span>
            Nenhum computador conectado
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={DOWNLOAD_ASSISTENTE_BETA.url} data-testid="baixar-beta" className={SECUNDARIO}><Download className="h-4 w-4" /> Baixar Assistente</a>
            <button type="button" onClick={onParear} disabled={ocupado} data-testid="gerar-codigo" className={PRIMARIO}><Link2 className="h-4 w-4" /> Parear computador</button>
          </div>
        </div>
      ) : (
        <>
          <span className="sr-only" data-testid="assistente-status">{conectados.length ? 'Conectado' : 'Não conectado'}</span>
          <ul className="divide-y divide-[#F3F4F6]" data-testid="lista-computadores">
            {ativos.map((a) => {
              const r = ags.find((x) => x.id === a.id)!
              const antigo = pareamentoAntigo(r, ags)
              const on = agenteOnline(r) && !antigo
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0" data-testid={`agente-${a.nome}`}>
                  {on ? <PontoConectado /> : (
                    <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-[#F3F4F6]"><WifiOff className="h-[18px] w-[18px] text-[#9CA3AF]" /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[14px] font-semibold text-[#111827]">{a.nome}</strong>
                    <span className={['block text-[13px]', antigo ? 'text-[#B45309]' : on ? 'text-[#059669]' : 'text-[#6B7280]'].join(' ')}>
                      {antigo ? 'Pareamento antigo — desconecte esta entrada' : on ? 'Conectado' : `Sem sinal desde ${quando(a.vistoEm)}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-0.5 max-sm:basis-full max-sm:pl-[40px]">
                    <button type="button" disabled={ocupado} onClick={() => onRenomear(a)} className={LINK}><Pencil className="h-3.5 w-3.5" /> Renomear</button>
                    <button type="button" disabled={ocupado} onClick={() => onRevogar(a)} data-testid={`revogar-${a.nome}`} className={`${LINK} text-[#DC2626] hover:bg-[#FEF2F2] hover:text-[#B91C1C]`}>
                      <Unplug className="h-3.5 w-3.5" /> Desconectar
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#F3F4F6] pt-3">
            <button type="button" onClick={onParear} disabled={ocupado} data-testid="gerar-codigo" className={LINK}><Link2 className="h-4 w-4" /> Parear outro computador</button>
            <a href={DOWNLOAD_ASSISTENTE_BETA.url} data-testid="baixar-beta" className={LINK}><Download className="h-4 w-4" /> Baixar Assistente</a>
          </div>
        </>
      )}
    </Etapa>
  )
}

export function ModalPareamento({ codigo, erro, conectado, onGerarOutro, onFechar }: {
  codigo: { codigo: string; expiraEm: string } | null
  erro: string | null
  conectado: string | null
  onGerarOutro: () => void
  onFechar: () => void
}) {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const resta = codigo ? Math.max(0, new Date(codigo.expiraEm).getTime() - agora) : 0
  const mmss = `${String(Math.floor(resta / 60000)).padStart(2, '0')}:${String(Math.floor((resta % 60000) / 1000)).padStart(2, '0')}`
  return (
    <ModalBase titulo="Parear computador" onFechar={onFechar} testid="modal-pareamento" largura="max-w-md"
      rodape={<button type="button" onClick={onFechar} className={SECUNDARIO}>Fechar</button>}>
      {conectado ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center" data-testid="pareamento-ok">
          <CheckCircle2 className="h-12 w-12 text-[#059669]" />
          <p className="text-[16px] font-semibold text-[#111827]">{conectado} · conectado</p>
          <p className="text-[13px] text-[#6B7280]">Agora escolha as impressoras da Cozinha e do Recibo/Extrato.</p>
        </div>
      ) : erro ? (
        <p className="rounded-[8px] bg-[#FEF2F2] px-3 py-2.5 text-[13px] text-[#B91C1C]" role="alert">{erro}</p>
      ) : !codigo ? (
        <p className="flex items-center justify-center gap-2 py-6 text-center text-[13px] text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> Gerando código…</p>
      ) : resta === 0 ? (
        <div className="space-y-3 py-2 text-center">
          <p className="text-[13px] text-[#6B7280]">Este código venceu.</p>
          <button type="button" onClick={onGerarOutro} className={PRIMARIO}>Gerar outro código</button>
        </div>
      ) : (
        <div className="space-y-3 text-center">
          <p className="text-[13px] text-[#1F2937]">Digite este código no <strong>Assistente Menuzia Beta</strong> instalado no computador da loja.</p>
          <p className="rounded-[10px] bg-[#F3F4F6] py-4 font-mono text-[34px] font-semibold tracking-[0.18em] text-[#111827]" data-testid="codigo-pareamento">{codigo.codigo}</p>
          <p className="text-[13px] text-[#6B7280]">Vale uma vez · expira em <strong className="text-[#111827]" data-testid="pareamento-tempo">{mmss}</strong></p>
          <p className="flex items-center justify-center gap-1.5 text-[12px] text-[#6B7280]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#F59E0B]" /> Aguardando o computador…</p>
        </div>
      )}
    </ModalBase>
  )
}

// ─── ② Impressoras ───────────────────────────────────────────────────────────

function problemaTexto(funcao: Funcao, p: ProblemaFuncao | null) {
  return p && p !== 'vazia' ? motivoProblema(funcao, p) : null
}

export function EtapaImpressoras({ p, onEscolher }: { p: PainelDados; onEscolher: () => void }) {
  const av = avaliar(p)
  const { ativos } = situacaoComputadores(p)
  const semComputador = ativos.length === 0
  const semDispositivos = !p.dispositivos.some((d) => !p.agentes.find((a) => a.id === d.agenteId)?.revogado)
  const concluida = !!p.funcoes.cozinha && !!p.funcoes.caixa && !problemaTexto('cozinha', av.funcoes.cozinha) && !problemaTexto('caixa', av.funcoes.caixa)
  const linha = (f: Funcao, Icone: typeof ChefHat) => {
    const d = p.dispositivos.find((x) => x.id === p.funcoes[f])
    const prob = problemaTexto(f, av.funcoes[f])
    return (
      <div className="flex min-w-0 items-baseline gap-2 py-2" data-testid={`resumo-${f}`}>
        <Icone className="h-4 w-4 flex-shrink-0 translate-y-[3px] text-[#6B7280]" />
        <span className="flex-shrink-0 text-[13px] text-[#4B5563]">{ROTULO_FUNCAO_CURTO[f]}</span>
        <span className="min-w-[16px] flex-1 translate-y-[-3px] border-b border-dotted border-[#D1D5DB]" aria-hidden />
        <span className="min-w-0 text-right">
          <span className={['block truncate text-[14px]', d ? 'font-semibold text-[#111827]' : 'text-[#9CA3AF]'].join(' ')}>{d ? nomeDisp(d) : 'Não definida'}</span>
          {prob && <span className="block text-[12px] text-[#B45309]">{prob}</span>}
        </span>
      </div>
    )
  }
  return (
    <Etapa numero={2} titulo="Impressoras" texto={semComputador ? 'Conecte um computador para ver as impressoras.' : 'Onde sai cada documento.'} concluida={concluida} desabilitada={semComputador} testid="cartao-impressoras"
      acao={<button type="button" onClick={onEscolher} disabled={semDispositivos || !p.betaLiberado} data-testid="escolher-impressoras" className={SECUNDARIO}><Printer className="h-4 w-4" /> Escolher impressoras</button>}>
      <div className="divide-y divide-[#F3F4F6]">
        {linha('cozinha', ChefHat)}
        {linha('caixa', ReceiptText)}
      </div>
    </Etapa>
  )
}

type Escolha = '' | 'cozinha' | 'caixa' | 'ambas'
const OPCOES_USO: { valor: Escolha; rotulo: string }[] = [
  { valor: 'cozinha', rotulo: 'Cozinha' },
  { valor: 'caixa', rotulo: 'Caixa' },
  { valor: 'ambas', rotulo: 'Cozinha e Caixa' },
  { valor: '', rotulo: 'Não usar' },
]
const ROTULO_ESCOLHA: Record<Escolha, string> = { '': '', cozinha: 'Cozinha', caixa: 'Caixa', ambas: 'Cozinha e Caixa' }

export function ModalImpressoras({ p, ocupado, onSalvar, onAjustar, onAtualizar, onFechar }: {
  p: PainelDados
  ocupado: boolean
  onSalvar: (novo: Record<Funcao, string | null>) => Promise<void>
  onAjustar: (d: DispositivoVisao, patch: { apelido?: string; larguraMm?: number; tamanhoFonte?: TamanhoLetra }) => Promise<void>
  onAtualizar: () => Promise<void>
  onFechar: () => void
}) {
  const ags = agentesRegra(p)
  const [rascunho, setRascunho] = useState<Record<Funcao, string | null>>({ ...p.funcoes })
  const [selecionada, setSelecionada] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)
  const linhas = useMemo(() => {
    const vis = p.dispositivos.filter((d) => !p.agentes.find((a) => a.id === d.agenteId)?.revogado)
    const rank = (d: DispositivoVisao) => {
      const a = ags.find((x) => x.id === d.agenteId)!
      return (pareamentoAntigo(a, ags) ? 4 : 0) + (ehImpressoraVirtual(d.nomeSistema) ? 2 : 0) + (agenteOnline(a) ? 0 : 1)
    }
    return [...vis].sort((x, y) => rank(x) - rank(y))
  }, [p.dispositivos, p.agentes, ags])

  const escolhaDe = (id: string): Escolha =>
    rascunho.cozinha === id && rascunho.caixa === id ? 'ambas' : rascunho.cozinha === id ? 'cozinha' : rascunho.caixa === id ? 'caixa' : ''
  function escolher(id: string, e: Escolha) {
    setRascunho((r) => {
      const n = { ...r }
      for (const f of ['cozinha', 'caixa'] as Funcao[]) if (n[f] === id) n[f] = null
      if (e === 'cozinha' || e === 'ambas') n.cozinha = id
      if (e === 'caixa' || e === 'ambas') n.caixa = id
      return n
    })
  }
  const mudou = rascunho.cozinha !== p.funcoes.cozinha || rascunho.caixa !== p.funcoes.caixa
  const computadores = [...new Set(linhas.map((d) => ags.find((a) => a.id === d.agenteId)?.nome).filter(Boolean))].join(', ')
  async function atualizar() {
    setAtualizando(true)
    await onAtualizar().catch(() => {})
    setAtualizando(false)
  }

  return (
    <ModalBase titulo="Impressoras detectadas" subtitulo={computadores ? `No computador ${computadores}` : 'Nenhum computador com impressoras'} onFechar={onFechar} testid="modal-impressoras" largura="max-w-2xl"
      acaoTopo={<button type="button" onClick={() => void atualizar()} disabled={atualizando} data-testid="atualizar-impressoras" className={SECUNDARIO}><RefreshCw className={['h-4 w-4', atualizando ? 'animate-spin' : ''].join(' ')} /> Atualizar lista</button>}
      rodape={<>
        <button type="button" onClick={onFechar} className={SECUNDARIO}>Cancelar</button>
        <button type="button" disabled={ocupado || !mudou} onClick={() => void onSalvar(rascunho)} data-testid="salvar-impressoras" className={PRIMARIO}>Salvar</button>
      </>}>
      {(!rascunho.cozinha || !rascunho.caixa) && linhas.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-[8px] border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[13px] text-[#92400E]" data-testid="aviso-sem-funcao">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {!rascunho.caixa && !rascunho.cozinha ? 'Nenhuma impressora definida para a Cozinha nem para o Caixa.'
            : !rascunho.caixa ? 'Nenhuma impressora definida para o Caixa: o botão “Imprimir Recibo/Extrato” do PDV não funciona.'
              : 'Nenhuma impressora definida para a Cozinha.'}
        </p>
      )}
      {atualizando && linhas.length === 0 ? (
        <div className="space-y-2.5" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-[62px] animate-pulse rounded-[10px] bg-[#F3F4F6]" />)}</div>
      ) : linhas.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center" data-testid="impressoras-vazio">
          <Printer className="h-8 w-8 text-[#9CA3AF]" />
          <p className="max-w-sm text-[13px] text-[#4B5563]">Nenhuma impressora encontrada. Verifique se ela está ligada e instalada no computador.</p>
          <button type="button" onClick={() => void atualizar()} className={SECUNDARIO}><RefreshCw className="h-4 w-4" /> Atualizar lista</button>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {linhas.map((d) => {
            const a = ags.find((x) => x.id === d.agenteId)!
            const antigo = pareamentoAntigo(a, ags)
            const on = agenteOnline(a)
            const virtual = ehImpressoraVirtual(d.nomeSistema)
            const valor = escolhaDe(d.id)
            const aberta = selecionada === d.id
            return (
              <li key={d.id} className={['rounded-[10px] border transition-colors', aberta ? 'border-[#0688D4] ring-1 ring-[#0688D4]' : valor ? 'border-[#93C5FD]' : 'border-[#E5E7EB]', antigo ? 'bg-[#FFFBEB]' : 'bg-white'].join(' ')} data-testid={`impressora-${d.nomeSistema}`}>
                <button
                  type="button"
                  onClick={() => setSelecionada(aberta ? null : d.id)}
                  aria-expanded={aberta}
                  className="flex w-full items-start gap-3 rounded-[10px] px-3.5 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688D4]"
                  data-testid={`selecionar-${d.nomeSistema}`}
                >
                  <Printer className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#4B5563]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-[#111827]">{nomeDisp(d)}</span>
                    <span className="block text-[12.5px] text-[#6B7280]">
                      {[virtual ? 'Virtual (PDF/XPS)' : 'Impressora', d.apelido ? `Windows: ${d.nomeSistema}` : null, `papel ${d.larguraMm} mm`, `letra ${rotuloLetra(d.tamanhoFonte).toLowerCase()}`, !on ? 'computador sem sinal' : null, !d.disponivel ? 'não encontrada no Windows' : null, antigo ? 'pareamento antigo' : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {valor && <span className="flex-shrink-0 rounded-full bg-[#EFF6FF] px-2 py-[2px] text-[11.5px] font-semibold text-[#0570AE]" data-testid={`uso-${d.nomeSistema}`}>{ROTULO_ESCOLHA[valor]}</span>}
                </button>
                {(aberta || valor) && !antigo && (
                  <div className="px-3.5 pb-3">
                    <div role="radiogroup" aria-label={`Uso de ${nomeDisp(d)}`} data-testid={`funcao-dispositivo-${d.nomeSistema}`} className="grid grid-cols-2 gap-1 rounded-[8px] bg-[#F3F4F6] p-1 sm:grid-cols-4">
                      {OPCOES_USO.map((o) => (
                        <button
                          key={o.rotulo}
                          type="button"
                          role="radio"
                          aria-checked={valor === o.valor}
                          disabled={ocupado}
                          onClick={() => escolher(d.id, o.valor)}
                          data-testid={`funcao-dispositivo-${d.nomeSistema}-${o.valor || 'nenhuma'}`}
                          className={['rounded-[6px] px-2 py-1.5 text-[12.5px] font-semibold transition-colors', valor === o.valor ? 'bg-white text-[#0570AE] shadow-sm' : 'text-[#4B5563] hover:text-[#111827]'].join(' ')}
                        >
                          {o.rotulo}
                        </button>
                      ))}
                    </div>
                    {virtual && valor && <p className="mt-2 text-[12.5px] text-[#92400E]">Impressora virtual: pode abrir uma janela para salvar arquivo em vez de imprimir em papel. Para a operação da loja, use uma térmica.</p>}
                    {aberta && <MaisOpcoes d={d} ocupado={ocupado} onAjustar={onAjustar} />}
                  </div>
                )}
                {antigo && <p className="px-3.5 pb-3 text-[12.5px] text-[#92400E]">Remova o pareamento antigo e pareie novamente — esta impressora não imprime mais.</p>}
              </li>
            )
          })}
        </ul>
      )}
    </ModalBase>
  )
}

function MaisOpcoes({ d, ocupado, onAjustar }: { d: DispositivoVisao; ocupado: boolean; onAjustar: (d: DispositivoVisao, patch: { apelido?: string; larguraMm?: number; tamanhoFonte?: TamanhoLetra }) => Promise<void> }) {
  const [apelido, setApelido] = useState(d.apelido ?? '')
  const campo = 'h-[36px] rounded-[8px] border border-[#D1D5DB] bg-white px-2.5 text-[13px] text-[#111827]'
  return (
    <div className="mt-3 grid gap-2 border-t border-[#F3F4F6] pt-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <label className="text-[12.5px] text-[#6B7280]">
        Apelido (ex.: Cozinha, Caixa)
        <span className="mt-1 flex gap-2">
          <input value={apelido} maxLength={40} onChange={(e) => setApelido(e.target.value)} className={`${campo} min-w-0 flex-1`} />
          <button type="button" disabled={ocupado || apelido === (d.apelido ?? '')} onClick={() => void onAjustar(d, { apelido })} className={SECUNDARIO}>Salvar</button>
        </span>
      </label>
      <span className="flex gap-2">
        <select value={d.larguraMm} disabled={ocupado} onChange={(e) => void onAjustar(d, { larguraMm: Number(e.target.value) })} aria-label="Largura do papel" className={campo}>
          <option value={80}>Papel 80 mm</option>
          <option value={58}>Papel 58 mm</option>
        </select>
        <select value={d.tamanhoFonte} disabled={ocupado} onChange={(e) => void onAjustar(d, { tamanhoFonte: e.target.value as TamanhoLetra })} aria-label="Tamanho da letra" data-testid={`letra-${d.nomeSistema}`} className={campo}>
          {TAMANHOS_LETRA.map((t) => <option key={t.valor} value={t.valor}>Letra {t.rotulo.toLowerCase()}</option>)}
        </select>
      </span>
    </div>
  )
}

// ─── ③ Modo ──────────────────────────────────────────────────────────────────

export function EtapaModo({ p, ocupado, onEscolher, onAjuda }: { p: PainelDados; ocupado: boolean; onEscolher: (m: ModoBeta) => void; onAjuda: () => void }) {
  const av = avaliar(p)
  return (
    <Etapa numero={3} titulo="Modo de operação" texto="O que o Beta imprime nesta loja." concluida={p.modo !== 'teste'} testid="modo-beta"
      acao={<button type="button" onClick={onAjuda} data-testid="ajuda-modos" aria-label="O que cada modo faz" className="flex h-[32px] w-[32px] items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]"><CircleHelp className="h-[18px] w-[18px]" /></button>}>
      <div role="radiogroup" aria-label="Modo de operação" className="grid gap-2.5 md:grid-cols-3">
        {(['teste', 'caixa', 'cozinha_caixa'] as ModoBeta[]).map((m) => {
          const ativo = p.modo === m
          const regra = av.modos[m]
          const bloqueado = !ativo && (!regra.ok || !p.betaLiberado)
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={ativo}
              disabled={ocupado || ativo || bloqueado}
              onClick={() => onEscolher(m)}
              data-testid={`modo-${m}`}
              className={[
                'min-w-0 rounded-[10px] border p-3.5 text-left transition-colors disabled:cursor-default',
                ativo ? 'border-[#0688D4] ring-1 ring-[#0688D4]' : bloqueado ? 'border-[#E5E7EB] bg-[#F9FAFB]' : 'border-[#E5E7EB] hover:border-[#0688D4]',
              ].join(' ')}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className={['flex h-[16px] w-[16px] items-center justify-center rounded-full border', ativo ? 'border-[#0688D4]' : 'border-[#9CA3AF]'].join(' ')} aria-hidden>
                    {ativo && <span className="h-[8px] w-[8px] rounded-full bg-[#0688D4]" />}
                  </span>
                  <span className={['text-[14px] font-semibold', bloqueado ? 'text-[#9CA3AF]' : 'text-[#111827]'].join(' ')}>{TEXTO_MODO[m].titulo}</span>
                </span>
                {ativo && <span className="flex-shrink-0 whitespace-nowrap rounded-full bg-[#EFF6FF] px-2 py-[1px] text-[11px] font-semibold text-[#0570AE]">Em uso</span>}
              </span>
              <span className="mt-1.5 block text-[12.5px] leading-[17px] text-[#6B7280]">{TEXTO_MODO[m].curto}</span>
              {bloqueado && (
                <span className="mt-2 flex items-start gap-1.5 text-[12px] leading-[16px] text-[#B45309]" data-testid={`motivo-${m}`}>
                  <AlertTriangle className="mt-[1px] h-3.5 w-3.5 flex-shrink-0" /> {!p.betaLiberado ? 'Aguardando liberação da Menuzia' : regra.motivo}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-[12px] text-[#6B7280]">
        <Info className="mt-[1px] h-3.5 w-3.5 flex-shrink-0" /> Deu problema? Escolha <strong className="font-semibold text-[#374151]">Somente teste</strong>: a cozinha volta na hora para o Assistente atual.
      </p>
    </Etapa>
  )
}

export function ModalModos({ onFechar }: { onFechar: () => void }) {
  const linhas: [ModoBeta, string, string, string][] = [
    ['teste', 'Assistente atual', 'não sai', 'Use enquanto configura e testa. Nenhum pedido real sai pelo Beta.'],
    ['caixa', 'Assistente atual', 'Beta (Recibo/Extrato)', 'O botão “Imprimir Recibo/Extrato” do PDV passa a funcionar. Precisa da impressora de Recibo/Extrato.'],
    ['cozinha_caixa', 'Beta (Cozinha)', 'Beta (Recibo/Extrato)', 'O Assistente atual para de imprimir pedidos. Precisa das duas impressoras e do computador ligado.'],
  ]
  return (
    <ModalBase titulo="O que cada modo faz" onFechar={onFechar} testid="modal-modos" rodape={<button type="button" onClick={onFechar} className={PRIMARIO}>Entendi</button>}>
      <ul className="space-y-3">
        {linhas.map(([m, cozinha, recibo, texto]) => (
          <li key={m} className="rounded-[10px] border border-[#E5E7EB] p-3">
            <p className="text-[14px] font-semibold text-[#111827]">{TEXTO_MODO[m].titulo}</p>
            <p className="mt-1 text-[13px] text-[#6B7280]">{texto}</p>
            <p className="mt-2 text-[12.5px] text-[#4B5563]">Cozinha: <strong className="font-semibold">{cozinha}</strong> · Recibo/Extrato: <strong className="font-semibold">{recibo}</strong></p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-[#6B7280]">
        <strong className="text-[#111827]">Para voltar à segurança:</strong> escolha “Somente teste”. É imediato, e nenhum pedido se perde nem sai em dobro.
      </p>
    </ModalBase>
  )
}

// ─── Testes (pop-up do botão "Testar impressão") ────────────────────────────

export type TipoTeste = 'cozinha' | 'recibo' | 'calibrar'
const TESTE: Record<TipoTeste, { titulo: string; texto: string; funcao: Funcao | null; botao: string; icone: typeof ChefHat }> = {
  cozinha: { titulo: 'Testar Cozinha', texto: 'Comanda de demonstração na impressora da cozinha.', funcao: 'cozinha', botao: 'Imprimir teste', icone: ChefHat },
  recibo: { titulo: 'Testar Recibo/Extrato', texto: 'Recibo/Extrato de demonstração.', funcao: 'caixa', botao: 'Imprimir teste', icone: ReceiptText },
  calibrar: { titulo: 'Calibrar impressora', texto: 'Passo a passo para o papel sair inteiro, sem cortar a direita.', funcao: null, botao: 'Começar', icone: Ruler },
}
export type ResultadoTeste = { ok: boolean; erro?: string | null }

export function ModalTestes({ p, onTestar, onFechar }: {
  p: PainelDados
  onTestar: (tipo: TipoTeste, d: DispositivoVisao) => Promise<ResultadoTeste>
  onFechar: () => void
}) {
  const ags = agentesRegra(p)
  const opcoes = p.dispositivos.filter((d) => {
    const a = ags.find((x) => x.id === d.agenteId)
    return a && !a.revogado && !pareamentoAntigo(a, ags)
  })
  const padrao = (f: Funcao | null) => (f && p.funcoes[f] && opcoes.some((d) => d.id === p.funcoes[f]) ? p.funcoes[f] : opcoes.find((d) => !ehImpressoraVirtual(d.nomeSistema))?.id) ?? opcoes[0]?.id ?? ''
  const [escolha, setEscolha] = useState<Record<TipoTeste, string>>({ cozinha: padrao('cozinha'), recibo: padrao('caixa'), calibrar: padrao(null) })
  const [estado, setEstado] = useState<Partial<Record<TipoTeste, { s: 'enviando' | 'ok' | 'erro'; msg?: string }>>>({})

  async function rodar(t: TipoTeste) {
    const d = opcoes.find((x) => x.id === escolha[t])
    if (!d) return
    setEstado((e) => ({ ...e, [t]: { s: 'enviando' } }))
    const r = await onTestar(t, d)
    setEstado((e) => ({ ...e, [t]: r.ok ? { s: 'ok', msg: t === 'calibrar' ? undefined : `Enviado para ${nomeDisp(d)}` } : { s: 'erro', msg: r.erro ?? 'Não foi possível enviar.' } }))
  }

  return (
    <ModalBase titulo="Testar impressão" subtitulo="Os testes saem no papel, mas não criam pedido, conta nem pagamento." onFechar={onFechar} testid="modal-teste" largura="max-w-xl"
      rodape={<button type="button" onClick={onFechar} className={SECUNDARIO}>Fechar</button>}>
      <ul className="space-y-2.5">
        {(['cozinha', 'recibo', 'calibrar'] as TipoTeste[]).map((t) => {
          const cfg = TESTE[t]
          const Icone = cfg.icone
          const d = opcoes.find((x) => x.id === escolha[t])
          const a = d ? ags.find((x) => x.id === d.agenteId) : null
          const st = estado[t]
          return (
            <li key={t} className="rounded-[10px] border border-[#E5E7EB] p-3.5" data-testid={`linha-teste-${t}`}>
              <div className="flex items-start gap-3">
                <Icone className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#4B5563]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-[#111827]">{cfg.titulo}</p>
                  <p className="text-[12.5px] text-[#6B7280]">{cfg.texto}</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <select
                      value={escolha[t]}
                      onChange={(e) => setEscolha((x) => ({ ...x, [t]: e.target.value }))}
                      aria-label={`Impressora para ${cfg.titulo}`}
                      data-testid={`teste-impressora-${t}`}
                      className="h-[36px] min-w-0 flex-1 rounded-[8px] border border-[#D1D5DB] bg-white px-2.5 text-[13px] text-[#111827]"
                    >
                      {opcoes.map((x) => (
                        <option key={x.id} value={x.id}>{nomeDisp(x)} · {ags.find((y) => y.id === x.agenteId)?.nome}{ehImpressoraVirtual(x.nomeSistema) ? ' (virtual)' : ''}</option>
                      ))}
                    </select>
                    <button type="button" disabled={!d || st?.s === 'enviando'} onClick={() => void rodar(t)} data-testid={`teste-${t}`} className={SECUNDARIO}>
                      {st?.s === 'enviando' ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</> : cfg.botao}
                    </button>
                  </div>
                  {st?.s === 'ok' && st.msg && <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-[#059669]" data-testid={`teste-${t}-ok`}><CheckCircle2 className="h-4 w-4" /> {st.msg} — confira o papel.</p>}
                  {st?.s === 'erro' && <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-[#DC2626]" role="alert" data-testid={`teste-${t}-erro`}><AlertTriangle className="mt-[1px] h-4 w-4 flex-shrink-0" /> {st.msg}</p>}
                  {a && !agenteOnline(a) && <p className="mt-2 text-[12.5px] text-[#B45309]">O computador está sem sinal: o teste espera até ele abrir (vence em 10 min).</p>}
                  {d && ehImpressoraVirtual(d.nomeSistema) && t !== 'calibrar' && <p className="mt-2 text-[12.5px] text-[#92400E]">Impressora virtual: pode abrir uma janela para salvar arquivo em vez de imprimir em papel.</p>}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </ModalBase>
  )
}

// ─── Ajuda e diagnóstico (recolhido) ─────────────────────────────────────────

export function AjudaDiagnostico({ p, onAjudaCompleta }: { p: PainelDados; onAjudaCompleta: () => void }) {
  const ags = agentesRegra(p)
  const ativos = p.dispositivos.filter((d) => !p.agentes.find((a) => a.id === d.agenteId)?.revogado)
  return (
    <details className="group rounded-[12px] border border-[#E5E7EB] bg-white" data-testid="ajuda-diagnostico">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3.5 sm:px-5">
        <Stethoscope className="h-[18px] w-[18px] text-[#4B5563]" />
        <span className="text-[14px] font-semibold text-[#111827]">Ajuda e diagnóstico</span>
        <span className="ml-auto text-[12.5px] text-[#6B7280] group-open:hidden">histórico, detalhes técnicos e guia</span>
      </summary>
      <div className="space-y-4 border-t border-[#F3F4F6] p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onAjudaCompleta} data-testid="ajuda-impressao" className={SECUNDARIO}><CircleHelp className="h-4 w-4" /> Como funciona</button>
          <a href="/guia-impressora.html" target="_blank" rel="noopener noreferrer" className={SECUNDARIO}>Guia de instalação</a>
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-[#111827]"><History className="h-4 w-4" /> Histórico recente</p>
          <p className="mb-1.5 text-[12px] text-[#6B7280]">{AVISO_PAPEL}</p>
          {p.trabalhos.length === 0 ? (
            <p className="text-[13px] text-[#6B7280]">Nenhum Recibo/Extrato ou teste ainda.</p>
          ) : (
            <ul className="divide-y divide-[#F3F4F6] rounded-[10px] border border-[#E5E7EB]" data-testid="historico-impressao">
              {p.trabalhos.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[12.5px]">
                  <span className="text-[#6B7280]">{quando(t.criadoEm)}</span>
                  <span className="font-semibold text-[#111827]">{(t.subtipo && ROTULO_SUBTIPO_TESTE[t.subtipo]) || ROTULO_TIPO_TRABALHO[t.tipo] || t.tipo}{t.tipo === 'pre_conta' ? ` · ${t.via}ª via` : ''}</span>
                  <span className="min-w-0 flex-1 text-[#4B5563]">{t.impressora} · por {t.criadoPorNome}</span>
                  <span className="font-semibold text-[#111827]">{ROTULO_ESTADO_IMPRESSAO[t.estado] ?? t.estado}</span>
                  {t.erro && <span className="w-full text-[#DC2626]">{t.erro}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {ativos.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-[#111827]"><Laptop className="h-4 w-4" /> Detalhes por impressora</p>
            <div className="space-y-1.5">
              {ativos.map((d) => {
                const g = (d.diagnostico ?? {}) as Record<string, string | number | boolean | undefined>
                const a = ags.find((x) => x.id === d.agenteId)
                const linhas: [string, string][] = [
                  ['Computador', a?.nome ?? '—'],
                  ['Driver', String(g.driver ?? '—')],
                  ['Porta', String(g.porta ?? '—')],
                  ['DPI', g.dpiX ? `${g.dpiX} x ${g.dpiY ?? '—'}` : '—'],
                  ['Papel (Windows)', g.papelLarguraMm ? `${g.papelLarguraMm} mm` : '—'],
                  ['Área imprimível', g.areaImprimivelLarguraMm ? `${g.areaImprimivelLarguraMm} mm` : '—'],
                  ['Pontos imprimíveis', g.pontosImprimiveis ? String(g.pontosImprimiveis) : '—'],
                  ['Largura aplicada', `${d.larguraPontos ?? (d.larguraMm === 58 ? 384 : 576)} pontos${d.larguraPontos ? ' (calibrada)' : ' (padrão)'}`],
                  ['Deslocamento', `${d.deslocamentoPontos} pontos`],
                ]
                return (
                  <details key={d.id} className="rounded-[10px] border border-[#E5E7EB]">
                    <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-[#111827]">{nomeDisp(d)}{ehImpressoraVirtual(d.nomeSistema) ? ' · virtual' : ''}</summary>
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-[#F3F4F6] px-3 py-2 text-[12.5px] min-[420px]:grid-cols-2">
                      {linhas.map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <dt className="text-[#6B7280]">{k}</dt>
                          <dd className="text-right font-semibold text-[#111827]">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {d.ultimoErro && <p className="border-t border-[#F3F4F6] px-3 py-2 text-[12.5px] text-[#DC2626]">Último erro ({quando(d.ultimoErroEm)}): {d.ultimoErro}</p>}
                  </details>
                )
              })}
            </div>
          </div>
        )}

        <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-[#6B7280]">
          <li>Papel não saiu? Veja se tem papel, se a tampa está fechada e se a impressora está ligada.</li>
          <li>Fila do Windows travada: em “Impressoras e scanners”, abra a impressora e cancele os documentos parados.</li>
          <li>Reinstalou o Beta? Desconecte a entrada antiga do computador e pareie de novo.</li>
        </ul>
      </div>
    </details>
  )
}
