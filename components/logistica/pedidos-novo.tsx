'use client'

/**
 * Tela Pedidos — visual novo (14/10/2026), só nas lojas com "Novidades em teste". Só apresentação: toda ação chega
 * por props e é a MESMA função da tela antiga (app/admin/lista-pedidos/page.tsx). Regras visuais em
 * docs/design/guia-visual-menuzia.md: cartão de resumo, lista compacta, tabela, etiqueta de status e estado vazio.
 * Medidas em px (a raiz do painel é 87,5%); alvo de toque ≥ 44px abaixo de lg.
 */
import { ClipboardCheck, KeyRound, MapPin, Pencil, Phone, Plus, Search, Users, Wallet } from 'lucide-react'
import type { Entregador, Pedido, StatusEntregador } from '@/lib/queries/pedidos'
import { statusReal, type TipoStatusReal } from '@/lib/motoboy/status-real'
import { pedidoParado, tempoParado } from '@/lib/pedido-parado'
import { rotuloForma } from '@/lib/pdv-pagamento'
import { formatarReal as brl } from '@/lib/moeda'
import { AlertaTroco } from '@/components/pedidos/info-pagamento'

/* ── Tokens ─────────────────────────────────────────────────────────────── */

export type TomEtiqueta = 'verde' | 'roxo' | 'cinza' | 'vermelho' | 'azul' | 'laranja'
/** Fundo pastel + texto escuro da mesma cor (contraste ≥ 4,5:1 em todas). */
const TOM: Record<TomEtiqueta, { fundo: string; texto: string; ponto: string }> = {
  verde: { fundo: '#DCFCE7', texto: '#15803D', ponto: '#10B981' },
  roxo: { fundo: '#F3E8FF', texto: '#7E22CE', ponto: '#A855F7' },
  cinza: { fundo: '#F1F2F4', texto: '#4B5563', ponto: '#9CA3AF' },
  vermelho: { fundo: '#FEE2E2', texto: '#B91C1C', ponto: '#EF4444' },
  azul: { fundo: '#E0F2FE', texto: '#0369A1', ponto: '#0688D4' },
  laranja: { fundo: '#FFEDD5', texto: '#C2410C', ponto: '#F97316' },
}
const TOM_STATUS_REAL: Record<TipoStatusReal, TomEtiqueta> = { online: 'verde', em_rota: 'roxo', offline: 'cinza', desativado: 'vermelho' }

const CARTAO = 'rounded-[6px] border border-[var(--adm-borda)] bg-white'
const CAMPO = 'h-[36px] rounded-[4px] border border-[var(--adm-borda)] bg-white px-[10px] font-sans text-[13px] text-[var(--adm-texto)] outline-none transition-colors focus-visible:border-[var(--adm-azul)] focus-visible:ring-2 focus-visible:ring-[var(--adm-azul)]/20 max-lg:h-[44px]'
const BOTAO = 'inline-flex h-[36px] items-center whitespace-nowrap justify-center gap-[6px] rounded-[4px] px-[12px] text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--adm-azul)]/40 disabled:cursor-not-allowed disabled:opacity-50 max-lg:h-[44px]'
const BOTAO_CONTORNO = `${BOTAO} border border-[var(--adm-borda)] bg-white text-[var(--adm-texto-forte)] hover:border-[var(--adm-borda-forte)] hover:bg-[var(--adm-superficie-2)]`
const BOTAO_PRIMARIO = `${BOTAO} bg-[var(--adm-azul)] text-white hover:bg-[var(--adm-azul-escuro)]`

