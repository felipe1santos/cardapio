'use client'

import { useEffect, useState } from 'react'
import { CATEGORIAS, type CategoriaPush } from '@/lib/push/regras'
import {
  ativarPush,
  assinaturaAtual,
  categoriasSalvas,
  configDaLoja,
  desativarPush,
  permissaoAtual,
  plataformaAtual,
  precisaInstalarNoIphone,
  recusouRecentemente,
  registrarRecusa,
  salvarCategorias,
  suportaPush,
} from '@/lib/push/cliente'

/**
 * Notificações push na vitrine (0127): o convite depois do pedido e o painel do Perfil.
 * Nunca pedem a permissão sozinhos — só no toque em "Sim, avisar"/"Ativar". No iPhone fora do app
 * instalado, ensinam a instalar (no Safari comum o push não existe).
 */
export interface VinculoCliente { telefone?: string; token?: string; pedidoId?: string }

function IconeSino({ className = 'h-[22px] w-[22px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`} aria-hidden>
      <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-1.7 1.7A1 1 0 0 0 4 19.4h16a1 1 0 0 0 .7-1.7z" />
    </svg>
  )
}

function InstrucaoIphone() {
  return (
    <p className="text-[13px] leading-[18px] text-[var(--v-secundario)]" data-push-instalar-iphone>
      Para receber avisos no iPhone, toque em <strong className="text-[var(--v-titulo)]">Compartilhar</strong> ›{' '}
      <strong className="text-[var(--v-titulo)]">Adicionar à Tela de Início</strong> e abra o cardápio por lá.
    </p>
  )
}

/** Convite logo depois de concluir o pedido. Some sozinho se não fizer sentido mostrar. */
export function ConvitePushPosPedido({ slug, lojaNome, vinculo }: { slug: string; lojaNome: string; vinculo: VinculoCliente }) {
  const [estado, setEstado] = useState<'carregando' | 'convite' | 'iphone' | 'ativando' | 'ativo' | 'negado' | 'oculto'>('carregando')
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const cfg = await configDaLoja(slug)
      if (!vivo) return
      if (!cfg.ativo || recusouRecentemente(slug)) return setEstado('oculto')
      if (precisaInstalarNoIphone()) return setEstado('iphone')
      if (!suportaPush() || permissaoAtual() === 'denied') return setEstado('oculto')
      if (await assinaturaAtual(slug)) return setEstado('oculto') // já recebe
      setEstado('convite')
    })()
    return () => { vivo = false }
  }, [slug])

  if (estado === 'carregando' || estado === 'oculto') return null
  return (
    <div className="mt-4 rounded-[12px] border border-[var(--v-borda)] bg-[#F8FAFC] p-[14px]" data-push-convite>
      <div className="flex items-start gap-[10px]">
        <span className="mt-[2px] text-[var(--tema-primaria)]"><IconeSino /></span>
        <div className="min-w-0 flex-1">
          {estado === 'ativo' ? (
            <p className="text-[14px] font-semibold text-[#15803D]" data-push-ativado>Pronto! Vamos te avisar por aqui.</p>
          ) : estado === 'negado' ? (
            <p className="text-[13px] text-[var(--v-secundario)]">Tudo bem — dá para ativar depois em Perfil › Notificações.</p>
          ) : (
            <>
              <p className="text-[14px] font-semibold leading-[19px] text-[var(--v-titulo)]">
                Quer ser avisado quando seu pedido sair e receber as promoções da {lojaNome}?
              </p>
              {estado === 'iphone' && <div className="mt-[6px]"><InstrucaoIphone /></div>}
            </>
          )}
        </div>
      </div>
      {(estado === 'convite' || estado === 'ativando') && (
        <div className="mt-[12px] flex gap-[8px]">
          <button
            type="button"
            onClick={() => { registrarRecusa(slug); setEstado('oculto') }}
            className="h-[44px] flex-1 rounded-[10px] border border-[var(--v-borda)] bg-white text-[14px] font-semibold text-[var(--v-secundario)]"
            data-push-agora-nao
          >
            Agora não
          </button>
          <button
            type="button"
            disabled={estado === 'ativando'}
            onClick={async () => {
              setEstado('ativando')
              const r = await ativarPush(slug, vinculo)
              if (r.ok) setEstado('ativo')
              else { if (r.motivo === 'negado' || r.motivo === 'fechado') registrarRecusa(slug); setEstado('negado') }
            }}
            className="flex h-[44px] flex-[1.4] items-center justify-center gap-[6px] rounded-[10px] bg-[var(--tema-primaria)] text-[14px] font-semibold text-white disabled:opacity-60"
            data-push-sim
          >
            <IconeSino className="h-[18px] w-[18px]" />
            {estado === 'ativando' ? 'Ativando…' : 'Sim, avisar'}
          </button>
        </div>
      )}
      {estado === 'iphone' && (
        <button type="button" onClick={() => { registrarRecusa(slug); setEstado('oculto') }} className="mt-[10px] text-[13px] font-semibold text-[var(--v-secundario)] underline">
          Agora não
        </button>
      )}
    </div>
  )
}

