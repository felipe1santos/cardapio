'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ToggleRow } from '@/components/admin/campos-ajustes'
import { chamar, horaCurta, novaChave } from '@/components/pdv/util'
import { BotaoAjudaImpressao, ModalAjudaImpressao } from '@/components/impressao/ajuda-impressao'
import { IMPRESSORA_VAZIA, ImpressoraModal, ReciboPreview, colsParaFontePreview } from '@/components/impressao/documentos'
import {
  AVISO_PAPEL,
  DOWNLOAD_ASSISTENTE_ATUAL,
  DOWNLOAD_ASSISTENTE_BETA,
  EXPLICACAO_RECIBO_EXTRATO,
  ROTULO_ESTADO_IMPRESSAO,
  ROTULO_FUNCAO,
  ROTULO_MODO_BETA,
  ROTULO_TIPO_TRABALHO,
  TOM_ESTADO_IMPRESSAO,
} from '@/lib/impressao/rotulos'
import type { AgenteVisao, DispositivoVisao, Funcao, ModoBeta, TrabalhoVisao } from '@/lib/impressao/servico'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import {
  atualizarConfigImpressao,
  atualizarImpressora,
  buscarConfigImpressao,
  buscarStatusAgente,
  criarImpressora,
  listarImpressoras,
  removerImpressora,
  type ConfigImpressao,
  type Impressora,
  type ImpressoraInput,
} from '@/lib/queries/impressao'

/**
 * Impressão — página única (dono e gerente), na ordem em que a loja resolve as coisas:
 *   1. Status · 2. Assistente · 3. Computadores e impressoras · 4. Funções ·
 *   5. Teste e calibração · 6. Histórico · 7. Diagnóstico e ajuda.
 *
 * O Assistente atual (token da loja) continua configurado aqui como sempre. O Assistente
 * Beta só aparece para loja liberada pela plataforma. Tudo do Beta passa por
 * /api/admin/impressao/* — nenhuma credencial aparece na tela; o código de pareamento
 * é mostrado uma vez e vence em 10 min.
 */

