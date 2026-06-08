import { ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'outline' | 'success' | 'dispatch' | 'ghost'

const variantClasses: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark',
  secondary: 'bg-border text-text-main hover:bg-gray-300',
  outline: 'bg-white text-text-main border border-border hover:border-primary hover:text-primary',
  success: 'bg-status-ready text-white hover:brightness-95',
  dispatch: 'bg-sidebar-bg text-white hover:bg-sidebar-hover',
  ghost: 'bg-transparent text-text-subtle hover:bg-page hover:text-text-main',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className = '', ...props }, ref) => {
    const classes = [
      'inline-flex items-center justify-center gap-1.5',
      'rounded-menuzia px-3 py-1.5',
      'text-[11px] font-semibold uppercase tracking-wide',
      'transition-colors duration-150',
      variantClasses[variant],
      className,
    ].join(' ')

    return <button ref={ref} className={classes} {...props} />
  }
)
Button.displayName = 'Button'
