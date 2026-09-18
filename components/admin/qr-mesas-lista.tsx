'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Download, ExternalLink, Printer } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DrawerFolhaMesas } from '@/app/admin/mesas/qr'
import { urlPublicaDaMesa, type Mesa } from '@/lib/queries/mesas'
import { nomeArquivoQr } from '@/lib/qr-cardapio'

interface TokenQr {
  id: string
  nome: string
  setor: string | null
  ativa: boolean
  token: string | null
  qrRevogado: boolean
}

/**
 * QR das mesas, com o módulo Mesas e Comandas ligado.
 *
 * Cada mesa tem o SEU link (`/mesa/<token>`), que abre o cardápio de autoatendimento da
 * mesa: o cliente escolhe e mostra ao garçom. É diferente do QR do delivery (a vitrine
 * `/loja/<slug>`), que continua disponível abaixo para divulgação e balcão.
 *
 * Os links vêm de `/api/admin/mesas/qr`, que só responde à gestão.
 */
export function QrDasMesas({ mesas, nomeLoja, logoUrl }: { mesas: Mesa[]; nomeLoja: string; logoUrl: string | null }) {
  const [tokens, setTokens] = useState<TokenQr[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [folhaAberta, setFolhaAberta] = useState(false)
  const origem = typeof window === 'undefined' ? '' : window.location.origin

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/admin/mesas/qr', { cache: 'no-store' })
      const corpo = (await r.json().catch(() => ({}))) as { mesas?: TokenQr[]; error?: string }
      if (!r.ok) {
        setErro(corpo.error ?? 'Não foi possível carregar os QR Codes das mesas.')
        return
      }
      setTokens((corpo.mesas ?? []).filter((m) => m.ativa))
    })()
  }, [])

  async function copiar(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(id)
      setTimeout(() => setCopiado((atual) => (atual === id ? null : atual)), 1800)
    } catch {
      /* clipboard bloqueado: o link continua visível para copiar à mão */
    }
  }

  async function baixar(nome: string, url: string) {
    const dado = await QRCode.toDataURL(url, { width: 1024, margin: 1, errorCorrectionLevel: 'M' })
    const a = document.createElement('a')
    a.href = dado
    a.download = nomeArquivoQr(`${nomeLoja}-${nome}`)
    a.click()
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="mb-1 text-[13px] font-bold text-text-main">QR Code das mesas</h3>
          <p className="text-[12px] leading-relaxed text-text-subtle">
            Cada mesa tem o seu QR. Ele abre o <strong className="text-text-main">cardápio da mesa</strong>: o cliente
            escolhe os itens e mostra ao garçom — nada vai para a cozinha sem o garçom lançar.
          </p>
        </div>
        <Button onClick={() => setFolhaAberta(true)} disabled={!tokens || tokens.length === 0}>
          <Printer size={13} />
          Imprimir folha das mesas
        </Button>
      </div>

      {erro && <p className="mt-3 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] text-danger" role="alert">{erro}</p>}
      {!tokens && !erro && <p className="mt-3 text-[12px] text-text-subtle">Carregando…</p>}
      {tokens && tokens.length === 0 && (
        <p className="mt-3 rounded-menuzia border border-dashed border-border px-3 py-2.5 text-[12px] text-text-subtle">
          Nenhuma mesa ativa. Cadastre as mesas em <strong>Mesas e Comandas</strong>, no menu lateral.
        </p>
      )}

      {tokens && tokens.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-menuzia border border-border">
          {tokens.map((m) => {
            const url = m.token ? urlPublicaDaMesa(origem, m.token) : ''
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="w-24 flex-shrink-0 text-[13px] font-semibold text-text-main">
                  {m.nome}
                  {m.setor && <span className="block text-[10px] font-normal text-text-subtle">{m.setor}</span>}
                </span>
                {m.qrRevogado || !url ? (
                  <span className="flex-1 text-[12px] text-danger">QR revogado — gere um novo em Mesas e Comandas.</span>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-subtle" title={url}>
                      {url}
                    </span>
                    <span className="flex flex-shrink-0 gap-1">
                      <button
                        onClick={() => copiar(m.id, url)}
                        aria-label={`Copiar o link da ${m.nome}`}
                        className={[
                          'flex min-h-[40px] items-center gap-1 rounded-menuzia px-2 text-[11px] font-semibold lg:min-h-[28px]',
                          copiado === m.id ? 'text-status-ready' : 'text-primary hover:bg-primary/10',
                        ].join(' ')}
                      >
                        {copiado === m.id ? <Check size={13} /> : <Copy size={13} />}
                        {copiado === m.id ? 'Copiado!' : 'Copiar'}
                      </button>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Abrir o cardápio da ${m.nome}`}
                        className="flex min-h-[40px] items-center gap-1 rounded-menuzia px-2 text-[11px] font-semibold text-primary hover:bg-primary/10 lg:min-h-[28px]"
                      >
                        <ExternalLink size={13} />
                        Abrir
                      </a>
                      <button
                        onClick={() => baixar(m.nome, url)}
                        aria-label={`Baixar o QR da ${m.nome}`}
                        className="flex min-h-[40px] items-center gap-1 rounded-menuzia px-2 text-[11px] font-semibold text-primary hover:bg-primary/10 lg:min-h-[28px]"
                      >
                        <Download size={13} />
                        PNG
                      </button>
                    </span>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {folhaAberta && (
        <DrawerFolhaMesas mesas={mesas.filter((m) => m.ativa)} nomeLoja={nomeLoja} logoUrl={logoUrl} onFechar={() => setFolhaAberta(false)} />
      )}
    </Card>
  )
}
