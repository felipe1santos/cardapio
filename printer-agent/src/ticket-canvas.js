// ─────────────────────────────────────────────────────────────────────────────
// DESENHO dos documentos do ASSISTENTE BETA (comanda da cozinha e pré-conta) em CANVAS.
//
// Um código só para o papel e para a tela: o Assistente Beta desenha aqui (janela oculta
// do Electron) e imprime o PNG; a página Impressão do painel usa o MESMO arquivo para a
// pré-visualização. O que aparece na tela é o que sai na impressora.
//
// Referência visual: docs/referencias/impressao/v3/COMANDA.png (1230 px de largura) e
// PRE-CONTA.png (1020 px). As medidas abaixo são pixels dessas imagens e escalam pela
// largura real do papel (58 mm, 80 mm, calibrada). O topo leva a LOGO DA LOJA (ou, sem
// logo, o nome da loja); o rodapé, nome, telefone e endereço da loja.
//
// Fontes (licenças livres), em ./fonts: Arimo e Roboto Condensed (comanda), DejaVu Sans
// Condensed e DejaVu Sans Mono (pré-conta; a Mono também em VALORES/DADOS da comanda) e
// Iosevka (faixas da comanda). Tamanho da
// letra: grande (= modelo), média, pequena — a opção da impressora nas predefinições.
// ─────────────────────────────────────────────────────────────────────────────
;(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica()
  else raiz.TicketMenuzia = fabrica()
})(typeof self !== 'undefined' ? self : this, function () {
  const MONO = 'Iosevka Menuzia'
  const COND = 'Roboto Condensed Menuzia'
  const SANS = 'Arimo Menuzia'
  const DVSC = 'DejaVu Sans Condensed Menuzia'
  const DVSM = 'DejaVu Sans Mono Menuzia'
  const ESCALA_FONTE = { grande: 1, media: 0.92, pequena: 0.85 }
  const PRETO = '#111111'
  const CINZA_OBS = '#d9d9d9'
  const CINZA_TEXTO = '#6b6b6b'
  // Largura dos modelos em pixels e a margem do texto.
  const BASE = { cozinha: 1230, pre_conta: 1020 }
  const MARGEM = { cozinha: 60, pre_conta: 54 }

  /** Fontes que o desenho usa (caminhos relativos a quem carrega). */
  const RECURSOS = {
    fontes: [
      { familia: MONO, peso: '500', arquivo: 'iosevka-500.woff2' },
      { familia: MONO, peso: '600', arquivo: 'iosevka-600.woff2' },
      { familia: MONO, peso: '800', arquivo: 'iosevka-800.woff2' },
      { familia: COND, peso: '700', arquivo: 'roboto-condensed-700.woff2' },
      { familia: SANS, peso: '400 700', arquivo: 'arimo.woff2' },
      { familia: DVSC, peso: '400', arquivo: 'DejaVuSansCondensed.ttf' },
      { familia: DVSC, peso: '700', arquivo: 'DejaVuSansCondensed-Bold.ttf' },
      { familia: DVSM, peso: '400', arquivo: 'DejaVuSansMono.ttf' },
      { familia: DVSM, peso: '700', arquivo: 'DejaVuSansMono-Bold.ttf' },
    ],
  }

  /** Carrega as fontes (FontFace) a partir de uma base de URL. */
  async function carregarRecursos(baseFontes) {
    const doc = typeof document !== 'undefined' ? document : self
    for (const f of RECURSOS.fontes) {
      const ja = [...doc.fonts].some((x) => x.family.replace(/"/g, '') === f.familia && String(x.weight) === f.peso && x.status === 'loaded')
      if (ja) continue
      const ff = new FontFace(f.familia, `url(${baseFontes.replace(/\/$/, '')}/${f.arquivo})`, { weight: f.peso })
      await ff.load()
      doc.fonts.add(ff)
    }
    return {}
  }

  /** Imagem (logo da loja) a partir de uma URL ou data URL. Falhou: null (sai o nome). */
  function carregarImagem(url) {
    if (!url) return Promise.resolve(null)
    return new Promise((ok) => {
      const img = new Image()
      img.onload = () => ok(img.naturalWidth > 0 ? img : null)
      img.onerror = () => ok(null)
      img.src = url
    })
  }

  function larguraEmPontos(larguraMm, larguraPontos) {
    const p = Number(larguraPontos)
    if (Number.isFinite(p) && p >= 256 && p <= 832) return Math.round(p)
    return Number(larguraMm) <= 58 ? 384 : 576
  }

  // ── motor de layout ─────────────────────────────────────────────────────────
  // Duas passadas: a primeira só mede (altura), a segunda desenha.
  function criarPincel(ctx, largura, modelo, tamanhoFonte, desenhar) {
    const k = largura / BASE[modelo]
    const fe = ESCALA_FONTE[tamanhoFonte] || 1
    const U = (v) => v * k // horizontal / estrutura
    const T = (v) => v * k * fe // letra e passo vertical
    const m = U(MARGEM[modelo])
    const dir = largura - m
    const capCache = new Map()

    const fonte = (familia, peso, tam, espaco = 0) => {
      ctx.font = `${peso} ${Math.max(9, tam).toFixed(2)}px "${familia}"`
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${espaco.toFixed(2)}px`
    }
    const cap = () => {
      const k2 = ctx.font + '|' + (ctx.letterSpacing || '')
      if (!capCache.has(k2)) capCache.set(k2, ctx.measureText('H').actualBoundingBoxAscent)
      return capCache.get(k2)
    }
    const larg = (s) => ctx.measureText(s).width
    // Texto pelo TOPO da tinta das maiúsculas (como foi medido nos modelos).
    const texto = (s, x, topo, alinhar = 'left', cor = PRETO) => {
      if (!desenhar) return
      ctx.fillStyle = cor
      ctx.textAlign = alinhar
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(s, x, topo + cap())
    }
    const ret = (x, y, w, h, cor = PRETO) => {
      if (!desenhar) return
      ctx.fillStyle = cor
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.max(1, Math.round(h)))
    }
    // Quebra por palavras. "2 L", "500 ML", "350 G" nunca ficam em linhas diferentes.
    const quebrar = (s, maxW) => {
      const palavras = String(s).replace(/(\d)\s+(ml|l|g|kg|mg|cm|un|und|pç|pcs?)\b/gi, '$1 $2').split(/[ \t\n]+/).filter(Boolean)
      const linhas = []
      let cur = ''
      for (let p of palavras) {
        const t = cur ? cur + ' ' + p : p
        if (larg(t) <= maxW) { cur = t; continue }
        if (cur) linhas.push(cur)
        while (larg(p) > maxW && p.length > 1) {
          let n = p.length
          while (n > 1 && larg(p.slice(0, n)) > maxW) n--
          linhas.push(p.slice(0, n))
          p = p.slice(n)
        }
        cur = p
      }
      if (cur) linhas.push(cur)
      return linhas.length ? linhas : ['']
    }
    // Espaço entre letras para o texto ocupar a largura do modelo (títulos espaçados).
    const espacoPara = (s, alvo) => {
      const n = [...s].length
      if (n < 2) return 0
      const antes = ctx.letterSpacing
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
      const w = larg(s)
      if ('letterSpacing' in ctx) ctx.letterSpacing = antes
      return Math.max(0, (alvo - w) / n)
    }
    // Faixa preta com o título em branco, centralizado.
    const faixa = (y, h, s, familia, peso, tam, alvoLargura, x0 = m, x1 = dir) => {
      ret(x0, y, x1 - x0, h)
      fonte(familia, peso, tam)
      const esp = alvoLargura ? espacoPara(s, alvoLargura) : 0
      fonte(familia, peso, tam, esp)
      texto(s, largura / 2 + esp / 2, y + (h - cap()) / 2, 'center', '#ffffff')
    }
    const tracejado = (y, traco = U(20), vao = U(11), esp = Math.max(1, U(3)), cor = '#222222') => {
      if (!desenhar) return
      ctx.fillStyle = cor
      for (let x = m; x + traco <= dir + 0.5; x += traco + vao) ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(traco)), Math.round(esp))
    }
    const pontilhado = (y) => {
      if (!desenhar) return
      const r = Math.max(0.8, U(2.2)), passo = Math.max(3, U(12.4))
      ctx.fillStyle = '#444444'
      for (let x = m + r; x <= dir - r; x += passo) { ctx.beginPath(); ctx.arc(x, y + r, r, 0, Math.PI * 2); ctx.fill() }
    }
    const qr = (linhasQr, x0, y0, lado, icone) => {
      const n = linhasQr.length
      const mod = Math.max(2, Math.round(lado / n))
      const real = mod * n
      const ox = Math.round(x0 + (lado - real) / 2), oy = Math.round(y0 + (lado - real) / 2)
      if (desenhar) {
        ctx.fillStyle = '#000000'
        for (let r = 0; r < n; r++) {
          const row = linhasQr[r]
          for (let c = 0; c < n; c++) if (row[c] === '1') ctx.fillRect(ox + c * mod, oy + r * mod, mod, mod)
        }
        if (icone === 'instagram') iconeInstagram(ctx, ox + real / 2, oy + real / 2, real * 0.2)
      }
      return real
    }
    const marcas = (y, h) => {
      if (!desenhar) return
      const w = Math.max(2, U(6))
      const n = 20
      const x0 = U(42), x1 = largura - U(42) - w
      for (let i = 0; i < n; i++) ret(x0 + ((x1 - x0) * i) / (n - 1), y, w, h)
    }
    return { k, fe, U, T, m, dir, largura, fonte, cap, larg, texto, ret, quebrar, espacoPara, faixa, tracejado, pontilhado, qr, marcas }
  }

  function arredondado(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function iconeInstagram(ctx, cx, cy, lado) {
    const caixa = lado * 1.35
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(cx - caixa / 2, cy - caixa / 2, caixa, caixa)
    const e = Math.max(2, lado * 0.12)
    ctx.fillStyle = '#000000'
    arredondado(ctx, cx - lado / 2, cy - lado / 2, lado, lado, lado * 0.28)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    arredondado(ctx, cx - lado / 2 + e, cy - lado / 2 + e, lado - 2 * e, lado - 2 * e, Math.max(1, lado * 0.28 - e))
    ctx.fill()
    ctx.fillStyle = '#000000'
    ctx.beginPath(); ctx.arc(cx, cy, lado * 0.24, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.arc(cx, cy, lado * 0.24 - e, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#000000'
    ctx.beginPath(); ctx.arc(cx + lado * 0.22, cy - lado * 0.22, Math.max(1.5, lado * 0.07), 0, Math.PI * 2); ctx.fill()
  }

  // ── ícones da forma de pagamento (preto e branco, do tamanho da letra) ───────
  // Desenhados em vetor e rasterizados no PNG: a térmica imprime como qualquer texto.
  // Para uma forma nova: uma função (ctx, x, y, s) → largura usada, e a chave no mapa.
  const ICONES_PAGAMENTO = {
    // Símbolo do Pix: quatro losangos em volta de um vão, monocromático.
    pix(ctx, x, y, s) {
      const d = s * 0.2
      const cx = x + s / 2, cy = y + s / 2
      ctx.fillStyle = '#000000'
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const px = cx + dx * s * 0.29, py = cy + dy * s * 0.29
        ctx.beginPath()
        ctx.moveTo(px, py - d); ctx.lineTo(px + d, py); ctx.lineTo(px, py + d); ctx.lineTo(px - d, py)
        ctx.closePath(); ctx.fill()
      }
      return s
    },
    cartao(ctx, x, y, s) {
      const w = s * 1.4, h = s * 0.95, y0 = y + (s - h) / 2, e = Math.max(1.2, s * 0.11)
      ctx.fillStyle = '#000000'
      arredondado(ctx, x, y0, w, h, s * 0.14); ctx.fill()
      ctx.fillStyle = '#ffffff'
      arredondado(ctx, x + e, y0 + e, w - 2 * e, h - 2 * e, Math.max(1, s * 0.14 - e)); ctx.fill()
      ctx.fillStyle = '#000000'
      ctx.fillRect(x, y0 + h * 0.26, w, h * 0.2)
      ctx.fillRect(x + w * 0.14, y0 + h * 0.66, w * 0.32, Math.max(1, h * 0.1))
      return w
    },
    dinheiro(ctx, x, y, s) {
      const w = s * 1.55, h = s * 0.9, y0 = y + (s - h) / 2, e = Math.max(1.2, s * 0.11)
      ctx.fillStyle = '#000000'
      ctx.fillRect(x, y0, w, h)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(x + e, y0 + e, w - 2 * e, h - 2 * e)
      ctx.fillStyle = '#000000'
      ctx.beginPath(); ctx.arc(x + w / 2, y0 + h / 2, h * 0.24, 0, Math.PI * 2); ctx.fill()
      ctx.fillRect(x + e * 2, y0 + h / 2 - e / 2, w * 0.12, e)
      ctx.fillRect(x + w - e * 2 - w * 0.12, y0 + h / 2 - e / 2, w * 0.12, e)
      return w
    },
    vale(ctx, x, y, s) {
      const w = s * 1.5, h = s * 0.85, y0 = y + (s - h) / 2, r = h * 0.2
      ctx.fillStyle = '#000000'
      ctx.fillRect(x, y0, w, h)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(x, y0 + h / 2, r, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(x + w, y0 + h / 2, r, 0, Math.PI * 2); ctx.fill()
      for (let i = 0; i < 4; i++) ctx.fillRect(x + w * 0.62, y0 + h * (0.12 + i * 0.22), Math.max(1, s * 0.08), h * 0.12)
      return w
    },
    celular(ctx, x, y, s) {
      const w = s * 0.62, h = s * 1.05, y0 = y + (s - h) / 2, e = Math.max(1.2, s * 0.1)
      ctx.fillStyle = '#000000'
      arredondado(ctx, x, y0, w, h, s * 0.12); ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(x + e, y0 + e * 1.6, w - 2 * e, h - e * 3.6)
      return w
    },
  }
  const LARGURA_ICONE = { pix: 1, cartao: 1.4, dinheiro: 1.55, vale: 1.5, celular: 0.62 }
  const ICONE_DA_FORMA = { pix: 'pix', cartao: 'cartao', credito: 'cartao', debito: 'cartao', dinheiro: 'dinheiro', vale: 'vale', online: 'celular', app: 'celular' }

  // Logo da loja: dentro da caixa do modelo, centralizada, em tons de cinza (a térmica
  // imprime preto e branco). Sem logo (ou "Imprimir logo da loja" desligado): na comanda,
  // o nome da loja em letras grandes; na pré-conta, nada (o nome já sai no rodapé).
  function topoDaLoja(ctx, p, b, o, y, caixa, desenhar) {
    const logo = o.imprimirLogo === false ? null : o.logo
    if (logo) {
      const esc = Math.min(caixa.w / logo.naturalWidth, caixa.h / logo.naturalHeight)
      const w = logo.naturalWidth * esc, h = logo.naturalHeight * esc
      if (desenhar) {
        ctx.save()
        if ('filter' in ctx) ctx.filter = 'grayscale(1)'
        ctx.drawImage(logo, Math.round((p.largura - w) / 2), Math.round(y), Math.round(w), Math.round(h))
        ctx.restore()
      }
      return h
    }
    if (!caixa.nomeTam) return 0
    const nome = String(b.nome || '').toLocaleUpperCase('pt-BR').trim()
    if (!nome) return 0
    let tam = caixa.nomeTam
    p.fonte(caixa.nomeFamilia, '700', tam)
    // Nome comprido: diminui até caber em duas linhas no máximo.
    let ls = p.quebrar(nome, p.dir - p.m)
    while ((ls.length > 2 || Math.max(...ls.map(p.larg)) > p.dir - p.m) && tam > caixa.nomeTam * 0.4) {
      tam *= 0.92
      p.fonte(caixa.nomeFamilia, '700', tam)
      ls = p.quebrar(nome, p.dir - p.m)
    }
    const c = p.cap(), passo = c * 1.3
    ls.forEach((ln, i) => {
      p.texto(ln, p.largura / 2, y + i * passo, 'center')
      // Traço por cima: o nome sai "pesado" como no modelo.
      if (desenhar) {
        ctx.save()
        ctx.strokeStyle = PRETO
        ctx.lineWidth = tam * 0.035
        ctx.lineJoin = 'round'
        ctx.textAlign = 'center'
        ctx.strokeText(ln, p.largura / 2, y + i * passo + c)
        ctx.restore()
      }
    })
    return c + (ls.length - 1) * passo
  }

  // Endereço da loja: quebra primeiro nas partes ("rua, nº" / "complemento" / ...).
  function linhasEndereco(p, s, maxW) {
    const partes = String(s).split(/\s+-\s+/).filter(Boolean)
    const out = []
    let cur = ''
    for (const parte of partes) {
      const t = cur ? `${cur} - ${parte}` : parte
      if (p.larg(t) <= maxW) { cur = t; continue }
      if (cur) out.push(cur)
      if (p.larg(parte) <= maxW) cur = parte
      else { const q = p.quebrar(parte, maxW); out.push(...q.slice(0, -1)); cur = q[q.length - 1] }
    }
    if (cur) out.push(cur)
    return out
  }

  // Bloco da loja no rodapé: nome (negrito), telefone e endereço, centralizados.
  // f = { familia, nome, linha, gapTel, passo, largEndereco }
  function blocoLoja(p, b, y, f) {
    const { fonte, cap, texto, largura } = p
    let temAlgo = false
    if (b.nome) {
      fonte(f.familia, '700', f.nome)
      for (const ln of p.quebrar(b.nome, p.dir - p.m)) { if (temAlgo) y += f.passo - cap(); texto(ln, largura / 2, y, 'center'); y += cap(); temAlgo = true }
    }
    fonte(f.familia, '400', f.linha)
    const linhas = []
    if (b.telefone) linhas.push(`Tel.: ${b.telefone}`)
    if (b.endereco) linhas.push(...linhasEndereco(p, b.endereco, f.largEndereco))
    linhas.forEach((ln, i) => {
      if (temAlgo) y += (i === 0 && b.nome ? f.gapTel : f.passo - cap())
      texto(ln, largura / 2, y, 'center')
      y += cap()
      temAlgo = true
    })
    return y
  }

  // ── comanda da cozinha (modelo v3/COMANDA.png, 1230 px) ─────────────────────
  // Distâncias = do fim do bloco anterior ao topo da tinta do próximo, medidas no modelo.
  function layoutCozinha(ctx, doc, o, desenhar) {
    const p = criarPincel(ctx, o.largura, 'cozinha', o.tamanhoFonte, desenhar)
    const { U, T, m, dir, fonte, cap, larg, texto, ret, quebrar, faixa, tracejado, pontilhado } = p
    // Opção da loja "Fonte maior na via de produção": itens um pouco maiores.
    const fi = doc.fonteMaior ? 1.12 : 1
    fonte(DVSM, '400', T(38.4))
    const larguraRotulos = Math.max(0, ...doc.blocos.filter((b) => b.t === 'dado').map((b) => larg(b.rotulo)))
    let y = U(12)
    let anterior = ''
    for (const b of doc.blocos) {
      switch (b.t) {
        case 'marcas': {
          if (anterior) y += T(30)
          p.marcas(y, U(25))
          y += U(25)
          break
        }
        case 'logo': {
          y += anterior ? U(76) : U(24)
          y += topoDaLoja(ctx, p, b, o, y, { w: U(760), h: U(150), nomeTam: T(118), nomeFamilia: SANS }, desenhar)
          break
        }
        case 'titulo': {
          y += T(41)
          fonte(SANS, '400', T(35))
          const esp = p.espacoPara(b.s, U(483) * p.fe)
          fonte(SANS, '400', T(35), esp)
          texto(b.s, p.largura / 2 + esp / 2, y, 'center')
          y += cap()
          break
        }
        case 'pedido': {
          // "#129" grande e o tipo num selo preto de cantos arredondados, centralizados.
          y += T(53)
          const medir = (f) => {
            fonte(SANS, '700', T(91) * f)
            const w1 = larg(b.numero), c1 = cap()
            fonte(SANS, '700', T(35.5) * f, T(35.5) * f * 0.1)
            const w2 = b.tipo ? larg(b.tipo) : 0, c2 = cap()
            const hs = T(66) * f, padX = T(24) * f, gap = T(38) * f
            return { w1, c1, w2, c2, hs, padX, gap, total: w1 + (b.tipo ? gap + w2 + 2 * padX : 0) }
          }
          let f = 1
          let mm = medir(f)
          if (mm.total > dir - m) { f = (dir - m) / mm.total; mm = medir(f) }
          const x = (p.largura - mm.total) / 2
          fonte(SANS, '700', T(91) * f)
          texto(b.numero, x, y)
          if (b.tipo) {
            const xs = x + mm.w1 + mm.gap, ys = y + (mm.c1 - mm.hs) / 2
            if (desenhar) {
              ctx.fillStyle = '#000000'
              arredondado(ctx, xs, ys, mm.w2 + 2 * mm.padX, mm.hs, mm.hs / 2)
              ctx.fill()
            }
            fonte(SANS, '700', T(35.5) * f, T(35.5) * f * 0.1)
            texto(b.tipo, xs + mm.padX + (T(35.5) * f * 0.1) / 2 + mm.w2 / 2, ys + (mm.hs - mm.c2) / 2, 'center', '#ffffff')
          }
          y += mm.c1
          break
        }
        case 'horas': {
          y += T(67)
          fonte(SANS, '400', T(39.9))
          texto(b.s, p.largura / 2, y, 'center')
          y += cap()
          break
        }
        case 'aviso': {
          y += T(28)
          fonte(COND, '700', T(34))
          for (const ln of quebrar(b.s, dir - m)) { texto(ln, p.largura / 2, y, 'center'); y += cap() + T(8) }
          y -= T(8)
          break
        }
        case 'faixa': {
          y += T(anterior === 'total' ? 35 : anterior === 'horas' ? 60 : 41)
          const h = T(67)
          const alvo = { 'ITENS DO PEDIDO': U(418), VALORES: U(190), 'DADOS DA ENTREGA': U(445), 'DADOS DA MESA': U(365), 'DADOS DO CLIENTE': U(440) }[b.s]
          faixa(y, h, b.s, MONO, '800', T(40), alvo ? alvo * p.fe : null)
          y += h
          break
        }
        case 'itens_cab': {
          y += T(34)
          fonte(COND, '700', T(30))
          texto(b.esq, m + U(2), y, 'left', CINZA_TEXTO)
          texto(b.dir, dir, y, 'right', CINZA_TEXTO)
          y += cap()
          break
        }
        case 'item': {
          if (!b.primeiro) { y += T(29); pontilhado(y); y += Math.max(1, U(5)) }
          y += T(b.primeiro ? 36 : 40)
          fonte(COND, '700', T(59.6) * fi)
          const wv = b.valor ? larg(b.valor) : 0
          texto(b.valor || '', dir, y, 'right')
          const ls = quebrar(b.texto, dir - m - (wv ? wv + U(24) : 0))
          ls.forEach((ln, i) => texto(ln, m, y + i * T(66) * fi))
          y += cap() + (ls.length - 1) * T(66) * fi
          // Adicionais e variações: na margem, sem recuo, com o valor à direita.
          fonte(SANS, '400', T(38.5) * fi)
          let primeiroSub = true
          for (const s of b.subs || []) {
            const wsv = s.valor ? larg(s.valor) : 0
            const lsub = quebrar(s.s, dir - m - (wsv ? wsv + U(24) : 0))
            lsub.forEach((ln, i) => {
              y += primeiroSub ? T(28) : T(27)
              primeiroSub = false
              texto(ln, m, y)
              if (i === 0 && s.valor) texto(s.valor, dir, y, 'right')
              y += cap()
            })
          }
          // Observação: faixa cinza claro na largura toda.
          if (b.obs) {
            fonte(COND, '700', T(36.8) * fi)
            const padX = U(19), padV = T(17.5)
            const lo = quebrar(b.obs, dir - m - 2 * padX)
            const topo = y + T(19)
            const h = lo.length * cap() + (lo.length - 1) * T(14) + 2 * padV
            ret(m, topo, dir - m, h, CINZA_OBS)
            lo.forEach((ln, i) => texto(ln, m + padX, topo + padV + i * (cap() + T(14))))
            y = topo + h
          }
          break
        }
        case 'obs_pedido': {
          y += T(29)
          fonte(COND, '700', T(36.8))
          const padX = U(19), padV = T(17.5)
          const ls = quebrar(b.s, dir - m - 2 * padX)
          const h = ls.length * cap() + (ls.length - 1) * T(14) + 2 * padV
          ret(m, y, dir - m, h, CINZA_OBS)
          ls.forEach((ln, i) => texto(ln, m + padX, y + padV + i * (cap() + T(14))))
          y += h
          break
        }
        case 'par': {
          y += T(b.primeiro ? 30 : 29)
          fonte(DVSM, '400', T(38.4))
          texto(b.rotulo, m + U(13), y)
          if (b.negrito) fonte(DVSM, '700', T(38.4))
          texto(b.valor, dir, y, 'right')
          const chave = b.icone && ICONE_DA_FORMA[b.icone]
          if (chave && ICONES_PAGAMENTO[chave]) {
            const s = cap() * 1.15
            const xi = dir - larg(b.valor) - U(12) - LARGURA_ICONE[chave] * s
            if (desenhar) ICONES_PAGAMENTO[chave](ctx, xi, y + (cap() - s) / 2, s)
          }
          y += cap()
          break
        }
        case 'tracejado': {
          // Linha dupla embaixo dos valores (modelo).
          y += T(40)
          tracejado(y, U(15.5), U(8.5), Math.max(1, U(3)), '#333333')
          y += T(12)
          tracejado(y, U(15.5), U(8.5), Math.max(1, U(3)), '#333333')
          y += Math.max(1, U(3))
          break
        }
        case 'total': {
          y += T(16)
          const h = T(121)
          ret(m, y, dir - m, h)
          fonte(COND, '700', T(81.5))
          const c = cap()
          texto(b.rotulo, m + U(28), y + (h - c) / 2, 'left', '#ffffff')
          texto(b.valor, dir - U(21), y + (h - c) / 2, 'right', '#ffffff')
          y += h
          break
        }
        case 'dado': {
          y += T(b.primeiro ? 30 : 32)
          fonte(DVSM, '400', T(38.4))
          // Coluna do valor: a do modelo ou, com rótulo maior ("Atendente:"), logo depois dele.
          const col = Math.max(m + U(250), m + U(13) + larguraRotulos + larg(' '))
          texto(b.rotulo, m + U(13), y)
          fonte(DVSM, b.negrito ? '700' : '400', T(38.4))
          const ls = quebrar(b.valor, dir - col)
          ls.forEach((ln, i) => texto(ln, col, y + i * T(60)))
          y += cap() + (ls.length - 1) * T(60)
          break
        }
        case 'qr': {
          y += T(55)
          const lado = T(225)
          const real = p.qr(b.linhas, (p.largura - lado) / 2, y, lado, b.icone)
          y += real
          break
        }
        case 'rodape': {
          // Frase do QR, tracejado, loja (nome, telefone, endereço), tracejado, "Feito por".
          for (const [i, l] of (b.linhas || []).entries()) {
            fonte(SANS, l.negrito ? '700' : '400', T(32.5))
            y += i === 0 ? T(38) : T(15)
            texto(l.s, p.largura / 2, y, 'center')
            y += cap()
          }
          if (b.loja && (b.loja.nome || b.loja.telefone || b.loja.endereco)) {
            y += T(28); tracejado(y); y += Math.max(1, U(3))
            y += T(50)
            y = blocoLoja(p, b.loja, y, { familia: SANS, nome: T(41.2), linha: T(32.7), gapTel: T(29), passo: T(48), largEndereco: U(760) })
          }
          y += T(22); tracejado(y); y += Math.max(1, U(3))
          if (b.final) {
            fonte(SANS, '400', T(27))
            y += T(33)
            texto(b.final, p.largura / 2, y, 'center')
            y += cap()
          }
          break
        }
        default: break
      }
      anterior = b.t
    }
    return y + T(17)
  }

  // ── pré-conta (modelo v3/PRE-CONTA.png, 1020 px) ────────────────────────────
  function layoutPreConta(ctx, doc, o, desenhar) {
    const p = criarPincel(ctx, o.largura, 'pre_conta', o.tamanhoFonte, desenhar)
    const { U, T, m, dir, fonte, cap, larg, texto, quebrar, faixa, tracejado } = p
    let y = U(29)
    let anterior = ''
    // Colunas: QTD só com o necessário; a descrição começa logo depois; TOTAL só o número.
    const colQtd = m + U(24)
    const colDesc = m + U(92)
    const dirV = dir - U(3)
    let itemComSubs = false
    for (const b of doc.blocos) {
      switch (b.t) {
        case 'marcas': {
          // Só no fim (modelo); no topo, a pré-conta começa direto.
          if (!anterior) break
          y += T(30)
          p.marcas(y, U(19))
          y += U(19)
          break
        }
        case 'logo': {
          const h = topoDaLoja(ctx, p, b, o, y, { w: U(640), h: U(150), nomeTam: 0 }, desenhar)
          if (h) y += h + T(30)
          break
        }
        case 'titulo': {
          fonte(DVSM, '700', T(53))
          texto(b.s, p.largura / 2, y, 'center')
          y += cap()
          break
        }
        case 'linha': {
          fonte(DVSM, '400', T(38.1))
          y += b.primeiro ? T(30) : T(57) - cap()
          for (const ln of quebrar(b.s, dir - m)) { texto(ln, p.largura / 2, y, 'center'); y += cap() + T(29) }
          y -= T(29)
          break
        }
        case 'aviso': {
          y += T(27)
          fonte(DVSM, '700', T(27.5))
          for (const ln of quebrar(b.s, dir - m)) { texto(ln, p.largura / 2, y, 'center'); y += cap() + T(8) }
          y -= T(8)
          break
        }
        case 'faixa': {
          y += T(b.primeiro ? 64 : 66)
          const h = T(79)
          faixa(y, h, b.s, DVSC, '700', T(42), null, U(36), p.largura - U(36))
          y += h
          break
        }
        case 'tabela_cab': {
          y += T(30)
          fonte(DVSC, '400', T(34.9))
          texto(b.qtd, m + U(2), y)
          texto(b.desc, colDesc, y)
          texto(b.total, dirV, y, 'right')
          y += cap()
          break
        }
        case 'tracejado': {
          y += T({ tabela: 26, valores: 35, total: 46, qr: 41, loja: 37 }[b.depois] ?? 30)
          // Tracejado miúdo da pré-conta (modelo).
          tracejado(y, U(10.5), U(5.5))
          y += Math.max(1, U(3))
          break
        }
        case 'tabela_item': {
          y += T(b.primeiro ? 36 : itemComSubs ? 50 : 59)
          itemComSubs = (b.subs || []).length > 0
          fonte(DVSC, '400', T(41.9))
          texto(b.qtd, colQtd, y, 'center')
          const wt = larg(b.total)
          texto(b.total, dirV, y, 'right')
          const ls = quebrar(b.desc, dirV - wt - U(20) - colDesc)
          ls.forEach((ln, i) => texto(ln, colDesc, y + i * T(52)))
          y += cap() + (ls.length - 1) * T(52)
          // Adicionais com o próprio valor (a soma da coluna = Subtotal); observação sem valor.
          fonte(DVSC, '400', T(32.9))
          let primeiroSub = true
          for (const s of b.subs || []) {
            const temValor = !!s.valor
            const wsv = temValor ? larg(s.valor) : 0
            const lsub = quebrar(s.s, (temValor ? dirV - wsv - U(20) : dir) - colDesc)
            lsub.forEach((ln, i) => {
              y += primeiroSub ? T(25) : T(18)
              primeiroSub = false
              texto(ln, colDesc, y)
              if (i === 0 && temValor) texto(s.valor, dirV, y, 'right')
              y += cap()
            })
          }
          break
        }
        case 'par': {
          y += T(b.primeiro ? 30 : 35)
          fonte(DVSC, '400', T(41.9))
          texto(b.rotulo, m, y)
          texto(b.valor, dirV, y, 'right')
          y += cap()
          break
        }
        case 'total': {
          y += T(34)
          fonte(DVSC, '700', T(65.9))
          texto(b.rotulo, m, y)
          texto(b.valor, dirV, y, 'right')
          y += cap()
          break
        }
        case 'rodape_qr': {
          y += T(34)
          const lado = T(225)
          const xq = dir - U(43) - lado
          const real = b.qr ? p.qr(b.qr.linhas, xq, y, lado, b.qr.icone) : 0
          const temQr = !!(b.qr && real)
          fonte(DVSC, '400', T(32.9))
          const c = cap()
          const passo = T(44)
          const maxW = temQr ? Math.min(U(470), xq - U(30) - m) : dir - m
          const ls = []
          for (const l of b.linhas) {
            if (!l.s) { ls.push({ s: '', vazio: true }); continue }
            for (const ln of quebrar(l.s, maxW)) ls.push({ s: ln, negrito: l.negrito })
          }
          const hTexto = ls.length * c + (ls.length - 1) * (passo - c)
          const alturaBloco = temQr ? Math.max(real, lado) : hTexto
          let yt = temQr ? y + Math.max(0, (alturaBloco - hTexto) / 2) : y
          for (const l of ls) {
            fonte(DVSC, l.negrito ? '700' : '400', T(32.9))
            if (!l.vazio) {
              if (temQr) texto(l.s, m, yt)
              else texto(l.s, p.largura / 2, yt, 'center')
            }
            yt += passo
          }
          y += temQr ? alturaBloco : Math.max(hTexto, yt - passo + c - y)
          break
        }
        case 'loja': {
          y += T(36)
          y = blocoLoja(p, b, y, { familia: DVSM, nome: T(41.3), linha: T(32.7), gapTel: T(25), passo: T(48), largEndereco: U(800) })
          break
        }
        case 'aviso_rodape': {
          y += T(35)
          fonte(DVSM, '400', T(32.9))
          for (const ln of quebrar(b.s, dir - m)) { texto(ln, p.largura / 2, y, 'center'); y += cap() + T(8) }
          y -= T(8)
          break
        }
        default: break
      }
      anterior = b.t
    }
    return y + T(17)
  }

  /**
   * Desenha o documento num canvas (já criado) e devolve a altura usada.
   * o = { larguraMm, larguraPontos, tamanhoFonte, logo (Image | null), imprimirLogo }
   */
  function desenhar(canvas, doc, o = {}) {
    const largura = larguraEmPontos(o.larguraMm, o.larguraPontos)
    const ctx = canvas.getContext('2d')
    const opcoes = { largura, tamanhoFonte: o.tamanhoFonte || 'grande', logo: o.logo || null, imprimirLogo: o.imprimirLogo !== false }
    const layout = doc.modelo === 'pre_conta' ? layoutPreConta : layoutCozinha
    canvas.width = largura
    canvas.height = 10
    const altura = Math.ceil(layout(ctx, doc, opcoes, false))
    canvas.width = largura
    canvas.height = altura
    const c2 = canvas.getContext('2d')
    c2.fillStyle = '#ffffff'
    c2.fillRect(0, 0, largura, altura)
    layout(c2, doc, opcoes, true)
    return { largura, altura }
  }

  return { desenhar, carregarRecursos, carregarImagem, larguraEmPontos, RECURSOS, ESCALA_FONTE, ICONES_PAGAMENTO, ICONE_DA_FORMA }
})
