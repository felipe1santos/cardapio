'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, CheckCheck, ChevronDown, Headset, Info, KeyRound, MessageCircle, Pause, RotateCcw, Send, Settings2, ShieldAlert, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BolhaIcone, Cartao, SeloStatus, type EstadoIntegracao } from '@/components/admin/painel-visual'

/**
 * Robô de atendimento do WhatsApp (v1, sem IA) — Integrações (só o dono).
 *
 * Mostra se está ligado, se o servidor já liberou o robô, a instância do WhatsApp da loja,
 * o que a v1 responde, os tempos, o webhook (mascarado, com troca do segredo) e as
 * conversas em atendimento humano (devolver ao robô / pausar). Nasce DESLIGADO.
 */
interface Estado {
  roboAtivo: boolean
  liberadoNoServidor: boolean
  boasVindas: string | null
  boasVindasPadrao: string
  boasVindasHoras: number
  retornoMinutos: number
  limites: { boasVindasHoras: [number, number]; retornoMinutos: [number, number] }
  instancia: string | null
  webhookMascarado: string | null
  atualizadoEm: string | null
  atualizadoPor: string | null
  envios24h: { enviados: number; pendentes: number; falhas: number }
  webhooks24h: number
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

const MOTIVO: Record<string, string> = { cliente: 'cliente pediu atendente', loja: 'loja respondeu pelo celular', painel: 'pausada pelo painel', protecao: 'pausada por proteção (respostas demais em sequência)' }

function hora(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const CAMPO = 'mt-1 w-full rounded-[6px] border border-[var(--adm-borda)] bg-white px-3 py-2 text-[13px] text-text-main focus:border-primary focus:outline-none'

export function RoboWhatsappCard() {
  const [whatsapp, setWhatsapp] = useState<{ conectado: boolean; estado: string | null } | null>(null)
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
    setTexto(j.boasVindas ?? '')
    setHoras(String(j.boasVindasHoras))
    setRetorno(String(j.retornoMinutos))
    const c = await fetch('/api/admin/whatsapp/conversas', { cache: 'no-store' })
    if (c.ok) setConversas(await c.json())
  }, [])

