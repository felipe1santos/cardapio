'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Download, Monitor, Pencil, Printer, ReceiptText, ScrollText, Trash2, X } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { chamar, novaChave } from '@/components/pdv/util'
import { ModalAjudaImpressao } from '@/components/impressao/ajuda-impressao'
import { ImpressoraModal } from '@/components/impressao/documentos'
import { EnvioImpressora } from '@/components/impressao/envio-impressora'
import { ModalPrevia, type LojaPrevia, type PapelPrevia } from '@/components/impressao/modal-previa'
import { ModalPareamento, ModalTestes, nomeDisp, TAMANHOS_LETRA, type PainelDados, type ResultadoTeste, type TamanhoLetra, type TipoTeste } from '@/components/impressao/beta-cards'
import { Flutuante, ModalCentral, NoTopo } from '@/components/ui/flutuante'
import { ROTULO_MODO_BETA, DOWNLOAD_ASSISTENTE_ATUAL, DOWNLOAD_ASSISTENTE_BETA, instaladorConectado } from '@/lib/impressao/rotulos'
import { modoDependeDoAgente, ehImpressoraVirtual, pareamentoAntigo } from '@/lib/impressao/regras-modo'
import { avisoDriver, envioDiretoSugerido } from '@/lib/impressao/regras-calibracao'
import { prontidaoBeta, versaoInstalada } from '@/lib/impressao/opcao'
import { compararVersao, VERSAO_IMPRESSAO_V3 } from '@/lib/avisos-painel'
import { SUPORTE_MENUZIA } from '@/lib/suporte'
import ReciboAntigo from '@/lib/impressao/recibo-antigo-canvas.js'
import type { AgenteVisao, DispositivoVisao, ModoBeta } from '@/lib/impressao/servico'
import { ROTULO_FUNCAO_IMPRESSORA, type FuncaoImpressora } from '@/lib/impressao/funcoes'

/**
 * Na tela só existem duas funções (decisão do dono, 2026-10-08): "Imprimir cozinha" e "Imprimir
 * pré-conta". A "Comanda de entrega" continua no banco e no servidor; só aparece no menu da
 * impressora que já a tem, para poder ser desmarcada.
 */
const FUNCOES_NA_TELA: FuncaoImpressora[] = ['cozinha', 'caixa'] // item 61: a "Comanda de entrega" saiu de vez
const ROTULO_NA_TELA: Record<FuncaoImpressora, string> = { cozinha: 'Imprimir cozinha', caixa: 'Imprimir pré-conta', entrega: 'Comanda de entrega' }
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { garantirLogoImpressao } from '@/lib/impressao/logo-navegador'
import Link from 'next/link'
import {
  atualizarConfigImpressao, atualizarImpressora, buscarConfigImpressao, buscarStatusAgente, listarImpressoras,
  type ConfigImpressao, type Impressora, type ImpressoraInput,
} from '@/lib/queries/impressao'

/**
 * Impressão — tela v2 (2026-10-07), uma coluna com três cards:
 *   1 Assistente de impressão — versão, situação real e "Baixar instalador" (e "Conectar este
 *     computador" quando o pareamento sem código está ativo e não há computador);
 *   2 Impressoras — adicionar (da lista que o Assistente achou no Windows, com apelido opcional),
 *     e cada impressora com apelido, nome técnico, situação, FUNÇÕES (Cozinha, Caixa / pré-conta,
 *     Comanda de entrega, Outra) e remover; "Testar impressão" no rodapé;
 *   3 O que aparece no papel — as opções reais em switches.
 * "Avançado" (link cinza, roxo no hover) abre a janela com computador, papel, envio, calibração e
 * as opções gerais. A escolha "antigo × novo" saiu da tela: loja que ainda imprime pelo antigo vê
 * só o aviso no card 1 — nenhum modo muda sozinho. Visual do kit ti- (fonte dos menus, peso 600).
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
  return hoje ? `hoje, ${hora}` : `${d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })}, ${hora}`
}
type Estado = 'ok' | 'warn' | 'bad' | 'off'
const Ponto = ({ e }: { e: Estado }) => <i className={`ti-dot ${e === 'ok' ? '' : e}`} aria-hidden />
const Aviso = ({ children, acao, erro, testid }: { children: React.ReactNode; acao?: React.ReactNode; erro?: boolean; testid?: string }) => (
  <div className={`ti-aviso ${erro ? 'erro' : ''}`} data-testid={testid}>
    <AlertTriangle aria-hidden />
    <span className="min-w-0">{children}</span>
    {acao}
  </div>
)

/** Como a impressora está ligada, pelo que o Assistente leu do Windows (porta) e pelo envio. */
function conexao(d: DispositivoVisao): string {
  if (ehImpressoraVirtual(d.nomeSistema)) return 'impressora virtual'
  const porta = String(d.diagnostico?.porta ?? '')
  if (d.redeIp || /^(IP_|\d{1,3}(\.\d{1,3}){3})/i.test(porta) || /WSD|TCP/i.test(porta)) return 'rede'
  if (/USB/i.test(porta)) return 'USB'
  return ''
}
const detalhe = (d: DispositivoVisao) => [conexao(d), `papel ${d.larguraMm} mm`].filter(Boolean).join(' · ')

