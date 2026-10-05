// ─────────────────────────────────────────────────────────────────────────────
// ESC/POS DIRETO (Assistente Beta 0.2.0-beta.7) — sem o driver do Windows.
//
// Por quê: pelo driver, quem decide a largura e o preto e branco é o driver. Um driver de
// 58 mm numa impressora de 80 mm corta a comanda em 2/3; o cinza do texto vira pontos
// ralos ("apagado"). Aqui o sistema manda os bytes prontos:
//   • imagem: a mesma comanda do ticket-canvas.js, já em 1 bit, no tamanho EXATO de pontos,
//     em faixas (GS v 0, até 192 linhas por comando), avanço antes do corte e corte;
//   • texto (compatibilidade): comandos nativos — negrito, tamanho duplo, alinhamento,
//     inverso — com ESC @, FS . (sai do modo chinês/kanji de muitos clones) e ESC t 16
//     (WPC1252) para os acentos (Ç Ã É Õ). Era PC850 (ESC t 2) até o beta.8.
// Intensidade: "normal" não manda nada (= hoje). "escura"/"mais escura" mandam o comando
// Epson de densidade (GS ( K, função 49); quem não entende ignora — e o desenho já sai
// mais grosso de qualquer jeito (limiar do ticket-canvas.js).
// Só gera bytes; quem envia é o printer.js (fila do Windows tipo RAW ou rede IP:9100).
// ─────────────────────────────────────────────────────────────────────────────

const ESC = 0x1b
const GS = 0x1d

const INICIAR = [ESC, 0x40]
// Densidade (Epson GS ( K fn=49): 0 = padrão; 1..6 = mais escuro (até +30%).
const DENSIDADE = { escura: 3, mais_escura: 6 }
// Linhas avançadas antes do corte: a guilhotina fica acima da cabeça de impressão.
const AVANCO_ANTES_DO_CORTE = 5
const LINHAS_POR_FAIXA = 192

function comandoDensidade(intensidade) {
  const m = DENSIDADE[intensidade]
  return m ? [GS, 0x28, 0x4b, 0x02, 0x00, 0x31, m] : []
}

function avancarECortar(cortar = true) {
  const b = [ESC, 0x64, AVANCO_ANTES_DO_CORTE]
  if (cortar) b.push(GS, 0x56, 0x01) // corte parcial
  return b
}

/**
 * Imagem 1 bit → ESC/POS. `img` = { bits (Uint8Array, 1 = preto, MSB à esquerda),
 * largura, altura, porLinha }. `deslocamento` (pontos) empurra a imagem para a direita
 * (positivo) ou corta pela esquerda (negativo), sem mudar a largura.
 */
function imagemEscpos(img, o = {}) {
  const { largura, altura } = img
  const porLinha = img.porLinha || Math.ceil(largura / 8)
  const faixa = Math.max(8, Math.min(255, o.linhasPorFaixa || LINHAS_POR_FAIXA))
  let bits = img.bits
  const d = Math.trunc(Number(o.deslocamento) || 0)
  if (d !== 0) bits = deslocar(img.bits, largura, altura, porLinha, d)
  const partes = [Buffer.from(INICIAR), Buffer.from(comandoDensidade(o.intensidade))]
  for (let y0 = 0; y0 < altura; y0 += faixa) {
    const h = Math.min(faixa, altura - y0)
    // GS v 0 m xL xH yL yH: x em BYTES por linha, y em linhas.
    partes.push(Buffer.from([GS, 0x76, 0x30, 0x00, porLinha & 0xff, porLinha >> 8, h & 0xff, h >> 8]))
    partes.push(Buffer.from(bits.subarray(y0 * porLinha, (y0 + h) * porLinha)))
  }
  partes.push(Buffer.from(avancarECortar(o.cortar !== false)))
  return Buffer.concat(partes)
}

