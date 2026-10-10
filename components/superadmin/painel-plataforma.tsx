'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, ExternalLink, LogOut, MoreVertical, Plus, Search, Users, X } from 'lucide-react'
import { CartaoNumero } from '@/components/admin/cartao-numero'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'
import { Flutuante } from '@/components/ui/flutuante'
import { ICONES } from '@/lib/icones-painel'
import type { LojaPlataforma, ResumoPlataforma, SituacaoLoja, Sublogin } from '@/lib/queries/plataforma'
import type { UsoApis } from '@/lib/custo/uso'
import { BarraUsoLoja, UsoApisResumo } from './uso-apis'
import type { UsoIa } from '@/lib/custo/ia'
import { IaDaLoja, UsoIaResumo } from './uso-ia'
import type { ModulosDaLoja } from '@/lib/modulos'
import { ModulosLoja } from './modulos-loja'
import {
  alterarValidadeAction, alternarBetaImpressaoAction, bloquearAction, desbloquearAction, excluirDadosAction,
  preCadastrarAction, removerPreCadastroAction, sairAction, type ResultadoAcao,
} from '@/app/superadmin/actions'

/**
 * Painel da plataforma (2026-10-04): uma linha por loja, sublogins num modal, cadastro de
 * cliente por modal, filtros/busca/ordenação e lista de cartões no celular.
 * Regras do painel: cores vivas com texto claro, menus e dicas por cima (Flutuante, z 9999).
 */

const TZ = 'America/Sao_Paulo'
const POR_PAGINA = 20
const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (v: number) => v.toLocaleString('pt-BR')
const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ }) : '—')
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—')
/** Data do input <date> a partir de um ISO, no fuso de São Paulo. */
const isoParaInput = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }) : '')
const amanha = () => new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ })

const PAPEL: Record<string, string> = { dono: 'Dono', gerente: 'Gerente', atendente: 'Atendente', cozinha: 'Cozinha', logistica: 'Logística', entregador: 'Entregador', garcom: 'Garçom' }
const CARGO: Record<string, string> = { garcom: 'Garçom', motoboy: 'Motoboy', caixa: 'Caixa', cozinheiro: 'Cozinheiro' }

type Filtro = 'todos' | 'ativo' | 'ativo_temporario' | 'pendente' | 'sem_acesso'
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'ativo', rotulo: 'Ativos' },
  { id: 'ativo_temporario', rotulo: 'Ativos com validade' },
  { id: 'pendente', rotulo: 'Aguardando 1º acesso' },
  { id: 'sem_acesso', rotulo: 'Sem acesso' },
]
const passaFiltro = (l: LojaPlataforma, f: Filtro) =>
  f === 'todos' || (f === 'sem_acesso' ? l.situacao === 'revogado' || l.situacao === 'expirado' : l.situacao === f)

type Coluna = 'loja' | 'situacao' | 'sublogins' | 'faturamento' | 'pedidos' | 'ticket' | 'criadoEm' | 'ultimoLoginEm'
const ORDEM_SITUACAO: Record<SituacaoLoja, number> = { ativo: 0, ativo_temporario: 1, pendente: 2, expirado: 3, revogado: 4 }
function valorOrdem(l: LojaPlataforma, c: Coluna): number | string {
  switch (c) {
    case 'loja': return l.loja ? l.loja.toLowerCase() : `\uffff${l.email}` // sem nome vai para o fim
    case 'situacao': return ORDEM_SITUACAO[l.situacao]
    case 'sublogins': return l.sublogins.length
    case 'faturamento': return l.faturamento
    case 'pedidos': return l.pedidos
    case 'ticket': return l.ticket
    case 'criadoEm': return l.criadoEm
    case 'ultimoLoginEm': return l.ultimoLoginEm ?? ''
  }
}

/** Selo de status: fundo sólido vivo, texto branco (contraste ≥ 4,5:1). */
export function SeloSituacao({ l }: { l: Pick<LojaPlataforma, 'situacao' | 'acessoExpiraEm'> }) {
  const [texto, cor] =
    l.situacao === 'ativo' ? ['Ativo', '#15803D']
      : l.situacao === 'ativo_temporario' ? [`Ativo até ${dataCurta(l.acessoExpiraEm)}`, '#0369A1']
        : l.situacao === 'pendente' ? ['Aguardando 1º acesso', '#B45309']
          : l.situacao === 'expirado' ? [`Expirou em ${dataCurta(l.acessoExpiraEm)}`, '#B91C1C']
            : ['Sem acesso', '#B91C1C']
  return <span className="inline-flex whitespace-nowrap rounded-[4px] px-2 py-[3px] text-[11.5px] font-semibold text-white" style={{ backgroundColor: cor }} data-testid="selo-situacao" data-situacao={l.situacao}>{texto}</span>
}

const SELO_SUB: Record<Sublogin['status'], [string, string]> = { ativo: ['Ativo', '#15803D'], pausado: ['Pausado', '#B45309'], bloqueado: ['Bloqueado', '#B91C1C'] }

