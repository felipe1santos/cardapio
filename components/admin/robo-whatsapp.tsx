'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, KeyRound, Pause, RotateCcw, ShieldAlert } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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

const CAMPO = 'w-full rounded-menuzia border border-border px-3 py-2 text-[13px] text-text-main focus:border-primary focus:outline-none'

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
      <Card data-testid="robo-whatsapp">
        <p className="text-[13px] text-danger">{erro}</p>
      </Card>
    )
  }
  if (!estado) return null

  const ligado = estado.roboAtivo
  const bloqueado = !estado.liberadoNoServidor
  return (
    <Card data-testid="robo-whatsapp" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Bot className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold text-text-main">Robô de atendimento do WhatsApp</h3>
            <p className="text-[12px] text-text-subtle">
              Versão 1, sem inteligência artificial: responde só o básico e chama um atendente quando o cliente pedir.
            </p>
          </div>
        </div>
        <span
          data-testid="robo-estado"
          className={`rounded-menuzia px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${ligado ? 'bg-price-bg text-price-text' : 'bg-page text-text-subtle'}`}
        >
          {ligado ? 'Ligado' : 'Desligado'}
        </span>
      </div>

      {bloqueado && (
        <p className="mb-3 flex items-start gap-2 rounded-menuzia border border-warn bg-warn-bg px-3 py-2.5 text-[12px] text-text-main" data-testid="robo-bloqueado">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-warn" />
          <span>
            O robô ainda <strong>não foi liberado</strong> pela Menuzia neste servidor. Enquanto isso ele não responde
            ninguém, mesmo ligado. A ativação é feita com cuidado, primeiro numa loja piloto.
          </span>
        </p>
      )}

      <div className="mb-3 grid gap-2 text-[12px] sm:grid-cols-2">
        <div className="rounded-menuzia border border-border px-3 py-2" data-testid="robo-instancia">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-text-subtle">WhatsApp da loja</span>
          {estado.instancia ? (
            <span className="text-text-main">
              {whatsapp === null ? 'verificando…' : whatsapp.conectado ? 'conectado' : `desconectado${whatsapp.estado ? ` (${whatsapp.estado})` : ''}`}
            </span>
          ) : (
            <span className="text-text-main">nenhum conectado — conecte em Integrações › WhatsApp</span>
          )}
        </div>
        <div className="rounded-menuzia border border-border px-3 py-2">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-text-subtle">Últimas 24h</span>
          <span className="text-text-main" data-testid="robo-24h">
            {estado.webhooks24h} mensagens recebidas · {estado.envios24h.enviados} respostas
            {estado.envios24h.falhas ? ` · ${estado.envios24h.falhas} falhas` : ''}
          </span>
        </div>
      </div>

      <details className="mb-3 rounded-menuzia border border-border px-3 py-2 text-[12px] text-text-main">
        <summary className="cursor-pointer font-semibold">O que o robô responde</summary>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-text-subtle">
          <li>Saudação com o menu e o link do cardápio.</li>
          <li>Status do último pedido feito com aquele número.</li>
          <li>Horário de funcionamento e taxa de entrega por bairro cadastrado.</li>
          <li>“Falar com atendente”: o robô para de responder naquela conversa.</li>
          <li>Áudio, foto, figurinha e localização: avisa o que consegue fazer.</li>
          <li>Nunca cria, cancela ou altera pedido, e não recebe pagamento.</li>
        </ul>
      </details>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {ligado ? (
          <Button variant="outline" disabled={salvando} onClick={() => chamar('PUT', '/api/admin/whatsapp/robo', { roboAtivo: false }, 'Robô desligado.')} data-testid="robo-alternar">
            Desligar o robô
          </Button>
        ) : confirmarLigar ? (
          <>
            <span className="text-[12px] text-text-main">Ligar faz o robô responder os clientes que escreverem. Confirmar?</span>
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
          <span className="text-[11px] text-text-subtle">
            Alterado em {hora(estado.atualizadoEm)}{estado.atualizadoPor ? ` por ${estado.atualizadoPor}` : ''}
          </span>
        )}
      </div>

      {aviso && <p className="mb-2 rounded-menuzia bg-price-bg px-3 py-2 text-[12px] text-price-text" role="status">{aviso}</p>}
      {erro && <p className="mb-2 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] text-danger" role="alert">{erro}</p>}

      <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Boas-vindas</label>
      <textarea
        value={texto}
        maxLength={500}
        rows={3}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={estado.boasVindasPadrao}
        className={CAMPO}
        data-testid="robo-boas-vindas"
      />
      <p className="mb-2 text-[11px] text-text-subtle">O link do cardápio e o menu entram sozinhos no fim.</p>
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <label className="text-[12px] text-text-main">
          Repetir as boas-vindas após (horas sem conversa)
          <input type="number" min={estado.limites.boasVindasHoras[0]} max={estado.limites.boasVindasHoras[1]} value={horas} onChange={(e) => setHoras(e.target.value)} className={CAMPO} data-testid="robo-horas" />
        </label>
        <label className="text-[12px] text-text-main">
          Robô volta após atendimento humano (minutos sem mensagem)
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

      <div className="mt-4 rounded-menuzia border border-border px-3 py-2.5 text-[12px]">
        <span className="mb-1 flex items-center gap-1.5 font-semibold text-text-main"><KeyRound className="h-3.5 w-3.5" /> Endereço de recebimento (webhook)</span>
        <code className="block break-all text-[11px] text-text-subtle" data-testid="robo-webhook">{estado.webhookMascarado ?? '—'}</code>
        <p className="mt-1 text-text-subtle">Configurado pela Menuzia na ativação. Trocar o segredo desliga o endereço antigo na hora.</p>
        <Button
          variant="outline"
          className="mt-2"
          disabled={salvando}
          onClick={() => chamar('POST', '/api/admin/whatsapp/robo', { acao: 'rotacionar_segredo' }, 'Segredo trocado. Atualize o webhook na Evolution antes de usar.')}
          data-testid="robo-rotacionar"
        >
          Trocar segredo
        </Button>
      </div>

      <div className="mt-4">
        <h4 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-text-subtle">Em atendimento humano</h4>
        {!conversas?.emAtendimento.length ? (
          <p className="text-[12px] text-text-subtle" data-testid="robo-sem-silenciadas">Nenhuma conversa aguardando atendente agora.</p>
        ) : (
          <ul className="divide-y divide-border rounded-menuzia border border-border" data-testid="robo-silenciadas">
            {conversas.emAtendimento.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
                <span className="min-w-0">
                  <strong className="text-text-main">{c.nome ?? c.telefone}</strong>
                  {c.nome && <span className="ml-1 text-text-subtle">{c.telefone}</span>}
                  <span className="block text-text-subtle">
                    {MOTIVO[c.motivo ?? ''] ?? 'em atendimento'} · desde {hora(c.silenciadaEm)} · robô volta {hora(c.voltaEm)}
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
            <h4 className="mb-1.5 mt-3 text-[12px] font-bold uppercase tracking-wide text-text-subtle">Atendidas pelo robô (24h)</h4>
            <ul className="divide-y divide-border rounded-menuzia border border-border" data-testid="robo-com-robo">
              {conversas.comRobo.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12px]">
                  <span className="min-w-0 text-text-main">{c.nome ?? c.telefone} <span className="text-text-subtle">· {hora(c.ultimaMensagemEm)}</span></span>
                  <Button variant="ghost" disabled={salvando} onClick={() => chamar('POST', '/api/admin/whatsapp/conversas', { conversaId: c.id, acao: 'pausar' }, 'Robô pausado nesta conversa.')} data-testid="robo-pausar">
                    <Pause className="mr-1 inline h-3.5 w-3.5" /> Pausar robô
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  )
}
