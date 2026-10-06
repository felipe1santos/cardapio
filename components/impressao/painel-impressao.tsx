'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowRight, Check, ChefHat, ChevronDown, Download, Monitor, Plus, Printer, ReceiptText, RefreshCw, ScrollText, SlidersHorizontal, Sparkles, Wallet,
} from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { chamar, novaChave } from '@/components/pdv/util'
import { ModalAjudaImpressao } from '@/components/impressao/ajuda-impressao'
import { ImpressoraModal } from '@/components/impressao/documentos'
import { EnvioImpressora } from '@/components/impressao/envio-impressora'
import { ModalPrevia, type LojaPrevia, type PapelPrevia } from '@/components/impressao/modal-previa'
import { ModalImpressoras, ModalPareamento, ModalTestes, nomeDisp, TAMANHOS_LETRA, type PainelDados, type ResultadoTeste, type TamanhoLetra, type TipoTeste } from '@/components/impressao/beta-cards'
import { ModalCentral, NoTopo } from '@/components/ui/flutuante'
import { ROTULO_MODO_BETA, DOWNLOAD_ASSISTENTE_ATUAL, DOWNLOAD_ASSISTENTE_BETA } from '@/lib/impressao/rotulos'
import { modoDependeDoAgente, ehImpressoraVirtual } from '@/lib/impressao/regras-modo'
import { avisoDriver, envioDiretoSugerido } from '@/lib/impressao/regras-calibracao'
import { CONFIRMACAO_OPCAO, MODO_DA_OPCAO, opcaoDaLoja, prontidaoBeta, versaoInstalada, type OpcaoImpressao } from '@/lib/impressao/opcao'
import { compararVersao, VERSAO_IMPRESSAO_V3 } from '@/lib/avisos-painel'
import { SUPORTE_MENUZIA } from '@/lib/suporte'
import ReciboAntigo from '@/lib/impressao/recibo-antigo-canvas.js'
import type { AgenteVisao, DispositivoVisao, Funcao, ModoBeta } from '@/lib/impressao/servico'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { garantirLogoImpressao } from '@/lib/impressao/logo-navegador'
import {
  atualizarConfigImpressao, atualizarImpressora, buscarConfigImpressao, buscarStatusAgente, criarImpressora, listarImpressoras, removerImpressora,
  type ConfigImpressao, type Impressora, type ImpressoraInput,
} from '@/lib/queries/impressao'

/**
 * Impressão — tela nova a partir do protótipo aprovado (docs/impressao-tela-nova/prototipo/,
 * 2026-10-06): cabeçalho com pílulas de situação e "Ver modelo da impressão"; passos 1 Escolha o
 * assistente, 2 Instale, 3 Impressoras e o que cada uma imprime, 4 Conexão e ajuste do papel,
 * 5 O que aparece no papel; e a Situação geral com os detalhes técnicos. Visual do protótipo
 * (classes ti- em app/globals.css), fonte Figtree com peso máximo 600.
 *
 * A opção (Assistente antigo / novo) é LIDA do modo do Beta (lib/impressao/opcao): o deploy não
 * muda nenhuma loja. Trocar pede confirmação e grava pela troca auditada de sempre; se o
 * assistente escolhido não estiver instalado e conectado, a tela guia a instalação antes.
 * Nenhuma credencial aparece; o código de pareamento vence em 10 min.
 */

const MOTIVO_RECUO = 'O modo voltou para a segurança porque a impressora que ele usava deixou de valer.'
const PAPEL_PADRAO: PapelPrevia = { larguraMm: 80, larguraPontos: null, tamanhoFonte: 'grande', intensidade: 'normal' }
const papelDe = (d: DispositivoVisao | undefined): PapelPrevia => (d ? { larguraMm: d.larguraMm <= 58 ? 58 : 80, larguraPontos: d.larguraPontos, tamanhoFonte: d.tamanhoFonte, intensidade: d.intensidade } : PAPEL_PADRAO)
const SUPORTE_URL = `https://wa.me/${SUPORTE_MENUZIA.whatsapp}?text=${encodeURIComponent('Olá! Quero liberar o Assistente novo (impressão) na minha loja.')}`
const quando = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) === d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return hoje ? `Hoje, ${hora}` : `${d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })}, ${hora}`
}
const diasDesde = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null)
const descricaoEnvio = (d: DispositivoVisao) => (d.envio === 'raw_rede' ? `Rede ${d.redeIp ?? ''}`.trim() : d.envio === 'raw_fila' ? 'USB, envio direto' : 'pelo Windows')
type Estado = 'ok' | 'warn' | 'bad' | 'off'
const Ponto = ({ e }: { e: Estado }) => <i className={`ti-dot ${e === 'ok' ? '' : e}`} aria-hidden />
const Aviso = ({ children, acao, erro, testid }: { children: React.ReactNode; acao?: React.ReactNode; erro?: boolean; testid?: string }) => (
  <div className={`ti-aviso ${erro ? 'erro' : ''}`} data-testid={testid}>
    <AlertTriangle aria-hidden />
    <span className="min-w-0">{children}</span>
    {acao}
  </div>
)

