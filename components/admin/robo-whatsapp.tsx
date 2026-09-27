'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, CheckCheck, ChevronDown, Headset, Info, KeyRound, MessageCircle, Pause, RotateCcw, Send, Settings2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BolhaIcone, Cartao, SeloStatus, type EstadoIntegracao } from '@/components/admin/painel-visual'

/**
 * Robô de atendimento do WhatsApp (v1, sem IA) — Integrações.
 *
 * Para o cliente final (dono): liga/desliga, conexão do WhatsApp, números das últimas 24h
 * e quem está aguardando atendente. Nada técnico.
 *
 * Suporte da plataforma (e-mail em SUPERADMIN_EMAILS — a API diz `suporte: true` e só
 * então manda estes dados): boas-vindas, tempos, webhook e troca do segredo, num bloco
 * "Configurações avançadas". Os demais não recebem esses dados e a API recusa (403).
 *
 * Atendimento humano: quando o cliente pede "falar com atendente" (ou a loja responde pelo
 * celular), a conversa fica silenciada e aparece em "Aguardando atendente". PRÓXIMA ETAPA
 * (ainda não feita): aviso no canto inferior direito do painel a cada nova conversa
 * aguardando, e depois abrir a conversa num WhatsApp integrado dentro da Menuzia. A fonte
 * é a mesma: /api/admin/whatsapp/conversas (emAtendimento) e o evento 'atendente' em
 * whatsapp_eventos.
 */
interface Estado {
  roboAtivo: boolean
  liberadoNoServidor: boolean
  instancia: string | null
  atualizadoEm: string | null
  atualizadoPor: string | null
  envios24h: { enviados: number; pendentes: number; falhas: number }
  recebidas24h: number
  suporte: boolean
  // Só para o suporte:
  boasVindas?: string | null
  boasVindasPadrao?: string
  boasVindasHoras?: number
  retornoMinutos?: number
  limites?: { boasVindasHoras: [number, number]; retornoMinutos: [number, number] }
  webhookMascarado?: string | null
}

interface Conversa {
  id: string
  nome: string | null
  telefone: string
  motivo: 'cliente' | 'loja' | 'painel' | 'protecao' | null
  silenciadaEm: string | null
  ultimaMensagemEm: string | null
  voltaEm: string | null
}

const MOTIVO: Record<string, string> = {
  cliente: 'pediu para falar com atendente',
  loja: 'você respondeu pelo celular',
  painel: 'robô pausado por você',
  protecao: 'pausado automaticamente (muitas mensagens seguidas)',
}

