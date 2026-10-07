/**
 * Gera as ilustrações de status do pedido (item 57, 2026-10-06) no MESMO estilo das três do dono
 * (pedidos-vazio, saiu-para-entrega, cupons-vazio): mancha cinza-clara de fundo, nuvens brancas, traço
 * escuro arredondado, amarelo e vermelho chapados, tracejado e risquinhos de movimento. Quadradas.
 *   node scripts/vitrine/ilustracoes-status.mjs   → public/vitrine/ilustracoes/status-*.svg
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const T = '#262626' // traço
const AM = '#F7C23C' // amarelo
const AM2 = '#E9A91A' // amarelo sombra
const VM = '#E8231F' // vermelho
const VM2 = '#B9180F'
const CZ = '#EFEFEF' // mancha
const CZ2 = '#DADADA'
const BR = '#FFFFFF'
const tr = `stroke="${T}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"`
const fino = `stroke="${T}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"`

const fundo = `
  <path d="M300 78c112-4 214 46 246 140 34 100-6 214-104 262-92 46-224 52-314 6C42 438 22 334 56 244 92 150 188 82 300 78z" fill="${CZ}"/>
  <path d="M96 196h120a22 22 0 0 0-18-38 34 34 0 0 0-64-4 26 26 0 0 0-38 42z" fill="${BR}"/>
  <path d="M400 142h104a20 20 0 0 0-16-34 30 30 0 0 0-56-4 24 24 0 0 0-32 38z" fill="${BR}"/>
  <path d="M432 268h88a18 18 0 0 0-14-30 26 26 0 0 0-48-4 20 20 0 0 0-26 34z" fill="${BR}"/>
  <ellipse cx="300" cy="500" rx="190" ry="16" fill="${CZ2}" opacity=".7"/>`
const brilho = (x, y, r = 1) => `<g ${fino} fill="none" transform="translate(${x} ${y}) scale(${r})"><path d="M0-34v-18"/><path d="M-26-22l-12-12"/><path d="M26-22l12-12"/></g>`
const svg = (nome, corpo) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="${nome}">${fundo}${corpo}</svg>\n`

const check = (cx, cy, r, cor = AM) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${cor}" ${tr}/><path d="M${cx - r * 0.42} ${cy + r * 0.02}l${r * 0.3} ${r * 0.3} ${r * 0.56}-${r * 0.6}" fill="none" stroke="${T}" stroke-width="${Math.max(6, r * 0.16)}" stroke-linecap="round" stroke-linejoin="round"/>`

const ilustracoes = {
  // Pedido recebido: celular com o pedido confirmado e um balão de notificação.
  'status-recebido': svg('Pedido recebido', `
  <path d="M120 300c40-60 70-80 110-92" fill="none" ${fino} stroke-dasharray="10 12"/>
  <rect x="200" y="140" width="190" height="330" rx="30" fill="${BR}" ${tr}/>
  <rect x="222" y="178" width="146" height="248" rx="10" fill="#F6F6F6" ${fino}/>
  <path d="M270 160h50" ${fino}/>
  ${check(295, 262, 40)}
  <path d="M248 334h94M258 360h74M266 386h58" stroke="#9A9A9A" stroke-width="4" stroke-linecap="round"/>
  <path d="M368 128c0-26 22-46 50-46s50 20 50 46-22 46-50 46c-8 0-16-2-22-5l-26 12 8-24c-6-8-10-18-10-29z" fill="${AM}" ${tr}/>
  <path d="M408 114l12-8v44" fill="none" stroke="${T}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  ${brilho(470, 230, 0.9)}
  <path d="M140 420h36M120 444h56" stroke="#BDBDBD" stroke-width="4" stroke-linecap="round"/>`),

  // Preparando: panela no fogo, com vapor e a colher de pau.
  'status-preparando': svg('Preparando seu pedido', `
  <path d="M250 150c-14 18 14 30 0 48s14 30 0 48" fill="none" ${tr}/>
  <path d="M300 128c-14 18 14 30 0 48s14 30 0 48" fill="none" ${tr}/>
  <path d="M350 150c-14 18 14 30 0 48s14 30 0 48" fill="none" ${tr}/>
  <path d="M346 286l72-112" ${tr}/><ellipse cx="426" cy="160" rx="14" ry="22" transform="rotate(33 426 160)" fill="${AM}" ${tr}/>
  <path d="M176 296h248v92c0 40-30 64-70 64H246c-40 0-70-24-70-64z" fill="${VM}" ${tr}/>
  <path d="M196 336c8 52 40 82 90 84" fill="none" stroke="${VM2}" stroke-width="10" stroke-linecap="round" opacity=".55"/>
  <path d="M160 296h280" ${tr}/>
  <path d="M176 320h-34a14 14 0 0 1 0-28h34M424 320h34a14 14 0 0 0 0-28h-34" fill="none" ${tr}/>
  <rect x="218" y="276" width="164" height="20" rx="10" fill="${AM}" ${tr}/>
  <path d="M248 474c-6-22 14-26 10-44 18 10 26 26 18 44zM296 476c-8-30 18-36 12-60 26 16 34 38 22 60zM346 474c-6-22 14-26 10-44 18 10 26 26 18 44z" fill="${AM}" ${fino}/>
  <path d="M200 482h200" ${tr}/>
  ${brilho(120, 290, 0.8)}
  <path d="M470 352h40M480 376h30" stroke="#BDBDBD" stroke-width="4" stroke-linecap="round"/>`),

  // Pronto para despacho: sacola fechada com selo, esperando o entregador (tracejado até o pino).
  'status-pronto': svg('Pronto para despacho', `
  <path d="M370 230c50-10 80-40 96-80" fill="none" ${fino} stroke-dasharray="10 12"/>
  <path d="M466 92c-18 0-32 14-32 31 0 24 32 55 32 55s32-31 32-55c0-17-14-31-32-31z" fill="${AM}" ${tr}/><circle cx="466" cy="122" r="10" fill="${BR}" ${fino}/>
  <path d="M190 250h220l-18 226H208z" fill="${AM}" ${tr}/>
  <path d="M206 262l14 200" stroke="${AM2}" stroke-width="14" stroke-linecap="round" opacity=".6"/>
  <path d="M250 250v-28a50 50 0 0 1 100 0v28" fill="none" ${tr}/>
  <path d="M190 250l30-34h160l30 34" fill="${AM}" ${tr}/>
  ${check(300, 360, 46, VM)}
  <path d="M286 362" />
  ${brilho(170, 230, 0.9)}
  <path d="M96 404h56M110 430h40" stroke="#BDBDBD" stroke-width="4" stroke-linecap="round"/>`),

  // Retirada pronta: sacola no balcão e a campainha tocando.
  'status-retirada': svg('Pronto para retirada', `
  <path d="M80 446h440" ${tr}/>
  <rect x="96" y="446" width="408" height="26" rx="6" fill="${BR}" ${tr}/>
  <path d="M150 300h170l-14 146H164z" fill="${AM}" ${tr}/>
  <path d="M196 300v-22a40 40 0 0 1 80 0v22" fill="none" ${tr}/>
  ${check(235, 376, 34, VM)}
  <path d="M370 432a62 62 0 0 1 124 0z" fill="${AM}" ${tr}/>
  <path d="M356 432h152" ${tr}/>
  <path d="M432 370v-14M420 352h24" ${tr}/>
  <path d="M392 404c6-14 16-22 28-26" fill="none" stroke="${BR}" stroke-width="8" stroke-linecap="round"/>
  <g ${fino} fill="none"><path d="M396 330l-14-18"/><path d="M432 316v-22"/><path d="M468 330l14-18"/></g>
  <path d="M120 250c30-40 70-56 110-60" fill="none" ${fino} stroke-dasharray="10 12"/>`),

  // Entregue: porta de casa com a sacola deixada e o selo de concluído.
  'status-entregue': svg('Pedido entregue', `
  <path d="M150 260l150-110 150 110" fill="${VM}" ${tr}/>
  <path d="M176 248v222h248V248" fill="${BR}" ${tr}/>
  <rect x="256" y="330" width="88" height="140" rx="6" fill="${AM}" ${tr}/>
  <circle cx="328" cy="404" r="6" fill="${T}"/>
  <rect x="196" y="284" width="44" height="44" rx="4" fill="#F6F6F6" ${fino}/><path d="M218 284v44M196 306h44" ${fino}/>
  <rect x="360" y="284" width="44" height="44" rx="4" fill="#F6F6F6" ${fino}/><path d="M382 284v44M360 306h44" ${fino}/>
  <path d="M354 470l8-62h56l8 62z" fill="${VM}" ${tr}/><path d="M374 408v-10a16 16 0 0 1 32 0v10" fill="none" ${fino}/>
  ${check(456, 196, 46)}
  ${brilho(456, 136, 0.8)}
  <path d="M90 420h50M100 446h40" stroke="#BDBDBD" stroke-width="4" stroke-linecap="round"/>`),

  // Cancelado: comanda com o X vermelho.
  'status-cancelado': svg('Pedido cancelado', `
  <path d="M206 140h190v320l-24-16-24 16-24-16-24 16-24-16-24 16-24-16-22 16z" fill="${BR}" ${tr}/>
  <path d="M236 196h130M236 232h100M236 268h120M236 304h80" stroke="#9A9A9A" stroke-width="4" stroke-linecap="round"/>
  <path d="M236 352h60M330 352h36" ${fino}/>
  <circle cx="404" cy="380" r="56" fill="${VM}" ${tr}/>
  <path d="M384 360l40 40M424 360l-40 40" stroke="${BR}" stroke-width="12" stroke-linecap="round"/>
  <path d="M150 220c-30 30-40 70-30 110" fill="none" ${fino} stroke-dasharray="10 12"/>
  <path d="M470 236h44M484 262h30" stroke="#BDBDBD" stroke-width="4" stroke-linecap="round"/>`),
}

const dir = 'public/vitrine/ilustracoes'
mkdirSync(dir, { recursive: true })
for (const [nome, conteudo] of Object.entries(ilustracoes)) {
  writeFileSync(`${dir}/${nome}.svg`, conteudo.replace(/\n\s+/g, '\n'))
  console.log(nome, `${(Buffer.byteLength(conteudo) / 1024).toFixed(1)} KB`)
}
