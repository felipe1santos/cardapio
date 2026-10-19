// Bloco A (19/10): tira os blocos "PEDIDO ALTERADO (…)" colados na observação dos pedidos de TESTE da Menuzia.
// SÓ loja menuzia. observacao_original (0200) era '' em todos — a observação volta a ser só o que o cliente escreveu.
//   node .medidas/limpar-observacao-edicao.mjs          (ensaio: só mostra)
//   APLICAR=1 node .medidas/limpar-observacao-edicao.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: loja } = await admin.from('restaurantes').select('id, slug').eq('slug', 'menuzia').single()
if (loja?.slug !== 'menuzia') throw new Error('loja errada')
const { data: ps } = await admin.from('pedidos').select('id, numero, observacao, observacao_original').eq('restaurante_id', loja.id).not('editado_em', 'is', null).ilike('observacao', 'PEDIDO ALTERADO%')
console.log('pedidos com bloco na observação:', ps.map((p) => '#' + p.numero).join(' '))
for (const p of ps) {
  const limpa = String(p.observacao).split(' | ').filter((t) => !t.startsWith('PEDIDO ALTERADO (')).join(' | ')
  const nova = (p.observacao_original ?? '').trim() || limpa
  console.log(`#${p.numero}: "${String(p.observacao).slice(0, 50)}…" → "${nova}"`)
  if (process.env.APLICAR === '1') {
    const { error } = await admin.from('pedidos').update({ observacao: nova, observacao_original: null }).eq('id', p.id).eq('restaurante_id', loja.id)
    if (error) console.log('ERRO', error.message)
  }
}
console.log(process.env.APLICAR === '1' ? 'aplicado' : 'ensaio (APLICAR=1 para gravar)')
