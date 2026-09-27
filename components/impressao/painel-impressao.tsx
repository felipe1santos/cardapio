'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, History, Info } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { chamar, novaChave } from '@/components/pdv/util'
import { ModalAjudaImpressao } from '@/components/impressao/ajuda-impressao'
import { ImpressoraModal } from '@/components/impressao/documentos'
import { AssistenteAntigo, FichaCozinha, type AssistenteAtual } from '@/components/impressao/assistente-antigo'
import {
  AjudaDiagnostico, CartaoAssistente, CartaoImpressoras, CartaoModo, CartaoTestes, ModalImpressoras, ModalModos, ModalPareamento, ModalTeste,
  avaliar, nomeDisp, type PainelDados, type TipoTeste,
} from '@/components/impressao/beta-cards'
import { ROTULO_MODO_BETA } from '@/lib/impressao/rotulos'
import { modoDependeDoAgente } from '@/lib/impressao/regras-modo'
import type { AgenteVisao, DispositivoVisao, Funcao, ModoBeta } from '@/lib/impressao/servico'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { garantirLogoImpressao } from '@/lib/impressao/logo-navegador'
import {
  atualizarConfigImpressao,
  atualizarImpressora,
  buscarConfigImpressao,
  buscarStatusAgente,
  criarImpressora,
  listarImpressoras,
  removerImpressora,
  type ConfigImpressao,
  type ImpressoraInput,
} from '@/lib/queries/impressao'

/**
 * Impressão — tela do cliente final, focada no Assistente Beta (2026-09-27):
 *   1. Assistente (status, baixar, parear em pop-up)  2. Impressoras (escolha em pop-up)
 *   3. Modo (real só com impressoras válidas — a mesma regra do servidor)  4. Testes
 *   · Ajuda e diagnóstico recolhidos · opções da ficha da cozinha recolhidas.
 * O Assistente antigo (0.1.23, token) fica atrás do botão "Assistente antigo", igual por
 * dentro. A escolha da visão é só do navegador (localStorage). Nenhuma credencial aparece;
 * o código de pareamento vence em 10 min.
 */

const CHAVE_VISAO = 'menuzia.impressao.visao'

const DESCRICAO_MODO: Record<ModoBeta, string> = {
  teste: 'Só calibração e teste. Não imprime pedido real — o Assistente atual continua com tudo.',
  caixa: 'Imprime o Recibo/Extrato no Caixa. A cozinha continua saindo pelo Assistente atual.',
  cozinha_caixa: 'A cozinha sai na impressora da Cozinha e o Recibo/Extrato no Caixa. O Assistente atual para de imprimir pedidos.',
}

const MOTIVO_RECUO = 'O modo voltou para a segurança porque a impressora que ele usava deixou de valer.'