function deslocar(bits, largura, altura, porLinha, d) {
  const out = new Uint8Array(porLinha * altura)
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const orig = x - d
      if (orig < 0 || orig >= largura) continue
      if (bits[y * porLinha + (orig >> 3)] & (0x80 >> (orig & 7))) out[y * porLinha + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return out
}

// ── texto (modo compatibilidade) ─────────────────────────────────────────────

// WPC1252 (ESC t 16): o Latin-1 inteiro (0xA0–0xFF = o próprio código Unicode) e as aspas,
// travessões e reticências da faixa 0x80–0x9F. O que não existe na página cai sem acento ou "?".
const CP1252_EXTRA = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 }
// Página de código: ESC t 16. FS . desliga o modo de caracteres chineses (senão os acentos
// viram ideogramas em clones de impressora asiática).
const PAGINA_CODIGO = [0x1c, 0x2e, ESC, 0x74, 0x10]

function codificar(s) {
  const out = []
  for (const ch of String(s)) {
    const c = ch.codePointAt(0)
    if (ch === ' ') out.push(0x20)
    else if (CP1252_EXTRA[ch] !== undefined) out.push(CP1252_EXTRA[ch])
    else if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff)) out.push(c)
    else {
      const sem = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
      out.push(sem && sem.charCodeAt(0) >= 0x20 && sem.charCodeAt(0) < 0x7f ? sem.charCodeAt(0) : 0x3f)
    }
  }
  return out
}

function quebrarTexto(s, n) {
  const linhas = []
  let cur = ''
  for (const p of String(s).split(/\s+/).filter(Boolean)) {
    let w = p
    while (w.length > n) { if (cur) { linhas.push(cur); cur = '' } linhas.push(w.slice(0, n)); w = w.slice(n) }
    const t = cur ? `${cur} ${w}` : w
    if (t.length <= n) cur = t
    else { linhas.push(cur); cur = w }
  }
  if (cur) linhas.push(cur)
  return linhas.length ? linhas : ['']
}

/** Duas colunas (rótulo à esquerda, valor à direita) em n caracteres; valor nunca cortado. */
function duasColunas(esq, dir, n) {
  const d = String(dir ?? '')
  const espaco = n - d.length - 1
  if (espaco < 4) return [...quebrarTexto(esq, n), ' '.repeat(Math.max(0, n - d.length)) + d]
  const ls = quebrarTexto(esq, espaco)
  const ult = ls.pop()
  return [...ls, ult + ' '.repeat(n - ult.length - d.length) + d]
}

/** QR (matriz de '0'/'1') como imagem ESC/POS centralizada na largura do papel. */
function qrEscpos(linhas, larguraPontos) {
  const n = linhas.length
  const mod = Math.max(3, Math.min(8, Math.floor((larguraPontos * 0.42) / n)))
  const lado = n * mod
  const porLinha = Math.ceil(larguraPontos / 8)
  const x0 = Math.max(0, Math.floor((larguraPontos - lado) / 2))
  const bits = new Uint8Array(porLinha * lado)
  for (let y = 0; y < lado; y++) {
    const row = linhas[Math.floor(y / mod)]
    for (let x = 0; x < lado; x++) {
      if (row[Math.floor(x / mod)] !== '1') continue
      const px = x0 + x
      bits[y * porLinha + (px >> 3)] |= 0x80 >> (px & 7)
    }
  }
  return [GS, 0x76, 0x30, 0x00, porLinha & 0xff, porLinha >> 8, lado & 0xff, lado >> 8, ...bits]
}

/**
 * Documento (blocos da comanda / pré-conta / teste de largura) → ESC/POS em texto.
 * `larguraPontos` define as colunas (fonte A = 12 pontos: 576 → 48, 384 → 32).
 */
