import { redirect } from 'next/navigation'

/**
 * A "Cozinha" antiga (estação por QR/link, sem login) foi removida em 13/10/2026 (0195): a tela da cozinha é o KDS,
 * com o usuário da cozinha (Equipe › cargo Cozinha). Link/QR antigo → login com o aviso.
 */
export default function CozinhaAntiga() {
  redirect('/login?notice=kds')
}
