'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChefHat, Circle, Download, Eye, FlaskConical, Link2, Printer, ReceiptText, Settings2, Sparkles } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { chamar, novaChave } from '@/components/pdv/util'
import { ModalAjudaImpressao } from '@/components/impressao/ajuda-impressao'
import { ImpressoraModal } from '@/components/impressao/documentos'
import { EnvioImpressora } from '@/components/impressao/envio-impressora'
import { AssistenteAntigo, type AssistenteAtual } from '@/components/impressao/assistente-antigo'
import { ModalPrevia, type DocPrevia, type LojaPrevia, type PapelPrevia } from '@/components/impressao/modal-previa'
import {
  AjudaDiagnostico, type TamanhoLetra, TAMANHOS_LETRA, EtapaConectar, EtapaImpressoras, ModalImpressoras, ModalPareamento, ModalTestes,
  nomeDisp, type PainelDados, type ResultadoTeste, type TipoTeste,
} from '@/components/impressao/beta-cards'
import { Aviso, Card, FIN_BTN, FIN_COR, SeloMeta } from '@/components/graficos/kit-meta'
import { ModalCentral, NoTopo } from '@/components/ui/flutuante'
import { ROTULO_MODO_BETA, DOWNLOAD_ASSISTENTE_ATUAL, DOWNLOAD_ASSISTENTE_BETA } from '@/lib/impressao/rotulos'
import { modoDependeDoAgente } from '@/lib/impressao/regras-modo'
import { CONFIRMACAO_OPCAO, MODO_DA_OPCAO, TEXTO_OPCAO, opcaoDaLoja, prontidaoBeta, situacaoAntigo, situacaoBeta, type AcaoSituacao, type OpcaoImpressao, type Sinal, type Situacao } from '@/lib/impressao/opcao'
import { VERSAO_IMPRESSAO_V3 } from '@/lib/avisos-painel'
import { SUPORTE_MENUZIA } from '@/lib/suporte'
import ReciboAntigo from '@/lib/impressao/recibo-antigo-canvas.js'
import type { AgenteVisao, DispositivoVisao, Funcao, ModoBeta } from '@/lib/impressao/servico'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { garantirLogoImpressao } from '@/lib/impressao/logo-navegador'
import {
  atualizarConfigImpressao, atualizarImpressora, buscarConfigImpressao, buscarStatusAgente, criarImpressora, listarImpressoras, removerImpressora,
  type ConfigImpressao, type ImpressoraInput,
} from '@/lib/queries/impressao'

/**
 * Impressão — tela nova (2026-10-05), no kit visual do Financeiro/Dashboard (.fin-meta):
 *   1. "Como sua loja imprime": DUAS opções lado a lado — Assistente antigo (padrão) ou
 *      Assistente Beta (novo). A opção é lida do modo que a loja já usa (lib/impressao/opcao):
 *      o deploy não muda ninguém. Trocar pede confirmação; o Beta só ativa com o passo a passo
 *      completo (instalado, conectado, impressora da Cozinha), para a loja não ficar sem papel.
 *   2. "Situação": Assistente, versão, impressoras e última impressão, com selos; se falta algo,
 *      UM aviso com UM botão.
 *   3. "Modelos": "Ver comanda / pré-conta / via da cozinha" abrem a prévia em janela, no
 *      tamanho do papel, com o MESMO desenho da impressora; "Imprimir teste".
 *   Configurações avançadas (recolhidas): computadores, impressoras, calibração com o passo a
 *   passo e envio direto, letra, opções da comanda e diagnóstico; no antigo, token e impressoras.
 * Nenhuma credencial aparece; o código de pareamento vence em 10 min.
 */

