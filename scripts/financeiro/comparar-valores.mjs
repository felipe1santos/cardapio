/**
 * Compara os valores exibidos antes × depois do redesign (item 4b). O redesign é só visual:
 *  - todo "R$ …" e "%" que aparecia antes tem que continuar aparecendo (o depois pode ter A MAIS:
 *    eixos dos gráficos novos e a variação ▲▼ dos indicadores);
 *  - os data-valor têm que ser idênticos.
 *   node scripts/financeiro/comparar-valores.mjs
 */
import { readFileSync } from 'node:fs'
const ler = (r) => JSON.parse(readFileSync(`docs/financeiro-redesign/${r}/valores-${r}.json`, 'utf8')).telas
const A = ler('antes'), D = ler('depois')
const multiset = (l) => l.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())
let falhas = 0, telas = 0
for (const [tela, a] of Object.entries(A)) {
  if (!a.valores) continue
  telas++
  const av = a.valores
  const d = D[tela]?.valores
  if (!d) { console.log(`❌ ${tela}: não capturada no depois`); falhas++; continue }
  const faltam = []
  for (const k of ['dinheiro', 'pct']) {
    const md = multiset(d[k])
    for (const [v, n] of multiset(av[k])) if ((md.get(v) ?? 0) < n) faltam.push(`${v} (${n} antes, ${md.get(v) ?? 0} depois)`)
  }
  const dvIgual = av.dataValor.every((x) => d.dataValor.includes(x))
  if (faltam.length || !dvIgual) { falhas++; console.log(`❌ ${tela}: ${faltam.slice(0, 6).join(' · ')}${dvIgual ? '' : ` · data-valor diferente`}`) }
  else console.log(`✅ ${tela}: ${av.dinheiro.length} valores em R$, ${av.pct.length} %, ${av.dataValor.length} data-valor — iguais${d.dinheiro.length > av.dinheiro.length ? ` (+${d.dinheiro.length - av.dinheiro.length} novos nos gráficos)` : ''}`)
}
console.log(`\n${telas - falhas}/${telas} telas com os mesmos valores`)
process.exit(falhas ? 1 : 0)
