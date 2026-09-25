# RECIBO/EXTRATO do ASSISTENTE BETA - renderizador proprio (so o Beta usa).
#
# Le o documento em blocos (JSON de pre-conta-beta.js), mede e quebra as linhas na largura
# real do papel, desenha num bitmap e imprime 1:1 - como o print.ps1, que continua sendo o
# do Assistente atual, da ficha da cozinha e da pagina de calibracao (nao muda).
#
# Layouts proprios para 58 e 80 mm (fontes, logo e espacamento), nao uma reducao do 80.
# A largura calibrada da impressora (LarguraPontos) prevalece. Logo da loja: decodificada
# pelo Windows (WIC: PNG, JPEG, WebP, GIF), reduzida sem nunca ampliar, contraste esticado
# e dithering para papel termico; resultado em cache pelo hash do arquivo. Sem logo ou com
# arquivo ruim: o nome da loja em negrito. A logo nunca impede a impressao.
#
# Texto do script so em ASCII: o PowerShell 5.1 le .ps1 sem BOM como ANSI. Tudo o que e
# impresso vem do JSON (UTF-8).
param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [int]$Copies = 1,
  [int]$PaperWidthMm = 80,
  [int]$LarguraPontos = 0,
  [int]$DeslocamentoPontos = 0,
  [string]$LogoPath = '',
  [string]$LogoCacheDir = '',
  [string]$LogNome = 'menuzia-beta-print.log',
  [string]$DebugPng = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$LogFile = Join-Path $env:TEMP $LogNome
# Console direto (nao o pipeline): funcoes que devolvem valor nao ficam poluidas.
function Write-Log($msg) {
  try { Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -Encoding UTF8 } catch {}
  [Console]::Out.WriteLine("MENUZIA: " + $msg)
}

# -- papel e medidas ------------------------------------------------------------------
$estreito = $PaperWidthMm -le 58
$nominal = if ($estreito) { 384 } else { 576 }
$dotW = $nominal
if ($LarguraPontos -ge 256 -and $LarguraPontos -le 832) { $dotW = $LarguraPontos }
if ($DeslocamentoPontos -lt -64 -or $DeslocamentoPontos -gt 64) { $DeslocamentoPontos = 0 }
# Papel calibrado mais estreito: fontes acompanham um pouco (nunca abaixo de 80%).
$k = [Math]::Min(1.0, [Math]::Max(0.8, $dotW / [double]$nominal))
if ($estreito) {
  $P = @{ corpo = 19; item = 21; sub = 18; faixa = 19; total = 30; rodape = 15; nome = 25; logoW = 0.58; logoH = 104; marca = 12 }
} else {
  $P = @{ corpo = 22; item = 24; sub = 20; faixa = 22; total = 38; rodape = 17; nome = 32; logoW = 0.56; logoH = 140; marca = 14 }
}
$m = [int][Math]::Round($dotW * 0.035)
$uw = $dotW - 2 * $m
$dpi = 203.0
Write-Log "==== RECIBO/EXTRATO BETA: printer='$PrinterName' paperMm=$PaperWidthMm dotW=$dotW margem=$m ===="

$existe = $false
try { if (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue) { $existe = $true } } catch {}
if (-not $existe) {
  try { foreach ($p in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) { if ($p -eq $PrinterName) { $existe = $true } } } catch {}
}
if (-not $existe) { throw "Impressora '$PrinterName' nao encontrada no Windows." }

$doc = (Get-Content -Path $FilePath -Raw -Encoding UTF8) | ConvertFrom-Json

# -- fontes e medicao -----------------------------------------------------------------
function Fonte([double]$px, [bool]$negrito) {
  $st = if ($negrito) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  return New-Object System.Drawing.Font('Arial', [single]([Math]::Max(9.0, $px * $k)), $st, [System.Drawing.GraphicsUnit]::Pixel)
}
$fCorpo = Fonte $P.corpo $false
$fCorpoN = Fonte $P.corpo $true
$fItem = Fonte $P.item $true
$fSub = Fonte $P.sub $false
$fFaixa = Fonte $P.faixa $true
$fRodape = Fonte $P.rodape $false
$fRodapeN = Fonte $P.rodape $true
$fNome = Fonte $P.nome $true

