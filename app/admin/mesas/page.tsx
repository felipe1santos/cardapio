'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BellRing, Lock, LockOpen, Pencil, Plus, Power, Printer, QrCode, Settings, X } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import {
  AJUDA_ESTADO,
  listarMesas,
  criarMesa,
  atualizarMesa,
  estadoDaMesa,
  proximoNomeDeMesa,
  ROTULO_ESTADO,
  type EstadoMesa,
  type Mesa,
} from '@/lib/queries/mesas'
import { listarMesasComEstado, type MesaComEstado } from '@/lib/queries/comandas'
import { listarChamadosAbertos, type Chamado } from '@/lib/queries/chamados'
import { esperaTexto } from '@/lib/chamados'
import { pode } from '@/lib/auth/permissoes'
import { useRealtimeComFallback } from '@/lib/realtime-fallback'
import { ConfigConta } from './config-conta'
import { DrawerFolhaMesas, DrawerQrMesa } from './qr'
import { PainelChamados, useRelogio } from './chamados'

/**
 * Cor do estado no mapa do salão — blocos cheios, como no PDV: verde livre, azul ocupada.
 * Bloqueada fica escura e inativa cinza. Chamado aberto ganha selo vermelho pulsando.
 */
const TOM_ESTADO: Record<EstadoMesa, { bloco: string; texto: string; ponto: string }> = {
  livre: { bloco: 'bg-status-ready', texto: 'text-white', ponto: 'bg-status-ready' },
  // Mesmo laranja do painel de mesas do PDV: mesa sentada esperando alguém anotar.
  aguardando: { bloco: 'bg-status-pending', texto: 'text-white', ponto: 'bg-status-pending' },
  ocupada: { bloco: 'bg-primary', texto: 'text-white', ponto: 'bg-primary' },
  bloqueada: { bloco: 'bg-sidebar-bg', texto: 'text-white', ponto: 'bg-sidebar-bg' },
  inativa: { bloco: 'bg-border', texto: 'text-text-subtle', ponto: 'bg-text-subtle' },
}

const ORDEM_FILTROS: (EstadoMesa | 'todas')[] = ['todas', 'livre', 'aguardando', 'ocupada', 'bloqueada', 'inativa']

interface MesaNaTela extends Mesa {
  estado: EstadoMesa
  total: number
  qtdPedidos: number
  /** Abertura da conta — o salão precisa ver há quanto tempo a mesa está ocupada. */
  abertaEm: string | null
  /** Número da comanda aberta (0072), para o garçom e o caixa falarem da mesma conta. */
  comandaNumero: number | null
}

