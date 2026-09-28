// ─────────────────────────────────────────────────────────────────────────────
// DESENHO dos documentos do ASSISTENTE BETA (comanda da cozinha e pré-conta) em CANVAS.
//
// Um código só para o papel e para a tela: o Assistente Beta desenha aqui (janela oculta
// do Electron) e imprime o PNG; a página Impressão do painel usa o MESMO arquivo para a
// pré-visualização. O que aparece na tela é o que sai na impressora.
//
// Referência visual: docs/referencias/impressao/v2/COMANDA.png e PRE-CONTA.png. As medidas
// abaixo são pixels dessas fotos (papel de 712 px de largura = 80 mm) e escalam pela largura
// real do papel (58 mm, 80 mm, calibrada). Pedidos do dono sobre o modelo da comanda:
// sem preço nos itens, "1x" colado na descrição e "Pedido #N" menor.
//
// Fontes (OFL): Iosevka (texto) e Roboto Condensed (Pedido e TOTAL), em ./fonts. Logo:
// ./logo-menuzia.png (recortado do modelo). Tamanho da letra: grande (= modelo), média,
// pequena — a opção da impressora nas predefinições.
// ─────────────────────────────────────────────────────────────────────────────
;(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica()
  else raiz.TicketMenuzia = fabrica()
})(typeof self !== 'undefined' ? self : this, function () {
  const MONO = 'Iosevka Menuzia'
  const COND = 'Roboto Condensed Menuzia'
  const ESCALA_FONTE = { grande: 1, media: 0.92, pequena: 0.85 }
  const PRETO = '#111111'
  const CINZA_OBS = '#dadada'
  const BASE = { cozinha: 712, pre_conta: 719 }
  const MARGEM = { cozinha: 32, pre_conta: 35 }

  /** Fontes e logo que o desenho usa (caminhos relativos a quem carrega). */
  const RECURSOS = {
    fontes: [
      { familia: MONO, peso: '500', arquivo: 'iosevka-500.woff2' },
      { familia: MONO, peso: '600', arquivo: 'iosevka-600.woff2' },
      { familia: MONO, peso: '800', arquivo: 'iosevka-800.woff2' },
      { familia: COND, peso: '700', arquivo: 'roboto-condensed-700.woff2' },
    ],
    logo: 'logo-menuzia.png',
  }

  /** Carrega fontes (FontFace) e logo a partir de uma base de URL. Devolve { logo }. */
  async function carregarRecursos(baseFontes, urlLogo) {
    const doc = typeof document !== 'undefined' ? document : self
    for (const f of RECURSOS.fontes) {
      const ja = [...doc.fonts].some((x) => x.family.replace(/"/g, '') === f.familia && String(x.weight) === f.peso && x.status === 'loaded')
      if (ja) continue
      const ff = new FontFace(f.familia, `url(${baseFontes.replace(/\/$/, '')}/${f.arquivo})`, { weight: f.peso })
      await ff.load()
      doc.fonts.add(ff)
    }
    const logo = await new Promise((ok, erro) => {
      const img = new Image()
      img.onload = () => ok(img)
      img.onerror = () => erro(new Error('logo'))
      img.src = urlLogo
    })
    return { logo }
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
      ctx.font = `${peso} ${Math.max(11, tam).toFixed(2)}px "${familia}"`
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
    const quebrar = (s, maxW) => {
      const palavras = String(s).split(/\s+/).filter(Boolean)
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
    // Faixa preta com o título em branco, espaçado, centralizado.
    const faixa = (y, h, s, tam) => {
      ret(m, y, dir - m, h)
      fonte(MONO, '800', tam, tam * 0.07)
      texto(s, largura / 2 + tam * 0.035, y + (h - cap()) / 2, 'center', '#ffffff')
    }
    const tracejado = (y) => {
      if (!desenhar) return
      const traco = Math.max(3, U(9)), vao = Math.max(2, U(5)), esp = Math.max(1, U(2))
      ctx.fillStyle = '#333333'
      for (let x = m; x + traco <= dir + 0.5; x += traco + vao) ctx.fillRect(Math.round(x), Math.round(y), Math.round(traco), Math.round(esp))
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
    return { k, fe, U, T, m, dir, largura, fonte, cap, larg, texto, ret, quebrar, faixa, tracejado, qr }
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

  function logoTopo(ctx, p, logo, y, alturaModelo, desenhar) {
    const h = p.U(alturaModelo) * Math.min(1, p.fe + 0.08)
    const w = logo ? (h * logo.naturalWidth) / logo.naturalHeight : 0
    if (desenhar && logo) ctx.drawImage(logo, Math.round((p.largura - w) / 2), Math.round(y), Math.round(w), Math.round(h))
    return h
  }

  // ── comanda da cozinha ─────────────────────────────────────────────────────
  function layoutCozinha(ctx, doc, o, desenhar) {
    const p = criarPincel(ctx, o.largura, 'cozinha', o.tamanhoFonte, desenhar)
    const { U, T, m, dir, fonte, cap, larg, texto, ret, quebrar, faixa, tracejado } = p
    fonte(MONO, '500', T(29))
    const larguraRotulos = Math.max(0, ...doc.blocos.filter((b) => b.t === 'dado').map((b) => larg(b.rotulo)))
    let y = U(30)
    for (const b of doc.blocos) {
      switch (b.t) {
        case 'marcas': {
          if (desenhar) for (let x = 0; x < p.largura - 3; x += Math.max(24, p.largura / 16)) ret(x, y, 3, 12)
          if (desenhar) ret(p.largura - 3, y, 3, 12)
          y += 22
          break
        }
        case 'logo': y += logoTopo(ctx, p, o.logo, y, 95, desenhar); break
        case 'titulo': {
          y += T(14)
          fonte(MONO, '800', T(35), T(35) * 0.09)
          texto(b.s, p.largura / 2 + T(35) * 0.045, y, 'center')
          y += cap()
          break
        }
        case 'pedido': {
          // "Pedido #129 | ENTREGA" centrado — menor que o modelo (pedido do dono).
          y += T(20)
          // Mesa com nome comprido no papel estreito: a linha inteira encolhe para caber.
          const medir = (f) => {
            fonte(COND, '700', T(46) * f)
            const w1 = larg(b.numero); const c1 = cap()
            fonte(COND, '700', T(30) * f)
            const w2 = b.tipo ? larg(b.tipo) : 0; const c2 = cap()
            const sep = b.tipo ? T(26) * f : 0
            return { w1, c1, c2, sep, total: w1 + (b.tipo ? sep * 2 + w2 : 0) }
          }
          let f = 1
          let mm = medir(f)
          if (mm.total > dir - m) { f = (dir - m) / mm.total; mm = medir(f) }
          const { w1, c1, c2, sep, total } = mm
          const x = (p.largura - total) / 2
          fonte(COND, '700', T(46) * f)
          texto(b.numero, x, y)
          if (b.tipo) {
            ret(x + w1 + sep - U(1), y + c1 * 0.12, Math.max(1.5, U(2.5)), c1 * 0.8)
            fonte(COND, '700', T(30) * f)
            texto(b.tipo, x + w1 + sep * 2, y + (c1 - c2) / 2)
          }
          y += c1
          break
        }
        case 'horas': {
          y += T(19)
          fonte(MONO, '500', T(30))
          texto(b.s, p.largura / 2, y, 'center')
          y += cap()
          break
        }
        case 'aviso': {
          y += T(14)
          fonte(MONO, '800', T(26))
          for (const ln of quebrar(b.s, dir - m)) { texto(ln, p.largura / 2, y, 'center'); y += cap() + T(8) }
          y -= T(8)
          break
        }
        case 'faixa': { y += T(20); const h = T(40); faixa(y, h, b.s, T(28)); y += h; break }
        case 'item': {
          y += T(b.primeiro ? 19 : 26)
          fonte(MONO, '800', T(44))
          const xq = m + U(17)
          const wq = larg(b.qtd)
          const xn = xq + wq + larg(' ') * 0.9
          texto(b.qtd, xq, y)
          const ls = quebrar(b.nome, dir - xn)
          ls.forEach((ln, i) => texto(ln, xn, y + i * T(46)))
          y += cap() + (ls.length - 1) * T(46)
          // Adicionais: 1º a 11 pontos do item, depois um a cada 34 (modelo).
          fonte(MONO, '500', T(30))
          let primeiroSub = true
          for (const s of b.subs || []) {
            for (const ln of quebrar(s, dir - xn)) {
              y += primeiroSub ? T(11) : T(34) - cap()
              primeiroSub = false
              texto(ln, xn, y)
              y += cap()
            }
          }
          // Observação: fundo cinza claro atrás do texto (modelo).
          if (b.obs) {
            fonte(MONO, '600', T(29))
            const pad = U(24), padV = T(13)
            const ls2 = quebrar(b.obs, dir - xn - 2 * pad)
            const larguraCaixa = Math.min(dir - xn, Math.max(...ls2.map(larg)) + 2 * pad)
            const topoCaixa = y + T(primeiroSub ? 14 : 8)
            const alturaCaixa = ls2.length * cap() + (ls2.length - 1) * T(10) + 2 * padV
            ret(xn, topoCaixa, larguraCaixa, alturaCaixa, CINZA_OBS)
            ls2.forEach((ln, i) => texto(ln, xn + pad, topoCaixa + padV + i * (cap() + T(10))))
            y = topoCaixa + alturaCaixa
          }
          break
        }
        case 'obs_pedido': {
          y += T(22)
          fonte(MONO, '600', T(29))
          const pad = U(20), padV = T(13)
          const ls = quebrar(b.s, dir - m - 2 * pad)
          const h = ls.length * cap() + (ls.length - 1) * T(10) + 2 * padV
          ret(m, y, dir - m, h, CINZA_OBS)
          ls.forEach((ln, i) => texto(ln, m + pad, y + padV + i * (cap() + T(10))))
          y += h
          break
        }
        case 'par': {
          y += T(b.primeiro ? 14 : 14)
          fonte(MONO, '500', T(30))
          texto(b.rotulo, m + U(8), y)
          if (b.negrito) fonte(MONO, '600', T(30))
          texto(b.valor, dir - U(9), y, 'right')
          y += cap()
          break
        }
        case 'tracejado': { y += T(12); tracejado(y); y += Math.max(1, U(2)); break }
        case 'total': {
          y += T(14)
          const h = T(67)
          ret(m, y, dir - m, h)
          fonte(COND, '700', T(58))
          const c = cap()
          texto(b.rotulo, m + U(19), y + (h - c) / 2, 'left', '#ffffff')
          texto(b.valor, dir - U(15), y + (h - c) / 2, 'right', '#ffffff')
          y += h
          break
        }
        case 'dado': {
          y += T(b.primeiro ? 15 : 13)
          fonte(MONO, '500', T(29))
          // Coluna do valor: a do modelo ou, com rótulo maior ("Atendente:"), logo depois dele.
          const col = Math.max(m + U(154), m + U(10) + larguraRotulos + larg(' '))
          texto(b.rotulo, m + U(10), y)
          fonte(MONO, b.negrito ? '800' : '500', T(29))
          const ls = quebrar(b.valor, dir - col)
          ls.forEach((ln, i) => texto(ln, col, y + i * T(33)))
          y += cap() + (ls.length - 1) * T(33)
          break
        }
        case 'qr': {
          y += T(25)
          const lado = T(132)
          const real = p.qr(b.linhas, (p.largura - lado) / 2, y, lado, b.icone)
          y += real
          break
        }
        case 'rodape': {
          y += T(11)
          for (const l of b.linhas) {
            fonte(MONO, l.negrito ? '800' : '500', T(21))
            y += T(8)
            texto(l.s, p.largura / 2, y, 'center')
            y += cap()
          }
          break
        }
        default: break
      }
    }
    return y + T(34)
  }

  // ── pré-conta ─────────────────────────────────────────────────────────────
  function layoutPreConta(ctx, doc, o, desenhar) {
    const p = criarPincel(ctx, o.largura, 'pre_conta', o.tamanhoFonte, desenhar)
    const { U, T, m, dir, fonte, cap, larg, texto, quebrar, faixa, tracejado } = p
    let y = U(96)
    const colQtd = m + U(31)
    const colDesc = m + U(121)
    for (const b of doc.blocos) {
      switch (b.t) {
        case 'marcas': {
          if (desenhar) for (let x = 0; x < p.largura - 3; x += Math.max(24, p.largura / 16)) p.ret(x, y, 3, 12)
          if (desenhar) p.ret(p.largura - 3, y, 3, 12)
          y += 22
          break
        }
        case 'logo': y += logoTopo(ctx, p, o.logo, y, 109, desenhar); break
        case 'titulo': {
          y += T(39)
          fonte(MONO, '800', T(40), T(40) * 0.1)
          texto(b.s, p.largura / 2 + T(40) * 0.05, y, 'center')
          y += cap()
          break
        }
        case 'linha': {
          y += T(b.primeiro ? 17 : 17)
          fonte(MONO, b.negrito ? '600' : '500', T(33))
          for (const ln of quebrar(b.s, dir - m)) { texto(ln, p.largura / 2, y, 'center'); y += cap() + T(17) }
          y -= T(17)
          break
        }
        case 'aviso': {
          y += T(16)
          fonte(MONO, '800', T(27))
          for (const ln of quebrar(b.s, dir - m)) { texto(ln, p.largura / 2, y, 'center'); y += cap() + T(8) }
          y -= T(8)
          break
        }
        case 'faixa': { y += T(b.primeiro ? 42 : 49); const h = T(b.alta ? 57 : 53); faixa(y, h, b.s, T(34)); y += h; break }
        case 'tabela_cab': {
          y += T(22)
          fonte(MONO, '500', T(31))
          texto('QTD', m + U(10), y)
          texto('DESCRICAO', colDesc, y)
          texto('TOTAL', dir - U(11), y, 'right')
          y += cap()
          break
        }
        case 'tracejado': { y += T(b.depois === 'tabela' ? 21 : b.depois === 'total' ? 34 : 23); tracejado(y); y += Math.max(1, U(2)); break }
        case 'tabela_item': {
          y += T(b.primeiro ? 23 : 26)
          fonte(MONO, '500', T(33))
          texto(b.qtd, colQtd, y, 'center')
          const wt = larg(b.total)
          texto(b.total, dir - U(7), y, 'right')
          const ls = quebrar(b.desc, dir - U(7) - wt - U(18) - colDesc)
          ls.forEach((ln, i) => texto(ln, colDesc, y + i * T(40)))
          y += cap() + (ls.length - 1) * T(40)
          fonte(MONO, '500', T(25))
          for (const s of b.subs || []) {
            for (const ln of quebrar(s, dir - colDesc - U(10))) { y += T(10); texto(ln, colDesc + U(10), y, 'left', '#333333'); y += cap() }
          }
          break
        }
        case 'par': {
          y += T(b.primeiro ? 21 : 24)
          fonte(MONO, '500', T(33))
          texto(b.rotulo, m + U(13), y)
          texto(b.valor, dir - U(7), y, 'right')
          y += cap()
          break
        }
        case 'total': {
          y += T(26)
          fonte(COND, '700', T(64))
          texto(b.rotulo, m + U(12), y)
          texto(b.valor, dir - U(6), y, 'right')
          y += cap()
          break
        }
        case 'rodape_qr': {
          y += T(31)
          const lado = T(180)
          const xq = dir - U(24) - lado
          const real = b.linhas && p.qr ? (b.qr ? p.qr(b.qr.linhas, xq, y, lado, b.qr.icone) : 0) : 0
          const temQr = !!(b.qr && real)
          fonte(MONO, '500', T(26))
          const c = cap()
          const passo = T(36)
          const hTexto = b.linhas.length * c + (b.linhas.length - 1) * (passo - c)
          const alturaBloco = temQr ? Math.max(real, lado) : hTexto
          // Como o modelo: o texto encosta embaixo, perto do fim do QR. Sem QR: centrado.
          let yt = temQr ? y + Math.max(0, alturaBloco - hTexto - T(10)) : y
          for (const l of b.linhas) {
            fonte(MONO, l.negrito ? '600' : '500', T(26))
            const maxW = temQr ? xq - U(14) - (m + U(16)) : dir - m
            for (const ln of quebrar(l.s, maxW)) {
              if (temQr) texto(ln, m + U(16), yt)
              else texto(ln, p.largura / 2, yt, 'center')
              yt += passo
            }
          }
          y += temQr ? alturaBloco : Math.max(hTexto, yt - passo + c - y)
          break
        }
        default: break
      }
    }
    return y + T(40)
  }

  /**
   * Desenha o documento num canvas (já criado) e devolve a altura usada.
   * o = { larguraMm, larguraPontos, tamanhoFonte, logo (Image) }
   */
  function desenhar(canvas, doc, o = {}) {
    const largura = larguraEmPontos(o.larguraMm, o.larguraPontos)
    const ctx = canvas.getContext('2d')
    const opcoes = { largura, tamanhoFonte: o.tamanhoFonte || 'grande', logo: o.logo }
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

  return { desenhar, carregarRecursos, larguraEmPontos, RECURSOS, ESCALA_FONTE }
})
