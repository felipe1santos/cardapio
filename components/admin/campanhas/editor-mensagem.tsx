'use client'

import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Link2, Strikethrough } from 'lucide-react'

/**
 * Editor da copy dos disparos (04/11/2026). Mostra negrito, itálico, riscado e as variáveis como marcação visual
 * (etiquetas coloridas), mas grava o texto no formato do WhatsApp: *negrito*, _itálico_, ~riscado~ e {variavel}.
 * As etiquetas não são editáveis por dentro: apagam inteiras. Colar sempre entra como texto puro.
 */

interface Variavel { v: string; rotulo: string; classe: string }

/** Variáveis do editor. `{link}` é o mesmo link rastreável do `{link_cardapio}` (aparece igual). */
const VARIAVEIS: Variavel[] = [
  { v: '{nome}', rotulo: 'Nome do cliente', classe: 'bg-[#dbeafe] text-[#1e40af]' },
  { v: '{loja}', rotulo: 'Nome da loja', classe: 'bg-[#ede9fe] text-[#5b21b6]' },
  { v: '{link_cardapio}', rotulo: 'Link do cardápio', classe: 'bg-[#dcfce7] text-[#166534]' },
  { v: '{ultimo_item}', rotulo: 'Último item pedido', classe: 'bg-[#fef3c7] text-[#92400e]' },
]
const POR_VAR = new Map<string, Variavel>([...VARIAVEIS.map((x) => [x.v, x] as const), ['{link}', VARIAVEIS[2]]])
const CLASSE_CHIP = 'mx-[1px] inline-block select-none rounded-[4px] px-1.5 py-[1px] align-baseline text-[12px] font-semibold leading-[18px]'
const CLASSE_LINK = 'bg-[#e0f2fe] text-[#0369a1] underline'

const TOKEN_RE = /\{[a-z_]+\}|https?:\/\/[^\s<>"']+/g

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hostDe(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url.slice(0, 30) }
}

function chipVariavel(v: string): string {
  const d = POR_VAR.get(v)!
  return `<span contenteditable="false" data-var="${escapar(v)}" class="${CLASSE_CHIP} ${d.classe}">${escapar(d.rotulo)}</span>`
}

function chipLink(url: string): string {
  return `<span contenteditable="false" data-raw="${escapar(url)}" title="${escapar(url)}" class="${CLASSE_CHIP} ${CLASSE_LINK}">🔗 ${escapar(hostDe(url))}</span>`
}

/** Texto do WhatsApp → HTML do editor (tudo escapado; variáveis e links viram etiquetas). */
export function textoParaHtml(texto: string): string {
  return (texto ?? '').split('\n').map((linha) => {
    // 1) tira variáveis e links da linha (marcadores \u0000n\u0000) para a formatação não quebrá-los;
    const tokens: string[] = []
    const semTokens = linha.replace(TOKEN_RE, (m) => {
      if (m.startsWith('{') && !POR_VAR.has(m)) return m
      tokens.push(m)
      return `\u0000${tokens.length - 1}\u0000`
    })
    // 2) escapa e aplica *negrito*, _itálico_, ~riscado~ (sem espaço colado no marcador, como o WhatsApp);
    const html = escapar(semTokens)
      .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, '<b>$1</b>')
      .replace(/(^|[^\w])_(\S(?:[^_\n]*\S)?)_(?=[^\w]|$)/g, '$1<i>$2</i>')
      .replace(/~(\S(?:[^~\n]*\S)?)~/g, '<s>$1</s>')
    // 3) devolve as etiquetas.
    // eslint-disable-next-line no-control-regex
    return html.replace(/\u0000(\d+)\u0000/g, (_, i) => {
      const t = tokens[Number(i)]
      return t.startsWith('{') ? chipVariavel(t) : chipLink(t)
    })
  }).join('<br>')
}

function marcar(dentro: string, m: string): string {
  const ini = dentro.match(/^\s*/)![0]
  const fim = dentro.match(/\s*$/)![0]
  const meio = dentro.trim()
  if (!meio) return dentro
  return `${ini}${m}${meio}${m}${fim}`
}

function negrito(el: HTMLElement): boolean {
  const w = el.style?.fontWeight
  return el.tagName === 'B' || el.tagName === 'STRONG' || w === 'bold' || Number(w) >= 600
}

