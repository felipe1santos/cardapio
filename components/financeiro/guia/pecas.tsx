import type { ReactNode } from 'react'
import { FIN_COR } from '@/components/graficos/kit-meta'

/**
 * Peças de texto do Guia do Financeiro (/admin/financeiro/guia). Só aparência, no tema .fin-meta:
 * peso máximo 600, cantos de 8px, cores do FIN_COR. Nada aqui busca dados nem decide regra.
 */

/** Cartão de uma seção do guia. O id é a âncora estável (/admin/financeiro/guia#<id>). */
export function SecaoGuia({ id, titulo, resumo, children }: { id: string; titulo: string; resumo?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} data-guia-secao={id} aria-labelledby={`${id}-titulo`} className="fin-card scroll-mt-[16px] px-4 py-4 sm:px-5 sm:py-5">
      <h2 id={`${id}-titulo`} className="text-[18px] font-semibold leading-tight" style={{ color: FIN_COR.texto }}>{titulo}</h2>
      {resumo && <p className="mt-1 text-[14px] leading-[21px]" style={{ color: FIN_COR.texto2 }}>{resumo}</p>}
      <div className="mt-3 space-y-4 break-words text-[14px] leading-[21px]" style={{ color: FIN_COR.texto }}>{children}</div>
    </section>
  )
}

/** Subtítulo dentro da seção ("Para que serve", "Passo a passo"...). */
export function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[15px] font-semibold" style={{ color: FIN_COR.texto }}>{titulo}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

/** Passo a passo numerado (bolinhas azuis). */
export function Passos({ itens }: { itens: ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {itens.map((t, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-[1px] flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ background: FIN_COR.azul }} aria-hidden="true">{i + 1}</span>
          <span className="min-w-0 flex-1">{t}</span>
        </li>
      ))}
    </ol>
  )
}

/** Lista "o que significa cada número": termo em negrito e explicação. */
export function Termos({ itens }: { itens: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y overflow-hidden rounded-[8px] border" style={{ borderColor: FIN_COR.borda }}>
      {itens.map(([t, e], i) => (
        <div key={i} className="px-3 py-2.5 sm:grid sm:grid-cols-[200px_1fr] sm:gap-3" style={{ borderColor: FIN_COR.borda }}>
          <dt className="font-semibold">{t}</dt>
          <dd className="mt-0.5 sm:mt-0" style={{ color: FIN_COR.texto2 }}>{e}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Lista simples com marcador. */
export function Lista({ itens }: { itens: ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {itens.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-[8px] h-[6px] w-[6px] flex-shrink-0 rounded-full" style={{ background: FIN_COR.texto2 }} aria-hidden="true" />
          <span className="min-w-0 flex-1">{t}</span>
        </li>
      ))}
    </ul>
  )
}

/** Erros comuns: faixa laranja à esquerda. */
export function Erros({ itens }: { itens: ReactNode[] }) {
  return (
    <div className="rounded-[8px] border-l-[3px] px-3 py-2.5" style={{ borderLeftColor: '#D47B04', background: '#FDF2E2' }}>
      <p className="mb-1 text-[13px] font-semibold" style={{ color: FIN_COR.atencaoTexto }}>Erros comuns</p>
      <Lista itens={itens} />
    </div>
  )
}

/** Dica curta em azul-claro. */
export function Dica({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[8px] px-3 py-2.5 text-[14px]" style={{ background: FIN_COR.destaque, color: FIN_COR.texto }}>{children}</p>
  )
}

/** Nome de botão ou campo como aparece na tela. */
export function B({ children }: { children: ReactNode }) {
  return <span className="font-semibold">{children}</span>
}

/** Pergunta e resposta (Situações do dia a dia). */
export function Pergunta({ pergunta, children }: { pergunta: string; children: ReactNode }) {
  return (
    <details className="group rounded-[8px] border bg-white" style={{ borderColor: FIN_COR.borda }} open>
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-3 py-2.5 font-semibold [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{pergunta}</span>
        <span className="mt-[2px] flex-shrink-0 transition-transform duration-150 group-open:rotate-180" style={{ color: FIN_COR.texto2 }} aria-hidden="true">▾</span>
      </summary>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </details>
  )
}

/** Ilustração: os dois níveis lado a lado (caixas imitando a tela). */
export function IlustracaoNiveis() {
  const caixa = (titulo: string, cor: string, linhas: string[]) => (
    <div className="min-w-0 flex-1 rounded-[8px] border bg-white p-3" style={{ borderColor: FIN_COR.borda }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="h-[10px] w-[10px] flex-shrink-0 rounded-full" style={{ background: cor }} aria-hidden="true" />
        <span className="text-[13px] font-semibold">{titulo}</span>
      </div>
      <ul className="space-y-1 text-[13px]" style={{ color: FIN_COR.texto2 }}>
        {linhas.map((l) => <li key={l}>✓ {l}</li>)}
      </ul>
    </div>
  )
  return (
    <figure className="rounded-[8px] p-3" style={{ background: FIN_COR.trilho }} aria-label="Comparação dos dois níveis do Financeiro">
      <div className="flex flex-col gap-2 sm:flex-row">
        {caixa('Nível 1 · Financeiro ligado', FIN_COR.azul, ['Relatórios, contas e DRE', 'Caixa automático', 'Vendas como sempre'])}
        {caixa('Nível 2 · Controle de caixa ativo', FIN_COR.verde, ['Tudo do nível 1', 'Abrir e fechar caixa', 'Contagem às cegas e PIN'])}
      </div>
      <figcaption className="mt-2 text-[12px]" style={{ color: FIN_COR.texto2 }}>O nível 2 é ligado pelo dono quando a loja estiver pronta.</figcaption>
    </figure>
  )
}

/** Ilustração: tela de fechamento com contagem às cegas. */
export function IlustracaoContagem() {
  return (
    <figure className="mx-auto w-full max-w-[340px] rounded-[8px] border bg-white p-3 shadow-[0_2px_8px_rgba(28,43,51,0.08)]" style={{ borderColor: FIN_COR.borda }} aria-label="Exemplo da tela de fechar caixa">
      <p className="text-[14px] font-semibold">Fechar caixa</p>
      <p className="mt-0.5 text-[12px]" style={{ color: FIN_COR.texto2 }}>Conte o dinheiro da gaveta e digite o total.</p>
      <div className="mt-2.5 space-y-2">
        <div>
          <p className="mb-1 text-[12px] font-semibold">Dinheiro contado</p>
          <div className="flex h-[34px] items-center rounded-[8px] border px-2.5 text-[13px]" style={{ borderColor: FIN_COR.azul }}>R$ <span className="ml-1" style={{ color: FIN_COR.texto2 }}>0,00</span></div>
        </div>
        <div>
          <p className="mb-1 text-[12px] font-semibold">Total da maquininha</p>
          <div className="flex h-[34px] items-center rounded-[8px] border px-2.5 text-[13px]" style={{ borderColor: FIN_COR.borda }}>R$ <span className="ml-1" style={{ color: FIN_COR.texto2 }}>0,00</span></div>
        </div>
        <div className="rounded-[8px] px-2.5 py-2 text-[12px]" style={{ background: FIN_COR.trilho, color: FIN_COR.texto2 }}>Quanto deveria ter: <span className="font-semibold">só aparece depois de contar</span></div>
      </div>
      <figcaption className="sr-only">O sistema esconde o valor esperado até a pessoa informar a contagem.</figcaption>
    </figure>
  )
}