function textoEscpos(doc, o = {}) {
  const pontos = Number(o.larguraPontos) > 0 ? Number(o.larguraPontos) : 576
  const n = Math.max(24, Math.floor(pontos / 12))
  const b = [...INICIAR, ...PAGINA_CODIGO, ...comandoDensidade(o.intensidade)]
  const alinhar = (a) => b.push(ESC, 0x61, a === 'centro' ? 1 : a === 'direita' ? 2 : 0)
  const negrito = (v) => b.push(ESC, 0x45, v ? 1 : 0)
  const tamanho = (v) => b.push(GS, 0x21, v) // 0x00 normal, 0x01 altura dupla, 0x11 dupla
  const inverso = (v) => b.push(GS, 0x42, v ? 1 : 0)
  const linha = (s) => b.push(...codificar(s), 0x0a)
  const traco = (c = '-') => linha(c.repeat(n))
  const bloco = (s, { centro = false, grande = false, alto = false, forte = false } = {}) => {
    alinhar(centro ? 'centro' : 'esquerda'); negrito(forte); tamanho(grande ? 0x11 : alto ? 0x01 : 0x00)
    for (const l of quebrarTexto(s, grande ? Math.floor(n / 2) : n)) linha(l)
    tamanho(0x00); negrito(false); alinhar('esquerda')
  }
  const faixa = (s) => { alinhar('centro'); negrito(true); inverso(true); linha(` ${s} `); inverso(false); negrito(false); alinhar('esquerda') }
  const par = (esq, dir, forte = false) => { negrito(forte); for (const l of duasColunas(esq, dir, n)) linha(l); negrito(false) }

  if (doc.modelo === 'largura') {
    bloco('TESTE DE LARGURA', { centro: true, forte: true })
    linha('|' + '-'.repeat(n - 2) + '|')
    let r = ''
    for (let i = 1; i <= n; i++) r += i % 10 === 0 ? String((i / 10) % 10) : i % 5 === 0 ? '+' : '.'
    linha(r)
    for (const l of doc.linhas || []) par(`${l.rotulo}`, String(l.valor))
    bloco('Acentos: ÇÃÉÕ çãéõ áíú', { forte: true })
    for (const s of doc.instrucoes || []) bloco(s)
    linha('|' + '-'.repeat(n - 2) + '|')
    b.push(...avancarECortar(o.cortar !== false))
    return Buffer.from(b)
  }

  // Modelo oficial v3: mesmos blocos do desenho, em comandos nativos.
  if (doc.modelo === 'v3') {
    const tracos = () => linha('-'.repeat(n))
    for (const k of doc.blocos || []) {
      switch (k.t) {
        case 'loja_nome': bloco(k.s, { centro: true, forte: true }); break
        case 'loja_endereco': {
          // Partes juntas com " - " enquanto cabem; a linha seguinte começa na parte.
          alinhar('centro')
          let cur = ''
          for (const p of k.partes || []) {
            const t = cur ? `${cur} - ${p}` : p
            if (t.length <= n) { cur = t; continue }
            if (cur) linha(cur)
            const q = quebrarTexto(p, n); q.slice(0, -1).forEach(linha); cur = q[q.length - 1]
          }
          if (cur) linha(cur)
          alinhar('esquerda')
          break
        }
        case 'loja_telefone': case 'tipo': bloco(k.s, { centro: true, forte: true }); break
        case 'data': case 'nota': case 'final': bloco(k.s, { centro: true }); break
        case 'aviso': bloco(k.s, { centro: true, forte: true }); break
        case 'tracejado': tracos(); break
        case 'faixa': faixa(k.s); break
        case 'item':
          if (!k.primeiro) tracos()
          negrito(true); tamanho(doc.via === 'cozinha' ? 0x11 : 0x01)
          for (const l of duasColunas(k.texto, k.valor || '', doc.via === 'cozinha' ? Math.floor(n / 2) : n)) linha(l)
          tamanho(0x00)
          if (k.obs) { inverso(true); for (const l of quebrarTexto(k.obs, n)) linha(l); inverso(false) }
          negrito(false)
          break
        case 'obs_geral': negrito(true); tamanho(0x01); for (const l of quebrarTexto(k.s, n)) linha(l); tamanho(0x00); negrito(false); break
        case 'par': par(k.rotulo, k.valor); break
        case 'linha': linha('_'.repeat(n)); break
        case 'total':
          negrito(true); tamanho(0x11)
          for (const l of duasColunas(k.rotulo, k.valor, Math.floor(n / 2))) linha(l)
          tamanho(0x00); negrito(false)
          break
        case 'texto': for (const l of quebrarTexto(k.s, n)) linha(l); break
        case 'dado': {
          const ps = k.partes || []
          let cur = `${k.rotulo} ${ps[0] || ''}`
          for (const p of ps.slice(1)) { const t = `${cur} - ${p}`; if (t.length <= n) cur = t; else { for (const l of quebrarTexto(cur, n)) linha(l); cur = p } }
          for (const l of quebrarTexto(cur, n)) linha(l)
          break
        }
        case 'rodape':
          if (k.qr && Array.isArray(k.qr.linhas) && k.qr.linhas.length >= 21) b.push(...qrEscpos(k.qr.linhas, pontos))
          if (k.frase) bloco(k.frase, { centro: true })
          if (k.agradecimento) bloco(k.agradecimento, { centro: true, forte: true })
          break
        default: break
      }
    }
    b.push(...avancarECortar(o.cortar !== false))
    return Buffer.from(b)
  }

  for (const k of doc.blocos || []) {
    switch (k.t) {
      case 'logo': if (k.nome) bloco(k.nome, { centro: true, grande: true, forte: true }); break
      case 'titulo': bloco(k.s, { centro: true, forte: doc.modelo === 'pre_conta' }); break
      case 'pedido': bloco([k.numero, k.tipo].filter(Boolean).join('  '), { centro: true, grande: true, forte: true }); break
      case 'horas': case 'linha': case 'aviso_rodape': bloco(k.s, { centro: true }); break
      case 'aviso': bloco(k.s, { centro: true, forte: true }); break
      case 'faixa': faixa(k.s); break
      case 'itens_cab': par(k.esq, k.dir); break
      case 'item':
        negrito(true); tamanho(0x01)
        for (const l of duasColunas(k.texto, k.valor || '', n)) linha(l)
        tamanho(0x00); negrito(false)
        for (const x of k.subs || []) for (const l of duasColunas(x.s, x.valor || '', n)) linha(l)
        if (k.obs) { negrito(true); inverso(true); for (const l of quebrarTexto(k.obs, n)) linha(l); inverso(false); negrito(false) }
        traco('.')
        break
      case 'obs_pedido': negrito(true); for (const l of quebrarTexto(k.s, n)) linha(l); negrito(false); break
      case 'tabela_cab': par(`${k.qtd} ${k.desc}`, k.total); break
      case 'tabela_item':
        par(`${k.qtd} ${k.desc}`, k.total)
        for (const x of k.subs || []) for (const l of duasColunas(`   ${x.s}`, x.valor || '', n)) linha(l)
        break
      case 'par': par(k.rotulo, k.valor, !!k.negrito); break
      case 'tracejado': traco('='); break
      case 'total':
        negrito(true); tamanho(0x11)
        for (const l of duasColunas(k.rotulo, k.valor, Math.floor(n / 2))) linha(l)
        tamanho(0x00); negrito(false)
        break
      case 'dado': {
        const rot = String(k.rotulo).padEnd(11)
        const ls = quebrarTexto(k.valor, n - rot.length)
        ls.forEach((l, i) => { linha((i === 0 ? rot : ' '.repeat(rot.length)) + l) })
        break
      }
      case 'separador': traco('.'); break
      case 'rodape_loja': {
        const l = k.loja || {}
        if (l.nome) bloco(l.nome, { forte: true })
        for (const s of [l.telefone ? `Tel.: ${l.telefone}` : '', l.linha1, l.cidade]) if (s) bloco(s)
        // O QR vai como imagem (a chamada só faz sentido com ele).
        if (k.qr && Array.isArray(k.qr.linhas) && k.qr.linhas.length >= 21) {
          for (const s of k.chamada || []) bloco(s)
          b.push(...qrEscpos(k.qr.linhas, pontos))
        }
        traco('-')
        if (k.final) bloco(k.final, { centro: true })
        break
      }
      case 'rodape': case 'rodape_qr':
        for (const x of k.linhas || []) if (x.s) bloco(x.s, { centro: true, forte: !!x.negrito })
        if (k.t === 'rodape_qr' && k.qr && Array.isArray(k.qr.linhas) && k.qr.linhas.length >= 21) b.push(...qrEscpos(k.qr.linhas, pontos))
        break
      case 'loja':
        if (k.nome) bloco(k.nome, { centro: true, forte: true })
        if (k.telefone) bloco(`Tel.: ${k.telefone}`, { centro: true })
        if (k.endereco) bloco(k.endereco, { centro: true })
        break
      default: break
    }
  }
  b.push(...avancarECortar(o.cortar !== false))
  return Buffer.from(b)
}

module.exports = { imagemEscpos, textoEscpos, codificar, PAGINA_CODIGO, duasColunas, quebrarTexto, comandoDensidade, AVANCO_ANTES_DO_CORTE, LINHAS_POR_FAIXA }
