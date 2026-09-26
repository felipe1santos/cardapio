'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, RotateCcw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * Robô de atendimento do WhatsApp (v1, sem IA) — Integrações.
 *
 * Liga/desliga por loja, texto de boas-vindas e conversas em que o robô está calado
 * (cliente pediu atendente ou a loja respondeu pelo celular), com botão para devolver ao
 * robô. Fala por /api/admin/whatsapp/robo (só o dono). O robô nasce desligado.
 */
interface Estado {
  roboAtivo: boolean
  boasVindas: string | null
  boasVindasPadrao: string
  silenciadas: { id: string; telefone: string; motivo: string | null; desde: string | null; ultimaMensagem: string | null }[]
  envios24h: { enviados: number; pendentes: number; falhas: number }
}

const MOTIVO: Record<string, string> = { cliente: 'cliente pediu atendente', loja: 'loja respondeu pelo celular', painel: 'pelo painel' }

function hora(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function RoboWhatsappCard() {
  const [whatsappConectado, setWhatsappConectado] = useState<boolean | null>(null)
  const [estado, setEstado] = useState<Estado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/whatsapp/robo', { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return setErro(j.error ?? 'Não foi possível carregar o robô.')
    setEstado(j)
    setTexto(j.boasVindas ?? '')
  }, [])

  useEffect(() => {
    void carregar()
    fetch('/api/admin/whatsapp/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setWhatsappConectado(j?.connected === true))
      .catch(() => setWhatsappConectado(null))
  }, [carregar])

  async function salvar(corpo: Record<string, unknown>, ok: string) {
    setSalvando(true)
    setErro(null)
    setAviso(null)
    const r = await fetch('/api/admin/whatsapp/robo', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    const j = await r.json().catch(() => ({}))
    setSalvando(false)
    if (!r.ok) return setErro(j.error ?? 'Não foi possível salvar.')
    setAviso(ok)
    await carregar()
  }

  async function reativar(id: string) {
    setErro(null)
    const r = await fetch('/api/admin/whatsapp/robo/reativar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversaId: id }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return setErro(j.error ?? 'Não foi possível reativar.')
    setAviso('Conversa devolvida ao robô.')
    await carregar()
  }

  if (!estado) {
    return (
      <Card data-testid="robo-whatsapp">
        <p className="text-[12px] text-text-subtle">{erro ?? 'Carregando o robô de atendimento…'}</p>
      </Card>
    )
  }

  const ligado = estado.roboAtivo
  return (
    <Card data-testid="robo-whatsapp" className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Bot className="h-5 w-5 flex-shrink-0 text-primary" aria-hidden="true" />
        <h3 className="text-[13px] font-bold text-text-main">Robô de atendimento</h3>
        <span
          data-testid="robo-estado"
          className={`rounded-full px-2 py-[2px] text-[11px] font-bold ${ligado ? 'bg-price-bg text-price-text' : 'bg-[#F1F2F4] text-text-subtle'}`}
        >
          {ligado ? 'Ligado' : 'Desligado'}
        </span>
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
        Responde o cliente no WhatsApp da loja com o link do cardápio e o status do último pedido. Se o cliente pedir um
        atendente, ou se alguém da loja responder pelo celular, o robô fica calado naquela conversa e volta sozinho
        depois de 2 horas sem mensagens (ou quando você devolver aqui). Nunca responde grupos nem status.
      </p>
      {whatsappConectado === false && (
        <p className="mb-3 rounded-menuzia border border-warn bg-warn-bg px-3 py-2 text-[12px] text-warn">
          O WhatsApp da loja não está conectado: o robô não recebe nem responde até conectar.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          variant={ligado ? 'outline' : 'primary'}
          disabled={salvando}
          onClick={() => salvar({ roboAtivo: !ligado }, ligado ? 'Robô desligado.' : 'Robô ligado.')}
          data-testid="robo-alternar"
        >
          {ligado ? 'Desligar robô' : 'Ligar robô'}
        </Button>
        <span className="text-[11.5px] text-text-subtle">
          Últimas 24h: {estado.envios24h.enviados} enviadas · {estado.envios24h.pendentes} na fila · {estado.envios24h.falhas} com falha
        </span>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Mensagem de boas-vindas</span>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, 500))}
          placeholder={estado.boasVindasPadrao}
          rows={3}
          data-testid="robo-boas-vindas"
          className="w-full rounded-menuzia border border-border px-2.5 py-2 text-[13px] text-text-main outline-none focus:border-primary"
        />
      </label>
      <p className="mt-1 text-[11px] text-text-subtle">
        Vazio usa o texto padrão. O link do cardápio e as opções (1 status do pedido, 2 atendente) entram sempre no fim.
        Enviada na primeira mensagem do cliente e de novo só depois de 12 horas sem conversa. {texto.length}/500
      </p>
      <div className="mt-2">
        <Button variant="secondary" disabled={salvando || texto === (estado.boasVindas ?? '')} onClick={() => salvar({ boasVindas: texto }, 'Boas-vindas salvas.')}>
          Salvar boas-vindas
        </Button>
      </div>

      <div className="mt-5">
        <h4 className="mb-1 text-[12px] font-bold text-text-main">Conversas com atendente</h4>
        {estado.silenciadas.length === 0 ? (
          <p className="text-[12px] text-text-subtle" data-testid="robo-sem-silenciadas">Nenhuma conversa aguardando atendente agora.</p>
        ) : (
          <ul className="divide-y divide-border rounded-menuzia border border-border" data-testid="robo-silenciadas">
            {estado.silenciadas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-2.5 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-text-main">{c.telefone}</span>
                  <span className="block text-[11px] text-text-subtle">
                    {MOTIVO[c.motivo ?? ''] ?? 'silenciada'} · desde {hora(c.desde)}
                  </span>
                </span>
                <Button variant="outline" onClick={() => reativar(c.id)} data-testid="robo-reativar">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Devolver ao robô
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3" aria-live="polite">
        {aviso && <p className="text-[12px] font-semibold text-status-ready">{aviso}</p>}
        {erro && <p className="text-[12px] font-semibold text-danger">{erro}</p>}
      </div>
    </Card>
  )
}
