'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, ExternalLink, MoreVertical, Plus, Search, Users, X } from 'lucide-react'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'
import { Flutuante } from '@/components/ui/flutuante'
import type { LojaPlataforma, ResumoPlataforma, SituacaoLoja, Sublogin } from '@/lib/queries/plataforma'
import type { UsoApis } from '@/lib/custo/uso'
import { BarraUsoLoja } from './uso-apis'
import type { UsoIa } from '@/lib/custo/ia'
import { IaDaLoja } from './uso-ia'
import type { ModulosDaLoja } from '@/lib/modulos'
import { ModulosLoja } from './modulos-loja'
import {
  alterarValidadeAction, alternarBetaImpressaoAction, bloquearAction, desbloquearAction, excluirDadosAction,
  preCadastrarAction, removerPreCadastroAction, resetarSenhaAction, novoLinkConviteAction, type ResultadoAcao,
} from '@/app/superadmin/actions'
import { SENHA_PADRAO, textoDoReset } from '@/lib/auth/senha-padrao'

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
  const [texto, cor, fundo] =
    l.situacao === 'ativo' ? ['Ativo', '#008361', '#DEF4F0']
      : l.situacao === 'ativo_temporario' ? [`Ativo até ${dataCurta(l.acessoExpiraEm)}`, '#673DE6', '#EBE4FF']
        : l.situacao === 'pendente' ? ['Aguardando 1º acesso', '#8A6100', '#FFF8E2']
          : l.situacao === 'expirado' ? [`Expirou em ${dataCurta(l.acessoExpiraEm)}`, '#D63163', '#FFE8EF']
            : ['Sem acesso', '#D63163', '#FFE8EF']
  return <span className="inline-flex whitespace-nowrap rounded-[8px] px-[8px] py-[2px] text-[12px] font-semibold leading-[20px]" style={{ color: cor, backgroundColor: fundo }} data-testid="selo-situacao" data-situacao={l.situacao}>{texto}</span>
}

const SELO_SUB: Record<Sublogin['status'], [string, string]> = { ativo: ['Ativo', '#008361'], pausado: ['Pausado', '#8A6100'], bloqueado: ['Bloqueado', '#D63163'] }

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
        className="flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[90vh] sm:rounded-[24px] sm:shadow-[0_24px_60px_rgba(24,24,26,0.18)]" style={{ maxWidth: largura }}>
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
          <button type="button" onClick={onFechar} className="-ml-1 flex h-[40px] items-center gap-1 rounded-[12px] px-1.5 text-[13px] font-semibold text-primary sm:hidden" data-testid="modal-voltar">
            <ArrowLeft className="h-5 w-5" /> Voltar
          </button>
          <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold leading-[24px] text-text-main max-sm:text-center max-sm:pr-[70px]">{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="hidden h-[36px] w-[36px] items-center justify-center rounded-[12px] text-text-subtle hover:bg-page sm:flex" data-testid="modal-fechar"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {rodape && <div className="flex flex-shrink-0 flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">{rodape}</div>}
      </div>
    </div>
  )
}

const BTN = 'inline-flex h-[40px] items-center justify-center gap-[6px] rounded-[12px] px-[14px] text-[14px] font-bold leading-[24px] transition-colors disabled:opacity-50'
const BTN_PRIMARIO = `${BTN} bg-[#673DE6] text-white hover:bg-[#5025D1]`
const BTN_PERIGO = `${BTN} bg-[#E73A47] text-white hover:bg-[#C92E3A]`
const BTN_NEUTRO = `${BTN} border border-[rgba(103,61,230,0.45)] bg-white text-text-main hover:bg-[#EBE4FF]`
const CAMPO = 'h-[42px] w-full rounded-[12px] border border-[rgba(0,0,0,0.15)] bg-white px-3 text-[14px] text-text-main outline-none transition-colors focus:border-[#673DE6] focus:ring-2 focus:ring-[#673DE6]/20'
const ROTULO = 'mb-1 block text-[14px] font-semibold leading-[20px] text-text-main'

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
  | { tipo: 'resetar'; usuarioId: string; nome: string; login: string; loja: string; voltar?: LojaPlataforma }
  | { tipo: 'convite'; link: string }

