'use client'

import { useEffect, useRef } from 'react'

/**
 * Mantém a tela do financeiro em dia sem recarregar (auditoria 09/10: venda feita em outro aparelho
 * só aparecia no Caixa ao recarregar). Recarrega a cada `ms` com a aba visível, ao voltar para a aba
 * e quando outra parte do painel avisa que o caixa mudou. `ativo=false` pausa (ex.: janela de
 * fechamento aberta — não mexer no que o operador está contando).
 */
export const ATUALIZAR_A_CADA_MS = 15_000

export function useAtualizacaoAutomatica(carregar: () => unknown, ativo = true, ms = ATUALIZAR_A_CADA_MS) {
  const ref = useRef(carregar)
  useEffect(() => { ref.current = carregar }, [carregar])
  useEffect(() => {
    if (!ativo) return
    const agora = () => { if (document.visibilityState === 'visible') void ref.current() }
    const t = setInterval(agora, ms)
    document.addEventListener('visibilitychange', agora)
    window.addEventListener('focus', agora)
    window.addEventListener('menuzia:caixa-mudou', agora)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', agora)
      window.removeEventListener('focus', agora)
      window.removeEventListener('menuzia:caixa-mudou', agora)
    }
  }, [ativo, ms])
}
