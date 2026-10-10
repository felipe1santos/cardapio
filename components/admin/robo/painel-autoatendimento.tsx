'use client'

/**
 * Robô de AUTOATENDIMENTO (0177; decisões em docs/robo-whatsapp/autoatendimento-decisoes.md), dentro de
 * Ajustes › Robô de atendimento (era Integrações › Robô até 10/10). O dono liga/desliga, escolhe os assuntos,
 * acrescenta palavras, edita os textos com prévia estilo WhatsApp, testa no simulador (não envia nada) e
 * ensina as perguntas que o robô não entendeu. Visual do Ajustes (fin-card).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, GraduationCap, Loader2, MessageSquareText, RotateCcw, Send, Tags } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleSwitch } from '@/components/admin/campos-ajustes'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'
import { Balao } from '@/components/admin/robo/previa-whatsapp'

type Assunto =
  | 'atendente' | 'reclamacao' | 'parar' | 'status_pedido' | 'entrega' | 'pagamento_pix' | 'horario' | 'endereco_retirada' | 'cardapio' | 'saudacao'

const ROTULO_ASSUNTO: Record<Assunto, string> = {
  saudacao: 'Saudação', cardapio: 'Cardápio', entrega: 'Entrega (taxa e tempo)', status_pedido: 'Status do pedido', horario: 'Horário',
  pagamento_pix: 'Pagamento e Pix', endereco_retirada: 'Endereço e retirada', reclamacao: 'Reclamação', atendente: 'Atendente', parar: 'Parar',
}
const SEMPRE_LIGADOS: Assunto[] = ['atendente', 'parar', 'reclamacao']
const TIPOS_PIX = [
  { v: 'cpf', r: 'CPF' }, { v: 'cnpj', r: 'CNPJ' }, { v: 'telefone', r: 'Telefone' }, { v: 'email', r: 'E-mail' }, { v: 'aleatoria', r: 'Chave aleatória' },
]

interface Config {
  ativo: boolean
  liberadoNoServidor: boolean
  instancia: string | null
  nomeLoja: string
  assuntosDesligados: string[]
  textos: Record<string, string>
  palavras: Record<string, string[]>
  tempoEntrega: string
  pixChave: string
  pixTipo: string
  padrao: { textos: Record<string, string>; rotulos: Record<string, string>; palavras: Record<string, string[]>; campos: string[]; assuntos: Assunto[] }
}
interface Rascunho { assuntosDesligados: string[]; textos: Record<string, string>; palavras: Record<string, string>; tempoEntrega: string; pixChave: string; pixTipo: string }
interface NaoEntendida { id: string; texto: string; exemplo: string | null; vezes: number; ultima_em: string; ensinado_assunto: string | null }
interface PassoSim { entrada: string; intencao: string; acao: string; respostas: string[] }

const CLASSE_CAMPO = 'w-full rounded-[3px] border border-[#E5E7EB] bg-white px-[10px] py-[8px] text-[14px] text-[#1F2937] outline-none focus:border-[#0688D4]'

function rascunhoDe(c: Config): Rascunho {
  return {
    assuntosDesligados: c.assuntosDesligados,
    textos: c.textos,
    palavras: Object.fromEntries(Object.entries(c.palavras).map(([k, v]) => [k, v.join('\n')])),
    tempoEntrega: c.tempoEntrega,
    pixChave: c.pixChave,
    pixTipo: c.pixTipo,
  }
}

function palavrasParaApi(p: Record<string, string>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)]))
}

const SUGESTOES_SIM = ['oi', 'qnto ta a taxa pro centro', 'meu lanche ja saiu?', 'aceita pix?', 'q horas fecha', 'quero falar com alguem']

export function PainelAutoatendimento({ onAtivoMudou }: { onAtivoMudou?: (ativo: boolean) => void }) {
  // Ref: o aviso para a tela de cima não entra nas dependências (callback novo a cada render).
  const avisoAtivo = useRef(onAtivoMudou)
  avisoAtivo.current = onAtivoMudou
  const toasts = useToasts()
  const mostrar = toasts.mostrar
  const [cfg, setCfg] = useState<Config | null>(null)
  const [erro, setErro] = useState(false)
  const [r, setR] = useState<Rascunho | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [ligando, setLigando] = useState(false)
  const [textoAberto, setTextoAberto] = useState('saudacao')
  const [naoEntendidas, setNaoEntendidas] = useState<NaoEntendida[]>([])

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/whatsapp/autoatendimento', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const c: Config = await res.json()
      setCfg(c)
      setR(rascunhoDe(c))
      avisoAtivo.current?.(c.ativo)
    } catch {
      setErro(true)
    }
  }, [])
  const carregarNaoEntendidas = useCallback(async () => {
    const res = await fetch('/api/admin/whatsapp/autoatendimento/nao-entendidas', { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setNaoEntendidas((await res.json()).itens ?? [])
  }, [])
  useEffect(() => { void carregar(); void carregarNaoEntendidas() }, [carregar, carregarNaoEntendidas])

  const sujo = useMemo(() => !!cfg && !!r && JSON.stringify(rascunhoDe(cfg)) !== JSON.stringify(r), [cfg, r])

  async function alternar(ativo: boolean) {
    setLigando(true)
    const res = await fetch('/api/admin/whatsapp/autoatendimento', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo }) }).catch(() => null)
    setLigando(false)
    if (!res?.ok) { mostrar('erro', (await res?.json().catch(() => null))?.error ?? 'Não foi possível alterar.'); return }
    setCfg((c) => (c ? { ...c, ativo } : c))
    avisoAtivo.current?.(ativo)
    mostrar('ok', ativo ? 'Robô de autoatendimento ligado.' : 'Robô de autoatendimento desligado.')
  }

  async function salvar() {
    if (!r) return
    setSalvando(true)
    const corpo = { assuntosDesligados: r.assuntosDesligados, textos: r.textos, palavras: palavrasParaApi(r.palavras), tempoEntrega: r.tempoEntrega, pixChave: r.pixChave, pixTipo: r.pixTipo }
    const res = await fetch('/api/admin/whatsapp/autoatendimento', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null)
    setSalvando(false)
    if (!res?.ok) { mostrar('erro', (await res?.json().catch(() => null))?.error ?? 'Não foi possível salvar.'); return }
    mostrar('ok', 'Alterações salvas.')
    await carregar()
  }

  if (erro) return <div className="p-6 text-[14px] text-[#6B7280]">Não foi possível carregar o robô. Recarregue a página.</div>
  if (!cfg || !r) return <div className="flex items-center gap-2 p-6 text-[14px] text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>

  const desligados = new Set(r.assuntosDesligados)
  const modeloAtual = r.textos[textoAberto] ?? cfg.padrao.textos[textoAberto]
  const personalizado = r.textos[textoAberto] !== undefined && r.textos[textoAberto] !== cfg.padrao.textos[textoAberto]

  return (
    <>
      <div className="space-y-4 pb-[72px]" data-testid="robo-autoatendimento">
        <Cartao className="p-[16px]">
          <div className="flex flex-wrap items-center justify-between gap-[12px]">
            <div className="flex min-w-0 items-center gap-[12px]">
              <span className="flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-full bg-[#E0F2FE] text-[#0688D4]"><Bot className="h-[20px] w-[20px]" /></span>
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-[#1C2B33]">Robô de autoatendimento (novo)</h2>
                <p className="text-[13px] text-[#6B7280]">
                  Responde sozinho no WhatsApp da loja por palavras-chave (sem inteligência artificial e sem custo). As mensagens de status do pedido continuam iguais.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-[10px]">
              <span className={`rounded-full px-[10px] py-[2px] text-[12px] font-semibold ${cfg.ativo ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#EDEEF1] text-[#6B7280]'}`} data-testid="robo-estado">
                {cfg.ativo ? 'Ligado' : 'Desligado'}
              </span>
              <ToggleSwitch checked={cfg.ativo} onChange={(v) => void alternar(v)} disabled={ligando || (!cfg.ativo && !cfg.liberadoNoServidor)} rotulo="Robô de autoatendimento" />
            </div>
          </div>
          {!cfg.instancia && (
            <p className="mt-[12px] rounded-[3px] bg-[#FEF3C7] px-[10px] py-[8px] text-[13px] text-[#92400E]">
              O WhatsApp da loja ainda não está conectado (Integrações › WhatsApp). O simulador abaixo funciona mesmo assim.
            </p>
          )}
        </Cartao>

        <div className="grid grid-cols-1 gap-[16px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 space-y-[16px]">
            <Cartao className="p-[16px]">
              <TituloBloco titulo="Dados que o robô usa" subtitulo="Bairros e taxas, horário e endereço vêm de Ajustes. Aqui só o que é do robô." />
              <div className="mt-[14px] grid grid-cols-1 gap-[12px] md:grid-cols-3">
                <label className="block">
                  <span className="mb-[4px] block text-[12px] font-medium text-[#6B7280]">Tempo de entrega</span>
                  <input className={CLASSE_CAMPO} value={r.tempoEntrega} maxLength={60} placeholder="ex.: 40 a 60 min" onChange={(e) => setR({ ...r, tempoEntrega: e.target.value })} />
                </label>
                <label className="block">
                  <span className="mb-[4px] block text-[12px] font-medium text-[#6B7280]">Tipo da chave Pix</span>
                  <select className={CLASSE_CAMPO} value={r.pixTipo} onChange={(e) => setR({ ...r, pixTipo: e.target.value })}>
                    <option value="">Escolha…</option>
                    {TIPOS_PIX.map((t) => <option key={t.v} value={t.v}>{t.r}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-[4px] block text-[12px] font-medium text-[#6B7280]">Chave Pix</span>
                  <input className={CLASSE_CAMPO} value={r.pixChave} maxLength={140} placeholder="Sem chave, o robô não fala de Pix" onChange={(e) => setR({ ...r, pixChave: e.target.value })} />
                </label>
              </div>
            </Cartao>

            <Cartao className="p-[16px]">
              <TituloBloco titulo="Assuntos" subtitulo="Desligado, o assunto some do menu e a pergunta vira “não entendi”. Atendente, reclamação e parar ficam sempre ligados." />
              <div className="mt-[10px] divide-y divide-[#E5E7EB]">
                {cfg.padrao.assuntos.map((a) => (
                  <LinhaAssunto
                    key={a}
                    assunto={a}
                    ligado={!desligados.has(a)}
                    travado={SEMPRE_LIGADOS.includes(a)}
                    padrao={cfg.padrao.palavras[a] ?? []}
                    extras={r.palavras[a] ?? ''}
                    onLigar={(v) => setR({ ...r, assuntosDesligados: v ? r.assuntosDesligados.filter((x) => x !== a) : [...r.assuntosDesligados, a] })}
                    onExtras={(v) => setR({ ...r, palavras: { ...r.palavras, [a]: v } })}
                  />
                ))}
              </div>
            </Cartao>

            <Cartao className="p-[16px]">
              <TituloBloco
                titulo="Textos das respostas"
                subtitulo="Use *negrito*, _itálico_, ~tachado~, `código`, “> ” para aviso e “- ” para lista. Linha com campo vazio não aparece."
              />
              <div className="mt-[12px] grid grid-cols-1 gap-[12px] lg:grid-cols-2">
                <div className="min-w-0 space-y-[8px]">
                  <select className={CLASSE_CAMPO} value={textoAberto} onChange={(e) => setTextoAberto(e.target.value)} aria-label="Texto">
                    {Object.keys(cfg.padrao.textos).map((k) => (
                      <option key={k} value={k}>{cfg.padrao.rotulos[k]}{r.textos[k] !== undefined && r.textos[k] !== cfg.padrao.textos[k] ? ' (personalizado)' : ''}</option>
                    ))}
                  </select>
                  <textarea
                    className={`${CLASSE_CAMPO} min-h-[220px] font-mono text-[13px]`}
                    value={modeloAtual}
                    maxLength={1500}
                    onChange={(e) => setR({ ...r, textos: { ...r.textos, [textoAberto]: e.target.value } })}
                    aria-label="Texto da resposta"
                  />
                  <div className="flex flex-wrap items-center gap-[6px]">
                    {cfg.padrao.campos.map((c) => (
                      <code key={c} className="rounded-[3px] bg-[#EDEEF1] px-[5px] py-[1px] text-[11.5px] text-[#374151]">{`{${c}}`}</code>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    disabled={!personalizado}
                    onClick={() => { const t = { ...r.textos }; delete t[textoAberto]; setR({ ...r, textos: t }) }}
                  >
                    <RotateCcw className="h-[14px] w-[14px]" /> Restaurar padrão
                  </Button>
                </div>
                <div className="min-w-0 rounded-[3px] bg-[#EDEEF1] p-[12px]">
                  <p className="mb-[8px] text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Prévia (campos com exemplo)</p>
                  <Balao lado="robo" texto={exemploDoModelo(modeloAtual, cfg.nomeLoja)} />
                </div>
              </div>
            </Cartao>

            <NaoEntendidasCartao itens={naoEntendidas} assuntos={cfg.padrao.assuntos} onEnsinado={async () => { await carregar(); await carregarNaoEntendidas() }} mostrar={mostrar} />
          </div>

          <Simulador rascunho={r} />
        </div>
      </div>

      {sujo && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E5E7EB] bg-white px-[16px] py-[10px] lg:left-[var(--adm-sidebar,240px)]" data-testid="robo-salvar-barra">
          <div className="mx-auto flex max-w-[1200px] items-center justify-end gap-[10px]">
            <span className="text-[13px] text-[#6B7280]">Alterações não salvas</span>
            <Button variant="outline" onClick={() => setR(rascunhoDe(cfg))}>Descartar</Button>
            <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : null} Salvar</Button>
          </div>
        </div>
      )}
      <PilhaToasts {...toasts} />
    </>
  )
}

const EXEMPLO: Record<string, string> = {
  saudacao: 'Boa noite', nome_cliente: 'João', link_cardapio: 'https://app.menuzia.com.br/loja/sua-loja', numero_pedido: '1234',
  itens: '- 1x Hambúrguer artesanal\n- 1x Batata frita', total: 'R$ 52,90', status: 'Em preparo', previsao: '40 min', bairro: 'Centro', taxa: 'R$ 5,00',
  tempo: '40 a 60 min', horario: '- Seg: 18:00–23:00\n- Ter: fechado', endereco: 'Rua Exemplo, 10, Centro', menu: '- *1* Cardápio e pedido\n- *2* Taxa e tempo de entrega\n- *0* Falar com atendente',
  lista_bairros: '- Centro: `R$ 5,00`\n- Ibes: `Grátis`', formas_pagamento: '- Pix\n- Cartão de crédito ou débito (na entrega)', aberto_agora: '✅ *Estamos abertos agora!*',
  retirada: '✅ Aceitamos *retirada no balcão*.', tipo_chave: 'telefone',
}

function exemploDoModelo(modelo: string, nomeLoja?: string): string {
  return modelo.replace(/\{([a-z_]+)\}/g, (todo, c: string) => (c === 'nome_loja' ? nomeLoja || 'Sua loja' : EXEMPLO[c] ?? todo))
}

function LinhaAssunto({ assunto, ligado, travado, padrao, extras, onLigar, onExtras }: {
  assunto: Assunto; ligado: boolean; travado: boolean; padrao: string[]; extras: string; onLigar: (v: boolean) => void; onExtras: (v: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="py-[10px]" data-testid={`assunto-${assunto}`}>
      <div className="flex items-center justify-between gap-[12px]">
        <button type="button" className="flex min-w-0 items-center gap-[8px] text-left" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
          <Tags className="h-[16px] w-[16px] flex-shrink-0 text-[#6B7280]" />
          <span className="text-[14px] font-medium text-[#1F2937]">{ROTULO_ASSUNTO[assunto]}</span>
          <span className="text-[12px] text-[#6B7280]">{aberto ? 'fechar' : 'palavras'}</span>
        </button>
        <ToggleSwitch checked={ligado} onChange={onLigar} disabled={travado} rotulo={ROTULO_ASSUNTO[assunto]} />
      </div>
      {aberto && (
        <div className="mt-[8px] space-y-[6px] pl-[24px]">
          <p className="text-[12px] text-[#6B7280]">Padrão: {padrao.join(', ')}</p>
          <textarea
            className={`${CLASSE_CAMPO} min-h-[64px] text-[13px]`}
            placeholder="Palavras extras, uma por linha (ex.: rodízio)"
            value={extras}
            onChange={(e) => onExtras(e.target.value)}
            aria-label={`Palavras extras de ${ROTULO_ASSUNTO[assunto]}`}
          />
        </div>
      )}
    </div>
  )
}

function Simulador({ rascunho }: { rascunho: Rascunho }) {
  const [enviadas, setEnviadas] = useState<string[]>([])
  const [passos, setPassos] = useState<PassoSim[]>([])
  const [texto, setTexto] = useState('')
  const [comPedido, setComPedido] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const fim = useRef<HTMLDivElement>(null)

  async function rodar(lista: string[], pedido = comPedido) {
    if (!lista.length) { setPassos([]); return }
    setOcupado(true)
    const corpo = {
      mensagens: lista,
      comPedido: pedido,
      nomeCliente: 'João',
      rascunho: {
        auto_assuntos_desligados: rascunho.assuntosDesligados,
        auto_textos: rascunho.textos,
        auto_palavras: palavrasParaApi(rascunho.palavras),
        auto_tempo_entrega: rascunho.tempoEntrega,
        pix_chave: rascunho.pixChave,
        pix_chave_tipo: rascunho.pixTipo || null,
      },
    }
    const res = await fetch('/api/admin/whatsapp/autoatendimento/simular', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null)
    setOcupado(false)
    if (res?.ok) setPassos((await res.json()).passos ?? [])
    requestAnimationFrame(() => fim.current?.scrollIntoView({ block: 'end' }))
  }

  function enviar(t: string) {
    const v = t.trim()
    if (!v || ocupado || enviadas.length >= 30) return
    const lista = [...enviadas, v]
    setEnviadas(lista)
    setTexto('')
    void rodar(lista)
  }

  return (
    <Cartao className="flex h-fit min-w-0 flex-col p-[16px] xl:sticky xl:top-[16px]" data-testid="robo-simulador">
      <TituloBloco
        titulo="Simulador"
        subtitulo="Teste como o cliente. Não envia nada para ninguém e usa as alterações ainda não salvas."
        acao={<Button variant="ghost" onClick={() => { setEnviadas([]); setPassos([]) }}><RotateCcw className="h-[14px] w-[14px]" /> Recomeçar</Button>}
      />
      <label className="mt-[10px] flex items-center gap-[8px] text-[13px] text-[#374151]">
        <input type="checkbox" checked={comPedido} onChange={(e) => { setComPedido(e.target.checked); void rodar(enviadas, e.target.checked) }} />
        Cliente com um pedido aberto (exemplo #1234)
      </label>
      <div className="mt-[10px] h-[440px] space-y-[8px] overflow-y-auto rounded-[3px] bg-[#EDEEF1] p-[10px]" aria-live="polite">
        {!passos.length && <p className="pt-[12px] text-center text-[13px] text-[#6B7280]">Escreva uma mensagem ou toque numa sugestão.</p>}
        {passos.map((p, i) => (
          <div key={i} className="space-y-[6px]">
            <Balao lado="cliente" texto={p.entrada} />
            <p className="text-right text-[11px] text-[#6B7280]" data-testid="sim-intencao">
              <MessageSquareText className="mr-[3px] inline h-[12px] w-[12px]" />entendeu: <strong>{p.intencao}</strong> → {p.acao}
            </p>
            {p.respostas.map((t, k) => <Balao key={k} lado="robo" texto={t} />)}
          </div>
        ))}
        <div ref={fim} />
      </div>
      <div className="mt-[8px] flex flex-wrap gap-[6px]">
        {SUGESTOES_SIM.map((s) => (
          <button key={s} type="button" onClick={() => enviar(s)} className="rounded-full border border-[#E5E7EB] bg-white px-[10px] py-[4px] text-[12px] text-[#374151] hover:border-[#0688D4]">{s}</button>
        ))}
      </div>
      <form className="mt-[8px] flex gap-[8px]" onSubmit={(e) => { e.preventDefault(); enviar(texto) }}>
        <input className={CLASSE_CAMPO} value={texto} maxLength={500} placeholder="Mensagem do cliente…" onChange={(e) => setTexto(e.target.value)} aria-label="Mensagem do cliente" />
        <Button type="submit" disabled={ocupado || !texto.trim()} aria-label="Enviar">{ocupado ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <Send className="h-[14px] w-[14px]" />}</Button>
      </form>
    </Cartao>
  )
}

function NaoEntendidasCartao({ itens, assuntos, onEnsinado, mostrar }: {
  itens: NaoEntendida[]; assuntos: Assunto[]; onEnsinado: () => Promise<void>; mostrar: (tipo: 'ok' | 'erro', texto: string) => void
}) {
  const [escolha, setEscolha] = useState<Record<string, string>>({})
  async function ensinar(id: string) {
    const assunto = escolha[id]
    if (!assunto) return
    const res = await fetch('/api/admin/whatsapp/autoatendimento/nao-entendidas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, assunto }) }).catch(() => null)
    if (!res?.ok) { mostrar('erro', (await res?.json().catch(() => null))?.error ?? 'Não foi possível ensinar.'); return }
    mostrar('ok', 'Pronto: o robô aprendeu essa frase.')
    await onEnsinado()
  }
  return (
    <Cartao className="p-[16px]" data-testid="robo-nao-entendidas">
      <TituloBloco titulo="Perguntas que o robô não entendeu" subtitulo="Últimos 30 dias. Escolha o assunto e toque em Ensinar: a frase vira palavra-chave." />
      {!itens.length ? (
        <p className="mt-[12px] text-[13px] text-[#6B7280]">Nenhuma pergunta sem resposta por enquanto.</p>
      ) : (
        <ul className="mt-[10px] divide-y divide-[#E5E7EB]">
          {itens.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-[8px] py-[8px]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-[#1F2937]">“{it.exemplo || it.texto}”</p>
                <p className="text-[12px] text-[#6B7280]">{it.vezes}× · {new Date(it.ultima_em).toLocaleDateString('pt-BR')}</p>
              </div>
              {it.ensinado_assunto ? (
                <span className="rounded-full bg-[#DCFCE7] px-[8px] py-[2px] text-[12px] font-semibold text-[#16A34A]">Ensinada: {ROTULO_ASSUNTO[it.ensinado_assunto as Assunto] ?? it.ensinado_assunto}</span>
              ) : (
                <>
                  <select className="rounded-[3px] border border-[#E5E7EB] px-[8px] py-[6px] text-[13px]" value={escolha[it.id] ?? ''} onChange={(e) => setEscolha((s) => ({ ...s, [it.id]: e.target.value }))} aria-label="Assunto">
                    <option value="">Assunto…</option>
                    {assuntos.map((a) => <option key={a} value={a}>{ROTULO_ASSUNTO[a]}</option>)}
                  </select>
                  <Button variant="outline" disabled={!escolha[it.id]} onClick={() => void ensinar(it.id)}><GraduationCap className="h-[14px] w-[14px]" /> Ensinar</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  )
}


/** Cartão e título no visual de Ajustes (fin-card, títulos #1C2B33). */
function Cartao({ children, className = '', ...resto }: React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }) {
  return <section className={`fin-card min-w-0 ${className}`} {...resto}>{children}</section>
}

function TituloBloco({ titulo, subtitulo, acao }: { titulo: string; subtitulo?: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <h3 className="text-[16px] font-semibold leading-tight text-[#1C2B33]">{titulo}</h3>
        {subtitulo && <p className="mt-1 text-[13px] leading-[18px] text-[#465A69]">{subtitulo}</p>}
      </div>
      {acao}
    </div>
  )
}