/** HTML do editor → texto do WhatsApp. Entende também o que o navegador cria ao digitar (div por linha, strong, em…). */
export function htmlParaTexto(raiz: Node): string {
  let out = ''
  const filhos = Array.from(raiz.childNodes)
  filhos.forEach((n, idx) => {
    if (n.nodeType === Node.TEXT_NODE) { out += (n.textContent ?? '').replace(/ /g, ' '); return }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const el = n as HTMLElement
    if (el.dataset.var) { out += el.dataset.var; return }
    if (el.dataset.raw) { out += el.dataset.raw; return }
    const tag = el.tagName
    if (tag === 'BR') {
      // <br> final de um bloco com texto é só "segura-linha" do navegador.
      const ultimo = idx === filhos.length - 1
      const blocoPai = raiz.nodeType === Node.ELEMENT_NODE && ['DIV', 'P'].includes((raiz as HTMLElement).tagName)
      if (!(ultimo && blocoPai && filhos.length > 1)) out += '\n'
      return
    }
    if (tag === 'DIV' || tag === 'P') {
      if (out && !out.endsWith('\n')) out += '\n'
      out += htmlParaTexto(el)
      return
    }
    let dentro = htmlParaTexto(el)
    if (negrito(el)) dentro = marcar(dentro, '*')
    if (tag === 'I' || tag === 'EM' || el.style?.fontStyle === 'italic') dentro = marcar(dentro, '_')
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || (el.style?.textDecoration ?? '').includes('line-through')) dentro = marcar(dentro, '~')
    out += dentro
  })
  return out
}

/** Põe o cursor no fim do editor quando a seleção não está dentro dele. */
function garantirSelecaoDentro(caixa: HTMLElement) {
  const sel = window.getSelection()
  if (sel && sel.rangeCount && caixa.contains(sel.getRangeAt(0).commonAncestorContainer)) return
  caixa.focus()
  const r = document.createRange()
  r.selectNodeContents(caixa)
  r.collapse(false)
  sel?.removeAllRanges()
  sel?.addRange(r)
}

