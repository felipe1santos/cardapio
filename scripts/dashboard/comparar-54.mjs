/** Compara os valores das análises do Dashboard antes × depois (item 54): tudo o que aparecia antes tem que aparecer depois. */
import { readFileSync } from 'node:fs'
const ler = (r) => JSON.parse(readFileSync(`docs/dashboard-54/${r}/valores-${r}.json`, 'utf8')).telas
const A = ler('antes'), D = ler('depois')
const ms = (l) => l.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())
let falhas = 0
for (const disp of ['desktop', 'celular']) {
  const a = A[`analises@${disp}`].valores, d = D[`analises@${disp}`].valores
  for (const k of ['dinheiro', 'pct', 'celulas', 'numeros']) {
    const md = ms(d[k]); const faltam = []
    for (const [v, n] of ms(a[k])) if ((md.get(v) ?? 0) < n) faltam.push(`${v} (${n}→${md.get(v) ?? 0})`)
    console.log(`${faltam.length ? '❌' : '✅'} ${disp} ${k}: ${a[k].length} antes, ${d[k].length} depois${faltam.length ? ' — faltam: ' + faltam.slice(0, 8).join(', ') : ''}`)
    if (faltam.length) falhas++
  }
}
process.exit(falhas ? 1 : 0)
