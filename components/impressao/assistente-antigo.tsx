'use client'

import { useState } from 'react'
import { ArrowLeft, Download, KeyRound, Printer } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ToggleRow } from '@/components/admin/campos-ajustes'
import { SeloStatus } from '@/components/admin/painel-visual'
import { IMPRESSORA_VAZIA } from '@/components/impressao/documentos'
import { DOWNLOAD_ASSISTENTE_ATUAL } from '@/lib/impressao/rotulos'
import type { ConfigImpressao, Impressora, ImpressoraInput } from '@/lib/queries/impressao'

/**
 * Assistente ANTIGO (0.1.23, token da loja) — o mesmo conteúdo que a tela tinha, só
 * guardado atrás do botão "Assistente antigo". Nada mudou no funcionamento: token, opções,
 * impressoras e ficha da cozinha continuam gravando nos mesmos lugares.
 */
export interface AssistenteAtual {
  config: ConfigImpressao
  impressoras: Impressora[]
  nomeLoja: string
  logoUrl: string | null
  /** Token e opções do Assistente atual: só o dono altera (Ajustes era só do dono). */
  podeEditar: boolean
}

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export function AssistenteAntigo({
  atual, token, vistoEm, online, impressoraEmUsoId, cozinhaNoBeta, onVoltar, onPatch, onGerarToken, onEditarImpressora, onRemoverImpressora,
}: {
  atual: AssistenteAtual | null
  token: string | null
  vistoEm: string | null
  online: boolean
  impressoraEmUsoId: string | null
  cozinhaNoBeta: boolean
  /** Sem ele, sem o banner do topo (a tela nova mostra o antigo dentro das Configurações avançadas). */
  onVoltar?: () => void
  onPatch: (patch: Partial<ConfigImpressao>) => void
  onGerarToken: () => void
  onEditarImpressora: (id: string | null, input: ImpressoraInput) => void
  onRemoverImpressora: (id: string) => void
}) {
  const [copiado, setCopiado] = useState(false)
  const pode = atual?.podeEditar === true
  const desativado = !!atual && !atual.config.ativarAssistente
  return (
    <div className="space-y-4" data-testid="area-assistente-antigo">
      {onVoltar && <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border-[0.8px] border-[#FDE68A] bg-[#FFFBEB] px-4 py-3">
        <p className="min-w-0 text-[12.5px] text-[#92400E]">
          Você está vendo o <strong>Assistente antigo</strong> (versão {DOWNLOAD_ASSISTENTE_ATUAL.versao}, com token).
          {cozinhaNoBeta ? ' Hoje a cozinha sai pelo Beta.' : ' Ele continua imprimindo a cozinha enquanto o Beta não estiver em “Cozinha e Caixa”.'}
        </p>
        <button type="button" onClick={onVoltar} data-testid="usar-novo" className="inline-flex items-center gap-1.5 rounded-[6px] bg-[#0688D4] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#0570AE]">
          <ArrowLeft className="h-4 w-4" /> Usar novo Assistente
        </button>
      </div>}

      <section className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--adm-texto)]"><Printer className="h-4 w-4 text-[var(--adm-texto-suave)]" /> Assistente antigo</h2>
          <SeloStatus
            estado={desativado ? 'desconectado' : online ? 'conectado' : vistoEm ? 'aguardando' : 'desconectado'}
            rotulo={desativado ? 'Desativado' : online ? 'Imprimindo' : vistoEm ? `Sem sinal desde ${quando(vistoEm)}` : 'Não conectado'}
            testid="antigo-status"
          />
        </div>
        <a href={DOWNLOAD_ASSISTENTE_ATUAL.url} className="mt-3 inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--adm-borda)] px-3 py-2 text-[13px] font-semibold text-[var(--adm-texto)] hover:border-[#0688D4]">
          <Download className="h-4 w-4" /> Baixar Assistente {DOWNLOAD_ASSISTENTE_ATUAL.versao} (Windows)
        </a>
        <p className="mt-1 text-[11.5px] text-[var(--adm-texto-suave)]">
          Dois cliques no instalador. Se o Windows avisar, “Mais informações” → “Executar assim mesmo”.{' '}
          <a href="/guia-impressora.html" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">Guia passo a passo</a>
        </p>

        {atual && (
          <div className="mt-3 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] px-3">
            <ToggleRow label="Ativar o Assistente de Impressão" checked={atual.config.ativarAssistente} disabled={!pode} onChange={(v) => onPatch({ ativarAssistente: v })} />
            <ToggleRow label="Impressão automática" hint="Imprime sozinho assim que o pedido chega." checked={atual.config.impressaoAutomatica} disabled={!pode} onChange={(v) => onPatch({ impressaoAutomatica: v })} />
            <ToggleRow label="Aceitar pedidos automaticamente" hint="Move o pedido para “Preparando” assim que ele chega." checked={atual.config.aceitarPedidosAutomaticamente} disabled={!pode} onChange={(v) => onPatch({ aceitarPedidosAutomaticamente: v })} />
          </div>
        )}
        {atual && !pode && <p className="mt-1 text-[11.5px] text-[var(--adm-texto-suave)]">Só o dono da loja altera estas opções e o token.</p>}
        {pode && (
          <div className="mt-3 rounded-[6px] bg-[#F8FAFC] p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--adm-texto-forte)]"><KeyRound className="h-3.5 w-3.5" /> Token do Assistente antigo</p>
            {token ? (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-[6px] bg-[#0B1220] px-2.5 py-2 font-mono text-[12px] text-cyan-300">{token}</code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(token).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000) })}
                  className="rounded-[6px] border border-[var(--adm-borda)] bg-white px-3 py-2 text-[12px] font-semibold"
                >
                  {copiado ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            ) : (
              <p className="text-[12px] text-[var(--adm-texto-suave)]">Nenhum token gerado ainda.</p>
            )}
            <button type="button" onClick={onGerarToken} className="mt-1.5 text-[11.5px] font-semibold text-primary hover:underline">
              {token ? 'Gerar novo token (o atual deixa de valer)' : 'Gerar token'}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-4">
        <h3 className="text-[14px] font-semibold text-[var(--adm-texto)]">Impressoras do Assistente antigo</h3>
        <p className="text-[12px] text-[var(--adm-texto-suave)]">Papel, fonte e cópias de cada impressora.</p>
        <ul className="mt-2 space-y-1.5">
          {atual?.impressoras.map((imp) => {
            const emUso = imp.id === impressoraEmUsoId
            return (
              <li key={imp.id} className={['flex flex-wrap items-center justify-between gap-2 rounded-[6px] border px-3 py-2', emUso ? 'border-yellow-400 bg-yellow-100' : 'border-[var(--adm-borda)]'].join(' ')}>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[var(--adm-texto)]">{imp.nome} {emUso && <Badge tone="new" className="ml-1">Em uso</Badge>}</p>
                  <p className="text-[11px] text-[var(--adm-texto-suave)]">Papel {imp.largura === 32 ? '58 mm' : '80 mm'} · fonte {imp.tamanhoFonte} · {imp.copias}x</p>
                </div>
                {pode && (
                  <div className="flex gap-3">
                    <button type="button" onClick={() => onEditarImpressora(imp.id, { nome: imp.nome, tamanhoFonte: imp.tamanhoFonte, largura: imp.largura, copias: imp.copias })} className="text-[12px] font-semibold text-primary hover:underline">Editar</button>
                    <button type="button" onClick={() => onRemoverImpressora(imp.id)} className="text-[12px] text-[var(--adm-texto-suave)] hover:text-danger">Remover</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {atual && atual.impressoras.length === 0 && <p className="mt-1 text-[12px] text-[var(--adm-texto-suave)]">Nenhuma impressora cadastrada.</p>}
        {pode && (
          <button type="button" onClick={() => onEditarImpressora(null, IMPRESSORA_VAZIA)} className="mt-2 text-[12px] font-semibold text-primary hover:underline">
            + Nova impressora do Assistente antigo
          </button>
        )}
      </section>

    </div>
  )
}