export function EditorMensagem({ valor, onChange, rotulo, testId, ultimoItem = false, linhas = 4, placeholder = 'Escreva a mensagem…' }: {
  valor: string
  onChange: (texto: string) => void
  rotulo: string
  testId?: string
  /** {ultimo_item} só existe na Recuperação. */
  ultimoItem?: boolean
  linhas?: number
  placeholder?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const emitido = useRef<string | null>(null)
  const selecaoSalva = useRef<Range | null>(null)
  const [linkAberto, setLinkAberto] = useState(false)
  const [url, setUrl] = useState('')
  const [erroUrl, setErroUrl] = useState<string | null>(null)

  // Valor de fora (abrir o modal, trocar de anúncio): redesenha. O que o próprio editor emitiu não redesenha.
  useEffect(() => {
    if (!ref.current || valor === emitido.current) return
    ref.current.innerHTML = textoParaHtml(valor)
    emitido.current = valor
  }, [valor])

  function emitir() {
    if (!ref.current) return
    const t = htmlParaTexto(ref.current)
    emitido.current = t
    onChange(t)
  }

  function formatar(cmd: 'bold' | 'italic' | 'strikeThrough') {
    if (!ref.current) return
    garantirSelecaoDentro(ref.current)
    document.execCommand(cmd)
    emitir()
  }

  function inserirHtml(html: string) {
    if (!ref.current) return
    garantirSelecaoDentro(ref.current)
    document.execCommand('insertHTML', false, `${html}&nbsp;`)
    emitir()
  }

  function abrirLink() {
    const sel = window.getSelection()
    selecaoSalva.current = sel && sel.rangeCount && ref.current?.contains(sel.getRangeAt(0).commonAncestorContainer) ? sel.getRangeAt(0).cloneRange() : null
    setUrl('')
    setErroUrl(null)
    setLinkAberto(true)
  }

  function inserirLink() {
    const u = url.trim()
    if (!/^https:\/\/[^\s<>"']+\.[^\s<>"']+$/.test(u)) { setErroUrl('Use um endereço completo, começando com https://'); return }
    setLinkAberto(false)
    if (selecaoSalva.current && ref.current) {
      ref.current.focus()
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(selecaoSalva.current)
    }
    inserirHtml(chipLink(u))
  }

  const vars = VARIAVEIS.filter((x) => ultimoItem || x.v !== '{ultimo_item}')
  const botao = 'grid h-8 w-8 place-items-center rounded-[4px] text-[#374151] hover:bg-[#eef1f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688d4]'
  const tamanho = valor.length

  return (
    <div className="rounded-[6px] border border-[#d6dae1] bg-white focus-within:border-[#0688d4]" data-testid={testId ? `${testId}-editor` : undefined}>
      <div className="flex flex-wrap items-center gap-1 border-b border-[#e5e7eb] px-1.5 py-1" role="toolbar" aria-label={`Formatar ${rotulo}`}>
        {/* onMouseDown + preventDefault: o clique não tira a seleção do texto. */}
        <button type="button" className={botao} aria-label="Negrito" title="Negrito" onMouseDown={(e) => e.preventDefault()} onClick={() => formatar('bold')}><Bold className="h-4 w-4" /></button>
        <button type="button" className={botao} aria-label="Itálico" title="Itálico" onMouseDown={(e) => e.preventDefault()} onClick={() => formatar('italic')}><Italic className="h-4 w-4" /></button>
        <button type="button" className={botao} aria-label="Riscado" title="Riscado" onMouseDown={(e) => e.preventDefault()} onClick={() => formatar('strikeThrough')}><Strikethrough className="h-4 w-4" /></button>
        <span className="mx-1 h-5 w-px bg-[#e5e7eb]" aria-hidden />
        {vars.map((x) => (
          <button key={x.v} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => inserirHtml(chipVariavel(x.v))}
            className={`h-7 rounded-[4px] px-2 text-[11.5px] font-semibold ${x.classe} hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688d4]`}>
            + {x.rotulo}
          </button>
        ))}
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={abrirLink}
          className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#d6dae1] px-2 text-[11.5px] font-semibold text-[#374151] hover:bg-[#f6f7f9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688d4]">
          <Link2 className="h-3.5 w-3.5" /> Link próprio
        </button>
      </div>
      {linkAberto && (
        <div className="flex flex-wrap items-start gap-2 border-b border-[#e5e7eb] bg-[#f8fafc] px-2 py-2">
          <label className="min-w-[200px] flex-1 text-[11.5px] font-semibold text-[#5b6472]">
            Endereço do link
            <input autoFocus type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); inserirLink() } if (e.key === 'Escape') { e.preventDefault(); setLinkAberto(false) } }}
              aria-invalid={!!erroUrl} aria-describedby={erroUrl ? `${testId}-erro-url` : undefined}
              className="mt-1 block h-9 w-full rounded-[5px] border border-[#d6dae1] px-2 text-[13px] font-normal text-[#1f2937] focus:border-[#0688d4] focus:outline-none" />
            {erroUrl && <span id={`${testId}-erro-url`} className="mt-1 block text-[11.5px] text-[#b91c1c]">{erroUrl}</span>}
          </label>
          <div className="flex gap-1 pt-[18px]">
            <button type="button" onClick={inserirLink} className="h-9 rounded-[5px] bg-[#112f6b] px-3 text-[12px] font-semibold text-white hover:bg-[#0c2350]">Inserir</button>
            <button type="button" onClick={() => setLinkAberto(false)} className="h-9 rounded-[5px] px-3 text-[12px] font-semibold text-[#374151] hover:bg-[#eef1f6]">Cancelar</button>
          </div>
        </div>
      )}
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={rotulo}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        data-testid={testId}
        onInput={emitir}
        onBlur={emitir}
        onPaste={(e) => {
          e.preventDefault()
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
          emitir()
        }}
        className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-[13.5px] leading-[22px] text-[#1f2937] outline-none empty:before:text-[#9ca3af] empty:before:content-[attr(data-placeholder)]"
        style={{ minHeight: `${linhas * 22 + 16}px` }}
      />
      <div className="flex justify-between gap-2 border-t border-[#f0f1f4] px-3 py-1 text-[11px] text-[#6b7280]">
        <span>O rodapé “Responda SAIR para não receber mais.” vai sempre no fim.</span>
        <span className={tamanho > 4096 ? 'font-semibold text-[#b91c1c]' : ''}>{tamanho}/4096</span>
      </div>
    </div>
  )
}

/** Mostra uma copy gravada com a mesma marcação do editor (só leitura). */
export function CopyVisual({ texto, className = '' }: { texto: string; className?: string }) {
  return <div className={`whitespace-pre-wrap break-words ${className}`} dangerouslySetInnerHTML={{ __html: textoParaHtml(texto) }} />
}
