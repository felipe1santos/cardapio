'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChefHat, CircleHelp, Download, FlaskConical, History, Laptop, Link2, MonitorCog, Printer, ReceiptText,
  Ruler, Settings2, ShieldCheck, Stethoscope, Unplug, Wifi, WifiOff,
} from 'lucide-react'
import { ModalBase } from '@/components/impressao/modal-base'
import { BolhaIcone, Etiqueta, SeloStatus } from '@/components/admin/painel-visual'
import {
  AVISO_PAPEL, DOWNLOAD_ASSISTENTE_BETA, ROTULO_ESTADO_IMPRESSAO, ROTULO_SUBTIPO_TESTE, ROTULO_TIPO_TRABALHO,
} from '@/lib/impressao/rotulos'
import { agenteOnline, avaliarModos, ehImpressoraVirtual, motivoProblema, pareamentoAntigo, type AvaliacaoModos, type ProblemaFuncao } from '@/lib/impressao/regras-modo'
import type { AgenteVisao, DispositivoVisao, Funcao, ModoBeta, TrabalhoVisao } from '@/lib/impressao/servico'

/**
 * Visão NOVA da tela Impressão (Assistente Beta), em 4 cartões + ajuda recolhida:
 *   1. Assistente (status, baixar, parear)   2. Impressoras (resumo + escolha em pop-up)
 *   3. Modo (bloqueado enquanto faltar impressora válida)   4. Testes (em pop-up)
 *   · Ajuda e diagnóstico: histórico, detalhes do driver, guia — fechado por padrão.
 * A regra dos modos é a mesma do servidor (lib/impressao/regras-modo).
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
export const TAMANHOS_LETRA: { valor: TamanhoLetra; rotulo: string }[] = [
  { valor: 'grande', rotulo: 'Grande (modelo)' },
  { valor: 'media', rotulo: 'Média' },
  { valor: 'pequena', rotulo: 'Pequena' },
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

export function Cartao({ icone, tom, titulo, acao, children, testid }: { icone: typeof Printer; tom: Parameters<typeof BolhaIcone>[0]['tom']; titulo: string; acao?: React.ReactNode; children: React.ReactNode; testid?: string }) {
  return (
    <section className="min-w-0 rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white" data-testid={testid}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <BolhaIcone icone={icone} tom={tom} tamanho={36} />
          <h2 className="text-[15px] font-bold text-[var(--adm-texto)]">{titulo}</h2>
        </div>
        {acao}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

const BOTAO = 'inline-flex items-center justify-center gap-1.5 rounded-[6px] px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45'
const PRIMARIO = `${BOTAO} bg-[#0688D4] text-white hover:bg-[#0570AE]`
export const SECUNDARIO = `${BOTAO} border border-[var(--adm-borda)] bg-white text-[var(--adm-texto)] hover:border-[#0688D4] hover:text-[#0688D4]`

// ─── 1. Assistente ───────────────────────────────────────────────────────────

export function CartaoAssistente({ p, ocupado, onParear, onRevogar, onRenomear }: {
  p: PainelDados
  ocupado: boolean
  onParear: () => void
  onRevogar: (a: AgenteVisao) => void
  onRenomear: (a: AgenteVisao) => void
}) {
  const ativos = p.agentes.filter((a) => !a.revogado)
  const ags = agentesRegra(p)
  const conectados = ativos.filter((a) => agenteOnline(ags.find((x) => x.id === a.id)!))
  const estado = conectados.length ? 'conectado' : ativos.length ? 'desconectado' : 'aguardando'
  const rotulo = conectados.length ? 'Conectado' : ativos.length ? 'Não conectado' : 'Aguardando pareamento'
  return (
    <Cartao icone={MonitorCog} tom="azul" titulo="Assistente Beta" testid="cartao-assistente" acao={<SeloStatus estado={estado} rotulo={rotulo} testid="assistente-status" />}>
      {!p.betaLiberado ? (
        <p className="rounded-[6px] bg-[#FEF3C7] px-3 py-2.5 text-[12.5px] text-[#92400E]" data-testid="beta-nao-liberado">
          A ativação do Beta nesta loja é feita pelo suporte Menuzia. Até lá, a impressão continua pelo Assistente antigo.
        </p>
      ) : (
        <>
          {ativos.length > 0 && (
            <ul className="mb-3 divide-y divide-[var(--adm-borda)] rounded-[6px] border-[0.8px] border-[var(--adm-borda)]" data-testid="lista-computadores">
              {ativos.map((a) => {
                const antigo = pareamentoAntigo(ags.find((x) => x.id === a.id)!, ags)
                const on = agenteOnline(ags.find((x) => x.id === a.id)!)
                return (
                  <li key={a.id} className={['flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5', antigo ? 'bg-[#FFFBEB]' : ''].join(' ')} data-testid={`agente-${a.nome}`}>
                    {on ? <Wifi className="h-4 w-4 flex-shrink-0 text-[#16A34A]" /> : <WifiOff className="h-4 w-4 flex-shrink-0 text-[#94A3B8]" />}
                    <span className="min-w-0 flex-1 text-[13.5px]">
                      <strong className="block text-[var(--adm-texto)]">{a.nome}</strong>
                      <span className={['block text-[12.5px]', antigo ? 'font-semibold text-[#B45309]' : on ? 'text-[#16A34A]' : 'text-[var(--adm-texto-suave)]'].join(' ')}>{antigo ? 'pareamento antigo' : on ? 'conectado' : `sem sinal desde ${quando(a.vistoEm)}`}</span>
                      {antigo && <span className="block text-[12px] text-[#92400E]" data-testid={`agente-antigo-${a.nome}`}>Este computador foi pareado de novo. Desconecte esta entrada antiga.</span>}
                    </span>
                    <span className="flex gap-1.5">
                      <button type="button" disabled={ocupado} onClick={() => onRenomear(a)} className="rounded-[6px] px-2 py-1 text-[12px] font-semibold text-[var(--adm-texto-suave)] hover:bg-[#F1F5F9]">Renomear</button>
                      <button type="button" disabled={ocupado} onClick={() => onRevogar(a)} data-testid={`revogar-${a.nome}`} className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] font-semibold text-[#DC2626] hover:bg-[#FEE2E2]">
                        <Unplug className="h-3.5 w-3.5" /> Desconectar
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {!ativos.length && <p className="mb-3 text-[13px] text-[var(--adm-texto-suave)]">Instale o Assistente Beta no computador da loja e pareie com um código. Não precisa de token.</p>}
          <div className="flex flex-wrap gap-2">
            <a href={DOWNLOAD_ASSISTENTE_BETA.url} data-testid="baixar-beta" className={SECUNDARIO}>
              <Download className="h-4 w-4" /> Baixar Assistente
            </a>
            <button type="button" onClick={onParear} disabled={ocupado} data-testid="gerar-codigo" className={PRIMARIO}>
              <Link2 className="h-4 w-4" /> Parear computador
            </button>
          </div>
        </>
      )}
    </Cartao>
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
          <CheckCircle2 className="h-12 w-12 text-[#16A34A]" />
          <p className="text-[16px] font-bold text-[var(--adm-texto)]">{conectado} · conectado</p>
          <p className="text-[12.5px] text-[var(--adm-texto-suave)]">Agora escolha as impressoras da Cozinha e do Recibo/Extrato.</p>
        </div>
      ) : erro ? (
        <p className="rounded-[6px] bg-[#FEE2E2] px-3 py-2.5 text-[13px] text-[#B91C1C]" role="alert">{erro}</p>
      ) : !codigo ? (
        <p className="py-6 text-center text-[13px] text-[var(--adm-texto-suave)]">Gerando código…</p>
      ) : resta === 0 ? (
        <div className="space-y-3 py-2 text-center">
          <p className="text-[13px] text-[var(--adm-texto-suave)]">Este código venceu.</p>
          <button type="button" onClick={onGerarOutro} className={PRIMARIO}>Gerar outro código</button>
        </div>
      ) : (
        <div className="space-y-3 text-center">
          <p className="text-[13px] text-[var(--adm-texto)]">Digite este código no <strong>Assistente Menuzia Beta</strong> instalado no computador da loja.</p>
          <p className="rounded-[8px] bg-[#F1F5F9] py-4 font-mono text-[34px] font-extrabold tracking-[0.18em] text-[var(--adm-texto)]" data-testid="codigo-pareamento">{codigo.codigo}</p>
          <p className="text-[12.5px] text-[var(--adm-texto-suave)]">Vale uma vez · expira em <strong className="text-[var(--adm-texto)]" data-testid="pareamento-tempo">{mmss}</strong></p>
          <p className="flex items-center justify-center gap-1.5 text-[12px] text-[var(--adm-texto-suave)]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#F59E0B]" /> Aguardando o computador…</p>
        </div>
      )}
    </ModalBase>
  )
}

// ─── 2. Impressoras ──────────────────────────────────────────────────────────

function problemaTexto(funcao: Funcao, p: ProblemaFuncao | null) {
  return p && p !== 'vazia' ? motivoProblema(funcao, p) : null
}

export function CartaoImpressoras({ p, onEscolher }: { p: PainelDados; onEscolher: () => void }) {
  const av = avaliar(p)
  const linha = (f: Funcao, Icone: typeof ChefHat) => {
    const d = p.dispositivos.find((x) => x.id === p.funcoes[f])
    const prob = problemaTexto(f, av.funcoes[f])
    return (
      <div className="flex min-w-0 items-start gap-2.5 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] px-3 py-2.5" data-testid={`resumo-${f}`}>
        <Icone className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--adm-texto-suave)]" />
        <div className="min-w-0">
          <p className="text-[12px] text-[var(--adm-texto-suave)]">{ROTULO_FUNCAO_CURTO[f]}</p>
          <p className={['truncate text-[14px] font-semibold', d ? 'text-[var(--adm-texto)]' : 'text-[var(--adm-texto-suave)]'].join(' ')}>{d ? nomeDisp(d) : 'Não escolhida'}</p>
          {prob && <p className="mt-0.5 text-[12px] text-[#B45309]">{prob}</p>}
        </div>
      </div>
    )
  }
  const semDispositivos = !p.dispositivos.some((d) => !p.agentes.find((a) => a.id === d.agenteId)?.revogado)
  return (
    <Cartao icone={Printer} tom="roxo" titulo="Impressoras" testid="cartao-impressoras"
      acao={<button type="button" onClick={onEscolher} disabled={semDispositivos || !p.betaLiberado} data-testid="escolher-impressoras" className={PRIMARIO}><Settings2 className="h-4 w-4" /> Escolher impressoras</button>}>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {linha('cozinha', ChefHat)}
        {linha('caixa', ReceiptText)}
      </div>
      {semDispositivos && <p className="mt-2.5 text-[12.5px] text-[var(--adm-texto-suave)]">Pareie um computador: as impressoras dele aparecem aqui.</p>}
    </Cartao>
  )
}

type Escolha = '' | 'cozinha' | 'caixa' | 'ambas'

export function ModalImpressoras({ p, ocupado, onSalvar, onAjustar, onFechar }: {
  p: PainelDados
  ocupado: boolean
  onSalvar: (novo: Record<Funcao, string | null>) => Promise<void>
  onAjustar: (d: DispositivoVisao, patch: { apelido?: string; larguraMm?: number; tamanhoFonte?: TamanhoLetra }) => Promise<void>
  onFechar: () => void
}) {
  const ags = agentesRegra(p)
  const [rascunho, setRascunho] = useState<Record<Funcao, string | null>>({ ...p.funcoes })
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
  const semCaixa = !rascunho.caixa

  return (
    <ModalBase titulo="Escolher impressoras" subtitulo="Diga o que cada impressora faz. Só as térmicas da loja devem ter função." onFechar={onFechar} testid="modal-impressoras" largura="max-w-2xl"
      rodape={<>
        <button type="button" onClick={onFechar} className={SECUNDARIO}>Cancelar</button>
        <button type="button" disabled={ocupado || !mudou} onClick={() => void onSalvar(rascunho)} data-testid="salvar-impressoras" className={PRIMARIO}>Salvar</button>
      </>}>
      {semCaixa && (
        <p className="mb-3 flex items-start gap-2 rounded-[6px] bg-[#FFFBEB] px-3 py-2 text-[12.5px] text-[#92400E]">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> Sem impressora de Recibo/Extrato, o botão “Imprimir Recibo/Extrato” do PDV não funciona.
        </p>
      )}
      <ul className="space-y-2.5">
        {linhas.map((d) => {
          const a = ags.find((x) => x.id === d.agenteId)!
          const antigo = pareamentoAntigo(a, ags)
          const on = agenteOnline(a)
          const virtual = ehImpressoraVirtual(d.nomeSistema)
          const valor = escolhaDe(d.id)
          return (
            <li key={d.id} className={['rounded-[6px] border-[0.8px] p-3', antigo ? 'border-[#FDE68A] bg-[#FFFBEB]' : valor ? 'border-[#0688D4]/50 bg-[#F0F9FF]' : 'border-[var(--adm-borda)]'].join(' ')} data-testid={`impressora-${d.nomeSistema}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-semibold text-[var(--adm-texto)]">
                    <Printer className="h-4 w-4 text-[var(--adm-texto-suave)]" /> {nomeDisp(d)}
                    {virtual && <Etiqueta tom="ambar" title="Impressora que o Windows cria (PDF, XPS, Fax, OneNote). Pode abrir uma janela para salvar arquivo.">virtual</Etiqueta>}
                    {antigo && <Etiqueta tom="laranja">pareamento antigo</Etiqueta>}
                    {!antigo && !on && <Etiqueta tom="cinza">computador sem sinal</Etiqueta>}
                    {!d.disponivel && <Etiqueta tom="vermelho">não encontrada no Windows</Etiqueta>}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[var(--adm-texto-suave)]">{a.nome} · {on ? 'conectado' : 'sem sinal'}{d.apelido ? ` · Windows: ${d.nomeSistema}` : ''} · papel {d.larguraMm} mm · letra {rotuloLetra(d.tamanhoFonte).toLowerCase()}</p>
                </div>
                <select
                  value={valor}
                  disabled={ocupado || antigo}
                  onChange={(e) => escolher(d.id, e.target.value as Escolha)}
                  data-testid={`funcao-dispositivo-${d.nomeSistema}`}
                  aria-label={`Função de ${nomeDisp(d)}`}
                  className="h-[36px] min-w-[190px] rounded-[6px] border border-[var(--adm-borda)] bg-white px-2.5 text-[13px] text-[var(--adm-texto)] disabled:bg-[#F1F5F9] max-sm:w-full"
                >
                  <option value="">Sem função</option>
                  <option value="cozinha">Cozinha</option>
                  <option value="caixa">Recibo/Extrato</option>
                  <option value="ambas">Cozinha e Recibo/Extrato</option>
                </select>
              </div>
              {antigo && <p className="mt-1.5 text-[12px] text-[#92400E]">Remova o pareamento antigo e pareie novamente — esta impressora não imprime mais.</p>}
              {virtual && valor && <p className="mt-1.5 text-[12px] text-[#92400E]">Impressora virtual: pode abrir uma janela para salvar arquivo em vez de imprimir em papel. Para operação da loja, recomendamos uma impressora térmica/física. Você pode usar esta impressora para testar o fluxo completo.</p>}
              {!antigo && (
                <details className="mt-2 text-[12.5px]">
                  <summary className="cursor-pointer text-[12px] font-semibold text-[var(--adm-texto-suave)]">Mais opções</summary>
                  <MaisOpcoes d={d} ocupado={ocupado} onAjustar={onAjustar} />
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </ModalBase>
  )
}

function MaisOpcoes({ d, ocupado, onAjustar }: { d: DispositivoVisao; ocupado: boolean; onAjustar: (d: DispositivoVisao, patch: { apelido?: string; larguraMm?: number; tamanhoFonte?: TamanhoLetra }) => Promise<void> }) {
  const [apelido, setApelido] = useState(d.apelido ?? '')
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
      <label className="text-[12px] text-[var(--adm-texto-suave)]">
        Apelido (ex.: Cozinha, Caixa)
        <input value={apelido} maxLength={40} onChange={(e) => setApelido(e.target.value)} className="mt-1 block h-[34px] w-full rounded-[6px] border border-[var(--adm-borda)] px-2.5 text-[13px] text-[var(--adm-texto)]" />
      </label>
      <button type="button" disabled={ocupado || apelido === (d.apelido ?? '')} onClick={() => void onAjustar(d, { apelido })} className={SECUNDARIO}>Salvar apelido</button>
      <select value={d.larguraMm} disabled={ocupado} onChange={(e) => void onAjustar(d, { larguraMm: Number(e.target.value) })} aria-label="Largura do papel" className="h-[36px] rounded-[6px] border border-[var(--adm-borda)] bg-white px-2 text-[13px]">
        <option value={80}>Papel 80 mm</option>
        <option value={58}>Papel 58 mm</option>
      </select>
      <select value={d.tamanhoFonte} disabled={ocupado} onChange={(e) => void onAjustar(d, { tamanhoFonte: e.target.value as TamanhoLetra })} aria-label="Tamanho da letra" data-testid={`letra-${d.nomeSistema}`} className="h-[36px] rounded-[6px] border border-[var(--adm-borda)] bg-white px-2 text-[13px]">
        {TAMANHOS_LETRA.map((t) => <option key={t.valor} value={t.valor}>Letra {t.rotulo.toLowerCase()}</option>)}
      </select>
    </div>
  )
}

// ─── 3. Modo ─────────────────────────────────────────────────────────────────

export function CartaoModo({ p, ocupado, onEscolher, onAjuda }: { p: PainelDados; ocupado: boolean; onEscolher: (m: ModoBeta) => void; onAjuda: () => void }) {
  const av = avaliar(p)
  return (
    <Cartao icone={ShieldCheck} tom="verde" titulo="Modo de operação" testid="modo-beta"
      acao={<button type="button" onClick={onAjuda} data-testid="ajuda-modos" aria-label="O que cada modo faz" className="flex h-[32px] w-[32px] items-center justify-center rounded-full text-[#0688D4] hover:bg-[#E0F2FE]"><CircleHelp className="h-5 w-5" /></button>}>
      <div className="grid gap-2.5 md:grid-cols-3">
        {(['teste', 'caixa', 'cozinha_caixa'] as ModoBeta[]).map((m) => {
          const ativo = p.modo === m
          const regra = av.modos[m]
          const bloqueado = !ativo && (!regra.ok || !p.betaLiberado)
          return (
            <button
              key={m}
              type="button"
              disabled={ocupado || ativo || bloqueado}
              onClick={() => onEscolher(m)}
              data-testid={`modo-${m}`}
              className={[
                'min-w-0 rounded-[8px] border-2 p-3 text-left transition-colors disabled:cursor-default',
                ativo ? 'border-[#10B981] bg-[#F0FDF4]' : bloqueado ? 'border-[var(--adm-borda)] bg-[#F8FAFC]' : 'border-[var(--adm-borda)] hover:border-[#0688D4]',
              ].join(' ')}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={['text-[14px] font-bold', bloqueado ? 'text-[var(--adm-texto-suave)]' : 'text-[var(--adm-texto)]'].join(' ')}>{TEXTO_MODO[m].titulo}</span>
                {ativo && <span className="rounded-full bg-[#10B981] px-2 py-[2px] text-[10.5px] font-bold uppercase text-white">em uso</span>}
              </span>
              <span className="mt-1 block text-[12.5px] leading-[17px] text-[var(--adm-texto-suave)]">{TEXTO_MODO[m].curto}</span>
              {bloqueado && (
                <span className="mt-2 flex items-start gap-1.5 text-[12px] font-semibold leading-[16px] text-[#B45309]" data-testid={`motivo-${m}`}>
                  <AlertTriangle className="mt-[1px] h-3.5 w-3.5 flex-shrink-0" /> {!p.betaLiberado ? 'Aguardando liberação da Menuzia' : regra.motivo}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {p.modo !== 'teste' && <p className="mt-2.5 text-[12px] text-[var(--adm-texto-suave)]">Deu problema? Toque em <strong className="text-[var(--adm-texto)]">Somente teste</strong>: a cozinha volta na hora para o Assistente atual.</p>}
    </Cartao>
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
          <li key={m} className="rounded-[6px] border-[0.8px] border-[var(--adm-borda)] p-3">
            <p className="text-[14px] font-bold text-[var(--adm-texto)]">{TEXTO_MODO[m].titulo}</p>
            <p className="mt-1 text-[12.5px] text-[var(--adm-texto-suave)]">{texto}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Etiqueta tom="laranja">Cozinha: {cozinha}</Etiqueta>
              <Etiqueta tom="roxo">Recibo/Extrato: {recibo}</Etiqueta>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] text-[var(--adm-texto-suave)]">
        <strong className="text-[var(--adm-texto)]">Para voltar à segurança:</strong> escolha “Somente teste”. É imediato, e nenhum pedido se perde nem sai em dobro.
      </p>
    </ModalBase>
  )
}

// ─── 4. Testes ───────────────────────────────────────────────────────────────

export type TipoTeste = 'cozinha' | 'recibo' | 'calibrar'
const TESTE: Record<TipoTeste, { titulo: string; texto: string; funcao: Funcao | null; botao: string }> = {
  cozinha: { titulo: 'Testar Cozinha', texto: 'Imprime uma página de teste na impressora escolhida. Não cria pedido.', funcao: 'cozinha', botao: 'Imprimir teste' },
  recibo: { titulo: 'Testar Recibo/Extrato', texto: 'Imprime um Recibo/Extrato de demonstração. Não cria conta, pedido nem pagamento.', funcao: 'caixa', botao: 'Imprimir teste' },
  calibrar: { titulo: 'Calibrar impressora', texto: 'Passo a passo para o papel sair inteiro, sem cortar a direita.', funcao: null, botao: 'Começar' },
}

export function CartaoTestes({ p, ocupado, onTestar }: { p: PainelDados; ocupado: boolean; onTestar: (t: TipoTeste) => void }) {
  const tem = p.dispositivos.some((d) => !p.agentes.find((a) => a.id === d.agenteId)?.revogado)
  const itens: [TipoTeste, typeof ChefHat][] = [['cozinha', ChefHat], ['recibo', ReceiptText], ['calibrar', Ruler]]
  return (
    <Cartao icone={FlaskConical} tom="laranja" titulo="Testes" testid="cartao-testes">
      <div className="grid gap-2 sm:grid-cols-3">
        {itens.map(([t, Icone]) => (
          <button key={t} type="button" disabled={ocupado || !tem || !p.betaLiberado} onClick={() => onTestar(t)} data-testid={`teste-${t}`} className={`${SECUNDARIO} w-full py-2.5`}>
            <Icone className="h-4 w-4" /> {TESTE[t].titulo}
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-[12px] text-[var(--adm-texto-suave)]" data-testid="logo-recibo">
        {tem ? 'Testes saem no papel, mas não criam pedido, conta nem pagamento.' : 'Pareie um computador para testar as impressoras dele.'}
      </p>
    </Cartao>
  )
}

export function ModalTeste({ tipo, p, ocupado, onConfirmar, onFechar }: { tipo: TipoTeste; p: PainelDados; ocupado: boolean; onConfirmar: (d: DispositivoVisao) => void; onFechar: () => void }) {
  const ags = agentesRegra(p)
  const opcoes = p.dispositivos.filter((d) => {
    const a = ags.find((x) => x.id === d.agenteId)
    return a && !a.revogado && !pareamentoAntigo(a, ags)
  })
  const cfg = TESTE[tipo]
  const padrao = (cfg.funcao && p.funcoes[cfg.funcao] && opcoes.some((d) => d.id === p.funcoes[cfg.funcao!]) ? p.funcoes[cfg.funcao] : opcoes.find((d) => !ehImpressoraVirtual(d.nomeSistema))?.id) ?? opcoes[0]?.id ?? ''
  const [escolhida, setEscolhida] = useState<string>(padrao)
  const d = opcoes.find((x) => x.id === escolhida)
  const a = d ? ags.find((x) => x.id === d.agenteId) : null
  return (
    <ModalBase titulo={cfg.titulo} subtitulo={cfg.texto} onFechar={onFechar} testid="modal-teste" largura="max-w-md"
      rodape={<>
        <button type="button" onClick={onFechar} className={SECUNDARIO}>Cancelar</button>
        <button type="button" disabled={ocupado || !d} onClick={() => d && onConfirmar(d)} data-testid="teste-confirmar" className={PRIMARIO}>{cfg.botao}</button>
      </>}>
      <label className="block text-[12.5px] font-semibold text-[var(--adm-texto-forte)]">
        Impressora
        <select value={escolhida} onChange={(e) => setEscolhida(e.target.value)} data-testid="teste-impressora" className="mt-1.5 block h-[38px] w-full rounded-[6px] border border-[var(--adm-borda)] bg-white px-2.5 text-[13px] font-normal text-[var(--adm-texto)]">
          {opcoes.map((x) => (
            <option key={x.id} value={x.id}>
              {nomeDisp(x)} · {ags.find((y) => y.id === x.agenteId)?.nome}{ehImpressoraVirtual(x.nomeSistema) ? ' (virtual)' : ''}
            </option>
          ))}
        </select>
      </label>
      {a && !agenteOnline(a) && <p className="mt-2 text-[12.5px] text-[#B45309]">O computador está sem sinal: o teste espera até ele abrir (vence em 10 min).</p>}
      {d && ehImpressoraVirtual(d.nomeSistema) && <p className="mt-2 text-[12.5px] text-[#92400E]">Impressora virtual: pode abrir uma janela para salvar arquivo em vez de imprimir em papel.</p>}
    </ModalBase>
  )
}

// ─── Ajuda e diagnóstico (recolhido) ─────────────────────────────────────────

export function AjudaDiagnostico({ p, onAjudaCompleta }: { p: PainelDados; onAjudaCompleta: () => void }) {
  const ags = agentesRegra(p)
  const ativos = p.dispositivos.filter((d) => !p.agentes.find((a) => a.id === d.agenteId)?.revogado)
  return (
    <details className="group rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white" data-testid="ajuda-diagnostico">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3.5">
        <BolhaIcone icone={Stethoscope} tom="cinza" tamanho={32} />
        <span className="text-[14px] font-bold text-[var(--adm-texto)]">Ajuda e diagnóstico</span>
        <span className="ml-auto text-[12px] text-[var(--adm-texto-suave)] group-open:hidden">histórico, detalhes técnicos e guia</span>
      </summary>
      <div className="space-y-4 border-t border-[var(--adm-borda)] p-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onAjudaCompleta} data-testid="ajuda-impressao" className={SECUNDARIO}><CircleHelp className="h-4 w-4" /> Como funciona</button>
          <a href="/guia-impressora.html" target="_blank" rel="noopener noreferrer" className={SECUNDARIO}>Guia de instalação</a>
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-[var(--adm-texto-forte)]"><History className="h-4 w-4" /> Histórico recente</p>
          <p className="mb-1.5 text-[11.5px] text-[var(--adm-texto-suave)]">{AVISO_PAPEL}</p>
          {p.trabalhos.length === 0 ? (
            <p className="text-[12.5px] text-[var(--adm-texto-suave)]">Nenhum Recibo/Extrato ou teste ainda.</p>
          ) : (
            <ul className="divide-y divide-[var(--adm-borda)] rounded-[6px] border-[0.8px] border-[var(--adm-borda)]" data-testid="historico-impressao">
              {p.trabalhos.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[12px]">
                  <span className="text-[var(--adm-texto-suave)]">{quando(t.criadoEm)}</span>
                  <span className="font-semibold text-[var(--adm-texto)]">{(t.subtipo && ROTULO_SUBTIPO_TESTE[t.subtipo]) || ROTULO_TIPO_TRABALHO[t.tipo] || t.tipo}{t.tipo === 'pre_conta' ? ` · ${t.via}ª via` : ''}</span>
                  <span className="min-w-0 flex-1 text-[var(--adm-texto-medio)]">{t.impressora} · por {t.criadoPorNome}</span>
                  <span className="font-semibold text-[var(--adm-texto)]">{ROTULO_ESTADO_IMPRESSAO[t.estado] ?? t.estado}</span>
                  {t.erro && <span className="w-full text-[#DC2626]">{t.erro}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {ativos.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-[var(--adm-texto-forte)]"><Laptop className="h-4 w-4" /> Detalhes por impressora</p>
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
                  <details key={d.id} className="rounded-[6px] border-[0.8px] border-[var(--adm-borda)]">
                    <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-semibold text-[var(--adm-texto)]">{nomeDisp(d)}{ehImpressoraVirtual(d.nomeSistema) ? ' · virtual' : ''}</summary>
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-[var(--adm-borda)] px-3 py-2 text-[12px] min-[420px]:grid-cols-2">
                      {linhas.map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <dt className="text-[var(--adm-texto-suave)]">{k}</dt>
                          <dd className="text-right font-semibold text-[var(--adm-texto)]">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {d.ultimoErro && <p className="border-t border-[var(--adm-borda)] px-3 py-2 text-[12px] text-[#DC2626]">Último erro ({quando(d.ultimoErroEm)}): {d.ultimoErro}</p>}
                  </details>
                )
              })}
            </div>
          </div>
        )}

        <ul className="list-disc space-y-1 pl-5 text-[12px] text-[var(--adm-texto-suave)]">
          <li>Papel não saiu? Veja se tem papel, se a tampa está fechada e se a impressora está ligada.</li>
          <li>Fila do Windows travada: em “Impressoras e scanners”, abra a impressora e cancele os documentos parados.</li>
          <li>Reinstalou o Beta? Desconecte a entrada antiga do computador e pareie de novo.</li>
        </ul>
      </div>
    </details>
  )
}
