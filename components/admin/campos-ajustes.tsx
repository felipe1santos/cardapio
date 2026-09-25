'use client'

/** Campos dos formulários de configuração (Ajustes e Impressão). */

export function ToggleSwitch({ checked, onChange, disabled, rotulo }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; /** Nome lido em voz alta — obrigatório quando o texto ao lado não é do próprio botão. */ rotulo?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rotulo}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'inline-flex h-[22px] w-[38px] flex-shrink-0 items-center rounded-full border p-[2px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-border bg-border',
      ].join(' ')}
    >
      <span
        className={[
          'block h-[16px] w-[16px] flex-shrink-0 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[16px]' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

export function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-none">
      <div>
        <div className="text-[13px] font-medium text-text-main">{label}</div>
        {hint && <p className="mt-0.5 text-[11px] text-text-subtle">{hint}</p>}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} rotulo={label} />
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[11px] text-text-subtle">{hint}</p>}
    </div>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        'w-full rounded-menuzia border border-border bg-white px-3 py-2.5 font-sans text-sm text-text-main outline-none transition-colors',
        'focus:border-primary placeholder:text-text-subtle/60 disabled:bg-page disabled:text-text-subtle',
        props.className ?? '',
      ].join(' ')}
    />
  )
}