export function PainelPlataforma({ lojas, resumo, usoApis, usoIa, modulos }: { lojas: LojaPlataforma[]; resumo: ResumoPlataforma; usoApis?: UsoApis | null; usoIa?: UsoIa | null; modulos?: Record<string, ModulosDaLoja> }) {
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
        // Convite (achado #3): o link fica num modal com "Copiar" — o aviso some sozinho e não dá para copiar dele.
        if (r.ok) { toasts.mostrar('ok', r.mensagem); setModal(r.link ? { tipo: 'convite', link: r.link } : null); aoConcluir?.(); router.refresh() }
        else toasts.mostrar('erro', r.erro)
      } catch {
        toasts.mostrar('erro', 'Não foi possível concluir. Tente de novo.')
      }
    })
  }

  const ordenarPor = (coluna: Coluna) => setOrdem((o) => (o.coluna === coluna ? { coluna, desc: !o.desc } : { coluna, desc: coluna !== 'loja' }))
  const Th = ({ coluna, children, direita, className = '' }: { coluna: Coluna; children: React.ReactNode; direita?: boolean; className?: string }) => (
    <th className={`whitespace-nowrap px-3 py-2.5 ${direita ? 'text-right' : 'text-left'} ${className}`} aria-sort={ordem.coluna === coluna ? (ordem.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => ordenarPor(coluna)} className={`inline-flex items-center gap-1 hover:text-text-main ${ordem.coluna === coluna ? 'text-[#673DE6]' : ''}`} data-testid={`ordenar-${coluna}`}>
        {children}
        {ordem.coluna === coluna && (ordem.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  )

  const BotaoSublogins = ({ l }: { l: LojaPlataforma }) =>
    l.restauranteId ? (
      <button type="button" onClick={() => setModal({ tipo: 'sublogins', loja: l })} className="inline-flex h-[32px] min-w-[44px] items-center justify-center gap-1 rounded-[12px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white px-2 text-[13px] font-semibold text-[#673DE6] hover:bg-[#EBE4FF]"
        aria-label={`Sublogins de ${l.loja}: ${l.sublogins.length}`} data-testid="sublogins-botao">
        <Users className="h-3.5 w-3.5" /> {l.sublogins.length}
      </button>
    ) : <span className="text-text-subtle">—</span>

  const BotaoMenu = ({ l }: { l: LojaPlataforma }) => (
    <button type="button" aria-label={`Ações de ${l.loja || l.email}`} aria-haspopup="menu" aria-expanded={menu === l.chave}
      onClick={(e) => { e.stopPropagation(); ancoraMenu.current = e.currentTarget; setMenu((m) => (m === l.chave ? null : l.chave)) }}
      className="flex h-[36px] w-[36px] items-center justify-center rounded-[12px] text-text-subtle hover:bg-page hover:text-text-main" data-testid="loja-menu">
      <MoreVertical className="h-5 w-5" />
    </button>
  )

  const lojaDoMenu = lojas.find((l) => l.chave === menu) ?? null
  const ITEM = 'flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-text-main hover:bg-page'
  const abrir = (m: ModalAberto) => { setMenu(null); setModal(m) }

  /** Ações de uma loja (as mesmas no menu ⋮ e na ficha). Nada mudou nelas — só o lugar onde aparecem. */
  const acoesDaLoja = (l: LojaPlataforma, cls: string, comoMenu: boolean) => {
    const ativo = l.situacao === 'ativo' || l.situacao === 'ativo_temporario'
    const semAcesso = l.situacao === 'revogado' || l.situacao === 'expirado'
    const r = comoMenu ? { role: 'menuitem' as const } : {}
    return (
      <>
        {l.slug && <a {...r} href={`/loja/${l.slug}`} target="_blank" rel="noreferrer" className={cls} onClick={() => setMenu(null)}>Abrir vitrine <ExternalLink className="ml-auto h-3.5 w-3.5" /></a>}
        {l.restauranteId && <button {...r} type="button" className={cls} onClick={() => abrir({ tipo: 'sublogins', loja: l })}>Ver sublogins ({l.sublogins.length})</button>}
        {l.restauranteId && <button {...r} type="button" className={cls} onClick={() => abrir({ tipo: 'resetar', usuarioId: l.contaId, nome: l.responsavel || 'Dono', login: l.email, loja: l.loja })} data-testid="acao-resetar-senha">Resetar senha do dono</button>}
        {(ativo || l.situacao === 'pendente') && <button {...r} type="button" className={`${cls} border-t border-border`} onClick={() => abrir({ tipo: 'validade', loja: l })} data-testid="acao-validade">{l.acessoExpiraEm ? 'Renovar / alterar validade' : 'Definir validade'}</button>}
        {ativo && <button {...r} type="button" className={`${cls} text-[#B3122D]`} onClick={() => abrir({ tipo: 'confirmar', loja: l, acao: 'bloquear' })} data-testid="acao-bloquear">Bloquear acesso</button>}
        {semAcesso && <button {...r} type="button" className={`${cls} border-t border-border text-[#008361]`} onClick={() => abrir({ tipo: 'desbloquear', loja: l })} data-testid="acao-desbloquear">Desbloquear acesso</button>}
        {l.restauranteId && (
          <button {...r} type="button" className={`${cls} border-t border-border`} onClick={() => abrir({ tipo: 'confirmar', loja: l, acao: l.betaLiberado ? 'beta_retirar' : 'beta_liberar' })} data-testid="acao-beta">
            {l.betaLiberado ? 'Retirar do piloto de Impressão Alfa 1' : 'Liberar Impressão Alfa 1'}
          </button>
        )}
        {l.situacao === 'pendente' && <button {...r} type="button" className={`${cls} border-t border-border`} onClick={() => { setMenu(null); executar(() => novoLinkConviteAction(l.contaId)) }} data-testid="acao-novo-link-convite">Novo link do convite</button>}
        {l.situacao === 'pendente' && <button {...r} type="button" className={`${cls} border-t border-border text-[#B3122D]`} onClick={() => abrir({ tipo: 'confirmar', loja: l, acao: 'remover' })} data-testid="acao-remover">Remover pré-cadastro</button>}
        {semAcesso && <button {...r} type="button" className={`${cls} text-[#B3122D]`} onClick={() => abrir({ tipo: 'excluir', loja: l })} data-testid="acao-excluir">Excluir dados…</button>}
      </>
    )
  }

  return (
    <section id="clientes" className="scroll-mt-[16px] overflow-hidden rounded-[24px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white" data-testid="topo-plataforma">
      {/* 29/10 (visual Hostinger): o topo, o Sair e os blocos de uso foram para a página (ShellHp e "Níveis de uso"). */}
      <div className="flex flex-wrap items-center gap-[16px] px-[24px] py-[20px]">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold leading-[24px] text-text-main">Clientes</h2>
          <p className="text-[14px] leading-[20px] text-text-subtle">Lojas da plataforma, acesso, uso e módulos</p>
        </div>
      </div>
      {/* Resumo: só lojas (contas principais e pré-cadastros); valores somados por loja. */}
      <div className="grid grid-cols-2 gap-y-[8px] border-y-[0.8px] border-[rgba(0,0,0,0.1)] px-[24px] py-[16px] text-[14px] leading-[20px] sm:grid-cols-3 lg:grid-cols-6" data-testid="resumo-plataforma">
        {[
          ['Cadastros (lojas)', <span key="c" data-testid="resumo-cadastros">{num(resumo.cadastros)}</span>],
          ['Ativos', <span key="a" data-testid="resumo-ativos">{num(resumo.ativos)}</span>],
          ['Aguardando 1º acesso', <span key="p" data-testid="resumo-pendentes" className={resumo.pendentes > 0 ? 'text-[#8A6100]' : ''}>{num(resumo.pendentes)}</span>],
          ['Faturamento (entregue)', <span key="f" data-testid="resumo-faturamento">{brl(resumo.faturamento)}</span>],
          ['Pedidos entregues', <span key="e" data-testid="resumo-pedidos">{num(resumo.pedidos)}</span>],
          ['Ticket médio', <span key="t" data-testid="resumo-ticket">{brl(resumo.ticket)}</span>],
        ].map(([rotulo, valor]) => (
          <div key={rotulo as string} className="min-w-0">
            <p className="truncate text-text-subtle">{rotulo}</p>
            <p className="text-[16px] font-semibold leading-[24px] text-text-main">{valor}</p>
          </div>
        ))}
      </div>

      <div className="px-[16px] py-[16px] sm:px-[24px]">
        {/* Barra da lista: busca, filtros e "+ Cadastrar cliente". */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className={`relative ${buscaAberta ? 'flex' : 'hidden'} w-full sm:flex sm:w-[340px]`}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar loja, responsável, e-mail ou login" aria-label="Buscar"
              className={`${CAMPO} pl-9`} data-testid="busca-plataforma" />
          </div>
          <button type="button" onClick={() => setBuscaAberta((v) => !v)} aria-label="Buscar" aria-expanded={buscaAberta}
            className={`flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-[12px] sm:hidden ${buscaAberta || busca ? 'bg-[#673DE6] text-white' : 'border border-border bg-white text-text-main'}`} data-testid="busca-lupa">
            <Search className="h-5 w-5" />
          </button>
          <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filtrar por status">
            {FILTROS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
                className={`flex h-[36px] flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[12px] px-[12px] text-[14px] font-semibold transition-colors ${filtro === f.id ? 'bg-[#EBE4FF] text-[#673DE6]' : 'border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white text-text-main hover:bg-[#F5F5F6]'}`}
                data-testid={`filtro-${f.id}`}>
                {f.rotulo} <span className={`rounded-full px-1.5 text-[11px] ${filtro === f.id ? 'bg-white text-[#673DE6]' : 'bg-[#F5F5F6] text-text-subtle'}`}>{contagem[f.id]}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setModal({ tipo: 'cadastrar' })}
            className="fixed bottom-4 right-4 z-40 flex h-[48px] items-center gap-1.5 rounded-[12px] bg-[#673DE6] px-5 text-[14px] font-bold text-white shadow-[0_8px_20px_rgba(103,61,230,0.35)] hover:bg-[#5025D1] sm:static sm:h-[40px] sm:px-[14px] sm:shadow-none"
            data-testid="cadastrar-cliente">
            <Plus className="h-4 w-4" /> Cadastrar cliente
          </button>
        </div>

        {/* 29/10 (2ª rodada): lista SIMPLES — loja, situação, faturamento, pedidos e último acesso. Tocar abre a ficha completa. */}
        <div className="hidden overflow-hidden rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white md:block">
          <div className="relative max-h-[calc(100dvh-330px)] min-h-[200px] overflow-auto" data-testid="tabela-rolagem">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[14px]" data-testid="tabela-lojas">
              <thead className="sticky top-0 z-[2] bg-white text-[12px] font-semibold text-text-subtle">
                <tr className="[&>th]:border-b [&>th]:border-border">
                  <Th coluna="loja" className="min-w-[240px]">Loja</Th>
                  <Th coluna="situacao">Situação</Th>
                  <Th coluna="faturamento" direita>Faturamento</Th>
                  <Th coluna="pedidos" direita>Pedidos</Th>
                  <Th coluna="ultimoLoginEm">Último acesso</Th>
                  <th className="w-[56px] px-3 py-2.5"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-text-subtle" data-testid="lista-vazia">Nenhuma loja encontrada.</td></tr>
                )}
                {visiveis.map((l) => (
                  <tr key={l.chave} onClick={() => setModal({ tipo: 'detalhes', loja: l })}
                    className="group cursor-pointer align-middle [&>td]:border-b [&>td]:border-border hover:[&>td]:bg-[#F7F5FF]" data-testid="linha-loja" data-chave={l.chave}>
                    <td className="max-w-[320px] px-3 py-[10px]">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setModal({ tipo: 'detalhes', loja: l }) }} className="block max-w-full truncate text-left font-semibold text-text-main hover:text-[#673DE6]" data-testid="linha-loja-nome">
                        {l.loja || <span className="font-normal italic text-text-subtle">Loja ainda sem nome</span>}
                      </button>
                      <p className="truncate text-[12px] text-text-subtle">{l.responsavel || l.email}</p>
                    </td>
                    <td className="px-3 py-[10px]"><div className="flex flex-wrap items-center gap-[6px]"><SeloSituacao l={l} />{l.whatsappCaiuEm && <span className="rounded-[8px] bg-[#FFE8EF] px-[8px] py-[2px] text-[12px] font-semibold text-[#B3122D]" data-testid="linha-whatsapp-caiu">WhatsApp off</span>}</div></td>
                    <td className="whitespace-nowrap px-3 py-[10px] text-right font-semibold tabular-nums text-[#008361]">{l.restauranteId ? brl(l.faturamento) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-[10px] text-right font-semibold tabular-nums">{l.restauranteId ? num(l.pedidos) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-[10px] text-[13px] text-text-subtle">{dataHora(l.ultimoLoginEm)}</td>
                    <td className="px-2 py-[10px] text-right" onClick={(e) => e.stopPropagation()}><BotaoMenu l={l} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Celular: cartão compacto; tocar abre a ficha completa. */}
        <div className="flex flex-col gap-[8px] md:hidden" data-testid="cartoes-lojas">
          {visiveis.length === 0 && <p className="rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white px-4 py-8 text-center text-text-subtle" data-testid="lista-vazia">Nenhuma loja encontrada.</p>}
          {visiveis.map((l) => (
            <button key={l.chave} type="button" onClick={() => setModal({ tipo: 'detalhes', loja: l })}
              className="flex min-h-[64px] w-full items-center gap-[10px] rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white px-[14px] py-[10px] text-left active:bg-[#F7F5FF]" data-testid="cartao-loja" data-chave={l.chave}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold leading-[20px] text-text-main" data-testid="linha-loja-nome">{l.loja || <span className="font-normal italic text-text-subtle">Loja ainda sem nome</span>}</p>
                <div className="mt-[4px] flex flex-wrap items-center gap-[6px]">
                  <SeloSituacao l={l} />
                  {l.whatsappCaiuEm && <span className="rounded-[8px] bg-[#FFE8EF] px-[8px] py-[2px] text-[12px] font-semibold text-[#B3122D]">WhatsApp off</span>}
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-[14px] font-semibold tabular-nums text-[#008361]">{l.restauranteId ? brl(l.faturamento) : '—'}</p>
                <p className="text-[12px] text-text-subtle">{l.restauranteId ? `${num(l.pedidos)} pedidos` : ''}</p>
              </div>
              <ChevronRight className="h-[18px] w-[18px] flex-shrink-0 text-text-subtle" aria-hidden />
            </button>
          ))}
        </div>

        {/* Paginação */}
        <div className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-text-subtle" data-testid="paginacao-plataforma">
          <span data-testid="faixa-plataforma">{filtradas.length === 0 ? '0 lojas' : `${pagina * POR_PAGINA + 1}–${Math.min(filtradas.length, (pagina + 1) * POR_PAGINA)} de ${filtradas.length} lojas`}</span>
          <div className="flex gap-1">
            <button type="button" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior" className="flex h-[36px] w-[36px] items-center justify-center rounded-[12px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white disabled:opacity-40" data-testid="pagina-anterior"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" disabled={pagina >= totalPaginas - 1} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página" className="flex h-[36px] w-[36px] items-center justify-center rounded-[12px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white disabled:opacity-40" data-testid="pagina-proxima"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      {/* Menu ⋮ da loja: por cima de tudo, dentro da tela. */}
      <Flutuante ancora={ancoraMenu} aberto={!!lojaDoMenu} onFechar={fecharMenu} largura={250} testid="loja-menu-lista" rotulo="Ações da loja" className="py-1">
        {lojaDoMenu && (() => {
          const l = lojaDoMenu
          return (
            <div role="menu">
              <button role="menuitem" type="button" className={ITEM} onClick={() => abrir({ tipo: 'detalhes', loja: l })} data-testid="acao-detalhes">Ver ficha completa</button>
              {acoesDaLoja(l, ITEM, true)}
            </div>
          )
        })()}
      </Flutuante>

      {modal?.tipo === 'cadastrar' && <ModalCadastrar ocupado={pendente} onFechar={fecharModal} onEnviar={(d) => executar(() => preCadastrarAction(d), () => { setBusca(''); setFiltro('todos') })} />}
      {modal?.tipo === 'sublogins' && <ModalSublogins loja={modal.loja} onFechar={fecharModal}
        onResetar={(s) => setModal({ tipo: 'resetar', usuarioId: s.id, nome: s.nome, login: s.login ? `@${s.login}` : s.nome, loja: modal.loja.loja, voltar: modal.loja })} />}
      {modal?.tipo === 'resetar' && <ModalResetarSenha alvo={modal} onFechar={() => setModal(modal.voltar ? { tipo: 'sublogins', loja: modal.voltar } : null)} />}
      {modal?.tipo === 'detalhes' && <ModalDetalhes loja={modal.loja} onFechar={fecharModal} usoApis={usoApis} usoIa={usoIa} modulos={modulos}
        acoes={acoesDaLoja(modal.loja, 'flex min-h-[44px] w-full items-center gap-2 px-[12px] text-left text-[14px] font-medium text-text-main hover:bg-[#F7F5FF]', false)} />}
      {modal?.tipo === 'validade' && <ModalValidade loja={modal.loja} ocupado={pendente} onFechar={fecharModal} onEnviar={(v) => executar(() => alterarValidadeAction(modal.loja.contaId, v))} />}
      {modal?.tipo === 'desbloquear' && <ModalValidade loja={modal.loja} desbloquear ocupado={pendente} onFechar={fecharModal} onEnviar={(v) => executar(() => desbloquearAction(modal.loja.contaId, v))} />}
      {modal?.tipo === 'confirmar' && <ModalConfirmar modal={modal} ocupado={pendente} onFechar={fecharModal} onConfirmar={() => {
        const l = modal.loja
        executar(() => modal.acao === 'bloquear' ? bloquearAction(l.contaId)
          : modal.acao === 'remover' ? removerPreCadastroAction(l.contaId)
            : alternarBetaImpressaoAction(l.restauranteId!, modal.acao === 'beta_liberar'))
      }} />}
      {modal?.tipo === 'excluir' && <ModalExcluir loja={modal.loja} ocupado={pendente} onFechar={fecharModal} onConfirmar={(t) => executar(() => excluirDadosAction(modal.loja.contaId, t))} />}
      {modal?.tipo === 'convite' && <ModalLinkConvite link={modal.link} onFechar={fecharModal} />}
      <PilhaToasts itens={toasts.itens} />
    </section>
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
          {email && !emailOk && <span className="mt-1 block text-[12px] text-[#D63163]">E-mail inválido.</span>}
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

function ModalSublogins({ loja, onFechar, onResetar }: { loja: LojaPlataforma; onFechar: () => void; onResetar: (s: Sublogin) => void }) {
  return (
    <Modal titulo={`Sublogins · ${loja.loja}`} testid="modal-sublogins" onFechar={onFechar} largura={760}>
      <p className="mb-3 text-[12.5px] text-text-subtle">Funcionários com login nesta loja. A gestão (criar, pausar, bloquear) é na tela <b>Equipe</b> da própria loja; daqui só dá para resetar a senha.</p>
      {loja.sublogins.length === 0 ? (
        <p className="rounded-[12px] bg-page px-4 py-6 text-center text-[13px] text-text-subtle" data-testid="sublogins-vazio">Esta loja não tem sublogins.</p>
      ) : (
        <>
          <table className="hidden w-full text-[13px] sm:table" data-testid="sublogins-tabela">
            <thead><tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle"><th className="py-2 pr-3">Nome</th><th className="py-2 pr-3">Login</th><th className="py-2 pr-3">Cargo / papel</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Último acesso</th><th className="py-2 pr-3">Criado em</th><th className="py-2" /></tr></thead>
            <tbody>
              {loja.sublogins.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0" data-testid="sublogin">
                  <td className="py-2 pr-3 font-semibold">{s.nome}</td>
                  <td className="py-2 pr-3">{s.login ? `@${s.login}` : '—'}</td>
                  <td className="py-2 pr-3">{[s.cargo ? CARGO[s.cargo] ?? s.cargo : null, PAPEL[s.papel] ?? s.papel].filter(Boolean).join(' · ')}</td>
                  <td className="py-2 pr-3"><span className="rounded-[8px] px-[8px] py-[2px] text-[12px] font-semibold text-white" style={{ backgroundColor: SELO_SUB[s.status][1] }}>{SELO_SUB[s.status][0]}</span></td>
                  <td className="whitespace-nowrap py-2 pr-3 text-[12px]">{dataHora(s.ultimoLoginEm)}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-[12px] text-text-subtle">{dataCurta(s.criadoEm)}</td>
                  <td className="py-2 text-right"><button type="button" onClick={() => onResetar(s)} className="whitespace-nowrap rounded-[12px] border border-border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#0369A1] hover:bg-[#E0F2FE]" data-testid="sublogin-resetar">Resetar senha</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-col gap-2 sm:hidden">
            {loja.sublogins.map((s) => (
              <div key={s.id} className="rounded-[12px] border border-border p-3" data-testid="sublogin">
                <div className="flex items-center justify-between gap-2"><p className="truncate font-semibold">{s.nome}</p><span className="rounded-[8px] px-[8px] py-[2px] text-[12px] font-semibold text-white" style={{ backgroundColor: SELO_SUB[s.status][1] }}>{SELO_SUB[s.status][0]}</span></div>
                <p className="text-[12.5px] text-text-subtle">{s.login ? `@${s.login}` : '—'} · {[s.cargo ? CARGO[s.cargo] ?? s.cargo : null, PAPEL[s.papel] ?? s.papel].filter(Boolean).join(' · ')}</p>
                <p className="text-[12px] text-text-subtle">Último acesso {dataHora(s.ultimoLoginEm)} · criado em {dataCurta(s.criadoEm)}</p>
                <button type="button" onClick={() => onResetar(s)} className="mt-2 h-[36px] rounded-[12px] border border-border px-3 text-[11px] font-semibold uppercase tracking-wide text-[#0369A1]" data-testid="sublogin-resetar">Resetar senha</button>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

/** Ficha completa da loja (29/10): tudo o que saiu da lista, em blocos, e as ações no fim. */
function ModalDetalhes({ loja, onFechar, usoApis, usoIa, modulos, acoes }: { loja: LojaPlataforma; onFechar: () => void; usoApis?: UsoApis | null; usoIa?: UsoIa | null; modulos?: Record<string, ModulosDaLoja>; acoes: React.ReactNode }) {
  const Bloco = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
    <section className="rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white p-[14px]">
      <h3 className="mb-[8px] text-[14px] font-semibold leading-[20px] text-text-main">{titulo}</h3>
      {children}
    </section>
  )
  const Linhas = ({ itens }: { itens: [string, React.ReactNode][] }) => (
    <dl className="grid grid-cols-[minmax(110px,40%)_1fr] gap-x-3 gap-y-[6px] text-[14px] leading-[20px]">
      {itens.map(([k, v]) => (<Fragment key={k}><dt className="text-text-subtle">{k}</dt><dd className="min-w-0 break-words font-medium text-text-main">{v}</dd></Fragment>))}
    </dl>
  )
  const r = loja.restauranteId
  return (
    <Modal titulo={loja.loja || loja.email} testid="modal-detalhes" onFechar={onFechar} largura={640}>
      <div className="flex flex-col gap-[10px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <SeloSituacao l={loja} />
          {loja.whatsappCaiuEm && <span className="rounded-[8px] bg-[#FFE8EF] px-[8px] py-[2px] text-[12px] font-semibold text-[#B3122D]">WhatsApp desconectado</span>}
          {loja.slug && <a href={`/loja/${loja.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#673DE6] hover:underline"><ExternalLink className="h-3.5 w-3.5" />/loja/{loja.slug}</a>}
        </div>
        <Bloco titulo="Contato">
          <Linhas itens={[['Responsável', loja.responsavel || '—'], ['Telefone', loja.telefone || '—'], ['E-mail', loja.email], ['Login', loja.login ? `@${loja.login}` : '—']]} />
        </Bloco>
        <Bloco titulo="Números">
          <Linhas itens={[
            ['Faturamento (entregue)', r ? <span key="f" className="text-[#008361]">{brl(loja.faturamento)}</span> : '—'],
            ['Pedidos entregues', r ? num(loja.pedidos) : '—'], ['Ticket médio', r ? brl(loja.ticket) : '—'],
            ['Cadastro', dataHora(loja.criadoEm)], ['Último acesso', `${dataHora(loja.ultimoLoginEm)}${loja.loginsTotal ? ` (${num(loja.loginsTotal)}×)` : ''}`],
          ]} />
        </Bloco>
        {r && (
          <Bloco titulo="Uso hoje">
            <div className="flex flex-col gap-[12px]">
              {usoApis && <div><p className="mb-[4px] text-[12px] font-semibold text-text-subtle">APIs pagas</p><BarraUsoLoja uso={usoApis.porLoja[r]} limites={usoApis.limites} /></div>}
              {usoIa && <div><p className="mb-[4px] text-[12px] font-semibold text-text-subtle">IA (Claude)</p><IaDaLoja uso={usoIa.porLoja[r]} limites={usoIa.limites} restauranteId={r} teto={usoIa.tetosLoja[r]} /></div>}
            </div>
          </Bloco>
        )}
        {r && modulos?.[r] && <Bloco titulo="Módulos liberados"><ModulosLoja restauranteId={r} loja={loja.loja || ''} inicial={modulos[r]} /></Bloco>}
        {r && (
          <Bloco titulo="Impressão e equipe">
            <Linhas itens={[['Impressão Alfa 1', loja.betaLiberado ? 'Piloto liberado' : 'Não'], ['Sublogins', String(loja.sublogins.length)]]} />
          </Bloco>
        )}
        <section className="overflow-hidden rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white">
          <h3 className="px-[14px] pb-[4px] pt-[14px] text-[14px] font-semibold leading-[20px] text-text-main">Ações</h3>
          <div className="flex flex-col pb-[6px]">{acoes}</div>
        </section>
      </div>
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
        <button type="button" className={desbloquear ? `${BTN} bg-[#008361] text-white hover:bg-[#006E51]` : BTN_PRIMARIO} disabled={ocupado} onClick={() => onEnviar(valor)} data-testid="validade-salvar">
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

/** Link do convite (achado #3, 26/10): só quem tem o link conclui o cadastro. Vale uma vez. */
function ModalLinkConvite({ link, onFechar }: { link: string; onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try { await navigator.clipboard.writeText(link); setCopiado(true) } catch { setCopiado(false) }
  }
  return (
    <Modal titulo="Link do convite" testid="modal-link-convite" onFechar={onFechar}
      rodape={<>
        <button type="button" className={BTN_NEUTRO} onClick={onFechar}>Fechar</button>
        <button type="button" className={BTN_PRIMARIO} onClick={() => void copiar()} data-testid="convite-copiar">{copiado ? 'Copiado ✓' : 'Copiar'}</button>
      </>}>
      <p className="mb-2 text-[14px] text-text-main">Mande este link para o cliente. Só com ele dá para concluir o cadastro, e ele vale uma vez.</p>
      <p className="select-all break-all rounded-[12px] bg-page px-3 py-2.5 font-mono text-[13px] text-text-main" data-testid="convite-link">{link}</p>
      <p className="mt-2 text-[12px] text-text-subtle">Perdeu o link? No menu da loja, use &quot;Novo link do convite&quot; — o anterior deixa de valer.</p>
    </Modal>
  )
}

/** Resetar senha (20/10): confirma mostrando o login → senha padrão pelo servidor → "Copiar" para mandar ao cliente. */
function ModalResetarSenha({ alvo, onFechar }: { alvo: Extract<ModalAberto, { tipo: 'resetar' }>; onFechar: () => void }) {
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  async function resetar() {
    setOcupado(true); setErro(null)
    try {
      const r = await resetarSenhaAction(alvo.usuarioId)
      if (r.ok) setFeito(textoDoReset(r.login))
      else setErro(r.erro)
    } catch {
      setErro('Não foi possível resetar. Tente de novo.')
    } finally {
      setOcupado(false)
    }
  }
  async function copiar() {
    if (!feito) return
    try { await navigator.clipboard.writeText(feito); setCopiado(true) } catch { setCopiado(false) }
  }
  return (
    <Modal titulo={`Resetar senha · ${alvo.loja}`} testid="modal-resetar-senha" onFechar={onFechar}
      rodape={feito ? <>
        <button type="button" className={BTN_NEUTRO} onClick={onFechar}>Fechar</button>
        <button type="button" className={BTN_PRIMARIO} onClick={() => void copiar()} data-testid="resetar-copiar">{copiado ? 'Copiado ✓' : 'Copiar'}</button>
      </> : <>
        <button type="button" className={BTN_NEUTRO} onClick={onFechar}>Cancelar</button>
        <button type="button" className={BTN_PERIGO} disabled={ocupado} onClick={() => void resetar()} data-testid="resetar-confirmar">{ocupado ? 'Resetando…' : 'Resetar senha'}</button>
      </>}>
      {feito ? (
        <div data-testid="resetar-feito">
          <p className="mb-2 text-[14px] font-semibold text-[#008361]">Senha resetada.</p>
          <p className="select-all rounded-[12px] bg-page px-3 py-2.5 font-mono text-[14px] text-text-main" data-testid="resetar-texto">{feito}</p>
          <p className="mt-2 text-[12.5px] text-text-subtle">Ao entrar, a pessoa vê uma faixa amarela pedindo para trocar a senha (em Minha conta).</p>
        </div>
      ) : (
        <>
          <p className="text-[14px] text-text-main">A senha de <b>{alvo.nome}</b> passa a ser <b>{SENHA_PADRAO}</b>. A senha antiga deixa de funcionar.</p>
          <p className="mt-2 rounded-[12px] bg-page px-3 py-2 text-[13.5px] text-text-main" data-testid="resetar-login">Login: <b>{alvo.login}</b></p>
          {erro && <p className="mt-3 rounded-[12px] bg-[#FEE2E2] px-3 py-2 text-[13px] text-[#D63163]">{erro}</p>}
        </>
      )}
    </Modal>
  )
}
