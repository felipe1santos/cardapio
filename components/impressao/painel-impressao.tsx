'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { chamar, horaCurta, novaChave } from '@/components/pdv/util'
import { AVISO_PAPEL, ROTULO_ESTADO_IMPRESSAO, ROTULO_FUNCAO, ROTULO_TIPO_TRABALHO, TOM_ESTADO_IMPRESSAO } from '@/lib/impressao/rotulos'
import type { AgenteVisao, DispositivoVisao, Funcao, TrabalhoVisao } from '@/lib/impressao/servico'

/**
 * Ajustes › Impressão (dono e gerente): computadores com o Assistente, impressoras que
 * cada um encontrou no Windows, funções (Cozinha, Caixa), teste e histórico.
 *
 * Tudo passa por /api/admin/impressao/* — o navegador não lê as tabelas. Nenhuma
 * credencial aparece aqui: o código de pareamento é mostrado uma vez e vence em 10 min.
 */

interface Painel {
  agentes: AgenteVisao[]
  dispositivos: DispositivoVisao[]
  funcoes: Record<Funcao, string | null>
  trabalhos: TrabalhoVisao[]
  cozinhaPorFuncao: boolean
  assistenteAntigoVistoEm: string | null
  assistenteAntigoOnline: boolean
}

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export function PainelImpressao() {
  const [p, setP] = useState<Painel | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null)
  const [codigo, setCodigo] = useState<{ codigo: string; expiraEm: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [compartilhar, setCompartilhar] = useState<{ funcao: Funcao; dispositivoId: string; texto: string } | null>(null)
  const seq = useRef(0)

  const carregar = useCallback(async () => {
    const minha = ++seq.current
    const r = await chamar<Painel>('/api/admin/impressao/painel')
    if (minha !== seq.current) return
    if (!r.ok || !r.dados) return setErro(r.erro)
    setErro(null)
    setP(r.dados)
  }, [])

  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), 5000)
    return () => clearInterval(t)
  }, [carregar])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 6000)
    return () => clearTimeout(t)
  }, [aviso])

  async function agir(url: string, metodo: string, corpo: unknown, sucesso: string) {
    if (ocupado) return null
    setOcupado(true)
    const r = await chamar(url, { method: metodo, body: JSON.stringify(corpo) })
    setOcupado(false)
    if (!r.ok) setAviso({ tom: 'erro', texto: r.erro ?? 'Não foi possível.' })
    else setAviso({ tom: 'ok', texto: sucesso })
    await carregar()
    return r
  }

  async function gerarCodigo() {
    const r = await chamar<{ codigo: string; expiraEm: string }>('/api/admin/impressao/pareamento', { method: 'POST' })
    if (!r.ok || !r.dados) return setAviso({ tom: 'erro', texto: r.erro ?? 'Não foi possível gerar o código.' })
    setCodigo(r.dados)
  }

  async function atribuir(funcao: Funcao, dispositivoId: string | null, confirmar = false) {
    const r = await agir('/api/admin/impressao/funcoes', 'PUT', { funcao, dispositivoId, confirmarCompartilhada: confirmar }, dispositivoId ? `Função ${ROTULO_FUNCAO[funcao]} atribuída.` : `Função ${ROTULO_FUNCAO[funcao]} removida.`)
    if (r && !r.ok && r.codigo === 'confirmar_compartilhada' && dispositivoId) {
      setAviso(null)
      setCompartilhar({ funcao, dispositivoId, texto: r.erro ?? '' })
    }
  }

  const nomeDisp = (d: DispositivoVisao) => d.apelido || d.nomeSistema
  const agentePor = (id: string) => p?.agentes.find((a) => a.id === id)

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4" data-testid="painel-impressao">
      <div>
        <h1 className="text-[20px] font-bold text-text-main">Impressão</h1>
        <p className="text-[13px] text-text-subtle">
          Computadores com o Assistente de Impressão, impressoras de cada um e o que cada impressora imprime.
        </p>
      </div>

      {aviso && (
        <p role="status" className={['rounded-menuzia px-3 py-2 text-[12px] font-semibold', aviso.tom === 'ok' ? 'bg-price-bg text-price-text' : 'bg-danger-bg text-danger'].join(' ')} data-testid="impressao-aviso">
          {aviso.texto}
        </p>
      )}
      {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[13px] text-danger">{erro}</p>}

      {compartilhar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-menuzia bg-white p-4 shadow-xl">
            <h2 className="text-[15px] font-bold text-text-main">Usar a mesma impressora nas duas funções?</h2>
            <p className="mt-2 text-[13px] text-text-main">{compartilhar.texto}</p>
            <p className="mt-2 text-[12px] text-text-subtle">A ficha da cozinha e a pré-conta do cliente vão sair no mesmo papel.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setCompartilhar(null)} className="flex-1 rounded-menuzia border border-border py-2.5 text-[13px] font-semibold">Cancelar</button>
              <button
                type="button"
                data-testid="confirmar-compartilhada"
                onClick={async () => {
                  const c = compartilhar
                  setCompartilhar(null)
                  await atribuir(c.funcao, c.dispositivoId, true)
                }}
                className="flex-[2] rounded-menuzia bg-primary py-2.5 text-[13px] font-bold text-white"
              >
                Confirmo: usar nas duas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Computadores */}
      <section className="rounded-menuzia border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-[14px] font-bold text-text-main">Computadores (Assistentes)</h2>
          <button type="button" onClick={() => void gerarCodigo()} data-testid="gerar-codigo" className="rounded-menuzia bg-primary px-4 py-2 text-[12px] font-bold uppercase tracking-wide text-white hover:bg-primary-dark">
            + Parear computador
          </button>
        </div>
        {codigo && (
          <div className="border-b border-border bg-alert-bg px-4 py-3 text-[13px] text-alert-text">
            <p>
              No Assistente de Impressão (versão 0.1.26 ou mais nova), escolha <strong>Parear com código</strong> e digite:
            </p>
            <p className="mt-1 font-mono text-[26px] font-extrabold tracking-[0.2em] text-text-main" data-testid="codigo-pareamento">{codigo.codigo}</p>
            <p className="text-[12px]">Vale uma vez, até {horaCurta(codigo.expiraEm)}. Não é enviado por e-mail nem fica salvo aqui.</p>
            <button type="button" onClick={() => setCodigo(null)} className="mt-1 text-[12px] font-semibold underline">Esconder</button>
          </div>
        )}
        {p && p.agentes.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-text-subtle">Nenhum computador pareado ainda.</p>}
        <ul className="divide-y divide-border">
          {p?.agentes.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`agente-${a.nome}`}>
              <span className={['h-2.5 w-2.5 rounded-full', a.revogado ? 'bg-border' : a.online ? 'bg-status-ready' : 'bg-danger'].join(' ')} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-text-main">{a.nome}</p>
                <p className="text-[12px] text-text-subtle">
                  {a.revogado ? 'Revogado' : a.online ? 'Online' : 'Offline'} · versão {a.versao ?? '—'} · último sinal {quando(a.vistoEm)}
                </p>
              </div>
              {!a.revogado && (
                <>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => {
                      const nome = prompt('Nome do computador', a.nome)?.trim()
                      if (nome) void agir(`/api/admin/impressao/agentes/${a.id}`, 'PATCH', { nome }, 'Computador renomeado.')
                    }}
                    className="rounded-menuzia border border-border px-3 py-1.5 text-[12px] font-semibold text-text-main"
                  >
                    Renomear
                  </button>
                  <button
                    type="button"
                    disabled={ocupado}
                    data-testid={`revogar-${a.nome}`}
                    onClick={() => {
                      if (confirm(`Revogar "${a.nome}"? Ele para de imprimir na hora e precisa ser pareado de novo.`)) {
                        void agir(`/api/admin/impressao/agentes/${a.id}`, 'POST', { acao: 'revogar' }, 'Computador revogado.')
                      }
                    }}
                    className="rounded-menuzia border border-danger/40 px-3 py-1.5 text-[12px] font-semibold text-danger hover:bg-danger hover:text-white"
                  >
                    Revogar
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {p?.assistenteAntigoVistoEm && (
          <p className="border-t border-border px-4 py-2 text-[12px] text-text-subtle">
            Assistente antigo (token da loja): {p.assistenteAntigoOnline ? 'em uso agora' : `último sinal ${quando(p.assistenteAntigoVistoEm)}`}.
            Ele continua imprimindo a cozinha como sempre.
          </p>
        )}
      </section>

      {/* Funções */}
      <section className="rounded-menuzia border border-border bg-white px-4 py-3">
        <h2 className="text-[14px] font-bold text-text-main">Funções</h2>
        <p className="mb-2 text-[12px] text-text-subtle">
          Cada documento sai só na impressora da sua função. Nunca há troca automática: sem impressora de Caixa, a pré-conta não é impressa.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['cozinha', 'caixa'] as Funcao[]).map((f) => (
            <label key={f} className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">{ROTULO_FUNCAO[f]}</span>
              <select
                value={p?.funcoes[f] ?? ''}
                disabled={ocupado || !p}
                data-testid={`funcao-${f}`}
                onChange={(e) => void atribuir(f, e.target.value || null)}
                className="w-full rounded-menuzia border border-border bg-white px-3 py-2 text-[13px] text-text-main"
              >
                <option value="">— nenhuma —</option>
                {p?.dispositivos
                  .filter((d) => !agentePor(d.agenteId)?.revogado)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {nomeDisp(d)} · {agentePor(d.agenteId)?.nome ?? '?'}{d.disponivel ? '' : ' (não encontrada no Windows)'}
                    </option>
                  ))}
              </select>
              <span className="mt-1 block text-[11px] text-text-subtle">
                {f === 'cozinha'
                  ? p?.cozinhaPorFuncao
                    ? 'Ficha da cozinha sai SÓ nesta impressora.'
                    : 'A ficha da cozinha segue o modo de sempre enquanto o roteamento por função estiver desligado.'
                  : 'Pré-conta: impressa manualmente pelo botão no PDV.'}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3 rounded-menuzia border border-border bg-page/60 px-3 py-2">
          <label className="flex items-start gap-2 text-[13px] text-text-main">
            <input
              type="checkbox"
              checked={Boolean(p?.cozinhaPorFuncao)}
              disabled={ocupado || !p}
              data-testid="cozinha-por-funcao"
              onChange={(e) => {
                const ativo = e.target.checked
                if (ativo && !confirm('A ficha da cozinha passa a sair SÓ na impressora da função Cozinha. O Assistente antigo deixa de imprimir a cozinha. Continuar?')) return
                void agir('/api/admin/impressao/cozinha-por-funcao', 'PUT', { ativo }, ativo ? 'Cozinha roteada pela função.' : 'Cozinha voltou ao modo de sempre.')
              }}
              className="mt-0.5"
            />
            <span>
              <strong>Ficha da cozinha pela função</strong> (opcional, desligado por padrão)
              <span className="block text-[12px] text-text-subtle">
                Desligado: a cozinha imprime como sempre, na impressora escolhida em cada Assistente. Ligado: só o computador da
                impressora de Cozinha imprime a ficha. Para desfazer, desmarque ou tire a função Cozinha.
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* Impressoras */}
      <section className="rounded-menuzia border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[14px] font-bold text-text-main">Impressoras encontradas</h2>
          <p className="text-[12px] text-text-subtle">Cada computador pareado informa as impressoras instaladas no Windows dele.</p>
        </div>
        {p && p.dispositivos.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-text-subtle">Nenhuma impressora informada ainda.</p>}
        <ul className="divide-y divide-border">
          {p?.dispositivos.map((d) => (
            <li key={d.id} className="grid gap-2 px-4 py-3 lg:grid-cols-[1.4fr_1fr_120px_auto] lg:items-center" data-testid={`dispositivo-${d.nomeSistema}`}>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-text-main">
                  {nomeDisp(d)} {d.funcoes.map((f) => <Badge key={f} tone="preparing" className="ml-1">{ROTULO_FUNCAO[f]}</Badge>)}
                  {!d.disponivel && <Badge tone="danger" className="ml-1">Não encontrada no Windows</Badge>}
                </p>
                <p className="truncate text-[12px] text-text-subtle">Windows: {d.nomeSistema} · {agentePor(d.agenteId)?.nome ?? '—'}</p>
                <p className="text-[12px] text-text-subtle">
                  Último uso {quando(d.ultimoUsoEm)}
                  {d.ultimoErro && <span className="text-danger"> · Último erro ({quando(d.ultimoErroEm)}): {d.ultimoErro}</span>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => {
                    const apelido = prompt('Apelido (ex.: Cozinha 01, Caixa 02)', d.apelido ?? '')
                    if (apelido !== null) void agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', { apelido }, 'Apelido salvo.')
                  }}
                  className="rounded-menuzia border border-border px-3 py-1.5 text-[12px] font-semibold"
                >
                  Apelido
                </button>
                <select
                  value={d.larguraMm}
                  disabled={ocupado}
                  onChange={(e) => void agir(`/api/admin/impressao/dispositivos/${d.id}`, 'PATCH', { larguraMm: Number(e.target.value) }, 'Largura salva.')}
                  className="rounded-menuzia border border-border bg-white px-2 py-1.5 text-[12px]"
                  aria-label="Largura do papel"
                >
                  <option value={80}>80 mm</option>
                  <option value={58}>58 mm</option>
                </select>
              </div>
              <span />
              <button
                type="button"
                disabled={ocupado || agentePor(d.agenteId)?.revogado}
                data-testid={`testar-${d.nomeSistema}`}
                onClick={() => void agir(`/api/admin/impressao/dispositivos/${d.id}`, 'POST', { acao: 'teste', chave: novaChave() }, `Teste enviado para ${nomeDisp(d)}.`)}
                className="rounded-menuzia border-2 border-primary px-3 py-1.5 text-[12px] font-bold text-primary hover:bg-primary hover:text-white disabled:opacity-40"
              >
                Imprimir teste
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Histórico */}
      <section className="rounded-menuzia border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[14px] font-bold text-text-main">Últimas impressões (pré-conta e teste)</h2>
          <p className="text-[12px] text-text-subtle">{AVISO_PAPEL}</p>
        </div>
        {p && p.trabalhos.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-text-subtle">Nada impresso por aqui ainda.</p>}
        <ul className="divide-y divide-border" data-testid="historico-impressao">
          {p?.trabalhos.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[12px]">
              <span className="w-24 text-text-subtle">{quando(t.criadoEm)}</span>
              <span className="w-28 font-semibold text-text-main">{ROTULO_TIPO_TRABALHO[t.tipo] ?? t.tipo}{t.tipo === 'pre_conta' ? ` · ${t.via}ª via` : ''}</span>
              <span className="flex-1 text-text-main">{t.impressora} · por {t.criadoPorNome}</span>
              <Badge tone={TOM_ESTADO_IMPRESSAO[t.estado] ?? 'alert'}>{ROTULO_ESTADO_IMPRESSAO[t.estado] ?? t.estado}</Badge>
              {t.erro && <span className="w-full text-danger">{t.erro}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