$sf = [System.Drawing.StringFormat]::GenericTypographic.Clone()
$sf.FormatFlags = $sf.FormatFlags -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces
$measBmp = New-Object System.Drawing.Bitmap(8, 8)
$measBmp.SetResolution($dpi, $dpi)
$mg = [System.Drawing.Graphics]::FromImage($measBmp)
$mg.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
function Larg([string]$t, $f) { return [double]$mg.MeasureString($t, $f, 100000, $sf).Width }
function Alt($f) { return [double]$f.GetHeight($mg) }

# Quebra em linhas que cabem em $maxW; palavra maior que a linha e cortada.
function Quebrar([string]$txt, $f, [double]$maxW, [double]$primeiraW = -1) {
  if ($primeiraW -lt 0) { $primeiraW = $maxW }
  $linhas = New-Object System.Collections.Generic.List[string]
  $cur = ''
  $lim = $primeiraW
  foreach ($w0 in ($txt -split '\s+')) {
    if ($w0 -eq '') { continue }
    $w = $w0
    $try = if ($cur) { "$cur $w" } else { $w }
    if ((Larg $try $f) -le $lim) { $cur = $try; continue }
    if ($cur) { $linhas.Add($cur); $cur = ''; $lim = $maxW }
    while ((Larg $w $f) -gt $lim -and $w.Length -gt 1) {
      $n = $w.Length
      while ($n -gt 1 -and (Larg $w.Substring(0, $n) $f) -gt $lim) { $n-- }
      $linhas.Add($w.Substring(0, $n)); $w = $w.Substring($n); $lim = $maxW
    }
    $cur = $w
  }
  if ($cur) { $linhas.Add($cur) }
  if ($linhas.Count -eq 0) { $linhas.Add('') }
  return , $linhas.ToArray()
}