// ─── Modal: centralizado no computador, tela cheia com "← Voltar" no celular ───────────────────
function Modal({ titulo, onFechar, children, rodape, testid, largura = 520 }: { titulo: string; onFechar: () => void; children: React.ReactNode; rodape?: React.ReactNode; testid: string; largura?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = antes }
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-[9000] flex items-stretch justify-center bg-[rgba(17,24,39,0.55)] sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div role="dialog" aria-modal="true" aria-label={titulo} data-testid={testid}
        className="flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[90vh] sm:rounded-[6px] sm:shadow-[0_20px_50px_rgba(15,23,42,0.3)]" style={{ maxWidth: largura }}>
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
          <button type="button" onClick={onFechar} className="-ml-1 flex h-[40px] items-center gap-1 rounded-[4px] px-1.5 text-[13px] font-semibold text-primary sm:hidden" data-testid="modal-voltar">
            <ArrowLeft className="h-5 w-5" /> Voltar
          </button>
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-main max-sm:text-center max-sm:pr-[70px]">{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="hidden h-[36px] w-[36px] items-center justify-center rounded-[4px] text-text-subtle hover:bg-page sm:flex" data-testid="modal-fechar"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {rodape && <div className="flex flex-shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">{rodape}</div>}
      </div>
    </div>
  )
}

const BTN = 'inline-flex h-[40px] items-center justify-center gap-1.5 rounded-[4px] px-4 text-[12px] font-semibold uppercase tracking-wide transition-[filter] disabled:opacity-50'
const BTN_PRIMARIO = `${BTN} bg-[#0369A1] text-white hover:brightness-110`
const BTN_PERIGO = `${BTN} bg-[#B91C1C] text-white hover:brightness-110`
const BTN_NEUTRO = `${BTN} border border-border bg-white text-text-main hover:bg-page`
const CAMPO = 'h-[42px] w-full rounded-[4px] border border-border bg-white px-3 text-[14px] text-text-main outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30'
const ROTULO = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle'

/** Validade: "Sem validade" ou "Até uma data". */
function CampoValidade({ valor, onMudar }: { valor: string; onMudar: (v: string) => void }) {
  const comData = valor !== ''
  return (
    <fieldset>
      <legend className={ROTULO}>Validade do acesso</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-[14px]"><input type="radio" name="validade" checked={!comData} onChange={() => onMudar('')} data-testid="validade-sem" /> Sem validade</label>
        <label className="flex items-center gap-2 text-[14px]"><input type="radio" name="validade" checked={comData} onChange={() => onMudar(amanha())} data-testid="validade-com" /> Até</label>
        <input type="date" min={amanha()} value={valor} onChange={(e) => onMudar(e.target.value)} disabled={!comData} aria-label="Data final do acesso"
          className={`${CAMPO} w-auto disabled:opacity-50`} data-testid="validade-data" />
      </div>
    </fieldset>
  )
}

type ModalAberto =
  | { tipo: 'cadastrar' }
  | { tipo: 'sublogins'; loja: LojaPlataforma }
  | { tipo: 'detalhes'; loja: LojaPlataforma }
  | { tipo: 'validade'; loja: LojaPlataforma }
  | { tipo: 'desbloquear'; loja: LojaPlataforma }
  | { tipo: 'confirmar'; loja: LojaPlataforma; acao: 'bloquear' | 'remover' | 'beta_liberar' | 'beta_retirar' }
  | { tipo: 'excluir'; loja: LojaPlataforma }

