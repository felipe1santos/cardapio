# COMANDA DA COZINHA e PRE-CONTA do ASSISTENTE BETA - renderizador proprio (so o Beta usa).
# Modelos oficiais de 2026-09-28 (cozinha-beta.js e pre-conta-beta.js montam os blocos).
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
Write-Log "==== DOCUMENTO BETA: printer='$PrinterName' paperMm=$PaperWidthMm dotW=$dotW margem=$m ===="

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
    # Caixa da logo no modelo: 86 pt de altura na comanda, 60 na pre-conta (80 mm).
    $altLogo = if ($doc.modelo -eq 'pre_conta') { 60 } else { 86 }
    $r = Preparar-Logo $LogoPath ([int]($dotW * 0.34)) ([int]($altLogo * [Math]::Max(0.6, $dotW / 576.0)))
    if ($r) { $logo = $r[0]; Write-Log ("LOGO: {0}x{1} ({2})" -f $logo.Width, $logo.Height, $r[1]) }
    else { Write-Log "LOGO: arquivo sem imagem utilizavel -> nome da loja" }
  } catch { Write-Log ("LOGO: falhou ({0}) -> nome da loja" -f $_.Exception.Message); $logo = $null }
} else { Write-Log "LOGO: loja sem logo -> nome da loja" }

# -- desenho (modelos oficiais 2026-09-28: comanda da cozinha e pre-conta) ------------
# Medidas tiradas dos modelos (80 mm = 576 pontos) e escaladas pela largura real do papel.
# Texto de dado em monoespacada (Consolas), titulos e faixas em Arial negrito, como nos
# modelos. Linhas e fios em preto: impressora termica nao imprime cinza.
$canvasH = 20000
$canvas = New-Object System.Drawing.Bitmap($dotW, $canvasH)
$canvas.SetResolution($dpi, $dpi)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
$preto = [System.Drawing.Brushes]::Black
$branco = [System.Drawing.Brushes]::White
$y = 6.0
$sobreposicoes = 0

$s = [Math]::Max(0.6, $dotW / 576.0)
function Px([double]$v) { return [Math]::Max(1.0, $v * $script:s) }
$m = [int][Math]::Round((Px 24))
$uw = $dotW - 2 * $m
$direita = $dotW - $m

function Fn([string]$familia, [double]$px, [bool]$negrito) {
  $st = if ($negrito) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  return New-Object System.Drawing.Font($familia, [single]([Math]::Max(11.0, (Px $px))), $st, [System.Drawing.GraphicsUnit]::Pixel)
}
function Mono([double]$px, [bool]$negrito = $false) { return Fn 'Lucida Console' $px $negrito }
function Sans([double]$px, [bool]$negrito = $true) { return Fn 'Arial' $px $negrito }

function Texto([string]$t, $f, [double]$x, [double]$yy, $pincel = $preto) { $g.DrawString($t, $f, $pincel, [single]$x, [single]$yy, $sf) }
function TextoDir([string]$t, $f, [double]$xDireita, [double]$yy, $pincel = $preto) { Texto $t $f ($xDireita - (Larg $t $f)) $yy $pincel }
function Centro([string]$t, $f) {
  foreach ($ln in (Quebrar $t $f $uw)) { Texto $ln $f ($m + ($uw - (Larg $ln $f)) / 2.0) $script:y; $script:y += (Alt $f) }
}
function Fio([double]$espessura) { $g.FillRectangle($preto, $m, [int]$script:y, $uw, [int][Math]::Max(1, [Math]::Round($espessura))) }

# Monograma da loja sem logo: "Villa Lanches" -> VL, "Pizza do Rosa" -> PR; nome de uma
# palavra -> primeira letra + ultima consoante ("Menuzia" -> MZ, como o modelo).
function Iniciais([string]$nome) {
  $ligacao = @('de', 'do', 'da', 'dos', 'das', 'e', 'o', 'a')
  $pal = @(($nome -replace '[^\p{L}\p{N} ]', ' ').Split(' ') | Where-Object { $_ -ne '' -and $ligacao -notcontains $_.ToLower() })
  if ($pal.Count -eq 0) { return 'MZ' }
  if ($pal.Count -eq 1) {
    $w = $pal[0].ToUpper()
    if ($w.Length -lt 2) { return $w }
    for ($i = $w.Length - 1; $i -ge 1; $i--) { if ('BCDFGHJKLMNPQRSTVWXYZ'.Contains([string]$w[$i])) { return $w.Substring(0, 1) + $w[$i] } }
    return $w.Substring(0, 2)
  }
  return ($pal[0].Substring(0, 1) + $pal[1].Substring(0, 1)).ToUpper()
}

