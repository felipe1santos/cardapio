'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * Liga/desliga o módulo Mesas e Comandas. Só aparece para o dono (a rota confere de novo).
 *
 * Ligar é o passo 1 do atendimento na mesa; desligar com conta de mesa aberta é recusado
 * pelo servidor. Depois de mudar, a página recarrega para o menu lateral refletir.
 */
export function CardModuloMesas() {
  const [ativo, setAtivo] = useState<boolean | null>(null)
  const [contasAbertas, setContasAbertas] = useState(0)
  const [salvando, setSalvando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/admin/modulos/mesas', { cache: 'no-store' })
      const corpo = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErro(corpo.error ?? 'Não foi possível carregar o módulo.')
        return
      }
      setAtivo(corpo.ativo === true)
      setContasAbertas(Number(corpo.contasAbertas ?? 0))
    })()
  }, [])

  async function mudar(novo: boolean) {
    setSalvando(true)
    setErro(null)
    const r = await fetch('/api/admin/modulos/mesas', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: novo }),
    })
    const corpo = await r.json().catch(() => ({}))
    setSalvando(false)
    setConfirmando(false)
    if (!r.ok) {
      setErro(corpo.error ?? 'Não foi possível salvar.')
      return
    }
    setAtivo(novo)
    // O menu lateral lê a flag ao montar o painel.
    window.location.reload()
  }

  if (ativo === null && !erro) return null

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="mb-1 text-[13px] font-bold text-text-main">Módulo Mesas e Comandas</h3>
          <p className="text-[12px] leading-relaxed text-text-subtle">
            Atendimento no salão: QR Code por mesa, painel do garçom, conta com taxa de serviço, divisão e pagamentos.
            Usa o mesmo cardápio do delivery — nada é cadastrado de novo. O PDV de balcão não depende disto.
          </p>
        </div>
        <span
          className={`rounded-menuzia px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            ativo ? 'bg-price-bg text-price-text' : 'bg-page text-text-subtle'
          }`}
          role="status"
        >
          {ativo ? 'Ligado' : 'Desligado'}
        </span>
      </div>

      {erro && <p className="mt-3 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] text-danger" role="alert">{erro}</p>}

      {ativo === false && (
        <Button className="mt-3" onClick={() => mudar(true)} disabled={salvando}>
          {salvando ? 'Ligando…' : 'Ligar o módulo'}
        </Button>
      )}

      {ativo === true && !confirmando && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link href="/admin/mesas">
            <Button variant="outline">Abrir o salão</Button>
          </Link>
          <Button variant="ghost" onClick={() => setConfirmando(true)} disabled={salvando}>
            Desligar
          </Button>
        </div>
      )}

      {ativo === true && confirmando && (
        <div className="mt-3 rounded-menuzia border border-warn bg-warn-bg p-3">
          <p className="text-[12px] leading-relaxed text-text-main">
            O menu Mesas e Comandas some, os QR Codes das mesas deixam de abrir e o garçom perde o acesso ao salão.
            Nada é apagado: ao religar, mesas, QR e histórico voltam como estavam.
            {contasAbertas > 0 && (
              <strong> Há {contasAbertas} {contasAbertas === 1 ? 'conta aberta' : 'contas abertas'} — feche antes.</strong>
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmando(false)} disabled={salvando}>Cancelar</Button>
            <Button onClick={() => mudar(false)} disabled={salvando}>{salvando ? 'Desligando…' : 'Desligar o módulo'}</Button>
          </div>
        </div>
      )}
    </Card>
  )
}
