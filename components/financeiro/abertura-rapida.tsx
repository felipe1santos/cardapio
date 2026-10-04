'use client'

import { useEffect, useState } from 'react'
import { CampoDinheiro, Janela, botao } from './apoio'

/**
 * Abertura rápida do caixa ao entrar (Fase 6): quem pode abrir o caixa e entra com o caixa FECHADO vê uma vez
 * por sessão do navegador a pergunta "Abrir o caixa agora?" com o fundo de troco. Recusar não bloqueia nada.
 * O servidor confere a permissão e registra quem abriu (da sessão).
 */
const CHAVE = 'menuzia:abertura-rapida-perguntada'

export function AberturaRapidaCaixa() {
  const [mostrar, setMostrar] = useState(false)
  const [txt, setTxt] = useState('')
  const [c, setC] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    // Só logo depois do login (cookie de 1 min que o login grava) e uma vez por sessão do navegador.
    const recem = document.cookie.split('; ').some((c) => c === 'menuzia_recem_entrou=1')
    if (!recem) return
    document.cookie = 'menuzia_recem_entrou=; Max-Age=0; path=/'
    let jaPerguntou = false
    try { jaPerguntou = sessionStorage.getItem(CHAVE) === '1' } catch { /* sem storage: pergunta de novo, tudo bem */ }
    if (jaPerguntou) return
    void (async () => {
      const r = await fetch('/api/admin/financeiro/caixa?leve=1', { cache: 'no-store' }).catch(() => null)
      if (!r?.ok) return
      const j = await r.json().catch(() => ({}))
      if (j.aberto === false && j.podeAbrir) setMostrar(true)
    })()
  }, [])

  const fechar = () => { try { sessionStorage.setItem(CHAVE, '1') } catch { /* ok */ } setMostrar(false) }
  async function abrir() {
    if (c === null || c < 0) return setErro('Informe o fundo de troco (pode ser 0).')
    setOcupado(true); setErro(null)
    const r = await fetch('/api/admin/financeiro/caixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'abrir', fundoCentavos: c }) }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    setOcupado(false)
    if (!r?.ok && j.codigo !== 'ja_aberto') return setErro(j.error ?? 'Não foi possível abrir.')
    fechar()
    window.dispatchEvent(new Event('menuzia:caixa-mudou'))
  }
  if (!mostrar) return null
  return (
    <Janela titulo="Abrir o caixa agora?" onFechar={fechar} testid="abertura-rapida">
      <p className="mb-[10px] text-[13px] text-text-subtle">O caixa está fechado. Conte o dinheiro da gaveta (fundo de troco) para começar — fica registrado em seu nome.</p>
      <CampoDinheiro rotulo="Fundo de troco" valor={txt} onMudar={(t, v) => { setTxt(t); setC(v) }} testid="abertura-rapida-fundo" autoFocus />
      {erro && <p className="mt-[8px] text-[12px] font-medium text-danger">{erro}</p>}
      <div className="mt-[14px] flex justify-end gap-2">
        <button type="button" className={botao.secundario} onClick={fechar} data-testid="abertura-rapida-depois">Agora não</button>
        <button type="button" className={botao.sucesso} disabled={ocupado} onClick={() => void abrir()} data-testid="abertura-rapida-abrir">Abrir caixa</button>
      </div>
    </Janela>
  )
}