/** Opções do papel (as reais). Preço dos adicionais e letra maior só existem no Assistente antigo. */
type ChaveOpcao = 'imprimirLogo' | 'mostrarNumeroItem' | 'mostrarNomeComplementos' | 'multiplicarOpcoesQtd' | 'viaCozinha' | 'qr' | 'mostrarPrecoComplementos' | 'fonteMaiorProducao'
const OPCOES_PAPEL: { chave: ChaveOpcao; titulo: string; frase: string }[] = [
  { chave: 'imprimirLogo', titulo: 'Logo da loja', frase: 'A logo em preto e branco no topo do papel.' },
  { chave: 'mostrarNumeroItem', titulo: 'Quantidade no item', frase: 'Mostra "2x" antes do nome do produto.' },
  { chave: 'mostrarNomeComplementos', titulo: 'Adicionais', frase: 'Mostra os adicionais que o cliente escolheu.' },
  { chave: 'multiplicarOpcoesQtd', titulo: 'Múltipla escolha', frase: 'Com 2 lanches, mostra "2x Bacon" quando cada um leva bacon.' },
  // Item 61: só dois modelos (Cozinha e Pré-conta) — a "Via da cozinha" saiu. O QR do papel é o
  // Instagram da loja na pré-conta (a comanda de entrega leva sempre o QR da rota).
  { chave: 'qr', titulo: 'QR Code do Instagram na pré-conta', frase: 'No rodapé da pré-conta, para o cliente seguir a loja.' },
]
const OPCOES_ANTIGO: { chave: ChaveOpcao; titulo: string; frase: string }[] = [
  { chave: 'mostrarPrecoComplementos', titulo: 'Preço dos adicionais', frase: 'Mostra o valor de cada adicional (assistente antigo).' },
  { chave: 'fonteMaiorProducao', titulo: 'Letra maior nos itens', frase: 'Facilita a leitura na cozinha (assistente antigo).' },
]

