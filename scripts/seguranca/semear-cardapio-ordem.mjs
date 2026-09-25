/**
 * Semente da loja ISOLADA da prova de ordem do cardápio, favoritos e QR (0101).
 *
 * Cria (ou recria) só as lojas `ordem-qr-e2e` e `ordem-qr-vizinha` e os usuários
 * `*.ordemqr`. Nunca toca a cantina-demo, a vizinha-demo nem outra loja: tudo o que apaga
 * é filtrado pelo id dessas duas lojas. Só loopback.
 *
 * Fotos de teste (vertical, horizontal e quadrada) são desenhadas num canvas pelo próprio
 * Chromium e sobem para o Storage local, na pasta da loja.
 *
 *   node scripts/seguranca/semear-cardapio-ordem.mjs
 */

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

export const LOJA = 'ordem-qr-e2e'
export const VIZINHA = 'ordem-qr-vizinha'
export const SENHA = 'demo-local-123456'
export const USUARIOS = {
  dono: 'dono.ordemqr',
  gerente: 'gerente.ordemqr',
  garcom: 'garcom.ordemqr',
  atendente: 'atendente.ordemqr',
  donoVizinha: 'dono.vizinha.ordemqr',
}

const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, API_URL)

export async function semear() {
  const db = new pg.Client({ connectionString: DB_URL })
  await db.connect()
  const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

  async function loja(slug, nome) {
    const id = (await db.query(
      `insert into restaurantes (nome, slug, status_loja, modulo_mesas_ativo, aceita_retirada, cor_tema, layout_cardapio)
       values ($1, $2, 'aberto_manual', true, true, 'ciano', 'lista')
       on conflict (slug) do update set nome = excluded.nome, modulo_mesas_ativo = true, status_loja = 'aberto_manual', layout_cardapio = 'lista'
       returning id`, [nome, slug])).rows[0].id
    await db.query(`update restaurantes set mesa_somente_visualizacao = false, mesa_carrossel_urls = '{}', mesa_mensagem_selecao = null,
      taxa_servico_padrao = 10, formas_pagamento_mesa = array['dinheiro','pix','credito','debito'] where id = $1`, [id])
    return id
  }
  const lojaId = await loja(LOJA, 'Ordem QR E2E')
  const vizinhaId = await loja(VIZINHA, 'Ordem QR Vizinha')
  for (const id of [lojaId, vizinhaId]) {
    // Ordem das deleções: filhos antes dos pais. Tudo preso a ESTAS duas lojas.
    await db.query(`delete from pedido_itens where pedido_id in (select id from pedidos where restaurante_id = $1)`, [id])
    await db.query(`delete from pedidos where restaurante_id = $1`, [id])
    await db.query(`delete from comandas where restaurante_id = $1`, [id])
    await db.query(`delete from selecoes_mesa where restaurante_id = $1`, [id]).catch(() => {})
    await db.query(`delete from sessoes_mesa where restaurante_id = $1`, [id]).catch(() => {})
    await db.query(`delete from mesas where restaurante_id = $1`, [id])
    await db.query(`delete from itens_cardapio where restaurante_id = $1`, [id])
    await db.query(`delete from grupos_cardapio where restaurante_id = $1`, [id])
  }

  async function usuario(email, login, papel, nome, restaurante) {
    let uid
    const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
    if (error && !/already/i.test(error.message)) throw error
    uid = data?.user?.id
    if (!uid) {
      const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 })
      uid = lista.users.find((u) => u.email === email).id
      await admin.auth.admin.updateUserById(uid, { password: SENHA })
    }
    await db.query(
      `insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado)
       values ($1, $2, $3::papel_usuario, $4, $5, $6, true)
       on conflict (id) do update set restaurante_id = excluded.restaurante_id, papel = excluded.papel,
         autorizado = true, desativado_em = null, usuario = excluded.usuario, nome = excluded.nome`,
      [uid, restaurante, papel, nome, email, login])
    return uid
  }
  await usuario('dono@ordemqr.local', USUARIOS.dono, 'dono', 'Dono Ordem', lojaId)
  await usuario('gerente@ordemqr.local', USUARIOS.gerente, 'gerente', 'Gerente Ordem', lojaId)
  await usuario('garcom@ordemqr.local', USUARIOS.garcom, 'garcom', 'Garçom Ordem', lojaId)
  await usuario('atendente@ordemqr.local', USUARIOS.atendente, 'atendente', 'Atendente Ordem', lojaId)
  await usuario('dono@vizinha-ordemqr.local', USUARIOS.donoVizinha, 'dono', 'Dono Vizinha', vizinhaId)

  // ── fotos de teste: vertical, horizontal e quadrada ─────────────────────────
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const fotos = {}
  for (const [nome, w, h, cor] of [['vertical', 600, 900, '#7C3AED'], ['horizontal', 1200, 800, '#0688D4'], ['quadrada', 800, 800, '#16A34A']]) {
    const base64 = await page.evaluate(({ w, h, cor, nome }) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')
      const grad = g.createLinearGradient(0, 0, w, h)
      grad.addColorStop(0, cor)
      grad.addColorStop(1, '#111827')
      g.fillStyle = grad
      g.fillRect(0, 0, w, h)
      g.strokeStyle = '#FFFFFF'
      g.lineWidth = 12
      g.strokeRect(6, 6, w - 12, h - 12)
      g.fillStyle = '#FFFFFF'
      g.font = `bold ${Math.round(w / 9)}px sans-serif`
      g.textAlign = 'center'
      g.fillText(nome.toUpperCase(), w / 2, h / 2)
      g.font = `${Math.round(w / 18)}px sans-serif`
      g.fillText(`${w}×${h}`, w / 2, h / 2 + w / 9)
      return c.toDataURL('image/png').split(',')[1]
    }, { w, h, cor, nome })
    const caminho = `${lojaId}/ordem-e2e/${nome}.png`
    const { error } = await admin.storage.from('cardapio').upload(caminho, Buffer.from(base64, 'base64'), { contentType: 'image/png', upsert: true })
    if (error) throw error
    fotos[nome] = admin.storage.from('cardapio').getPublicUrl(caminho).data.publicUrl
  }
  await browser.close()

  // ── cardápio: criado em sequência (criado_em crescente), sem posição — o gatilho da
  // 0101 põe cada item no fim da categoria ──────────────────────────────────────────
  const categoria = async (restaurante, nome) =>
    (await db.query(`insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1, $2, 0) returning id`, [restaurante, nome])).rows[0].id
  const item = async (restaurante, grupo, nome, preco, extra = {}) => {
    await new Promise((r) => setTimeout(r, 15)) // criado_em distinto e crescente
    return (await db.query(
      `insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, descricao, imagem_url, status, mais_vendido, promocao_preco, tag)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [restaurante, grupo, nome, preco, extra.descricao ?? '', extra.foto ?? null, extra.status ?? 'disponivel',
        extra.favorito ?? false, extra.promo ?? null, extra.tag ?? null])).rows[0].id
  }

  const lanches = await categoria(lojaId, 'Lanches')
  const bebidas = await categoria(lojaId, 'Bebidas')
  const sobremesas = await categoria(lojaId, 'Sobremesas')

  const xburger = await item(lojaId, lanches, 'X-Burger', 32, { descricao: 'Pão brioche, blend 160 g, queijo e molho da casa.', foto: fotos.horizontal, favorito: true })
  await item(lojaId, lanches, 'X-Salada', 30, { descricao: 'Blend, queijo, alface, tomate.', foto: fotos.quadrada, promo: 25 })
  await item(lojaId, lanches, 'Lanche Pausado', 20, { status: 'pausado' })
  await item(lojaId, lanches,
    'Sanduíche Artesanal Especial da Casa com Nome Muito Comprido Para Testar Quebra de Linha',
    41.5,
    { descricao: 'Descrição longa: ' + 'pão de fermentação natural, queijo curado, cebola caramelizada, rúcula fresca, tomate confit e maionese de ervas. '.repeat(4) })

  await item(lojaId, bebidas, 'Coca Lata 350 ml', 7, { foto: fotos.vertical })
  await item(lojaId, bebidas, 'Coca 1,5 L', 14, { descricao: 'Garrafa para a mesa.' })
  await item(lojaId, bebidas, 'Água sem gás', 5, { descricao: 'Sem foto: mostra o ícone.' })

  await item(lojaId, sobremesas, 'Pudim', 12, { foto: fotos.quadrada, favorito: true, tag: 'novo' })

  // X-Burger: uma etapa obrigatória e muitos adicionais (lista longa no QR ativo).
  const etapa = async (itemId, nome, obrigatorio, min, max, posicao, opcoes) => {
    const g = (await db.query(
      `insert into grupos_item_complementos (item_id, nome, obrigatorio, min_escolhas, max_escolhas, posicao) values ($1,$2,$3,$4,$5,$6) returning id`,
      [itemId, nome, obrigatorio, min, max, posicao])).rows[0].id
    for (const [i, [n, p]] of opcoes.entries()) {
      await db.query(`insert into item_complementos (item_id, grupo_id, nome, preco, posicao) values ($1,$2,$3,$4,$5)`, [itemId, g, n, p, i])
    }
  }
  await etapa(xburger, 'Ponto da carne', true, 1, 1, 0, [['Mal passado', 0], ['Ao ponto', 0], ['Bem passado', 0]])
  await etapa(xburger, 'Adicionais', false, 0, 12, 1,
    [['Bacon', 5], ['Cheddar', 4], ['Ovo', 3], ['Cebola crispy', 4], ['Picles', 2], ['Jalapeño', 3], ['Catupiry', 5],
      ['Queijo prato extra', 4], ['Blend extra', 12], ['Molho barbecue', 2], ['Alface', 0], ['Tomate', 0]])

  // Vizinha: uma categoria e um item, para os testes de isolamento.
  const vizCat = await categoria(vizinhaId, 'Pratos')
  await item(vizinhaId, vizCat, 'Prato da Vizinha', 50)
  await item(vizinhaId, vizCat, 'Outro da Vizinha', 40)

  const mesa = (await db.query(`insert into mesas (restaurante_id, nome, ordem, setor, capacidade) values ($1, 'Mesa 1', 0, 'Salão', 4) returning id, token`, [lojaId])).rows[0]
  await db.query(`insert into mesas (restaurante_id, nome, ordem, setor, capacidade) values ($1, 'Mesa V1', 0, 'Salão', 2)`, [vizinhaId])

  await db.end()
  return { lojaId, vizinhaId, mesa, fotos }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('semear-cardapio-ordem.mjs')) {
  const r = await semear()
  console.log(`✅ loja ${LOJA} (${r.lojaId}) e ${VIZINHA} semeadas; mesa ${r.mesa.id}`)
  console.log(`   usuários: ${Object.values(USUARIOS).join(', ')} · senha ${SENHA}`)
}
