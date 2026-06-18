import { HTMLAttributes } from 'react'

/** Card branco padrão Menuzia — usado pra agrupar seções de conteúdo sobre o fundo cinza do painel. */
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['rounded-menuzia border border-border bg-white p-4.5', className].join(' ')} {...props} />
}