const MOTIVO_RECUO = 'O modo voltou para a segurança porque a impressora que ele usava deixou de valer.'
const PAPEL_PADRAO: PapelPrevia = { larguraMm: 80, larguraPontos: null, tamanhoFonte: 'grande', intensidade: 'normal' }
const papelDe = (d: DispositivoVisao | undefined): PapelPrevia => (d ? { larguraMm: d.larguraMm <= 58 ? 58 : 80, larguraPontos: d.larguraPontos, tamanhoFonte: d.tamanhoFonte, intensidade: d.intensidade } : PAPEL_PADRAO)
const TOM_SINAL: Record<Sinal, 'verde' | 'laranja' | 'vermelho'> = { ok: 'verde', atencao: 'laranja', erro: 'vermelho' }
const SUPORTE_WHATSAPP_URL = `https://wa.me/${SUPORTE_MENUZIA.whatsapp}?text=${encodeURIComponent('Olá! Quero liberar o Assistente Beta (impressão nova) na minha loja.')}`
const ROTULO_SINAL: Record<Sinal, string> = { ok: 'Tudo certo', atencao: 'Atenção', erro: 'Precisa de ação' }

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
  const [pareando, setPareando] = useState<{ codigo: { codigo: string; expiraEm: string } | null; erro: string | null; antes: string[]; conectado: string | null } | null>(null)
  const [escolhendo, setEscolhendo] = useState(false)
  const [testando, setTestando] = useState(false)
  const [ajuda, setAjuda] = useState(false)
  const [calibrar, setCalibrar] = useState<string | null>(null)
  const [modalImpressora, setModalImpressora] = useState<{ id: string | null; input: ImpressoraInput } | null>(null)
  const [previa, setPrevia] = useState<DocPrevia | null>(null)
  const [dadosPrevia, setDadosPrevia] = useState<LojaPrevia | null>(null)
  const [trocar, setTrocar] = useState<OpcaoImpressao | null>(null)
  const [ativarBeta, setAtivarBeta] = useState(false)
  const [avancadoAberto, setAvancadoAberto] = useState(false)
  const [, setLogoRecibo] = useState<'pronta' | 'gerada' | 'sem_logo' | 'falhou' | null>(null)
  const seq = useRef(0)
  const chavesTeste = useRef<Record<string, string>>({})

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
    const t = setInterval(() => void carregar(), pareandoAberto || ativarBeta ? 2000 : 5000)
    return () => clearInterval(t)
  }, [carregar, pareandoAberto, ativarBeta])

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

  // Dados da loja para a prévia (nome, telefone, endereço, QR e logo).
  useEffect(() => {
    let vivo = true
    fetch('/api/admin/impressao/previa', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setDadosPrevia({ loja: j?.loja ?? { nome: '', telefone: '', endereco: '' }, qr: j?.qr ?? null, logoUrl: j?.logoUrl ?? null }) })
      .catch(() => { if (vivo) setDadosPrevia({ loja: { nome: '', telefone: '', endereco: '' }, qr: null, logoUrl: null }) })
    return () => { vivo = false }
  }, [])

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
    return () => { vivo = false }
  }, [supabase])

  // Logo do Recibo/Extrato do Beta: o navegador prepara a versão de impressão (PNG, fundo branco).
  const logoUrlAtual = atual?.logoUrl ?? null
  const liberado = p?.betaLiberado === true
  useEffect(() => {
    if (!liberado) return
    if (!logoUrlAtual) return setLogoRecibo('sem_logo')
    let vivo = true
    void garantirLogoImpressao(logoUrlAtual).then((r) => vivo && setLogoRecibo(r))
    return () => { vivo = false }
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
      } catch { /* sem sinal */ }
    }
    void checar()
    const t = setInterval(checar, 8000)
    return () => { vivo = false; clearInterval(t) }
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
      if (!r.ok) { falhou = r.erro ?? 'Não foi possível salvar.'; break }
      if (r.dados?.modoRecuou) recuo = r.dados.modoRecuou
    }
    setOcupado(false)
    await carregar()
    if (falhou) return setAviso({ tom: 'erro', texto: falhou })
    setEscolhendo(false)
    setAviso(recuo ? { tom: 'alerta', texto: `Impressoras salvas. ${MOTIVO_RECUO} Modo agora: ${ROTULO_MODO_BETA[recuo]}.` } : { tom: 'ok', texto: 'Impressoras salvas.' })
  }

  async function ajustar(d: DispositivoVisao, patch: { apelido?: string; larguraMm?: number; tamanhoFonte?: TamanhoLetra }) {
    await agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', patch, patch.apelido !== undefined ? 'Apelido salvo.' : patch.tamanhoFonte !== undefined ? 'Tamanho da letra salvo.' : 'Papel salvo.')
  }

  function revogar(a: AgenteVisao) {
    if (!p) return
    const emUso = modoDependeDoAgente(p.modo, a.id, p.dispositivos.map((d) => ({ id: d.id, agenteId: d.agenteId, nomeSistema: d.nomeSistema })), p.funcoes)
    const texto = emUso
      ? `"${a.nome}" imprime os pedidos pelo Assistente Beta. Ao desconectar, a loja volta na hora para o Assistente antigo. Desconectar?`
      : `Desconectar "${a.nome}"? Ele para de imprimir na hora e precisa ser pareado de novo.`
    if (confirm(texto)) void agir(`/api/admin/impressao/agentes/${a.id}`, 'POST', { acao: 'revogar' }, 'Computador desconectado.')
  }

  function renomear(a: AgenteVisao) {
    const nome = prompt('Nome do computador', a.nome)?.trim()
    if (nome) void agir(`/api/admin/impressao/agentes/${a.id}`, 'PATCH', { nome }, 'Computador renomeado.')
  }

  async function testar(tipo: TipoTeste, d: DispositivoVisao): Promise<ResultadoTeste> {
    if (tipo === 'calibrar') {
      setTestando(false)
      setCalibrar(d.id)
      return { ok: true }
    }
    const acao = tipo === 'recibo' ? 'recibo_teste' : 'cozinha_teste'
    const k = `${acao}:${d.id}`
    chavesTeste.current[k] ??= novaChave()
    const r = await chamar(`/api/admin/impressao/dispositivos/${d.id}`, { method: 'POST', body: JSON.stringify({ acao, chave: chavesTeste.current[k] }) })
    if (r.ok) delete chavesTeste.current[k]
    void carregar()
    return { ok: r.ok, erro: r.ok ? null : r.erro ?? 'Não foi possível enviar o teste.' }
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

  /** Troca de opção: auditada no banco (impressao_modo_definir). */
  async function confirmarTroca(o: OpcaoImpressao) {
    const r = await agir('/api/admin/impressao/modo', 'PUT', { modo: MODO_DA_OPCAO[o] }, o === 'beta' ? 'Pronto: a loja imprime pelo Assistente Beta.' : 'Pronto: a loja imprime pelo Assistente antigo.')
    if (r?.ok) { setTrocar(null); setAtivarBeta(false) }
  }

  const atualOnline = !!atualVistoEm && Date.now() - new Date(atualVistoEm).getTime() < 2 * 60_000
  const dCalibrar = p?.dispositivos.find((d) => d.id === calibrar) ?? null
  const opcao: OpcaoImpressao | null = p ? opcaoDaLoja(p.modo) : null
  const dCozinha = p?.dispositivos.find((d) => d.id === p.funcoes.cozinha)
  const dCaixa = p?.dispositivos.find((d) => d.id === p.funcoes.caixa)
  const impAntiga = atual ? (atual.impressoras.find((i) => i.id === atualImpressoraId) ?? atual.impressoras.find((i) => i.ativa) ?? atual.impressoras[0] ?? null) : null
  const larguraAntiga = impAntiga?.largura ?? 48
  const situacao: Situacao | null = !p || !opcao ? null : opcao === 'beta'
    ? situacaoBeta(p)
    : situacaoAntigo({ ativado: atual?.config.ativarAssistente !== false, vistoEm: atualVistoEm, online: atualOnline, impressora: impAntiga?.nome ?? null })
  const prontidao = p ? prontidaoBeta(p) : null
  const podeTestarBeta = !!p && p.agentes.some((a) => !a.revogado)

  function executar(acao: AcaoSituacao) {
    switch (acao) {
      case 'instalar_beta': setAtivarBeta(true); break
      case 'atualizar_beta': window.open(DOWNLOAD_ASSISTENTE_BETA.url, '_blank', 'noopener'); break
      case 'parear': void abrirPareamento(); break
      case 'escolher_impressoras': setEscolhendo(true); break
      case 'passar_comanda': setTrocar('beta'); break
      case 'liberar': window.open(SUPORTE_WHATSAPP_URL, '_blank', 'noopener'); break
      case 'instalar_antigo': window.open(DOWNLOAD_ASSISTENTE_ATUAL.url, '_blank', 'noopener'); break
      case 'ativar_antigo': void patchAtual({ ativarAssistente: true }); break
      case 'abrir_beta': case 'abrir_antigo': setAjuda(true); break
    }
  }

  function escolherOpcao(o: OpcaoImpressao) {
    if (!p || o === opcao) return
    if (o === 'beta' && !prontidao?.pronto) return setAtivarBeta(true)
    setTrocar(o)
  }

  return (
    // O <main> do painel não rola (overflow-hidden): cada página tem o próprio contêiner.
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <TopBar title="Impressão" breadcrumb="Comanda, pré-conta e impressoras" />
      <div className="fin-meta fin-fundo min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="impressao-rolagem">
        <div className="mx-auto w-full min-w-0 max-w-[1080px] space-y-4 p-4 pb-16 lg:p-6" data-testid="painel-impressao">
          {aviso && (
            <Aviso tipo={aviso.tom === 'ok' ? 'sucesso' : aviso.tom === 'alerta' ? 'atencao' : 'erro'} testid="impressao-aviso" onFechar={() => setAviso(null)}>
              <span className="font-semibold">{aviso.texto}</span>
            </Aviso>
          )}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}

          {!p || !opcao || !situacao ? (
            <div className="space-y-4" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="fin-card h-[150px] animate-pulse" />)}</div>
          ) : (
            <>
              {/* ── 1. Como sua loja imprime ─────────────────────────────────── */}
              <Card titulo="Como sua loja imprime" subtitulo="Escolha um dos dois. Você pode trocar quando quiser." testid="card-opcao">
                <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Como sua loja imprime">
                  {(['antigo', 'beta'] as OpcaoImpressao[]).map((o) => {
                    const ativo = opcao === o
                    return (
                      <button
                        key={o}
                        type="button"
                        role="radio"
                        aria-checked={ativo}
                        onClick={() => escolherOpcao(o)}
                        disabled={ocupado}
                        data-testid={`opcao-${o}`}
                        className={['relative flex min-h-[112px] w-full flex-col items-start gap-1.5 rounded-[8px] border-2 p-4 text-left transition-colors disabled:opacity-60', ativo ? 'border-[#0A78BE] bg-[#E7F5FF]' : 'border-[#CBD2D9] bg-white hover:border-[#0A78BE]'].join(' ')}
                      >
                        <span className="flex w-full items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-[15px] font-bold" style={{ color: FIN_COR.texto }}>
                            {ativo ? <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-[#0A78BE]" aria-hidden /> : <Circle className="h-5 w-5 flex-shrink-0 text-[#8595A2]" aria-hidden />}
                            {TEXTO_OPCAO[o].titulo}
                          </span>
                          {o === 'beta' ? <SeloMeta tom="azul">Recomendado</SeloMeta> : <SeloMeta tom="cinza">Padrão</SeloMeta>}
                        </span>
                        <span className="text-[13px] leading-[18px]" style={{ color: FIN_COR.texto2 }}>{TEXTO_OPCAO[o].frase}</span>
                        {ativo && <span className="text-[12.5px] font-semibold text-[#0868A6]" data-testid="opcao-em-uso">Em uso na sua loja</span>}
                      </button>
                    )
                  })}
                </div>
              </Card>

              {/* ── 2. Situação ─────────────────────────────────────────────── */}
              <Card
                titulo="Situação"
                subtitulo={opcao === 'beta' ? 'Assistente Beta: computador, versão, impressoras e última impressão.' : 'Assistente antigo: conexão, impressora e último sinal.'}
                acoes={<SeloMeta tom={TOM_SINAL[situacao.sinal]} testid="situacao-selo">{ROTULO_SINAL[situacao.sinal]}</SeloMeta>}
                faixa={situacao.sinal === 'ok' ? 'sucesso' : situacao.sinal === 'atencao' ? 'atencao' : 'erro'}
                testid="card-situacao"
              >
                <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                  {situacao.linhas.map((l) => (
                    <div key={l.testid} className="flex min-w-0 items-center justify-between gap-3 border-b border-[#EFF1F3] pb-2" data-testid={l.testid}>
                      <dt className="text-[13px]" style={{ color: FIN_COR.texto2 }}>{l.rotulo}</dt>
                      <dd className="flex min-w-0 items-center gap-2 text-right text-[13.5px] font-semibold" style={{ color: FIN_COR.texto }}>
                        <span className="min-w-0 truncate" title={l.valor}>{l.valor}</span>
                        {l.sinal && <span className={['h-2.5 w-2.5 flex-shrink-0 rounded-full', l.sinal === 'ok' ? 'bg-[#006B4E]' : l.sinal === 'atencao' ? 'bg-[#D47B04]' : 'bg-[#D93616]'].join(' ')} aria-label={ROTULO_SINAL[l.sinal]} />}
                      </dd>
                    </div>
                  ))}
                </dl>
                {situacao.aviso && (
                  <div className="mt-4">
                    <Aviso
                      tipo={situacao.aviso.tipo}
                      titulo={situacao.aviso.titulo}
                      testid="situacao-aviso"
                      acao={<button type="button" className={FIN_BTN.primario} onClick={() => executar(situacao.aviso!.acao)} data-testid="situacao-acao">{situacao.aviso.rotuloAcao}</button>}
                    >
                      {situacao.aviso.texto}
                    </Aviso>
                  </div>
                )}
              </Card>

              {/* ── 3. Modelos ──────────────────────────────────────────────── */}
              <Card titulo="Modelos" subtitulo="Veja como sai no papel, com os dados da sua loja, antes de imprimir." testid="card-modelos">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={FIN_BTN.contorno} onClick={() => setPrevia('comanda')} data-testid="ver-comanda"><Eye className="h-4 w-4" /> Ver comanda</button>
                  {opcao === 'beta' && <button type="button" className={FIN_BTN.contorno} onClick={() => setPrevia('pre_conta')} data-testid="ver-pre_conta"><ReceiptText className="h-4 w-4" /> Ver pré-conta</button>}
                  {opcao === 'beta' && <button type="button" className={FIN_BTN.contorno} onClick={() => setPrevia('via_cozinha')} data-testid="ver-via_cozinha"><ChefHat className="h-4 w-4" /> Ver via da cozinha</button>}
                  {opcao === 'beta' && (
                    <button type="button" className={FIN_BTN.primario} onClick={() => setTestando(true)} disabled={!podeTestarBeta} title={podeTestarBeta ? undefined : 'Conecte um computador para testar.'} data-testid="imprimir-teste">
                      <FlaskConical className="h-4 w-4" /> Imprimir teste
                    </button>
                  )}
                </div>
                {opcao === 'antigo' && <p className="mt-2 text-[12.5px]" style={{ color: FIN_COR.texto2 }} data-testid="teste-antigo">Para imprimir um teste, use o botão “Imprimir teste” no próprio Assistente, no computador da impressora.</p>}
                {opcao === 'beta' && atual && (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-[8px] bg-[#EFF1F3] px-3 py-2.5" data-testid="via-cozinha">
                    <span className="min-w-0 text-[13px]" style={{ color: FIN_COR.texto }}>
                      <span className="font-semibold">Via da cozinha sem valores</span>
                      <span className="block text-[12.5px]" style={{ color: FIN_COR.texto2 }}>Uma via a mais, só com os itens, logo depois da comanda. Precisa do Assistente {VERSAO_IMPRESSAO_V3.replace('0.2.0-', '')} ou mais novo.</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={atual.config.viaCozinha === true}
                      aria-label="Imprimir também a via da cozinha"
                      disabled={!atual.podeEditar}
                      onClick={() => void patchAtual({ viaCozinha: !atual.config.viaCozinha })}
                      data-testid="opcao-viaCozinha"
                      className={['relative h-[24px] w-[42px] flex-shrink-0 rounded-full transition-colors disabled:opacity-45', atual.config.viaCozinha ? 'bg-[#0A78BE]' : 'bg-[#8595A2]'].join(' ')}
                    >
                      <span className={['absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all', atual.config.viaCozinha ? 'left-[21px]' : 'left-[3px]'].join(' ')} />
                    </button>
                  </div>
                )}
              </Card>

              {/* ── Configurações avançadas (recolhidas) ───────────────────── */}
              <section className="fin-card" data-testid="avancado">
                <button
                  type="button"
                  onClick={() => setAvancadoAberto((v) => !v)}
                  aria-expanded={avancadoAberto}
                  data-testid="avancado-alternar"
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                >
                  <span className="flex items-center gap-2">
                    <Settings2 className="h-5 w-5" style={{ color: FIN_COR.texto2 }} aria-hidden />
                    <span>
                      <span className="block text-[15px] font-bold" style={{ color: FIN_COR.texto }}>Configurações avançadas</span>
                      <span className="block text-[12.5px]" style={{ color: FIN_COR.texto2 }}>
                        {opcao === 'beta' ? 'Computadores, impressoras, calibração, envio direto, letra e opções da comanda.' : 'Token, impressoras e opções do Assistente antigo.'}
                      </span>
                    </span>
                  </span>
                  <span className="text-[13px] font-semibold text-[#0868A6]">{avancadoAberto ? 'Fechar' : 'Abrir'}</span>
                </button>
                {avancadoAberto && (
                  <div className="space-y-4 border-t border-[#EFF1F3] px-4 py-4 sm:px-5" data-testid="avancado-conteudo">
                    {opcao === 'beta' ? (
                      <>
                        <EtapaConectar p={p} ocupado={ocupado} onParear={() => void abrirPareamento()} onRevogar={revogar} onRenomear={renomear} />
                        <EtapaImpressoras p={p} onEscolher={() => setEscolhendo(true)} />
                        <Calibrar p={p} onCalibrar={(id) => setCalibrar(id)} onLetra={(d, t) => void ajustar(d, { tamanhoFonte: t })} ocupado={ocupado} />
                        {atual && <OpcoesComanda config={atual.config} podeEditar={atual.podeEditar} onPatch={(x) => void patchAtual(x)} />}
                        <AjudaDiagnostico p={p} onAjudaCompleta={() => setAjuda(true)} />
                      </>
                    ) : (
                      <>
                        <AssistenteAntigo
                          atual={atual}
                          token={token}
                          vistoEm={atualVistoEm}
                          online={atualOnline}
                          impressoraEmUsoId={atualImpressoraId}
                          cozinhaNoBeta={false}
                          onPatch={(x) => void patchAtual(x)}
                          onGerarToken={() => void gerarToken()}
                          onEditarImpressora={(id, input) => setModalImpressora({ id, input })}
                          onRemoverImpressora={(id) => void removerImpressoraAntiga(id)}
                        />
                        {atual && <OpcoesComanda config={atual.config} podeEditar={atual.podeEditar} onPatch={(x) => void patchAtual(x)} />}
                      </>
                    )}
                  </div>
                )}
              </section>
            </>
          )}

          {/* ── janelas ─────────────────────────────────────────────────────────── */}
          <NoTopo><ModalAjudaImpressao aberto={ajuda} onFechar={() => setAjuda(false)} /></NoTopo>
          {pareando && (
            <ModalPareamento codigo={pareando.codigo} erro={pareando.erro} conectado={pareando.conectado} onGerarOutro={() => void abrirPareamento()} onFechar={() => setPareando(null)} />
          )}
          {escolhendo && p && <ModalImpressoras p={p} ocupado={ocupado} onSalvar={salvarImpressoras} onAjustar={ajustar} onAtualizar={carregar} onFechar={() => setEscolhendo(false)} />}
          {testando && p && <ModalTestes p={p} onTestar={testar} onFechar={() => setTestando(false)} />}
          {opcao && (
            <ModalPrevia
              aberto={previa !== null}
              onFechar={() => setPrevia(null)}
              opcao={opcao}
              docInicial={previa ?? 'comanda'}
              dados={dadosPrevia}
              config={atual?.config ?? null}
              papelBeta={papelDe(dCozinha)}
              papelPreConta={papelDe(dCaixa ?? dCozinha)}
              antigo={{ larguraMm: larguraAntiga <= 40 ? 58 : 80, colunas: ReciboAntigo.colsParaFonte(impAntiga?.tamanhoFonte, larguraAntiga) }}
            />
          )}
          {p && prontidao && (
            <AtivarBeta
              aberto={ativarBeta}
              prontidao={prontidao}
              ocupado={ocupado}
              onFechar={() => setAtivarBeta(false)}
              onParear={() => void abrirPareamento()}
              onEscolher={() => setEscolhendo(true)}
              onAtivar={() => void confirmarTroca('beta')}
            />
          )}
          <ModalCentral
            aberto={trocar !== null}
            onFechar={() => setTrocar(null)}
            largura={440}
            testid="confirmar-opcao"
            titulo={trocar === 'beta' ? 'Imprimir pelo Assistente Beta?' : 'Voltar para o Assistente antigo?'}
            rodape={
              <div className="flex justify-end gap-2">
                <button type="button" className={FIN_BTN.contorno} onClick={() => setTrocar(null)}>Cancelar</button>
                <button type="button" className={FIN_BTN.primario} disabled={ocupado} onClick={() => trocar && void confirmarTroca(trocar)} data-testid="confirmar-opcao-ok">Confirmar</button>
              </div>
            }
          >
            <p className="px-5 py-4 text-[14px] leading-[20px]" style={{ color: FIN_COR.texto }} data-testid="confirmar-opcao-texto">{trocar ? CONFIRMACAO_OPCAO[trocar] : ''}</p>
          </ModalCentral>
          {dCalibrar && <NoTopo><Calibracao d={dCalibrar} ocupado={ocupado} agir={agir} onFechar={() => setCalibrar(null)} /></NoTopo>}
          {modalImpressora && <NoTopo><ImpressoraModal initial={modalImpressora.input} onClose={() => setModalImpressora(null)} onSave={salvarImpressoraAntiga} /></NoTopo>}
        </div>
      </div>
    </div>
  )
}

