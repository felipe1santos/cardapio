import { HTMLAttributes } from 'react'

type Tone = 'ok' | 'danger' | 'paused' | 'pending' | 'preparing' | 'ready' | 'alert'

const toneClasses: Record<Tone, string> = {
  ok: 'bg-price-bg text-price-text',
  danger: 'bg-danger-bg text-danger',
  paused: 'bg-purple/10 text-purple',
  pending: 'bg-status-pending/10 text-status-pending',
  preparing: 'bg-status-preparing/10 text-status-preparing',
  ready: 'bg-status-ready/10 text-status-ready',
  alert: 'bg-alert-bg text-alert-text',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: Tone
}

export function Badge({ tone, className = '', ...props }: BadgeProps) {
  const classes = [
    'inline-block rounded-menuzia px-2 py-0.5',
    'text-[10px] font-bold uppercase tracking-wide',
    toneClasses[tone],
    className,
  ].join(' ')

  return <span className={classes} {...props} />
}
