/**
 * Gera components/icones/material.tsx com os ícones Material PREENCHIDOS usados nos submenus
 * internos (modelo do dono, 2026-10-06). Fonte: @material-design-icons/svg/filled (Apache 2.0).
 * Só os nomes listados entram no módulo — nada é carregado em tempo de execução.
 *   node scripts/icones/gerar-material.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
const NOMES = ['store', 'delivery_dining', 'table_restaurant', 'qr_code_2', 'manage_accounts', 'chat', 'description', 'notifications', 'smart_toy',
  'dashboard', 'campaign', 'schedule', 'loyalty', 'local_offer', 'point_of_sale', 'swap_vert', 'two_wheeler', 'pix', 'sync_alt', 'calculate',
  'receipt_long', 'insights', 'policy', 'person_search', 'rule', 'lightbulb']
const linhas = NOMES.map((n) => {
  const svg = readFileSync(`node_modules/@material-design-icons/svg/filled/${n}.svg`, 'utf8')
  const corpo = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim()
  return `  ${n}: ${JSON.stringify(corpo)},`
})
writeFileSync('components/icones/material.tsx', `// Gerado por scripts/icones/gerar-material.mjs — ícones Material preenchidos (Apache 2.0). Não editar à mão.

const ICONES = {
${linhas.join('\n')}
} as const

export type NomeIconeMaterial = keyof typeof ICONES

/** Ícone Material preenchido (cor do texto, 20px por padrão), como no submenu-modelo do dono. */
export function IconeMaterial({ nome, className = 'h-[20px] w-[20px]' }: { nome: NomeIconeMaterial; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className} dangerouslySetInnerHTML={{ __html: ICONES[nome] }} />
}
`)
console.log('ok', NOMES.length)
