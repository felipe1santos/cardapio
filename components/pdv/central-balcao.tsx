'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ShoppingBag } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Capacete } from '@/components/icones/capacete'
import { useRealtimeComFallback } from '@/lib/realtime-fallback'
import { resumirDimensoes, situacaoFinanceira, telefoneParcial, ROTULO_FINANCEIRO, type SituacaoFinanceira } from '@/lib/pdv-v2'
import type { LinhaCentral } from '@/lib/servicos/conta-presencial'
import { chamar, formatBRL, horaCurta, mascararTelefone, novaChave, tempoCurto } from './util'

/**
 * Central de Balcão (spec 13.1): todas as comandas de balcão abertas, com as quatro
 * dimensões de cada uma, e o botão de abrir uma nova (13.2).
 */

const TOM_FINANCEIRO: Record<SituacaoFinanceira, 'ok' | 'pending' | 'danger' | 'alert'> = {
  pago: 'ok',
  parcial: 'alert',
  nao_pago: 'pending',
  estornado: 'danger',
}

export interface ComandaAberta {
  id: string
  senha: number
  nome: string
  /** Aberto com dados de entrega (entrega manual). */
  entrega?: boolean
}

export function CentralBalcao({
  supabase,
  restauranteId,
  onVoltar,
  onAbrirConta,
  onNovaComanda,
  acoes,
}: {
  supabase: SupabaseClient
  restauranteId: string
  onVoltar: () => void
  onAbrirConta: (comandaId: string) => void
  /** Comanda recém-aberta: o PDV vai direto para o cardápio lançar nela. */
  onNovaComanda: (c: ComandaAberta) => void
  acoes?: React.ReactNode
}) {
  const [escopo, setEscopo] = useState<'abertas' | 'hoje'>('abertas')
  const [linhas, setLinhas] = useState<LinhaCentral[]>([])
  const [resumo, setResumo] = useState({ abertas: 0, recebidoHoje: 0 })
  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [novaAberta, setNovaAberta] = useState(false)
  const [agora, setAgora] = useState(() => Date.now())
  // Guarda de sequência: resposta velha que chega depois da nova não sobrescreve a tela.
  const seq = useRef(0)

  const carregar = useCallback(async () => {
    const minha = ++seq.current
    const r = await chamar<{ linhas: LinhaCentral[]; abertas: number; recebidoHoje: number }>(`/api/admin/balcao/comandas?escopo=${escopo}`)
    if (minha !== seq.current) return
    setCarregando(false)
    if (!r.ok || !r.dados) {
      setErro(r.erro)
      return
    }
    setErro(null)
    setLinhas(r.dados.linhas)
    setResumo({ abertas: r.dados.abertas, recebidoHoje: r.dados.recebidoHoje })
  }, [escopo])

  useEffect(() => {
    setCarregando(true)
    void carregar()
  }, [carregar])

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const { intervaloMs } = useRealtimeComFallback({
    supabase,
    canal: `pdv-balcao-${restauranteId}`,
    tabelas: [
      { tabela: 'comandas', filtro: `restaurante_id=eq.${restauranteId}` },
      { tabela: 'pagamentos_comanda', filtro: `restaurante_id=eq.${restauranteId}` },
      { tabela: 'pedidos', filtro: `restaurante_id=eq.${restauranteId}` },
    ],
    // Evento = "recarregar". Nunca aplicar o payload direto: fora de ordem, ele mentiria.
    aoEvento: (payload) => {
      const linha = (payload.new ?? payload.old) as { canal?: string; tipo?: string } | undefined
      if (payload.table === 'pedidos' && linha?.canal && linha.canal !== 'balcao') return
      void carregar()
    },
    aoSincronizar: () => void carregar(),
  })
  useEffect(() => {
    const t = setInterval(() => void carregar(), intervaloMs)
    return () => clearInterval(t)
  }, [intervaloMs, carregar])

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return linhas
    return linhas.filter((l) => l.nome.toLowerCase().includes(termo) || String(l.senha) === termo.replace('#', ''))
  }, [linhas, busca])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-page">
      {novaAberta && (
        <NovaComandaModal
          onCancelar={() => setNovaAberta(false)}
          onAberta={(c) => {
            setNovaAberta(false)
            onNovaComanda(c)
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-white px-4 py-3">
        <button
          type="button"
          onClick={onVoltar}
          className="flex items-center gap-1.5 rounded-menuzia border-2 border-primary bg-primary px-4 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-primary-dark active:scale-[0.97]"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
          Mesas
        </button>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">PDV</p>
          <h1 className="text-[18px] font-bold leading-tight text-text-main">Balcão</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {acoes}
          <button
            type="button"
            onClick={() => setNovaAberta(true)}
            data-testid="balcao-novo"
            className="rounded-menuzia bg-status-ready px-5 py-3 text-[14px] font-bold text-white shadow-sm transition-all hover:brightness-95 active:scale-[0.98]"
          >
            + Novo pedido
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-white px-4 py-2.5">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou senha…"
          className="w-full max-w-xs rounded-menuzia border border-border bg-white px-3 py-2 text-[13px] text-text-main placeholder:text-text-subtle/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex overflow-hidden rounded-menuzia border border-border">
          {(['abertas', 'hoje'] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEscopo(e)}
              className={[
                'px-3 py-2 text-[12px] font-semibold transition-colors',
                escopo === e ? 'bg-primary text-white' : 'bg-white text-text-subtle hover:text-text-main',
              ].join(' ')}
            >
              {e === 'abertas' ? 'Abertas' : 'Encerradas hoje'}
            </button>
          ))}
        </div>
        <p className="ml-auto text-[12px] text-text-subtle">
          Abertas <strong className="text-text-main">{resumo.abertas}</strong> · Recebido hoje no balcão{' '}
          <strong className="text-text-main">{formatBRL(resumo.recebidoHoje)}</strong>
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {erro && <p className="mb-3 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>}
        {carregando ? (
          <p className="py-10 text-center text-[13px] text-text-subtle">Carregando…</p>
        ) : visiveis.length === 0 ? (
          <div className="rounded-menuzia border border-dashed border-border bg-white py-12 text-center">
            <p className="text-[14px] font-semibold text-text-main">
              {escopo === 'abertas' ? 'Nenhuma comanda de balcão aberta.' : 'Nenhuma comanda de balcão encerrada hoje.'}
            </p>
            {escopo === 'abertas' && <p className="mt-1 text-[12px] text-text-subtle">Toque em “+ Novo pedido” para abrir uma.</p>}
          </div>
        ) : (
          <div className="overflow-hidden rounded-menuzia border border-border bg-white">
            <div className="hidden grid-cols-[70px_1.4fr_70px_70px_50px_100px_1fr_1fr_100px_80px] gap-2 border-b border-border bg-page/60 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-text-subtle lg:grid">
              <span>Senha</span>
              <span>Nome</span>
              <span>Aberta</span>
              <span>Tempo</span>
              <span>Ped.</span>
              <span className="text-right">Valor</span>
              <span>Cozinha</span>
              <span>Atendimento</span>
              <span>Financeiro</span>
              <span />
            </div>
            <ul className="divide-y divide-border">
              {visiveis.map((l) => {
                const dim = resumirDimensoes(l.pedidos, 'balcao')
                const fin = situacaoFinanceira(l.total, l.pago, l.estornos)
                const encerrada = l.status !== 'aberta'
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => onAbrirConta(l.id)}
                      data-testid={`balcao-linha-${l.senha}`}
                      className="grid w-full grid-cols-[60px_1fr_auto] items-center gap-2 px-3 py-3 text-left transition-colors hover:bg-page/60 lg:grid-cols-[70px_1.4fr_70px_70px_50px_100px_1fr_1fr_100px_80px]"
                    >
                      <span className="text-[20px] font-extrabold leading-none text-text-main">{l.senha}</span>
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[14px] font-semibold text-text-main">{l.nome}</span>
                          {l.entrega ? (
                            <Badge tone="alert"><span className="inline-flex items-center gap-1"><Capacete className="h-3 w-3" />Entrega</span></Badge>
                          ) : (
                            <Badge tone="paused">Retirada</Badge>
                          )}
                        </span>
                        {l.telefone && <span className="block text-[11px] text-text-subtle">{telefoneParcial(l.telefone)}</span>}
                        <span className="mt-0.5 block text-[11px] text-text-subtle lg:hidden">
                          {dim.texto.cozinha} · {dim.texto.atendimento}
                        </span>
                      </span>
                      <span className="hidden text-[12px] text-text-subtle lg:block">{horaCurta(l.abertaEm)}</span>
                      <span className="hidden text-[12px] text-text-subtle lg:block">{encerrada ? horaCurta(l.fechadaEm) : tempoCurto(l.abertaEm, agora)}</span>
                      <span className="hidden text-[13px] text-text-main lg:block">{l.qtdPedidos}</span>
                      <span className="text-right text-[14px] font-bold text-text-main lg:order-none">{formatBRL(l.total)}</span>
                      <span className="hidden text-[12px] text-text-main lg:block">{dim.texto.cozinha}</span>
                      <span className="hidden text-[12px] text-text-main lg:block">{dim.texto.atendimento}</span>
                      <span className="hidden lg:block">
                        {encerrada ? (
                          <Badge tone={l.status === 'cancelada' ? 'danger' : 'ok'}>{l.status === 'cancelada' ? 'Cancelada' : 'Fechada'}</Badge>
                        ) : (
                          <Badge tone={TOM_FINANCEIRO[fin]}>{ROTULO_FINANCEIRO[fin]}</Badge>
                        )}
                      </span>
                      <span className="hidden text-right text-[12px] font-semibold text-primary lg:block">Abrir →</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

const CAMPO =
  'w-full rounded-menuzia border border-border px-3 py-2.5 text-[15px] text-text-main placeholder:text-text-subtle/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
const ROTULO = 'mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle'

const ENTREGA_VAZIA = { cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '', referencia: '', observacao: '', taxa: '' }

type Modalidade = 'retirada' | 'entrega'

/** CEP com máscara 00000-000 enquanto digita. */
function mascararCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

/**
 * Card preto: pedido avulso e pedido por telefone. Antes de qualquer coisa o operador
 * ESCOLHE retirada ou entrega — sem escolha, não abre. Nome sempre obrigatório,
 * telefone sempre opcional. Na entrega, endereço completo (o mesmo modelo do delivery)
 * com busca pelo CEP. Origem, canal, tipo e taxa final são decididos no servidor.
 */
function NovaComandaModal({ onCancelar, onAberta }: { onCancelar: () => void; onAberta: (c: ComandaAberta) => void }) {
  const [modalidade, setModalidade] = useState<Modalidade | null>(null)
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [entrega, setEntrega] = useState(ENTREGA_VAZIA)
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [avisoCep, setAvisoCep] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Uma chave por intenção de abrir: clique duplo e reenvio devolvem a mesma comanda.
  const chave = useRef(novaChave())
  const numeroRef = useRef<HTMLInputElement>(null)
  const campo = (k: keyof typeof ENTREGA_VAZIA) => ({
    value: entrega[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEntrega((x) => ({ ...x, [k]: e.target.value })),
    'data-testid': `entrega-${k}`,
    className: CAMPO,
  })

  /** Busca o endereço pelo CEP (mesma fonte do checkout da vitrine) e preenche o que vier. */
  async function buscarCep(valor: string) {
    const cep = valor.replace(/\D/g, '')
    if (cep.length !== 8) return
    setBuscandoCep(true)
    setAvisoCep(null)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
      const d = (await res.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
      if (d.erro) {
        setAvisoCep('CEP não encontrado. Preencha o endereço à mão.')
        return
      }
      setEntrega((x) => ({
        ...x,
        rua: d.logradouro || x.rua,
        bairro: d.bairro || x.bairro,
        cidade: d.localidade || x.cidade,
        estado: (d.uf || x.estado).toUpperCase(),
      }))
      numeroRef.current?.focus()
    } catch {
      setAvisoCep('Não deu para buscar o CEP agora. Preencha o endereço à mão.')
    } finally {
      setBuscandoCep(false)
    }
  }

  async function abrir(e: React.FormEvent) {
    e.preventDefault()
    if (enviando) return
    if (!modalidade) {
      setErro('Escolha RETIRADA ou ENTREGA.')
      return
    }
    if (!nome.trim()) {
      setErro('Informe o nome do cliente.')
      return
    }
    if (modalidade === 'entrega') {
      const faltando = [
        entrega.cep.replace(/\D/g, '').length !== 8 && 'CEP',
        !entrega.rua.trim() && 'rua',
        !entrega.numero.trim() && 'número',
        !entrega.bairro.trim() && 'bairro',
        !entrega.cidade.trim() && 'cidade',
        !entrega.estado.trim() && 'estado',
      ].filter(Boolean)
      if (faltando.length) {
        setErro(`Para entrega, informe ${faltando.join(', ')}.`)
        return
      }
    }
    setEnviando(true)
    setErro(null)
    const r = await chamar<{ id: string; senha: number }>('/api/admin/balcao/comandas', {
      method: 'POST',
      body: JSON.stringify({
        nome,
        telefone: telefone || undefined,
        chave: chave.current,
        modalidade,
        entrega: modalidade === 'entrega' ? { ...entrega, taxa: entrega.taxa.trim() === '' ? null : entrega.taxa } : undefined,
      }),
    })
    setEnviando(false)
    if (!r.ok || !r.dados) {
      setErro(r.erro)
      return
    }
    onAberta({ id: r.dados.id, senha: r.dados.senha, nome: nome.trim(), entrega: modalidade === 'entrega' })
  }

  const opcao = (m: Modalidade, rotulo: string, dica: string, icone: React.ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={modalidade === m}
      onClick={() => {
        setModalidade(m)
        setErro(null)
      }}
      data-testid={`balcao-modalidade-${m}`}
      className={[
        'flex flex-1 flex-col items-center gap-1 rounded-menuzia border-2 px-3 py-3 text-center transition-colors',
        modalidade === m ? 'border-primary bg-alert-bg text-primary-dark' : 'border-border bg-white text-text-main hover:border-primary/60',
      ].join(' ')}
    >
      {icone}
      <span className="text-[14px] font-bold uppercase tracking-wide">{rotulo}</span>
      <span className="text-[11px] font-medium text-text-subtle">{dica}</span>
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Novo atendimento de balcão">
      <form onSubmit={abrir} noValidate className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-menuzia bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-bold text-text-main">Novo atendimento de balcão</h2>
          <button type="button" onClick={onCancelar} className="rounded p-1 text-text-subtle hover:bg-page hover:text-text-main" aria-label="Fechar">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-4">
          <div>
            <span className={ROTULO}>
              Como o cliente vai receber? <span className="text-danger">*</span>
            </span>
            <div role="radiogroup" aria-label="Retirada ou entrega" className="flex gap-2">
              {opcao('retirada', 'Retirada', 'Cliente busca no balcão', <ShoppingBag className="h-6 w-6" />)}
              {opcao('entrega', 'Entrega', 'Vai até o cliente', <Capacete className="h-6 w-6" />)}
            </div>
          </div>

          {modalidade && (
            <>
              <label className="block">
                <span className={ROTULO}>
                  Nome do cliente <span className="text-danger">*</span>
                </span>
                <input autoFocus value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} data-testid="balcao-nome" className={CAMPO} />
              </label>
              <label className="block">
                <span className={ROTULO}>Telefone (opcional)</span>
                <input
                  value={telefone}
                  inputMode="tel"
                  onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
                  placeholder="(27) 99999-8888"
                  data-testid="balcao-telefone"
                  className={CAMPO}
                />
              </label>
              <p className="text-[12px] text-text-subtle">
                Telefone é necessário só para histórico do cliente, fidelidade e cupom. Sem ele, nome{modalidade === 'entrega' ? ' e endereço ficam' : ' fica'} só neste atendimento.
              </p>
            </>
          )}

          {modalidade === 'entrega' && (
            <div className="space-y-3 rounded-menuzia border border-border bg-page/40 p-3" data-testid="balcao-entrega">
              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-1 block">
                  <span className={ROTULO}>
                    CEP <span className="text-danger">*</span>
                  </span>
                  <input
                    inputMode="numeric"
                    placeholder="29000-000"
                    {...campo('cep')}
                    onChange={(e) => {
                      const v = mascararCep(e.target.value)
                      setEntrega((x) => ({ ...x, cep: v }))
                      if (v.replace(/\D/g, '').length === 8) buscarCep(v)
                    }}
                  />
                </label>
                <div className="col-span-2 flex items-end pb-2.5 text-[12px] text-text-subtle">
                  {buscandoCep ? 'Buscando endereço…' : avisoCep ? <span className="font-semibold text-warn">{avisoCep}</span> : 'Com o CEP, rua, bairro e cidade vêm sozinhos.'}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-2 block">
                  <span className={ROTULO}>
                    Rua <span className="text-danger">*</span>
                  </span>
                  <input {...campo('rua')} />
                </label>
                <label className="col-span-1 block">
                  <span className={ROTULO}>
                    Número <span className="text-danger">*</span>
                  </span>
                  <input ref={numeroRef} {...campo('numero')} />
                </label>
              </div>
              <label className="block">
                <span className={ROTULO}>
                  Bairro <span className="text-danger">*</span>
                </span>
                <input {...campo('bairro')} />
              </label>
              <div className="grid grid-cols-4 gap-2">
                <label className="col-span-3 block">
                  <span className={ROTULO}>
                    Cidade <span className="text-danger">*</span>
                  </span>
                  <input {...campo('cidade')} />
                </label>
                <label className="col-span-1 block">
                  <span className={ROTULO}>
                    UF <span className="text-danger">*</span>
                  </span>
                  <input maxLength={2} {...campo('estado')} onChange={(e) => setEntrega((x) => ({ ...x, estado: e.target.value.replace(/[^a-z]/gi, '').toUpperCase() }))} />
                </label>
              </div>
              <label className="block">
                <span className={ROTULO}>Complemento (opcional)</span>
                <input {...campo('complemento')} />
              </label>
              <label className="block">
                <span className={ROTULO}>Ponto de referência (opcional)</span>
                <input {...campo('referencia')} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={ROTULO}>Taxa de entrega</span>
                  <input inputMode="decimal" placeholder="Tabela da loja" {...campo('taxa')} />
                </label>
                <label className="block">
                  <span className={ROTULO}>Observação</span>
                  <input {...campo('observacao')} />
                </label>
              </div>
              <p className="text-[12px] text-text-subtle">
                Taxa vazia usa a tabela de frete da loja. O pedido vai para a cozinha e, pronto, segue para a logística — ou é concluído sozinho se a loja não usa logística.
              </p>
            </div>
          )}

          {erro && (
            <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger" data-testid="balcao-erro">
              {erro}
            </p>
          )}
        </div>
        <div className="flex gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onCancelar} className="flex-1 rounded-menuzia border border-border py-3 text-[13px] font-semibold text-text-subtle hover:text-text-main">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={enviando || !modalidade}
            data-testid="balcao-abrir"
            className="flex-[2] rounded-menuzia bg-status-ready py-3 text-[14px] font-bold text-white transition-all hover:brightness-95 disabled:opacity-50"
          >
            {enviando ? 'Abrindo…' : 'Abrir e lançar'}
          </button>
        </div>
      </form>
    </div>
  )
}
