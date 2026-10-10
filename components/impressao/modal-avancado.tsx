'use client'

import { useState } from 'react'
import { Check, Printer } from 'lucide-react'
import { ModalCentral } from '@/components/ui/flutuante'
import { chamar, novaChave } from '@/components/pdv/util'
import { nomeDisp } from '@/components/impressao/beta-cards'
import type { DispositivoVisao } from '@/lib/impressao/servico'
import { perguntarSaiuCertinho, sugerirTexto, type ModoAvancado, type RespostaTeste } from '@/lib/impressao/avancado'

const OPCOES: { modo: ModoAvancado; titulo: string; frase: string }[] = [
  { modo: 'imagem', titulo: 'Imagem — recomendado', frase: 'Mais bonita, com a fonte e o layout completos.' },
  { modo: 'texto', titulo: 'Texto', frase: 'Para impressoras que cortam ou travam com imagem. Usa a letra da própria impressora.' },
]

/**
 * "Avançado" (Alfa 1, 09/10): para cada impressora, Imagem ou Texto (salvo no servidor; o Assistente lê a cada
 * impressão) e "Imprimir teste" — uma comanda de exemplo na forma escolhida. Depois do primeiro teste: "Saiu
 * certinho?"; "Não saiu direito" em Imagem oferece Texto com um clique. O Windows não aparece aqui.
 */
export function ModalAvancado({ aberto, impressoras, onFechar, onMudou }: {
  aberto: boolean
  impressoras: DispositivoVisao[]
  onFechar: () => void
  onMudou: () => void
}) {
  return (
    <ModalCentral aberto={aberto} onFechar={onFechar} largura={600} classeTema="tela-impressao" testid="modal-avancado"
      titulo="Avançado" subtitulo="Como cada impressora recebe os pedidos."
      rodape={<div className="flex justify-end"><button type="button" className="ti-btn" onClick={onFechar}>Fechar</button></div>}>
      <div className="space-y-4 px-5 py-4">
        {impressoras.length === 0 && <p className="ti-rot">Nenhuma impressora configurada ainda.</p>}
        {impressoras.map((d) => <LinhaAvancado key={d.id} d={d} onMudou={onMudou} />)}
      </div>
    </ModalCentral>
  )
}

function LinhaAvancado({ d, onMudou }: { d: DispositivoVisao; onMudou: () => void }) {
  const [modo, setModo] = useState<ModoAvancado>(d.modoImpressao === 'texto' ? 'texto' : 'imagem')
  const [resposta, setResposta] = useState<RespostaTeste | null>(d.testeResposta)
  const [testeEnviado, setTesteEnviado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const url = `/api/admin/impressao/dispositivos/${d.id}`

  async function salvarModo(m: ModoAvancado) {
    if (ocupado || m === modo) return
    setOcupado(true)
    const r = await chamar(url, { method: 'PATCH', body: JSON.stringify({ modoImpressao: m }) })
    setOcupado(false)
    if (!r.ok) return setMsg({ ok: false, texto: r.erro ?? 'Não foi possível salvar.' })
    setModo(m)
    setMsg({ ok: true, texto: m === 'texto' ? 'Salvo: Texto. Vale na próxima impressão.' : 'Salvo: Imagem. Vale na próxima impressão.' })
    onMudou()
  }

  async function imprimirTeste() {
    if (ocupado) return
    setOcupado(true)
    const r = await chamar(url, { method: 'POST', body: JSON.stringify({ acao: 'cozinha_teste', chave: novaChave() }) })
    setOcupado(false)
    if (!r.ok) return setMsg({ ok: false, texto: r.erro ?? 'Não foi possível enviar o teste.' })
    setTesteEnviado(true)
    setMsg({ ok: true, texto: `Comanda de exemplo enviada para ${nomeDisp(d)} (${modo === 'texto' ? 'Texto' : 'Imagem'}).` })
  }

  async function responder(v: RespostaTeste) {
    setOcupado(true)
    const r = await chamar(url, { method: 'PATCH', body: JSON.stringify({ testeResposta: v }) })
    setOcupado(false)
    if (!r.ok) return setMsg({ ok: false, texto: r.erro ?? 'Não foi possível salvar.' })
    setResposta(v)
    setMsg(v === 'ok' ? { ok: true, texto: 'Ótimo! A impressora está pronta.' } : null)
    onMudou()
  }

  return (
    <section className="rounded-[8px] border p-4" style={{ borderColor: 'var(--ti-line)' }} data-testid={`avancado-${d.id}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0"><b className="block truncate">{nomeDisp(d)}</b>{d.apelido && <small className="block truncate" style={{ color: 'var(--ti-ink-3)' }}>{d.nomeSistema}</small>}</span>
        <button type="button" className="ti-btn sm" onClick={() => void imprimirTeste()} disabled={ocupado} data-testid={`avancado-teste-${d.id}`}><Printer aria-hidden /> Imprimir teste</button>
      </div>
      <div className="ti-escolha" role="radiogroup" aria-label={`Forma de impressão de ${nomeDisp(d)}`}>
        {OPCOES.map((o) => (
          <button key={o.modo} type="button" role="radio" aria-checked={modo === o.modo} className="ti-opcao" disabled={ocupado}
            onClick={() => void salvarModo(o.modo)} data-testid={`avancado-${o.modo}-${d.id}`}>
            <span className="t"><span className="ti-radio" aria-hidden />{o.titulo}</span>
            <p>{o.frase}</p>
          </button>
        ))}
      </div>
      {perguntarSaiuCertinho({ testeEnviado, resposta }) && (
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid={`avancado-saiu-${d.id}`}>
          <span className="text-[14px] font-semibold">Saiu certinho?</span>
          <button type="button" className="ti-btn sm" onClick={() => void responder('ok')} disabled={ocupado} data-testid={`avancado-saiu-sim-${d.id}`}><Check aria-hidden /> Sim</button>
          <button type="button" className="ti-btn sm" onClick={() => void responder('nao_saiu')} disabled={ocupado} data-testid={`avancado-saiu-nao-${d.id}`}>Não saiu direito</button>
        </div>
      )}
      {sugerirTexto({ resposta, modo }) && (
        <div className="ti-aviso mt-3" data-testid={`avancado-sugere-texto-${d.id}`}>
          <span className="min-w-0">Algumas impressoras cortam ou travam com imagem. Experimente a forma Texto.</span>
          <button type="button" className="ti-btn sm pri" onClick={() => void salvarModo('texto')} disabled={ocupado} data-testid={`avancado-usar-texto-${d.id}`}>Usar Texto</button>
        </div>
      )}
      {msg && <p role="status" className="mt-2 text-[13px]" style={{ color: msg.ok ? 'var(--ti-ok)' : 'var(--ti-bad)' }}>{msg.texto}</p>}
    </section>
  )
}