# -- logo ------------------------------------------------------------------------------
function Preparar-Logo([string]$caminho, [int]$maxW, [int]$maxH) {
  if (-not $caminho -or -not (Test-Path -LiteralPath $caminho)) { return $null }
  $fi = Get-Item -LiteralPath $caminho
  if ($fi.Length -lt 16 -or $fi.Length -gt 3MB) { return $null }
  $hash = (Get-FileHash -LiteralPath $caminho -Algorithm SHA256).Hash.Substring(0, 16).ToLower()
  Add-Type -AssemblyName PresentationCore
  $fs = [System.IO.File]::OpenRead($caminho)
  try {
    $dec = [System.Windows.Media.Imaging.BitmapDecoder]::Create($fs, [System.Windows.Media.Imaging.BitmapCreateOptions]::None, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
    $fr = $dec.Frames[0]
  } finally { $fs.Dispose() }
  $cv = New-Object System.Windows.Media.Imaging.FormatConvertedBitmap($fr, [System.Windows.Media.PixelFormats]::Bgra32, $null, 0)
  $w = $cv.PixelWidth; $h = $cv.PixelHeight
  if ($w -lt 8 -or $h -lt 8 -or $w -gt 6000 -or $h -gt 6000) { return $null }
  # Nunca amplia: imagem pequena fica no tamanho dela.
  $esc = [Math]::Min(1.0, [Math]::Min($maxW / [double]$w, $maxH / [double]$h))
  $tw = [Math]::Max(1, [int][Math]::Floor($w * $esc)); $th = [Math]::Max(1, [int][Math]::Floor($h * $esc))
  $cache = $null
  if ($LogoCacheDir) {
    try { New-Item -ItemType Directory -Force -Path $LogoCacheDir | Out-Null } catch {}
    $cache = Join-Path $LogoCacheDir ("logo-{0}-{1}x{2}.png" -f $hash, $tw, $th)
    if (Test-Path -LiteralPath $cache) {
      $tmp = [System.Drawing.Image]::FromFile($cache)
      try { $pronto = New-Object System.Drawing.Bitmap($tmp) } finally { $tmp.Dispose() }
      return , @($pronto, 'cache')
    }
  }
  $stride = $w * 4
  $px = New-Object byte[] ($stride * $h)
  $cv.CopyPixels($px, $stride, 0)
  $src = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bd = $src.LockBits((New-Object System.Drawing.Rectangle(0, 0, $w, $h)), [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  [System.Runtime.InteropServices.Marshal]::Copy($px, 0, $bd.Scan0, $px.Length)
  $src.UnlockBits($bd)
  # Reduz sobre fundo branco (transparencia vira branco).
  $dst = New-Object System.Drawing.Bitmap($tw, $th, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gg = [System.Drawing.Graphics]::FromImage($dst)
  $gg.Clear([System.Drawing.Color]::White)
  $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gg.DrawImage($src, 0, 0, $tw, $th)
  $gg.Dispose(); $src.Dispose()
  $n = $tw * $th
  $b2 = New-Object byte[] ($n * 4)
  $bd = $dst.LockBits((New-Object System.Drawing.Rectangle(0, 0, $tw, $th)), [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $b2, 0, $b2.Length)
  $lum = New-Object double[] $n
  $hist = New-Object int[] 256
  for ($i = 0; $i -lt $n; $i++) {
    $o = $i * 4
    $v = 0.114 * $b2[$o] + 0.587 * $b2[$o + 1] + 0.299 * $b2[$o + 2]
    $lum[$i] = $v; $hist[[int]$v]++
  }
  # Contraste: estica entre os percentis 2% e 98% (logo clara nao some no papel).
  $acc = 0; $lo = 0; $hi = 255
  for ($v = 0; $v -lt 256; $v++) { $acc += $hist[$v]; if ($acc -ge $n * 0.02) { $lo = $v; break } }
  $acc = 0
  for ($v = 255; $v -ge 0; $v--) { $acc += $hist[$v]; if ($acc -ge $n * 0.02) { $hi = $v; break } }
  if ($hi - $lo -ge 24) {
    $f = 255.0 / ($hi - $lo)
    for ($i = 0; $i -lt $n; $i++) { $x = ($lum[$i] - $lo) * $f; if ($x -lt 0) { $x = 0 } elseif ($x -gt 255) { $x = 255 }; $lum[$i] = $x }
  }
  # Areas chapadas limpas (ruido de compressao nao vira granulado) e contagem do escuro.
  $escuros = 0
  for ($i = 0; $i -lt $n; $i++) {
    if ($lum[$i] -lt 40) { $lum[$i] = 0 } elseif ($lum[$i] -gt 215) { $lum[$i] = 255 }
    if ($lum[$i] -lt 128) { $escuros++ }
  }
  # Logo em negativo (marca clara sobre FUNDO escuro): no papel viraria um bloco preto.
  # Imprime invertida - a marca em preto sobre o papel branco. Negativo = a moldura da
  # imagem (o fundo) e escura; desenho escuro sobre fundo claro/transparente nao inverte.
  $borda = 0; $bordaEscura = 0
  $aneis = [Math]::Max(1, [int]([Math]::Min($tw, $th) * 0.04))
  for ($y = 0; $y -lt $th; $y++) {
    for ($x = 0; $x -lt $tw; $x++) {
      if ($x -ge $aneis -and $x -lt $tw - $aneis -and $y -ge $aneis -and $y -lt $th - $aneis) { $x = $tw - $aneis - 1; continue }
      $borda++
      if ($lum[$y * $tw + $x] -lt 128) { $bordaEscura++ }
    }
  }
  $inverter = ($escuros -gt $n * 0.55) -and ($bordaEscura -gt $borda * 0.6)
  Write-Log ("LOGO: escuro {0:P0}, moldura escura {1:P0}" -f ($escuros / [double]$n), ($bordaEscura / [double][Math]::Max(1, $borda)))
  if ($inverter) {
    for ($i = 0; $i -lt $n; $i++) { $lum[$i] = 255 - $lum[$i] }
    # O que ficou escuro encostado na borda (cantos transparentes do fundo) e fundo: branco.
    $fila = New-Object System.Collections.Generic.Queue[int]
    for ($x = 0; $x -lt $tw; $x++) { $fila.Enqueue($x); $fila.Enqueue(($th - 1) * $tw + $x) }
    for ($y = 0; $y -lt $th; $y++) { $fila.Enqueue($y * $tw); $fila.Enqueue($y * $tw + $tw - 1) }
    while ($fila.Count -gt 0) {
      $i = $fila.Dequeue()
      if ($lum[$i] -ge 128) { continue }
      $lum[$i] = 255
      $x = $i % $tw
      if ($x -gt 0) { $fila.Enqueue($i - 1) }
      if ($x -lt $tw - 1) { $fila.Enqueue($i + 1) }
      if ($i -ge $tw) { $fila.Enqueue($i - $tw) }
      if ($i + $tw -lt $n) { $fila.Enqueue($i + $tw) }
    }
  }
  # Dithering Floyd-Steinberg para preto e branco.
  $pretos = 0
  for ($y = 0; $y -lt $th; $y++) {
    for ($x = 0; $x -lt $tw; $x++) {
      $i = $y * $tw + $x
      $old = $lum[$i]
      $new = if ($old -lt 128) { 0 } else { 255 }
      if ($new -eq 0) { $pretos++ }
      $err = $old - $new
      $lum[$i] = $new
      if ($x + 1 -lt $tw) { $lum[$i + 1] += $err * 0.4375 }
      if ($y + 1 -lt $th) {
        if ($x -gt 0) { $lum[$i + $tw - 1] += $err * 0.1875 }
        $lum[$i + $tw] += $err * 0.3125
        if ($x + 1 -lt $tw) { $lum[$i + $tw + 1] += $err * 0.0625 }
      }
    }
  }
  # Logo em branco (tudo transparente/claro demais): nao serve - imprime o nome.
  if ($pretos -lt [Math]::Max(20, $n * 0.004)) { $dst.UnlockBits($bd); $dst.Dispose(); return $null }
  for ($i = 0; $i -lt $n; $i++) { $o = $i * 4; $c = [byte]$lum[$i]; $b2[$o] = $c; $b2[$o + 1] = $c; $b2[$o + 2] = $c; $b2[$o + 3] = 255 }
  [System.Runtime.InteropServices.Marshal]::Copy($b2, 0, $bd.Scan0, $b2.Length)
  $dst.UnlockBits($bd)
  if ($cache) { try { $dst.Save($cache, [System.Drawing.Imaging.ImageFormat]::Png) } catch {} }
  return , @($dst, $(if ($inverter) { 'nova, invertida' } else { 'nova' }))
}

$logo = $null
if ($LogoPath) {
  try {
    $r = Preparar-Logo $LogoPath ([int]($dotW * $P.logoW)) ([int]($P.logoH * $k))
    if ($r) { $logo = $r[0]; Write-Log ("LOGO: {0}x{1} ({2})" -f $logo.Width, $logo.Height, $r[1]) }
    else { Write-Log "LOGO: arquivo sem imagem utilizavel -> nome da loja" }
  } catch { Write-Log ("LOGO: falhou ({0}) -> nome da loja" -f $_.Exception.Message); $logo = $null }
} else { Write-Log "LOGO: loja sem logo -> nome da loja" }

# -- desenho ----------------------------------------------------------------------------
$canvasH = 16000
$canvas = New-Object System.Drawing.Bitmap($dotW, $canvasH)
$canvas.SetResolution($dpi, $dpi)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
$preto = [System.Drawing.Brushes]::Black
$branco = [System.Drawing.Brushes]::White
$direita = $dotW - $m
$y = 6.0
$sobreposicoes = 0

function Texto([string]$t, $f, [double]$x, [double]$yy, $pincel = $preto) { $g.DrawString($t, $f, $pincel, [single]$x, [single]$yy, $sf) }
function Centro([string]$t, $f) {
  foreach ($ln in (Quebrar $t $f $uw)) { Texto $ln $f ($m + ($uw - (Larg $ln $f)) / 2.0) $script:y; $script:y += (Alt $f) }
}
function Pontilhado([int]$passo, [int]$lado) {
  $yy = [int]($script:y + (Alt $fCorpo) * 0.35)
  for ($x = $m; $x -le $direita - $lado; $x += $passo) { $g.FillRectangle($preto, $x, $yy, $lado, $lado) }
  $script:y += (Alt $fCorpo) * 0.75
}
function EsqDir([string]$rot, $fRot, [string]$val, $fVal, [double]$recuo = 0) {
  $vw = Larg $val $fVal
  $lw = $uw - $recuo - $vw - [Math]::Max(10, $uw * 0.03)
  $ls = Quebrar $rot $fRot $lw
  $h = [Math]::Max((Alt $fRot), (Alt $fVal))
  Texto $val $fVal ($direita - $vw) $script:y
  foreach ($ln in $ls) {
    if ((Larg $ln $fRot) -gt $lw + 0.5) { $script:sobreposicoes++ }
    Texto $ln $fRot ($m + $recuo) $script:y
    $script:y += $h
  }
}

foreach ($b in $doc.blocos) {
  switch ($b.t) {
    'marcas' {
      # Tracos curtos junto as bordas: se um lado do papel cortar, o traco some.
      $alto = [int]($P.marca * $k)
      $passo = [Math]::Max(24, [int]($dotW / 16))
      for ($x = 0; $x -lt $dotW - 3; $x += $passo) { $g.FillRectangle($preto, $x, [int]$y, 3, $alto) }
      $g.FillRectangle($preto, $dotW - 3, [int]$y, 3, $alto)
      $y += $alto + 8
    }
    'cabecalho' {
      if ($logo) {
        $g.DrawImage($logo, [int](($dotW - $logo.Width) / 2), [int]$y, $logo.Width, $logo.Height)
        $y += $logo.Height + 10
      } elseif ($doc.loja) {
        Centro ([string]$doc.loja).ToUpper() $fNome
        $y += 6
      }
    }
    'faixa' {
      $f = $fFaixa
      $pad = (Alt $f) * 0.28
      $tw = Larg $b.s $f
      while ($tw -gt $uw - 12 -and $f.Size -gt 10) { $f = New-Object System.Drawing.Font('Arial', [single]($f.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel); $tw = Larg $b.s $f }
      $hh = (Alt $f) + 2 * $pad
      $y += 4
      $g.FillRectangle($preto, $m, [int]$y, $uw, [int][Math]::Ceiling($hh))
      Texto $b.s $f ($m + ($uw - $tw) / 2.0) ($y + $pad) $branco
      $y += $hh + 8
    }
    'centro' { Centro $b.s $fCorpoN }
    'linha' { foreach ($ln in (Quebrar $b.s $fCorpo $uw)) { Texto $ln $fCorpo $m $y; $y += (Alt $fCorpo) } }
    'pontilhado' { $y += 2; Pontilhado 6 2 }
    'divisa' { Pontilhado 5 1 }
    'campo' {
      $rot = "$($b.rotulo): "
      $rw = Larg $rot $fCorpoN
      Texto $rot $fCorpoN $m $y
      $ls = Quebrar ([string]$b.valor) $fCorpo $uw ($uw - $rw)
      for ($i = 0; $i -lt $ls.Count; $i++) {
        $x = if ($i -eq 0) { $m + $rw } else { $m }
        Texto $ls[$i] $fCorpo $x $y
        $y += (Alt $fCorpo)
      }
    }
    'item' {
      $y += 3
      $vw = Larg $b.valor $fItem
      $gap = [Math]::Max(12, $uw * 0.03)
      $primeira = $uw - $vw - $gap
      Texto $b.valor $fItem ($direita - $vw) $y
      $ls = Quebrar ([string]$b.nome) $fItem $uw $primeira
      for ($i = 0; $i -lt $ls.Count; $i++) {
        $lim = if ($i -eq 0) { $primeira } else { $uw }
        if ((Larg $ls[$i] $fItem) -gt $lim + 0.5) { $sobreposicoes++ }
        Texto $ls[$i] $fItem $m $y
        $y += (Alt $fItem)
      }
      $y += 1
    }
    'sub' {
      $ind = [int]((Alt $fSub) * 0.9)
      foreach ($ln in (Quebrar $b.s $fSub ($uw - $ind))) { Texto $ln $fSub ($m + $ind) $y; $y += (Alt $fSub) * 1.02 }
    }
    'valor' {
      $fr = if ($b.negrito) { $fCorpoN } elseif ($b.leve) { $fSub } else { $fCorpo }
      $fv = if ($b.negrito) { $fCorpoN } elseif ($b.leve) { $fSub } else { $fCorpo }
      $rec = if ($b.leve) { [int]((Alt $fSub) * 0.9) } else { 0 }
      EsqDir ([string]$b.rotulo) $fr ([string]$b.valor) $fv $rec
    }
    'total' {
      $f = Fonte $P.total $true
      $gap = [Math]::Max(16, $uw * 0.04)
      while (((Larg $b.rotulo $f) + $gap + (Larg $b.valor $f)) -gt $uw -and $f.Size -gt 12) {
        $f = New-Object System.Drawing.Font('Arial', [single]($f.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      }
      $y += 5
      $g.FillRectangle($preto, $m, [int]$y, $uw, 2)
      $y += 6
      $vw = Larg $b.valor $f
      Texto $b.rotulo $f $m $y
      Texto $b.valor $f ($direita - $vw) $y
      Write-Log ("TOTAL: valor='{0}' x={1}..{2} papel={3} fonte={4}" -f $b.valor, [int]($direita - $vw), [int]$direita, $dotW, $f.Size)
      $y += (Alt $f) + 6
    }
    'rodape' {
      $f = if ($b.negrito) { $fRodapeN } else { $fRodape }
      Centro $b.s $f
    }
    'corte' { $y += 70 }
  }
}
if ($sobreposicoes -gt 0) { Write-Log "SOBREPOSICAO: $sobreposicoes linha(s) passaram da coluna" }

$finalH = [int][Math]::Ceiling([Math]::Min($y, $canvasH))
$bmp = New-Object System.Drawing.Bitmap($dotW, $finalH)
$bmp.SetResolution($dpi, $dpi)
$g2 = [System.Drawing.Graphics]::FromImage($bmp)
$g2.DrawImage($canvas, 0, 0)
$g2.Dispose(); $g.Dispose(); $canvas.Dispose()
if ($logo) { $logo.Dispose() }
Write-Log "BITMAP montado: dotW=$dotW finalH=$finalH"

if ($DebugPng) {
  $bmp.Save($DebugPng, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose(); $mg.Dispose(); $measBmp.Dispose()
  Write-Log "DEBUG PNG salvo: $DebugPng"
  return
}

function Imprimir-Bitmap([System.Drawing.Bitmap]$img, [bool]$usarCustom) {
  $pd = New-Object System.Drawing.Printing.PrintDocument
  $pd.PrinterSettings.PrinterName = $PrinterName
  $pd.PrinterSettings.Copies = [int]$Copies
  $pd.DocumentName = 'Menuzia Recibo/Extrato'
  if ($usarCustom) {
    $wIn = [int]([Math]::Round($img.Width / $dpi * 100))
    $hIn = [int]([Math]::Round($img.Height / $dpi * 100))
    $pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('ReciboMenuzia', $wIn, $hIn)
  }
  try { $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0); $pd.OriginAtMargins = $false } catch {}
  $script:imgImpr = $img
  $script:deslocX = $DeslocamentoPontos
  $pd.add_PrintPage({
    param($s, $e)
    $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Pixel
    $e.Graphics.DrawImage($script:imgImpr, $script:deslocX, 0, $script:imgImpr.Width, $script:imgImpr.Height)
    $e.HasMorePages = $false
  })
  try { $pd.Print() } finally { $pd.Dispose() }
}

try {
  try {
    Imprimir-Bitmap $bmp $true
    Write-Log "GRAFICA OK (bitmap, papel custom)."
  } catch {
    Write-Log ("Papel custom rejeitado ({0}); tentando papel padrao." -f $_.Exception.Message)
    Imprimir-Bitmap $bmp $false
    Write-Log "GRAFICA OK (bitmap, papel padrao)."
  }
} catch {
  # Emergencia: texto simples (o documento traz a versao em texto).
  Write-Log ("ERRO GRAFICA -> TEXTO: {0}" -f $_.Exception.Message)
  $txt = [string]$doc.texto + "`r`n`r`n"
  for ($i = 0; $i -lt $Copies; $i++) { $txt | Out-Printer -Name $PrinterName }
} finally {
  $bmp.Dispose(); $mg.Dispose(); $measBmp.Dispose()
}