export function PainelImpressao() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [p, setP] = useState<PainelDados | null>(null)
  const [atual, setAtual] = useState<AssistenteAtual | null>(null)
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [atualVistoEm, setAtualVistoEm] = useState<string | null>(null)
  const [atualImpressoraId, setAtualImpressoraId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tom: 'ok' | 'erro' | 'alerta'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [visao, setVisao] = useState<'novo' | 'antigo'>('novo')
  const [pareando, setPareando] = useState<{ codigo: { codigo: string; expiraEm: string } | null; erro: string | null; antes: string[]; conectado: string | null } | null>(null)
  const [escolhendo, setEscolhendo] = useState(false)
  const [verModos, setVerModos] = useState(false)
  const [teste, setTeste] = useState<TipoTeste | null>(null)
  const [ajuda, setAjuda] = useState(false)
  const [trocarModo, setTrocarModo] = useState<ModoBeta | null>(null)
  const [calibrar, setCalibrar] = useState<string | null>(null)
  const [modalImpressora, setModalImpressora] = useState<{ id: string | null; input: ImpressoraInput } | null>(null)
  const [logoRecibo, setLogoRecibo] = useState<'pronta' | 'gerada' | 'sem_logo' | 'falhou' | null>(null)
  const seq = useRef(0)
  // Uma chave por impressora e por teste: clique duplo ou reenvio devolve o mesmo trabalho.
  const chavesTeste = useRef<Record<string, string>>({})

  useEffect(() => {
    try {
      if (localStorage.getItem(CHAVE_VISAO) === 'antigo') setVisao('antigo')
    } catch {
      /* navegador sem armazenamento: fica na visão nova */
    }
  }, [])
  function trocarVisao(v: 'novo' | 'antigo') {
    setVisao(v)
    try {
      localStorage.setItem(CHAVE_VISAO, v)
    } catch {
      /* só preferência */
    }
  }

  const carregar = useCallback(async () => {
    const minha = ++seq.current
    const r = await chamar<PainelDados>('/api/admin/impressao/painel')
    if (minha !== seq.current) return
    if (!r.ok || !r.dados) return setErro(r.erro)
    setErro(null)
    setP(r.dados)
  }, [])

  // Pareando: confere a cada 2 s se o computador já entrou; fora disso, a cada 5 s.
  const pareandoAberto = !!pareando && !pareando.conectado
  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), pareandoAberto ? 2000 : 5000)
    return () => clearInterval(t)
  }, [carregar, pareandoAberto])

  useEffect(() => {
    if (!pareando || pareando.conectado || !p) return
    const novo = p.agentes.find((a) => !a.revogado && !pareando.antes.includes(a.id))
    if (novo) setPareando({ ...pareando, conectado: novo.nome })
  }, [p, pareando])
  useEffect(() => {
    if (!pareando?.conectado) return
    const t = setTimeout(() => setPareando(null), 2500)
    return () => clearTimeout(t)
  }, [pareando?.conectado])

  // Assistente antigo: configuração da loja e o token (só o dono lê).
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
        if (vivo) setErro('Não foi possível carregar a configuração do Assistente antigo.')
      }
    })()
    return () => {
      vivo = false
    }
  }, [supabase])

  // Logo do Recibo/Extrato do Beta: o navegador prepara a versão de impressão (PNG, fundo branco).
  const logoUrlAtual = atual?.logoUrl ?? null
  const liberado = p?.betaLiberado === true
  useEffect(() => {
    if (!liberado) return
    if (!logoUrlAtual) return setLogoRecibo('sem_logo')
    let vivo = true
    void garantirLogoImpressao(logoUrlAtual).then((r) => vivo && setLogoRecibo(r))
    return () => {
      vivo = false
    }
  }, [liberado, logoUrlAtual])

  // Sinal do Assistente antigo (heartbeat a cada 5 s).
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
    const t = setTimeout(() => setAviso(null), 7000)
    return () => clearTimeout(t)
  }, [aviso])

  async function agir(url: string, metodo: string, corpo: unknown, sucesso: string) {
    if (ocupado) return null
    setOcupado(true)
    const r = await chamar<{ modoRecuou?: ModoBeta | null }>(url, { method: metodo, body: JSON.stringify(corpo) })
    setOcupado(false)
    if (!r.ok) setAviso({ tom: 'erro', texto: r.erro ?? 'Não foi possível.' })
    else if (r.dados?.modoRecuou) setAviso({ tom: 'alerta', texto: `${sucesso} ${MOTIVO_RECUO} Modo agora: ${ROTULO_MODO_BETA[r.dados.modoRecuou]}.` })
    else setAviso({ tom: 'ok', texto: sucesso })
    await carregar()
    return r
  }

  async function abrirPareamento() {
    setPareando({ codigo: null, erro: null, antes: (p?.agentes ?? []).map((a) => a.id), conectado: null })
    const r = await chamar<{ codigo: string; expiraEm: string }>('/api/admin/impressao/pareamento', { method: 'POST' })
    setPareando((x) => (x ? { ...x, codigo: r.ok && r.dados ? r.dados : null, erro: r.ok ? null : r.erro ?? 'Não foi possível gerar o código.' } : x))
  }

  async function salvarImpressoras(novo: Record<Funcao, string | null>) {
    if (!p || ocupado) return
    setOcupado(true)
    let recuo: ModoBeta | null = null
    let falhou: string | null = null
    // Primeiro quem ganha impressora, depois quem fica sem: o modo não recua à toa no meio.
    const ordem = (['caixa', 'cozinha'] as Funcao[]).filter((f) => novo[f] !== p.funcoes[f]).sort((a, b) => Number(novo[a] === null) - Number(novo[b] === null))
    for (const f of ordem) {
      const r = await chamar<{ modoRecuou?: ModoBeta | null }>('/api/admin/impressao/funcoes', { method: 'PUT', body: JSON.stringify({ funcao: f, dispositivoId: novo[f], confirmarCompartilhada: true }) })
      if (!r.ok) {
        falhou = r.erro ?? 'Não foi possível salvar.'
        break
      }
      if (r.dados?.modoRecuou) recuo = r.dados.modoRecuou
    }
    setOcupado(false)
    await carregar()
    if (falhou) return setAviso({ tom: 'erro', texto: falhou })
    setEscolhendo(false)
    setAviso(recuo ? { tom: 'alerta', texto: `Impressoras salvas. ${MOTIVO_RECUO} Modo agora: ${ROTULO_MODO_BETA[recuo]}.` } : { tom: 'ok', texto: 'Impressoras salvas.' })
  }

  async function ajustar(d: DispositivoVisao, patch: { apelido?: string; larguraMm?: number }) {
    await agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', patch, patch.apelido !== undefined ? 'Apelido salvo.' : 'Papel salvo.')
  }

  function revogar(a: AgenteVisao) {
    if (!p) return
    const emUso = modoDependeDoAgente(p.modo, a.id, p.dispositivos.map((d) => ({ id: d.id, agenteId: d.agenteId, nomeSistema: d.nomeSistema })), p.funcoes)
    const texto = emUso
      ? `"${a.nome}" imprime no modo "${ROTULO_MODO_BETA[p.modo]}". Ao desconectar, a loja volta para "Somente teste" na hora e a cozinha volta para o Assistente antigo. Desconectar?`
      : `Desconectar "${a.nome}"? Ele para de imprimir na hora e precisa ser pareado de novo.`
    if (confirm(texto)) void agir(`/api/admin/impressao/agentes/${a.id}`, 'POST', { acao: 'revogar' }, 'Computador desconectado.')
  }

  function renomear(a: AgenteVisao) {
    const nome = prompt('Nome do computador', a.nome)?.trim()
    if (nome) void agir(`/api/admin/impressao/agentes/${a.id}`, 'PATCH', { nome }, 'Computador renomeado.')
  }

  async function testar(d: DispositivoVisao) {
    if (teste === 'calibrar') {
      setTeste(null)
      setCalibrar(d.id)
      return
    }
    const acao = teste === 'recibo' ? 'recibo_teste' : 'teste'
    const k = `${acao}:${d.id}`
    chavesTeste.current[k] ??= novaChave()
    const r = await agir(`/api/admin/impressao/dispositivos/${d.id}`, 'POST', { acao, chave: chavesTeste.current[k] }, `${teste === 'recibo' ? 'Recibo/Extrato de teste' : 'Página de teste'} enviado para ${nomeDisp(d)}.`)
    if (r?.ok) {
      delete chavesTeste.current[k]
      setTeste(null)
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
    if (token && !confirm('Gerar um token novo? O Assistente antigo para de imprimir até você colar o token novo nele.')) return
    const res = await fetch('/api/admin/impressao/token', { method: 'POST' }).catch(() => null)
    if (!res?.ok) return setAviso({ tom: 'erro', texto: 'Não foi possível gerar o token.' })
    setToken(((await res.json()) as { token: string }).token)
  }

  async function salvarImpressoraAntiga(input: ImpressoraInput) {
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

  async function removerImpressoraAntiga(id: string) {
    if (!atual || !confirm('Remover esta impressora do Assistente antigo?')) return
    try {
      await removerImpressora(supabase, id)
      setAtual({ ...atual, impressoras: atual.impressoras.filter((i) => i.id !== id) })
    } catch {
      setAviso({ tom: 'erro', texto: 'Não foi possível remover a impressora.' })
    }
  }

  const atualOnline = !!atualVistoEm && Date.now() - new Date(atualVistoEm).getTime() < 2 * 60_000
  const dCalibrar = p?.dispositivos.find((d) => d.id === calibrar) ?? null
  const cozinhaNoBeta = p?.modo === 'cozinha_caixa'
  const av = p ? avaliar(p) : null
  // Modo real ligado, mas hoje ele não tem o que precisa (ex.: PC da impressora sem sinal).
  const modoEmRisco = p && av && p.modo !== 'teste' && !av.modos[p.modo].ok ? av.modos[p.modo].motivo : null

  return (
    // O <main> do painel não rola (overflow-hidden): cada página tem o próprio contêiner.
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <TopBar
        title="Impressão"
        breadcrumb="Cozinha e Recibo/Extrato"
        right={
          <button
            type="button"
            onClick={() => trocarVisao(visao === 'novo' ? 'antigo' : 'novo')}
            data-testid="alternar-visao"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-[var(--adm-borda)] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[var(--adm-texto)] hover:border-[#0688D4] hover:text-[#0688D4]"
          >
            <History className="h-4 w-4" /> {visao === 'novo' ? 'Assistente antigo' : 'Usar novo Assistente'}
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="impressao-rolagem">
        <div className="mx-auto w-full min-w-0 max-w-5xl space-y-4 p-4 pb-16" data-testid="painel-impressao">
          <p className="text-[13px] text-[var(--adm-texto-suave)]">Configure onde saem os pedidos da cozinha e o Recibo/Extrato do caixa.</p>

          {aviso && (
            <p role="status" data-testid="impressao-aviso" className={['rounded-[6px] px-3 py-2 text-[12.5px] font-semibold', aviso.tom === 'ok' ? 'bg-[#DCFCE7] text-[#166534]' : aviso.tom === 'alerta' ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#FEE2E2] text-[#B91C1C]'].join(' ')}>
              {aviso.texto}
            </p>
          )}
          {erro && <p className="rounded-[6px] bg-[#FEE2E2] px-3 py-2 text-[13px] text-[#B91C1C]">{erro}</p>}

          {visao === 'antigo' ? (
            <AssistenteAntigo
              atual={atual}
              token={token}
              vistoEm={atualVistoEm}
              online={atualOnline}
              impressoraEmUsoId={atualImpressoraId}
              cozinhaNoBeta={cozinhaNoBeta}
              onVoltar={() => trocarVisao('novo')}
              onPatch={(x) => void patchAtual(x)}
              onGerarToken={() => void gerarToken()}
              onEditarImpressora={(id, input) => setModalImpressora({ id, input })}
              onRemoverImpressora={(id) => void removerImpressoraAntiga(id)}
            />
          ) : !p ? (
            <div className="space-y-3" aria-busy="true">
              {[0, 1, 2].map((i) => <div key={i} className="h-[150px] animate-pulse rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white" />)}
            </div>
          ) : (
            <>
              {/* Onde a cozinha está saindo agora — para ninguém achar que a impressão parou. */}
              <p className="flex items-start gap-2 rounded-[6px] bg-[#F8FAFC] px-3 py-2 text-[12.5px] text-[var(--adm-texto-medio)]" data-testid="onde-sai-cozinha">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#0688D4]" />
                {cozinhaNoBeta
                  ? 'A cozinha está saindo pelo Assistente Beta.'
                  : `A cozinha está saindo pelo Assistente antigo${atual && !atual.config.ativarAssistente ? ' (desativado)' : atualOnline ? ' (imprimindo agora)' : ''}. O Recibo/Extrato do PDV ${p.modo === 'teste' ? 'fica desligado em “Somente teste”' : 'sai pelo Beta'}.`}
              </p>
              {modoEmRisco && (
                <p className="flex items-start gap-2 rounded-[6px] bg-[#FEF3C7] px-3 py-2 text-[12.5px] font-semibold text-[#92400E]" data-testid="modo-em-risco">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {modoEmRisco}. Enquanto isso, o Recibo/Extrato do PDV pode não sair.
                </p>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <CartaoAssistente p={p} ocupado={ocupado} onParear={() => void abrirPareamento()} onRevogar={revogar} onRenomear={renomear} />
                <CartaoImpressoras p={p} onEscolher={() => setEscolhendo(true)} />
              </div>
              <CartaoModo p={p} ocupado={ocupado} onEscolher={(m) => setTrocarModo(m)} onAjuda={() => setVerModos(true)} />
              <CartaoTestes p={p} ocupado={ocupado} logoRecibo={logoRecibo} onTestar={(t) => setTeste(t)} />
              {atual && <FichaCozinha atual={atual} pode={atual.podeEditar} impressoraEmUsoId={atualImpressoraId} onPatch={(x) => void patchAtual(x)} />}
              <AjudaDiagnostico p={p} onAjudaCompleta={() => setAjuda(true)} />
            </>
          )}

          {/* ── janelas ─────────────────────────────────────────────────────────── */}
          <ModalAjudaImpressao aberto={ajuda} onFechar={() => setAjuda(false)} />
          {pareando && (
            <ModalPareamento
              codigo={pareando.codigo}
              erro={pareando.erro}
              conectado={pareando.conectado}
              onGerarOutro={() => void abrirPareamento()}
              onFechar={() => setPareando(null)}
            />
          )}
          {escolhendo && p && <ModalImpressoras p={p} ocupado={ocupado} onSalvar={salvarImpressoras} onAjustar={ajustar} onFechar={() => setEscolhendo(false)} />}
          {verModos && <ModalModos onFechar={() => setVerModos(false)} />}
          {teste && p && <ModalTeste tipo={teste} p={p} ocupado={ocupado} onConfirmar={(d) => void testar(d)} onFechar={() => setTeste(null)} />}
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
          {dCalibrar && <Calibracao d={dCalibrar} ocupado={ocupado} agir={agir} onFechar={() => setCalibrar(null)} />}
          {modalImpressora && <ImpressoraModal initial={modalImpressora.input} onClose={() => setModalImpressora(null)} onSave={salvarImpressoraAntiga} />}
        </div>
      </div>
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