function RetArred($pincel, [double]$x, [double]$yy, [double]$w, [double]$h, [double]$r) {
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $gp.AddArc([single]$x, [single]$yy, [single]$d, [single]$d, 180, 90)
  $gp.AddArc([single]($x + $w - $d), [single]$yy, [single]$d, [single]$d, 270, 90)
  $gp.AddArc([single]($x + $w - $d), [single]($yy + $h - $d), [single]$d, [single]$d, 0, 90)
  $gp.AddArc([single]$x, [single]($yy + $h - $d), [single]$d, [single]$d, 90, 90)
  $gp.CloseFigure()
  $g.FillPath($pincel, $gp)
  $gp.Dispose()
}

# Logo da loja no meio do topo. Sem logo: monograma com as iniciais da loja, no formato
# do modelo (circulo na comanda, quadrado arredondado na pre-conta).
function DesenharLogo([string]$forma, [double]$cx, [double]$yy) {
  if ($script:logo) {
    $lw = $script:logo.Width; $lh = $script:logo.Height
    $g.DrawImage($script:logo, [int]($cx - $lw / 2), [int]$yy, $lw, $lh)
    return $lh
  }
  $ini = Iniciais ([string]$doc.loja)
  if ($forma -eq 'quadrado') {
    $w = Px 80; $h = Px 55; $r = Px 7; $b = [Math]::Max(2, [int](Px 3))
    RetArred $preto ($cx - $w / 2) $yy $w $h $r
    RetArred $branco ($cx - $w / 2 + $b) ($yy + $b) ($w - 2 * $b) ($h - 2 * $b) ([Math]::Max(1, $r - $b))
    $f = Sans 30
    Texto $ini $f ($cx - (Larg $ini $f) / 2) ($yy + ($h - (Alt $f)) / 2 + (Px 1))
    return $h
  }
  $d = Px 86; $b = [Math]::Max(2, [int](Px 3))
  $g.FillEllipse($preto, [single]($cx - $d / 2), [single]$yy, [single]$d, [single]$d)
  $g.FillEllipse($branco, [single]($cx - $d / 2 + $b), [single]($yy + $b), [single]($d - 2 * $b), [single]($d - 2 * $b))
  $f = Sans 28
  Texto $ini $f ($cx - (Larg $ini $f) / 2) ($yy + $d * 0.2)
  $g.FillRectangle($preto, [int]($cx - $d * 0.24), [int]($yy + $d * 0.62), [int]($d * 0.48), [int][Math]::Max(1, (Px 2)))
  $nomeLoja = ([string]$doc.loja).ToUpper()
  $fn = Sans 8
  while ((Larg $nomeLoja $fn) -gt $d * 0.62 -and $nomeLoja.Length -gt 3) { $nomeLoja = $nomeLoja.Substring(0, $nomeLoja.Length - 1) }
  Texto $nomeLoja $fn ($cx - (Larg $nomeLoja $fn) / 2) ($yy + $d * 0.66)
  return $d
}

