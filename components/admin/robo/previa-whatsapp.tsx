'use client'

/**
 * Prévia de mensagem como no WhatsApp: *negrito*, _itálico_, ~tachado~, `código`, citação "> " e lista "- ".
 * Monta elementos React (nada de HTML cru): o texto do dono nunca vira marcação.
 */
import { Fragment } from 'react'

const INLINE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`)/g

function emLinha(texto: string, chave: string) {
  return texto.split(INLINE).map((parte, i) => {
    const k = `${chave}-${i}`
    if (/^\*[^*]+\*$/.test(parte)) return <strong key={k} className="font-semibold">{parte.slice(1, -1)}</strong>
    if (/^_[^_]+_$/.test(parte)) return <em key={k}>{parte.slice(1, -1)}</em>
    if (/^~[^~]+~$/.test(parte)) return <s key={k}>{parte.slice(1, -1)}</s>
    if (/^`[^`]+`$/.test(parte)) return <code key={k} className="rounded-[3px] bg-[#EDEEF1] px-[3px] font-mono text-[12.5px]">{parte.slice(1, -1)}</code>
    return <Fragment key={k}>{parte}</Fragment>
  })
}

export function TextoWhatsapp({ texto }: { texto: string }) {
  return (
    <div className="space-y-[2px] whitespace-pre-wrap break-words text-[14px] leading-[19px] text-[#1F2937]">
      {texto.split('\n').map((linha, i) => {
        const k = `l${i}`
        if (!linha.trim()) return <div key={k} className="h-[10px]" />
        if (linha.startsWith('> ')) {
          return <div key={k} className="border-l-[3px] border-[#10B981] pl-[8px] text-[#6B7280]">{emLinha(linha.slice(2), k)}</div>
        }
        if (linha.startsWith('- ')) {
          return <div key={k} className="flex gap-[6px] pl-[2px]"><span aria-hidden>•</span><span>{emLinha(linha.slice(2), k)}</span></div>
        }
        return <div key={k}>{emLinha(linha, k)}</div>
      })}
    </div>
  )
}

/** Balão: do robô (direita, verde claro) ou do cliente (esquerda, branco). */
export function Balao({ texto, lado }: { texto: string; lado: 'robo' | 'cliente' }) {
  return (
    <div className={`flex ${lado === 'robo' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-[3px] px-[10px] py-[7px] border border-[#E5E7EB] ${lado === 'robo' ? 'bg-[#DCFCE7]' : 'bg-white'}`}>
        <TextoWhatsapp texto={texto} />
      </div>
    </div>
  )
}
