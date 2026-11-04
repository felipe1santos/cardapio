/**
 * Teste REAL dos disparos (v2) com UM número só — nunca o público da loja.
 * Cria uma rodada no card Promoções da loja com um único destinatário; o cron de produção envia (janela 09:00–21:30,
 * mesmo caminho das rodadas: imagem, {nome}, {loja}, link rastreável, rodapé SAIR, intervalo e cota do aquecimento).
 *
 *   node scripts/seguranca/teste-disparo-real.mjs criar  <slug> <telefone 55DDDNUMERO> --confirmar-producao
 *   node scripts/seguranca/teste-disparo-real.mjs status <slug>
 *   node scripts/seguranca/teste-disparo-real.mjs limpar <slug> --confirmar-producao
 *
 * Só mexe em campanhas com nome começando por "TESTE Disparos v2". Não mostra o telefone inteiro na saída.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [acao, slug, telefone] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const confirmou = process.argv.includes('--confirmar-producao')
const PREFIXO = 'TESTE Disparos v2'
if (!['criar', 'status', 'limpar', 'conferir'].includes(acao) || !slug) { console.error('uso: criar|status|limpar <slug> [telefone] [--confirmar-producao]'); process.exit(1) }
if (!['status', 'conferir'].includes(acao) && !confirmou) { console.error('❌ sem --confirmar-producao'); process.exit(1) }
for (const l of readFileSync(join(raiz, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = l.trim(); const eq = t.indexOf('=')
  if (!t || t.startsWith('#') || eq < 0) continue
  const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (!(k in process.env)) process.env[k] = v
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const um = async (s, p = []) => (await c.query(s, p)).rows[0]
const mascara = (t) => (t ? `${String(t).slice(0, 4)}…${String(t).slice(-2)}` : '—')

const loja = await um(`select id, nome, whatsapp_estado, disparo_proximo_em from restaurantes where slug=$1`, [slug])
if (!loja) { console.error('❌ loja não encontrada'); await c.end(); process.exit(1) }
console.log(`loja ${loja.nome} · WhatsApp: ${loja.whatsapp_estado ?? '—'}`)

if (acao === 'criar') {
  const tel = String(telefone ?? '').replace(/\D/g, '')
  // Números de exemplo (documentação / conversa) nunca: podem ser de um desconhecido.
  if (['5511987654321', '5511999999999', '5511912345678'].includes(tel)) { console.error('❌ esse é um número de EXEMPLO, não o seu'); await c.end(); process.exit(1) }
  if (!/^55\d{10,11}$/.test(tel)) { console.error('❌ telefone: use 55 + DDD + número (só dígitos)'); await c.end(); process.exit(1) }
  const card = await um(`select id from campanha_recorrentes where restaurante_id=$1 and tipo='promocoes'`, [loja.id])
  if (!card) { console.error('❌ card Promoções não existe nessa loja (abra a aba Campanhas uma vez)'); await c.end(); process.exit(1) }
  const aberta = await um(`select id from campanhas where restaurante_id=$1 and nome like $2 and status in ('agendada','enviando')`, [loja.id, `${PREFIXO}%`])
  if (aberta) { console.error('❌ já existe um teste em andamento; rode "status" ou "limpar"'); await c.end(); process.exit(1) }
  await c.query('begin')
  const camp = await um(`insert into campanhas (restaurante_id, nome, status, tipo_mensagem, mensagem, imagem_url, filtro, agendado_em,
      janela_inicio, janela_fim, incluir_link, incluir_descadastro, recorrente_id, total_destinatarios)
    values ($1, $2, 'agendada', 'imagem', $3, $4, '{"tipo":"teste"}'::jsonb, now(), time '09:00', time '21:30', true, true, $5, 1) returning id`,
  [loja.id, `${PREFIXO} · ${new Date().toLocaleDateString('pt-BR')}`,
    'Oi {nome}! 👋 Isto é um *teste* dos _disparos_ da {loja}.\nPromoção de teste: confira no cardápio {link_cardapio}',
    'https://app.menuzia.com.br/ilustracoes/campanhas/promocoes.jpg', card.id])
  await c.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente) values ($1,$2,$3,'Teste')`, [camp.id, loja.id, tel])
  await c.query('commit')
  console.log(`✅ teste criado (campanha ${camp.id.slice(0, 8)}) para ${mascara(tel)}. O cron envia no próximo minuto, se dentro de 09:00–21:30.`)
}

if (acao === 'status' || acao === 'criar') {
  const r = await c.query(`select c.id, c.status, c.pausa_motivo, e.status as envio, e.erro, e.enviado_em, e.telefone
      from campanhas c join campanha_envios e on e.campanha_id = c.id
     where c.restaurante_id=$1 and c.nome like $2 order by c.criado_em desc limit 5`, [loja.id, `${PREFIXO}%`])
  for (const x of r.rows) console.log(`   campanha ${x.id.slice(0, 8)} ${x.status}${x.pausa_motivo ? ` (${x.pausa_motivo})` : ''} · envio ${x.envio}${x.erro ? ` — ${x.erro}` : ''}${x.enviado_em ? ` · ${new Date(x.enviado_em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''} · ${mascara(x.telefone)}`)
  if (!r.rows.length) console.log('   nenhum teste')
}

if (acao === 'conferir') {
  // Saiu mensagem de teste nos últimos 30 min? (registro do WhatsApp; a fila some quando o teste é apagado)
  const tel = String(telefone ?? '').replace(/\D/g, '')
  const fim = tel.slice(-8)
  const m = await um(`select count(*)::int n, max(m.criado_em) ult from whatsapp_mensagens m join whatsapp_conversas cv on cv.id = m.conversa_id
     where m.restaurante_id=$1 and m.direcao <> 'entrada' and m.criado_em > now() - interval '30 minutes'
       and right(regexp_replace(cv.telefone, '\\D', '', 'g'), 8) = $2 and m.texto ilike '%dos _disparos_%'`, [loja.id, fim])
  const e = await um(`select count(*)::int n from whatsapp_envios where restaurante_id=$1 and criado_em > now() - interval '30 minutes'
       and right(regexp_replace(telefone, '\\D', '', 'g'), 8) = $2 and texto ilike '%dos _disparos_%'`, [loja.id, fim])
  console.log(`   mensagens de teste para ${mascara(tel)} nos últimos 30 min: conversa ${m.n}, fila do WhatsApp ${e.n}`)
  console.log(`   loja: próxima mensagem de campanha liberada em ${loja.disparo_proximo_em ? new Date(loja.disparo_proximo_em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'} (se for daqui a 1–2,5 min, algo saiu agora há pouco)`)
  // Histórico das últimas 3 h para esse número: o que saiu, status de entrega (ack do WhatsApp) e erro.
  const hist = await c.query(`select m.criado_em, m.direcao, m.origem, m.tipo, m.status_envio, m.erro, left(m.wa_id, 6) as wa, left(replace(m.texto, E'\\n', ' '), 50) as texto,
         right(cv.telefone, 4) as fim_conversa, length(regexp_replace(cv.telefone, '\\D', '', 'g')) as digitos
       from whatsapp_mensagens m join whatsapp_conversas cv on cv.id = m.conversa_id
      where m.restaurante_id=$1 and m.criado_em > now() - interval '3 hours' and right(regexp_replace(cv.telefone, '\\D', '', 'g'), 8) = $2
      order by m.criado_em desc limit 6`, [loja.id, fim])
  for (const h of hist.rows) console.log(`   ${new Date(h.criado_em).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })} ${h.direcao}/${h.origem ?? '-'} ${h.tipo} · status ${h.status_envio ?? '—'}${h.erro ? ` · erro ${h.erro}` : ''} · id ${h.wa ?? '—'} · conversa …${h.fim_conversa} (${h.digitos} dígitos) · "${h.texto ?? ''}"`)
  if (!hist.rows.length) console.log('   nenhuma mensagem com esse número nas últimas 3 h')
  // O número que leu o QR é o próprio número da loja? (mensagem para si mesmo não aparece como recebida)
  const proprio = await um(`select count(*)::int n from whatsapp_mensagens m join whatsapp_conversas cv on cv.id = m.conversa_id
      where m.restaurante_id=$1 and m.direcao = 'entrada' and right(regexp_replace(cv.telefone, '\\D', '', 'g'), 8) = $2`, [loja.id, fim])
  console.log(`   esse número já MANDOU mensagem para a loja alguma vez? ${proprio.n > 0 ? `sim (${proprio.n})` : 'não'}`)
}

if (acao === 'limpar') {
  const r = await c.query(`delete from campanhas where restaurante_id=$1 and nome like $2 returning id`, [loja.id, `${PREFIXO}%`])
  console.log(`🧹 ${r.rowCount} campanha(s) de teste apagada(s)`)
}
await c.end()