export function PainelImpressao() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [p, setP] = useState<(PainelDados & { funcoes: Record<FuncaoImpressora, string | null> }) | null>(null)
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
  const [testando, setTestando] = useState(false)
  const [ajuda, setAjuda] = useState(false)
  const [calibrar, setCalibrar] = useState<string | null>(null)
  const [previa, setPrevia] = useState(false)
  const [avancado, setAvancado] = useState(false)
  const [dadosPrevia, setDadosPrevia] = useState<LojaPrevia | null>(null)
  const [trocar, setTrocar] = useState<'beta' | 'antigo' | null>(null)
  const [modalImpressora, setModalImpressora] = useState<{ id: string; input: ImpressoraInput } | null>(null)
  const [novaId, setNovaId] = useState('')
  const [novoApelido, setNovoApelido] = useState('')
  const [copiado, setCopiado] = useState(false)
  const seq = useRef(0)
  const chavesTeste = useRef<Record<string, string>>({})

  const carregar = useCallback(async () => {
    const minha = ++seq.current
    const r = await chamar<PainelDados & { funcoes: Record<FuncaoImpressora, string | null> }>('/api/admin/impressao/painel')
    if (minha !== seq.current) return
    if (!r.ok || !r.dados) return setErro(r.erro)
    setErro(null)
    setP(r.dados)
  }, [])

  const rapido = !!pareando && !pareando.conectado
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
      .then((j) => { if (vivo) setDadosPrevia({ loja: j?.loja ?? { nome: '', telefone: '', endereco: '' }, qr: j?.qr ?? null, qrRota: j?.qrRota ?? null, logoUrl: j?.logoUrl ?? null, temInstagram: j?.temInstagram === true }) })
      .catch(() => { if (vivo) setDadosPrevia({ loja: { nome: '', telefone: '', endereco: '' }, qr: null, logoUrl: null, temInstagram: true }) })
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
    if (!liberado || !logoUrl) return
    void garantirLogoImpressao(logoUrl)
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

  /** Pareamento sem código (Assistente 0.2.0-beta.10): convite de 24 h no link menuzia://parear. */
  async function conectarEsteComputador() {
    const r = await chamar<{ link: string }>('/api/admin/impressao/convite', { method: 'POST' })
    if (!r.ok || !r.dados?.link) return setAviso({ tom: 'erro', texto: r.erro ?? 'Não foi possível gerar o link.' })
    window.location.href = r.dados.link
    setAviso({ tom: 'ok', texto: 'Se o Assistente estiver instalado neste computador, ele abre e se conecta sozinho em alguns segundos. Se nada abrir, baixe o instalador.' })
    setTimeout(() => void carregar(), 6000)
  }

  async function abrirPareamento() {
    setPareando({ codigo: null, erro: null, antes: (p?.agentes ?? []).map((a) => a.id), conectado: null })
    const r = await chamar<{ codigo: string; expiraEm: string }>('/api/admin/impressao/pareamento', { method: 'POST' })
    setPareando((x) => (x ? { ...x, codigo: r.ok && r.dados ? r.dados : null, erro: r.ok ? null : r.erro ?? 'Não foi possível gerar o código.' } : x))
  }

  /** Liga/desliga uma função nesta impressora. "Outra" = sem função nenhuma. */
  async function alternarFuncao(d: DispositivoVisao, f: FuncaoImpressora | 'outra') {
    if (!p) return
    if (f === 'outra') {
      for (const x of d.funcoes) await agir('/api/admin/impressao/funcoes', 'PUT', { funcao: x, dispositivoId: null, confirmarCompartilhada: true }, `${nomeDisp(d)} sem função.`)
      return
    }
    const tem = p.funcoes[f] === d.id
    await agir('/api/admin/impressao/funcoes', 'PUT', { funcao: f, dispositivoId: tem ? null : d.id, confirmarCompartilhada: true },
      tem ? `${ROTULO_FUNCAO_IMPRESSORA[f]} saiu de ${nomeDisp(d)}.` : `${nomeDisp(d)} agora imprime: ${ROTULO_FUNCAO_IMPRESSORA[f]}.`)
  }

  async function adicionar() {
    const d = p?.dispositivos.find((x) => x.id === novaId)
    if (!d) return
    const r = await agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', { naLista: true, ...(novoApelido.trim() ? { apelido: novoApelido.trim() } : {}) }, `${novoApelido.trim() || d.nomeSistema} adicionada.`)
    if (r?.ok) { setNovaId(''); setNovoApelido('') }
  }

  function remover(d: DispositivoVisao) {
    const funcoes = d.funcoes.map((f) => ROTULO_FUNCAO_IMPRESSORA[f]).join(', ')
    if (!confirm(`Remover ${nomeDisp(d)} da lista?${funcoes ? ` Ela deixa de imprimir: ${funcoes}.` : ''}`)) return
    void agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', { naLista: false }, `${nomeDisp(d)} removida da lista.`)
  }

  async function ajustar(d: DispositivoVisao, patch: { apelido?: string; larguraMm?: number; tamanhoFonte?: TamanhoLetra; envio?: string }) {
    return agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', patch,
      patch.apelido !== undefined ? 'Apelido salvo.' : patch.tamanhoFonte !== undefined ? 'Tamanho da letra salvo.' : patch.envio !== undefined ? 'Formato de envio salvo.' : 'Papel salvo.')
  }

  function revogar(a: AgenteVisao) {
    if (!p) return
    const emUso = modoDependeDoAgente(p.modo, a.id, p.dispositivos.map((d) => ({ id: d.id, agenteId: d.agenteId, nomeSistema: d.nomeSistema })), p.funcoes)
    const texto = emUso
      ? `"${a.nome}" imprime os pedidos da loja. Ao desconectar, a loja volta na hora para o assistente antigo. Desconectar?`
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
    if (token && !confirm('Gerar um token novo? O assistente antigo para de imprimir até você colar o token novo nele.')) return
    const res = await fetch('/api/admin/impressao/token', { method: 'POST' }).catch(() => null)
    if (!res?.ok) return setAviso({ tom: 'erro', texto: 'Não foi possível gerar o token.' })
    setToken(((await res.json()) as { token: string }).token)
  }

  async function salvarImpressoraAntiga(input: ImpressoraInput) {
    if (!modalImpressora) return
    await atualizarImpressora(supabase, modalImpressora.id, input)
    setImpAntigas((l) => l.map((i) => (i.id === modalImpressora.id ? { ...i, ...input } : i)))
    setModalImpressora(null)
  }

  /** Troca auditada (impressao_modo_definir): só quando a loja confirma. */
  async function confirmarTroca(o: 'beta' | 'antigo') {
    const r = await agir('/api/admin/impressao/modo', 'PUT', { modo: o === 'beta' ? 'cozinha_caixa' : 'teste' }, o === 'beta' ? 'Pronto: a loja imprime pelo assistente novo.' : 'Pronto: a loja voltou para o assistente antigo.')
    if (r?.ok) setTrocar(null)
  }

  // ── leitura do estado ───────────────────────────────────────────────────────
  const antigo = p?.modo === 'teste'
  const atualOnline = !!atualVistoEm && Date.now() - new Date(atualVistoEm).getTime() < 2 * 60_000
  // Mesmo PC pareado duas vezes: o registro antigo (sem sinal) some do resumo e da lista; no
  // Avançado › Computador ele aparece marcado, para ser desconectado.
  const todosAtivos = p?.agentes.filter((a) => !a.revogado) ?? []
  const regraAgentes = (p?.agentes ?? []).map((a) => ({ id: a.id, nome: a.nome, vistoEm: a.vistoEm, revogado: a.revogado, criadoEm: a.criadoEm }))
  const agenteAntigo = (a: { id: string }) => { const r = regraAgentes.find((x) => x.id === a.id); return !!r && pareamentoAntigo(r, regraAgentes) }
  const ativos = todosAtivos.filter((a) => !agenteAntigo(a))
  const online = ativos.filter((a) => a.online)
  const versao = p ? versaoInstalada(p.agentes) : null
  const desatualizado = !!versao && compararVersao(versao, VERSAO_IMPRESSAO_V3) < 0
  const agenteDe = (d: DispositivoVisao | undefined) => (d ? todosAtivos.find((a) => a.id === d.agenteId) : undefined)

  const antigoPareamento = (d: DispositivoVisao) => { const a = regraAgentes.find((x) => x.id === d.agenteId); return !!a && pareamentoAntigo(a, regraAgentes) }
  // Mesma impressora nos dois pareamentos: fica só a do pareamento novo.
  const naLista = (p?.dispositivos ?? []).filter((d) => d.naLista && agenteDe(d)
    && !(antigoPareamento(d) && (p?.dispositivos ?? []).some((x) => x.id !== d.id && x.naLista && agenteDe(x) && !antigoPareamento(x) && x.nomeSistema === d.nomeSistema)))
  const paraAdicionar = (p?.dispositivos ?? [])
    .filter((d) => !d.naLista && agenteDe(d) && d.disponivel && !antigoPareamento(d))
    .sort((a, b) => Number(ehImpressoraVirtual(a.nomeSistema)) - Number(ehImpressoraVirtual(b.nomeSistema)) || a.nomeSistema.localeCompare(b.nomeSistema))
  const dCozinha = p?.dispositivos.find((d) => d.id === p.funcoes.cozinha)
  const dCaixa = p?.dispositivos.find((d) => d.id === p.funcoes.caixa)
  const prontidao = p ? prontidaoBeta(p) : null
  const impAntiga = impAntigas.find((i) => i.id === atualImpressoraId) ?? impAntigas.find((i) => i.ativa) ?? impAntigas[0] ?? null
  const larguraAnt = impAntiga?.largura ?? 48
  const tudoCerto = !!p && !antigo && online.length > 0 && !!dCozinha && !!agenteDe(dCozinha)?.online
  const semCodigo = instaladorConectado() && p?.betaLiberado === true

  return (
    <div className="tela-impressao flex h-full min-h-0 flex-col overflow-hidden">
      <TopBar title="Impressão" breadcrumb="Pedidos no papel" />
      <div className="ti-fundo min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="impressao-rolagem">
        <main className="ti-pagina" data-testid="painel-impressao">
          {/* ── cabeçalho ─────────────────────────────────────────────────────── */}
          <div className="ti-cab">
            <div className="min-w-0">
              <h2>Impressão de pedidos</h2>
              <p>Deixe a impressora pronta e escolha o que sai no papel.</p>
            </div>
            <button type="button" className="ti-btn" onClick={() => setPrevia(true)} disabled={!p} data-testid="ver-modelo"><ReceiptText aria-hidden /> Ver modelo de impressão</button>
          </div>

          {aviso && (
            <div role="status" data-testid="impressao-aviso" className={`ti-aviso mb-3 mt-0 ${aviso.tom === 'erro' ? 'erro' : ''}`} style={aviso.tom === 'ok' ? { background: 'var(--ti-ok-soft)', borderColor: '#A8DCC3', color: '#0B5B3E' } : undefined}>
              {aviso.tom === 'ok' ? <Check aria-hidden style={{ color: 'var(--ti-ok)' }} /> : <AlertTriangle aria-hidden />}
              <span>{aviso.texto}</span>
            </div>
          )}
          {erro && <Aviso erro>{erro}</Aviso>}

          {!p ? (
            <div aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="ti-passo h-[150px] animate-pulse" />)}</div>
          ) : (
            <>
              {/* ── 1. Assistente de impressão ─────────────────────────────── */}
              <Card cor="azul" n={1} ico={<Monitor />} titulo="Assistente de impressão" sub="O programa que fica no computador da loja e manda os pedidos para a impressora." testid="passo-1"
                extra={tudoCerto ? <span className="ti-tudo-certo" data-testid="tudo-certo"><Check aria-hidden />Tudo certo</span> : null}>
                <div className="ti-linha-asst" data-testid="assistente-linha">
                  <div className="min-w-0">
                    <b data-testid="assistente-versao">Assistente Menuzia · versão {versao ?? DOWNLOAD_ASSISTENTE_BETA.versao.replace(/^0\.2\.0-/, '')}</b>
                    <span className={`ti-estado ${online.length ? 'ok' : 'warn'}`} data-testid="assistente-situacao">
                      <Ponto e={online.length ? 'ok' : 'warn'} />
                      {online.length ? `Conectado em ${online[0].nome}` : ativos.length ? `Desconectado — ${[...ativos].sort((x, y) => (y.vistoEm ?? '').localeCompare(x.vistoEm ?? ''))[0].nome}, último sinal ${quando([...ativos].sort((x, y) => (y.vistoEm ?? '').localeCompare(x.vistoEm ?? ''))[0].vistoEm) || '—'}` : 'Desconectado'}
                    </span>
                  </div>
                  <div className="ti-acoes justify-end">
                    {semCodigo && !ativos.length && (
                      <button type="button" className="ti-btn" onClick={() => void conectarEsteComputador()} disabled={ocupado} data-testid="conectar-este-computador">Conectar este computador</button>
                    )}
                    {semCodigo ? (
                      <form method="post" action="/api/admin/impressao/instalador" className="contents">
                        <button type="submit" className="ti-btn pri" data-testid="baixar-instalador"><Download aria-hidden /> Baixar instalador</button>
                      </form>
                    ) : (
                      <a className="ti-btn pri" href={DOWNLOAD_ASSISTENTE_BETA.url} data-testid="baixar-instalador"><Download aria-hidden /> Baixar instalador</a>
                    )}
                  </div>
                </div>
                {antigo && (
                  <Aviso testid="aviso-antigo" acao={prontidao?.pronto ? <button type="button" className="ti-btn" onClick={() => setTrocar('beta')} data-testid="usar-novo">Usar o assistente novo</button> : undefined}>
                    Sua loja usa o assistente antigo. Instale o novo para continuar imprimindo.
                  </Aviso>
                )}
                {p.modo === 'caixa' && (
                  <Aviso testid="aviso-so-caixa" erro={config?.ativarAssistente === false || !atualOnline}
                    acao={<button type="button" className="ti-btn" onClick={() => (prontidao?.pronto ? setTrocar('beta') : setAviso({ tom: 'alerta', texto: 'Escolha a impressora da Cozinha no card 2 (com o computador conectado) e toque de novo.' }))} data-testid="passar-comanda">Passar a comanda para o novo</button>}>
                    <b>Modo misto:</b> o assistente novo imprime só a pré-conta; a <b>comanda da cozinha</b> sai pelo antigo.
                    {config?.ativarAssistente === false
                      ? <> O assistente antigo está <b>desativado</b>: a comanda da cozinha não está saindo.</>
                      : !atualOnline ? <> O assistente antigo está <b>sem sinal</b>: a comanda da cozinha pode não estar saindo.</> : null}
                  </Aviso>
                )}
                {!antigo && desatualizado && (
                  <Aviso testid="aviso-versao" acao={<a className="ti-btn" href={DOWNLOAD_ASSISTENTE_BETA.url} data-testid="aviso-versao-baixar"><Download aria-hidden /> Baixar a versão nova</a>}>
                    Este computador está na versão <b>{versao.replace(/^0.2.0-/, '')}</b>. Baixe a <b>{VERSAO_IMPRESSAO_V3.replace(/^0.2.0-/, '')}</b> e abra o instalador no computador da impressora: ele instala por cima, sem desinstalar, e o assistente volta conectado sozinho.{compararVersao(versao, '0.2.0-beta.11') >= 0 ? ' Este computador já se atualiza sozinho fora do horário de pico.' : ' A partir desta versão ele se atualiza sozinho.'}
                  </Aviso>
                )}
                {!p.betaLiberado && (
                  <Aviso testid="aviso-liberacao" acao={<a className="ti-btn" href={SUPORTE_URL} target="_blank" rel="noopener noreferrer">Falar com o suporte</a>}>O assistente novo ainda não foi liberado para a sua loja.</Aviso>
                )}
              </Card>

              {/* ── 2. Impressoras ─────────────────────────────────────────── */}
              <Card cor="roxo" n={2} ico={<Printer />} titulo="Impressoras" sub="Adicione as impressoras da loja e diga o que cada uma imprime." testid="passo-2">
                <div className="ti-add" data-testid="adicionar-linha">
                  <select className="ti-campo" aria-label="Impressora encontrada no Windows" value={novaId} onChange={(e) => setNovaId(e.target.value)} disabled={!paraAdicionar.length || ocupado} data-testid="adicionar-select">
                    <option value="">{!ativos.length ? 'Conecte o assistente para ver as impressoras' : paraAdicionar.length ? 'Escolha uma impressora do Windows' : 'Todas as impressoras já estão na lista'}</option>
                    {paraAdicionar.map((d) => <option key={d.id} value={d.id}>{d.nomeSistema}{ehImpressoraVirtual(d.nomeSistema) ? ' (virtual)' : ''}{ativos.length > 1 ? ` · ${agenteDe(d)?.nome ?? ''}` : ''}</option>)}
                  </select>
                  <input className="ti-input" placeholder="Apelido (opcional)" maxLength={40} value={novoApelido} onChange={(e) => setNovoApelido(e.target.value)} aria-label="Apelido da impressora (opcional)" data-testid="adicionar-apelido" />
                  <button type="button" className="ti-btn pri-roxo" disabled={!novaId || ocupado} onClick={() => void adicionar()} data-testid="adicionar-impressora">Adicionar</button>
                </div>

                {naLista.length > 0 ? (
                  <ul className="ti-imps" data-testid="lista-impressoras">
                    {naLista.map((d) => (
                      <LinhaImpressora key={d.id} d={d} p={p} online={!!agenteDe(d)?.online} ocupado={ocupado}
                        onApelido={(v) => ajustar(d, { apelido: v })} onFuncao={(f) => void alternarFuncao(d, f)} onRemover={() => remover(d)} />
                    ))}
                  </ul>
                ) : (
                  <p className="ti-rot mt-3" data-testid="sem-impressoras">{ativos.length ? 'Nenhuma impressora na lista. Escolha uma acima e toque em Adicionar.' : 'Instale e conecte o assistente (card 1): as impressoras do computador aparecem para adicionar.'}</p>
                )}

                <div className="ti-rodape-card">
                  <span className="ti-rot">Uma impressora pode ter mais de uma função.</span>
                  <button type="button" className="ti-btn" onClick={() => setTestando(true)} disabled={!naLista.length} data-testid="testar-impressao"><Printer aria-hidden /> Testar impressão</button>
                </div>
              </Card>

              {/* ── 3. O que aparece no papel ──────────────────────────────── */}
              <Card cor="verde" n={3} ico={<ScrollText />} titulo="O que aparece no papel" sub={'Vale para a próxima impressão. Confira em "Ver modelo de impressão".'} testid="passo-3">
                {config ? (
                  <div className="ti-switches" data-testid="opcoes-impressao">
                    {[...OPCOES_PAPEL, ...(antigo ? OPCOES_ANTIGO : [])].map((o) => (
                      <div key={o.chave} className="ti-opt">
                        <div><b id={`opt-${o.chave}`}>{o.titulo}</b><small>{o.frase}</small></div>
                        <button type="button" className="ti-sw verde" role="switch" aria-checked={!!config[o.chave]} aria-labelledby={`opt-${o.chave}`} disabled={!podeEditar} onClick={() => void patchConfig({ [o.chave]: !config[o.chave] } as Partial<ConfigImpressao>)} data-testid={`opcao-${o.chave}`} />
                      </div>
                    ))}
                  </div>
                ) : <p className="ti-rot">Carregando…</p>}
                {config && config.qr !== false && dadosPrevia && !dadosPrevia.temInstagram && (
                  <p className="ti-rot mt-2" data-testid="aviso-instagram">Cadastre o Instagram da loja para sair o QR na pré-conta. <Link href="/admin/ajustes" className="ti-link" style={{ fontSize: 'inherit' }}>Abrir o Perfil da loja</Link></p>
                )}
                {config && !podeEditar && <p className="ti-rot mt-2">Só o dono da loja altera estas opções.</p>}
              </Card>

              <button type="button" className="ti-avancado" onClick={() => setAvancado(true)} data-testid="abrir-avancado">Avançado</button>
            </>
          )}

          {/* ── janelas ─────────────────────────────────────────────────────────── */}
          <NoTopo classe="tela-impressao"><ModalAjudaImpressao aberto={ajuda} onFechar={() => setAjuda(false)} /></NoTopo>
          {pareando && <ModalPareamento codigo={pareando.codigo} erro={pareando.erro} conectado={pareando.conectado} onGerarOutro={() => void abrirPareamento()} onFechar={() => setPareando(null)} />}
          {testando && p && <NoTopo classe="tela-impressao"><ModalTestes p={{ ...p, dispositivos: naLista }} onTestar={testar} onFechar={() => setTestando(false)} /></NoTopo>}
          {p && (
            <ModalPrevia
              aberto={previa}
              onFechar={() => setPrevia(false)}
              opcao={antigo ? 'antigo' : 'beta'}
              docInicial="comanda"
              dados={dadosPrevia}
              config={config}
              papelBeta={papelDe(dCozinha)}
              papelPreConta={papelDe(dCaixa ?? dCozinha)}
              antigo={{ larguraMm: larguraAnt <= 40 ? 58 : 80, colunas: ReciboAntigo.colsParaFonte(impAntiga?.tamanhoFonte, larguraAnt) }}
              versaoAssistente={agenteDe(dCozinha)?.versao ?? versao ?? DOWNLOAD_ASSISTENTE_BETA.versao}
            />
          )}
          {p && (
            <ModalCentral aberto={avancado} onFechar={() => setAvancado(false)} largura={640} classeTema="tela-impressao" testid="modal-avancado" titulo="Avançado" subtitulo="Computador, papel, formato de envio e calibração.">
              <div className="ti-av">
                <SecaoAv titulo="Computador" testid="av-computador">
                  {todosAtivos.length ? todosAtivos.map((a) => (
                    <div key={a.id} className="ti-av-linha" data-testid={`av-agente-${a.id}`}>
                      <span className="min-w-0"><b>{a.nome}</b><small>{agenteAntigo(a) ? 'pareamento antigo — pode desconectar · ' : ''}versão {a.versao ?? '—'} · {a.online ? 'conectado agora' : `sem sinal desde ${quando(a.vistoEm) || '—'}`}</small></span>
                      <button type="button" className="ti-btn sm" onClick={() => revogar(a)} disabled={ocupado} data-testid={`revogar-${a.nome}`}>Desconectar</button>
                    </div>
                  )) : <p className="ti-rot">Nenhum computador conectado.</p>}
                  <div className="ti-acoes mt-2">
                    {semCodigo && <button type="button" className="ti-btn sm" onClick={() => void conectarEsteComputador()} disabled={ocupado} data-testid="av-conectar-este">Conectar este computador</button>}
                    <button type="button" className="ti-btn sm" onClick={() => void abrirPareamento()} disabled={ocupado} data-testid="trocar-computador">{ativos.length ? 'Trocar computador / parear novo PC' : 'Parear com código'}</button>
                  </div>
                </SecaoAv>

                <SecaoAv titulo="Largura do papel" testid="av-largura">
                  {naLista.length ? naLista.map((d) => (
                    <div key={d.id} className="ti-av-linha">
                      <span className="min-w-0 truncate">{nomeDisp(d)}</span>
                      <div className="ti-seg" role="group" aria-label={`Largura do papel de ${nomeDisp(d)}`}>
                        {([80, 58] as const).map((mm) => <button key={mm} type="button" aria-pressed={d.larguraMm === mm} disabled={ocupado} onClick={() => mm !== d.larguraMm && void ajustar(d, { larguraMm: mm })} data-testid={`largura-${d.id}-${mm}`}>{mm} mm</button>)}
                      </div>
                    </div>
                  )) : <p className="ti-rot">Adicione uma impressora no card 2.</p>}
                </SecaoAv>

                <SecaoAv titulo="Formato de envio" testid="av-envio" frase="Automático: tenta o envio direto (mais rápido) e, se falhar, imprime pelo Windows.">
                  {naLista.map((d) => {
                    const direto = d.envio === 'raw_fila' || d.envio === 'raw_rede'
                    return (
                      <div key={d.id} className="ti-av-linha">
                        <span className="min-w-0"><span className="block truncate">{nomeDisp(d)}</span>{d.envioCaminho && <small data-testid={`caminho-${d.id}`}>última: {d.envioCaminho === 'driver' ? 'pelo Windows' : 'envio direto'}</small>}</span>
                        <div className="ti-seg" role="group" aria-label={`Formato de envio de ${nomeDisp(d)}`}>
                          <button type="button" aria-pressed={d.envio === 'auto'} disabled={ocupado} onClick={() => d.envio !== 'auto' && void ajustar(d, { envio: 'auto' })} data-testid={`envio-${d.id}-auto`}>Automático</button>
                          <button type="button" aria-pressed={direto} disabled={ocupado} onClick={() => !direto && void ajustar(d, { envio: envioDiretoSugerido(d) })} data-testid={`envio-${d.id}-direto`}>Envio direto</button>
                          <button type="button" aria-pressed={d.envio === 'driver'} disabled={ocupado} onClick={() => d.envio !== 'driver' && void ajustar(d, { envio: 'driver' })} data-testid={`envio-${d.id}-windows`}>Pelo Windows</button>
                        </div>
                      </div>
                    )
                  })}
                  {!naLista.length && <p className="ti-rot">Adicione uma impressora no card 2.</p>}
                </SecaoAv>

                <SecaoAv titulo="Calibrar impressora" testid="av-calibrar" frase="Imprime uma folha de teste e ajusta largura, letra e intensidade.">
                  {naLista.map((d) => {
                    const drv = avisoDriver(d)
                    return (
                      <div key={d.id} className="space-y-2">
                        <div className="ti-av-linha">
                          <span className="min-w-0 truncate">{nomeDisp(d)}</span>
                          <span className="ti-acoes">
                            <select className="ti-campo h-[32px]" aria-label={`Tamanho da letra de ${nomeDisp(d)}`} value={d.tamanhoFonte} disabled={ocupado} onChange={(e) => void ajustar(d, { tamanhoFonte: e.target.value as TamanhoLetra })} data-testid={`letra-${d.id}`}>
                              {TAMANHOS_LETRA.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                            </select>
                            <button type="button" className="ti-btn sm" onClick={() => { setAvancado(false); setCalibrar(d.id) }} disabled={!agenteDe(d)?.online} data-testid={`calibrar-${d.id}`}>Calibrar</button>
                          </span>
                        </div>
                        {drv && <Aviso testid={`aviso-calibrar-${d.id}`}>{drv}</Aviso>}
                      </div>
                    )
                  })}
                  {!naLista.length && <p className="ti-rot">Adicione uma impressora no card 2.</p>}
                </SecaoAv>

                {config && (
                  <SecaoAv titulo="Pedidos" testid="av-pedidos">
                    <div className="ti-av-linha"><span>Imprimir sozinho quando o pedido chega</span><button type="button" className="ti-sw" role="switch" aria-checked={config.impressaoAutomatica} aria-label="Imprimir sozinho quando o pedido chega" disabled={!podeEditar} onClick={() => void patchConfig({ impressaoAutomatica: !config.impressaoAutomatica })} data-testid="opcao-impressaoAutomatica" /></div>
                  </SecaoAv>
                )}

                {antigo && (
                  <SecaoAv titulo="Assistente antigo (enquanto a loja usa)" testid="av-antigo">
                    <div className="ti-av-linha">
                      <span className="min-w-0"><span className="block">Sinal: {atualOnline ? 'conectado' : atualVistoEm ? `sem sinal desde ${quando(atualVistoEm)}` : 'nunca conectou'}</span><small>Impressora: {impAntiga?.nome ?? '—'}</small></span>
                      <span className="ti-acoes">
                        {podeEditar && token && <button type="button" className="ti-btn sm" onClick={() => navigator.clipboard.writeText(token).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000) })} data-testid="token-copiar">{copiado ? 'Token copiado' : 'Copiar token'}</button>}
                        {podeEditar && <button type="button" className="ti-btn sm" onClick={() => void gerarToken()} data-testid="token-gerar">{token ? 'Gerar novo token' : 'Gerar token'}</button>}
                        {podeEditar && impAntiga && <button type="button" className="ti-btn sm" onClick={() => setModalImpressora({ id: impAntiga.id, input: { nome: impAntiga.nome, tamanhoFonte: impAntiga.tamanhoFonte, largura: impAntiga.largura, copias: impAntiga.copias } })}>Editar impressora</button>}
                      </span>
                    </div>
                    {config && <div className="ti-av-linha"><span>Assistente antigo ativado</span><button type="button" className="ti-sw" role="switch" aria-checked={config.ativarAssistente} aria-label="Assistente antigo ativado" disabled={!podeEditar} onClick={() => void patchConfig({ ativarAssistente: !config.ativarAssistente })} data-testid="opcao-ativarAssistente" /></div>}
                    <a className="ti-btn sm" href={DOWNLOAD_ASSISTENTE_ATUAL.url}>Instalador do antigo ({DOWNLOAD_ASSISTENTE_ATUAL.versao})</a>
                  </SecaoAv>
                )}

                <div className="ti-av-rodape">
                  <button type="button" className="ti-btn sm" onClick={() => { setAvancado(false); setAjuda(true) }}>Guia e diagnóstico</button>
                  {!antigo && <button type="button" className="ti-link" style={{ fontSize: 12, fontWeight: 400 }} onClick={() => setTrocar('antigo')} data-testid="voltar-antigo">Usar impressão antiga</button>}
                </div>
              </div>
            </ModalCentral>
          )}
          <ModalCentral
            aberto={trocar !== null}
            onFechar={() => setTrocar(null)}
            largura={440}
            classeTema="tela-impressao"
            testid="confirmar-opcao"
            titulo={trocar === 'beta' ? 'Imprimir pelo assistente novo?' : 'Usar a impressão antiga?'}
            rodape={
              <div className="flex justify-end gap-2">
                <button type="button" className="ti-btn" onClick={() => setTrocar(null)}>Cancelar</button>
                <button type="button" className="ti-btn pri" disabled={ocupado} onClick={() => trocar && void confirmarTroca(trocar)} data-testid="confirmar-opcao-ok">Confirmar</button>
              </div>
            }
          >
            <p className="px-5 py-4 text-[14px] leading-[20px]" data-testid="confirmar-opcao-texto">
              {trocar === 'beta' ? 'Comanda e pré-conta passam a sair pelo assistente novo, nas impressoras do card 2.' : 'A comanda volta para o assistente antigo. Ele precisa estar instalado e aberto no computador da impressora. O assistente novo continua instalado: dá para voltar quando quiser.'}
            </p>
          </ModalCentral>
          {calibrar && p?.dispositivos.find((d) => d.id === calibrar) && <NoTopo classe="tela-impressao"><Calibracao d={p.dispositivos.find((d) => d.id === calibrar)!} ocupado={ocupado} agir={agir} onFechar={() => setCalibrar(null)} /></NoTopo>}
          {modalImpressora && <NoTopo classe="tela-impressao"><ImpressoraModal initial={modalImpressora.input} onClose={() => setModalImpressora(null)} onSave={salvarImpressoraAntiga} /></NoTopo>}
        </main>
      </div>
    </div>
  )
}

