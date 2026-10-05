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
  // Faixa da OBS: cinza da referência (210). No papel vira RETÍCULA uniforme (1 bit).
  const CINZA_OBS = '#d2d2d2'
  // Largura dos modelos em pixels e a margem do texto. A comanda segue
  // docs/referencias/impressao/comanda-padrao.png (papel de 1200 px, margem 48 → ×1,025).
  // Modelo oficial v3 (docs/impressao-final/referencias/*_v3.png): papel de 432 px, margem 23.
  const BASE = { cozinha: 1230, pre_conta: 1020, v3: 432 }
  const MARGEM = { cozinha: 49, pre_conta: 54, v3: 23 }
  // Preto e branco de verdade (B1): tudo vira 1 bit no tamanho exato de pontos. Limiar do
  // texto por intensidade; "mais escura" ainda engrossa o traço em 1 ponto.
  const INTENSIDADES = { normal: 150, escura: 185, mais_escura: 210 }

  /** Fontes que o desenho usa (caminhos relativos a quem carrega). */
  const RECURSOS = {
    fontes: [
      { familia: MONO, peso: '500', arquivo: 'iosevka-500.woff2' },
      { familia: MONO, peso: '600', arquivo: 'iosevka-600.woff2' },
      { familia: MONO, peso: '800', arquivo: 'iosevka-800.woff2' },
      { familia: COND, peso: '400', arquivo: 'roboto-condensed-400.woff2' },
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
      // Logo do Storage (outro domínio, na prévia do painel): pedida com CORS, senão o
      // canvas fica "sujo" e não dá para ler os pixels (conversão para 1 bit).
      if (!/^data:/.test(String(url))) img.crossOrigin = 'anonymous'
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
  function criarPincel(ctx, largura, modelo, tamanhoFonte, desenhar, o = {}) {
    const k = largura / BASE[modelo]
    const fe = ESCALA_FONTE[tamanhoFonte] || 1
    const U = (v) => v * k // horizontal / estrutura
    const T = (v) => v * k * fe // letra e passo vertical
    const m = U(MARGEM[modelo])
    // v3: a coluna de valores termina a 20 px da borda (o texto começa a 23).
    const dir = largura - (modelo === 'v3' ? U(20) : m)
    const capCache = new Map()
    // Pré-conta (B1): letra fina/pequena sumia na térmica. Tamanho mínimo e um traço de
    // reforço no texto regular (efeito "medium") — o desenho continua o mesmo.
    const minFonte = modelo === 'pre_conta' ? 17 : 11
    // v3: sem reforço — o traço regular da DejaVu Sans Mono já é o do modelo.
    const reforco = modelo === 'pre_conta'
    let tamAtual = 0
    let pesoAtual = '400'

    const fonte = (familia, peso, tam, espaco = 0) => {
      tamAtual = Math.max(minFonte, tam)
      pesoAtual = String(peso)
      ctx.font = `${peso} ${tamAtual.toFixed(2)}px "${familia}"`
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
      if (reforco && pesoAtual === '400' && cor !== '#ffffff') {
        ctx.save()
        ctx.strokeStyle = cor
        ctx.lineWidth = Math.max(0.5, tamAtual * 0.03)
        ctx.lineJoin = 'round'
        ctx.strokeText(s, x, topo + cap())
        ctx.restore()
      }
    }
    // Área que no papel vira retícula (faixa cinza, logo) em vez de limiar.
    const reticula = (x, y, w, h) => {
      if (desenhar && Array.isArray(o.reticulas)) o.reticulas.push({ x: Math.floor(x), y: Math.floor(y), w: Math.ceil(w), h: Math.ceil(h) })
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
    return { k, fe, U, T, m, dir, largura, fonte, cap, larg, texto, ret, quebrar, espacoPara, faixa, tracejado, pontilhado, qr, marcas, reticula }
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
        p.reticula((p.largura - w) / 2, y, w, h)
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
    const p = criarPincel(ctx, o.largura, 'cozinha', o.tamanhoFonte, desenhar, o)
    const { U, T, m, dir, fonte, cap, larg, texto, ret, quebrar, faixa, tracejado, pontilhado } = p
    // Opção da loja "Fonte maior na via de produção": itens um pouco maiores.
    const fi = doc.fonteMaior ? 1.12 : 1
    // Dados (mesa/entrega/retirada): rótulos numa coluna, valores logo depois do maior.
    fonte(DVSM, '400', T(53.4))
    const larguraRotulos = Math.max(0, ...doc.blocos.filter((b) => b.t === 'dado').map((b) => larg(b.rotulo)))
    // Observação: faixa cinza na largura toda (retícula no papel), texto em negrito grande.
    const faixaObs = (s, topo) => {
      fonte(COND, '700', T(49) * fi)
      const padX = U(20.5)
      const lo = quebrar(s, dir - m - 2 * padX)
      const c = cap(), passo = T(14)
      const padV = Math.max(T(10), (T(71.7) - c) / 2)
      const h = lo.length * c + (lo.length - 1) * passo + 2 * padV
      ret(m, topo, dir - m, h, CINZA_OBS)
      p.reticula(m, topo, dir - m, h)
      lo.forEach((ln, i) => texto(ln, m + padX, topo + padV + i * (c + passo)))
      return topo + h
    }
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
          y += T(anterior === 'total' ? 29.7 : anterior === 'horas' ? 34.9 : 40)
          const h = T(68.7)
          const alvo = { 'ITENS DO PEDIDO': U(418), VALORES: U(190), 'DADOS DA ENTREGA': U(445), 'DADOS DA MESA': U(365), 'DADOS DO CLIENTE': U(440), 'DADOS DA RETIRADA': U(470) }[b.s]
          faixa(y, h, b.s, MONO, '800', T(40), alvo ? alvo * p.fe : null)
          y += h
          break
        }
        case 'itens_cab': {
          y += T(35.9)
          fonte(COND, '700', T(31.7))
          texto(b.esq, m + U(2), y)
          texto(b.dir, dir, y, 'right')
          y += cap()
          break
        }
        case 'item': {
          if (b.primeiro) y += T(39)
          else { y += T(25.6); pontilhado(y); y += Math.max(1, U(5)) + T(44) }
          fonte(COND, '700', T(64.9) * fi)
          const wv = b.valor ? larg(b.valor) : 0
          texto(b.valor || '', dir, y, 'right')
          const ls = quebrar(b.texto, dir - m - (wv ? wv + U(24) : 0))
          ls.forEach((ln, i) => texto(ln, m, y + i * T(72) * fi))
          y += cap() + (ls.length - 1) * T(72) * fi
          // Complementos: condensada regular GRANDE (~80% do item), na margem, valor à direita.
          fonte(COND, '400', T(50.5) * fi)
          let primeiroSub = true
          for (const s of b.subs || []) {
            const wsv = s.valor ? larg(s.valor) : 0
            const lsub = quebrar(s.s, dir - m - (wsv ? wsv + U(24) : 0))
            lsub.forEach((ln, i) => {
              y += primeiroSub ? T(29.7) : i === 0 ? T(18) : T(12)
              primeiroSub = false
              texto(ln, m, y)
              if (i === 0 && s.valor) texto(s.valor, dir, y, 'right')
              y += cap()
            })
          }
          if (b.obs) y = faixaObs(b.obs, y + T((b.subs || []).length ? 9.2 : 16))
          break
        }
        case 'obs_pedido': {
          y = faixaObs(b.s, y + T(29))
          break
        }
        case 'par': {
          // Valores em monoespaçada GRANDE: rótulo à esquerda, valor à direita.
          fonte(DVSM, '400', T(47.8))
          y += b.primeiro ? T(32.8) : T(64) - cap()
          texto(b.rotulo, m + U(8), y)
          if (b.negrito) fonte(DVSM, '700', T(47.8))
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
          // Linha dupla tracejada embaixo dos valores.
          y += T(30.8)
          tracejado(y, U(15.5), U(8.5), Math.max(1, U(4.1)), '#000000')
          y += T(12.3)
          tracejado(y, U(15.5), U(8.5), Math.max(1, U(4.1)), '#000000')
          y += Math.max(1, U(4.1))
          break
        }
        case 'total': {
          // TOTAL sem fundo: preto, condensado, negrito e MUITO grande. Valor comprido
          // (R$ 1.234,56 em 58 mm) diminui até caber sem encostar no rótulo.
          y += T(64.6)
          let tam = T(105.2)
          fonte(COND, '700', tam)
          while (larg(b.rotulo) + larg(b.valor) + U(40) > dir - m - U(7) && tam > T(40)) { tam *= 0.94; fonte(COND, '700', tam) }
          texto(b.rotulo, m + U(7), y)
          texto(b.valor, dir, y, 'right')
          y += cap()
          break
        }
        case 'dado': {
          // Monoespaçada GRANDE: rótulo regular numa coluna, valor (negrito) na segunda;
          // quebra de linha alinhada na coluna do valor, nunca embaixo do rótulo.
          fonte(DVSM, '400', T(53.4))
          y += b.primeiro ? T(35.9) : T(76) - cap()
          const col = Math.max(m + U(250), m + U(8) + larguraRotulos + larg(' '))
          texto(b.rotulo, m + U(8), y)
          fonte(DVSM, b.negrito ? '700' : '400', T(53.4))
          const ls = quebrar(b.valor, dir - col)
          ls.forEach((ln, i) => texto(ln, col, y + i * T(64)))
          y += cap() + (ls.length - 1) * T(64)
          break
        }
        case 'separador': {
          // Pontilhado na largura toda entre os dados do pedido e o rodapé.
          y += T(52.3)
          pontilhado(y)
          y += Math.max(1, U(5))
          break
        }
        case 'rodape_loja': {
          // Duas colunas: dados da LOJA à esquerda e o QR do cardápio à direita (topo do QR
          // junto do nome). Papel estreito com a coluna apertada: QR embaixo, centralizado.
          const loja = b.loja || {}
          const qrOk = !!(b.qr && Array.isArray(b.qr.linhas) && b.qr.linhas.length >= 21)
          const lado = T(261.4)
          const linhas = []
          if (loja.nome) linhas.push({ s: loja.nome, peso: '700', tam: T(40.1), passo: 0 })
          const regulares = [loja.telefone ? `Tel.: ${loja.telefone}` : '', loja.linha1, loja.cidade].filter(Boolean)
          regulares.forEach((s, i) => linhas.push({ s, peso: '400', tam: T(34.4), passo: i === 0 && loja.nome ? T(62.5) : T(49.2) }))
          ;(qrOk ? b.chamada || [] : []).forEach((s, i) => linhas.push({ s, peso: i === 0 ? '700' : '400', tam: T(32.9), passo: i === 0 ? T(65.6) : T(47.2) }))
          if (linhas.length || qrOk) {
            const xq = dir - lado
            const disponivel = xq - U(30) - m
            let maisLarga = 0
            for (const l of linhas) { fonte(SANS, l.peso, l.tam); maisLarga = Math.max(maisLarga, larg(l.s)) }
            const ladoALado = qrOk && !(p.largura <= 450 && maisLarga > disponivel)
            const maxW = ladoALado ? disponivel : dir - m
            y += T(39)
            const yq = y
            let topo = qrOk && ladoALado ? y + T(22.5) : y
            let fim = y
            let primeira = true
            for (const l of linhas) {
              fonte(SANS, l.peso, l.tam)
              quebrar(l.s, maxW).forEach((ln, i) => {
                if (!primeira) topo += i === 0 ? l.passo : cap() * 1.45
                primeira = false
                texto(ln, m, topo)
                fim = topo + cap()
              })
            }
            y = linhas.length ? fim : y
            if (qrOk) {
              if (ladoALado) y = Math.max(y, yq + p.qr(b.qr.linhas, xq, yq, lado, b.qr.icone))
              else { y += linhas.length ? T(34) : 0; y += p.qr(b.qr.linhas, (p.largura - lado) / 2, y, lado, b.qr.icone) }
            }
          }
          y += T(47)
          tracejado(y, U(15.5), U(8.5), Math.max(1, U(3)), '#000000')
          y += Math.max(1, U(3))
          if (b.final) {
            fonte(SANS, '400', T(27.9))
            y += T(36)
            texto(b.final, p.largura / 2, y, 'center')
            y += cap()
          }
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
    return y + T(24)
  }

  // ── teste de largura (Calibrar impressora) ──────────────────────────────────
  // Barras pretas no primeiro e no último ponto, régua numerada em pontos, o que o sistema
  // aplica (papel, pontos, envio, intensidade, modo), acentos, negrito e uma faixa em
  // retícula — para o cliente conferir no papel se nada corta nem some.
  function layoutLargura(ctx, doc, o, desenhar) {
    const p = criarPincel(ctx, o.largura, 'cozinha', o.tamanhoFonte, desenhar, o)
    const { U, T, m, dir, fonte, cap, larg, texto, ret, quebrar, faixa } = p
    const W = p.largura
    const barra = Math.max(4, Math.round(W / 96))
    const regua = (y0) => {
      const h = T(96)
      ret(0, y0, barra, h)
      ret(W - barra, y0, barra, h)
      for (let x = 16; x < W - barra; x += 16) {
        const alto = x % 64 === 0 ? T(44) : T(22)
        ret(x, y0 + h - alto, Math.max(1, Math.round(W / 384)), alto)
      }
      fonte(MONO, '600', T(28))
      for (let x = 64; x < W - U(60); x += 64) texto(String(x), x, y0 + T(6), 'center')
      texto(String(W), W - barra - U(6), y0 + T(6), 'right')
      return y0 + h
    }
    let y = regua(0)
    y += T(30)
    faixa(y, T(68.7), 'TESTE DE LARGURA', MONO, '800', T(40), null)
    y += T(68.7)
    fonte(DVSM, '400', T(40))
    const larguraRot = Math.max(0, ...(doc.linhas || []).map((l) => larg(l.rotulo)))
    for (const l of doc.linhas || []) {
      fonte(DVSM, '400', T(40))
      y += T(28)
      const col = m + larguraRot + larg(' ')
      texto(l.rotulo, m, y)
      fonte(DVSM, '700', T(40))
      const ls = quebrar(String(l.valor), dir - col)
      ls.forEach((ln, i) => texto(ln, col, y + i * T(50)))
      y += cap() + (ls.length - 1) * T(50)
    }
    y += T(34)
    fonte(COND, '700', T(64.9))
    texto('ÇÃÉÕ çãéõ áíú', m, y)
    y += cap() + T(26)
    fonte(COND, '400', T(50.5))
    texto('Texto regular: ÂÊÔ à ü  R$ 1.234,56', m, y)
    y += cap() + T(26)
    fonte(DVSM, '400', T(30))
    texto('Texto pequeno: 0123456789 ABCDEFGHIJ', m, y)
    y += cap() + T(26)
    fonte(COND, '700', T(49))
    const h = T(71.7)
    ret(m, y, dir - m, h, CINZA_OBS)
    p.reticula(m, y, dir - m, h)
    texto('FAIXA CINZA (OBS)', m + U(20.5), y + (h - cap()) / 2)
    y += h + T(30)
    fonte(SANS, '400', T(32))
    for (const s of doc.instrucoes || []) {
      for (const ln of quebrar(s, dir - m)) { texto(ln, m, y); y += cap() + T(12) }
      y += T(10)
    }
    y += T(20)
    return regua(y)
  }

  // ── modelo oficial v3 (comanda_v3.png / preconta_v3.png, papel de 432 px) ──────
  // Tudo em DejaVu Sans Mono. Distâncias = do fim da tinta do bloco anterior ao topo da
  // tinta do próximo, medidas nos modelos; escalam pela largura real (384/512/576 pontos).
  function layoutV3(ctx, doc, o, desenhar) {
    const p = criarPincel(ctx, o.largura, 'v3', o.tamanhoFonte, desenhar, o)
    const { U, T, m, dir, fonte, cap, larg, texto, ret, quebrar } = p
    const W = p.largura
    const cozinha = doc.via === 'cozinha'
    // Via da cozinha: itens e observações maiores (sem valores, sobra largura).
    // "Fonte maior na via de produção": um pouco maiores também na comanda.
    const fi = cozinha ? 1.25 : doc.fonteMaior ? 1.12 : 1
    const x0 = m - U(6), x1 = dir + U(7) // tracejados e linhas passam um pouco das margens
    const tracejado = (y) => {
      if (!desenhar) return
      ctx.fillStyle = '#000000'
      const traco = U(7), vao = U(5), h = Math.max(1, Math.round(U(2)))
      for (let x = x0; x + traco <= x1 + 0.5; x += traco + vao) ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(traco)), h)
    }
    const espessura = Math.max(1, Math.round(U(2)))
    // Linhas centralizadas que quebram por palavra.
    const centro = (s, y, passo) => {
      const ls = quebrar(s, dir - m)
      ls.forEach((ln, i) => texto(ln, W / 2, y + i * passo, 'center'))
      return y + cap() + (ls.length - 1) * passo
    }
    // Partes de endereço: juntas com " - " enquanto cabem; a linha seguinte começa na parte
    // (nunca com hífen). Parte maior que a linha quebra por palavra.
    const juntarPartes = (ps, maxW, primeiraMax = maxW) => {
      const out = []
      let cur = ''
      for (const parte of ps) {
        const lim = out.length ? maxW : primeiraMax
        const t = cur ? `${cur} - ${parte}` : parte
        if (larg(t) <= lim) { cur = t; continue }
        if (cur) out.push(cur)
        const lim2 = out.length ? maxW : primeiraMax
        if (larg(parte) <= lim2) cur = parte
        else { const q = quebrar(parte, lim2); out.push(...q.slice(0, -1)); cur = q[q.length - 1] }
      }
      if (cur) out.push(cur)
      return out
    }
    let y = U(16)
    let anterior = ''
    for (const b of doc.blocos) {
      switch (b.t) {
        case 'marcas': {
          if (anterior) y += T(20)
          p.marcas(y, U(14))
          y += U(14)
          break
        }
        case 'logo': {
          // Sem logo (ou "Imprimir logo" desligado): nada; o nome da loja vem logo abaixo.
          const h = topoDaLoja(ctx, p, b, o, y + (anterior ? U(12) : 0), { w: U(300), h: U(170), nomeTam: 0 }, desenhar)
          if (!h) continue
          y += h + (anterior ? U(12) : 0)
          break
        }
        case 'loja_nome': {
          y += anterior === 'logo' ? U(17) : anterior ? T(14) : 0
          // Nome comprido: diminui até caber em duas linhas no máximo.
          let tam = T(26)
          fonte(DVSM, '700', tam)
          while (quebrar(b.s, dir - m).length > 2 && tam > T(17)) { tam *= 0.94; fonte(DVSM, '700', tam) }
          y = centro(b.s, y, T(32))
          break
        }
        case 'loja_endereco': {
          y += T(14)
          fonte(DVSM, '400', T(17))
          const ls = juntarPartes(b.partes, dir - m)
          ls.forEach((ln, i) => texto(ln, W / 2, y + i * T(22), 'center'))
          y += cap() + (ls.length - 1) * T(22)
          break
        }
        case 'loja_telefone': {
          y += T(17.5)
          fonte(DVSM, '700', T(22))
          texto(b.s, W / 2, y, 'center')
          y += cap()
          break
        }
        case 'data': {
          y += T(17)
          fonte(DVSM, '400', T(24))
          y = centro(b.s, y, T(30))
          break
        }
        case 'tipo': {
          y += T(18.5)
          fonte(DVSM, '700', T(26))
          y = centro(b.s, y, T(32))
          break
        }
        case 'aviso': {
          y += T(16)
          fonte(DVSM, '700', T(18))
          y = centro(b.s, y, T(24))
          break
        }
        case 'tracejado': {
          y += b.antes === 'final' ? T(16) : b.antes === 'rodape' ? T(23) : anterior === 'aviso' ? T(14) : T(15)
          tracejado(y)
          y += espessura
          break
        }
        case 'faixa': {
          y += anterior === 'tracejado' ? T(10) : anterior === 'faixa' ? T(13) : anterior === 'texto' ? T(16) : anterior === 'nota' ? T(20) : T(24)
          const h = T(46)
          ret(0, y, W, h)
          fonte(DVSM, '700', T(24))
          const s = larg(b.s) > W - 2 * m ? quebrar(b.s, W - 2 * m)[0] : b.s
          texto(s, W / 2, y + (h - cap()) / 2, 'center', '#ffffff')
          y += h
          break
        }
        case 'item': {
          if (b.primeiro) y += T(17)
          else { y += T(14); tracejado(y); y += espessura + T(14) }
          // Valor (regular) na mesma linha de base do nome (negrito); o nome quebra antes de
          // chegar a um espaço do valor.
          fonte(DVSM, '400', T(25))
          const wv = b.valor ? larg(b.valor) : 0
          const capV = cap()
          const folga = b.valor ? larg('0') : 0
          fonte(DVSM, '700', T(28.4) * fi)
          const c = cap()
          const passo = T(38) * fi
          const ls = quebrar(b.texto, dir - m - (wv ? wv + folga : 0))
          ls.forEach((ln, i) => texto(ln, m, y + i * passo))
          if (b.valor) { fonte(DVSM, '400', T(25)); texto(b.valor, dir, y + c - capV, 'right') }
          y += c + (ls.length - 1) * passo
          if (b.obs) {
            // Observação do item: logo abaixo, em negrito, numa caixa (destaque no papel).
            y += T(10)
            fonte(DVSM, '700', T(23) * fi)
            const pad = U(7), borda = Math.max(2, Math.round(U(2)))
            const lo = quebrar(b.obs, dir - m - 2 * pad - 2 * borda)
            const co = cap(), po = T(29) * fi
            const h = co + (lo.length - 1) * po + 2 * pad + 2 * borda
            ret(m, y, dir - m, borda); ret(m, y + h - borda, dir - m, borda)
            ret(m, y, borda, h); ret(dir - borda, y, borda, h)
            lo.forEach((ln, i) => texto(ln, m + borda + pad, y + borda + pad + i * po))
            y += h
          }
          break
        }
        case 'obs_geral': {
          y += T(16)
          fonte(DVSM, '700', T(25) * fi)
          const ls = quebrar(b.s, dir - m)
          ls.forEach((ln, i) => texto(ln, m, y + i * T(33) * fi))
          y += cap() + (ls.length - 1) * T(33) * fi
          break
        }
        case 'par': {
          fonte(DVSM, '400', T(26))
          y += b.primeiro ? (anterior === 'linha' ? T(11) : T(14)) : T(33) - cap()
          // Rótulo comprido: quebra antes de encostar no valor.
          const wv = larg(b.valor)
          const ls = quebrar(b.rotulo, dir - m - wv - larg('0'))
          texto(b.valor, dir, y, 'right')
          ls.forEach((ln, i) => texto(ln, m, y + i * T(33)))
          y += cap() + (ls.length - 1) * T(33)
          break
        }
        case 'linha': {
          y += T(11)
          ret(x0, y, dir + U(3) - x0, espessura)
          y += espessura
          break
        }
        case 'total': {
          y += anterior === 'linha' ? T(15) : T(20)
          // TOTAL grande; valor comprido diminui até caber com um espaço entre os dois.
          let tam = T(42)
          fonte(DVSM, '700', tam)
          while (larg(b.rotulo) + larg(b.valor) + larg('0') > dir - m && tam > T(20)) { tam *= 0.97; fonte(DVSM, '700', tam) }
          texto(b.rotulo, m, y)
          texto(b.valor, dir, y, 'right')
          y += cap()
          break
        }
        case 'texto': {
          y += anterior === 'total' ? T(27) : T(14)
          fonte(DVSM, '400', T(26))
          const ls = quebrar(b.s, dir - m)
          ls.forEach((ln, i) => texto(ln, m, y + i * T(33)))
          y += cap() + (ls.length - 1) * T(33)
          break
        }
        case 'nota': {
          y += T(22)
          // Uma linha só, passando das margens como no modelo (14 px de cada lado); se não
          // couber, diminui um pouco e, no limite, quebra centralizada.
          let tam = T(15)
          fonte(DVSM, '400', tam)
          while (larg(b.s) > W - 2 * U(14) && tam > Math.max(12, T(12))) { tam *= 0.96; fonte(DVSM, '400', tam) }
          const ls = quebrar(b.s, W - 2 * U(14))
          ls.forEach((ln, i) => texto(ln, W / 2, y + i * T(19), 'center'))
          y += cap() + (ls.length - 1) * T(19)
          break
        }
        case 'dado': {
          fonte(DVSM, '400', T(25))
          y += b.primeiro ? T(14) : T(33) - cap()
          // "End.: rua, nº" e as outras partes nas linhas seguintes, sem hífen no começo.
          const wr = larg(`${b.rotulo} `)
          const ls = juntarPartes(b.partes, dir - m, dir - m - wr)
          ls.forEach((ln, i) => texto(i === 0 ? `${b.rotulo} ${ln}` : ln, m, y + i * T(33)))
          y += cap() + (ls.length - 1) * T(33)
          break
        }
        case 'rodape': {
          if (b.qr) {
            y += T(14)
            const lado = U(125)
            y += p.qr(b.qr.linhas, (W - lado) / 2, y, lado, b.qr.icone)
          }
          if (b.frase) {
            y += b.qr ? T(12) : T(14)
            fonte(DVSM, '400', T(17))
            y = centro(b.frase, y, T(22))
          }
          if (b.agradecimento) {
            y += b.frase ? T(19.6) : b.qr ? T(14) : T(14)
            fonte(DVSM, '700', T(22))
            y = centro(b.agradecimento, y, T(28))
          }
          break
        }
        case 'final': {
          y += T(14)
          fonte(DVSM, '400', T(17))
          y = centro(b.s, y, T(22))
          break
        }
        default: break
      }
      anterior = b.t
    }
    return y + T(22)
  }

  /** Converte o desenho em 1 bit (preto/branco puro) — o driver não tem mais o que clarear. */
  function monocromatizar(ctx, w, h, reticulas, intensidade) {
    let img
    try {
      img = ctx.getImageData(0, 0, w, h)
    } catch {
      // Canvas "sujo" (imagem de outro domínio sem CORS): mantém o desenho como está.
      return
    }
    const d = img.data
    const limiar = INTENSIDADES[intensidade] || INTENSIDADES.normal
    const mascara = new Uint8Array(w * h)
    for (const r of reticulas || []) {
      const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(w, r.x + r.w), y1 = Math.min(h, r.y + r.h)
      for (let y = y0; y < y1; y++) mascara.fill(1, y * w + x0, y * w + x1)
    }
    // Bayer 4×4: padrão uniforme e legível para o cinza (faixa da OBS, logo).
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
    const preto = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const lum = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000
        // Quase branco fica branco (sem pontos soltos em volta da logo); escuro é sólido.
        if (mascara[i]) preto[i] = lum < 100 || (lum < 235 && lum < (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) * 14.72) ? 1 : 0
        else preto[i] = lum < limiar ? 1 : 0
      }
    }
    let final = preto
    if (intensidade === 'mais_escura') {
      final = new Uint8Array(w * h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          final[i] = preto[i] || (!mascara[i] && ((x > 0 && preto[i - 1]) || (y > 0 && preto[i - w]))) ? 1 : 0
        }
      }
    }
    for (let i = 0; i < w * h; i++) {
      const v = final[i] ? 0 : 255
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }

  /** Linhas de 1 bit empacotadas (1 = preto, bit mais alto à esquerda) — para o ESC/POS. */
  function bitsDoCanvas(canvas) {
    const w = canvas.width, h = canvas.height
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data
    const porLinha = Math.ceil(w / 8)
    const bits = new Uint8Array(porLinha * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (d[i] < 128) bits[y * porLinha + (x >> 3)] |= 0x80 >> (x & 7)
      }
    }
    return { bits, largura: w, altura: h, porLinha }
  }

  // ── pré-conta (modelo v3/PRE-CONTA.png, 1020 px) ────────────────────────────
  function layoutPreConta(ctx, doc, o, desenhar) {
    const p = criarPincel(ctx, o.largura, 'pre_conta', o.tamanhoFonte, desenhar, o)
    const { U, T, m, dir, fonte, cap, larg, texto, quebrar, faixa, tracejado } = p
    let y = U(29)
    let anterior = ''
    // Colunas: QTD só com o necessário; a descrição começa logo depois; TOTAL só o número.
    const colQtd = m + U(24)
    // Descrição logo depois de 'QTD' (com a letra mínima em 58 mm, U(92) ficava apertado).
    fonte(DVSC, '400', T(34.9))
    const colDesc = Math.max(m + U(92), m + U(2) + larg('QTD') + U(16))
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
          const entre = Math.max(T(8), cap() * 0.45)
          for (const ln of quebrar(b.s, dir - m)) { texto(ln, p.largura / 2, y, 'center'); y += cap() + entre }
          y -= entre
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
          const entre = Math.max(T(8), cap() * 0.45)
          for (const ln of quebrar(b.s, dir - m)) { texto(ln, p.largura / 2, y, 'center'); y += cap() + entre }
          y -= entre
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
   * o = { larguraMm, larguraPontos, tamanhoFonte, logo (Image | null), imprimirLogo,
   *       intensidade: 'normal' | 'escura' | 'mais_escura', umBit (padrão true) }
   * Sai no tamanho EXATO de pontos da impressora e, por padrão, em 1 bit (preto e branco
   * de verdade): texto sólido por limiar, cinza em retícula uniforme.
   */
  function desenhar(canvas, doc, o = {}) {
    const largura = larguraEmPontos(o.larguraMm, o.larguraPontos)
    const ctx = canvas.getContext('2d')
    const intensidade = INTENSIDADES[o.intensidade] ? o.intensidade : 'normal'
    const opcoes = { largura, tamanhoFonte: o.tamanhoFonte || 'grande', logo: o.logo || null, imprimirLogo: o.imprimirLogo !== false, intensidade, reticulas: [] }
    const layout = doc.modelo === 'v3' ? layoutV3 : doc.modelo === 'pre_conta' ? layoutPreConta : doc.modelo === 'largura' ? layoutLargura : layoutCozinha
    canvas.width = largura
    canvas.height = 10
    const altura = Math.ceil(layout(ctx, doc, opcoes, false))
    canvas.width = largura
    canvas.height = altura
    const c2 = canvas.getContext('2d')
    c2.fillStyle = '#ffffff'
    c2.fillRect(0, 0, largura, altura)
    layout(c2, doc, opcoes, true)
    if (o.umBit !== false) monocromatizar(c2, largura, altura, opcoes.reticulas, intensidade)
    return { largura, altura }
  }

  return { desenhar, bitsDoCanvas, carregarRecursos, carregarImagem, larguraEmPontos, RECURSOS, ESCALA_FONTE, INTENSIDADES, ICONES_PAGAMENTO, ICONE_DA_FORMA }
})
