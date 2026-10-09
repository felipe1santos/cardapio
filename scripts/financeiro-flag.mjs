/**
 * Liga/desliga o módulo Financeiro de UMA loja, com o checklist do piloto antes (docs/financeiro/piloto-ponto400.md).
 *
 *   node scripts/financeiro-flag.mjs <slug-da-loja> on|off            → só mostra o checklist (não muda nada)
 *   node scripts/financeiro-flag.mjs <slug-da-loja> on|off --confirmar → muda a flag (com backup da linha antes)
 *
 * Banco: DATABASE_URL do ambiente ou do .env.local (o mesmo dos outros scripts de produção). Nunca imprime a URL.
 * Ligar com pendência é PERMITIDO (o dono decide), mas cada ⚠️ aparece antes e o backup fica em ~/menuzia-backups.
 * Desligar não apaga nada: livro-caixa e auditoria são imutáveis e voltam a aparecer se ligar de novo.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'

const [slug, modo, ...resto] = process.argv.slice(2)
const confirmar = resto.includes('--confirmar')
if (!slug || !['on', 'off'].includes(modo ?? '')) {
  console.error('uso: node scripts/financeiro-flag.mjs <slug-da-loja> on|off [--confirmar]')
  process.exit(2)
}
if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^DATABASE_URL=(.*)$/); if (m) process.env.DATABASE_URL = m[1].replace(/^"|"$/g, '') }
}
if (!process.env.DATABASE_URL) { console.error('Sem DATABASE_URL (ambiente ou .env.local).'); process.exit(2) }

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const brl = (c) => `R$ ${(Number(c) / 100).toFixed(2).replace('.', ',')}`

try {
  const loja = await um(`select id, nome, slug, financeiro_ativo from restaurantes where slug = $1`, [slug])
  if (!loja) { console.error(`Loja "${slug}" não encontrada.`); process.exitCode = 2; throw new Error('sem loja') }
  const L = loja.id
  console.log(`\nLoja: ${loja.nome} (${loja.slug}) — financeiro hoje: ${loja.financeiro_ativo ? 'LIGADO' : 'desligado'} → pedido: ${modo === 'on' ? 'LIGAR' : 'DESLIGAR'}\n`)
  const avisos = []
  const item = (ok, texto) => { console.log(`${ok ? '✅' : '⚠️ '} ${texto}`); if (!ok) avisos.push(texto) }

  // 1. gerente (ou outro aprovador) com PIN além do dono
  const equipe = await q(`select nome, papel, pin_hash is not null pin from usuarios where restaurante_id = $1 and desativado_em is null order by papel, nome`, [L])
  const aprovadores = equipe.filter((u) => u.papel !== 'dono' && u.pin && ['gerente'].includes(u.papel))
  item(aprovadores.length > 0, `Gerente com PIN além do dono: ${aprovadores.length ? aprovadores.map((u) => u.nome).join(', ') : 'NENHUM'} (equipe: ${equipe.map((u) => `${u.nome}/${u.papel}${u.pin ? '/PIN' : ''}`).join(', ')})`)
  // 2. contas (comandas) abertas
  const contas = await q(`select numero, tipo, cliente_nome, aberta_em, (select total from comanda_totais(c.id)) total from comandas c where restaurante_id = $1 and status = 'aberta' order by aberta_em`, [L])
  item(contas.length === 0, `Contas abertas: ${contas.length}${contas.length ? ' — ' + contas.map((c) => `#${c.numero} ${c.tipo} ${c.cliente_nome ?? ''} R$ ${c.total} desde ${new Date(c.aberta_em).toLocaleDateString('pt-BR')}`).join('; ') : ''}`)
  // 3. motoboys com dinheiro a acertar (livro-caixa) e entregas em rota
  const mot = await q(`select e.nome, sum(l.valor_centavos)::bigint s from fin_lancamentos l join entregadores e on e.id = l.entregador_id where l.restaurante_id = $1 and l.carteira = 'motoboy' group by 1 having sum(l.valor_centavos) <> 0`, [L])
  const emRota = await um(`select count(*)::int n from pedidos where restaurante_id = $1 and status = 'em_rota'`, [L])
  item(mot.length === 0 && emRota.n === 0, `Motoboys com dinheiro a acertar: ${mot.length ? mot.map((m) => `${m.nome} ${brl(m.s)}`).join(', ') : 'nenhum'} | entregas em rota agora: ${emRota.n}`)
  // 4. caixa aberto
  const cx = await um(`select aberto_em, aberto_por_nome from caixa_turnos where restaurante_id = $1 and fechado_em is null`, [L])
  item(!cx, `Caixa aberto: ${cx ? `SIM, por ${cx.aberto_por_nome} desde ${new Date(cx.aberto_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} — fechar antes de ${modo === 'on' ? 'ligar' : 'desligar'}` : 'não'}`)
  // 5. itens mais vendidos sem custo (sem ficha técnica com componentes)
  const top = await q(`select i.item_id, max(i.nome) nome, sum(i.quantidade)::int qtd from pedido_itens i join pedidos p on p.id = i.pedido_id
    where p.restaurante_id = $1 and p.status = 'entregue' and p.criado_em > now() - interval '30 days' and i.cancelado_em is null and i.item_id is not null
    group by 1 order by 3 desc limit 15`, [L])
  const comFicha = new Set((await q(`select distinct f.item_id from cmv_fichas f join cmv_ficha_componentes c on c.ficha_id = f.id where f.restaurante_id = $1 and f.item_id is not null`, [L])).map((r) => r.item_id))
  const semCusto = top.filter((t) => !comFicha.has(t.item_id))
  item(semCusto.length === 0, `Custo dos 15 mais vendidos (30 dias): ${top.length - semCusto.length}/${top.length} com ficha${semCusto.length ? ' — sem custo: ' + semCusto.map((t) => `${t.nome} (${t.qtd})`).join(', ') : ''}`)
  // 6. regras da loja
  const cfg = await um(`select limite_saida_centavos, limite_divergencia_centavos, tolerancia_fechamento_centavos, fundo_padrao_centavos, alerta_whatsapp from fin_config where restaurante_id = $1`, [L])
  item(!!cfg, cfg ? `Regras: saída sem PIN até ${brl(cfg.limite_saida_centavos)}, diferença com PIN acima de ${brl(cfg.limite_divergencia_centavos)}, fundo padrão ${cfg.fundo_padrao_centavos === null ? '—' : brl(cfg.fundo_padrao_centavos)}, WhatsApp de alertas ${cfg.alerta_whatsapp ? 'definido' : 'NÃO definido'}` : 'Regras (fin_config) ainda não existem: nascem com os padrões ao ligar (saída sem PIN até R$ 100,00; diferença com PIN acima de R$ 5,00) — definir fundo e WhatsApp de alertas')

  const alvo = modo === 'on'
  console.log(`\n${avisos.length ? `${avisos.length} pendência(s) acima (⚠️). ` : 'Checklist limpo. '}${loja.financeiro_ativo === alvo ? `A flag JÁ está ${alvo ? 'ligada' : 'desligada'}: nada a fazer.` : ''}`)
  if (loja.financeiro_ativo === alvo) throw new Error('nada a fazer')
  if (!confirmar) { console.log(`\nNada foi alterado. Para ${alvo ? 'LIGAR' : 'DESLIGAR'} de verdade: node scripts/financeiro-flag.mjs ${slug} ${modo} --confirmar\n`); throw new Error('sem confirmação') }

  const pasta = join(homedir(), 'menuzia-backups'); mkdirSync(pasta, { recursive: true })
  const arq = join(pasta, `financeiro-flag-${slug}-${Date.now()}.json`)
  writeFileSync(arq, JSON.stringify({ em: new Date().toISOString(), loja: { id: L, slug, financeiro_ativo: loja.financeiro_ativo }, pedido: modo, avisos }, null, 1))
  const r = await um(`update restaurantes set financeiro_ativo = $2 where id = $1 returning financeiro_ativo`, [L, alvo])
  // Auditoria depois da troca (se falhar, a troca vale e o aviso aparece aqui).
  await db.query(`insert into eventos_auditoria (restaurante_id, ator, usuario_nome, acao, entidade, entidade_id, dados) values ($1, 'sistema', 'Suporte Menuzia', $2, 'restaurante', $1, $3::jsonb)`,
    [L, alvo ? 'financeiro.ligou' : 'financeiro.desligou', JSON.stringify({ resumo: alvo ? 'Financeiro ligado (script)' : 'Financeiro desligado (script)', avisos })]).catch((e) => { console.log(`(auditoria não registrada: ${e.message.slice(0, 80)})`) })
  console.log(`\n✅ Financeiro ${r.financeiro_ativo ? 'LIGADO' : 'DESLIGADO'} em ${slug}. Backup: ${arq}`)
  if (alvo) console.log('Próximos passos: a equipe sai e entra de novo no painel (aparelho do caixa COM SENHA); o gerente abre o caixa com o fundo contado.')
} catch (e) {
  if (!['sem confirmação', 'nada a fazer', 'sem loja'].includes(e.message)) { console.error('ERRO:', e.message); process.exitCode = 1 }
} finally {
  await db.end()
}