  useEffect(() => {
    void carregar()
    // Só leitura do estado da conexão (nada é conectado nem desconectado aqui).
    fetch('/api/admin/whatsapp/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setWhatsapp({ conectado: j?.connected === true, estado: (j?.state as string | null) ?? null }))
      .catch(() => setWhatsapp(null))
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
  if (!estado) return <div className="h-[260px] animate-pulse rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white" aria-busy="true" />

  const ligado = estado.roboAtivo
  const bloqueado = !estado.liberadoNoServidor
  const estadoWa: EstadoIntegracao = !estado.instancia
    ? 'desconectado'
    : whatsapp === null
      ? 'verificando'
      : whatsapp.conectado
        ? 'conectado'
        : whatsapp.estado === 'connecting'
          ? 'aguardando'
          : 'desconectado'

  return (
    <Cartao data-testid="robo-whatsapp" className="overflow-hidden">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--adm-borda)] p-4">
        <div className="flex min-w-0 items-center gap-3">
          <BolhaIcone icone={Bot} tom={ligado ? 'verde' : 'cinza'} tamanho={42} />
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-[var(--adm-texto)]">Robô de atendimento do WhatsApp</h3>
            <p className="text-[12.5px] text-[var(--adm-texto-suave)]">
              Responde o básico sozinho e chama um atendente quando o cliente pedir. Sem inteligência artificial.
            </p>
          </div>
        </div>
        <SeloStatus estado={bloqueado ? 'aguardando' : ligado ? 'conectado' : 'desconectado'} rotulo={ligado ? 'Ligado' : 'Desligado'} testid="robo-estado" />
      </div>

      <div className="space-y-4 p-4">
        {bloqueado && (
          <p className="flex items-start gap-2 rounded-[6px] bg-[#FEF3C7] px-3 py-2.5 text-[12.5px] leading-[18px] text-[#92400E]" data-testid="robo-bloqueado">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              Ainda <strong>não liberado</strong> pela Menuzia neste servidor: mesmo ligado, não responde ninguém até a liberação.
            </span>
          </p>
        )}

        {/* Números */}
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
          <div className="flex items-center gap-3 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] p-3" data-testid="robo-instancia">
            <BolhaIcone icone={Smartphone} tom={estadoWa === 'conectado' ? 'verde' : estadoWa === 'aguardando' ? 'ambar' : 'cinza'} tamanho={34} />
            <div className="min-w-0">
              <p className="text-[11.5px] text-[var(--adm-texto-suave)]">WhatsApp da loja</p>
              {estado.instancia ? (
                <p className="truncate text-[13.5px] font-semibold text-[var(--adm-texto)]">
                  {whatsapp === null ? 'verificando…' : whatsapp.conectado ? 'Conectado' : `Desconectado${whatsapp.estado ? ` (${whatsapp.estado})` : ''}`}
                </p>
              ) : (
                <p className="text-[12.5px] font-semibold text-[var(--adm-texto)]">Nenhum conectado — conecte acima</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] p-3">
            <BolhaIcone icone={MessageCircle} tom="azul" tamanho={34} />
            <div className="min-w-0">
              <p className="text-[11.5px] text-[var(--adm-texto-suave)]">Mensagens recebidas (24h)</p>
              <p className="text-[18px] font-bold leading-tight text-[var(--adm-texto)]">{estado.webhooks24h}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] p-3" data-testid="robo-24h">
            <BolhaIcone icone={Send} tom="roxo" tamanho={34} />
            <div className="min-w-0">
              <p className="text-[11.5px] text-[var(--adm-texto-suave)]">Respostas do robô (24h)</p>
              <p className="text-[18px] font-bold leading-tight text-[var(--adm-texto)]">
                {estado.envios24h.enviados}
                {estado.envios24h.falhas ? <span className="ml-1.5 text-[12px] font-semibold text-[#DC2626]">{estado.envios24h.falhas} falhas</span> : null}
              </p>
            </div>
          </div>
        </div>

        {/* Ligar / desligar */}
        <div className="flex flex-wrap items-center gap-2">
          {ligado ? (
            <Button variant="outline" disabled={salvando} onClick={() => chamar('PUT', '/api/admin/whatsapp/robo', { roboAtivo: false }, 'Robô desligado.')} data-testid="robo-alternar">
              Desligar o robô
            </Button>
          ) : confirmarLigar ? (
            <>
              <span className="text-[12.5px] text-[var(--adm-texto)]">Ligar faz o robô responder os clientes que escreverem. Confirmar?</span>
              <Button disabled={salvando} onClick={async () => { setConfirmarLigar(false); await chamar('PUT', '/api/admin/whatsapp/robo', { roboAtivo: true }, 'Robô ligado.') }} data-testid="robo-confirmar-ligar">
                Sim, ligar
              </Button>
              <Button variant="outline" onClick={() => setConfirmarLigar(false)}>Cancelar</Button>
            </>
          ) : (
            <Button
              disabled={salvando || bloqueado}
              title={bloqueado ? 'Ainda não liberado neste servidor' : undefined}
              onClick={() => setConfirmarLigar(true)}
              // O Button do painel não tem estilo de desabilitado, e o bg da variante vem de outro
              // arquivo de CSS carregado depois — por isso o "!": sem ele o botão parecia clicável.
              className="disabled:cursor-not-allowed disabled:!bg-page disabled:!text-text-subtle disabled:shadow-none"
              data-testid="robo-alternar"
            >
              Ligar o robô
            </Button>
          )}
          {estado.atualizadoEm && (
            <span className="text-[11.5px] text-[var(--adm-texto-suave)]">
              Alterado em {hora(estado.atualizadoEm)}{estado.atualizadoPor ? ` por ${estado.atualizadoPor}` : ''}
            </span>
          )}
        </div>

        {aviso && <p className="rounded-[6px] bg-[#DCFCE7] px-3 py-2 text-[12.5px] text-[#166534]" role="status">{aviso}</p>}
        {erro && <p className="rounded-[6px] bg-[#FEE2E2] px-3 py-2 text-[12.5px] text-[#B91C1C]" role="alert">{erro}</p>}

        <details className="group rounded-[6px] border-[0.8px] border-[var(--adm-borda)] px-3 py-2.5 text-[12.5px] text-[var(--adm-texto)]">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
            <Info className="h-4 w-4 text-[#0688D4]" /> O que o robô responde
            <ChevronDown className="ml-auto h-4 w-4 text-[var(--adm-texto-suave)] transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[var(--adm-texto-suave)]">
            <li>Saudação com o menu e o link do cardápio.</li>
            <li>Status do último pedido feito com aquele número.</li>
            <li>Horário de funcionamento e taxa de entrega por bairro cadastrado.</li>
            <li>“Falar com atendente”: o robô para de responder naquela conversa.</li>
            <li>Áudio, foto, figurinha e localização: avisa o que consegue fazer.</li>
            <li>Nunca cria, cancela ou altera pedido, e não recebe pagamento.</li>
          </ul>
        </details>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Configuração */}
          <div className="min-w-0 space-y-2 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] p-3.5">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--adm-texto-forte)]"><Settings2 className="h-4 w-4 text-[var(--adm-texto-suave)]" /> Configuração</p>
            <label className="block text-[12px] font-semibold text-[var(--adm-texto-forte)]">
              Boas-vindas
              <textarea
                value={texto}
                maxLength={500}
                rows={3}
                onChange={(e) => setTexto(e.target.value)}
                placeholder={estado.boasVindasPadrao}
                className={CAMPO}
                data-testid="robo-boas-vindas"
              />
            </label>
            <p className="text-[11.5px] text-[var(--adm-texto-suave)]">O link do cardápio e o menu entram sozinhos no fim.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[12px] text-[var(--adm-texto)]">
                Repetir boas-vindas após (horas)
                <input type="number" min={estado.limites.boasVindasHoras[0]} max={estado.limites.boasVindasHoras[1]} value={horas} onChange={(e) => setHoras(e.target.value)} className={CAMPO} data-testid="robo-horas" />
              </label>
              <label className="text-[12px] text-[var(--adm-texto)]">
                Robô volta após atendimento (min)
                <input type="number" min={estado.limites.retornoMinutos[0]} max={estado.limites.retornoMinutos[1]} value={retorno} onChange={(e) => setRetorno(e.target.value)} className={CAMPO} data-testid="robo-retorno" />
              </label>
            </div>
            <Button
              variant="outline"
              disabled={salvando}
              onClick={() => chamar('PUT', '/api/admin/whatsapp/robo', { boasVindas: texto, boasVindasHoras: horas, retornoMinutos: retorno }, 'Configuração salva.')}
            >
              Salvar boas-vindas
            </Button>
          </div>

          {/* Conversas */}
          <div className="min-w-0 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-[var(--adm-texto-forte)]"><Headset className="h-4 w-4 text-[var(--adm-texto-suave)]" /> Em atendimento humano</p>
            {!conversas?.emAtendimento.length ? (
              <p className="flex items-center gap-2 rounded-[6px] bg-[#F8FAFC] px-3 py-2.5 text-[12.5px] text-[var(--adm-texto-suave)]" data-testid="robo-sem-silenciadas">
                <CheckCheck className="h-4 w-4 flex-shrink-0 text-[#16A34A]" /> Nenhuma conversa aguardando atendente agora.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--adm-borda)] rounded-[6px] border-[0.8px] border-[var(--adm-borda)]" data-testid="robo-silenciadas">
                {conversas.emAtendimento.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[12px]">
                    <span className="min-w-0">
                      <strong className="text-[var(--adm-texto)]">{c.nome ?? c.telefone}</strong>
                      {c.nome && <span className="ml-1 text-[var(--adm-texto-suave)]">{c.telefone}</span>}
                      <span className="block text-[var(--adm-texto-suave)]">
                        <span className={c.motivo === 'protecao' ? 'font-semibold text-[#B45309]' : ''}>{MOTIVO[c.motivo ?? ''] ?? 'em atendimento'}</span> · desde {hora(c.silenciadaEm)} · robô volta {hora(c.voltaEm)}
                      </span>
                    </span>
                    <Button variant="outline" disabled={salvando} onClick={() => chamar('POST', '/api/admin/whatsapp/conversas', { conversaId: c.id, acao: 'devolver' }, 'Conversa devolvida ao robô.')} data-testid="robo-reativar">
                      <RotateCcw className="mr-1 inline h-3.5 w-3.5" /> Devolver ao robô
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {!!conversas?.comRobo.length && (
              <>
                <p className="mb-2 mt-4 text-[12.5px] font-bold text-[var(--adm-texto-forte)]">Atendidas pelo robô (24h)</p>
                <ul className="divide-y divide-[var(--adm-borda)] rounded-[6px] border-[0.8px] border-[var(--adm-borda)]" data-testid="robo-com-robo">
                  {conversas.comRobo.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
                      <span className="min-w-0 text-[var(--adm-texto)]">{c.nome ?? c.telefone} <span className="text-[var(--adm-texto-suave)]">· {hora(c.ultimaMensagemEm)}</span></span>
                      <Button variant="ghost" disabled={salvando} onClick={() => chamar('POST', '/api/admin/whatsapp/conversas', { conversaId: c.id, acao: 'pausar' }, 'Robô pausado nesta conversa.')} data-testid="robo-pausar">
                        <Pause className="mr-1 inline h-3.5 w-3.5" /> Pausar robô
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* Webhook */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] bg-[#F8FAFC] px-3.5 py-3 text-[12px]">
          <div className="min-w-0 flex-1">
            <span className="mb-0.5 flex items-center gap-1.5 font-semibold text-[var(--adm-texto-forte)]"><KeyRound className="h-3.5 w-3.5" /> Endereço de recebimento (webhook)</span>
            <code className="block break-all text-[11px] text-[var(--adm-texto-suave)]" data-testid="robo-webhook">{estado.webhookMascarado ?? '—'}</code>
            <p className="mt-0.5 text-[11.5px] text-[var(--adm-texto-suave)]">Configurado pela Menuzia. Trocar o segredo desliga o endereço antigo na hora.</p>
          </div>
          <Button
            variant="outline"
            disabled={salvando}
            onClick={() => chamar('POST', '/api/admin/whatsapp/robo', { acao: 'rotacionar_segredo' }, 'Segredo trocado. Atualize o webhook na Evolution antes de usar.')}
            data-testid="robo-rotacionar"
          >
            Trocar segredo
          </Button>
        </div>
      </div>
    </Cartao>
  )
}