export function PainelImpressao() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [p, setP] = useState<PainelDados | null>(null)
  const [config, setConfig] = useState<ConfigImpressao | null>(null)
  const [impAntigas, setImpAntigas] = useState<Impressora[]>([])
  const [podeEditar, setPodeEditar] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
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
  const [previa, setPrevia] = useState(false)
  const [dadosPrevia, setDadosPrevia] = useState<LojaPrevia | null>(null)
  const [trocar, setTrocar] = useState<OpcaoImpressao | null>(null)
  const [guia, setGuia] = useState<OpcaoImpressao | null>(null)
  const [comoAtualizar, setComoAtualizar] = useState(false)
  const [copiado, setCopiado] = useState(false)
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

  // Pareando ou guiando a instalação: confere a cada 2 s; fora disso, a cada 5 s.
  const rapido = (!!pareando && !pareando.conectado) || !!guia
  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), rapido ? 2000 : 5000)
    return () => clearInterval(t)
  }, [carregar, rapido])

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

  // Dados da loja para o modelo (nome, telefone, endereço, QR e logo).
  useEffect(() => {
    let vivo = true
    fetch('/api/admin/impressao/previa', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setDadosPrevia({ loja: j?.loja ?? { nome: '', telefone: '', endereco: '' }, qr: j?.qr ?? null, logoUrl: j?.logoUrl ?? null }) })
      .catch(() => { if (vivo) setDadosPrevia({ loja: { nome: '', telefone: '', endereco: '' }, qr: null, logoUrl: null }) })
    return () => { vivo = false }
  }, [])

  // Opções da impressão, impressoras do Assistente antigo e o token (só o dono lê).
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
        setPodeEditar(tk.ok)
        setConfig(cfg)
        setImpAntigas(lista)
        setLogoUrl(loja?.logoUrl ?? null)
      } catch {
        if (vivo) setErro('Não foi possível carregar as opções da impressão.')
      }
    })()
    return () => { vivo = false }
  }, [supabase])

  // Logo do Recibo/Extrato do Beta: o navegador prepara a versão de impressão (PNG, fundo branco).
  const liberado = p?.betaLiberado === true
  useEffect(() => {
    if (!liberado) return
    if (!logoUrl) return setLogoRecibo('sem_logo')
    let vivo = true
    void garantirLogoImpressao(logoUrl).then((r) => vivo && setLogoRecibo(r))
    return () => { vivo = false }
  }, [liberado, logoUrl])

  // Sinal do Assistente antigo (heartbeat a cada 5 s).
  const checarAntigo = useCallback(async () => {
    if (!restauranteId) return
    try {
      const s = await buscarStatusAgente(supabase, restauranteId)
      setAtualVistoEm(s.vistoEm)
      setAtualImpressoraId(s.vistoEm && Date.now() - new Date(s.vistoEm).getTime() < 30_000 ? s.impressoraId : null)
    } catch { /* sem sinal */ }
  }, [supabase, restauranteId])
  useEffect(() => {
    void checarAntigo()
    const t = setInterval(() => void checarAntigo(), 8000)
    return () => clearInterval(t)
  }, [checarAntigo])

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

  /** Seletor Cozinha / Caixa / Os dois de uma impressora. */
  function usarPara(d: DispositivoVisao, uso: 'cozinha' | 'caixa' | 'ambos') {
    if (!p) return
    const novo = { ...p.funcoes }
    if (uso === 'cozinha' || uso === 'ambos') novo.cozinha = d.id
    else if (novo.cozinha === d.id) novo.cozinha = null
    if (uso === 'caixa' || uso === 'ambos') novo.caixa = d.id
    else if (novo.caixa === d.id) novo.caixa = null
    void salvarImpressoras(novo)
  }

  async function ajustar(d: DispositivoVisao, patch: { apelido?: string; larguraMm?: number; tamanhoFonte?: TamanhoLetra }) {
    await agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', patch, patch.apelido !== undefined ? 'Apelido salvo.' : patch.tamanhoFonte !== undefined ? 'Tamanho da letra salvo.' : 'Papel salvo.')
  }

  function revogar(a: AgenteVisao) {
    if (!p) return
    const emUso = modoDependeDoAgente(p.modo, a.id, p.dispositivos.map((d) => ({ id: d.id, agenteId: d.agenteId, nomeSistema: d.nomeSistema })), p.funcoes)
    const texto = emUso
      ? `"${a.nome}" imprime os pedidos pelo Assistente novo. Ao desconectar, a loja volta na hora para o Assistente antigo. Desconectar?`
      : `Desconectar "${a.nome}"? Ele para de imprimir na hora e precisa ser conectado de novo.`
    if (confirm(texto)) void agir(`/api/admin/impressao/agentes/${a.id}`, 'POST', { acao: 'revogar' }, 'Computador desconectado.')
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

  /** "Testar" de uma impressora: a comanda de teste se ela é da Cozinha, senão a pré-conta. */
  async function testarImpressora(d: DispositivoVisao) {
    const tipo: TipoTeste = p?.funcoes.cozinha === d.id || p?.funcoes.caixa !== d.id ? 'cozinha' : 'recibo'
    const r = await testar(tipo, d)
    setAviso(r.ok ? { tom: 'ok', texto: `Teste enviado para ${nomeDisp(d)}.` } : { tom: 'erro', texto: r.erro ?? 'Não foi possível enviar o teste.' })
  }

  async function patchConfig(patch: Partial<ConfigImpressao>) {
    if (!config || !restauranteId) return
    setConfig({ ...config, ...patch })
    try {
      await atualizarConfigImpressao(supabase, restauranteId, patch)
    } catch {
      setAviso({ tom: 'erro', texto: 'Não foi possível salvar a opção.' })
    }
  }

  async function gerarToken() {
    if (token && !confirm('Gerar um token novo? O Assistente antigo para de imprimir até você colar o token novo nele.')) return
    const res = await fetch('/api/admin/impressao/token', { method: 'POST' }).catch(() => null)
    if (!res?.ok) return setAviso({ tom: 'erro', texto: 'Não foi possível gerar o token.' })
    setToken(((await res.json()) as { token: string }).token)
  }

  async function salvarImpressoraAntiga(input: ImpressoraInput) {
    if (!restauranteId || !modalImpressora) return
    if (modalImpressora.id) {
      await atualizarImpressora(supabase, modalImpressora.id, input)
      setImpAntigas((l) => l.map((i) => (i.id === modalImpressora.id ? { ...i, ...input } : i)))
    } else {
      const nova = await criarImpressora(supabase, restauranteId, input, impAntigas.length)
      setImpAntigas((l) => [...l, nova])
    }
    setModalImpressora(null)
  }

  async function larguraAntiga(imp: Impressora, mm: 58 | 80) {
    const input: ImpressoraInput = { nome: imp.nome, tamanhoFonte: imp.tamanhoFonte, largura: mm === 58 ? 32 : 48, copias: imp.copias }
    try {
      await atualizarImpressora(supabase, imp.id, input)
      setImpAntigas((l) => l.map((i) => (i.id === imp.id ? { ...i, largura: input.largura } : i)))
      setAviso({ tom: 'ok', texto: `Papel ${mm} mm salvo em ${imp.nome}.` })
    } catch {
      setAviso({ tom: 'erro', texto: 'Não foi possível salvar o papel.' })
    }
  }

  async function removerImpressoraAntiga(id: string) {
    if (!confirm('Remover esta impressora do Assistente antigo?')) return
    try {
      await removerImpressora(supabase, id)
      setImpAntigas((l) => l.filter((i) => i.id !== id))
    } catch {
      setAviso({ tom: 'erro', texto: 'Não foi possível remover a impressora.' })
    }
  }

  /** Troca de opção: auditada no banco (impressao_modo_definir). */
  async function confirmarTroca(o: OpcaoImpressao) {
    const r = await agir('/api/admin/impressao/modo', 'PUT', { modo: MODO_DA_OPCAO[o] }, o === 'beta' ? 'Pronto: a loja imprime pelo Assistente novo.' : 'Pronto: a loja imprime pelo Assistente antigo.')
    if (r?.ok) { setTrocar(null); setGuia(null) }
  }

  // ── leitura do estado ───────────────────────────────────────────────────────
  const opcao: OpcaoImpressao | null = p ? opcaoDaLoja(p.modo) : null
  const beta = opcao === 'beta'
  const atualOnline = !!atualVistoEm && Date.now() - new Date(atualVistoEm).getTime() < 2 * 60_000
  const ativos = p?.agentes.filter((a) => !a.revogado) ?? []
  const online = ativos.filter((a) => a.online)
  const versao = p ? versaoInstalada(p.agentes) : null
  const desatualizado = !!versao && compararVersao(versao, VERSAO_IMPRESSAO_V3) < 0
  const dCozinha = p?.dispositivos.find((d) => d.id === p.funcoes.cozinha)
  const dCaixa = p?.dispositivos.find((d) => d.id === p.funcoes.caixa)
  const agenteDe = (d: DispositivoVisao | undefined) => (d ? ativos.find((a) => a.id === d.agenteId) : undefined)
  const pronta = (d: DispositivoVisao | undefined) => !!d && !!agenteDe(d)?.online
  // Impressoras da lista: as que têm função e as reais (não virtuais) disponíveis nos computadores ativos.
  const listadas = (p?.dispositivos ?? []).filter((d) => agenteDe(d) && (d.funcoes.length > 0 || (d.disponivel && !ehImpressoraVirtual(d.nomeSistema))))
  const usadas = (p?.dispositivos ?? []).filter((d) => d.id === p?.funcoes.cozinha || d.id === p?.funcoes.caixa)
  const impAntiga = impAntigas.find((i) => i.id === atualImpressoraId) ?? impAntigas.find((i) => i.ativa) ?? impAntigas[0] ?? null
  const larguraAnt = impAntiga?.largura ?? 48
  const prontidao = p ? prontidaoBeta(p) : null
  const ultimoUso = usadas.map((d) => d.ultimoUsoEm).filter((x): x is string => !!x).sort().at(-1) ?? p?.trabalhos.find((t) => t.estado === 'enviado_spooler')?.enviadoEm ?? null
  const ultimoErro = usadas.filter((d) => d.ultimoErroEm && Date.now() - new Date(d.ultimoErroEm).getTime() < 86_400_000)
  const avisoCalibrar = (d: DispositivoVisao) => {
    const drv = avisoDriver(d)
    if (drv) return drv
    const dias = diasDesde(d.calibradoEm)
    if (dias === null) return 'Esta impressora ainda não foi calibrada.'
    if (dias > 30) return `Última calibração há ${dias} dias.`
    return null
  }
  const algumAvisoCalibrar = usadas.some((d) => avisoCalibrar(d))

  // Passos: feito (verde-claro), atual (contorno azul, o primeiro pendente) e o resto neutro.
  const feitos = !p || !opcao ? [false, false, false, false] : beta
    ? [true, ativos.length > 0, !!dCozinha, online.length > 0 && !algumAvisoCalibrar]
    : [true, !!atualVistoEm, impAntigas.length > 0, atualOnline && config?.ativarAssistente !== false]
  const atualIdx = feitos.findIndex((f, i) => i > 0 && !f)
  const classePasso = (i: number) => (feitos[i] ? 'feito' : i === atualIdx ? 'atual' : '')

  function escolherOpcao(o: OpcaoImpressao) {
    if (!p || o === opcao) return
    if (o === 'beta' && !prontidao?.pronto) return setGuia('beta')
    if (o === 'antigo' && !atualOnline) return setGuia('antigo')
    setTrocar(o)
  }

  const pilulas: { id: string; e: Estado; texto: string }[] = !p ? [] : [
    beta
      ? { id: 'pill-assistente', e: online.length ? 'ok' : 'bad', texto: online.length ? 'Assistente conectado' : ativos.length ? 'Assistente sem sinal' : 'Assistente não instalado' }
      : { id: 'pill-assistente', e: atualOnline ? 'ok' : 'bad', texto: atualOnline ? 'Assistente conectado' : atualVistoEm ? 'Assistente sem sinal' : 'Assistente não instalado' },
    beta
      ? { id: 'pill-cozinha', e: pronta(dCozinha) ? 'ok' : dCozinha ? 'warn' : 'bad', texto: pronta(dCozinha) ? 'Cozinha pronta' : dCozinha ? 'Cozinha sem sinal' : 'Cozinha sem impressora' }
      : { id: 'pill-cozinha', e: impAntiga && atualOnline ? 'ok' : impAntiga ? 'warn' : 'bad', texto: impAntiga && atualOnline ? 'Cozinha pronta' : impAntiga ? 'Cozinha sem sinal' : 'Cozinha sem impressora' },
    ...(beta ? [{ id: 'pill-caixa', e: (pronta(dCaixa) ? 'ok' : dCaixa ? 'warn' : 'off') as Estado, texto: pronta(dCaixa) ? 'Caixa pronto' : dCaixa ? 'Caixa sem sinal' : 'Caixa sem impressora' }] : []),
  ]

  return (
    <div className="tela-impressao flex h-full min-h-0 flex-col overflow-hidden">
      <TopBar title="Impressão" breadcrumb="Pedidos no papel" />
      <div className="ti-fundo min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="impressao-rolagem">
        <main className="ti-pagina" data-testid="painel-impressao">
          {/* ── cabeçalho ─────────────────────────────────────────────────────── */}
          <div className="ti-cab">
            <div className="min-w-0">
              <h2>Impressão de pedidos</h2>
              <p>Escolha como sua loja imprime e deixe a impressora pronta em poucos passos.</p>
              <div className="ti-resumo" aria-label="Situação rápida" data-testid="resumo">
                {pilulas.map((x) => <span key={x.id} data-testid={x.id} data-estado={x.e}><Ponto e={x.e} />{x.texto}</span>)}
                {beta && desatualizado && (
                  <span className="ti-pill-warn" data-testid="pill-atualizacao"><AlertTriangle className="h-[13px] w-[13px]" style={{ color: '#9A7130' }} aria-hidden />Atualização disponível</span>
                )}
              </div>
            </div>
            <button type="button" className="ti-btn" onClick={() => setPrevia(true)} disabled={!p} data-testid="ver-modelo"><ReceiptText aria-hidden /> Ver modelo da impressão</button>
          </div>

          {aviso && (
            <div role="status" data-testid="impressao-aviso" className={`ti-aviso ${aviso.tom === 'erro' ? 'erro' : ''}`} style={aviso.tom === 'ok' ? { background: 'var(--ti-ok-soft)', borderColor: '#A8DCC3', color: '#0B5B3E' } : undefined}>
              {aviso.tom === 'ok' ? <Check aria-hidden style={{ color: 'var(--ti-ok)' }} /> : <AlertTriangle aria-hidden />}
              <span>{aviso.texto}</span>
            </div>
          )}
          {erro && <Aviso erro>{erro}</Aviso>}

          {!p || !opcao ? (
            <div aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="ti-passo h-[150px] animate-pulse" />)}</div>
          ) : (
            <div className="mt-4">
              {/* ── 1. Escolha o assistente ────────────────────────────────── */}
              <Passo n={1} estado={classePasso(0)} titulo="Escolha o assistente" sub="É o programa que fica no computador da loja e envia os pedidos para a impressora." testid="passo-1">
                <div className="ti-escolha" role="radiogroup" aria-label="Assistente de impressão">
                  <OpcaoCard
                    o="antigo" ativo={opcao === 'antigo'} disabled={ocupado} onClick={() => escolherOpcao('antigo')}
                    titulo="Assistente antigo" selo="Padrão" frase="O sistema de sempre. Imprime a comanda do pedido como hoje." itens={['Comanda do pedido']}
                  />
                  <OpcaoCard
                    o="beta" ativo={opcao === 'beta'} disabled={ocupado} onClick={() => escolherOpcao('beta')} rec
                    titulo="Assistente novo" selo="Recomendado" frase="Modelo novo, mais fácil de ler e com envio direto para a impressora."
                    itens={p.modo === 'caixa' ? ['Pré-conta de mesas e balcão', 'Comanda da cozinha (hoje pelo antigo)'] : ['Comanda da cozinha', 'Pré-conta de mesas e balcão']}
                  />
                </div>
                {beta && p.modo === 'caixa' && (
                  <Aviso testid="aviso-so-caixa" acao={<button type="button" className="ti-btn" onClick={() => setTrocar('beta')}>Passar a comanda</button>}>
                    Hoje o Assistente novo imprime só a pré-conta; a comanda ainda sai pelo antigo.
                  </Aviso>
                )}
              </Passo>

              {/* ── 2. Instale no computador da loja ───────────────────────── */}
              <Passo n={2} estado={classePasso(1)} titulo="Instale no computador da loja" sub="Baixe, abra o arquivo e siga o instalador. Se já tiver uma versão, ela é atualizada por cima." testid="passo-2">
                <div className="ti-baixar">
                  <div className="ti-arq">
                    <span className="ti-ico"><Monitor aria-hidden /></span>
                    <div className="min-w-0">
                      <b data-testid="instalador-nome">{beta ? `Assistente Menuzia ${DOWNLOAD_ASSISTENTE_BETA.versao}` : `Assistente de Impressão Menuzia ${DOWNLOAD_ASSISTENTE_ATUAL.versao}`}</b>
                      <small>Windows 10 ou 11, cerca de {beta ? 80 : 75} MB</small>
                    </div>
                  </div>
                  <a className="ti-btn pri" href={beta ? DOWNLOAD_ASSISTENTE_BETA.url : DOWNLOAD_ASSISTENTE_ATUAL.url} data-testid="baixar-instalador"><Download aria-hidden /> Baixar instalador</a>
                </div>
                {beta && desatualizado && (
                  <Aviso testid="aviso-versao" acao={<button type="button" className="ti-btn" onClick={() => setComoAtualizar(true)} data-testid="como-atualizar">Como atualizar</button>}>
                    Este computador está na versão <b>{versao}</b>. Baixe a <b>{VERSAO_IMPRESSAO_V3}</b> e instale por cima, sem desinstalar.
                  </Aviso>
                )}
                {beta && !p.betaLiberado && (
                  <Aviso testid="aviso-liberacao" acao={<a className="ti-btn" href={SUPORTE_URL} target="_blank" rel="noopener noreferrer">Falar com o suporte</a>}>
                    O Assistente novo ainda não foi liberado para a sua loja.
                  </Aviso>
                )}
              </Passo>

              {/* ── 3. Impressoras e o que cada uma imprime ────────────────── */}
              <Passo n={3} estado={classePasso(2)} titulo="Impressoras e o que cada uma imprime" sub={beta ? 'Escolha a impressora e diga se ela fica na cozinha ou no caixa.' : 'A impressora que o Assistente antigo usa para a comanda.'} testid="passo-3">
                {beta ? (
                  <>
                    {listadas.length > 0 ? (
                      <div className="ti-tabela" data-testid="lista-impressoras">
                        <div className="ti-linha cab-t"><span>Impressora</span><span>Usada para</span><span /></div>
                        {listadas.map((d) => {
                          const coz = p.funcoes.cozinha === d.id, cx = p.funcoes.caixa === d.id
                          const est: Estado = !agenteDe(d)?.online ? 'bad' : d.disponivel ? 'ok' : 'warn'
                          return (
                            <div key={d.id} className="ti-linha" data-testid={`impressora-${d.id}`}>
                              <div className="ti-imp">
                                <Ponto e={est} />
                                <div className="min-w-0"><b>{nomeDisp(d)}</b><small>{descricaoEnvio(d)}, papel {d.larguraMm} mm</small></div>
                              </div>
                              <div className="ti-seg" role="group" aria-label={`Uso da impressora ${nomeDisp(d)}`}>
                                <button type="button" aria-pressed={coz && !cx} disabled={ocupado} onClick={() => usarPara(d, 'cozinha')} data-testid={`uso-${d.id}-cozinha`}>Cozinha</button>
                                <button type="button" aria-pressed={cx && !coz} disabled={ocupado} onClick={() => usarPara(d, 'caixa')} data-testid={`uso-${d.id}-caixa`}>Caixa</button>
                                <button type="button" aria-pressed={coz && cx} disabled={ocupado} onClick={() => usarPara(d, 'ambos')} data-testid={`uso-${d.id}-ambos`}>Os dois</button>
                              </div>
                              <button type="button" className="ti-btn sm" disabled={!agenteDe(d)?.online} onClick={() => void testarImpressora(d)} data-testid={`testar-${d.id}`}>Testar</button>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="ti-rot" data-testid="sem-impressoras">Nenhuma impressora ainda. Instale e conecte o Assistente novo (passos 2 e 4); as impressoras do computador aparecem aqui.</p>
                    )}
                    <button type="button" className="ti-btn sm mt-2.5" onClick={() => setEscolhendo(true)} disabled={!ativos.length} data-testid="adicionar-impressora"><Plus aria-hidden /> Adicionar impressora</button>
                  </>
                ) : (
                  <>
                    {impAntigas.length > 0 ? (
                      <div className="ti-tabela" data-testid="lista-impressoras-antigo">
                        <div className="ti-linha cab-t"><span>Impressora</span><span>Usada para</span><span /></div>
                        {impAntigas.map((i) => {
                          const emUso = i.id === impAntiga?.id
                          return (
                            <div key={i.id} className="ti-linha">
                              <div className="ti-imp"><Ponto e={emUso && atualOnline ? 'ok' : 'off'} /><div className="min-w-0"><b>{i.nome}</b><small>papel {i.largura <= 40 ? 58 : 80} mm, letra {i.tamanhoFonte}, {i.copias} {i.copias === 1 ? 'via' : 'vias'}</small></div></div>
                              <span className="ti-rot">{emUso ? 'Comanda (em uso)' : 'Reserva'}</span>
                              <span className="flex gap-2">
                                {podeEditar && <button type="button" className="ti-btn sm" onClick={() => setModalImpressora({ id: i.id, input: { nome: i.nome, tamanhoFonte: i.tamanhoFonte, largura: i.largura, copias: i.copias } })}>Editar</button>}
                                {podeEditar && <button type="button" className="ti-btn sm" onClick={() => void removerImpressoraAntiga(i.id)}>Remover</button>}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="ti-rot">Nenhuma impressora cadastrada para o Assistente antigo.</p>
                    )}
                    {podeEditar && <button type="button" className="ti-btn sm mt-2.5" onClick={() => setModalImpressora({ id: null, input: { nome: '', tamanhoFonte: 'grande', largura: 48, copias: 1 } })} data-testid="adicionar-impressora"><Plus aria-hidden /> Adicionar impressora</button>}
                    <p className="ti-rot mt-2">Para testar, use o botão “Imprimir teste” no próprio Assistente antigo, no computador da impressora.</p>
                  </>
                )}
              </Passo>

              {/* ── 4. Conexão e ajuste do papel ───────────────────────────── */}
              <Passo n={4} estado={classePasso(3)} titulo="Conexão e ajuste do papel" sub="Só mexa aqui se a impressão sair cortada, fraca ou na largura errada." testid="passo-4">
                <div className="ti-grade">
                  <Bloco ico={<Monitor />} cor="teal" titulo="Computador da loja" texto={beta
                    ? (online.length ? `${online.map((a) => a.nome).join(', ')}, conectado agora` : ativos.length ? `${ativos[0].nome}, sem sinal desde ${quando(ativos[0].vistoEm) || '—'}` : 'Nenhum computador conectado ainda.')
                    : (atualOnline ? 'Assistente antigo conectado agora' : atualVistoEm ? `Sem sinal desde ${quando(atualVistoEm)}` : 'O Assistente antigo ainda não se conectou.')} testid="bloco-computador">
                    {beta ? (
                      <>
                        <span className={`ti-estado ${online.length ? 'ok' : 'bad'}`}><Ponto e={online.length ? 'ok' : 'bad'} />{online.length ? 'Conectado' : 'Desconectado'}</span>
                        <button type="button" className="ti-btn sm" onClick={() => void abrirPareamento()} disabled={ocupado} data-testid="trocar-computador">{ativos.length ? 'Trocar computador' : 'Conectar computador'}</button>
                      </>
                    ) : (
                      <>
                        <span className={`ti-estado ${atualOnline ? 'ok' : 'bad'}`}><Ponto e={atualOnline ? 'ok' : 'bad'} />{atualOnline ? 'Conectado' : 'Desconectado'}</span>
                        {podeEditar && token && <button type="button" className="ti-btn sm" onClick={() => navigator.clipboard.writeText(token).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000) })} data-testid="token-copiar">{copiado ? 'Token copiado' : 'Copiar token'}</button>}
                        {podeEditar && <button type="button" className="ti-btn sm" onClick={() => void gerarToken()} data-testid="token-gerar">{token ? 'Gerar novo token' : 'Gerar token'}</button>}
                      </>
                    )}
                  </Bloco>
                  <Bloco ico={<ScrollText />} cor="roxo" titulo="Largura do papel" texto="Confira na caixa da bobina ou na etiqueta da impressora." testid="bloco-largura">
                    {beta ? (usadas.length ? usadas.map((d) => (
                      <div key={d.id} className="flex w-full flex-wrap items-center gap-2">
                        {usadas.length > 1 && <span className="ti-rot min-w-[90px]">{nomeDisp(d)}</span>}
                        <div className="ti-seg" role="group" aria-label={`Largura do papel de ${nomeDisp(d)}`}>
                          {([80, 58] as const).map((mm) => <button key={mm} type="button" aria-pressed={d.larguraMm === mm} disabled={ocupado} onClick={() => mm !== d.larguraMm && void ajustar(d, { larguraMm: mm })} data-testid={`largura-${d.id}-${mm}`}>{mm} mm</button>)}
                        </div>
                      </div>
                    )) : <span className="ti-rot">Escolha a impressora no passo 3.</span>) : (impAntiga ? (
                      <div className="ti-seg" role="group" aria-label="Largura do papel">
                        {([80, 58] as const).map((mm) => <button key={mm} type="button" aria-pressed={(larguraAnt <= 40 ? 58 : 80) === mm} disabled={!podeEditar} onClick={() => void larguraAntiga(impAntiga, mm)} data-testid={`largura-antigo-${mm}`}>{mm} mm</button>)}
                      </div>
                    ) : <span className="ti-rot">Cadastre a impressora no passo 3.</span>)}
                  </Bloco>
                  <Bloco ico={<ArrowRight />} cor="ok" titulo="Forma de envio" texto={beta ? 'Envio direto é mais rápido e evita impressão cortada.' : 'O Assistente antigo imprime sempre pelo Windows (driver da impressora).'} testid="bloco-envio">
                    {beta ? (usadas.length ? usadas.map((d) => (
                      <div key={d.id} className="flex w-full flex-wrap items-center gap-2">
                        {usadas.length > 1 && <span className="ti-rot min-w-[90px]">{nomeDisp(d)}</span>}
                        <div className="ti-seg" role="group" aria-label={`Forma de envio de ${nomeDisp(d)}`}>
                          <button type="button" aria-pressed={d.envio !== 'driver'} disabled={ocupado} onClick={() => d.envio === 'driver' && void agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', { envio: envioDiretoSugerido(d) }, 'Envio direto ligado.')} data-testid={`envio-${d.id}-direto`}>Envio direto</button>
                          <button type="button" aria-pressed={d.envio === 'driver'} disabled={ocupado} onClick={() => d.envio !== 'driver' && void agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', { envio: 'driver' }, 'Envio pelo Windows ligado.')} data-testid={`envio-${d.id}-windows`}>Pelo Windows</button>
                        </div>
                      </div>
                    )) : <span className="ti-rot">Escolha a impressora no passo 3.</span>) : <span className="ti-estado"><Ponto e="off" />Pelo Windows</span>}
                  </Bloco>
                  <Bloco ico={<SlidersHorizontal />} cor="warn" titulo="Calibrar" texto={beta ? 'Imprime uma folha de teste e ajusta largura e intensidade.' : 'No Assistente antigo, a largura é ajustada no driver do Windows.'} testid="bloco-calibrar"
                    antes={beta ? usadas.map((d) => avisoCalibrar(d) && <Aviso key={d.id} testid={`aviso-calibrar-${d.id}`}>{usadas.length > 1 ? `${nomeDisp(d)}: ` : ''}{avisoCalibrar(d)}</Aviso>) : null}>
                    {beta ? usadas.map((d) => (
                      <button key={d.id} type="button" className="ti-btn sm" onClick={() => setCalibrar(d.id)} disabled={!agenteDe(d)?.online} data-testid={`calibrar-${d.id}`}>{usadas.length > 1 ? `Calibrar ${nomeDisp(d)}` : 'Calibrar impressora'}</button>
                    )) : <a className="ti-btn sm" href="/guia-impressora-80mm.html" target="_blank" rel="noopener noreferrer">Como ajustar o driver</a>}
                  </Bloco>
                </div>
              </Passo>

              {/* ── 5. O que aparece no papel ──────────────────────────────── */}
              <Passo n={5} estado="" titulo="O que aparece no papel" sub={'As mudanças valem para a próxima impressão. Confira em "Ver modelo da impressão".'} testid="passo-5">
                {config ? (
                  <div className="ti-opcoes" data-testid="opcoes-impressao">
                    {OPCOES_PAPEL.filter((o) => (o.so === 'beta' ? beta : o.so === 'antigo' ? !beta : true)).map((o) => (
                      <div key={o.chave} className="ti-opt">
                        <div><b id={`opt-${o.chave}`}>{o.titulo}</b><small>{o.frase}</small></div>
                        <button type="button" className="ti-sw" role="switch" aria-checked={!!config[o.chave]} aria-labelledby={`opt-${o.chave}`} disabled={!podeEditar} onClick={() => void patchConfig({ [o.chave]: !config[o.chave] } as Partial<ConfigImpressao>)} data-testid={`opcao-${o.chave}`} />
                      </div>
                    ))}
                  </div>
                ) : <p className="ti-rot">Carregando…</p>}
                {config && !podeEditar && <p className="ti-rot mt-2">Só o dono da loja altera estas opções.</p>}
              </Passo>

              {/* ── Situação geral ─────────────────────────────────────────── */}
              <section className="ti-situ" aria-labelledby="ti-situacao" data-testid="situacao-geral">
                <div className="ti-situ-cab">
                  <h3 id="ti-situacao">Situação geral</h3>
                  <button type="button" className="ti-btn sm" onClick={() => { void carregar(); void checarAntigo() }} data-testid="situacao-atualizar"><RefreshCw aria-hidden /> Atualizar</button>
                </div>
                <div className="ti-itens-s">
                  <ItemSituacao ico={<Monitor />} cor="" rotulo="Assistente" e={beta ? (online.length ? 'ok' : 'bad') : (atualOnline ? 'ok' : 'bad')} valor={`${beta ? 'Novo' : 'Antigo'}, ${(beta ? online.length : atualOnline) ? 'conectado' : 'sem sinal'}`} testid="sit-assistente" />
                  <ItemSituacao ico={<ChefHat />} cor="warn" rotulo="Cozinha" e={beta ? (pronta(dCozinha) ? 'ok' : dCozinha ? 'warn' : 'bad') : (impAntiga ? (atualOnline ? 'ok' : 'warn') : 'bad')} valor={beta ? (dCozinha ? nomeDisp(dCozinha) : 'Não escolhida') : impAntiga?.nome ?? 'Não escolhida'} testid="sit-cozinha" />
                  <ItemSituacao ico={<Wallet />} cor="teal" rotulo="Caixa" e={beta ? (pronta(dCaixa) ? 'ok' : dCaixa ? 'warn' : 'off') : 'off'} valor={beta ? (dCaixa ? nomeDisp(dCaixa) : 'Não escolhida') : 'Só no Assistente novo'} testid="sit-caixa" />
                  <ItemSituacao ico={<Printer />} cor="ok" rotulo="Última impressão" e={ultimoErro.length ? 'bad' : (beta ? !!ultimoUso : atualOnline) ? 'ok' : 'off'} valor={ultimoErro.length ? `Erro, ${quando(ultimoErro[0].ultimoErroEm)}` : beta ? (quando(ultimoUso) || 'Nenhuma ainda') : (atualVistoEm ? `Sinal ${quando(atualVistoEm)}` : 'Nenhuma ainda')} testid="sit-ultima" />
                </div>
                <details className="ti-tec" data-testid="detalhes-tecnicos">
                  <summary>Detalhes técnicos <ChevronDown className="ti-chev h-4 w-4" aria-hidden /></summary>
                  <dl className="ti-tec-tab">
                    <dt>Versão instalada</dt><dd>{beta ? `${versao ?? '—'}${desatualizado ? ` (disponível: ${VERSAO_IMPRESSAO_V3})` : ''}` : DOWNLOAD_ASSISTENTE_ATUAL.versao}</dd>
                    <dt>Computador</dt>
                    <dd>
                      {beta ? (ativos.length ? ativos.map((a) => (
                        <span key={a.id} className="mb-1 flex flex-wrap items-center gap-2">
                          {a.nome} · {a.versao ?? '—'} · {a.online ? 'conectado' : `sem sinal desde ${quando(a.vistoEm) || '—'}`}
                          <button type="button" className="ti-btn sm" style={{ height: 26, fontSize: 12 }} onClick={() => revogar(a)} data-testid={`revogar-${a.nome}`}>Desconectar</button>
                        </span>
                      )) : '—') : (atualVistoEm ? `Último sinal ${quando(atualVistoEm)}` : '—')}
                    </dd>
                    <dt>Largura</dt><dd>{beta ? (usadas.map((d) => `${nomeDisp(d)}: ${d.larguraPontos ?? (d.larguraMm <= 58 ? 384 : 576)} pontos (${d.larguraMm} mm)`).join(' · ') || '—') : `${larguraAnt <= 40 ? 384 : 576} pontos (${larguraAnt <= 40 ? 58 : 80} mm)`}</dd>
                    {beta && usadas.length > 0 && <>
                      <dt>Tamanho da letra</dt>
                      <dd className="flex flex-col gap-1.5">
                        {usadas.map((d) => (
                          <label key={d.id} className="flex flex-wrap items-center gap-2">
                            {usadas.length > 1 && <span>{nomeDisp(d)}:</span>}
                            <select className="ti-campo h-[32px]" aria-label={`Tamanho da letra de ${nomeDisp(d)}`} value={d.tamanhoFonte} disabled={ocupado} onChange={(e) => void ajustar(d, { tamanhoFonte: e.target.value as TamanhoLetra })} data-testid={`letra-${d.id}`}>
                              {TAMANHOS_LETRA.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                            </select>
                          </label>
                        ))}
                      </dd>
                    </>}
                    <dt>Envio</dt><dd>{beta ? (usadas.map((d) => `${nomeDisp(d)}: ${d.envio === 'raw_rede' ? `rede ${d.redeIp ?? ''}:${d.redePorta}` : d.envio === 'raw_fila' ? 'RAW USB direto' : 'driver do Windows'}`).join(' · ') || '—') : 'driver do Windows'}</dd>
                    <dt>Modo de impressão</dt><dd>{beta ? (usadas.map((d) => `${nomeDisp(d)}: ${d.modoImpressao === 'texto' ? 'texto (WPC1252)' : 'imagem 1 bit'}`).join(' · ') || '—') : 'imagem (print.ps1)'}</dd>
                    <dt>Últimos erros</dt><dd>{ultimoErro.length ? ultimoErro.map((d) => `${nomeDisp(d)}: ${d.ultimoErro ?? 'erro'} (${quando(d.ultimoErroEm)})`).join(' · ') : 'Nenhum nas últimas 24 h'}</dd>
                    {config && <>
                      <dt>Impressão automática</dt>
                      <dd><button type="button" className="ti-sw" role="switch" aria-checked={config.impressaoAutomatica} aria-label="Imprimir sozinho quando o pedido chega" disabled={!podeEditar} onClick={() => void patchConfig({ impressaoAutomatica: !config.impressaoAutomatica })} data-testid="opcao-impressaoAutomatica" /></dd>
                      <dt>Aceitar pedidos sozinho</dt>
                      <dd><button type="button" className="ti-sw" role="switch" aria-checked={config.aceitarPedidosAutomaticamente} aria-label="Aceitar pedidos automaticamente" disabled={!podeEditar} onClick={() => void patchConfig({ aceitarPedidosAutomaticamente: !config.aceitarPedidosAutomaticamente })} data-testid="opcao-aceitarPedidosAutomaticamente" /></dd>
                      {!beta && <>
                        <dt>Assistente ativado</dt>
                        <dd><button type="button" className="ti-sw" role="switch" aria-checked={config.ativarAssistente} aria-label="Assistente de impressão ativado" disabled={!podeEditar} onClick={() => void patchConfig({ ativarAssistente: !config.ativarAssistente })} data-testid="opcao-ativarAssistente" /></dd>
                      </>}
                    </>}
                    <dt>Ajuda</dt><dd><button type="button" className="ti-btn sm" onClick={() => setAjuda(true)}>Guia e diagnóstico</button></dd>
                  </dl>
                </details>
              </section>
            </div>
          )}

          {/* ── janelas ─────────────────────────────────────────────────────────── */}
          <NoTopo classe="tela-impressao"><ModalAjudaImpressao aberto={ajuda} onFechar={() => setAjuda(false)} /></NoTopo>
          {pareando && <ModalPareamento codigo={pareando.codigo} erro={pareando.erro} conectado={pareando.conectado} onGerarOutro={() => void abrirPareamento()} onFechar={() => setPareando(null)} />}
          {escolhendo && p && <ModalImpressoras p={p} ocupado={ocupado} onSalvar={salvarImpressoras} onAjustar={ajustar} onAtualizar={carregar} onFechar={() => setEscolhendo(false)} />}
          {testando && p && <ModalTestes p={p} onTestar={testar} onFechar={() => setTestando(false)} />}
          {opcao && (
            <ModalPrevia
              aberto={previa}
              onFechar={() => setPrevia(false)}
              opcao={opcao}
              docInicial="comanda"
              dados={dadosPrevia}
              config={config}
              papelBeta={papelDe(dCozinha)}
              papelPreConta={papelDe(dCaixa ?? dCozinha)}
              antigo={{ larguraMm: larguraAnt <= 40 ? 58 : 80, colunas: ReciboAntigo.colsParaFonte(impAntiga?.tamanhoFonte, larguraAnt) }}
            />
          )}
          {p && prontidao && (
            <GuiaInstalacao
              opcao={guia}
              prontidao={prontidao}
              antigo={{ instalado: !!atualVistoEm, online: atualOnline, token, podeEditar }}
              ocupado={ocupado}
              onFechar={() => setGuia(null)}
              onParear={() => void abrirPareamento()}
              onEscolher={() => setEscolhendo(true)}
              onGerarToken={() => void gerarToken()}
              onAtivar={(o) => void confirmarTroca(o)}
            />
          )}
          <ModalCentral
            aberto={trocar !== null}
            onFechar={() => setTrocar(null)}
            largura={440}
            classeTema="tela-impressao"
            testid="confirmar-opcao"
            titulo={trocar === 'beta' ? 'Imprimir pelo Assistente novo?' : 'Voltar para o Assistente antigo?'}
            rodape={
              <div className="flex justify-end gap-2">
                <button type="button" className="ti-btn" onClick={() => setTrocar(null)}>Cancelar</button>
                <button type="button" className="ti-btn pri" disabled={ocupado} onClick={() => trocar && void confirmarTroca(trocar)} data-testid="confirmar-opcao-ok">Confirmar</button>
              </div>
            }
          >
            <p className="px-5 py-4 text-[14px] leading-[20px]" data-testid="confirmar-opcao-texto">{trocar ? CONFIRMACAO_OPCAO[trocar] : ''}</p>
          </ModalCentral>
          <ModalCentral aberto={comoAtualizar} onFechar={() => setComoAtualizar(false)} largura={460} classeTema="tela-impressao" testid="modal-como-atualizar" titulo={`Como atualizar para o ${VERSAO_IMPRESSAO_V3}`}>
            <ol className="list-decimal space-y-2 px-9 py-4 text-[14px]">
              <li>No computador da impressora, clique em <b>Baixar instalador</b> (passo 2).</li>
              <li>Abra o arquivo baixado e instale <b>por cima</b>, sem desinstalar. A conexão com a loja continua.</li>
              <li>Volte aqui: a versão nova aparece em <b>Situação geral</b> e o aviso some.</li>
            </ol>
          </ModalCentral>
          {calibrar && p?.dispositivos.find((d) => d.id === calibrar) && <NoTopo classe="tela-impressao"><Calibracao d={p.dispositivos.find((d) => d.id === calibrar)!} ocupado={ocupado} agir={agir} onFechar={() => setCalibrar(null)} /></NoTopo>}
          {modalImpressora && <NoTopo classe="tela-impressao"><ImpressoraModal initial={modalImpressora.input} onClose={() => setModalImpressora(null)} onSave={salvarImpressoraAntiga} /></NoTopo>}
        </main>
      </div>
    </div>
  )
}

// ─── peças da tela ──────────────────────────────────────────────────────────

function Passo({ n, estado, titulo, sub, children, testid }: { n: number; estado: string; titulo: string; sub: string; children: React.ReactNode; testid: string }) {
  return (
    <section className={`ti-passo ${estado === 'atual' ? 'ativo' : ''}`} aria-labelledby={`${testid}-t`} data-testid={testid} data-estado={estado || 'neutro'}>
      <div className="ti-passo-cab">
        <span className={`ti-num ${estado}`} aria-label={estado === 'feito' ? `Passo ${n} concluído` : `Passo ${n}`}>{n}</span>
        <div className="min-w-0">
          <h3 id={`${testid}-t`}>{titulo}</h3>
          <p className="ti-sub">{sub}</p>
        </div>
      </div>
      <div className="ti-passo-corpo">{children}</div>
    </section>
  )
}

function OpcaoCard({ o, ativo, disabled, onClick, titulo, selo, frase, itens, rec }: { o: OpcaoImpressao; ativo: boolean; disabled: boolean; onClick: () => void; titulo: string; selo: string; frase: string; itens: string[]; rec?: boolean }) {
  return (
    <button type="button" className="ti-opcao" role="radio" aria-checked={ativo} disabled={disabled} onClick={onClick} data-testid={`opcao-${o}`}>
      <span className="t"><span className="ti-radio" />{titulo}<span className={`ti-selo ${rec ? 'rec' : ''}`}>{selo}</span></span>
      <p>{frase}</p>
      <ul>{itens.map((i) => <li key={i}><Check aria-hidden />{i}</li>)}</ul>
      {ativo && <span className="ti-emuso" data-testid="opcao-em-uso"><i className="ti-dot" />Em uso na sua loja</span>}
    </button>
  )
}

function Bloco({ ico, cor, titulo, texto, children, antes, testid }: { ico: React.ReactNode; cor: string; titulo: string; texto: string; children: React.ReactNode; antes?: React.ReactNode; testid: string }) {
  return (
    <div className="ti-bloco" data-testid={testid}>
      <div className="ti-bloco-cab"><span className={`ti-ico ${cor}`}>{ico}</span><div className="min-w-0"><h4>{titulo}</h4><p>{texto}</p></div></div>
      {antes && <div className="mb-3 [&>.ti-aviso]:mt-0 [&>.ti-aviso+.ti-aviso]:mt-2">{antes}</div>}
      <div className="ti-acoes">{children}</div>
    </div>
  )
}

function ItemSituacao({ ico, cor, rotulo, valor, e, testid }: { ico: React.ReactNode; cor: string; rotulo: string; valor: string; e: Estado; testid: string }) {
  return (
    <div className="ti-it" data-testid={testid} data-estado={e}>
      <span className={`ti-ico ${cor}`}>{ico}</span>
      <div className="min-w-0"><small>{rotulo}</small><b><Ponto e={e} /><span title={valor}>{valor}</span></b></div>
    </div>
  )
}

type ChaveOpcao = 'imprimirLogo' | 'mostrarNumeroItem' | 'mostrarNomeComplementos' | 'mostrarPrecoComplementos' | 'multiplicarOpcoesQtd' | 'fonteMaiorProducao' | 'viaCozinha' | 'qr'
const OPCOES_PAPEL: { chave: ChaveOpcao; titulo: string; frase: string; so?: 'beta' | 'antigo' }[] = [
  { chave: 'imprimirLogo', titulo: 'Logo da loja', frase: 'Imprime a logo em preto e branco no topo.' },
  { chave: 'mostrarNumeroItem', titulo: 'Quantidade no item', frase: 'Mostra "2x" antes do nome do produto.' },
  { chave: 'mostrarNomeComplementos', titulo: 'Adicionais', frase: 'Mostra os adicionais escolhidos pelo cliente.' },
  // No modelo novo o adicional sai no nome do item, com o valor somado ao dele.
  { chave: 'mostrarPrecoComplementos', titulo: 'Preço dos adicionais', frase: 'Mostra o valor de cada adicional.', so: 'antigo' },
  { chave: 'multiplicarOpcoesQtd', titulo: 'Multiplicar adicionais', frase: 'Com 2 lanches, mostra "2x Bacon" quando cada um leva bacon.' },
  { chave: 'fonteMaiorProducao', titulo: 'Letra maior nos itens', frase: 'Facilita a leitura na cozinha.' },
  { chave: 'viaCozinha', titulo: 'Via da cozinha sem valores', frase: 'Uma via a mais, só com itens e observações, logo depois da comanda.', so: 'beta' },
  { chave: 'qr', titulo: 'QR Code do cardápio', frase: 'No rodapé, para o cliente pedir de novo.', so: 'beta' },
]

// ─── guia de instalação antes de trocar de assistente ───────────────────────

function GuiaInstalacao({ opcao, prontidao, antigo, ocupado, onFechar, onParear, onEscolher, onGerarToken, onAtivar }: {
  opcao: OpcaoImpressao | null
  prontidao: ReturnType<typeof prontidaoBeta>
  antigo: { instalado: boolean; online: boolean; token: string | null; podeEditar: boolean }
  ocupado: boolean
  onFechar: () => void
  onParear: () => void
  onEscolher: () => void
  onGerarToken: () => void
  onAtivar: (o: OpcaoImpressao) => void
}) {
  const beta = opcao === 'beta'
  const passos = beta
    ? prontidao.passos.map((x) => ({ id: x.id, titulo: x.titulo, feito: x.feito }))
    : [
        { id: 'instalar', titulo: 'Instalar o Assistente antigo no computador da impressora', feito: antigo.instalado },
        { id: 'conectar', titulo: 'Abrir o Assistente e colar o token da loja', feito: antigo.online },
      ]
  const pronto = beta ? prontidao.pronto : antigo.online
  const acoes: Record<string, React.ReactNode> = beta
    ? {
        instalar: <a href={DOWNLOAD_ASSISTENTE_BETA.url} className="ti-btn sm" data-testid="ativar-baixar"><Download aria-hidden /> Baixar</a>,
        parear: <button type="button" className="ti-btn sm" onClick={onParear} disabled={ocupado} data-testid="ativar-parear">Gerar código</button>,
        impressoras: <button type="button" className="ti-btn sm" onClick={onEscolher} disabled={!prontidao.conectado} data-testid="ativar-impressoras">Escolher impressoras</button>,
      }
    : {
        instalar: <a href={DOWNLOAD_ASSISTENTE_ATUAL.url} className="ti-btn sm" data-testid="ativar-baixar"><Download aria-hidden /> Baixar</a>,
        conectar: antigo.podeEditar ? (antigo.token
          ? <button type="button" className="ti-btn sm" onClick={() => void navigator.clipboard.writeText(antigo.token ?? '')} data-testid="ativar-copiar-token">Copiar token</button>
          : <button type="button" className="ti-btn sm" onClick={onGerarToken} data-testid="ativar-gerar-token">Gerar token</button>) : null,
      }
  return (
    <ModalCentral
      aberto={opcao !== null}
      onFechar={onFechar}
      largura={560}
      classeTema="tela-impressao"
      testid="ativar-beta"
      titulo={beta ? 'Ativar o Assistente novo' : 'Voltar para o Assistente antigo'}
      subtitulo={opcao ? CONFIRMACAO_OPCAO[opcao] : undefined}
      rodape={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="ti-rot">{pronto ? 'Tudo pronto.' : 'Enquanto isso, a loja continua imprimindo como hoje.'}</p>
          <div className="flex gap-2">
            <button type="button" className="ti-btn" onClick={onFechar}>Agora não</button>
            <button type="button" className="ti-btn pri" disabled={!pronto || ocupado || (beta && !prontidao.liberado)} onClick={() => opcao && onAtivar(opcao)} data-testid="ativar-confirmar"><Sparkles aria-hidden /> Ativar</button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 px-4 py-4 sm:px-5">
        {beta && !prontidao.liberado && (
          <Aviso acao={<a href={SUPORTE_URL} target="_blank" rel="noopener noreferrer" className="ti-btn">Falar com o suporte</a>}>O suporte Menuzia libera o Assistente novo para a sua loja. Os passos abaixo já podem ser feitos.</Aviso>
        )}
        <ol className="space-y-2.5" data-testid="ativar-passos">
          {passos.map((passo, i) => (
            <li key={passo.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border px-3 py-2.5" style={{ borderColor: 'var(--ti-line)' }} data-testid={`ativar-passo-${passo.id}`} data-feito={passo.feito ? 'sim' : 'nao'}>
              <span className="flex min-w-0 items-center gap-2.5 text-[13.5px]">
                <span className={`ti-num ${passo.feito ? 'feito' : 'atual'}`} style={{ width: 24, height: 24, fontSize: 12 }}>{passo.feito ? <Check className="h-3.5 w-3.5" aria-label="Feito" /> : i + 1}</span>
                <span>{passo.titulo}</span>
              </span>
              {!passo.feito && acoes[passo.id]}
            </li>
          ))}
        </ol>
        <p className="ti-rot">Instale no computador ligado à impressora e abra o Assistente. <a href="/guia-impressora.html" target="_blank" rel="noopener noreferrer" className="font-semibold underline" style={{ color: 'var(--ti-pri-dk)' }}>Guia passo a passo</a></p>
      </div>
    </ModalCentral>
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
