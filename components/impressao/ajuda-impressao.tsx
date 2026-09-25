'use client'

import { useEffect, useRef } from 'react'

/**
 * Botão "i" ao lado do título da Impressão e a janela de ajuda. Textos curtos, para quem
 * cuida da loja — sem termos técnicos. Tela cheia no celular, janela central no computador.
 */
export function BotaoAjudaImpressao({ onAbrir }: { onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label="Como funciona a impressão"
      title="Como funciona a impressão"
      data-testid="ajuda-impressao"
      className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 border-primary text-[13px] font-extrabold italic leading-none text-primary transition-colors hover:bg-primary hover:text-white"
    >
      i
    </button>
  )
}

const TOPICOS: { titulo: string; texto: React.ReactNode }[] = [
  {
    titulo: 'O que é o Assistente',
    texto: (
      <>
        É o programa instalado no computador da loja que recebe os pedidos do Menuzia e manda para a impressora.
        <br />
        <strong>Assistente atual</strong>: o que a loja já usa. Continua imprimindo normalmente.
        <br />
        <strong>Assistente Beta</strong>: versão nova, liberada para algumas lojas. É necessária para usar uma impressora
        para a Cozinha e outra para o Caixa.
      </>
    ),
  },
  {
    titulo: 'Impressão automática',
    texto: 'Ligada, o pedido sai na impressora assim que chega, sem ninguém clicar. Desligada, nada é impresso sozinho.',
  },
  {
    titulo: 'Impressora da Cozinha',
    texto: 'Imprime os pedidos que devem ser preparados (a ficha da cozinha).',
  },
  {
    titulo: 'Impressora do Caixa — Recibo/Extrato',
    texto: 'Imprime o Recibo/Extrato quando alguém toca em “Imprimir Recibo/Extrato” na conta da mesa ou do balcão.',
  },
  {
    titulo: 'O que é o Recibo/Extrato',
    texto: 'Documento não fiscal usado para o cliente conferir a conta antes ou depois do pagamento: itens, taxa, desconto, o que já foi pago e o que falta pagar.',
  },
  {
    titulo: 'Uma ou duas impressoras',
    texto: 'Com uma impressora, tudo sai nela. Com duas, a Cozinha recebe só os pedidos e o Caixa só o Recibo/Extrato. Duas impressoras exigem o Assistente Beta.',
  },
  {
    titulo: 'Papel de 58 mm ou 80 mm',
    texto: 'Escolha a largura da bobina que está na impressora. O 80 mm é o mais comum em cozinha e caixa; o 58 mm é a bobina estreita, de maquininhas menores.',
  },
  {
    titulo: 'Teste e calibração',
    texto: (
      <>
        <strong>Teste</strong>: imprime uma página curta para ver se a impressora responde.
        <br />
        <strong>Calibração</strong>: imprime uma régua com uma barra preta em cada lado. Se as duas barras e o valor do TOTAL
        aparecem inteiros, está certo. Se a direita sai cortada, anote o último número inteiro da régua e informe na tela —
        só aquela impressora é ajustada.
      </>
    ),
  },
  {
    titulo: '“Windows aceitou” não é “papel saiu”',
    texto: 'O Menuzia sabe que o Windows recebeu o trabalho. A impressora térmica não avisa se o papel saiu de verdade. Se nada saiu, confira a impressora.',
  },
  {
    titulo: 'Quando o papel não sai',
    texto: (
      <>
        · Acabou o papel ou a bobina está ao contrário.
        <br />· Tampa aberta — feche até ouvir o clique.
        <br />· Impressora desligada, sem cabo ou fora da rede (offline).
        <br />· Fila do Windows travada: abra “Impressoras e scanners”, clique na impressora e cancele os documentos parados.
      </>
    ),
  },
  {
    titulo: 'Testar o Beta sem tirar o atual',
    texto: 'O Beta é instalado ao lado do Assistente atual, com nome e pasta próprios. Ele começa em “Somente teste”: não imprime pedido nenhum. Para desistir, volte para “Somente teste” ou desinstale o Beta — o atual continua como está.',
  },
]

export function ModalAjudaImpressao({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const fechar = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!aberto) return
    fechar.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aberto, onFechar])
  if (!aberto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="ajuda-impressao-titulo" onClick={onFechar}>
      <div
        className="flex max-h-full w-full flex-col bg-white shadow-xl sm:max-h-[88vh] sm:max-w-[640px] sm:rounded-menuzia"
        onClick={(e) => e.stopPropagation()}
        data-testid="modal-ajuda-impressao"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id="ajuda-impressao-titulo" className="text-[16px] font-bold text-text-main">Como funciona a impressão</h2>
          <button ref={fechar} type="button" onClick={onFechar} aria-label="Fechar" className="flex h-[36px] w-[36px] items-center justify-center rounded-menuzia bg-page text-[20px] text-text-subtle hover:bg-border">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {TOPICOS.map((t) => (
            <section key={t.titulo} className="border-b border-border py-3 last:border-none">
              <h3 className="text-[13px] font-bold text-text-main">{t.titulo}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-text-subtle">{t.texto}</p>
            </section>
          ))}
        </div>
        <div className="border-t border-border px-4 py-3">
          <button type="button" onClick={onFechar} className="w-full rounded-menuzia bg-primary py-2.5 text-[12px] font-bold uppercase tracking-wide text-white hover:bg-primary-dark">
            Entendi
          </button>
        </div>
      </div>
    </div>
  )
}
