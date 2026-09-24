/**
 * Capacete de motoboy no desenho da lucide (24×24, traço 2, pontas arredondadas).
 * A lucide não tem capacete de moto — só `HardHat`, que é de obra —, então este
 * segue o mesmo padrão para conviver com os outros ícones das telas. Marca a
 * ENTREGA e a Logística no painel. (O menu lateral usa o conjunto Material:
 * ver `ICONES.capacete` em lib/icones-painel.ts.)
 */
export function Capacete({ className = 'h-4 w-4', strokeWidth = 2, ...props }: React.SVGProps<SVGSVGElement> & { strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M3 16.5V15a9 9 0 0 1 17.6-2.7" />
      <path d="M21 12.5h-7.5a2 2 0 0 0-2 2v.5a2 2 0 0 0 2 2H21" />
      <path d="M3 16.5a2.5 2.5 0 0 0 2.5 2.5H18a3 3 0 0 0 3-3v-3.5" />
      <path d="M8 7.5l3.5 1.5" />
    </svg>
  )
}
