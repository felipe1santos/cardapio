function IconBase({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-5 w-5'} xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  )
}

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="12" fill="#25D366" />
      <path
        fill="#fff"
        d="M16.7 13.85c-.26-.13-1.52-.75-1.76-.83-.24-.09-.41-.13-.58.13-.17.26-.67.83-.82 1-.15.17-.3.19-.56.06-.26-.13-1.09-.4-2.08-1.28-.77-.68-1.29-1.53-1.44-1.79-.15-.26-.02-.4.13-.53.13-.13.3-.34.45-.51.15-.17.2-.3.3-.5.1-.21.05-.38-.03-.51-.09-.13-.5-1.21-.69-1.66-.18-.43-.37-.37-.51-.38h-.43c-.15 0-.39.06-.6.3-.21.24-.8.78-.8 1.9 0 1.12.82 2.2.93 2.35.11.15 1.55 2.37 3.76 3.23 2.21.86 2.21.57 2.61.53.4-.04 1.29-.53 1.47-1.04.18-.51.18-.95.13-1.04-.05-.09-.18-.15-.43-.27z"
      />
    </IconBase>
  )
}

export function FacebookIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path fill="#fff" d="M13.5 21v-6.8h2.3l.35-2.65h-2.65V9.7c0-.77.21-1.3 1.32-1.3h1.4V6.1c-.24-.03-1.07-.1-2.04-.1-2.02 0-3.4 1.23-3.4 3.5v1.95H8.2v2.65h2.28V21h3.02z" />
    </IconBase>
  )
}

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path fill="#4285F4" d="M21.6 12.23c0-.66-.06-1.3-.17-1.91H12v3.62h5.4a4.62 4.62 0 0 1-2 3.03v2.52h3.24c1.9-1.75 3-4.33 3-7.26z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.89 6.62-2.42l-3.24-2.52c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.41 13.9a6 6 0 0 1 0-3.8V7.51H3.06a10 10 0 0 0 0 8.98l3.35-2.59z" />
      <path fill="#EA4335" d="M12 6.18c1.47 0 2.79.5 3.82 1.49l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.51l3.35 2.59C7.2 7.94 9.4 6.18 12 6.18z" />
    </IconBase>
  )
}