// ─── passo a passo para ativar o Beta (a loja não fica sem impressão) ────────

function AtivarBeta({ aberto, prontidao, ocupado, onFechar, onParear, onEscolher, onAtivar }: {
  aberto: boolean
  prontidao: ReturnType<typeof prontidaoBeta>
  ocupado: boolean
  onFechar: () => void
  onParear: () => void
  onEscolher: () => void
  onAtivar: () => void
}) {
  const acoes: Record<string, React.ReactNode> = {
    instalar: <a href={DOWNLOAD_ASSISTENTE_BETA.url} className={FIN_BTN.contorno} data-testid="ativar-baixar"><Download className="h-4 w-4" /> Baixar o Assistente Beta</a>,
    parear: <button type="button" className={FIN_BTN.contorno} onClick={onParear} disabled={ocupado} data-testid="ativar-parear"><Link2 className="h-4 w-4" /> Gerar código de conexão</button>,
    impressoras: <button type="button" className={FIN_BTN.contorno} onClick={onEscolher} disabled={!prontidao.conectado} data-testid="ativar-impressoras"><Printer className="h-4 w-4" /> Escolher impressoras</button>,
  }
  return (
    <ModalCentral
      aberto={aberto}
      onFechar={onFechar}
      largura={560}
      testid="ativar-beta"
      titulo="Ativar o Assistente Beta"
      subtitulo={CONFIRMACAO_OPCAO.beta}
      rodape={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px]" style={{ color: FIN_COR.texto2 }}>{prontidao.pronto ? 'Tudo pronto.' : 'Enquanto isso, a loja continua imprimindo pelo Assistente antigo.'}</p>
          <div className="flex gap-2">
            <button type="button" className={FIN_BTN.contorno} onClick={onFechar}>Agora não</button>
            <button type="button" className={FIN_BTN.primario} disabled={!prontidao.pronto || ocupado} onClick={onAtivar} data-testid="ativar-confirmar"><Sparkles className="h-4 w-4" /> Ativar Assistente Beta</button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 px-4 py-4 sm:px-5">
        {!prontidao.liberado && (
          <Aviso tipo="info" titulo="Falta a liberação do Beta" acao={<a href={SUPORTE_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={FIN_BTN.contorno}>Falar com o suporte</a>}>
            O suporte Menuzia libera o Beta para a sua loja. Os passos abaixo já podem ser feitos.
          </Aviso>
        )}
        <ol className="space-y-2.5" data-testid="ativar-passos">
          {prontidao.passos.map((passo, i) => (
            <li key={passo.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#CBD2D9] px-3 py-2.5" data-testid={`ativar-passo-${passo.id}`} data-feito={passo.feito ? 'sim' : 'nao'}>
              <span className="flex min-w-0 items-center gap-2.5 text-[13.5px]" style={{ color: FIN_COR.texto }}>
                {passo.feito
                  ? <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-[#006B4E]" aria-label="Feito" />
                  : <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 border-[#8595A2] text-[11px] font-bold" style={{ color: FIN_COR.texto2 }}>{i + 1}</span>}
                <span className={passo.feito ? 'font-semibold' : ''}>{passo.titulo}</span>
              </span>
              {!passo.feito && acoes[passo.id]}
            </li>
          ))}
        </ol>
        <p className="text-[12.5px]" style={{ color: FIN_COR.texto2 }}>
          Instale no computador ligado à impressora, abra o “Assistente Menuzia Beta” e digite o código de conexão.{' '}
          <a href="/guia-impressora.html" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#0868A6] underline">Guia passo a passo</a>
        </p>
      </div>
    </ModalCentral>
  )
}

// ─── calibração e letra por impressora (Configurações avançadas) ────────────

function Calibrar({ p, ocupado, onCalibrar, onLetra }: { p: PainelDados; ocupado: boolean; onCalibrar: (id: string) => void; onLetra: (d: DispositivoVisao, t: TamanhoLetra) => void }) {
  const usadas = p.dispositivos.filter((d) => d.id === p.funcoes.cozinha || d.id === p.funcoes.caixa)
  return (
    <Card titulo="Calibrar e ajustar" subtitulo="Papel cortando, letra clara ou largura errada? O passo a passo resolve; o envio direto é o recomendado." testid="calibrar-impressoras">
      {usadas.length === 0 ? (
        <p className="text-[13px]" style={{ color: FIN_COR.texto2 }}>Escolha as impressoras primeiro.</p>
      ) : (
        <ul className="divide-y divide-[#EFF1F3]">
          {usadas.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5" data-testid={`calibrar-${d.id}`}>
              <span className="min-w-0 text-[13.5px]" style={{ color: FIN_COR.texto }}>
                <span className="font-semibold">{nomeDisp(d)}</span>
                <span className="block text-[12.5px]" style={{ color: FIN_COR.texto2 }}>
                  {d.funcoes.map((f) => (f === 'cozinha' ? 'Cozinha' : 'Recibo/Extrato')).join(' e ')} · papel {d.larguraMm} mm · {d.envio === 'driver' ? 'pelo driver do Windows' : 'envio direto'}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <label className="text-[12.5px]" style={{ color: FIN_COR.texto2 }}>
                  Letra{' '}
                  <select value={d.tamanhoFonte} disabled={ocupado} onChange={(e) => onLetra(d, e.target.value as TamanhoLetra)} className="ml-1 h-[32px] rounded-[6px] border border-[#CBD2D9] bg-white px-2 text-[13px]" data-testid={`letra-${d.id}`}>
                    {TAMANHOS_LETRA.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                  </select>
                </label>
                <button type="button" className={FIN_BTN.contorno} onClick={() => onCalibrar(d.id)} data-testid={`calibrar-abrir-${d.id}`}>Calibrar</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ─── opções da comanda (valem para o Beta e para o Assistente antigo) ───────

type ChaveOpcao = 'mostrarNumeroItem' | 'mostrarNomeComplementos' | 'mostrarPrecoComplementos' | 'multiplicarOpcoesQtd' | 'fonteMaiorProducao' | 'imprimirLogo'
const OPCOES_COMANDA: { chave: ChaveOpcao; rotulo: string }[] = [
  { chave: 'imprimirLogo', rotulo: 'Imprimir a logo da loja' },
  { chave: 'mostrarNumeroItem', rotulo: 'Mostrar a quantidade ("2x") no item' },
  { chave: 'mostrarNomeComplementos', rotulo: 'Mostrar os adicionais' },
  { chave: 'mostrarPrecoComplementos', rotulo: 'Mostrar o preço dos adicionais (Assistente antigo)' },
  { chave: 'multiplicarOpcoesQtd', rotulo: 'Multiplicar os adicionais pela quantidade' },
  { chave: 'fonteMaiorProducao', rotulo: 'Letra maior nos itens' },
]

function OpcoesComanda({ config, podeEditar, onPatch }: { config: ConfigImpressao; podeEditar: boolean; onPatch: (p: Partial<ConfigImpressao>) => void }) {
  return (
    <Card titulo="Opções da comanda" subtitulo="O que aparece no papel. A prévia (Ver comanda) já mostra as mudanças." testid="opcoes-impressao">
      <ul className="divide-y divide-[#EFF1F3]">
        {OPCOES_COMANDA.map((o) => {
          const ligado = !!config[o.chave]
          return (
            <li key={o.chave} className="flex items-center justify-between gap-3 py-2">
              <span className="text-[13.5px]" style={{ color: FIN_COR.texto }} id={`opcao-rotulo-${o.chave}`}>{o.rotulo}</span>
              <button
                type="button"
                role="switch"
                aria-checked={ligado}
                aria-labelledby={`opcao-rotulo-${o.chave}`}
                disabled={!podeEditar}
                onClick={() => onPatch({ [o.chave]: !ligado } as Partial<ConfigImpressao>)}
                data-testid={`opcao-${o.chave}`}
                className={['relative h-[24px] w-[42px] flex-shrink-0 rounded-full transition-colors disabled:opacity-45', ligado ? 'bg-[#0A78BE]' : 'bg-[#8595A2]'].join(' ')}
              >
                <span className={['absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all', ligado ? 'left-[21px]' : 'left-[3px]'].join(' ')} />
              </button>
            </li>
          )
        })}
      </ul>
      {!podeEditar && <p className="mt-1 text-[12px]" style={{ color: FIN_COR.texto2 }}>Só o dono da loja altera estas opções.</p>}
    </Card>
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
              <p className="font-semibold">2. Imprima o teste de largura</p>
              <p className="text-text-subtle">Ele tem uma régua numerada, uma barra preta em cada lado, acentos, letra pequena e uma faixa cinza.</p>
              <button type="button" disabled={ocupado} onClick={() => void imprimir()} data-testid="imprimir-calibracao" className="w-full rounded-menuzia bg-primary py-3 text-[13px] font-bold text-white disabled:opacity-40">
                Imprimir teste de largura
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

          <EnvioImpressora d={d} ocupado={ocupado} agir={agir} onImprimirTeste={() => void imprimir()} />

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
