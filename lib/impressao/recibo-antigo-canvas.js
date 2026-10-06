// ─────────────────────────────────────────────────────────────────────────────
// PRÉVIA da comanda do ASSISTENTE ANTIGO (0.1.23) no navegador.
//
// O Assistente antigo monta a comanda com o printer-agent/src/recibo.js (linhas marcadas) e
// DESENHA com o print.ps1 (GDI+, fonte Consolas em negrito, bitmap de 576/384 pontos) — que só
// existe no Windows. Este arquivo é a mesma conta do print.ps1, passo a passo, num canvas:
//   · fonte base = o MAIOR tamanho (52 → 9 px) em que `colunas` letras "M" cabem na largura útil
//     (largura − 2 × 3%), medida com a métrica da Consolas — então as colunas, as quebras de
//     linha e as alturas são as mesmas do papel, com ou sem a Consolas instalada (sem ela, a
//     letra é desenhada com a DejaVu Sans Mono no mesmo avanço por caractere);
//   · multiplicadores das letras (loja 1,6; faixa 1,0; tipo 1,1; item 1,2/1,55; sub 0,95/1,15;
//     dados 1,0; TOTAL 1,8; rodapé 0,7), espaçamentos em frações da altura da linha (H) e a
//     logo a 55% da largura (no máximo 60% de altura) — copiados do print.ps1;
//   · o texto sai em preto e branco puro (o print.ps1 desenha com SingleBitPerPixelGridFit).
// Conferido contra o PNG de verdade do print.ps1 (-DebugPng) em
// scripts/impressao/golden-previa-antigo.mjs.
// ─────────────────────────────────────────────────────────────────────────────
;(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica()
  else raiz.ReciboAntigo = fabrica()
})(typeof self !== 'undefined' ? self : this, function () {
  const SOH = '\x01'
  const STX = '\x02'
  // Métrica da Consolas NO GDI+ (medida no Windows com o print.ps1: MeasureString/DrawString em
  // pixels, SingleBitPerPixelGridFit): avanço por letra 0,5664 em (o da fonte é 0,5498; o GDI+
  // soma o espaçamento dele), folga de 1/6 de em antes do texto, altura da linha 2398/2048 e o
  // topo das maiúsculas 0,27 em abaixo do ponto onde o texto é desenhado.
  const CONSOLAS = { avanco: 0.5664, linha: 2398 / 2048, topoMaiuscula: 0.27, avancoFonte: 1126 / 2048 }
  const FONTE_PADRAO = '"Consolas", "DejaVu Sans Mono Menuzia", "DejaVu Sans Mono", monospace'

  /** Mesma regra do main.js do Assistente: tamanho da fonte → colunas. */
  function colsParaFonte(tamanho, largura) {
    const t = String(tamanho || '').toLowerCase()
    const base = Number(largura) > 0 ? Number(largura) : 48
    if (t.includes('grand')) return Math.max(14, Math.round(base * 0.55))
    if (t.includes('med') || t.includes('norm')) return Math.max(16, Math.round(base * 0.72))
    return base
  }

  /** Linhas marcadas → operações (como o print.ps1 lê o arquivo). */
  function lerOperacoes(texto) {
    const ops = []
    for (const ln of String(texto).replace(/\r/g, '').split('\n')) {
      if (ln.length > 0 && ln[0] === SOH) {
        const partes = ln.slice(1).split(STX)
        ops.push({ tipo: partes[0], f: partes.slice(1) })
      } else if (ln.trim().length > 0) ops.push({ tipo: 'PLAIN', f: [ln] })
    }
    return ops
  }

  /**
   * Desenha a comanda num canvas. o = { larguraMm (58|80), colunas, fonteMaior, logo (Image|null), familia }
   * Devolve { largura, altura, base }.
   */
  function desenhar(canvas, textoMarcado, o = {}) {
    const dotW = Number(o.larguraMm) <= 58 ? 384 : 576
    const ops = lerOperacoes(textoMarcado)
    const margem = Math.trunc(dotW * 0.03)
    const usable = dotW - 2 * margem
    // MeasureString do GDI+ soma 1/6 de em de cada lado do texto.
    const medirConsolas = (n, px) => n * CONSOLAS.avanco * px + px / 3
    let alvo = Number(o.colunas) || 0
    if (alvo < 1) {
      let maxVis = 1
      for (const op of ops) maxVis = Math.max(maxVis, visivel(op))
      alvo = Math.min(Math.max(maxVis, 32), 48)
    }
    let base = 10
    for (let px = 52; px >= 9; px -= 1) if (medirConsolas(alvo, px) <= usable) { base = px; break }

    const familia = o.familia || FONTE_PADRAO
    const fonteMaior = o.fonteMaior === true
    const F = {
      loja: { m: 1.6, b: true }, secao: { m: 1.0, b: true }, tipo: { m: 1.1, b: true },
      item: { m: fonteMaior ? 1.55 : 1.2, b: true }, sub: { m: fonteMaior ? 1.15 : 0.95, b: fonteMaior },
      dados: { m: 1.0, b: false }, total: { m: 1.8, b: true }, rodape: { m: 0.7, b: false },
    }
    const H = base * CONSOLAS.linha
    const alturaDe = (f) => base * f.m * CONSOLAS.linha

    // Logo: 55% da largura (no máximo o tamanho dela), altura no máximo 60% da largura.
    let logoW = 0, logoH = 0
    const logo = o.logo && o.logo.naturalWidth > 0 ? o.logo : null
    if (logo) {
      logoW = Math.min(dotW * 0.55, logo.naturalWidth)
      logoH = logoW * (logo.naturalHeight / logo.naturalWidth)
      const maxH = dotW * 0.6
      if (logoH > maxH) { logoW *= maxH / logoH; logoH = maxH }
    }

    function passada(ctx, desenha) {
      // Letra do navegador do tamanho da Consolas (sem ela, a DejaVu Sans Mono encolhida para a
      // mesma largura de letra); cada letra vai na grade do GDI+ (avanço 0,5664 em).
      let capAtual = 0
      const fonte = (f) => {
        const px = base * f.m
        ctx.font = `${f.b ? '700' : '400'} ${px}px ${familia}`
        const adv = ctx.measureText('M').width || CONSOLAS.avancoFonte * px
        const ajuste = (CONSOLAS.avancoFonte * px) / adv
        if (Math.abs(ajuste - 1) > 0.01) ctx.font = `${f.b ? '700' : '400'} ${px * ajuste}px ${familia}`
        capAtual = ctx.measureText('H').actualBoundingBoxAscent || 0.638 * px
        return px
      }
      const largura = (s, px) => medirConsolas([...s].length, px)
      const escrever = (s, x, y, px, cor = '#000000') => {
        if (!desenha) return
        ctx.fillStyle = cor
        ctx.textBaseline = 'alphabetic'
        ctx.textAlign = 'left'
        const linhaBase = y + CONSOLAS.topoMaiuscula * px + capAtual
        const passo = CONSOLAS.avanco * px
        const folga = (passo - CONSOLAS.avancoFonte * px) / 2
        ;[...s].forEach((ch, i) => { if (ch !== ' ') ctx.fillText(ch, x + px / 6 + i * passo + folga, linhaBase) })
      }
      const centro = (s, y, px, cor) => escrever(s, (dotW - largura(s, px)) / 2, y, px, cor)
      const quebrar = (txt, px, maxW) => {
        const palavras = String(txt).split(/\s+/).filter(Boolean)
        const linhas = []
        let cur = ''
        for (let w of palavras) {
          const t = cur ? `${cur} ${w}` : w
          if (largura(t, px) <= maxW) { cur = t; continue }
          if (cur) { linhas.push(cur); cur = '' }
          while (largura(w, px) > maxW && w.length > 1) {
            let n = w.length
            while (n > 1 && largura(w.slice(0, n), px) > maxW) n--
            linhas.push(w.slice(0, n)); w = w.slice(n)
          }
          cur = w
        }
        if (cur) linhas.push(cur)
        return linhas.length ? linhas : ['']
      }

      let y = H * 0.4
      const rightX = dotW - margem
      if (logo) {
        if (desenha) ctx.drawImage(logo, (dotW - logoW) / 2, y, logoW, logoH)
        y += logoH + H * 0.4
      }
      for (const op of ops) {
        switch (op.tipo) {
          case 'N': {
            const px = fonte(F.loja)
            for (const ln of quebrar(op.f[0], px, usable)) { centro(ln, y, px); y += alturaDe(F.loja) }
            y += H * 0.2
            break
          }
          case 'H': {
            y += H * 0.3
            const barH = alturaDe(F.secao) + H * 0.5
            if (desenha) { ctx.fillStyle = '#000000'; ctx.fillRect(0, y, dotW, barH) }
            const px = fonte(F.secao)
            centro(op.f[0], y + H * 0.25, px, '#ffffff')
            y += barH + H * 0.25
            break
          }
          case 'C': {
            const px = fonte(F.tipo)
            centro(op.f[0], y, px)
            y += alturaDe(F.tipo) + H * 0.15
            break
          }
          case 'I': {
            const px = fonte(F.item)
            const preco = op.f[1] || ''
            const precoW = largura(preco, px)
            escrever(preco, rightX - precoW, y, px)
            for (const ln of quebrar(op.f[0], px, usable - precoW - base * 0.5)) { escrever(ln, margem, y, px); y += alturaDe(F.item) }
            y += H * 0.25
            break
          }
          case 'S': {
            const px = fonte(F.sub)
            const indent = margem + Math.trunc(base * 1.2)
            for (const ln of quebrar(op.f[0], px, usable - (indent - margem))) { escrever(ln, indent, y, px); y += alturaDe(F.sub) }
            y += H * 0.12
            break
          }
          case 'P': {
            const px = fonte(F.dados)
            escrever(op.f[0], margem, y, px)
            escrever(op.f[1] || '', rightX - largura(op.f[1] || '', px), y, px)
            y += alturaDe(F.dados) + H * 0.08
            break
          }
          case 'T': {
            y += H * 0.15
            if (desenha) { ctx.fillStyle = '#000000'; ctx.fillRect(margem, y - Math.max(1, base * 0.08) / 2, rightX - margem, Math.max(1, base * 0.08)) }
            y += H * 0.15
            const px = fonte(F.total)
            escrever(op.f[0], margem, y, px)
            escrever(op.f[1] || '', rightX - largura(op.f[1] || '', px), y, px)
            y += alturaDe(F.total) + H * 0.2
            break
          }
          case 'R': {
            const esp = Math.max(1, base * 0.07)
            const meio = y + H * 0.35
            if (desenha) { ctx.fillStyle = '#000000'; for (let x = margem; x < rightX; x += esp * 2) ctx.fillRect(x, meio - esp / 2, esp, esp) }
            y += H * 0.7
            break
          }
          case 'F': {
            y += H * 0.6
            const px = fonte(F.rodape)
            centro(op.f[0], y, px)
            y += alturaDe(F.rodape)
            break
          }
          default: {
            // 'L' e texto puro: linha à esquerda, quebrando na largura útil.
            const px = fonte(F.dados)
            for (const ln of quebrar(op.f[0], px, usable)) { escrever(ln, margem, y, px); y += alturaDe(F.dados) }
            if (op.tipo === 'L') y += H * 0.08
          }
        }
      }
      return Math.ceil(y + H * 0.8)
    }

    canvas.width = dotW
    canvas.height = 10
    const altura = passada(canvas.getContext('2d'), false)
    canvas.width = dotW
    canvas.height = altura
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, dotW, altura)
    passada(ctx, true)
    // Texto em 1 bit (como o GDI com SingleBitPerPixelGridFit); a logo fica como a imagem dela.
    try {
      const yLogo0 = Math.floor(H * 0.4), yLogo1 = Math.ceil(H * 0.4 + logoH)
      const img = ctx.getImageData(0, 0, dotW, altura)
      const d = img.data
      for (let y = 0; y < altura; y++) {
        if (logo && y >= yLogo0 && y < yLogo1) continue
        for (let x = 0; x < dotW; x++) {
          const i = (y * dotW + x) * 4
          const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 < 128 ? 0 : 255
          d[i] = d[i + 1] = d[i + 2] = v
          d[i + 3] = 255
        }
      }
      ctx.putImageData(img, 0, 0)
    } catch { /* canvas sujo (logo sem CORS): fica como está */ }
    return { largura: dotW, altura, base, colunas: alvo }
  }

  function visivel(op) {
    switch (op.tipo) {
      case 'I': case 'P': case 'T': return (op.f[0] || '').length + 2 + (op.f[1] || '').length
      case 'H': return (op.f[0] || '').length + 4
      case 'S': return (op.f[0] || '').length + 2
      case 'R': return 1
      default: return op.f.length ? (op.f[0] || '').length : 0
    }
  }

  return { desenhar, colsParaFonte, lerOperacoes, CONSOLAS }
})