interface Painel {
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

interface AssistenteAtual {
  config: ConfigImpressao
  impressoras: Impressora[]
  nomeLoja: string
  logoUrl: string | null
  /** Token e opções do Assistente atual: só o dono altera (Ajustes era só do dono). */
  podeEditar: boolean
}

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

const DESCRICAO_MODO: Record<ModoBeta, string> = {
  teste: 'O Beta imprime só teste e calibração. O Assistente atual continua com tudo.',
  caixa: 'O Assistente atual continua na cozinha. O Beta imprime o Recibo/Extrato.',
  cozinha_caixa: 'O Beta imprime a cozinha e o Recibo/Extrato. O Assistente atual para de imprimir pedidos.',
}

function Secao({ n, titulo, children, acao, id }: { n: number; titulo: string; children: React.ReactNode; acao?: React.ReactNode; id?: string }) {
  return (
    <section className="min-w-0 rounded-menuzia border border-border bg-white" id={id}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-[14px] font-bold text-text-main">
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-sidebar-bg text-[11px] font-bold text-white">{n}</span>
          {titulo}
        </h2>
        {acao}
      </div>
      {children}
    </section>
  )
}

function Status({ rotulo, valor, tom }: { rotulo: string; valor: string; tom: 'ok' | 'alerta' | 'neutro' | 'erro' }) {
  const cor = { ok: 'bg-status-ready', alerta: 'bg-warn', neutro: 'bg-border', erro: 'bg-danger' }[tom]
  return (
    <div className="rounded-menuzia border border-border bg-white px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{rotulo}</p>
      <p className="mt-1 flex items-center gap-2 text-[13px] font-bold text-text-main">
        <span className={['h-2.5 w-2.5 shrink-0 rounded-full', cor].join(' ')} aria-hidden />
        {valor}
      </p>
    </div>
  )
}

export function PainelImpressao() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [p, setP] = useState<Painel | null>(null)
  const [atual, setAtual] = useState<AssistenteAtual | null>(null)
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [atualVistoEm, setAtualVistoEm] = useState<string | null>(null)
  const [atualImpressoraId, setAtualImpressoraId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [tokenCopiado, setTokenCopiado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null)
  const [codigo, setCodigo] = useState<{ codigo: string; expiraEm: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [compartilhar, setCompartilhar] = useState<{ funcao: Funcao; dispositivoId: string; texto: string } | null>(null)
  const [ajuda, setAjuda] = useState(false)
  const [trocarModo, setTrocarModo] = useState<ModoBeta | null>(null)
  const [calibrar, setCalibrar] = useState<string | null>(null)
  const [modalImpressora, setModalImpressora] = useState<{ id: string | null; input: ImpressoraInput } | null>(null)
  const [verFicha, setVerFicha] = useState(false)
  const seq = useRef(0)

  const carregar = useCallback(async () => {
    const minha = ++seq.current
    const r = await chamar<Painel>('/api/admin/impressao/painel')
    if (minha !== seq.current) return
    if (!r.ok || !r.dados) return setErro(r.erro)
    setErro(null)
    setP(r.dados)
  }, [])

  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), 5000)
    return () => clearInterval(t)
  }, [carregar])

  // Assistente atual: configuração da loja (como em Ajustes) e o token (só o dono lê).
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (!vivo || !id) return
      setRestauranteId(id)
      const tk = await fetch('/api/admin/impressao/token', { cache: 'no-store' })
        .then(async (r) => ({ ok: r.ok, token: r.ok ? ((await r.json()) as { token: string | null }).token : null }))
        .catch(() => ({ ok: false, token: null }))
      try {
        const [cfg, lista, loja] = await Promise.all([buscarConfigImpressao(supabase, id), listarImpressoras(supabase, id), buscarConfigLoja(supabase, id)])
        if (!vivo || !cfg) return
        setToken(tk.token)
        setAtual({ config: cfg, impressoras: lista, nomeLoja: loja?.nome ?? '', logoUrl: loja?.logoUrl ?? null, podeEditar: tk.ok })
      } catch {
        if (vivo) setErro('Não foi possível carregar a configuração do Assistente atual.')
      }
    })()
    return () => {
      vivo = false
    }
  }, [supabase])

  // Sinal do Assistente atual (heartbeat a cada 5 s).
  useEffect(() => {
    if (!restauranteId) return
    let vivo = true
    const checar = async () => {
      try {
        const s = await buscarStatusAgente(supabase, restauranteId)
        if (!vivo) return
        setAtualVistoEm(s.vistoEm)
        setAtualImpressoraId(s.vistoEm && Date.now() - new Date(s.vistoEm).getTime() < 30_000 ? s.impressoraId : null)
      } catch {
        /* sem sinal */
      }
    }
    void checar()
    const t = setInterval(checar, 8000)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [supabase, restauranteId])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 6000)
    return () => clearTimeout(t)
  }, [aviso])

  async function agir(url: string, metodo: string, corpo: unknown, sucesso: string) {
    if (ocupado) return null
    setOcupado(true)
    const r = await chamar(url, { method: metodo, body: JSON.stringify(corpo) })
    setOcupado(false)
    if (!r.ok) setAviso({ tom: 'erro', texto: r.erro ?? 'Não foi possível.' })
    else setAviso({ tom: 'ok', texto: sucesso })
    await carregar()
    return r
  }

  async function gerarCodigo() {
    const r = await chamar<{ codigo: string; expiraEm: string }>('/api/admin/impressao/pareamento', { method: 'POST' })
    if (!r.ok || !r.dados) return setAviso({ tom: 'erro', texto: r.erro ?? 'Não foi possível gerar o código.' })
    setCodigo(r.dados)
  }

  async function atribuir(funcao: Funcao, dispositivoId: string | null, confirmar = false) {
    const r = await agir('/api/admin/impressao/funcoes', 'PUT', { funcao, dispositivoId, confirmarCompartilhada: confirmar }, dispositivoId ? `Impressora da ${ROTULO_FUNCAO[funcao]} definida.` : `Impressora da ${ROTULO_FUNCAO[funcao]} removida.`)
    if (r && !r.ok && r.codigo === 'confirmar_compartilhada' && dispositivoId) {
      setAviso(null)
      setCompartilhar({ funcao, dispositivoId, texto: r.erro ?? '' })
    }
  }

  async function patchAtual(patch: Partial<ConfigImpressao>) {
    if (!atual || !restauranteId) return
    setAtual({ ...atual, config: { ...atual.config, ...patch } })
    try {
      await atualizarConfigImpressao(supabase, restauranteId, patch)
    } catch {
      setAviso({ tom: 'erro', texto: 'Não foi possível salvar a configuração.' })
    }
  }

  async function gerarToken() {
    if (token && !confirm('Gerar um token novo? O Assistente atual para de imprimir até você colar o token novo nele.')) return
    const res = await fetch('/api/admin/impressao/token', { method: 'POST' }).catch(() => null)
    if (!res?.ok) return setAviso({ tom: 'erro', texto: 'Não foi possível gerar o token.' })
    setToken(((await res.json()) as { token: string }).token)
  }

  async function salvarImpressoraAtual(input: ImpressoraInput) {
    if (!atual || !restauranteId || !modalImpressora) return
    if (modalImpressora.id) {
      await atualizarImpressora(supabase, modalImpressora.id, input)
      setAtual({ ...atual, impressoras: atual.impressoras.map((i) => (i.id === modalImpressora.id ? { ...i, ...input } : i)) })
    } else {
      const nova = await criarImpressora(supabase, restauranteId, input, atual.impressoras.length)
      setAtual({ ...atual, impressoras: [...atual.impressoras, nova] })
    }
    setModalImpressora(null)
  }

  async function removerImpressoraAtual(id: string) {
    if (!atual || !confirm('Remover esta impressora do Assistente atual?')) return
    try {
      await removerImpressora(supabase, id)
      setAtual({ ...atual, impressoras: atual.impressoras.filter((i) => i.id !== id) })
    } catch {
      setAviso({ tom: 'erro', texto: 'Não foi possível remover a impressora.' })
    }
  }

  const nomeDisp = (d: DispositivoVisao) => d.apelido || d.nomeSistema
  const agentePor = (id: string) => p?.agentes.find((a) => a.id === id)
  const dispositivosAtivos = p?.dispositivos.filter((d) => !agentePor(d.agenteId)?.revogado) ?? []
  const atualOnline = !!atualVistoEm && Date.now() - new Date(atualVistoEm).getTime() < 2 * 60_000
  const betaOnline = p?.agentes.filter((a) => a.online).length ?? 0
  const liberado = p?.betaLiberado === true
  const podeAtual = atual?.podeEditar === true
  const dCalibrar = p?.dispositivos.find((d) => d.id === calibrar) ?? null
  const cozinhaNoBeta = p?.modo === 'cozinha_caixa'

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4 p-4" data-testid="painel-impressao">
      <div>
        <h1 className="flex items-center gap-2 text-[20px] font-bold text-text-main">
          Impressão <BotaoAjudaImpressao onAbrir={() => setAjuda(true)} />
        </h1>
        <p className="text-[13px] text-text-subtle">Onde e como saem os pedidos da cozinha e o Recibo/Extrato.</p>
      </div>

      {aviso && (
        <p role="status" className={['rounded-menuzia px-3 py-2 text-[12px] font-semibold', aviso.tom === 'ok' ? 'bg-price-bg text-price-text' : 'bg-danger-bg text-danger'].join(' ')} data-testid="impressao-aviso">
          {aviso.texto}
        </p>
      )}
      {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[13px] text-danger">{erro}</p>}

      {/* 1. Status */}
      <h2 className="flex items-center gap-2 text-[14px] font-bold text-text-main">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-sidebar-bg text-[11px] font-bold text-white">1</span>
        Status
      </h2>
      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 lg:grid-cols-4" data-testid="impressao-status">
        <Status
          rotulo="Assistente atual"
          valor={atual && !atual.config.ativarAssistente ? 'Desativado' : atualOnline ? 'Imprimindo' : atualVistoEm ? `Sem sinal desde ${quando(atualVistoEm)}` : 'Não conectado'}
          tom={atual && !atual.config.ativarAssistente ? 'neutro' : atualOnline ? 'ok' : 'alerta'}
        />
        <Status rotulo="Impressão automática" valor={atual?.config.impressaoAutomatica ? 'Ligada' : 'Desligada'} tom={atual?.config.impressaoAutomatica ? 'ok' : 'neutro'} />
        <Status
          rotulo="Cozinha imprime pelo"
          valor={cozinhaNoBeta ? 'Assistente Beta' : 'Assistente atual'}
          tom="ok"
        />
        <Status
          rotulo="Assistente Beta"
          valor={!p ? '—' : !liberado ? 'Não liberado para esta loja' : `${ROTULO_MODO_BETA[p.modo]} · ${betaOnline} online`}
          tom={!liberado ? 'neutro' : betaOnline > 0 ? 'ok' : 'alerta'}
        />
      </div>

      {/* 2. Assistente */}
      <Secao n={2} titulo="Assistente de Impressão">
        <div className="grid gap-3 p-4 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="min-w-0 rounded-menuzia border border-border p-3">
            <p className="text-[13px] font-bold text-text-main">Assistente atual</p>
            <p className="text-[12px] text-text-subtle">Assistente atual: continua imprimindo normalmente.</p>
            <a
              href={DOWNLOAD_ASSISTENTE_ATUAL.url}
              className="mt-2 inline-flex items-center gap-1.5 rounded-menuzia bg-yellow-300 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-black hover:bg-yellow-400"
            >
              ⬇ Baixar Assistente {DOWNLOAD_ASSISTENTE_ATUAL.versao} (Windows)
            </a>
            <p className="mt-1 text-[11px] text-text-subtle">
              Dois cliques no instalador. Se o Windows avisar, clique em “Mais informações” → “Executar assim mesmo”.{' '}
              <a href="/guia-impressora.html" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">Guia passo a passo</a>
            </p>
            {atual && (
              <div className="mt-2 rounded-menuzia border border-border px-3">
                <ToggleRow label="Ativar o Assistente de Impressão" checked={atual.config.ativarAssistente} disabled={!podeAtual} onChange={(v) => void patchAtual({ ativarAssistente: v })} />
                <ToggleRow label="Impressão automática" hint="Imprime sozinho assim que o pedido chega." checked={atual.config.impressaoAutomatica} disabled={!podeAtual} onChange={(v) => void patchAtual({ impressaoAutomatica: v })} />
                <ToggleRow label="Aceitar pedidos automaticamente" hint="Move o pedido para “Preparando” assim que ele chega." checked={atual.config.aceitarPedidosAutomaticamente} disabled={!podeAtual} onChange={(v) => void patchAtual({ aceitarPedidosAutomaticamente: v })} />
              </div>
            )}
            {atual && !podeAtual && <p className="mt-1 text-[11px] text-text-subtle">Só o dono da loja altera estas opções e o token.</p>}
            {podeAtual && (
              <div className="mt-2 rounded-menuzia bg-page p-2.5">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Token do Assistente atual</p>
                {token ? (
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-menuzia bg-[#0B1220] px-2.5 py-2 font-mono text-[12px] text-cyan-300">{token}</code>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(token).then(() => { setTokenCopiado(true); setTimeout(() => setTokenCopiado(false), 2000) })}
                      className="rounded-menuzia border border-border bg-white px-3 py-2 text-[12px] font-semibold"
                    >
                      {tokenCopiado ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                ) : (
                  <p className="text-[12px] text-text-subtle">Nenhum token gerado ainda.</p>
                )}
                <button type="button" onClick={() => void gerarToken()} className="mt-1.5 text-[11px] font-semibold text-primary hover:underline">
                  {token ? 'Gerar novo token (o atual deixa de valer)' : 'Gerar token'}
                </button>
              </div>
            )}
          </div>

          <div className={['min-w-0 rounded-menuzia border p-3', liberado ? 'border-primary/40 bg-alert-bg/30' : 'border-border bg-page/50'].join(' ')}>
            <p className="text-[13px] font-bold text-text-main">
              Novo Assistente Beta {liberado && <Badge tone="alert" className="ml-1">{DOWNLOAD_ASSISTENTE_BETA.versao}</Badge>}
            </p>
            <p className="text-[12px] text-text-subtle">Novo Assistente Beta: necessário para usar impressoras separadas para Cozinha e Caixa.</p>
            {liberado ? (
              <>
                <a
                  href={DOWNLOAD_ASSISTENTE_BETA.url}
                  data-testid="baixar-beta"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-menuzia bg-primary px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark"
                >
                  ⬇ Baixar Assistente Beta (Windows)
                </a>
                <p className="mt-1 text-[11px] text-text-subtle">
                  Instala ao lado do atual, sem desinstalar nada. Ele começa em “Somente teste”: não imprime pedidos até você mudar o modo abaixo.
                </p>
              </>
            ) : (
              <p className="mt-2 text-[12px] text-text-subtle">Em teste com lojas selecionadas. Quando for liberado para esta loja, o download aparece aqui.</p>
            )}
          </div>
        </div>
      </Secao>

      {/* 3. Computadores e impressoras */}
      <Secao
        n={3}
        titulo="Computadores e impressoras"
        acao={
          liberado ? (
            <button type="button" onClick={() => void gerarCodigo()} data-testid="gerar-codigo" className="rounded-menuzia bg-primary px-4 py-2 text-[12px] font-bold uppercase tracking-wide text-white hover:bg-primary-dark">
              + Parear computador (Beta)
            </button>
          ) : undefined
        }
      >
        {codigo && (
          <div className="border-b border-border bg-alert-bg px-4 py-3 text-[13px] text-alert-text">
            <p>No Assistente Beta, em <strong>Parear este computador</strong>, digite:</p>
            <p className="mt-1 font-mono text-[26px] font-extrabold tracking-[0.2em] text-text-main" data-testid="codigo-pareamento">{codigo.codigo}</p>
            <p className="text-[12px]">Vale uma vez, até {horaCurta(codigo.expiraEm)}. Não fica salvo aqui.</p>
            <button type="button" onClick={() => setCodigo(null)} className="mt-1 text-[12px] font-semibold underline">Esconder</button>
          </div>
        )}

        <div className="px-4 pt-3">
          <p className="text-[12px] font-bold uppercase tracking-wide text-text-subtle">Assistente atual</p>
          <p className="text-[12px] text-text-subtle">
            {atualOnline ? 'Em uso agora' : atualVistoEm ? `Último sinal ${quando(atualVistoEm)}` : 'Nenhum sinal ainda'} · papel, fonte e cópias de cada impressora:
          </p>
          <ul className="mt-2 space-y-1.5">
            {atual?.impressoras.map((imp) => {
              const conectada = imp.id === atualImpressoraId
              return (
                <li key={imp.id} className={['flex flex-wrap items-center justify-between gap-2 rounded-menuzia border px-3 py-2', conectada ? 'border-yellow-400 bg-yellow-100' : 'border-border'].join(' ')}>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-text-main">
                      {imp.nome} {conectada && <Badge tone="new" className="ml-1">Em uso</Badge>}
                    </p>
                    <p className="text-[11px] text-text-subtle">Papel {imp.largura === 32 ? '58 mm' : '80 mm'} · fonte {imp.tamanhoFonte} · {imp.copias}x</p>
                  </div>
                  {podeAtual && (
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setModalImpressora({ id: imp.id, input: { nome: imp.nome, tamanhoFonte: imp.tamanhoFonte, largura: imp.largura, copias: imp.copias } })} className="text-[12px] font-semibold text-primary hover:underline">Editar</button>
                      <button type="button" onClick={() => void removerImpressoraAtual(imp.id)} className="text-[12px] text-text-subtle hover:text-danger">Remover</button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {atual && atual.impressoras.length === 0 && <p className="mt-1 text-[12px] text-text-subtle">Nenhuma impressora cadastrada.</p>}
          {podeAtual && (
            <button type="button" onClick={() => setModalImpressora({ id: null, input: IMPRESSORA_VAZIA })} className="mt-2 text-[12px] font-semibold text-primary hover:underline">
              + Nova impressora do Assistente atual
            </button>
          )}
        </div>

        {liberado && (
          <div className="mt-3 border-t border-border">
            <p className="px-4 pt-3 text-[12px] font-bold uppercase tracking-wide text-text-subtle">Assistente Beta — computadores pareados</p>
            {p && p.agentes.length === 0 && <p className="px-4 py-3 text-[13px] text-text-subtle">Nenhum computador pareado ainda.</p>}
            <ul className="divide-y divide-border">
              {p?.agentes.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`agente-${a.nome}`}>
                  <span className={['h-2.5 w-2.5 rounded-full', a.revogado ? 'bg-border' : a.online ? 'bg-status-ready' : 'bg-danger'].join(' ')} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-text-main">{a.nome}</p>
                    <p className="text-[12px] text-text-subtle">
                      {a.revogado ? 'Desconectado' : a.online ? 'Online' : 'Offline'} · versão {a.versao ?? '—'} · último sinal {quando(a.vistoEm)}
                    </p>
                  </div>
                  {!a.revogado && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => {
                          const nome = prompt('Nome do computador', a.nome)?.trim()
                          if (nome) void agir(`/api/admin/impressao/agentes/${a.id}`, 'PATCH', { nome }, 'Computador renomeado.')
                        }}
                        className="rounded-menuzia border border-border px-3 py-1.5 text-[12px] font-semibold text-text-main"
                      >
                        Renomear
                      </button>
                      <button
                        type="button"
                        disabled={ocupado}
                        data-testid={`revogar-${a.nome}`}
                        onClick={() => {
                          if (confirm(`Desconectar "${a.nome}"? Ele para de imprimir na hora e precisa ser pareado de novo.`)) {
                            void agir(`/api/admin/impressao/agentes/${a.id}`, 'POST', { acao: 'revogar' }, 'Computador desconectado.')
                          }
                        }}
                        className="rounded-menuzia border border-danger/40 px-3 py-1.5 text-[12px] font-semibold text-danger hover:bg-danger hover:text-white"
                      >
                        Desconectar
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="border-t border-border px-4 pt-3 text-[12px] font-bold uppercase tracking-wide text-text-subtle">Impressoras encontradas pelo Beta</p>
            {p && p.dispositivos.length === 0 && <p className="px-4 py-3 text-[13px] text-text-subtle">Nenhuma impressora informada ainda.</p>}
            <ul className="divide-y divide-border">
              {p?.dispositivos.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-3" data-testid={`dispositivo-${d.nomeSistema}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-text-main">
                      {nomeDisp(d)} {d.funcoes.map((f) => <Badge key={f} tone="preparing" className="ml-1">{ROTULO_FUNCAO[f]}</Badge>)}
                      {!d.disponivel && <Badge tone="danger" className="ml-1">Não encontrada no Windows</Badge>}
                    </p>
                    <p className="truncate text-[12px] text-text-subtle">
                      {agentePor(d.agenteId)?.nome ?? '—'} · Windows: {d.nomeSistema} · papel {d.larguraMm} mm{d.larguraPontos ? ` · calibrada (${d.larguraPontos} pontos)` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => {
                      const apelido = prompt('Apelido (ex.: Cozinha, Caixa)', d.apelido ?? '')
                      if (apelido !== null) void agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', { apelido }, 'Apelido salvo.')
                    }}
                    className="rounded-menuzia border border-border px-3 py-1.5 text-[12px] font-semibold"
                  >
                    Apelido
                  </button>
                  <select
                    value={d.larguraMm}
                    disabled={ocupado}
                    onChange={(e) => void agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', { larguraMm: Number(e.target.value) }, 'Papel salvo.')}
                    className="rounded-menuzia border border-border bg-white px-2 py-1.5 text-[12px]"
                    aria-label="Largura do papel"
                  >
                    <option value={80}>Papel 80 mm</option>
                    <option value={58}>Papel 58 mm</option>
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Secao>

      {/* 4. Funções */}
      <Secao n={4} titulo="Funções: Cozinha e Caixa — Recibo/Extrato">
        <div className="space-y-3 p-4">
          {!liberado ? (
            <p className="text-[13px] text-text-subtle">
              Hoje a cozinha sai no Assistente atual, na impressora escolhida nele. Impressoras separadas para Cozinha e Caixa usam o novo Assistente Beta.
            </p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
                {(['cozinha', 'caixa'] as Funcao[]).map((f) => (
                  <label key={f} className="block min-w-0 rounded-menuzia border border-border p-3">
                    <span className="block text-[13px] font-bold text-text-main">{f === 'cozinha' ? 'Impressora da Cozinha' : 'Impressora do Caixa — Recibo/Extrato'}</span>
                    <span className="mb-2 block text-[12px] text-text-subtle">
                      {f === 'cozinha' ? 'Impressora da cozinha: imprime os pedidos que devem ser preparados.' : 'Impressora do caixa: imprime o Recibo/Extrato para o cliente conferir.'}
                    </span>
                    <select
                      value={p?.funcoes[f] ?? ''}
                      disabled={ocupado || !p}
                      data-testid={`funcao-${f}`}
                      onChange={(e) => void atribuir(f, e.target.value || null)}
                      className="w-full min-w-0 max-w-full truncate rounded-menuzia border border-border bg-white px-3 py-2 text-[13px] text-text-main"
                    >
                      <option value="">— nenhuma —</option>
                      {dispositivosAtivos.map((d) => (
                        <option key={d.id} value={d.id}>
                          {nomeDisp(d)} · {agentePor(d.agenteId)?.nome ?? '?'}{d.disponivel ? '' : ' (não encontrada)'}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-[11px] text-text-subtle">
                      {f === 'caixa' ? EXPLICACAO_RECIBO_EXTRATO : cozinhaNoBeta ? 'A cozinha está saindo por esta impressora.' : 'Enquanto o modo não for “Cozinha e Caixa”, a cozinha continua no Assistente atual.'}
                    </span>
                  </label>
                ))}
              </div>

              <div className="rounded-menuzia border border-border p-3" data-testid="modo-beta">
                <p className="text-[13px] font-bold text-text-main">O que o Assistente Beta imprime</p>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {(['teste', 'caixa', 'cozinha_caixa'] as ModoBeta[]).map((m) => {
                    const ativo = p?.modo === m
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={ocupado || ativo}
                        data-testid={`modo-${m}`}
                        onClick={() => setTrocarModo(m)}
                        className={['rounded-menuzia border-2 p-3 text-left transition-colors', ativo ? 'border-primary bg-alert-bg/50' : 'border-border hover:border-primary/60'].join(' ')}
                      >
                        <span className="flex items-center justify-between text-[13px] font-bold text-text-main">
                          {ROTULO_MODO_BETA[m]} {ativo && <Badge tone="ok">Em uso</Badge>}
                        </span>
                        <span className="mt-1 block text-[12px] leading-snug text-text-subtle">{DESCRICAO_MODO[m]}</span>
                      </button>
                    )
                  })}
                </div>
                {p?.modo !== 'teste' && (
                  <p className="mt-2 text-[12px] text-text-subtle">
                    Algo errado? Toque em <strong>Somente teste</strong>: a cozinha volta na hora para o Assistente atual, sem reinstalar nada.
                  </p>
                )}
              </div>
            </>
          )}

          <div className="rounded-menuzia border border-border">
            <button type="button" onClick={() => setVerFicha((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] font-bold text-text-main" aria-expanded={verFicha}>
              Ficha da cozinha: opções e prévia <span className="text-text-subtle">{verFicha ? '▲' : '▼'}</span>
            </button>
            {verFicha && atual && (
              <div className="grid gap-4 border-t border-border p-3 lg:grid-cols-[1fr_340px]">
                <div>
                  <ToggleRow label="Mostrar número do item" checked={atual.config.mostrarNumeroItem} disabled={!podeAtual} onChange={(v) => void patchAtual({ mostrarNumeroItem: v })} />
                  <ToggleRow label="Mostrar preço dos complementos" checked={atual.config.mostrarPrecoComplementos} disabled={!podeAtual} onChange={(v) => void patchAtual({ mostrarPrecoComplementos: v })} />
                  <ToggleRow label="Mostrar nome dos complementos" checked={atual.config.mostrarNomeComplementos} disabled={!podeAtual} onChange={(v) => void patchAtual({ mostrarNomeComplementos: v })} />
                  <ToggleRow label="Fonte maior na via de produção" checked={atual.config.fonteMaiorProducao} disabled={!podeAtual} onChange={(v) => void patchAtual({ fonteMaiorProducao: v })} />
                  <ToggleRow label="Multiplicar opções pela quantidade" checked={atual.config.multiplicarOpcoesQtd} disabled={!podeAtual} onChange={(v) => void patchAtual({ multiplicarOpcoesQtd: v })} />
                  <ToggleRow label="Imprimir logo da loja" checked={atual.config.imprimirLogo} disabled={!podeAtual} onChange={(v) => void patchAtual({ imprimirLogo: v })} />
                </div>
                <ReciboPreview
                  config={atual.config}
                  nomeLoja={atual.nomeLoja}
                  logoUrl={atual.logoUrl}
                  cols={(() => {
                    const imp = atual.impressoras.find((i) => i.id === atualImpressoraId) ?? atual.impressoras.find((i) => i.ativa) ?? atual.impressoras[0]
                    return colsParaFontePreview(imp?.tamanhoFonte, imp?.largura ?? 48)
                  })()}
                />
              </div>
            )}
          </div>
        </div>
      </Secao>

      {/* 5. Teste e calibração */}
      <Secao n={5} titulo="Teste e calibração">
        {!liberado || dispositivosAtivos.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-text-subtle">
            {liberado ? 'Pareie um computador com o Assistente Beta para testar e calibrar as impressoras dele.' : 'O teste do Assistente atual fica no próprio programa, no botão “Imprimir teste”.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {dispositivosAtivos.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-text-main">{nomeDisp(d)}</p>
                  <p className="text-[12px] text-text-subtle">
                    {d.larguraPontos ? `Calibrada: ${d.larguraPontos} pontos${d.calibradoPorNome ? ` · por ${d.calibradoPorNome}` : ''} · ${quando(d.calibradoEm)}` : `Papel ${d.larguraMm} mm · padrão`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={ocupado}
                  data-testid={`testar-${d.nomeSistema}`}
                  onClick={() => void agir(`/api/admin/impressao/dispositivos/${d.id}`, 'POST', { acao: 'teste', chave: novaChave() }, `Teste enviado para ${nomeDisp(d)}.`)}
                  className="rounded-menuzia border-2 border-primary px-3 py-1.5 text-[12px] font-bold text-primary hover:bg-primary hover:text-white disabled:opacity-40"
                >
                  {d.funcoes.includes('caixa') ? 'Testar Recibo/Extrato' : 'Imprimir teste'}
                </button>
                <button
                  type="button"
                  disabled={ocupado}
                  data-testid={`calibrar-${d.nomeSistema}`}
                  onClick={() => setCalibrar(d.id)}
                  className="rounded-menuzia bg-sidebar-bg px-3 py-1.5 text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-40"
                >
                  Calibrar
                </button>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {/* 6. Histórico */}
      <Secao n={6} titulo="Histórico recente">
        <p className="px-4 pt-3 text-[12px] text-text-subtle">{AVISO_PAPEL}</p>
        {p && p.trabalhos.length === 0 && <p className="px-4 py-4 text-[13px] text-text-subtle">Nenhum Recibo/Extrato ou teste ainda.</p>}
        <ul className="divide-y divide-border" data-testid="historico-impressao">
          {p?.trabalhos.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[12px]">
              <span className="text-text-subtle">{quando(t.criadoEm)}</span>
              <span className="font-semibold text-text-main">{ROTULO_TIPO_TRABALHO[t.tipo] ?? t.tipo}{t.tipo === 'pre_conta' ? ` · ${t.via}ª via` : ''}</span>
              <span className="min-w-0 flex-1 text-text-main">{t.impressora} · por {t.criadoPorNome}</span>
              <Badge tone={TOM_ESTADO_IMPRESSAO[t.estado] ?? 'alert'}>{ROTULO_ESTADO_IMPRESSAO[t.estado] ?? t.estado}</Badge>
              {t.erro && <span className="w-full text-danger">{t.erro}</span>}
            </li>
          ))}
        </ul>
      </Secao>

      {/* 7. Diagnóstico e ajuda */}
      <Secao n={7} titulo="Diagnóstico e ajuda" acao={<button type="button" onClick={() => setAjuda(true)} className="text-[12px] font-semibold text-primary hover:underline">Como funciona</button>}>
        <div className="space-y-2 p-4">
          {liberado &&
            dispositivosAtivos.map((d) => {
              const g = (d.diagnostico ?? {}) as Record<string, string | number | boolean | undefined>
              const linhas: [string, string][] = [
                ['Driver', String(g.driver ?? '—')],
                ['Porta', String(g.porta ?? '—')],
                ['DPI', g.dpiX ? `${g.dpiX} x ${g.dpiY ?? '—'}` : '—'],
                ['Papel (Windows)', g.papelLarguraMm ? `${g.papelLarguraMm} mm` : '—'],
                ['Área imprimível', g.areaImprimivelLarguraMm ? `${g.areaImprimivelLarguraMm} mm` : '—'],
                ['Margem esq./dir.', g.margemEsquerdaMm !== undefined ? `${g.margemEsquerdaMm} / ${g.margemDireitaMm ?? '—'} mm` : '—'],
                ['Pontos imprimíveis', g.pontosImprimiveis ? String(g.pontosImprimiveis) : '—'],
                ['Largura aplicada', `${d.larguraPontos ?? (d.larguraMm === 58 ? 384 : 576)} pontos${d.larguraPontos ? ' (calibrada)' : ' (padrão)'}`],
                ['Deslocamento', `${d.deslocamentoPontos} pontos`],
              ]
              return (
                <details key={d.id} className="rounded-menuzia border border-border">
                  <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-text-main">
                    {nomeDisp(d)} <span className="font-normal text-text-subtle">· {agentePor(d.agenteId)?.nome ?? '—'}</span>
                  </summary>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-[12px] min-[400px]:grid-cols-2">
                    {linhas.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <dt className="text-text-subtle">{k}</dt>
                        <dd className="text-right font-semibold text-text-main">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {d.ultimoErro && <p className="border-t border-border px-3 py-2 text-[12px] text-danger">Último erro ({quando(d.ultimoErroEm)}): {d.ultimoErro}</p>}
                </details>
              )
            })}
          <ul className="list-disc space-y-1 pl-5 text-[12px] text-text-subtle">
            <li>Papel não saiu? Veja se tem papel, se a tampa está fechada e se a impressora está ligada e online.</li>
            <li>Fila do Windows travada: em “Impressoras e scanners”, abra a impressora e cancele os documentos parados.</li>
            <li>
              Primeira instalação:{' '}
              <a href="/guia-impressora.html" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">guia passo a passo</a>.
            </li>
          </ul>
        </div>
      </Secao>

      {/* ── janelas ─────────────────────────────────────────────────────────── */}
      <ModalAjudaImpressao aberto={ajuda} onFechar={() => setAjuda(false)} />

      {compartilhar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-menuzia bg-white p-4 shadow-xl">
            <h2 className="text-[15px] font-bold text-text-main">Usar a mesma impressora nas duas funções?</h2>
            <p className="mt-2 text-[13px] text-text-main">{compartilhar.texto}</p>
            <p className="mt-2 text-[12px] text-text-subtle">Os pedidos da cozinha e o Recibo/Extrato vão sair no mesmo papel.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setCompartilhar(null)} className="flex-1 rounded-menuzia border border-border py-2.5 text-[13px] font-semibold">Cancelar</button>
              <button
                type="button"
                data-testid="confirmar-compartilhada"
                onClick={async () => {
                  const c = compartilhar
                  setCompartilhar(null)
                  await atribuir(c.funcao, c.dispositivoId, true)
                }}
                className="flex-[2] rounded-menuzia bg-primary py-2.5 text-[13px] font-bold text-white"
              >
                Confirmo: usar nas duas
              </button>
            </div>
          </div>
        </div>
      )}

      {trocarModo && p && (
        <ConfirmarModo
          de={p.modo}
          para={trocarModo}
          temCozinha={!!p.funcoes.cozinha}
          ocupado={ocupado}
          onCancelar={() => setTrocarModo(null)}
          onConfirmar={async () => {
            const m = trocarModo
            const r = await agir('/api/admin/impressao/modo', 'PUT', { modo: m }, `Modo alterado para “${ROTULO_MODO_BETA[m]}”.`)
            if (r?.ok) setTrocarModo(null)
          }}
        />
      )}

      {dCalibrar && (
        <Calibracao
          d={dCalibrar}
          ocupado={ocupado}
          agir={agir}
          onFechar={() => setCalibrar(null)}
        />
      )}

      {modalImpressora && <ImpressoraModal initial={modalImpressora.input} onClose={() => setModalImpressora(null)} onSave={salvarImpressoraAtual} />}
    </div>
  )
}

// ─── troca de modo com confirmação explícita ────────────────────────────────

function ConfirmarModo({
  de,
  para,
  temCozinha,
  ocupado,
  onCancelar,
  onConfirmar,
}: {
  de: ModoBeta
  para: ModoBeta
  temCozinha: boolean
  ocupado: boolean
  onCancelar: () => void
  onConfirmar: () => void
}) {
  const [entendi, setEntendi] = useState(false)
  const assumeCozinha = para === 'cozinha_caixa'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" data-testid="confirmar-modo">
      <div className="w-full max-w-md rounded-t-[12px] bg-white p-4 shadow-xl sm:rounded-menuzia">
        <h2 className="text-[15px] font-bold text-text-main">
          Mudar de “{ROTULO_MODO_BETA[de]}” para “{ROTULO_MODO_BETA[para]}”?
        </h2>
        <p className="mt-2 text-[13px] text-text-main">{DESCRICAO_MODO[para]}</p>
        {assumeCozinha && (
          <>
            {!temCozinha && <p className="mt-2 rounded-menuzia bg-warn-bg px-3 py-2 text-[12px] text-text-main">Escolha antes a impressora da Cozinha.</p>}
            <p className="mt-2 text-[12px] text-text-subtle">
              A troca é imediata e sem pedido em dobro: pedidos novos saem só no Beta. Pedidos que o Assistente atual já estava imprimindo terminam nele.
            </p>
            <label className="mt-3 flex items-start gap-2 text-[13px] text-text-main">
              <input type="checkbox" checked={entendi} onChange={(e) => setEntendi(e.target.checked)} className="mt-0.5" data-testid="confirmar-cozinha-beta" />
              Testei a impressora da Cozinha no Beta e quero que ela imprima os pedidos a partir de agora.
            </label>
          </>
        )}
        {para === 'teste' && <p className="mt-2 text-[12px] text-text-subtle">A cozinha volta na hora para o Assistente atual. Nenhum pedido se perde.</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancelar} className="flex-1 rounded-menuzia border border-border py-2.5 text-[13px] font-semibold">Cancelar</button>
          <button
            type="button"
            disabled={ocupado || (assumeCozinha && (!entendi || !temCozinha))}
            onClick={onConfirmar}
            data-testid="confirmar-modo-ok"
            className="flex-[2] rounded-menuzia bg-primary py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── assistente de calibração (por impressora) ──────────────────────────────

type PassoCalibracao = 'papel' | 'imprimir' | 'conferir' | 'numero' | 'pronto'

function Calibracao({
  d,
  ocupado,
  agir,
  onFechar,
}: {
  d: DispositivoVisao
  ocupado: boolean
  agir: (url: string, metodo: string, corpo: unknown, sucesso: string) => Promise<{ ok: boolean } | null>
  onFechar: () => void
}) {
  const [passo, setPasso] = useState<PassoCalibracao>('papel')
  const [largura, setLargura] = useState<string>(d.larguraPontos ? String(d.larguraPontos) : '')
  const [desloc, setDesloc] = useState<string>(String(d.deslocamentoPontos ?? 0))
  const url = `/api/admin/impressao/dispositivos/${d.id}`
  const nome = d.apelido || d.nomeSistema
  // Números da régua (o último que aparece inteiro = largura que o papel mostra).
  const opcoes = d.larguraMm === 58 ? [320, 256] : [512, 448, 384, 320]

  async function imprimir() {
    const r = await agir(url, 'POST', { acao: 'calibracao', chave: novaChave() }, `Página de calibração enviada para ${nome}.`)
    if (r?.ok) setPasso('conferir')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" data-testid="calibracao">
      <div className="flex max-h-full w-full flex-col bg-white shadow-xl sm:max-h-[88vh] sm:max-w-lg sm:rounded-menuzia">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-bold text-text-main">Calibrar {nome}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="flex h-[36px] w-[36px] items-center justify-center rounded-menuzia bg-page text-[20px] text-text-subtle hover:bg-border">×</button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[13px] text-text-main">
          {passo === 'papel' && (
            <>
              <p className="font-semibold">1. Qual bobina está nesta impressora?</p>
              <div className="grid grid-cols-2 gap-2">
                {([80, 58] as const).map((mm) => (
                  <button
                    key={mm}
                    type="button"
                    disabled={ocupado}
                    onClick={async () => {
                      if (mm !== d.larguraMm) await agir(url, 'PATCH', { larguraMm: mm }, `Papel ${mm} mm salvo.`)
                      setPasso('imprimir')
                    }}
                    className={['rounded-menuzia border-2 py-4 text-[15px] font-bold', mm === d.larguraMm ? 'border-primary bg-alert-bg/50' : 'border-border'].join(' ')}
                  >
                    {mm} mm
                  </button>
                ))}
              </div>
            </>
          )}
          {passo === 'imprimir' && (
            <>
              <p className="font-semibold">2. Imprima a página de calibração</p>
              <p className="text-text-subtle">Ela tem uma régua numerada, uma barra preta em cada lado, textos e valores em reais.</p>
              <button type="button" disabled={ocupado} onClick={() => void imprimir()} data-testid="imprimir-calibracao" className="w-full rounded-menuzia bg-primary py-3 text-[13px] font-bold text-white disabled:opacity-40">
                Imprimir página de calibração
              </button>
            </>
          )}
          {passo === 'conferir' && (
            <>
              <p className="font-semibold">3. Olhe o papel</p>
              <p className="text-text-subtle">As duas barras pretas (esquerda e direita) e o valor do TOTAL apareceram inteiros?</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setPasso('pronto')} className="rounded-menuzia border-2 border-status-ready py-3 font-bold text-status-ready">Sim, tudo inteiro</button>
                <button type="button" onClick={() => setPasso('numero')} data-testid="calibracao-cortou" className="rounded-menuzia border-2 border-danger py-3 font-bold text-danger">Não, a direita cortou</button>
              </div>
              <p className="text-[12px] text-text-subtle">Não saiu nada? Veja o papel, a tampa e se a impressora está ligada.</p>
            </>
          )}
          {passo === 'numero' && (
            <>
              <p className="font-semibold">4. Qual o último número que aparece inteiro à direita da régua?</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {opcoes.map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={ocupado}
                    data-testid={`calibracao-numero-${n}`}
                    onClick={async () => {
                      const r = await agir(url, 'PATCH', { larguraPontos: n, deslocamentoPontos: 0 }, `${nome}: largura ajustada para ${n} pontos.`)
                      if (r?.ok) {
                        setLargura(String(n))
                        setPasso('imprimir')
                      }
                    }}
                    className="rounded-menuzia border-2 border-border py-3 text-[16px] font-bold hover:border-primary"
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-text-subtle">Só esta impressora muda. Depois imprima de novo para conferir.</p>
            </>
          )}
          {passo === 'pronto' && (
            <p className="rounded-menuzia bg-price-bg px-3 py-2 font-semibold text-price-text">
              Pronto. {d.larguraPontos ? `${nome} imprime com ${d.larguraPontos} pontos de largura.` : `${nome} imprime no padrão do papel de ${d.larguraMm} mm.`}
            </p>
          )}

          <details className="rounded-menuzia border border-border">
            <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-text-subtle">Ajuste avançado</summary>
            <div className="space-y-2 border-t border-border px-3 py-3">
              <label className="block text-[12px]">
                Largura em pontos (256 a 832; vazio = padrão do papel)
                <input value={largura} onChange={(e) => setLargura(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="mt-1 w-full rounded-menuzia border border-border px-3 py-2 text-[13px]" />
              </label>
              <label className="block text-[12px]">
                Deslocamento em pontos (−64 a 64; positivo empurra para a direita)
                <input value={desloc} onChange={(e) => setDesloc(e.target.value.replace(/[^\d-]/g, ''))} inputMode="numeric" className="mt-1 w-full rounded-menuzia border border-border px-3 py-2 text-[13px]" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => void agir(url, 'PATCH', { larguraPontos: largura ? Number(largura) : null, deslocamentoPontos: Number(desloc) || 0 }, 'Ajuste salvo.')}
                  className="rounded-menuzia bg-primary px-3 py-2 text-[12px] font-bold text-white disabled:opacity-40"
                >
                  Salvar ajuste
                </button>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={async () => {
                    const r = await agir(url, 'PATCH', { larguraPontos: null, deslocamentoPontos: 0 }, 'Voltou ao padrão do papel.')
                    if (r?.ok) {
                      setLargura('')
                      setDesloc('0')
                    }
                  }}
                  className="rounded-menuzia border border-border px-3 py-2 text-[12px] font-semibold"
                >
                  Voltar ao padrão
                </button>
              </div>
            </div>
          </details>
        </div>
        <div className="border-t border-border px-4 py-3">
          <button type="button" onClick={onFechar} className="w-full rounded-menuzia border border-border py-2.5 text-[13px] font-semibold">Fechar</button>
        </div>
      </div>
    </div>
  )
}