function comoReativar(): string {
  const p = plataformaAtual()
  if (p === 'android') return 'Toque no cadeado (ou nos três pontos › Configurações › Configurações do site) e permita as Notificações deste site. Depois volte aqui e toque em Ativar.'
  if (p === 'ios') return 'Abra Ajustes › Notificações, escolha o app da loja e ative "Permitir Notificações".'
  return 'Clique no cadeado ao lado do endereço do site, permita as Notificações e recarregue a página.'
}

/** Perfil › Notificações: ligar/desligar e escolher as categorias. */
export function PainelNotificacoesPush({ slug, vinculo }: { slug: string; vinculo: VinculoCliente }) {
  const [disponivel, setDisponivel] = useState<boolean | null>(null)
  const [ativo, setAtivo] = useState(false)
  const [cats, setCats] = useState<CategoriaPush[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [negado, setNegado] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const cfg = await configDaLoja(slug)
      if (!vivo) return
      setDisponivel(cfg.ativo)
      if (!cfg.ativo) return
      setNegado(permissaoAtual() === 'denied')
      setAtivo(Boolean(await assinaturaAtual(slug)) && permissaoAtual() === 'granted')
      setCats(categoriasSalvas(slug))
    })()
    return () => { vivo = false }
  }, [slug])

  if (!disponivel) return null
  const iphoneSemApp = precisaInstalarNoIphone()

  return (
    <section className="rounded-[12px] border border-[var(--v-borda)] p-[14px]" data-push-perfil>
      <div className="flex items-center gap-[10px]">
        <span className="text-[var(--tema-primaria)]"><IconeSino /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-[var(--v-titulo)]">Notificações</p>
          <p className="text-[12px] text-[var(--v-secundario)]" data-push-estado>{ativo ? 'Ativadas neste aparelho' : 'Desativadas neste aparelho'}</p>
        </div>
        {!iphoneSemApp && !negado && suportaPush() && (
          <button
            type="button"
            role="switch"
            aria-checked={ativo}
            aria-label="Notificações"
            disabled={ocupado}
            onClick={async () => {
              setOcupado(true)
              setMsg(null)
              if (ativo) { await desativarPush(slug); setAtivo(false) }
              else {
                const r = await ativarPush(slug, vinculo, cats.length ? cats : undefined)
                if (r.ok) { setAtivo(true); setCats(categoriasSalvas(slug)) }
                else if (r.motivo === 'negado') setNegado(true)
                else setMsg('Não foi possível ativar agora. Tente de novo.')
              }
              setOcupado(false)
            }}
            className={['relative h-[28px] w-[48px] flex-shrink-0 rounded-full transition-colors', ativo ? 'bg-[var(--tema-primaria)]' : 'bg-[#CBD5E1]'].join(' ')}
            data-push-alternar
          >
            <span className={['absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all', ativo ? 'left-[23px]' : 'left-[3px]'].join(' ')} />
          </button>
        )}
      </div>
      {iphoneSemApp && <div className="mt-[10px]"><InstrucaoIphone /></div>}
      {!iphoneSemApp && negado && (
        <p className="mt-[10px] text-[13px] leading-[18px] text-[var(--v-secundario)]" data-push-bloqueado>
          As notificações estão bloqueadas no navegador. {comoReativar()}
        </p>
      )}
      {!iphoneSemApp && !negado && !suportaPush() && (
        <p className="mt-[10px] text-[13px] text-[var(--v-secundario)]">Este navegador não recebe notificações.</p>
      )}
      {ativo && (
        <fieldset className="mt-[12px] space-y-[8px]" data-push-categorias>
          <legend className="mb-[6px] text-[12px] font-semibold uppercase tracking-wide text-[var(--v-secundario)]">Quero receber</legend>
          {CATEGORIAS.map((c) => {
            const marcado = cats.includes(c.id)
            return (
              <label key={c.id} className="flex min-h-[40px] cursor-pointer items-center justify-between gap-3 text-[14px] text-[var(--v-texto)]">
                {c.rotulo}
                <input
                  type="checkbox"
                  checked={marcado}
                  disabled={ocupado}
                  onChange={async () => {
                    const novas = marcado ? cats.filter((x) => x !== c.id) : [...cats, c.id]
                    setCats(novas)
                    setOcupado(true)
                    if (!(await salvarCategorias(slug, novas))) { setCats(cats); setMsg('Não foi possível salvar. Tente de novo.') }
                    setOcupado(false)
                  }}
                  className="h-[20px] w-[20px] accent-[var(--tema-primaria)]"
                  data-push-categoria={c.id}
                />
              </label>
            )
          })}
        </fieldset>
      )}
      {msg && <p className="mt-[8px] text-[12px] font-semibold text-[#B91C1C]">{msg}</p>}
    </section>
  )
}
