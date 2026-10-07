'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, CheckCheck, ChevronDown, Headset, Info, KeyRound, MessageCircle, RotateCcw, Send, Settings2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Robô de atendimento do WhatsApp (v1, sem IA) — Integrações (visual novo, 2026-09-28).
 *
 * Dono: liga/desliga (só com o WhatsApp conectado), números das últimas 24h e quem está
 * aguardando atendente. Desligar o robô SÓ para as RESPOSTAS a mensagens recebidas: os
 * avisos do pedido (confirmado, em preparo, pronto, saiu para entrega), a fidelidade e as
 * campanhas saem por outro caminho (lib/whatsapp.ts, lib/fidelidade.ts,
 * lib/mensageria/campanhas-envio.ts), que não lê o interruptor — ver whatsapp-robo-flag.test.ts.
 *
 * O interruptor é otimista: muda na hora, mostra o aviso e volta atrás se a chamada falhar.
 *
 * Suporte da plataforma (e-mail em SUPERADMIN_EMAILS — a API diz `suporte: true`):
 * boas-vindas, tempos, webhook e troca do segredo em "Configurações avançadas".
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

/** Conexão do WhatsApp da loja (vem da página, que é quem conecta). */
export type ConexaoWhatsapp = { configurado: boolean; conectado: boolean; estado: string | null } | 'falhou' | null

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

const CAMPO = 'mt-1 w-full rounded-[8px] border border-[#D1D5DB] bg-white px-3 py-2 text-[13px] text-[#111827] focus:border-[#0688D4] focus:outline-none'

