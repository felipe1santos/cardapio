'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { atualizarEstacao, criarEstacao, listarEstacoes, removerEstacao, rotacionarTokenEstacao, type Estacao } from '@/lib/queries/estacoes'
import { DESCRICAO_MODO, LABEL_MODO, MODOS, type ModoEstacao } from '@/lib/cozinha/modo'
import { TopBar } from '@/components/layout/topbar'

/**
 * Cozinha (2026-09-30): as estações da cozinha saíram de Ajustes › Cozinha e viraram item
 * do menu. Cada estação é um cartão com o QR GRANDE já visível (aponta o tablet/TV e
 * pronto), o link com "Copiar", "Abrir em tela cheia", "Imprimir QR" e as ações
 * discretas (desativar, novo link, excluir). Os tipos são os de sempre, com nomes novos:
 * Preparo (= Produção), Embalo / Expedição, Completa (= Cozinha completa).
 */
function urlEstacao(token: string): string {
  return `${window.location.origin}/cozinha/${token}`
}

function quando(iso: string | null | undefined): string {
  if (!iso) return 'nunca acessou'
  const d = new Date(iso)
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function imprimirQr(estacao: Estacao, qr: string) {
  const w = window.open('', '_blank', 'width=720,height=900')
  if (!w) return
  const nome = estacao.nome.replace(/[<>&]/g, '')
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>QR ${nome}</title>
<style>body{font-family:Inter,Arial,sans-serif;text-align:center;padding:40px;color:#1F2937}h1{font-size:30px;margin:0 0 6px}p{font-size:15px;color:#6B7280;margin:4px 0}img{width:420px;height:420px;margin:24px auto}ol{text-align:left;display:inline-block;font-size:15px;line-height:1.7}</style>
</head><body><h1>${nome}</h1><p>${LABEL_MODO[estacao.modo]}</p><img src="${qr}" alt="QR Code"/>
<ol><li>Abra a câmera do tablet ou celular da cozinha.</li><li>Aponte para o QR Code e toque no link.</li><li>Na tela da estação, toque em "Tela cheia".</li></ol>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`)
  w.document.close()
}

function IlustracaoVazia() {
  return (
    <svg viewBox="0 0 160 110" className="mx-auto h-[110px] w-[160px]" aria-hidden>
      <rect x="20" y="20" width="120" height="74" rx="6" fill="#EDEEF1" stroke="#E5E7EB" strokeWidth="2" />
      <rect x="30" y="30" width="44" height="54" rx="3" fill="#fff" stroke="#E5E7EB" />
      <rect x="84" y="30" width="46" height="24" rx="3" fill="#fff" stroke="#E5E7EB" />
      <rect x="84" y="60" width="46" height="24" rx="3" fill="#fff" stroke="#E5E7EB" />
      <rect x="36" y="38" width="26" height="5" rx="2" fill="#0688D4" />
      <rect x="36" y="48" width="32" height="4" rx="2" fill="#E5E7EB" />
      <rect x="36" y="56" width="22" height="4" rx="2" fill="#E5E7EB" />
      <circle cx="98" cy="42" r="6" fill="#F97316" />
      <circle cx="98" cy="72" r="6" fill="#10B981" />
      <rect x="66" y="94" width="28" height="6" rx="2" fill="#E5E7EB" />
    </svg>
  )
}

export default function CozinhaPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [estacoes, setEstacoes] = useState<Estacao[] | null>(null)
  const [qr, setQr] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [novaAberta, setNovaAberta] = useState(false)
  const [nome, setNome] = useState('')
  const [modo, setModo] = useState<ModoEstacao>('producao')
  const [confirmar, setConfirmar] = useState<{ tipo: 'link' | 'excluir'; estacao: Estacao } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async (rid: string) => {
    try {
      const lista = await listarEstacoes(supabase, rid)
      setEstacoes(lista)
      const imagens: Record<string, string> = {}
      for (const e of lista) imagens[e.id] = await QRCode.toDataURL(urlEstacao(e.token), { width: 480, margin: 1 })
      setQr(imagens)
    } catch {
      setErro('Não foi possível carregar as estações.')
    }
  }, [supabase])

  useEffect(() => {
    buscarRestauranteIdDoUsuario(supabase).then((rid) => {
      if (!rid) return
      setRestauranteId(rid)
      void carregar(rid)
    })
  }, [supabase, carregar])

  // Online/offline e último acesso sem recarregar.
  useEffect(() => {
    if (!restauranteId) return
    const t = setInterval(() => void carregar(restauranteId), 20_000)
    return () => clearInterval(t)
  }, [restauranteId, carregar])

  async function acao(fn: () => Promise<void>, ok: string) {
    if (!restauranteId) return
    setOcupado(true); setErro(null)
    try { await fn(); setAviso(ok); await carregar(restauranteId) } catch { setErro('Não foi possível concluir. Tente de novo.') } finally { setOcupado(false) }
  }

  async function copiar(e: Estacao) {
    try { await navigator.clipboard.writeText(urlEstacao(e.token)); setAviso(`Link de "${e.nome}" copiado.`) } catch { window.prompt('Copie o link:', urlEstacao(e.token)) }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Cozinha" breadcrumb="Estações e telas da cozinha" />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[640px] text-[13px] text-text-subtle">
            Cada estação é uma tela da cozinha (tablet, monitor ou TV) que acompanha os pedidos sem login. Aponte a câmera para o QR Code ou abra o link no aparelho da cozinha.
          </p>
          <button type="button" onClick={() => { setNovaAberta(true); setNome(''); setModo('producao') }} data-testid="nova-estacao"
            className="rounded-menuzia bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark">+ Nova estação</button>
        </div>
        {aviso && <p role="status" className="mb-3 rounded-menuzia border border-status-ready/40 bg-price-bg px-3 py-2 text-[12.5px] text-price-text">{aviso}</p>}
        {erro && <p className="mb-3 rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{erro}</p>}

        {estacoes === null ? (
          <div className="h-40 animate-pulse rounded-menuzia border border-border bg-white" />
        ) : estacoes.length === 0 ? (
          <div className="rounded-menuzia border border-border bg-white px-6 py-10 text-center" data-testid="estacoes-vazio">
            <IlustracaoVazia />
            <p className="mt-3 text-[14px] font-semibold text-text-main">Crie a primeira estação para a cozinha acompanhar os pedidos em uma tela própria</p>
            <button type="button" onClick={() => setNovaAberta(true)} className="mt-4 rounded-menuzia bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark">+ Nova estação</button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="estacoes-grade">
            {estacoes.map((e) => (
              <div key={e.id} data-testid="estacao-card" className={['flex flex-col rounded-menuzia border bg-white p-4', e.ativo ? 'border-border' : 'border-dashed border-border opacity-70'].join(' ')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-bold text-text-main">{e.nome}</h3>
                    <span className="mt-1 inline-block rounded-menuzia bg-alert-bg px-1.5 py-[2px] text-[10px] font-bold uppercase tracking-wide text-alert-text">{LABEL_MODO[e.modo]}</span>
                  </div>
                  <span className="flex flex-col items-end gap-1 text-right">
                    <span className={['flex items-center gap-1.5 text-[11.5px] font-semibold', !e.ativo ? 'text-text-subtle' : e.online ? 'text-status-ready' : 'text-text-subtle'].join(' ')}>
                      <span className={['h-2 w-2 rounded-full', !e.ativo ? 'bg-border' : e.online ? 'bg-status-ready' : 'bg-[#D1D5DB]'].join(' ')} />
                      {!e.ativo ? 'Desativada' : e.online ? 'Online agora' : 'Offline'}
                    </span>
                  </span>
                </div>
                <div className="my-3 flex justify-center">
                  {qr[e.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qr[e.id]} alt={`QR Code da estação ${e.nome}`} className="h-[220px] w-[220px] rounded-menuzia border border-border" data-testid="estacao-qr" />
                  ) : <div className="h-[220px] w-[220px] animate-pulse rounded-menuzia bg-page" />}
                </div>
                <div className="flex items-center gap-2 rounded-menuzia border border-border bg-page px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-subtle">/cozinha/{e.token.slice(0, 8)}…</span>
                  <button type="button" onClick={() => void copiar(e)} className="rounded-menuzia bg-white px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/5">Copiar</button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <a href={`/cozinha/${e.token}?tela-cheia=1`} target="_blank" rel="noopener noreferrer"
                    className="rounded-menuzia border border-border px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-text-main hover:bg-page">Abrir em tela cheia</a>
                  <button type="button" onClick={() => qr[e.id] && imprimirQr(e, qr[e.id])}
                    className="rounded-menuzia border border-border px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-main hover:bg-page">Imprimir QR</button>
                </div>
                <p className="mt-2 text-[11px] text-text-subtle">Último acesso: {e.online ? 'agora' : quando(e.ultimoVistoEm)}</p>
                <div className="mt-2 flex flex-wrap gap-3 border-t border-border pt-2 text-[11.5px]">
                  <button type="button" disabled={ocupado} onClick={() => void acao(() => atualizarEstacao(supabase, e.id, { ativo: !e.ativo }), e.ativo ? 'Estação desativada.' : 'Estação ativada.')} className="font-semibold text-text-subtle hover:text-text-main">{e.ativo ? 'Desativar' : 'Ativar'}</button>
                  <button type="button" disabled={ocupado} onClick={() => setConfirmar({ tipo: 'link', estacao: e })} className="font-semibold text-text-subtle hover:text-text-main">Novo link</button>
                  <button type="button" disabled={ocupado} onClick={() => setConfirmar({ tipo: 'excluir', estacao: e })} className="ml-auto font-semibold text-danger hover:underline">Excluir</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {novaAberta && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#111827]/70 p-4" role="dialog" aria-modal="true" aria-labelledby="nova-estacao-titulo">
          <div className="w-full max-w-[460px] rounded-menuzia border border-border bg-white p-5 shadow-2xl">
            <h2 id="nova-estacao-titulo" className="text-[15px] font-bold text-text-main">Nova estação</h2>
            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Chapa, Montagem, Embalagem" maxLength={60}
              className="mt-1 w-full rounded-menuzia border border-border px-3 py-2 text-[13px] outline-none focus:border-primary" data-testid="nova-estacao-nome" />
            <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Tipo</div>
            <div className="mt-1 space-y-2">
              {MODOS.map((m) => (
                <label key={m} className={['flex cursor-pointer items-start gap-2 rounded-menuzia border px-3 py-2', modo === m ? 'border-primary bg-primary/5' : 'border-border'].join(' ')}>
                  <input type="radio" name="modo" checked={modo === m} onChange={() => setModo(m)} className="mt-1 accent-primary" data-testid={`nova-estacao-modo-${m}`} />
                  <span>
                    <span className="block text-[13px] font-semibold text-text-main">{LABEL_MODO[m]}</span>
                    <span className="block text-[12px] text-text-subtle">{DESCRICAO_MODO[m]}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setNovaAberta(false)} className="flex-1 rounded-menuzia border border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:bg-page">Cancelar</button>
              <button type="button" disabled={!nome.trim() || ocupado} data-testid="nova-estacao-criar"
                onClick={() => restauranteId && void acao(async () => { await criarEstacao(supabase, restauranteId, nome, modo); setNovaAberta(false) }, 'Estação criada.')}
                className="flex-1 rounded-menuzia bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark disabled:opacity-50">Criar estação</button>
            </div>
          </div>
        </div>
      )}

      {confirmar && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#111827]/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-[420px] rounded-menuzia border border-border bg-white p-5 shadow-2xl">
            <h2 className="text-[15px] font-bold text-text-main">{confirmar.tipo === 'link' ? 'Gerar um link novo?' : 'Excluir a estação?'}</h2>
            <p className="mt-1 text-[13px] text-text-subtle">
              {confirmar.tipo === 'link'
                ? `O link e o QR Code atuais de "${confirmar.estacao.nome}" param de funcionar. A tela da cozinha precisa abrir o novo.`
                : `"${confirmar.estacao.nome}" some da lista e a tela dela para de funcionar. Os pedidos não são afetados.`}
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setConfirmar(null)} className="flex-1 rounded-menuzia border border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:bg-page">Cancelar</button>
              <button type="button" data-testid="confirmar-acao" disabled={ocupado}
                onClick={() => { const c = confirmar; setConfirmar(null); void acao(() => (c.tipo === 'link' ? rotacionarTokenEstacao(supabase, c.estacao.id) : removerEstacao(supabase, c.estacao.id)), c.tipo === 'link' ? 'Link novo gerado.' : 'Estação excluída.') }}
                className={['flex-1 rounded-menuzia px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white', confirmar.tipo === 'excluir' ? 'bg-danger hover:bg-danger/90' : 'bg-primary hover:bg-primary-dark'].join(' ')}>
                {confirmar.tipo === 'link' ? 'Gerar link novo' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