# Icone do Instagram no meio do QR (quadrado arredondado, circulo e ponto).
function IconeInstagram([double]$cx, [double]$cy, [double]$lado) {
  $caixa = $lado * 1.25
  $g.FillRectangle($branco, [single]($cx - $caixa / 2), [single]($cy - $caixa / 2), [single]$caixa, [single]$caixa)
  $e = [Math]::Max(2, $lado * 0.12)
  RetArred $preto ($cx - $lado / 2) ($cy - $lado / 2) $lado $lado ($lado * 0.28)
  RetArred $branco ($cx - $lado / 2 + $e) ($cy - $lado / 2 + $e) ($lado - 2 * $e) ($lado - 2 * $e) ([Math]::Max(1, $lado * 0.28 - $e))
  $rc = $lado * 0.24
  $g.FillEllipse($preto, [single]($cx - $rc), [single]($cy - $rc), [single](2 * $rc), [single](2 * $rc))
  $ri = $rc - $e
  $g.FillEllipse($branco, [single]($cx - $ri), [single]($cy - $ri), [single](2 * $ri), [single](2 * $ri))
  $rp = [Math]::Max(1.5, $lado * 0.07)
  $g.FillEllipse($preto, [single]($cx + $lado * 0.22 - $rp), [single]($cy - $lado * 0.22 - $rp), [single](2 * $rp), [single](2 * $rp))
}

# Colunas da tabela da pre-conta (modelo: QTD, DESCRICAO, UNIT., TOTAL).
$colQtd = $m + (Px 24)
$colDesc = $m + (Px 70)
$colUnit = $m + (Px 407)
$fTabCab = Mono 15 $true
$fTab = Mono 20
$fTabN = Mono 20 $true
$fTabU = Mono 18
$fTabSub = Mono 14