function hora(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const CAMPO = 'mt-1 w-full rounded-[6px] border border-[var(--adm-borda)] bg-white px-3 py-2 text-[13px] text-text-main focus:border-primary focus:outline-none'

type Conexao = { configurado: boolean; conectado: boolean; estado: string | null } | 'falhou' | null

export function RoboWhatsappCard() {
  const [conexao, setConexao] = useState<Conexao>(null)
  const [estado, setEstado] = useState<Estado | null>(null)
  const [conversas, setConversas] = useState<{ emAtendimento: Conversa[]; comRobo: Conversa[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [horas, setHoras] = useState('12')
  const [retorno, setRetorno] = useState('720')
  const [salvando, setSalvando] = useState(false)
  const [confirmarLigar, setConfirmarLigar] = useState(false)

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/whatsapp/robo', { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return setErro(j.error ?? 'Não foi possível carregar o robô.')
    setEstado(j)
    if (j.suporte) {
      setTexto(j.boasVindas ?? '')
      setHoras(String(j.boasVindasHoras))
      setRetorno(String(j.retornoMinutos))
    }
    const c = await fetch('/api/admin/whatsapp/conversas', { cache: 'no-store' })
    if (c.ok) setConversas(await c.json())
  }, [])

  useEffect(() => {
    void carregar()
    // Só leitura do estado da conexão (nada é conectado nem desconectado aqui).
    fetch('/api/admin/whatsapp/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('status'))))
      .then((j) => setConexao({ configurado: j?.configurado !== false, conectado: j?.connected === true, estado: (j?.state as string | null) ?? null }))
      .catch(() => setConexao('falhou'))
  }, [carregar])

  async function chamar(metodo: 'PUT' | 'POST', url: string, corpo: Record<string, unknown>, ok: string) {
    setSalvando(true)
    setErro(null)
    setAviso(null)
    const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    const j = await r.json().catch(() => ({}))
    setSalvando(false)
    if (!r.ok) {
      setErro(j.error ?? 'Não foi possível salvar.')
      return false
    }
    setAviso(ok)
    await carregar()
    return true
  }

  if (erro && !estado) {
    return (
      <Cartao data-testid="robo-whatsapp" className="p-4">
        <p className="text-[13px] text-[#DC2626]">{erro}</p>
      </Cartao>
    )
  }
  if (!estado) return <div className="h-[220px] animate-pulse rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white" aria-busy="true" />

  const ligado = estado.roboAtivo
  const bloqueado = !estado.liberadoNoServidor
  // Conexão do WhatsApp da loja, em palavras que o dono entende.
  const wa: { estado: EstadoIntegracao; rotulo: string } =
    conexao === null
      ? { estado: 'verificando', rotulo: 'Verificando WhatsApp…' }
      : conexao === 'falhou' || !conexao.configurado
        ? { estado: 'erro', rotulo: 'Erro na conexão' }
        : conexao.conectado
          ? { estado: 'conectado', rotulo: 'WhatsApp conectado' }
          : conexao.estado === 'connecting'
            ? { estado: 'aguardando', rotulo: 'Aguardando leitura do QR code' }
            : { estado: 'desconectado', rotulo: 'WhatsApp não conectado' }
  const conectado = wa.estado === 'conectado'
  // Desligar sempre pode. Ligar precisa do WhatsApp conectado e da liberação da Menuzia.
  const podeLigar = !bloqueado && conectado
  const toggleDesabilitado = salvando || (!ligado && !podeLigar)
  const dicaToggle = ligado ? null : bloqueado ? 'Aguardando liberação da Menuzia' : !conectado && wa.estado !== 'verificando' ? 'Conecte o WhatsApp para ativar' : null
  const aguardando = conversas?.emAtendimento ?? []

  function alternar() {
    if (toggleDesabilitado) return
    if (ligado) void chamar('PUT', '/api/admin/whatsapp/robo', { roboAtivo: false }, 'Robô desligado.')
    else setConfirmarLigar(true)
  }

  return (
    <Cartao data-testid="robo-whatsapp" className="overflow-hidden">
      {/* Cabeçalho: nome, status e o interruptor */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <BolhaIcone icone={Bot} tom={ligado ? 'verde' : 'cinza'} tamanho={42} />
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold leading-tight text-[var(--adm-texto)]">Robô de atendimento do WhatsApp</h3>
            <div className="mt-1.5">
              <SeloStatus estado={wa.estado} rotulo={wa.rotulo} />
            </div>
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={ligado}
            aria-label={ligado ? 'Desligar o robô' : 'Ligar o robô'}
            disabled={toggleDesabilitado}
            onClick={alternar}
            data-testid="robo-alternar"
            className="group flex items-center gap-2 rounded-full disabled:cursor-not-allowed"
          >
            <span data-testid="robo-estado" className={['text-[13px] font-bold', ligado ? 'text-[#16A34A]' : 'text-[var(--adm-texto-suave)]'].join(' ')}>
              {ligado ? 'Ligado' : 'Desligado'}
            </span>
            <span
              className={[
                'relative inline-flex h-[28px] w-[50px] flex-shrink-0 items-center rounded-full transition-colors duration-200',
                ligado ? 'bg-[#10B981]' : 'bg-[#CBD5E1]',
                toggleDesabilitado ? 'opacity-50' : 'group-hover:brightness-95',
              ].join(' ')}
              aria-hidden
            >
              <span className={['absolute h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.3)] transition-transform duration-200', ligado ? 'translate-x-[25px]' : 'translate-x-[3px]'].join(' ')} />
            </span>
          </button>
          {dicaToggle && <span className="max-w-[170px] text-right text-[11px] leading-[14px] text-[var(--adm-texto-suave)]" data-testid="robo-dica">{dicaToggle}</span>}
        </div>
      </div>

      {confirmarLigar && !ligado && (
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-[6px] bg-[#F0FDF4] px-3 py-2.5">
          <span className="min-w-0 flex-1 text-[12.5px] text-[var(--adm-texto)]">Ligar o robô? Ele passa a responder quem escrever para a loja.</span>
          <Button disabled={salvando} onClick={async () => { setConfirmarLigar(false); await chamar('PUT', '/api/admin/whatsapp/robo', { roboAtivo: true }, 'Robô ligado.') }} data-testid="robo-confirmar-ligar">
            Sim, ligar
          </Button>
          <Button variant="outline" onClick={() => setConfirmarLigar(false)}>Cancelar</Button>
        </div>
      )}

      {bloqueado && (
        <p className="mx-4 mb-3 flex items-center gap-2 text-[12px] text-[#92400E]" data-testid="robo-bloqueado">
          <ShieldAlert className="h-4 w-4 flex-shrink-0" /> O robô ainda não foi liberado pela Menuzia nesta loja.
        </p>
      )}
      {aviso && <p className="mx-4 mb-3 rounded-[6px] bg-[#DCFCE7] px-3 py-2 text-[12.5px] text-[#166534]" role="status">{aviso}</p>}
      {erro && <p className="mx-4 mb-3 rounded-[6px] bg-[#FEE2E2] px-3 py-2 text-[12.5px] text-[#B91C1C]" role="alert">{erro}</p>}

      <div className="space-y-4 border-t border-[var(--adm-borda)] p-4">
        {/* Números das últimas 24h */}
        <div className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-3" data-testid="robo-24h">
          <Numero icone={MessageCircle} tom="azul" rotulo="Mensagens recebidas" dica="últimas 24h" valor={estado.recebidas24h} />
          <Numero icone={Send} tom="roxo" rotulo="Respostas do robô" dica="últimas 24h" valor={estado.envios24h.enviados} />
          <Numero icone={Headset} tom={aguardando.length ? 'laranja' : 'cinza'} rotulo="Aguardando atendente" dica="agora" valor={aguardando.length} destaque={aguardando.length > 0} />
        </div>

        {/* Atendimento humano */}
        {!aguardando.length ? (
          <p className="flex items-center gap-2 rounded-[6px] bg-[#F8FAFC] px-3 py-2.5 text-[12.5px] text-[var(--adm-texto-suave)]" data-testid="robo-sem-silenciadas">
            <CheckCheck className="h-4 w-4 flex-shrink-0 text-[#16A34A]" /> Ninguém aguardando atendente agora.
          </p>
        ) : (
          <div className="rounded-[6px] border-[0.8px] border-[#FED7AA] bg-[#FFF7ED]">
            <p className="flex items-center gap-2 px-3 pt-2.5 text-[13px] font-bold text-[#9A3412]">
              <Headset className="h-4 w-4" /> {aguardando.length === 1 ? '1 cliente aguardando atendente' : `${aguardando.length} clientes aguardando atendente`}
            </p>
            <p className="px-3 pb-2 text-[12px] text-[#9A3412]/80">Responda pelo WhatsApp da loja. O robô volta sozinho depois, ou toque em “Devolver ao robô”.</p>
            <ul className="divide-y divide-[#FED7AA] border-t border-[#FED7AA]" data-testid="robo-silenciadas">
              {aguardando.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[12.5px]">
                  <span className="min-w-0">
                    <strong className="text-[var(--adm-texto)]">{c.nome ?? c.telefone}</strong>
                    {c.nome && <span className="ml-1 text-[var(--adm-texto-suave)]">{c.telefone}</span>}
                    <span className="block text-[12px] text-[var(--adm-texto-suave)]">{MOTIVO[c.motivo ?? ''] ?? 'em atendimento'} · desde {hora(c.silenciadaEm)}</span>
                  </span>
                  <Button variant="outline" disabled={salvando} onClick={() => chamar('POST', '/api/admin/whatsapp/conversas', { conversaId: c.id, acao: 'devolver' }, 'Conversa devolvida ao robô.')} data-testid="robo-reativar">
                    <RotateCcw className="mr-1 inline h-3.5 w-3.5" /> Devolver ao robô
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Extras recolhidos: conversas do robô e o que ele responde */}
        <div className="space-y-2">
          {!!conversas?.comRobo.length && (
            <Recolhido icone={Bot} titulo={`Conversas atendidas pelo robô hoje (${conversas.comRobo.length})`}>
              <ul className="divide-y divide-[var(--adm-borda)]" data-testid="robo-com-robo">
                {conversas.comRobo.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]">
                    <span className="min-w-0 text-[var(--adm-texto)]">{c.nome ?? c.telefone} <span className="text-[var(--adm-texto-suave)]">· {hora(c.ultimaMensagemEm)}</span></span>
                    <Button variant="ghost" disabled={salvando} onClick={() => chamar('POST', '/api/admin/whatsapp/conversas', { conversaId: c.id, acao: 'pausar' }, 'Robô pausado nesta conversa.')} data-testid="robo-pausar">
                      <Pause className="mr-1 inline h-3.5 w-3.5" /> Pausar robô
                    </Button>
                  </li>
                ))}
              </ul>
            </Recolhido>
          )}
          <Recolhido icone={Info} titulo="O que o robô responde">
            <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-[var(--adm-texto-suave)]">
              <li>Saudação com o menu e o link do cardápio.</li>
              <li>Status do último pedido feito com aquele número.</li>
              <li>Horário de funcionamento e taxa de entrega por bairro.</li>
              <li>“Falar com atendente”: o robô para de responder e a conversa aparece acima.</li>
              <li>Nunca cria, cancela ou altera pedido, e não recebe pagamento.</li>
            </ul>
          </Recolhido>
        </div>

        {/* Suporte da plataforma — nunca aparece para o cliente final */}
        {estado.suporte && <Avancado estado={estado} texto={texto} setTexto={setTexto} horas={horas} setHoras={setHoras} retorno={retorno} setRetorno={setRetorno} salvando={salvando} chamar={chamar} />}
      </div>
    </Cartao>
  )
}

function Numero({ icone, tom, rotulo, dica, valor, destaque }: { icone: typeof Bot; tom: 'azul' | 'roxo' | 'laranja' | 'cinza'; rotulo: string; dica: string; valor: number; destaque?: boolean }) {
  return (
    <div className={['flex items-center gap-3 rounded-[6px] border-[0.8px] p-3', destaque ? 'border-[#FED7AA] bg-[#FFF7ED]' : 'border-[var(--adm-borda)]'].join(' ')}>
      <BolhaIcone icone={icone} tom={tom} tamanho={34} />
      <div className="min-w-0">
        <p className="text-[11.5px] text-[var(--adm-texto-suave)]">{rotulo} <span className="text-[10.5px]">· {dica}</span></p>
        <p className="text-[20px] font-bold leading-tight text-[var(--adm-texto)]">{valor.toLocaleString('pt-BR')}</p>
      </div>
    </div>
  )
}

function Recolhido({ icone: Icone, titulo, children }: { icone: typeof Bot; titulo: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-[6px] border-[0.8px] border-[var(--adm-borda)] px-3 py-2.5 text-[12.5px] text-[var(--adm-texto)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
        <Icone className="h-4 w-4 flex-shrink-0 text-[#0688D4]" /> <span className="min-w-0">{titulo}</span>
        <ChevronDown className="ml-auto h-4 w-4 flex-shrink-0 text-[var(--adm-texto-suave)] transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}

/** Boas-vindas, tempos e webhook: só para o suporte da plataforma. */
function Avancado({ estado, texto, setTexto, horas, setHoras, retorno, setRetorno, salvando, chamar }: {
  estado: Estado
  texto: string; setTexto: (v: string) => void
  horas: string; setHoras: (v: string) => void
  retorno: string; setRetorno: (v: string) => void
  salvando: boolean
  chamar: (metodo: 'PUT' | 'POST', url: string, corpo: Record<string, unknown>, ok: string) => Promise<boolean>
}) {
  const lim = estado.limites ?? { boasVindasHoras: [1, 48] as [number, number], retornoMinutos: [15, 1440] as [number, number] }
  return (
    <details className="group rounded-[6px] border-[0.8px] border-dashed border-[#94A3B8] px-3 py-2.5 text-[12.5px]" data-testid="robo-avancado">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-[var(--adm-texto-forte)]">
        <Settings2 className="h-4 w-4 text-[var(--adm-texto-suave)]" /> Configurações avançadas <span className="rounded-full bg-[#F1F5F9] px-2 py-[1px] text-[10.5px] text-[#475569]">suporte Menuzia</span>
        <ChevronDown className="ml-auto h-4 w-4 text-[var(--adm-texto-suave)] transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 space-y-3">
        <label className="block text-[12px] font-semibold text-[var(--adm-texto-forte)]">
          Boas-vindas
          <textarea value={texto} maxLength={500} rows={3} onChange={(e) => setTexto(e.target.value)} placeholder={estado.boasVindasPadrao} className={CAMPO} data-testid="robo-boas-vindas" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[12px] text-[var(--adm-texto)]">
            Repetir boas-vindas após (horas)
            <input type="number" min={lim.boasVindasHoras[0]} max={lim.boasVindasHoras[1]} value={horas} onChange={(e) => setHoras(e.target.value)} className={CAMPO} data-testid="robo-horas" />
          </label>
          <label className="text-[12px] text-[var(--adm-texto)]">
            Robô volta após atendimento (min)
            <input type="number" min={lim.retornoMinutos[0]} max={lim.retornoMinutos[1]} value={retorno} onChange={(e) => setRetorno(e.target.value)} className={CAMPO} data-testid="robo-retorno" />
          </label>
        </div>
        <Button variant="outline" disabled={salvando} onClick={() => chamar('PUT', '/api/admin/whatsapp/robo', { boasVindas: texto, boasVindasHoras: horas, retornoMinutos: retorno }, 'Configuração salva.')}>
          Salvar boas-vindas
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] bg-[#F8FAFC] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <span className="mb-0.5 flex items-center gap-1.5 font-semibold text-[var(--adm-texto-forte)]"><KeyRound className="h-3.5 w-3.5" /> Webhook</span>
            <code className="block break-all text-[11px] text-[var(--adm-texto-suave)]" data-testid="robo-webhook">{estado.webhookMascarado ?? '—'}</code>
            <p className="mt-0.5 text-[11.5px] text-[var(--adm-texto-suave)]">Trocar o segredo desliga o endereço antigo na hora — atualize a Evolution antes.</p>
          </div>
          <Button variant="outline" disabled={salvando} onClick={() => chamar('POST', '/api/admin/whatsapp/robo', { acao: 'rotacionar_segredo' }, 'Segredo trocado. Atualize o webhook na Evolution antes de usar.')} data-testid="robo-rotacionar">
            Trocar segredo
          </Button>
        </div>
        {estado.atualizadoEm && (
          <p className="text-[11.5px] text-[var(--adm-texto-suave)]">Última alteração {hora(estado.atualizadoEm)}{estado.atualizadoPor ? ` por ${estado.atualizadoPor}` : ''}.</p>
        )}
      </div>
    </details>
  )
}