// ─── peças da tela ──────────────────────────────────────────────────────────

function Card({ cor, n, ico, titulo, sub, extra, children, testid }: { cor: 'azul' | 'roxo' | 'verde'; n: number; ico: React.ReactNode; titulo: string; sub: string; extra?: React.ReactNode; children: React.ReactNode; testid: string }) {
  return (
    <section className={`ti-card ${cor}`} aria-labelledby={`${testid}-t`} data-testid={testid}>
      <div className="ti-card-cab">
        <span className={`ti-ico ${cor === 'roxo' ? 'roxo' : cor === 'verde' ? 'ok' : ''}`}>{ico}</span>
        <div className="min-w-0 flex-1">
          <span className="ti-eyebrow">Passo {n}</span>
          <h3 id={`${testid}-t`}>{titulo}</h3>
          <p className="ti-sub">{sub}</p>
        </div>
        {extra}
      </div>
      <div className="ti-card-corpo">{children}</div>
    </section>
  )
}

function SecaoAv({ titulo, frase, children, testid }: { titulo: string; frase?: string; children: React.ReactNode; testid: string }) {
  return (
    <section className="ti-av-secao" data-testid={testid}>
      <h4>{titulo}</h4>
      {frase && <p className="ti-rot mb-2">{frase}</p>}
      <div className="space-y-2">{children}</div>
    </section>
  )
}