export function Etiqueta({ tom, children, ponto = false, ...resto }: { tom: TomEtiqueta; children: React.ReactNode; ponto?: boolean } & React.HTMLAttributes<HTMLSpanElement>) {
  const t = TOM[tom]
  return (
    <span {...resto} className={`inline-flex max-w-full items-center gap-[6px] whitespace-nowrap rounded-[4px] px-[8px] py-[2px] text-[11.5px] font-semibold leading-[16px] ${resto.className ?? ''}`} style={{ backgroundColor: t.fundo, color: t.texto }}>
      {ponto && <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full" style={{ backgroundColor: t.ponto }} aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </span>
  )
}

function CabecalhoCartao({ icone, titulo, contador, descricao, acoes }: { icone: React.ReactNode; titulo: string; contador?: number; descricao?: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-[12px] border-b border-[var(--adm-borda)] px-[16px] py-[12px]">
      <div className="flex min-w-0 items-center gap-[8px]">
        <span className="text-[var(--adm-texto-suave)]" aria-hidden="true">{icone}</span>
        <h3 className="text-[14px] font-semibold text-[var(--adm-texto)]">{titulo}</h3>
        {contador !== undefined && <span className="text-[13px] font-medium tabular-nums text-[var(--adm-texto-suave)]">{contador}</span>}
        {descricao && <span className="hidden truncate text-[12px] text-[var(--adm-texto-suave)] md:inline">· {descricao}</span>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-[8px] max-sm:w-full max-sm:[&>*]:flex-1 max-sm:[&>*]:px-[8px]">{acoes}</div>}
    </div>
  )
}

/** Estado vazio pequeno: uma linha, sem ocupar a tela. */
function VazioPequeno({ texto, acao }: { texto: string; acao?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-[12px] px-[16px] py-[20px] text-center text-[13px] text-[var(--adm-texto-suave)]" data-testid="vazio-pequeno">
      <span>{texto}</span>
      {acao}
    </div>
  )
}

const CORES_AVATAR = ['#A855F7', '#F97316', '#10B981', '#3B82F6', '#F59E0B', '#EF4444']
function Avatar({ nome, fotoUrl, tamanho, ponto }: { nome: string; fotoUrl: string | null; tamanho: number; ponto?: TomEtiqueta }) {
  const cor = CORES_AVATAR[[...nome].reduce((s, c) => s + c.charCodeAt(0), 0) % CORES_AVATAR.length]
  return (
    <span className="relative flex-shrink-0" style={{ width: tamanho, height: tamanho }}>
      {fotoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fotoUrl} alt="" loading="lazy" decoding="async" width={tamanho} height={tamanho} className="rounded-full border border-[var(--adm-borda)] object-cover" style={{ width: tamanho, height: tamanho }} />
      ) : (
        <span className="flex items-center justify-center rounded-full font-semibold text-white" style={{ width: tamanho, height: tamanho, backgroundColor: cor, fontSize: Math.round(tamanho * 0.42) }} aria-hidden="true">
          {nome.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
      {ponto && <span className="absolute -bottom-[1px] -right-[1px] h-[12px] w-[12px] rounded-full border-2 border-white" style={{ backgroundColor: TOM[ponto].ponto }} aria-hidden="true" />}
    </span>
  )
}

/* ── Resumo do topo ─────────────────────────────────────────────────────── */

/* ── Aba Entregadores ───────────────────────────────────────────────────── */

/** Botão de ícone: rótulo aparece no hover/foco no desktop; abaixo de lg o texto fica sempre visível. */
function AcaoIcone({ rotulo, dica, icone, onClick, testid }: { rotulo: string; dica: string; icone: React.ReactNode; onClick: () => void; testid: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={`${rotulo}: ${dica}`} data-testid={testid}
      className="group relative inline-flex h-[36px] min-w-[36px] items-center justify-center gap-[6px] rounded-[4px] text-[var(--adm-texto-medio)] transition-colors hover:bg-[var(--adm-hover)] hover:text-[var(--adm-azul)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--adm-azul)]/40 max-lg:h-[44px] max-lg:flex-1 max-lg:border max-lg:border-[var(--adm-borda)] max-lg:px-[12px]">
      {icone}
      <span className="text-[12px] font-semibold lg:hidden">{rotulo}</span>
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-[6px] -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-[#111827] px-[8px] py-[4px] text-[11px] font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 max-lg:hidden">
        {rotulo}
      </span>
    </button>
  )
}

function LinhaEntregador({ driver, numerosEmRota, agora, mudandoStatus, onStatus, onPerfil, onLocalizacao, onAcesso }: {
  driver: Entregador; numerosEmRota: number[]; agora: number; mudandoStatus: boolean
  onStatus: (s: StatusEntregador) => void; onPerfil: () => void; onLocalizacao: () => void; onAcesso: () => void
}) {
  const real = statusReal(driver, numerosEmRota, agora)
  const tom = TOM_STATUS_REAL[real.tipo]
  const veiculo = [driver.veiculo, driver.placa].filter(Boolean).join(' · ')
  return (
    <li className={`flex flex-wrap items-center gap-x-[16px] gap-y-[8px] px-[16px] py-[12px] ${driver.desativado ? 'opacity-60' : ''}`} data-testid={`entregador-${driver.id}`} data-status-real={real.tipo}>
      <div className="flex min-w-0 flex-1 items-center gap-[12px]">
        <Avatar nome={driver.nome} fotoUrl={driver.fotoUrl} tamanho={36} ponto={tom} />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-[var(--adm-texto)]">{driver.nome}</p>
          <div className="mt-[2px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-[12px] text-[var(--adm-texto-suave)]">
            <Etiqueta tom={tom} data-testid="status-real">{real.texto}</Etiqueta>
            {driver.telefone && (
              <a href={`tel:${driver.telefone}`} className="inline-flex items-center gap-[4px] hover:text-[var(--adm-azul)]">
                <Phone className="h-[12px] w-[12px]" aria-hidden="true" /> {driver.telefone}
              </a>
            )}
            {veiculo && <span className="truncate">{veiculo}</span>}
          </div>
        </div>
      </div>
      {/* Disponibilidade marcada pela loja (o seletor de sempre). Não é o status real — por isso fica discreto. */}
      <label className="flex flex-shrink-0 items-center gap-[4px] text-[11.5px] text-[var(--adm-texto-suave)]">
        <span className="whitespace-nowrap max-lg:sr-only">Disponibilidade</span>
        <select value={driver.status} disabled={mudandoStatus} onChange={(e) => onStatus(e.target.value as StatusEntregador)} aria-label={`Disponibilidade de ${driver.nome}`} data-testid="seletor-disponibilidade"
          className="h-[32px] cursor-pointer rounded-[4px] border border-transparent bg-transparent pl-[6px] pr-[20px] text-[12px] font-medium text-[var(--adm-texto-medio)] outline-none transition-colors hover:border-[var(--adm-borda)] focus-visible:ring-2 focus-visible:ring-[var(--adm-azul)]/40 max-lg:h-[44px] max-lg:border-[var(--adm-borda)] max-lg:bg-white">
          <option value="online">Disponível</option>
          <option value="ocupado">Ocupado</option>
          <option value="offline">Offline</option>
        </select>
      </label>
      <div className="flex items-center max-lg:w-full">
        <div className="flex items-center gap-[4px] max-lg:w-full max-lg:gap-[8px]">
          <AcaoIcone testid="acao-acesso" rotulo="Acesso" dica="login e senha do app" icone={<KeyRound className="h-[16px] w-[16px]" aria-hidden="true" />} onClick={onAcesso} />
          <AcaoIcone testid="acao-mapa" rotulo="Mapa" dica={driver.online ? 'onde ele está agora' : 'última localização conhecida'} icone={<MapPin className="h-[16px] w-[16px]" aria-hidden="true" />} onClick={onLocalizacao} />
          <AcaoIcone testid="acao-editar" rotulo="Editar" dica="nome, telefone, veículo e foto" icone={<Pencil className="h-[16px] w-[16px]" aria-hidden="true" />} onClick={onPerfil} />
        </div>
      </div>
    </li>
  )
}

export function ListaEntregadoresNovo({ drivers, emRota, agora, statusMudando, onStatus, onPerfil, onLocalizacao, onAcesso, onNovo, onFechamento }: {
  drivers: Entregador[]; emRota: Pedido[]; agora: number; statusMudando: string | null
  onStatus: (id: string, s: StatusEntregador) => void; onPerfil: (id: string) => void; onLocalizacao: (id: string) => void; onAcesso: (d: Entregador) => void
  onNovo: () => void; onFechamento: () => void
}) {
  return (
    <section className={CARTAO} data-testid="lista-entregadores">
      <CabecalhoCartao
        icone={<Users className="h-[16px] w-[16px]" />}
        titulo="Entregadores"
        contador={drivers.length}
        descricao="status pelo sinal do app"
        acoes={<>
          <button type="button" onClick={onFechamento} className={BOTAO_CONTORNO} data-testid="botao-fechamento"><Wallet className="h-[16px] w-[16px]" aria-hidden="true" /> Fechamento de caixa</button>
          <button type="button" onClick={onNovo} className={BOTAO_PRIMARIO} data-testid="botao-novo-entregador"><Plus className="h-[16px] w-[16px]" aria-hidden="true" /> Novo entregador</button>
        </>}
      />
      {drivers.length === 0 ? (
        <VazioPequeno texto="Nenhum entregador cadastrado." />
      ) : (
        <ul className="divide-y divide-[var(--adm-borda)]">
          {[...drivers.filter((d) => !d.desativado), ...drivers.filter((d) => d.desativado)].map((d) => (
            <LinhaEntregador key={d.id} driver={d} agora={agora}
              numerosEmRota={emRota.filter((o) => o.entregadorId === d.id).map((o) => o.numero)}
              mudandoStatus={statusMudando === d.id}
              onStatus={(s) => onStatus(d.id, s)} onPerfil={() => onPerfil(d.id)} onLocalizacao={() => onLocalizacao(d.id)} onAcesso={() => onAcesso(d)} />
          ))}
        </ul>
      )}
    </section>
  )
}

/* ── Aba Pedidos: em rota ───────────────────────────────────────────────── */

function minutosDesde(iso: string, agora: number) {
  const min = Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60_000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}

/**
 * Pedidos na rua, uma linha cada. O título é "Saíram para entrega" e não "Em rota agora" — esse número já está no
 * cartão do topo; antes o mesmo rótulo aparecia duas vezes. Sem pedido na rua a seção some (o cartão já diz 0).
 */
export function EmRotaNovo({ pedidos, drivers, agora, nexta, onEntregue, onNaoEntregue, onMapa }: {
  pedidos: Pedido[]; drivers: Entregador[]; agora: number; nexta: (id: string) => { entregadorNome: string | null } | undefined
  onEntregue: (id: string) => void; onNaoEntregue: (id: string) => void; onMapa: (entregadorId: string) => void
}) {
  if (pedidos.length === 0) return null
  return (
    <section className={CARTAO} data-testid="lista-em-rota">
      <CabecalhoCartao icone={<MapPin className="h-[16px] w-[16px]" />} titulo="Saíram para entrega" contador={pedidos.length} descricao="marque quando o cliente receber" />
      <ul className="divide-y divide-[var(--adm-borda)]">
        {pedidos.map((o) => {
          const parado = pedidoParado(o, agora)
          const viaNexta = nexta(o.id)
          const motoboy = drivers.find((d) => d.id === o.entregadorId) ?? null
          const saiu = o.etapas?.emRota ?? o.atualizadoEm
          return (
            <li key={o.id} className={`grid grid-cols-2 items-center gap-x-[16px] gap-y-[8px] px-[16px] py-[12px] lg:grid-cols-[64px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_96px_auto] ${parado ? 'bg-[#FEF2F2]' : ''}`} data-testid={`em-rota-${o.numero}`}>
              <div className="col-span-2 flex items-center justify-between gap-[8px] lg:contents">
                <span className="text-[14px] font-semibold tabular-nums text-[var(--adm-texto)]">#{o.numero}</span>
                <span className="text-[12px] tabular-nums text-[var(--adm-texto-suave)] lg:hidden">saiu há {minutosDesde(saiu, agora)}</span>
              </div>
              <div className="col-span-2 min-w-0 lg:col-span-1">
                <p className="truncate text-[13.5px] font-semibold text-[var(--adm-texto)]">{o.clienteNome || 'Cliente'}</p>
                <p className="truncate text-[12px] text-[var(--adm-texto-suave)]">
                  {rotuloForma(o.formaPagamento, o.cartaoTipo, o.pagamentoOnline)} · {brl(o.total)}{!o.pago && ' · a receber'}
                </p>
              </div>
              <p className="flex min-w-0 items-center gap-[6px] truncate text-[13px] text-[var(--adm-texto-medio)]">
                <MapPin className="h-[12px] w-[12px] flex-shrink-0 text-[var(--adm-texto-suave)]" aria-hidden="true" />
                <span className="truncate">{o.enderecoBairro || 'Sem bairro'}</span>
              </p>
              <div className="flex min-w-0 items-center gap-[8px] text-[13px]">
                {viaNexta ? (
                  <span className="truncate font-semibold text-[#0369A1]">Nexta{viaNexta.entregadorNome && ` · ${viaNexta.entregadorNome}`}</span>
                ) : (
                  <>
                    <Avatar nome={motoboy?.nome ?? '?'} fotoUrl={motoboy?.fotoUrl ?? null} tamanho={20} />
                    <span className="truncate font-medium text-[var(--adm-texto)]">{motoboy?.nome ?? o.entregadorNome ?? '—'}</span>
                    {motoboy?.telefone && (
                      <a href={`tel:${motoboy.telefone}`} aria-label={`Ligar para ${motoboy.nome}`} className="text-[var(--adm-texto-suave)] hover:text-[var(--adm-azul)]"><Phone className="h-[14px] w-[14px]" aria-hidden="true" /></a>
                    )}
                  </>
                )}
              </div>
              <span className="hidden text-[12.5px] tabular-nums text-[var(--adm-texto-medio)] lg:block">
                {parado ? <Etiqueta tom="vermelho" title="Saiu há muito tempo e ninguém fechou.">Parado {tempoParado(o.criadoEm, agora)}</Etiqueta> : `há ${minutosDesde(saiu, agora)}`}
              </span>
              <div className="col-span-2 flex items-center gap-[8px] lg:col-span-1 max-lg:[&>*]:flex-1">
                {!viaNexta && o.entregadorId && (
                  <button type="button" onClick={() => onMapa(o.entregadorId!)} className={BOTAO_CONTORNO} data-testid="em-rota-mapa"><MapPin className="h-[14px] w-[14px]" aria-hidden="true" /> Mapa</button>
                )}
                <button type="button" onClick={() => onEntregue(o.id)} className={`${BOTAO} bg-[#10B981] text-white hover:bg-[#059669]`} data-testid="em-rota-entregue">Entregue</button>
                <button type="button" onClick={() => onNaoEntregue(o.id)} className={`${BOTAO} border border-[var(--adm-borda)] bg-white text-[#B91C1C] hover:border-[#FCA5A5] hover:bg-[#FEF2F2]`} data-testid="em-rota-nao-entregue">Não entregue</button>
              </div>
              {(parado || (!o.pago && o.formaPagamento === 'dinheiro')) && (
                <div className="col-span-2 lg:col-span-6">
                  {parado && <span className="lg:hidden"><Etiqueta tom="vermelho">Parado {tempoParado(o.criadoEm, agora)}</Etiqueta></span>}
                  <AlertaTroco p={o} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ── Aba Pedidos: finalizados ───────────────────────────────────────────── */

export type PeriodoLista = 'hoje' | 'ontem' | '7dias' | 'personalizado'

export interface FiltrosFinalizados {
  periodo: PeriodoLista; setPeriodo: (p: PeriodoLista) => void; rotulos: Record<PeriodoLista, string>
  de: string; setDe: (v: string) => void; ate: string; setAte: (v: string) => void
  busca: string; setBusca: (v: string) => void
  status: 'todos' | 'entregue' | 'cancelado'; setStatus: (v: 'todos' | 'entregue' | 'cancelado') => void
  min: string; setMin: (v: string) => void; max: string; setMax: (v: string) => void
  ativos: boolean; limpar: () => void
}

function statusFinal(o: Pedido): { tom: TomEtiqueta; texto: string } {
  if (o.status !== 'entregue') return { tom: 'vermelho', texto: 'Cancelado' }
  if (o.entregueAutomatico) return { tom: 'azul', texto: 'Entregue (auto)' }
  return { tom: 'verde', texto: o.tipo === 'entrega' ? 'Entregue' : 'Retirado' }
}

const fmtHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const fmtDiaHora = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function FinalizadosNovo({ lista, filtrados, carregando, semDatas, filtros, detalheId, onAbrir, nomeMotoboy }: {
  lista: Pedido[]; filtrados: Pedido[]; carregando: boolean; semDatas: boolean; filtros: FiltrosFinalizados
  detalheId: string | null; onAbrir: (o: Pedido) => void; nomeMotoboy: (o: Pedido) => string
}) {
  const f = filtros
  const fmt = f.periodo === 'hoje' ? fmtHora : fmtDiaHora
  const hora = (o: Pedido) => fmt.format(new Date((o.status === 'entregue' ? o.etapas?.entregue : null) ?? o.atualizadoEm))
  return (
    <section className={CARTAO} data-testid="pedidos-finalizados">
      {/* Topo compacto (16/10): sem o cabeçalho "Pedidos finalizados" (a aba já diz); a contagem fica no fim da barra. */}
      <div className="flex flex-wrap items-center gap-[8px] border-b border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] px-[16px] py-[8px]" data-testid="barra-filtros">
        <select value={f.periodo} onChange={(e) => f.setPeriodo(e.target.value as PeriodoLista)} aria-label="Período" data-testid="filtro-periodo" className={CAMPO}>
          {(Object.keys(f.rotulos) as PeriodoLista[]).map((p) => <option key={p} value={p}>{f.rotulos[p]}</option>)}
        </select>
        {f.periodo === 'personalizado' && (<>
          <input type="date" value={f.de} onChange={(e) => f.setDe(e.target.value)} aria-label="De" data-testid="filtro-de" className={CAMPO} />
          <input type="date" value={f.ate} min={f.de || undefined} onChange={(e) => f.setAte(e.target.value)} aria-label="Até" data-testid="filtro-ate" className={CAMPO} />
        </>)}
        <label className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-[10px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[var(--adm-texto-suave)]" aria-hidden="true" />
          <input value={f.busca} onChange={(e) => f.setBusca(e.target.value)} placeholder="Buscar cliente ou bairro…" aria-label="Buscar por cliente ou bairro" autoComplete="off" name="busca-finalizados" data-testid="filtro-busca" className={`${CAMPO} w-full pl-[30px]`} />
        </label>
        <select value={f.status} onChange={(e) => f.setStatus(e.target.value as FiltrosFinalizados['status'])} aria-label="Status" data-testid="filtro-status" className={`${CAMPO} max-sm:min-w-0 max-sm:flex-1`}>
          <option value="todos">Todos os status</option>
          <option value="entregue">Concluído</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <input value={f.min} onChange={(e) => f.setMin(e.target.value)} placeholder="Valor mín." aria-label="Valor mínimo" inputMode="decimal" autoComplete="off" className={`${CAMPO} w-[96px] max-sm:w-[80px]`} />
        <input value={f.max} onChange={(e) => f.setMax(e.target.value)} placeholder="Valor máx." aria-label="Valor máximo" inputMode="decimal" autoComplete="off" className={`${CAMPO} w-[96px] max-sm:w-[80px]`} />
        {f.ativos && <button type="button" onClick={f.limpar} className="h-[36px] px-[4px] text-[12px] font-semibold text-[var(--adm-azul)] hover:underline max-lg:h-[44px]" data-testid="limpar-filtros">Limpar filtros</button>}
        <span className="ml-auto inline-flex items-center gap-[6px] whitespace-nowrap text-[12px] text-[var(--adm-texto-suave)]" data-testid="finalizados-contagem">
          <ClipboardCheck className="h-[14px] w-[14px]" aria-hidden="true" />
          {f.ativos ? `${filtrados.length} de ${lista.length} com os filtros` : `${lista.length} · entregues, retirados e cancelados · ${f.rotulos[f.periodo].toLowerCase()}`}
        </span>
      </div>

      {carregando && <p className="px-[16px] py-[12px] text-[13px] text-[var(--adm-texto-suave)]" aria-live="polite">Carregando…</p>}
      {!carregando && lista.length === 0 && <VazioPequeno texto={semDatas ? 'Escolha as datas do período.' : 'Nenhum pedido finalizado no período.'} />}
      {!carregando && lista.length > 0 && filtrados.length === 0 && <VazioPequeno texto="Nenhum pedido com esses filtros." acao={<button type="button" onClick={f.limpar} className="text-[12px] font-semibold text-[var(--adm-azul)] hover:underline">Limpar filtros</button>} />}

      {!carregando && filtrados.length > 0 && (<>
        {/* Tabela (md+) */}
        <div className="hidden md:block" data-testid="lista-finalizados">
          <table className="w-full table-fixed border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--adm-borda)] text-[11.5px] font-semibold text-[var(--adm-texto-suave)]">
                <th scope="col" className="w-[72px] px-[16px] py-[8px] font-semibold">Nº</th>
                <th scope="col" className="w-[96px] px-[8px] py-[8px] font-semibold">Hora</th>
                <th scope="col" className="px-[8px] py-[8px] font-semibold">Cliente</th>
                <th scope="col" className="px-[8px] py-[8px] font-semibold">Bairro</th>
                <th scope="col" className="hidden px-[8px] py-[8px] font-semibold lg:table-cell">Motoboy</th>
                <th scope="col" className="w-[104px] px-[8px] py-[8px] text-right font-semibold">Valor</th>
                <th scope="col" className="hidden w-[140px] px-[8px] py-[8px] font-semibold lg:table-cell">Pagamento</th>
                <th scope="col" className="w-[136px] px-[16px] py-[8px] font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--adm-borda)]">
              {filtrados.map((o) => {
                const st = statusFinal(o)
                const aberto = detalheId === o.id
                return (
                  <tr key={o.id} onClick={() => onAbrir(o)} data-testid={`finalizado-${o.numero}`} aria-selected={aberto}
                    className={`cursor-pointer transition-colors hover:bg-[var(--adm-superficie-2)] ${aberto ? 'bg-[var(--adm-azul-claro)]' : ''}`}>
                    <td className="px-[16px] py-[8px]">
                      <button type="button" onClick={(e) => { e.stopPropagation(); onAbrir(o) }} aria-pressed={aberto} aria-label={`Abrir o pedido ${o.numero}`} data-toque-livre
                        className="font-semibold tabular-nums text-[var(--adm-texto)] hover:text-[var(--adm-azul)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--adm-azul)]/40">#{o.numero}</button>
                    </td>
                    <td className="px-[8px] py-[8px] tabular-nums text-[var(--adm-texto-medio)]">{hora(o)}</td>
                    <td className="truncate px-[8px] py-[8px] font-medium text-[var(--adm-texto)]">{o.clienteNome || 'Cliente'}</td>
                    <td className="truncate px-[8px] py-[8px] text-[var(--adm-texto-medio)]">{o.tipo === 'entrega' ? (o.enderecoBairro || '—') : <span className="text-[var(--adm-texto-suave)]">Retirada</span>}</td>
                    <td className="hidden truncate px-[8px] py-[8px] text-[var(--adm-texto-medio)] lg:table-cell">{o.tipo === 'entrega' ? nomeMotoboy(o) : '—'}</td>
                    <td className="px-[8px] py-[8px] text-right font-semibold tabular-nums text-[var(--adm-texto)]">{brl(o.total)}</td>
                    <td className="hidden truncate px-[8px] py-[8px] text-[var(--adm-texto-medio)] lg:table-cell">{rotuloForma(o.formaPagamento, o.cartaoTipo, o.pagamentoOnline)}</td>
                    <td className="px-[16px] py-[8px]"><Etiqueta tom={st.tom} ponto data-testid={o.entregueAutomatico && o.status === 'entregue' ? 'selo-entregue-automatico' : undefined}>{st.texto}</Etiqueta></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {/* Celular: cartões compactos */}
        <ul className="divide-y divide-[var(--adm-borda)] md:hidden">
          {filtrados.map((o) => {
            const st = statusFinal(o)
            const aberto = detalheId === o.id
            return (
              <li key={o.id}>
                <button type="button" onClick={() => onAbrir(o)} aria-pressed={aberto} data-testid={`finalizado-m-${o.numero}`}
                  className={`flex min-h-[44px] w-full flex-col gap-[4px] px-[16px] py-[12px] text-left ${aberto ? 'bg-[var(--adm-azul-claro)]' : ''}`}>
                  <span className="flex w-full items-center justify-between gap-[8px]">
                    <span className="min-w-0 truncate text-[13.5px]"><b className="font-semibold tabular-nums">#{o.numero}</b> <span className="font-medium">{o.clienteNome || 'Cliente'}</span></span>
                    <span className="flex-shrink-0 text-[13.5px] font-semibold tabular-nums">{brl(o.total)}</span>
                  </span>
                  <span className="flex w-full items-center justify-between gap-[8px]">
                    <span className="min-w-0 truncate text-[12px] text-[var(--adm-texto-suave)]">
                      {hora(o)} · {o.tipo === 'entrega' ? `${o.enderecoBairro || 'Sem bairro'} · ${nomeMotoboy(o)}` : 'Retirada'} · {rotuloForma(o.formaPagamento, o.cartaoTipo, o.pagamentoOnline)}
                    </span>
                    <Etiqueta tom={st.tom} ponto className="flex-shrink-0">{st.texto}</Etiqueta>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </>)}
    </section>
  )
}