foreach ($b in $doc.blocos) {
  switch ($b.t) {
    'marcas' {
      # Tracos curtos junto as bordas: se um lado do papel cortar, o traco some.
      $alto = [int][Math]::Max(12, (Px 14))
      $passo = [Math]::Max(24, [int]($dotW / 16))
      for ($x = 0; $x -lt $dotW - 3; $x += $passo) { $g.FillRectangle($preto, $x, [int]$y, 3, $alto) }
      $g.FillRectangle($preto, $dotW - 3, [int]$y, 3, $alto)
      $y += $alto + 8
    }
    'topo' {
      $y += (Px 14)
      $fr = Mono 15
      $fv = Mono 15
      $fd = Mono 17 $true
      $hLogo = DesenharLogo ([string]$b.logo) ($dotW / 2.0) $y
      $larLogo = if ($logo) { $logo.Width } else { (Px 86) }
      # Horarios a esquerda, centrados na altura da logo.
      $n = @($b.linhas).Count
      $hl = (Alt $fr) * 1.45
      $yl = $y + [Math]::Max(0, ($hLogo - $n * $hl) / 2.0)
      $colVal = $m + (Larg 'Recebido  ' $fr)
      foreach ($par in @($b.linhas)) {
        Texto ([string]$par[0]) $fr $m $yl
        Texto ([string]$par[1]) $fv $colVal $yl
        $yl += $hl
      }
      # Tipo do pedido a direita (encolhe se a logo apertar).
      $maxDir = $direita - ($dotW / 2.0 + $larLogo / 2.0) - (Px 8)
      $txt = [string]$b.direita
      while ((Larg $txt $fd) -gt $maxDir -and $fd.Size -gt 11) { $fd = New-Object System.Drawing.Font('Lucida Console', [single]($fd.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
      TextoDir $txt $fd $direita ($y + ($hLogo - (Alt $fd)) / 2.0)
      $y += $hLogo + (Px 22)
    }
    'topo_data' {
      $y += (Px 14)
      $fdata = Mono 15
      $hLogo = DesenharLogo ([string]$b.logo) ($dotW / 2.0) $y
      Texto ([string]$b.data) $fdata $m ($y + (Px 4))
      if ($b.via) { TextoDir ([string]$b.via) (Mono 14 $true) $direita ($y + (Px 4)) }
      $y += $hLogo + (Px 34)
    }
    'faixa_num' {
      $h = Px 57
      $g.FillRectangle($preto, $m, [int]$y, $uw, [int]$h)
      $fe = Sans 38
      $fdd = Sans 22
      Texto ([string]$b.esq) $fe ($m + (Px 18)) ($y + ($h - (Alt $fe)) / 2.0 + (Px 1)) $branco
      TextoDir ([string]$b.dir) $fdd ($direita - (Px 18)) ($y + ($h - (Alt $fdd)) / 2.0) $branco
      $y += $h + (Px 20)
    }
    'faixa_arred' {
      $h = Px 60
      RetArred $preto $m $y $uw $h (Px 6)
      $f = Sans 30
      Texto ([string]$b.s) $f ($m + ($uw - (Larg ([string]$b.s) $f)) / 2.0) ($y + ($h - (Alt $f)) / 2.0) $branco
      $y += $h + (Px 30)
    }
    'secao' {
      $y += (Px 8)
      $f = Sans 22
      Texto ([string]$b.s) $f $m $y
      $y += (Alt $f) + (Px 5)
      Fio (Px 2)
      $y += (Px 20)
    }
    'secao_sem_linha' {
      $y += (Px 18)
      $f = Sans 24
      Texto ([string]$b.s) $f $m $y
      $y += (Alt $f) + (Px 26)
    }
    'item_bola' {
      $y += (Px 8)
      $fq = Mono 20 $true
      $fv = Mono 18 $true
      $r = Px 5.5
      $cy = $y + (Alt $fq) / 2.0
      $g.FillEllipse($preto, [single]($m + (Px 2)), [single]($cy - $r), [single](2 * $r), [single](2 * $r))
      $xq = $m + (Px 30)
      $xn = $xq + (Larg ('{0}  ' -f $b.qtd) $fq)
      Texto ([string]$b.qtd) $fq $xq $y
      $vw = Larg ([string]$b.valor) $fv
      TextoDir ([string]$b.valor) $fv $direita ($y + (Px 1))
      $lim = $direita - $vw - (Px 12) - $xn
      $ls = Quebrar ([string]$b.nome) $fq $lim
      foreach ($ln in $ls) { Texto $ln $fq $xn $y; $y += (Alt $fq) }
      $y += (Px 6)
    }
    'detalhes' {
      $linhas = @($b.linhas)
      if ($linhas.Count -eq 0 -and -not $b.obs) { $y += (Px 14); continue }
      $fdet = Mono 15
      $fobs = Mono 14
      $x0 = $m + (Px 40)
      $ini = $y
      foreach ($l in $linhas) {
        $vw = if ($l.valor) { Larg ([string]$l.valor) $fdet } else { 0 }
        if ($l.valor) { TextoDir ([string]$l.valor) $fdet $direita $y }
        $lim = $direita - $x0 - $(if ($vw -gt 0) { $vw + (Px 12) } else { 0 })
        foreach ($ln in (Quebrar ([string]$l.s) $fdet $lim)) { Texto $ln $fdet $x0 $y; $y += (Alt $fdet) * 1.55 }
      }
      if ($b.obs) {
        foreach ($ln in (Quebrar ([string]$b.obs) $fobs ($direita - $x0))) { Texto $ln $fobs $x0 $y; $y += (Alt $fobs) * 1.55 }
      }
      # Fio vertical a esquerda, junto dos adicionais (como o modelo).
      $g.FillRectangle($preto, [int]($m + (Px 7)), [int]$ini, [int][Math]::Max(1, (Px 2)), [int]($y - $ini))
      $y += (Px 18)
    }
    'obs_pedido' {
      $f = Mono 15 $true
      foreach ($ln in (Quebrar ([string]$b.s) $f $uw)) { Texto $ln $f $m $y; $y += (Alt $f) * 1.2 }
      $y += (Px 10)
    }
    'par' {
      $fr = Mono 16
      $fv = Mono 16 $true
      TextoDir ([string]$b.valor) $fv $direita $y
      Texto ([string]$b.rotulo) $fr $m $y
      $y += (Alt $fr) * 1.95
    }
    'rotulo_valor' {
      $fr = Mono 16
      $fv = Mono 16 $true
      Texto ([string]$b.rotulo) $fr $m $y
      Texto ([string]$b.valor) $fv ($m + (Larg ('{0} ' -f $b.rotulo) $fr)) $y
      $y += (Alt $fr) * 1.95
    }
    'faixa_total' {
      $y += (Px 10)
      $h = Px 58
      $fr = Sans 22
      $fv = Sans 36
      while (((Larg ([string]$b.rotulo) $fr) + (Larg ([string]$b.valor) $fv) + (Px 50)) -gt $uw -and $fv.Size -gt 12) {
        $fv = New-Object System.Drawing.Font('Arial', [single]($fv.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      }
      $g.FillRectangle($preto, $m, [int]$y, $uw, [int]$h)
      Texto ([string]$b.rotulo) $fr ($m + (Px 18)) ($y + ($h - (Alt $fr)) / 2.0 - (Px 3)) $branco
      $vw = Larg ([string]$b.valor) $fv
      TextoDir ([string]$b.valor) $fv ($direita - (Px 18)) ($y + ($h - (Alt $fv)) / 2.0 + (Px 1)) $branco
      Write-Log ("TOTAL: valor='{0}' x={1}..{2} papel={3} fonte={4}" -f $b.valor, [int]($direita - (Px 18) - $vw), [int]($direita - (Px 18)), $dotW, $fv.Size)
      $y += $h + (Px 28)
    }
    'regua' {
      $y += (Px 4)
      Fio 1
      $y += (Px 26)
    }
    'linha_grossa' {
      $y += (Px 12)
      Fio (Px 2)
      $y += (Px 24)
    }
    'dado' {
      $fr = Mono 15
      $fv = if ($b.negrito) { Mono 16 $true } else { Mono 15 }
      # Coluna do valor: a do rotulo mais largo do documento (Endereco:/Atendente:).
      $col = $m + [Math]::Max((Larg 'Endereco:  ' $fr), (Larg ('{0}  ' -f $b.rotulo) $fr))
      Texto ([string]$b.rotulo) $fr $m ($y + (Px 1))
      $ls = Quebrar ([string]$b.valor) $fv ($direita - $col)
      foreach ($ln in $ls) { Texto $ln $fv $col $y; $y += (Alt $fv) * 1.25 }
      $y += (Alt $fv) * 0.7
    }
    'qr' {
      $linhasQr = @($b.linhas)
      $n = $linhasQr.Count
      $mod = [Math]::Max(2, [int][Math]::Round((Px 164) / $n))
      $lado = $mod * $n
      $x0 = [int](($dotW - $lado) / 2)
      $y0 = [int]($y + (Px 6))
      for ($ly = 0; $ly -lt $n; $ly++) {
        $row = [string]$linhasQr[$ly]
        $x = 0
        while ($x -lt $n) {
          if ($row[$x] -eq '1') {
            $ini = $x
            while ($x -lt $n -and $row[$x] -eq '1') { $x++ }
            $g.FillRectangle($preto, $x0 + $ini * $mod, $y0 + $ly * $mod, ($x - $ini) * $mod, $mod)
          } else { $x++ }
        }
      }
      if ($b.icone -eq 'instagram') { IconeInstagram ($x0 + $lado / 2.0) ($y0 + $lado / 2.0) ($lado * 0.2) }
      Write-Log ("QR: {0}x{0} modulos, {1} pt cada, lado {2} pt, icone='{3}'" -f $n, $mod, $lado, $b.icone)
      $y = $y0 + $lado + (Px 26)
    }
    'rodape' {
      Centro ([string]$b.s) (Mono 14)
      $y += (Px 6)
    }
    'mesa' {
      $ft = Sans 32
      $fs = Mono 18 $true
      $fr = Mono 15
      $fv = Mono 18 $true
      $colR = $m + $uw * 0.58
      $yi = $y
      $maxT = $colR - $m - (Px 10)
      $tit = [string]$b.titulo
      while ((Larg $tit $ft) -gt $maxT -and $ft.Size -gt 14) { $ft = New-Object System.Drawing.Font('Arial', [single]($ft.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
      Texto $tit $ft $m $y
      $ye = $y + (Alt $ft) + (Px 6)
      if ($b.sub) { Texto ([string]$b.sub) $fs $m $ye; $ye += (Alt $fs) }
      $yd = $yi - (Px 2)
      foreach ($par in @($b.pares)) {
        Texto ([string]$par[0]) $fr $colR ($yd + (Px 2))
        $v = [string]$par[1]
        $maxV = $direita - $colR - (Larg ('{0} ' -f $par[0]) $fr)
        while ((Larg $v $fv) -gt $maxV -and $v.Length -gt 2) { $v = $v.Substring(0, $v.Length - 1) }
        TextoDir $v $fv $direita $yd
        $yd += (Px 39)
      }
      $y = [Math]::Max($ye, $yd - (Px 12))
    }
    'tabela_cab' {
      $cq = 'QTD'
      Texto $cq $fTabCab ($colQtd - (Larg $cq $fTabCab) / 2.0) $y
      Texto 'DESCRICAO' $fTabCab $colDesc $y
      TextoDir 'UNIT.' $fTabCab $colUnit $y
      TextoDir 'TOTAL' $fTabCab $direita $y
      $y += (Alt $fTabCab) + (Px 6)
    }
    'tabela_item' {
      $y += (Px 10)
      $q = [string]$b.qtd
      Texto $q $fTab ($colQtd - (Larg $q $fTab) / 2.0) $y
      $uwid = Larg ([string]$b.unit) $fTabU
      TextoDir ([string]$b.unit) $fTabU $colUnit ($y + (Px 1))
      TextoDir ([string]$b.total) $fTabN $direita $y
      $limDesc = $colUnit - $uwid - (Px 16) - $colDesc
      foreach ($ln in (Quebrar ([string]$b.desc) $fTab $limDesc)) {
        if ((Larg $ln $fTab) -gt $limDesc + 0.5) { $sobreposicoes++ }
        Texto $ln $fTab $colDesc $y; $y += (Alt $fTab)
      }
      foreach ($sub in @($b.subs)) {
        if (-not $sub) { continue }
        foreach ($ln in (Quebrar ([string]$sub) $fTabSub ($direita - $colDesc - (Px 10)))) { Texto $ln $fTabSub ($colDesc + (Px 10)) $y; $y += (Alt $fTabSub) }
      }
      $y += (Px 14)
    }
    'par_pc' {
      $fr = Mono 18
      $fv = Mono 18 $true
      TextoDir ([string]$b.valor) $fv $direita $y
      $lim = $uw - (Larg ([string]$b.valor) $fv) - (Px 12)
      foreach ($ln in (Quebrar ([string]$b.rotulo) $fr $lim)) { Texto $ln $fr $m $y; $y += (Alt $fr) }
      $y += (Px 16)
    }
    'total_grande' {
      $y += (Px 4)
      $fr = Sans 26
      $fv = Sans 36
      while (((Larg ([string]$b.rotulo) $fr) + (Larg ([string]$b.valor) $fv) + (Px 16)) -gt $uw -and $fv.Size -gt 12) {
        $fv = New-Object System.Drawing.Font('Arial', [single]($fv.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        if ($fr.Size -gt 14) { $fr = New-Object System.Drawing.Font('Arial', [single]($fr.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
      }
      $hmax = [Math]::Max((Alt $fr), (Alt $fv))
      Texto ([string]$b.rotulo) $fr $m ($y + ($hmax - (Alt $fr)) / 2.0)
      $vw = Larg ([string]$b.valor) $fv
      TextoDir ([string]$b.valor) $fv $direita $y
      Write-Log ("TOTAL: valor='{0}' x={1}..{2} papel={3} fonte={4}" -f $b.valor, [int]($direita - $vw), [int]$direita, $dotW, $fv.Size)
      $y += $hmax + (Px 44)
    }
    'centro' {
      $f = if ($b.negrito) { Mono 16 $true } elseif ($b.maior) { Mono 17 } else { Mono 15 }
      Centro ([string]$b.s) $f
      $y += (Px 14)
    }
    'tracejado' {
      $y -= (Px 2)
      $traco = [int](Px 12); $vao = [int](Px 6); $alt2 = [int][Math]::Max(1, (Px 2))
      for ($x = $m + (Px 30); $x -le $direita - (Px 30) - $traco; $x += $traco + $vao) { $g.FillRectangle($preto, [int]$x, [int]$y, $traco, $alt2) }
      $y += (Px 22)
    }
    'espaco' { $y += (Px 18) }
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
  $pd.DocumentName = $(if ($doc.modelo -eq 'cozinha') { 'Menuzia Comanda' } else { 'Menuzia Pre-conta' })
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