export default function MesasPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [mesas, setMesas] = useState<MesaNaTela[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<EstadoMesa | 'todas'>('todas')
  const [setorFiltro, setSetorFiltro] = useState<string | null>(null)
  const [formAberto, setFormAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<Mesa | null>(null)
  const [qrDaMesa, setQrDaMesa] = useState<Mesa | null>(null)
  const [folhaAberta, setFolhaAberta] = useState(false)
  const [configAberta, setConfigAberta] = useState(false)
  const [chamados, setChamados] = useState<Chamado[]>([])
  const [avisoAcao, setAvisoAcao] = useState<string | null>(null)
  const [nomeLoja, setNomeLoja] = useState('')
  const [logoLoja, setLogoLoja] = useState<string | null>(null)
  // Um relógio para a tela inteira: os "há X min" dos chamados e das mesas avançam
  // juntos, sem um timer por linha.
  const agora = useRelogio()
  // Papel de quem está logado. Cadastro, QR e bloqueio são da gestão; o garçom só abre a
  // mesa. Esconder os botões é conforto — quem barra a escrita é a RLS (0062).
  const [papel, setPapel] = useState<string | null>(null)
  // Falha fechada: enquanto o papel não é conhecido, nada de gestão aparece. Mostrar
  // "Nova mesa" ao garçom por um soluço de rede é confuso, mesmo com a API barrando.
  const gerencia = pode(papel, 'mesas.gerenciar')
  // Quem atende (chamado, lançamento). O caixa entra no salão só para cobrar.
  const atende = papel === null || pode(papel, 'mesas.operar')

  const carregar = useCallback(
    async (id: string) => {
      try {
        // `listarMesasComEstado` já resolve a comanda aberta de cada mesa; o estado
        // visual sai da regra pura, não de um if espalhado na tela.
        const [lista, comEstado, chamadosDb] = await Promise.all([
          listarMesas(supabase, id),
          listarMesasComEstado(supabase, id).catch(() => [] as MesaComEstado[]),
          listarChamadosAbertos(supabase, id).catch(() => [] as Chamado[]),
        ])
        setChamados(chamadosDb)
        const porId = new Map(comEstado.map((m) => [m.id, m]))
        setMesas(
          lista.map((m) => {
            const estadoComanda = porId.get(m.id)
            return {
              ...m,
              estado: estadoDaMesa(m, {
                aberta: !!estadoComanda?.comandaAberta,
                qtdPedidos: estadoComanda?.qtdPedidos ?? 0,
              }),
              total: estadoComanda?.total ?? 0,
              qtdPedidos: estadoComanda?.qtdPedidos ?? 0,
              abertaEm: estadoComanda?.comandaAberta?.abertaEm ?? null,
              comandaNumero: estadoComanda?.comandaAberta?.numero ?? null,
            }
          }),
        )
        setErro(null)
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível carregar as mesas.')
      } finally {
        setCarregando(false)
      }
    },
    [supabase],
  )

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (!vivo) return
      if (!id) {
        setCarregando(false)
        setErro('Não foi possível identificar a loja.')
        return
      }
      setRestauranteId(id)
      const { data: auth } = await supabase.auth.getUser()
      if (auth.user) {
        const { data: u } = await supabase.from('usuarios').select('papel').eq('id', auth.user.id).maybeSingle()
        if (vivo && u) setPapel(u.papel as string)
      }
      // Nome e logo só para a folha de QR impressa.
      const { data: loja } = await supabase.from('restaurantes').select('nome, logo_url').eq('id', id).maybeSingle()
      if (vivo && loja) {
        setNomeLoja((loja.nome as string) ?? '')
        setLogoLoja((loja.logo_url as string | null) ?? null)
      }
      await carregar(id)
    })()
    return () => {
      vivo = false
    }
  }, [supabase, carregar])

  // Tempo real com rede de segurança: o chamado tem que aparecer sem ninguém dar F5, e
  // se o canal cair o polling volta ao ritmo agressivo (lib/realtime-fallback.ts).
  const recarregar = useCallback(() => {
    if (restauranteId) void carregar(restauranteId)
  }, [restauranteId, carregar])

  const { intervaloMs } = useRealtimeComFallback({
    supabase,
    canal: restauranteId ? `salao-${restauranteId}` : null,
    tabelas: [
      { tabela: 'chamados_mesa', filtro: restauranteId ? `restaurante_id=eq.${restauranteId}` : undefined },
      { tabela: 'pedidos', filtro: restauranteId ? `restaurante_id=eq.${restauranteId}` : undefined },
    ],
    // Pedido de delivery não muda nada nesta tela, e recarregar o salão custa uma
    // consulta por mesa ocupada. Num restaurante com movimento no delivery isso seria
    // uma releitura completa a cada pedido que entra.
    aoEvento: (payload) => {
      const linha = (payload.new ?? payload.old) as { canal?: string } | undefined
      if (payload.table === 'pedidos' && linha?.canal && linha.canal !== 'mesa') return
      recarregar()
    },
    aoSincronizar: recarregar,
  })

  useEffect(() => {
    if (!restauranteId) return
    const t = setInterval(recarregar, intervaloMs)
    return () => clearInterval(t)
  }, [restauranteId, intervaloMs, recarregar])

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return mesas.filter((m) => {
      if (filtro !== 'todas' && m.estado !== filtro) return false
      if (setorFiltro !== null && (m.setor || 'Sem setor') !== setorFiltro) return false
      if (!termo) return true
      return m.nome.toLowerCase().includes(termo) || (m.setor ?? '').toLowerCase().includes(termo)
    })
  }, [mesas, busca, filtro, setorFiltro])

  // Setores cadastrados, na ordem em que aparecem no salão. Só vira filtro com 2 ou mais.
  const setores = useMemo(() => [...new Set(mesas.map((m) => m.setor || 'Sem setor'))], [mesas])

  const contagem = useMemo(() => {
    const base: Record<string, number> = { todas: mesas.length }
    for (const e of ['livre', 'ocupada', 'bloqueada', 'inativa'] as EstadoMesa[]) {
      base[e] = mesas.filter((m) => m.estado === e).length
    }
    return base
  }, [mesas])

  async function salvarMesa(dados: { nome: string; setor: string; capacidade: string }) {
    if (!restauranteId) return
    const capacidade = dados.capacidade.trim() ? Number(dados.capacidade) : null
    if (emEdicao) {
      await atualizarMesa(supabase, emEdicao.id, {
        nome: dados.nome.trim(),
        setor: dados.setor.trim() || null,
        capacidade,
      })
    } else {
      await criarMesa(supabase, restauranteId, {
        nome: dados.nome.trim(),
        ordem: mesas.length,
        setor: dados.setor.trim() || null,
        capacidade,
      })
    }
    setFormAberto(false)
    setEmEdicao(null)
    await carregar(restauranteId)
  }

  /**
   * Tirar a mesa de operação (bloquear, desativar) passa pelo servidor, nunca por update
   * direto: a rota confere se existe conta aberta antes, grava auditoria com estado
   * anterior e novo, e exige `mesas.gerenciar`. Mesa com histórico é arquivada
   * (`ativa = false`), nunca excluída — comanda e pedido continuam ligados a ela.
   */
  async function acaoDeEstado(mesa: MesaNaTela, acao: 'bloquear' | 'desbloquear' | 'desativar' | 'reativar') {
    setAvisoAcao(null)
    try {
      const r = await fetch(`/api/admin/mesas/${mesa.id}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      })
      const corpo = (await r.json()) as { error?: string }
      if (!r.ok) {
        setAvisoAcao(corpo.error ?? 'Não foi possível alterar a mesa.')
        return
      }
    } catch {
      setAvisoAcao('Sem conexão com o servidor.')
      return
    }
    recarregar()
  }

  return (
    <>
      <TopBar
        title="Mesas e Comandas"
        breadcrumb="Salão · Mesas"
        right={
          gerencia ? (
            <>
              <Button variant="outline" onClick={() => setFolhaAberta(true)} disabled={mesas.length === 0} aria-label="Folha de QR" title="Folha de QR">
                <Printer className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Folha de QR</span>
              </Button>
              <Button variant="outline" onClick={() => setConfigAberta(true)} aria-label="Conta e pagamentos" title="Conta e pagamentos">
                <Settings className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Conta e pagamentos</span>
              </Button>
              <Button
                onClick={() => {
                  setEmEdicao(null)
                  setFormAberto(true)
                }}
                aria-label="Nova mesa"
                title="Nova mesa"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Nova mesa</span>
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5">
        {atende && <PainelChamados chamados={chamados} agora={agora} onMudou={recarregar} />}

        {avisoAcao && (
          <p className="mb-4 rounded-menuzia border border-danger bg-danger-bg px-4 py-2.5 text-[13px] text-danger">
            {avisoAcao}
          </p>
        )}

        {/* Busca + filtros por estado */}
        <div className="mb-3 flex flex-col gap-2 sm:mb-4 lg:flex-row lg:flex-wrap lg:items-center">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar mesa ou setor…"
            className="h-[44px] w-full rounded-menuzia lg:h-9 lg:w-56 border border-border bg-main px-3 text-[13px] text-text-main outline-none placeholder:text-text-subtle focus:border-primary"
          />
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-5 sm:px-5 lg:mx-0 lg:flex-wrap lg:px-0">
            {ORDEM_FILTROS.map((f) => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                title={f === 'todas' ? 'Todas as mesas' : AJUDA_ESTADO[f]}
                className={[
                  'min-h-[40px] flex-shrink-0 whitespace-nowrap rounded-menuzia border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors lg:min-h-0',
                  filtro === f
                    ? 'border-primary bg-primary text-white'
                    : 'border-border bg-main text-text-subtle hover:text-text-main',
                ].join(' ')}
              >
                {f !== 'todas' && (
                  <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${TOM_ESTADO[f].ponto} ${filtro === f ? 'ring-1 ring-white' : ''}`} />
                )}
                {f === 'todas' ? 'Todas' : ROTULO_ESTADO[f]}
                <span className="ml-1.5 opacity-70">{contagem[f] ?? 0}</span>
              </button>
            ))}
          </div>
          {setores.length > 1 && (
            <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-5 sm:px-5 lg:mx-0 lg:flex-wrap lg:px-0" role="group" aria-label="Filtrar por setor">
              {[null, ...setores].map((s) => (
                <button
                  key={s ?? 'todos'}
                  onClick={() => setSetorFiltro(s)}
                  aria-pressed={setorFiltro === s}
                  className={[
                    'min-h-[40px] flex-shrink-0 whitespace-nowrap rounded-menuzia border px-3 py-1.5 text-[11px] font-semibold transition-colors lg:min-h-0',
                    setorFiltro === s
                      ? 'border-text-main bg-text-main text-white'
                      : 'border-border bg-main text-text-subtle hover:text-text-main',
                  ].join(' ')}
                >
                  {s ?? 'Todos os setores'}
                </button>
              ))}
            </div>
          )}
        </div>

        {carregando && <p className="text-[13px] text-text-subtle">Carregando mesas…</p>}

        {erro && !carregando && (
          <div className="rounded-menuzia border border-danger bg-danger-bg px-4 py-3 text-[13px] text-danger">{erro}</div>
        )}

        {!carregando && !erro && mesas.length === 0 && (
          <div className="rounded-menuzia border border-border bg-main px-6 py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bg-page text-2xl">
              🍽️
            </div>
            <p className="text-[14px] font-semibold text-text-main">Nenhuma mesa cadastrada</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] text-text-subtle">
              Cadastre as mesas do salão para gerar o QR Code de cada uma. O cliente escaneia, vê o cardápio e mostra a
              seleção ao garçom.
            </p>
            {gerencia && (
              <Button
                className="mt-4"
                onClick={() => {
                  setEmEdicao(null)
                  setFormAberto(true)
                }}
              >
                <Plus className="mr-1.5 inline h-3.5 w-3.5" />
                Cadastrar a primeira mesa
              </Button>
            )}
          </div>
        )}

        {!carregando && !erro && mesas.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {visiveis.map((mesa) => {
              const tom = TOM_ESTADO[mesa.estado]
              const chamadoDaMesa = chamados.find((c) => c.mesaId === mesa.id) ?? null
              // "Aguardando" e "Ocupada" são a mesma conta aberta, mudando só se já tem
              // lançamento — o que vale para abrir, para o relógio e para o caixa vale nos dois.
              const contaAberta = mesa.estado === 'ocupada' || mesa.estado === 'aguardando'
              // Abrir a mesa é o que o garçom faz. Mesa inativa ou bloqueada não recebe
              // lançamento, então o bloco não vira atalho.
              const abre = mesa.estado !== 'inativa' && mesa.estado !== 'bloqueada' && (atende || contaAberta)
              const acao = !atende ? 'Ver conta' : contaAberta ? 'Toque p/ abrir' : 'Toque p/ lançar'
              const conteudo = (
                <>
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide opacity-85">
                      {mesa.bloqueada && <Lock className="mr-0.5 inline h-3 w-3 align-[-2px]" />}
                      {ROTULO_ESTADO[mesa.estado]}
                    </span>
                    {contaAberta && mesa.abertaEm && (
                      <span className="text-[10px] font-medium opacity-80">{esperaTexto(mesa.abertaEm, agora).replace(/^há /, '')}</span>
                    )}
                  </div>
                  {chamadoDaMesa && (
                    <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-menuzia bg-danger px-1.5 py-0.5 text-[10px] font-bold uppercase text-white shadow-sm motion-safe:animate-pulse">
                      <BellRing className="h-3 w-3" />
                      {chamadoDaMesa.status === 'assumido' ? 'Alguém já vai' : 'Chamando'}
                    </span>
                  )}
                  <div className="mt-auto min-w-0">
                    <span className="block truncate text-[24px] font-extrabold leading-none">{mesa.nome}</span>
                    <span className="mt-1 block truncate text-[10px] opacity-80">
                      {mesa.setor || 'Sem setor'}
                      {mesa.capacidade ? ` · ${mesa.capacidade} lugares` : ''}
                    </span>
                    {contaAberta ? (
                      <span className="mt-1 block truncate text-[13px] font-bold">
                        {mesa.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · {mesa.qtdPedidos} lanç.
                      </span>
                    ) : (
                      abre && <span className="mt-1 block text-[11px] opacity-80">{acao}</span>
                    )}
                    {gerencia && mesa.qrRevogado && mesa.estado !== 'inativa' && (
                      <span className="mt-1 block text-[10px] font-bold uppercase">QR revogado</span>
                    )}
                  </div>
                </>
              )
              const classeBloco = [
                'flex aspect-square min-w-0 flex-col rounded-menuzia p-3 text-left shadow-sm transition-all',
                tom.bloco,
                tom.texto,
                abre ? 'hover:brightness-105 active:scale-[0.97]' : '',
                chamadoDaMesa ? 'ring-2 ring-danger ring-offset-2 ring-offset-page' : '',
              ].join(' ')
              return (
                <div key={mesa.id} className="flex min-w-0 flex-col gap-1">
                  {abre ? (
                    <Link href={`/admin/mesas/${mesa.id}`} className={classeBloco} aria-label={`${mesa.nome} — ${ROTULO_ESTADO[mesa.estado]}`}>
                      {conteudo}
                    </Link>
                  ) : (
                    <div className={classeBloco}>{conteudo}</div>
                  )}

                  {gerencia && (
                    <div className="grid grid-cols-4 gap-1">
                      <Button variant="outline" className="!px-0" onClick={() => setQrDaMesa(mesa)} title="Ver QR Code" aria-label={`QR Code da ${mesa.nome}`}>
                        <QrCode className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        className="!px-0"
                        onClick={() => {
                          setEmEdicao(mesa)
                          setFormAberto(true)
                        }}
                        title="Editar"
                        aria-label={`Editar ${mesa.nome}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        className="!px-0"
                        onClick={() => acaoDeEstado(mesa, mesa.bloqueada ? 'desbloquear' : 'bloquear')}
                        title={mesa.bloqueada ? 'Desbloquear' : 'Bloquear'}
                        aria-label={mesa.bloqueada ? 'Desbloquear' : 'Bloquear'}
                      >
                        {mesa.bloqueada ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="outline"
                        className="!px-0"
                        onClick={() => acaoDeEstado(mesa, mesa.ativa ? 'desativar' : 'reativar')}
                        aria-label={mesa.ativa ? 'Desativar' : 'Reativar'}
                        title={mesa.ativa ? 'Desativar' : 'Reativar'}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
            {visiveis.length === 0 && (
              <p className="col-span-full py-8 text-center text-[13px] text-text-subtle">
                Nenhuma mesa nesse filtro.
              </p>
            )}
          </div>
        )}
      </div>

      {formAberto && (
        <FormMesa
          mesa={emEdicao}
          sugestao={proximoNomeDeMesa(mesas)}
          onCancelar={() => {
            setFormAberto(false)
            setEmEdicao(null)
          }}
          onSalvar={salvarMesa}
        />
      )}

      {qrDaMesa && (
        <DrawerQrMesa
          mesa={qrDaMesa}
          podeGerenciar={gerencia}
          onFechar={() => setQrDaMesa(null)}
          onTokenRodado={(revogado) => {
            // O drawer já buscou o link novo; aqui só o selo "QR revogado" do salão.
            setMesas((atual) => atual.map((m) => (m.id === qrDaMesa.id ? { ...m, qrRevogado: revogado } : m)))
          }}
        />
      )}

      {folhaAberta && (
        <DrawerFolhaMesas
          mesas={mesas.filter((m) => m.ativa)}
          nomeLoja={nomeLoja}
          logoUrl={logoLoja}
          onFechar={() => setFolhaAberta(false)}
        />
      )}

      {configAberta && <ConfigConta onFechar={() => setConfigAberta(false)} />}
    </>
  )
}

// ── Formulário ──────────────────────────────────────────────────────────────

function FormMesa({
  mesa,
  sugestao,
  onCancelar,
  onSalvar,
}: {
  mesa: Mesa | null
  sugestao: string
  onCancelar: () => void
  onSalvar: (dados: { nome: string; setor: string; capacidade: string }) => Promise<void>
}) {
  const [nome, setNome] = useState(mesa?.nome ?? sugestao)
  const [setor, setSetor] = useState(mesa?.setor ?? '')
  const [capacidade, setCapacidade] = useState(mesa?.capacidade ? String(mesa.capacidade) : '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function submeter() {
    if (!nome.trim()) {
      setErro('Dê um nome ou número para a mesa.')
      return
    }
    setSalvando(true)
    setErro(null)
    try {
      await onSalvar({ nome, setor, capacidade })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.')
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onCancelar}>
      <aside
        className="flex h-full w-full max-w-md flex-col bg-main shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-border px-5">
          <span className="text-[15px] font-semibold text-text-main">{mesa ? 'Editar mesa' : 'Nova mesa'}</span>
          <button onClick={onCancelar} className="text-text-subtle hover:text-text-main">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <Campo label="Nome ou número" hint="É o que aparece no QR e na comanda. Ex.: Mesa 01, Varanda 02, Balcão 03.">
            <input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="h-10 w-full rounded-menuzia border border-border px-3 text-[13px] outline-none focus:border-primary"
            />
          </Campo>

          <Campo label="Setor" hint="Opcional. Agrupa as mesas no salão: Varanda, Interno, Mezanino…">
            <input
              value={setor}
              onChange={(e) => setSetor(e.target.value)}
              placeholder="Sem setor"
              className="h-10 w-full rounded-menuzia border border-border px-3 text-[13px] outline-none focus:border-primary"
            />
          </Campo>

          <Campo label="Capacidade" hint="Opcional. Quantas pessoas sentam.">
            <input
              value={capacidade}
              onChange={(e) => setCapacidade(e.target.value.replace(/\D/g, '').slice(0, 2))}
              inputMode="numeric"
              placeholder="—"
              className="h-10 w-24 rounded-menuzia border border-border px-3 text-[13px] outline-none focus:border-primary"
            />
          </Campo>

          {erro && (
            <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>
          )}
        </div>

        <div className="flex flex-shrink-0 gap-2 border-t border-border p-5">
          <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={salvando}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={submeter} disabled={salvando}>
            {salvando ? 'Salvando…' : mesa ? 'Salvar' : 'Cadastrar mesa'}
          </Button>
        </div>
      </aside>
    </div>
  )
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-text-subtle">{hint}</p>}
    </div>
  )
}