export function PainelPlataforma({ lojas, resumo, emailSuperadmin, usoApis, usoIa, modulos }: { lojas: LojaPlataforma[]; resumo: ResumoPlataforma; emailSuperadmin: string; usoApis?: UsoApis | null; usoIa?: UsoIa | null; modulos?: Record<string, ModulosDaLoja> }) {
  const router = useRouter()
  const toasts = useToasts()
  const [pendente, startTransition] = useTransition()
  const [busca, setBusca] = useState('')
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [ordem, setOrdem] = useState<{ coluna: Coluna; desc: boolean }>({ coluna: 'ultimoLoginEm', desc: true })
  const [pagina, setPagina] = useState(0)
  const [modal, setModal] = useState<ModalAberto | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const ancoraMenu = useRef<HTMLElement | null>(null)
  const fecharMenu = useCallback(() => setMenu(null), [])
  const fecharModal = useCallback(() => setModal(null), [])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const r = lojas.filter((l) => passaFiltro(l, filtro) && (!q || [l.loja, l.responsavel, l.email, l.login, l.telefone, ...l.sublogins.map((s) => s.login)].some((v) => v?.toLowerCase().includes(q))))
    const sinal = ordem.desc ? -1 : 1
    return r.sort((a, b) => {
      const va = valorOrdem(a, ordem.coluna), vb = valorOrdem(b, ordem.coluna)
      const cmp = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb, 'pt-BR') : va < vb ? -1 : va > vb ? 1 : 0
      return cmp * sinal || a.loja.localeCompare(b.loja, 'pt-BR')
    })
  }, [lojas, busca, filtro, ordem])
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA))
  useEffect(() => { setPagina(0) }, [busca, filtro, ordem])
  useEffect(() => { if (pagina > totalPaginas - 1) setPagina(totalPaginas - 1) }, [pagina, totalPaginas])
  const visiveis = filtradas.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA)
  const contagem = useMemo(() => Object.fromEntries(FILTROS.map((f) => [f.id, lojas.filter((l) => passaFiltro(l, f.id)).length])) as Record<Filtro, number>, [lojas])

  /** Executa uma ação do servidor, mostra o toast e recarrega os dados da página. */
  function executar(acao: () => Promise<ResultadoAcao>, aoConcluir?: () => void) {
    startTransition(async () => {
      try {
        const r = await acao()
        if (r.ok) { toasts.mostrar('ok', r.mensagem); setModal(null); aoConcluir?.(); router.refresh() }
        else toasts.mostrar('erro', r.erro)
      } catch {
        toasts.mostrar('erro', 'Não foi possível concluir. Tente de novo.')
      }
    })
  }

  const ordenarPor = (coluna: Coluna) => setOrdem((o) => (o.coluna === coluna ? { coluna, desc: !o.desc } : { coluna, desc: coluna !== 'loja' }))
  const Th = ({ coluna, children, direita, className = '' }: { coluna: Coluna; children: React.ReactNode; direita?: boolean; className?: string }) => (
    <th className={`whitespace-nowrap px-3 py-2.5 ${direita ? 'text-right' : 'text-left'} ${className}`} aria-sort={ordem.coluna === coluna ? (ordem.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => ordenarPor(coluna)} className={`inline-flex items-center gap-1 uppercase hover:text-text-main ${ordem.coluna === coluna ? 'text-text-main' : ''}`} data-testid={`ordenar-${coluna}`}>
        {children}
        {ordem.coluna === coluna && (ordem.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  )

  const BotaoSublogins = ({ l }: { l: LojaPlataforma }) =>
    l.restauranteId ? (
      <button type="button" onClick={() => setModal({ tipo: 'sublogins', loja: l })} className="inline-flex h-[32px] min-w-[44px] items-center justify-center gap-1 rounded-[4px] border border-border bg-white px-2 text-[13px] font-semibold text-[#0369A1] hover:bg-[#E0F2FE]"
        aria-label={`Sublogins de ${l.loja}: ${l.sublogins.length}`} data-testid="sublogins-botao">
        <Users className="h-3.5 w-3.5" /> {l.sublogins.length}
      </button>
    ) : <span className="text-text-subtle">—</span>

  const BotaoMenu = ({ l }: { l: LojaPlataforma }) => (
    <button type="button" aria-label={`Ações de ${l.loja || l.email}`} aria-haspopup="menu" aria-expanded={menu === l.chave}
      onClick={(e) => { ancoraMenu.current = e.currentTarget; setMenu((m) => (m === l.chave ? null : l.chave)) }}
      className="flex h-[36px] w-[36px] items-center justify-center rounded-[4px] text-text-subtle hover:bg-page hover:text-text-main" data-testid="loja-menu">
      <MoreVertical className="h-5 w-5" />
    </button>
  )

  const lojaDoMenu = lojas.find((l) => l.chave === menu) ?? null
  const ITEM = 'flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-text-main hover:bg-page'
  const abrir = (m: ModalAberto) => { setMenu(null); setModal(m) }

  return (
    <div className="min-h-dvh bg-page pb-24 sm:pb-10">
      {/* Topo: título à esquerda, sistema (conta e Sair) à direita, numa linha só. */}
      <header className="sticky top-0 z-30 flex h-[56px] items-center gap-3 border-b border-border bg-white px-4 sm:px-6" data-testid="topo-plataforma">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold text-text-main sm:text-[19px]">Painel da plataforma</h1>
        </div>
        <span className="hidden max-w-[260px] truncate text-[12.5px] text-text-subtle md:inline" title={emailSuperadmin}>{emailSuperadmin}</span>
        <form action={sairAction}>
          <button type="submit" className="flex h-[40px] items-center gap-1.5 rounded-[4px] border border-border bg-white px-3 text-[12.5px] font-semibold text-text-main hover:border-[#B91C1C] hover:text-[#B91C1C]" data-testid="plataforma-sair">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </form>
      </header>

      <main className="mx-auto max-w-[1400px] px-3 py-4 sm:px-6 sm:py-6">
        {/* Resumo: só lojas (contas principais e pré-cadastros); valores somados por loja. */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6" data-testid="resumo-plataforma">
          <CartaoNumero icone={ICONES.loja} tom="cinza" rotulo="Cadastros (lojas)" valor={<span data-testid="resumo-cadastros">{num(resumo.cadastros)}</span>} />
          <CartaoNumero icone={ICONES.concluido} tom="verde" rotulo="Ativos" valor={<span data-testid="resumo-ativos">{num(resumo.ativos)}</span>} />
          <CartaoNumero icone={ICONES.relogio} tom="ambar" rotulo="Aguardando 1º acesso" valor={<span data-testid="resumo-pendentes">{num(resumo.pendentes)}</span>} />
          <CartaoNumero icone={ICONES.dinheiro} tom="verde" rotulo="Faturamento (entregue)" valor={<span data-testid="resumo-faturamento">{brl(resumo.faturamento)}</span>} />
          <CartaoNumero icone={ICONES.pedidos} tom="azul" rotulo="Pedidos entregues" valor={<span data-testid="resumo-pedidos">{num(resumo.pedidos)}</span>} />
          <CartaoNumero icone={ICONES.ticket} tom="roxo" rotulo="Ticket médio" valor={<span data-testid="resumo-ticket">{brl(resumo.ticket)}</span>} />
        </div>

        {/* APIs pagas (guarda de custo, 10/10): uso de hoje, bloqueios, loops e 7 dias. */}
        {usoApis && <UsoApisResumo uso={usoApis} />}

        {/* IA de atendimento (ChatGPT): gasto do sistema e por loja, preparado antes da IA existir. */}
        {usoIa && <UsoIaResumo ia={usoIa} />}

        {/* Barra da lista: busca, filtros e "+ Cadastrar cliente". */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className={`relative ${buscaAberta ? 'flex' : 'hidden'} w-full sm:flex sm:w-[340px]`}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar loja, responsável, e-mail ou login" aria-label="Buscar"
              className={`${CAMPO} pl-9`} data-testid="busca-plataforma" />
          </div>
          <button type="button" onClick={() => setBuscaAberta((v) => !v)} aria-label="Buscar" aria-expanded={buscaAberta}
            className={`flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-[4px] sm:hidden ${buscaAberta || busca ? 'bg-[#0369A1] text-white' : 'border border-border bg-white text-text-main'}`} data-testid="busca-lupa">
            <Search className="h-5 w-5" />
          </button>
          <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filtrar por status">
            {FILTROS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
                className={`flex h-[36px] flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-colors ${filtro === f.id ? 'bg-[#1F2937] text-white' : 'border border-border bg-white text-text-main hover:bg-page'}`}
                data-testid={`filtro-${f.id}`}>
                {f.rotulo} <span className={`rounded-full px-1.5 text-[11px] ${filtro === f.id ? 'bg-white/20' : 'bg-page text-text-subtle'}`}>{contagem[f.id]}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setModal({ tipo: 'cadastrar' })}
            className="fixed bottom-4 right-4 z-40 flex h-[48px] items-center gap-1.5 rounded-full bg-[#0369A1] px-5 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(3,105,161,0.4)] hover:brightness-110 sm:static sm:h-[40px] sm:rounded-[4px] sm:px-4 sm:text-[12px] sm:uppercase sm:tracking-wide sm:shadow-none"
            data-testid="cadastrar-cliente">
            <Plus className="h-4 w-4" /> Cadastrar cliente
          </button>
        </div>

        {/* Computador/tablet: tabela com cabeçalho fixo e a loja fixa à esquerda. */}
        <div className="hidden overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white md:block">
          <div className="max-h-[calc(100dvh-330px)] min-h-[260px] overflow-auto" data-testid="tabela-rolagem">
            <table className="w-full min-w-[1500px] border-separate border-spacing-0 text-[13px]" data-testid="tabela-lojas">
              <thead className="sticky top-0 z-[2] bg-[#F6F7F9] text-[11px] font-semibold tracking-wide text-text-subtle">
                <tr className="[&>th]:border-b [&>th]:border-border">
                  <Th coluna="loja" className="sticky left-0 z-[3] min-w-[220px] bg-[#F6F7F9] shadow-[1px_0_0_#E5E7EB]">Loja</Th>
                  <Th coluna="situacao">Status</Th>
                  <th className="px-3 py-2.5 text-left uppercase">Responsável</th>
                  <th className="px-3 py-2.5 text-left uppercase">E-mail / login</th>
                  <Th coluna="sublogins">Sublogins</Th>
                  <Th coluna="faturamento" direita>Faturamento</Th>
                  <Th coluna="pedidos" direita>Pedidos</Th>
                  <Th coluna="ticket" direita>Ticket</Th>
                  <Th coluna="criadoEm">Cadastro</Th>
                  <Th coluna="ultimoLoginEm">Último acesso</Th>
                  <th className="px-3 py-2.5 text-left uppercase">APIs hoje</th>
                  <th className="px-3 py-2.5 text-left uppercase">IA (ChatGPT)</th>
                  <th className="px-3 py-2.5 text-left uppercase">Módulos</th>
                  <th className="px-3 py-2.5 text-left uppercase">Impressão Alfa 1</th>
                  <th className="px-3 py-2.5"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.length === 0 && (
                  <tr><td colSpan={15} className="px-5 py-10 text-center text-text-subtle" data-testid="lista-vazia">Nenhuma loja encontrada.</td></tr>
                )}
                {visiveis.map((l) => (
                  <tr key={l.chave} className="group align-middle [&>td]:border-b [&>td]:border-border hover:[&>td]:bg-[#F9FAFB]" data-testid="linha-loja" data-chave={l.chave}>
                    <td className="sticky left-0 z-[1] max-w-[260px] bg-white px-3 py-2.5 shadow-[1px_0_0_#E5E7EB] group-hover:bg-[#F9FAFB]">
                      <p className="truncate font-semibold text-text-main" data-testid="linha-loja-nome">{l.loja || <span className="font-normal italic text-text-subtle">Loja ainda sem nome</span>}</p>
                      {l.slug && <a href={`/loja/${l.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:underline"><ExternalLink className="h-3 w-3" />/{l.slug}</a>}
                    </td>
                    <td className="px-3 py-2.5"><SeloSituacao l={l} /></td>
                    <td className="max-w-[180px] px-3 py-2.5"><p className="truncate">{l.responsavel || '—'}</p><p className="truncate text-[11.5px] text-text-subtle">{l.telefone || ''}</p></td>
                    <td className="max-w-[220px] px-3 py-2.5"><p className="truncate">{l.email}</p><p className="truncate text-[11.5px] font-medium text-text-subtle">{l.login ? `@${l.login}` : ''}</p></td>
                    <td className="px-3 py-2.5"><BotaoSublogins l={l} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-[#15803D]">{l.restauranteId ? brl(l.faturamento) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">{l.restauranteId ? num(l.pedidos) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">{l.restauranteId ? brl(l.ticket) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-text-subtle">{dataCurta(l.criadoEm)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[12px]">{dataHora(l.ultimoLoginEm)}{l.loginsTotal > 0 && <span className="ml-1 text-[11px] text-text-subtle">({num(l.loginsTotal)}×)</span>}</td>
                    <td className="px-3 py-2.5">{l.restauranteId && usoApis ? <BarraUsoLoja uso={usoApis.porLoja[l.restauranteId]} limites={usoApis.limites} /> : '—'}</td>
                    <td className="px-3 py-2.5">{l.restauranteId && usoIa ? <IaDaLoja uso={usoIa.porLoja[l.restauranteId]} limites={usoIa.limites} /> : '—'}</td>
                    <td className="px-3 py-2.5">{l.restauranteId && modulos?.[l.restauranteId] ? <ModulosLoja restauranteId={l.restauranteId} loja={l.loja || ''} inicial={modulos[l.restauranteId]} /> : '—'}</td>
                    <td className="px-3 py-2.5">{l.restauranteId ? (l.betaLiberado ? <span className="rounded-[4px] bg-[#0369A1] px-2 py-[3px] text-[11px] font-semibold text-white">Piloto</span> : <span className="text-[12px] text-text-subtle">Não</span>) : '—'}</td>
                    <td className="px-2 py-2.5 text-right"><BotaoMenu l={l} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Celular: um cartão por loja. */}
        <div className="flex flex-col gap-2.5 md:hidden" data-testid="cartoes-lojas">
          {visiveis.length === 0 && <p className="rounded-[6px] border border-border bg-white px-4 py-8 text-center text-text-subtle" data-testid="lista-vazia">Nenhuma loja encontrada.</p>}
          {visiveis.map((l) => (
            <div key={l.chave} className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-3" data-testid="cartao-loja" data-chave={l.chave}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-text-main" data-testid="linha-loja-nome">{l.loja || <span className="font-normal italic text-text-subtle">Loja ainda sem nome</span>}</p>
                  <div className="mt-1"><SeloSituacao l={l} /></div>
                </div>
                <BotaoMenu l={l} />
              </div>
              <p className="mt-2 truncate text-[13px] text-text-main">{l.responsavel || '—'}{l.telefone ? <span className="text-text-subtle"> · {l.telefone}</span> : null}</p>
              <p className="truncate text-[12px] text-text-subtle">{l.email}{l.login ? ` · @${l.login}` : ''}</p>
              <div className="mt-2.5 flex items-center gap-3 border-t border-border pt-2.5 text-[13px]">
                <div className="min-w-0 flex-1"><p className="text-[11px] text-text-subtle">Faturamento</p><p className="font-semibold text-[#15803D]">{l.restauranteId ? brl(l.faturamento) : '—'}</p></div>
                <div><p className="text-[11px] text-text-subtle">Pedidos</p><p className="font-semibold">{l.restauranteId ? num(l.pedidos) : '—'}</p></div>
                <div><p className="text-[11px] text-text-subtle">Sublogins</p><BotaoSublogins l={l} /></div>
              </div>
              {l.restauranteId && usoApis && <div className="mt-2.5 border-t border-border pt-2.5"><p className="mb-1 text-[11px] text-text-subtle">APIs pagas hoje</p><BarraUsoLoja uso={usoApis.porLoja[l.restauranteId]} limites={usoApis.limites} /></div>}
              {l.restauranteId && usoIa && <div className="mt-2.5 border-t border-border pt-2.5"><p className="mb-1 text-[11px] text-text-subtle">IA (ChatGPT)</p><IaDaLoja uso={usoIa.porLoja[l.restauranteId]} limites={usoIa.limites} /></div>}
              {l.restauranteId && modulos?.[l.restauranteId] && <div className="mt-2.5 border-t border-border pt-2.5"><p className="mb-1 text-[11px] text-text-subtle">Módulos</p><ModulosLoja restauranteId={l.restauranteId} loja={l.loja || ''} inicial={modulos[l.restauranteId]} /></div>}
            </div>
          ))}
        </div>

        {/* Paginação */}
        <div className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-text-subtle" data-testid="paginacao-plataforma">
          <span data-testid="faixa-plataforma">{filtradas.length === 0 ? '0 lojas' : `${pagina * POR_PAGINA + 1}–${Math.min(filtradas.length, (pagina + 1) * POR_PAGINA)} de ${filtradas.length} lojas`}</span>
          <div className="flex gap-1">
            <button type="button" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior" className="flex h-[36px] w-[36px] items-center justify-center rounded-[4px] border border-border bg-white disabled:opacity-40" data-testid="pagina-anterior"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" disabled={pagina >= totalPaginas - 1} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página" className="flex h-[36px] w-[36px] items-center justify-center rounded-[4px] border border-border bg-white disabled:opacity-40" data-testid="pagina-proxima"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </main>

      {/* Menu ⋮ da loja: por cima de tudo, dentro da tela. */}
      <Flutuante ancora={ancoraMenu} aberto={!!lojaDoMenu} onFechar={fecharMenu} largura={250} testid="loja-menu-lista" rotulo="Ações da loja" className="py-1">
        {lojaDoMenu && (() => {
          const l = lojaDoMenu
          const ativo = l.situacao === 'ativo' || l.situacao === 'ativo_temporario'
          const semAcesso = l.situacao === 'revogado' || l.situacao === 'expirado'
          return (
            <div role="menu">
              <button role="menuitem" type="button" className={ITEM} onClick={() => abrir({ tipo: 'detalhes', loja: l })} data-testid="acao-detalhes">Ver detalhes</button>
              {l.slug && <a role="menuitem" href={`/loja/${l.slug}`} target="_blank" rel="noreferrer" className={ITEM} onClick={() => setMenu(null)}>Abrir vitrine <ExternalLink className="ml-auto h-3.5 w-3.5" /></a>}
              {l.restauranteId && <button role="menuitem" type="button" className={ITEM} onClick={() => abrir({ tipo: 'sublogins', loja: l })}>Ver sublogins ({l.sublogins.length})</button>}
              {(ativo || l.situacao === 'pendente') && <button role="menuitem" type="button" className={`${ITEM} border-t border-border`} onClick={() => abrir({ tipo: 'validade', loja: l })} data-testid="acao-validade">{l.acessoExpiraEm ? 'Renovar / alterar validade' : 'Definir validade'}</button>}
              {ativo && <button role="menuitem" type="button" className={`${ITEM} text-[#B91C1C]`} onClick={() => abrir({ tipo: 'confirmar', loja: l, acao: 'bloquear' })} data-testid="acao-bloquear">Bloquear acesso</button>}
              {semAcesso && <button role="menuitem" type="button" className={`${ITEM} border-t border-border text-[#15803D]`} onClick={() => abrir({ tipo: 'desbloquear', loja: l })} data-testid="acao-desbloquear">Desbloquear acesso</button>}
              {l.restauranteId && (
                <button role="menuitem" type="button" className={`${ITEM} border-t border-border`} onClick={() => abrir({ tipo: 'confirmar', loja: l, acao: l.betaLiberado ? 'beta_retirar' : 'beta_liberar' })} data-testid="acao-beta">
                  {l.betaLiberado ? 'Retirar do piloto de Impressão Alfa 1' : 'Liberar Impressão Alfa 1'}
                </button>
              )}
              {l.situacao === 'pendente' && <button role="menuitem" type="button" className={`${ITEM} border-t border-border text-[#B91C1C]`} onClick={() => abrir({ tipo: 'confirmar', loja: l, acao: 'remover' })} data-testid="acao-remover">Remover pré-cadastro</button>}
              {semAcesso && <button role="menuitem" type="button" className={`${ITEM} text-[#B91C1C]`} onClick={() => abrir({ tipo: 'excluir', loja: l })} data-testid="acao-excluir">Excluir dados…</button>}
            </div>
          )
        })()}
      </Flutuante>

      {modal?.tipo === 'cadastrar' && <ModalCadastrar ocupado={pendente} onFechar={fecharModal} onEnviar={(d) => executar(() => preCadastrarAction(d), () => { setBusca(''); setFiltro('todos') })} />}
      {modal?.tipo === 'sublogins' && <ModalSublogins loja={modal.loja} onFechar={fecharModal} />}
      {modal?.tipo === 'detalhes' && <ModalDetalhes loja={modal.loja} onFechar={fecharModal} />}
      {modal?.tipo === 'validade' && <ModalValidade loja={modal.loja} ocupado={pendente} onFechar={fecharModal} onEnviar={(v) => executar(() => alterarValidadeAction(modal.loja.contaId, v))} />}
      {modal?.tipo === 'desbloquear' && <ModalValidade loja={modal.loja} desbloquear ocupado={pendente} onFechar={fecharModal} onEnviar={(v) => executar(() => desbloquearAction(modal.loja.contaId, v))} />}
      {modal?.tipo === 'confirmar' && <ModalConfirmar modal={modal} ocupado={pendente} onFechar={fecharModal} onConfirmar={() => {
        const l = modal.loja
        executar(() => modal.acao === 'bloquear' ? bloquearAction(l.contaId)
          : modal.acao === 'remover' ? removerPreCadastroAction(l.contaId)
            : alternarBetaImpressaoAction(l.restauranteId!, modal.acao === 'beta_liberar'))
      }} />}
      {modal?.tipo === 'excluir' && <ModalExcluir loja={modal.loja} ocupado={pendente} onFechar={fecharModal} onConfirmar={(t) => executar(() => excluirDadosAction(modal.loja.contaId, t))} />}
      <PilhaToasts itens={toasts.itens} />
    </div>
  )
}

function ModalCadastrar({ ocupado, onFechar, onEnviar }: { ocupado: boolean; onFechar: () => void; onEnviar: (d: { email: string; nomeLoja: string; nome: string; telefone: string; validade: string }) => void }) {
  const [email, setEmail] = useState('')
  const [nomeLoja, setNomeLoja] = useState('')
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [validade, setValidade] = useState('')
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  const enviar = () => { if (emailOk && !ocupado) onEnviar({ email: email.trim(), nomeLoja, nome, telefone, validade }) }
  return (
    <Modal titulo="Cadastrar cliente" testid="modal-cadastrar" onFechar={onFechar}
      rodape={<>
        <button type="button" className={BTN_NEUTRO} onClick={onFechar}>Cancelar</button>
        <button type="button" className={BTN_PRIMARIO} disabled={!emailOk || ocupado} onClick={enviar} data-testid="cadastrar-enviar">{ocupado ? 'Salvando…' : 'Pré-cadastrar'}</button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); enviar() }} className="flex flex-col gap-3.5">
        <p className="text-[13px] text-text-subtle">O cliente conclui o cadastro em <b>/cadastro</b> com este e-mail: define o login, a senha e confere os dados da loja.</p>
        <label><span className={ROTULO}>E-mail do cliente *</span>
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@exemplo.com" className={CAMPO} data-testid="cadastrar-email" />
          {email && !emailOk && <span className="mt-1 block text-[12px] text-[#B91C1C]">E-mail inválido.</span>}
        </label>
        <label><span className={ROTULO}>Nome da loja</span><input value={nomeLoja} onChange={(e) => setNomeLoja(e.target.value)} maxLength={80} className={CAMPO} data-testid="cadastrar-loja" /></label>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <label><span className={ROTULO}>Responsável</span><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} className={CAMPO} data-testid="cadastrar-nome" /></label>
          <label><span className={ROTULO}>Telefone</span><input type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} maxLength={30} placeholder="(00) 00000-0000" className={CAMPO} data-testid="cadastrar-telefone" /></label>
        </div>
        <CampoValidade valor={validade} onMudar={setValidade} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

function ModalSublogins({ loja, onFechar }: { loja: LojaPlataforma; onFechar: () => void }) {
  return (
    <Modal titulo={`Sublogins · ${loja.loja}`} testid="modal-sublogins" onFechar={onFechar} largura={760}>
      <p className="mb-3 text-[12.5px] text-text-subtle">Funcionários com login nesta loja. Só leitura: a gestão (criar, pausar, bloquear) é na tela <b>Equipe</b> da própria loja.</p>
      {loja.sublogins.length === 0 ? (
        <p className="rounded-[4px] bg-page px-4 py-6 text-center text-[13px] text-text-subtle" data-testid="sublogins-vazio">Esta loja não tem sublogins.</p>
      ) : (
        <>
          <table className="hidden w-full text-[13px] sm:table" data-testid="sublogins-tabela">
            <thead><tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle"><th className="py-2 pr-3">Nome</th><th className="py-2 pr-3">Login</th><th className="py-2 pr-3">Cargo / papel</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Último acesso</th><th className="py-2">Criado em</th></tr></thead>
            <tbody>
              {loja.sublogins.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0" data-testid="sublogin">
                  <td className="py-2 pr-3 font-semibold">{s.nome}</td>
                  <td className="py-2 pr-3">{s.login ? `@${s.login}` : '—'}</td>
                  <td className="py-2 pr-3">{[s.cargo ? CARGO[s.cargo] ?? s.cargo : null, PAPEL[s.papel] ?? s.papel].filter(Boolean).join(' · ')}</td>
                  <td className="py-2 pr-3"><span className="rounded-[4px] px-2 py-[2px] text-[11px] font-semibold text-white" style={{ backgroundColor: SELO_SUB[s.status][1] }}>{SELO_SUB[s.status][0]}</span></td>
                  <td className="whitespace-nowrap py-2 pr-3 text-[12px]">{dataHora(s.ultimoLoginEm)}</td>
                  <td className="whitespace-nowrap py-2 text-[12px] text-text-subtle">{dataCurta(s.criadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-col gap-2 sm:hidden">
            {loja.sublogins.map((s) => (
              <div key={s.id} className="rounded-[4px] border border-border p-3" data-testid="sublogin">
                <div className="flex items-center justify-between gap-2"><p className="truncate font-semibold">{s.nome}</p><span className="rounded-[4px] px-2 py-[2px] text-[11px] font-semibold text-white" style={{ backgroundColor: SELO_SUB[s.status][1] }}>{SELO_SUB[s.status][0]}</span></div>
                <p className="text-[12.5px] text-text-subtle">{s.login ? `@${s.login}` : '—'} · {[s.cargo ? CARGO[s.cargo] ?? s.cargo : null, PAPEL[s.papel] ?? s.papel].filter(Boolean).join(' · ')}</p>
                <p className="text-[12px] text-text-subtle">Último acesso {dataHora(s.ultimoLoginEm)} · criado em {dataCurta(s.criadoEm)}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

function ModalDetalhes({ loja, onFechar }: { loja: LojaPlataforma; onFechar: () => void }) {
  const linhas: [string, React.ReactNode][] = [
    ['Loja', loja.loja || '—'],
    ['Status', <SeloSituacao key="s" l={loja} />],
    ['Responsável', loja.responsavel || '—'],
    ['Telefone', loja.telefone || '—'],
    ['E-mail', loja.email],
    ['Login', loja.login ? `@${loja.login}` : '—'],
    ['Vitrine', loja.slug ? <a key="v" href={`/loja/${loja.slug}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">/loja/{loja.slug}</a> : '—'],
    ['Sublogins', String(loja.sublogins.length)],
    ['Faturamento (entregue)', loja.restauranteId ? brl(loja.faturamento) : '—'],
    ['Pedidos entregues', loja.restauranteId ? num(loja.pedidos) : '—'],
    ['Ticket médio', loja.restauranteId ? brl(loja.ticket) : '—'],
    ['Cadastro', dataHora(loja.criadoEm)],
    ['Último acesso', `${dataHora(loja.ultimoLoginEm)}${loja.loginsTotal ? ` (${num(loja.loginsTotal)}×)` : ''}`],
    ['Impressão Alfa 1', loja.restauranteId ? (loja.betaLiberado ? 'Piloto liberado' : 'Não') : '—'],
  ]
  return (
    <Modal titulo={loja.loja || loja.email} testid="modal-detalhes" onFechar={onFechar}>
      <dl className="grid grid-cols-[minmax(120px,40%)_1fr] gap-x-3 gap-y-2 text-[13.5px]">
        {linhas.map(([k, v]) => (<Fragment key={k}><dt className="text-text-subtle">{k}</dt><dd className="min-w-0 break-words font-medium text-text-main">{v}</dd></Fragment>))}
      </dl>
    </Modal>
  )
}

function ModalValidade({ loja, desbloquear, ocupado, onFechar, onEnviar }: { loja: LojaPlataforma; desbloquear?: boolean; ocupado: boolean; onFechar: () => void; onEnviar: (v: string) => void }) {
  const futura = loja.acessoExpiraEm && new Date(loja.acessoExpiraEm).getTime() > Date.now() ? isoParaInput(loja.acessoExpiraEm) : ''
  const [valor, setValor] = useState(desbloquear ? '' : futura)
  return (
    <Modal titulo={desbloquear ? `Desbloquear · ${loja.loja}` : `Validade · ${loja.loja || loja.email}`} testid="modal-validade" onFechar={onFechar}
      rodape={<>
        <button type="button" className={BTN_NEUTRO} onClick={onFechar}>Cancelar</button>
        <button type="button" className={desbloquear ? `${BTN} bg-[#15803D] text-white hover:brightness-110` : BTN_PRIMARIO} disabled={ocupado} onClick={() => onEnviar(valor)} data-testid="validade-salvar">
          {ocupado ? 'Salvando…' : desbloquear ? 'Desbloquear' : 'Salvar validade'}
        </button>
      </>}>
      <p className="mb-3 text-[13px] text-text-subtle">
        {desbloquear ? 'A loja volta a entrar no painel. Escolha se o acesso tem data para acabar.'
          : loja.situacao === 'pendente' ? 'A validade passa a valer quando o cliente concluir o cadastro.'
            : `Hoje: ${loja.acessoExpiraEm ? `ativo até ${dataCurta(loja.acessoExpiraEm)}` : 'sem validade'}. Ao vencer, o acesso é bloqueado e os dados ficam salvos.`}
      </p>
      <CampoValidade valor={valor} onMudar={setValor} />
    </Modal>
  )
}

function ModalConfirmar({ modal, ocupado, onFechar, onConfirmar }: { modal: Extract<ModalAberto, { tipo: 'confirmar' }>; ocupado: boolean; onFechar: () => void; onConfirmar: () => void }) {
  const l = modal.loja
  const textos = {
    bloquear: ['Bloquear acesso', `A loja "${l.loja}" e toda a equipe dela deixam de entrar no painel até você desbloquear. Os dados ficam salvos e a vitrine continua no ar.`, 'Bloquear', BTN_PERIGO],
    remover: ['Remover pré-cadastro', `O convite de ${l.email} será removido. Para cadastrar de novo, use "+ Cadastrar cliente".`, 'Remover', BTN_PERIGO],
    beta_liberar: ['Liberar Impressão Alfa 1', `"${l.loja}" passa a poder usar o Assistente Alfa 1. Continua no Assistente antigo até o dono escolher outro modo.`, 'Liberar', BTN_PRIMARIO],
    beta_retirar: ['Retirar do piloto', `A impressão de "${l.loja}" volta toda para o Assistente antigo.`, 'Retirar', BTN_PERIGO],
  }[modal.acao]
  return (
    <Modal titulo={textos[0]} testid="modal-confirmar" onFechar={onFechar}
      rodape={<>
        <button type="button" className={BTN_NEUTRO} onClick={onFechar}>Cancelar</button>
        <button type="button" className={textos[3]} disabled={ocupado} onClick={onConfirmar} data-testid="confirmar-acao">{ocupado ? 'Aguarde…' : textos[2]}</button>
      </>}>
      <p className="text-[14px] text-text-main">{textos[1]}</p>
    </Modal>
  )
}

function ModalExcluir({ loja, ocupado, onFechar, onConfirmar }: { loja: LojaPlataforma; ocupado: boolean; onFechar: () => void; onConfirmar: (t: string) => void }) {
  const [texto, setTexto] = useState('')
  const ok = texto.trim().toLowerCase() === loja.loja.trim().toLowerCase() && loja.loja.trim() !== ''
  return (
    <Modal titulo="Excluir dados da loja" testid="modal-excluir" onFechar={onFechar}
      rodape={<>
        <button type="button" className={BTN_NEUTRO} onClick={onFechar}>Cancelar</button>
        <button type="button" className={BTN_PERIGO} disabled={!ok || ocupado} onClick={() => onConfirmar(texto)} data-testid="excluir-confirmar">{ocupado ? 'Excluindo…' : 'Excluir de vez'}</button>
      </>}>
      <p className="mb-3 text-[14px] text-text-main">Apaga <b>de vez</b> a loja <b>{loja.loja}</b>: cardápio, pedidos, equipe e a conta. Não dá para desfazer.</p>
      <label><span className={ROTULO}>Digite o nome da loja para confirmar</span>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} className={CAMPO} data-testid="excluir-nome" />
      </label>
    </Modal>
  )
}