/** Uma impressora da lista: apelido (editável) e nome técnico, situação, funções e remover. */
function LinhaImpressora({ d, p, online, ocupado, onApelido, onFuncao, onRemover }: {
  d: DispositivoVisao
  p: PainelDados & { funcoes: Record<FuncaoImpressora, string | null> }
  online: boolean
  ocupado: boolean
  onApelido: (v: string) => Promise<unknown>
  onFuncao: (f: FuncaoImpressora | 'outra') => void
  onRemover: () => void
}) {
  const [editando, setEditando] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const botao = useRef<HTMLButtonElement>(null)
  const est: Estado = !online ? 'warn' : d.disponivel ? 'ok' : 'warn'
  const situacao = !online ? 'Sem sinal' : d.disponivel ? 'Conectada' : 'Não encontrada no Windows'
  const daTela = FUNCOES_NA_TELA.filter((f) => d.funcoes.includes(f))
  const rotulo = daTela.length ? daTela.map((f) => ROTULO_NA_TELA[f]).join(', ') : 'Sem função'
  const noMenu = FUNCOES_NA_TELA
  const outraDe = (f: FuncaoImpressora) => {
    const id = p.funcoes[f]
    if (!id || id === d.id) return null
    const x = p.dispositivos.find((y) => y.id === id)
    return x ? nomeDisp(x) : null
  }
  async function salvar() {
    if (editando === null) return
    await onApelido(editando)
    setEditando(null)
  }
  return (
    <li className="ti-imp-linha" data-testid={`impressora-${d.id}`}>
      <div className="ti-imp min-w-0">
        <Ponto e={est} />
        {editando !== null ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <input className="ti-input min-w-0 flex-1" autoFocus maxLength={40} value={editando} placeholder={d.nomeSistema} aria-label={`Apelido de ${d.nomeSistema}`}
              onChange={(e) => setEditando(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void salvar(); if (e.key === 'Escape') { e.stopPropagation(); setEditando(null) } }} data-testid={`apelido-input-${d.id}`} />
            <button type="button" className="ti-btn sm pri" onClick={() => void salvar()} disabled={ocupado} data-testid={`apelido-salvar-${d.id}`}>Salvar</button>
            <button type="button" className="ti-fechar" onClick={() => setEditando(null)} aria-label="Cancelar"><X className="h-4 w-4" /></button>
          </span>
        ) : (
          <button type="button" className="ti-nome" onClick={() => setEditando(d.apelido ?? '')} title="Editar apelido" data-testid={`apelido-${d.id}`}>
            <span className="min-w-0">
              <b className="block truncate">{d.apelido || d.nomeSistema}</b>
              <small className="block truncate">{d.apelido ? `${d.nomeSistema} · ` : ''}{detalhe(d)}</small>
            </span>
            <Pencil className="ti-lapis" aria-hidden />
          </button>
        )}
      </div>
      <span className={`ti-estado ${est}`} data-testid={`situacao-${d.id}`}>{situacao}</span>
      <div>
        <button ref={botao} type="button" className="ti-funcao" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} disabled={ocupado} data-testid={`funcao-${d.id}`}>
          <span className="truncate">{rotulo}</span><ChevronDown className="h-4 w-4 flex-none" aria-hidden />
        </button>
        <Flutuante ancora={botao} aberto={menu} onFechar={() => setMenu(false)} largura={280} rotulo={`Funções de ${nomeDisp(d)}`} className="tela-impressao ti-menu" testid={`funcao-menu-${d.id}`}>
          <div role="menu">
            {noMenu.map((f) => {
              const marcado = d.funcoes.includes(f)
              const outra = outraDe(f)
              return (
                <button key={f} type="button" role="menuitemcheckbox" aria-checked={marcado} className="ti-menu-item" onClick={() => onFuncao(f)} data-testid={`funcao-${d.id}-${f}`}>
                  <span className={`ti-check ${marcado ? 'on' : ''}`}>{marcado && <Check aria-hidden />}</span>
                  <span className="min-w-0"><span className="block">{ROTULO_NA_TELA[f]}</span>{outra && !marcado && <small className="block">hoje em {outra}</small>}</span>
                </button>
              )
            })}
          </div>
        </Flutuante>
      </div>
      <button type="button" className="ti-fechar" onClick={onRemover} disabled={ocupado} aria-label={`Remover ${nomeDisp(d)}`} title="Remover" data-testid={`remover-${d.id}`}><Trash2 className="h-[17px] w-[17px]" /></button>
    </li>
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
          <h2 className="text-[15px] font-semibold text-text-main">Calibrar {nome}</h2>
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
                    className={['rounded-menuzia border-2 py-4 text-[15px] font-semibold', mm === d.larguraMm ? 'border-primary bg-alert-bg/50' : 'border-border'].join(' ')}
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
              <button type="button" disabled={ocupado} onClick={() => void imprimir()} data-testid="imprimir-calibracao" className="w-full rounded-menuzia bg-primary py-3 text-[13px] font-semibold text-white disabled:opacity-40">
                Imprimir teste de largura
              </button>
            </>
          )}
          {passo === 'conferir' && (
            <>
              <p className="font-semibold">3. Olhe o papel</p>
              <p className="text-text-subtle">As duas barras pretas (esquerda e direita) e o valor do TOTAL apareceram inteiros?</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setPasso('pronto')} className="rounded-menuzia border-2 border-status-ready py-3 font-semibold text-status-ready">Sim, tudo inteiro</button>
                <button type="button" onClick={() => setPasso('numero')} data-testid="calibracao-cortou" className="rounded-menuzia border-2 border-danger py-3 font-semibold text-danger">Não, a direita cortou</button>
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
                    className="rounded-menuzia border-2 border-border py-3 text-[16px] font-semibold hover:border-primary"
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
                  className="rounded-menuzia bg-primary px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
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