export function RoboWhatsappCard({ conexao, onConectar, avisar, somenteConfig = false }: {
  conexao: ConexaoWhatsapp
  onConectar: () => void
  avisar: (tom: 'ok' | 'erro', texto: string) => void
  /**
   * Ajustes › Robô de atendimento (2026-10-06): só as CONFIGURAÇÕES (ligar/desligar, o que responde,
   * avançadas). Números e quem aguarda atendente ficam só na central do WhatsApp (canto inferior).
   */
  somenteConfig?: boolean
}) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [conversas, setConversas] = useState<{ emAtendimento: Conversa[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [horas, setHoras] = useState('12')
  const [retorno, setRetorno] = useState('720')
  const [salvando, setSalvando] = useState(false)

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
    if (somenteConfig) return
    const c = await fetch('/api/admin/whatsapp/conversas', { cache: 'no-store' })
    if (c.ok) setConversas(await c.json())
  }, [somenteConfig])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function chamar(metodo: 'PUT' | 'POST', url: string, corpo: Record<string, unknown>, ok: string) {
    setSalvando(true)
    const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    const j = await r.json().catch(() => ({}))
    setSalvando(false)
    if (!r.ok) {
      avisar('erro', j.error ?? 'Não foi possível salvar.')
      return false
    }
    avisar('ok', ok)
    await carregar()
    return true
  }

  if (erro && !estado) {
    return (
      <section data-testid="robo-whatsapp" className="rounded-[12px] border border-[#E5E7EB] bg-white p-5">
        <p className="text-[13px] text-[#DC2626]">{erro}</p>
      </section>
    )
  }
  if (!estado) return <div className="h-[260px] animate-pulse rounded-[12px] border border-[#E5E7EB] bg-white" aria-busy="true" />

  const ligado = estado.roboAtivo
  const bloqueado = !estado.liberadoNoServidor
  const verificando = conexao === null
  const conectado = conexao !== null && conexao !== 'falhou' && conexao.conectado
  // Só bloqueia o "ligar" quando a conexão foi CONFIRMADA como desligada. Antes, enquanto a
  // tela ainda conferia (ou se a conferência falhasse/demorasse), o interruptor ficava
  // travado e o lojista não conseguia ativar o robô (bug de 2026-09-30).
  const desconectadoConfirmado = conexao !== null && conexao !== 'falhou' && !conexao.conectado
  const toggleDesabilitado = salvando || (!ligado && (bloqueado || desconectadoConfirmado))
  const aguardando = conversas?.emAtendimento ?? []

  async function alternar() {
    if (toggleDesabilitado || !estado) return
    const novo = !ligado
    // Otimista: o interruptor muda na hora; volta atrás se o servidor recusar.
    setEstado({ ...estado, roboAtivo: novo })
    setSalvando(true)
    const r = await fetch('/api/admin/whatsapp/robo', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roboAtivo: novo }) }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    setSalvando(false)
    if (!r || !r.ok) {
      setEstado((e) => (e ? { ...e, roboAtivo: !novo } : e))
      avisar('erro', (j as { error?: string }).error ?? 'Não foi possível alterar o robô. Tente de novo.')
      return
    }
    avisar('ok', novo ? 'Robô ativado.' : 'Robô desativado. Avisos de pedido continuam sendo enviados.')
    void carregar()
  }

  return (
    <section data-testid="robo-whatsapp" className="flex h-full flex-col rounded-[12px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      {/* Cabeçalho: nome e o interruptor */}
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:flex-nowrap">
        <div className="flex min-w-0 items-start gap-3">
          <Bot className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#4B5563]" />
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-[#111827]">Robô de atendimento</h3>
            <p className="mt-0.5 text-[13px] leading-[19px] text-[#6B7280]">Responde sozinho: cardápio, status do pedido, horário, taxas e “Falar com atendente”.</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            role="switch"
            aria-checked={ligado}
            aria-label={ligado ? 'Desligar o robô' : 'Ligar o robô'}
            disabled={toggleDesabilitado}
            onClick={() => void alternar()}
            data-testid="robo-alternar"
            className="group flex items-center gap-2 rounded-full disabled:cursor-not-allowed"
          >
            <span data-testid="robo-estado" className={['text-[13px] font-semibold', ligado ? 'text-[#059669]' : 'text-[#6B7280]'].join(' ')}>
              {ligado ? 'Ativado' : 'Desativado'}
            </span>
            <span
              className={[
                'relative inline-flex h-[24px] w-[42px] flex-shrink-0 items-center rounded-full transition-colors duration-200',
                ligado ? 'bg-[#0688D4]' : 'bg-[#D1D5DB]',
                toggleDesabilitado ? 'opacity-50' : '',
              ].join(' ')}
              aria-hidden
            >
              <span className={['absolute h-[18px] w-[18px] rounded-full bg-white shadow transition-transform duration-200', ligado ? 'translate-x-[21px]' : 'translate-x-[3px]'].join(' ')} />
            </span>
          </button>
          {!ligado && !bloqueado && desconectadoConfirmado && (
            <span className="flex items-center gap-1 text-[12px] text-[#6B7280]" data-testid="robo-dica">
              Conecte o WhatsApp para ativar ·
              <button type="button" onClick={onConectar} className="font-semibold text-[#0688D4] hover:underline" data-testid="robo-ir-conectar">Conectar</button>
            </span>
          )}
        </div>
      </div>

      {bloqueado && (
        <p className="mx-5 mb-3 flex items-center gap-2 text-[12.5px] text-[#92400E]" data-testid="robo-bloqueado">
          <ShieldAlert className="h-4 w-4 flex-shrink-0" /> O robô ainda não foi liberado pela Menuzia nesta loja.
        </p>
      )}
      {!ligado && !bloqueado && (
        <p className="mx-5 mb-3 flex items-start gap-2 text-[12.5px] text-[#6B7280]">
          <Info className="mt-[1px] h-4 w-4 flex-shrink-0" /> Desativado, o robô não responde mensagens — os avisos de pedido e da fidelidade continuam saindo normalmente.
        </p>
      )}

      <div className="flex-1 space-y-4 border-t border-[#F3F4F6] p-5">
        {!somenteConfig && <>
        {/* Números das últimas 24h */}
        <div className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-3" data-testid="robo-24h">
          <Numero icone={MessageCircle} rotulo="Mensagens recebidas" dica="24h" valor={estado.recebidas24h} />
          <Numero icone={Send} rotulo="Respostas do robô" dica="24h" valor={estado.envios24h.enviados} />
          <Numero icone={Headset} rotulo="Aguardando atendente" dica="agora" valor={aguardando.length} destaque={aguardando.length > 0} />
        </div>

        {/* Quem pediu atendente (o robô parou nessas conversas) */}
        {!aguardando.length ? (
          <p className="flex items-center gap-2 text-[13px] text-[#6B7280]" data-testid="robo-sem-silenciadas">
            <CheckCheck className="h-4 w-4 flex-shrink-0 text-[#059669]" /> Ninguém aguardando atendente agora.
          </p>
        ) : (
          <div className="rounded-[10px] border border-[#FDE68A]">
            <p className="flex items-center gap-2 px-3 pt-2.5 text-[13px] font-semibold text-[#92400E]">
              <Headset className="h-4 w-4" /> {aguardando.length === 1 ? '1 cliente aguardando atendente' : `${aguardando.length} clientes aguardando atendente`}
            </p>
            <p className="px-3 pb-2 text-[12.5px] text-[#92400E]/80">Responda pelo WhatsApp da loja. O robô volta sozinho depois, ou toque em “Devolver ao robô”.</p>
            <ul className="divide-y divide-[#FDE68A] border-t border-[#FDE68A]" data-testid="robo-silenciadas">
              {aguardando.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
                  <span className="min-w-0">
                    <strong className="font-semibold text-[#111827]">{c.nome ?? c.telefone}</strong>
                    {c.nome && <span className="ml-1 text-[#6B7280]">{c.telefone}</span>}
                    <span className="block text-[12px] text-[#6B7280]">{MOTIVO[c.motivo ?? ''] ?? 'em atendimento'} · desde {hora(c.silenciadaEm)}</span>
                  </span>
                  <Button variant="outline" disabled={salvando} onClick={() => chamar('POST', '/api/admin/whatsapp/conversas', { conversaId: c.id, acao: 'devolver' }, 'Conversa devolvida ao robô.')} data-testid="robo-reativar">
                    <RotateCcw className="mr-1 inline h-3.5 w-3.5" /> Devolver ao robô
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        </>}

        <details className="group rounded-[10px] border border-[#E5E7EB] px-3 py-2.5 text-[13px] text-[#111827]" data-testid="robo-o-que-responde">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
            <Info className="h-4 w-4 flex-shrink-0 text-[#6B7280]" /> <span className="min-w-0">O que o robô responde</span>
            <ChevronDown className="ml-auto h-4 w-4 flex-shrink-0 text-[#6B7280] transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-[#6B7280]">
            <li>Saudação com o menu e o link do cardápio.</li>
            <li>Status do último pedido feito com aquele número.</li>
            <li>Horário de funcionamento e taxa de entrega por bairro.</li>
            <li>“Falar com atendente”: o robô para de responder naquela conversa.</li>
            <li>Nunca cria, cancela ou altera pedido, e não recebe pagamento.</li>
          </ul>
        </details>

        {/* Suporte da plataforma — nunca aparece para o cliente final */}
        {estado.suporte && <Avancado estado={estado} texto={texto} setTexto={setTexto} horas={horas} setHoras={setHoras} retorno={retorno} setRetorno={setRetorno} salvando={salvando} chamar={chamar} />}
      </div>
    </section>
  )
}

function Numero({ icone: Icone, rotulo, dica, valor, destaque }: { icone: typeof Bot; rotulo: string; dica: string; valor: number; destaque?: boolean }) {
  return (
    <div className={['rounded-[10px] border p-3', destaque ? 'border-[#FDE68A] bg-[#FFFBEB]' : 'border-[#E5E7EB]'].join(' ')}>
      <p className="flex items-center gap-1.5 text-[12px] text-[#6B7280]"><Icone className="h-3.5 w-3.5" /> {rotulo} <span className="text-[11px] text-[#9CA3AF]">· {dica}</span></p>
      <p className="mt-1 text-[22px] font-semibold tabular-nums leading-tight text-[#111827]">{valor.toLocaleString('pt-BR')}</p>
    </div>
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
    <details className="group rounded-[10px] border border-dashed border-[#9CA3AF] px-3 py-2.5 text-[13px]" data-testid="robo-avancado">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-[#111827]">
        <Settings2 className="h-4 w-4 text-[#6B7280]" /> Configurações avançadas <span className="rounded-full bg-[#F3F4F6] px-2 py-[1px] text-[11px] text-[#4B5563]">suporte Menuzia</span>
        <ChevronDown className="ml-auto h-4 w-4 text-[#6B7280] transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 space-y-3">
        <label className="block text-[12.5px] font-semibold text-[#111827]">
          Boas-vindas
          <textarea value={texto} maxLength={500} rows={3} onChange={(e) => setTexto(e.target.value)} placeholder={estado.boasVindasPadrao} className={CAMPO} data-testid="robo-boas-vindas" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[12.5px] text-[#111827]">
            Repetir boas-vindas após (horas)
            <input type="number" min={lim.boasVindasHoras[0]} max={lim.boasVindasHoras[1]} value={horas} onChange={(e) => setHoras(e.target.value)} className={CAMPO} data-testid="robo-horas" />
          </label>
          <label className="text-[12.5px] text-[#111827]">
            Robô volta após atendimento (min)
            <input type="number" min={lim.retornoMinutos[0]} max={lim.retornoMinutos[1]} value={retorno} onChange={(e) => setRetorno(e.target.value)} className={CAMPO} data-testid="robo-retorno" />
          </label>
        </div>
        <Button variant="outline" disabled={salvando} onClick={() => chamar('PUT', '/api/admin/whatsapp/robo', { boasVindas: texto, boasVindasHoras: horas, retornoMinutos: retorno }, 'Configuração salva.')}>
          Salvar boas-vindas
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] bg-[#F9FAFB] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <span className="mb-0.5 flex items-center gap-1.5 font-semibold text-[#111827]"><KeyRound className="h-3.5 w-3.5" /> Webhook</span>
            <code className="block break-all text-[11.5px] text-[#6B7280]" data-testid="robo-webhook">{estado.webhookMascarado ?? '—'}</code>
            <p className="mt-0.5 text-[12px] text-[#6B7280]">Trocar o segredo desliga o endereço antigo na hora — atualize a Evolution antes.</p>
          </div>
          <Button variant="outline" disabled={salvando} onClick={() => chamar('POST', '/api/admin/whatsapp/robo', { acao: 'rotacionar_segredo' }, 'Segredo trocado. Atualize o webhook na Evolution antes de usar.')} data-testid="robo-rotacionar">
            Trocar segredo
          </Button>
        </div>
        {estado.atualizadoEm && (
          <p className="text-[12px] text-[#6B7280]">Última alteração {hora(estado.atualizadoEm)}{estado.atualizadoPor ? ` por ${estado.atualizadoPor}` : ''}.</p>
        )}
      </div>
    </details>
  )
}
