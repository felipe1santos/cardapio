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

# -- desenho: replica MEDIDA dos modelos oficiais ------------------------------------
# Fonte oficial do layout: docs/referencias/impressao/mockup-comanda-cozinha-termica-menuzia.png
# e docs/referencias/impressao/pre-conta-menuzia-v4.png (576 pontos = 80 mm). Fontes, cores,
# margens e a distancia entre cada bloco foram medidas nesses PNGs (scripts/impressao/
# comparar-modelo.ps1) e sao escaladas pela largura real do papel (58 mm, 80 mm, calibrada).
# Fontes DejaVu (as dos modelos) vao junto do Assistente, em src/fonts; sem elas, Arial e
# Lucida Console.
$canvasH = 20000
$canvas = New-Object System.Drawing.Bitmap($dotW, $canvasH)
$canvas.SetResolution($dpi, $dpi)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
# Retangulo em coordenada inteira cai exatamente nos pontos (fio de 2 pontos = 2 linhas).
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$sobreposicoes = 0
$ehPreConta = ($doc.modelo -eq 'pre_conta')

$s = $dotW / 576.0
function Px([double]$v) { return $v * $script:s }

# Cores medidas nos modelos.
function Pincel([int]$v) { return New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, $v, $v, $v)) }
$preto = Pincel 17
$branco = [System.Drawing.Brushes]::White
$cinzaTexto = if ($ehPreConta) { Pincel 71 } else { Pincel 95 }
$cinzaFio = if ($ehPreConta) { Pincel 192 } else { Pincel 220 }
$cinzaBarra = Pincel 207

# Margens do modelo: 52 na comanda, 28 na pre-conta.
$m = [Math]::Round((Px $(if ($ehPreConta) { 28 } else { 52 })))
$direita = $dotW - $m
$uw = $direita - $m

# -- fontes -----------------------------------------------------------------------------
# Uma colecao por arquivo: com regular e negrito na mesma colecao o GDI+ troca as faces
# (o regular saia com o arquivo do negrito, ou o negrito era sintetizado do regular).
$colecoes = New-Object System.Collections.Generic.List[object]
function FamiliaDe([string]$arq) {
  try {
    $p = Join-Path (Join-Path $PSScriptRoot 'fonts') $arq
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    $c = New-Object System.Drawing.Text.PrivateFontCollection
    $c.AddFontFile($p)
    $script:colecoes.Add($c)
    return $c.Families[0]
  } catch { Write-Log ("FONTES: {0} falhou ({1})" -f $arq, $_.Exception.Message); return $null }
}
$famSansB = FamiliaDe 'DejaVuSans-Bold.ttf'
$famMono = FamiliaDe 'DejaVuSansMono.ttf'
$famMonoB = FamiliaDe 'DejaVuSansMono-Bold.ttf'
$famSans = $famSansB
if (-not $famSansB) { $famSansB = New-Object System.Drawing.FontFamily('Arial'); $famSans = $famSansB }
if (-not $famMono) { $famMono = New-Object System.Drawing.FontFamily('Lucida Console') }
if (-not $famMonoB) { $famMonoB = $famMono }
Write-Log ("FONTES: sans='{0}' mono='{1}' monoNegrito='{2}'" -f $famSansB.Name, $famMono.Name, $famMonoB.Name)

$cacheFonte = @{}
$cacheTopo = @{}
function Fonte2([string]$tipo, [double]$px, [bool]$negrito) {
  $tam = [Math]::Max(9.0, (Px $px))
  $k = "$tipo|$tam|$negrito"
  if (-not $script:cacheFonte.ContainsKey($k)) {
    $fam = if ($tipo -eq 'sans') { $script:famSansB } elseif ($negrito) { $script:famMonoB } else { $script:famMono }
    $st = if ($negrito) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $script:cacheFonte[$k] = New-Object System.Drawing.Font($fam, [single]$tam, $st, [System.Drawing.GraphicsUnit]::Pixel)
  }
  return $script:cacheFonte[$k]
}
function Sans([double]$px) { return Fonte2 'sans' $px $true }
function Mono([double]$px, [bool]$negrito = $false) { return Fonte2 'mono' $px $negrito }

# Distancia entre o ponto de desenho e o topo da tinta das maiusculas ('H'): os modelos
# foram medidos pelo topo da tinta.
function TopoTinta($f) {
  $k = "$($f.Name)|$($f.Size)|$($f.Style)"
  if (-not $script:cacheTopo.ContainsKey($k)) {
    $bmp = New-Object System.Drawing.Bitmap(60, 120)
    $gg = [System.Drawing.Graphics]::FromImage($bmp)
    $gg.Clear([System.Drawing.Color]::White)
    $gg.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $gg.DrawString('H', $f, [System.Drawing.Brushes]::Black, 5, 10, $script:sf)
    $topo = 0
    for ($yy = 0; $yy -lt 120 -and $topo -eq 0; $yy++) { for ($xx = 0; $xx -lt 60; $xx++) { if ($bmp.GetPixel($xx, $yy).R -lt 128) { $topo = $yy - 10; break } } }
    $gg.Dispose(); $bmp.Dispose()
    $script:cacheTopo[$k] = $topo
  }
  return $script:cacheTopo[$k]
}

function Texto([string]$t, $f, [double]$x, [double]$tinta, $pincel = $preto) {
  $g.DrawString($t, $f, $pincel, [single]$x, [single]($tinta - (TopoTinta $f)), $sf)
}
function TextoDir([string]$t, $f, [double]$xDireita, [double]$tinta, $pincel = $preto) { Texto $t $f ($xDireita - (Larg $t $f)) $tinta $pincel }
function TextoCentro([string]$t, $f, [double]$cx, [double]$tinta, $pincel = $preto) { Texto $t $f ($cx - (Larg $t $f) / 2.0) $tinta $pincel }
function Faixa([double]$yy, [double]$h, $pincel) { $g.FillRectangle($pincel, [int][Math]::Round($m), [int][Math]::Round($yy), [int][Math]::Round($uw + 1), [int][Math]::Round($h)) }
# Fio horizontal de largura inteira, em y inteiro (sem meia linha borrada).
function Fio($pincel, [double]$yy, [double]$esp) { $g.FillRectangle($pincel, [int][Math]::Round($m), [int][Math]::Round($yy), [int][Math]::Round($uw + 1), [int][Math]::Max(1, [Math]::Round((Px $esp)))) }

function RetArred($pincel, [double]$x, [double]$yy, [double]$w, [double]$h, [double]$r) {
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [Math]::Max(1.0, 2 * $r)
  $gp.AddArc([single]$x, [single]$yy, [single]$d, [single]$d, 180, 90)
  $gp.AddArc([single]($x + $w - $d), [single]$yy, [single]$d, [single]$d, 270, 90)
  $gp.AddArc([single]($x + $w - $d), [single]($yy + $h - $d), [single]$d, [single]$d, 0, 90)
  $gp.AddArc([single]$x, [single]($yy + $h - $d), [single]$d, [single]$d, 90, 90)
  $gp.CloseFigure()
  $g.FillPath($pincel, $gp)
  $gp.Dispose()
}

# Icone do Instagram no meio do QR.
function IconeInstagram([double]$cx, [double]$cy, [double]$lado) {
  $caixa = $lado * 1.3
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

# Distancia (no modelo, em pontos de 80 mm) do ponto de referencia do bloco anterior ao do
# atual. Ponto de referencia = topo da tinta da 1a linha de texto, ou o topo da faixa/fio/
# logo. Medido nos dois PNGs de referencia.
$AVANCO = @{
  # comanda
  'inicio>topo' = 20; 'topo>faixa_num' = 106; 'faixa_num>secao' = 81; 'faixa_num>centro' = 75; 'centro>secao' = 40
  'secao>item_bola' = 66; 'secao>par' = 63; 'secao>dado' = 62
  'item_bola>detalhes' = 32; 'item_bola>item_bola' = 56; 'item_bola>secao' = 61; 'item_bola>obs_pedido' = 50
  'detalhes>item_bola' = 46; 'detalhes>secao' = 51; 'detalhes>obs_pedido' = 40; 'obs_pedido>secao' = 51
  'par>par' = 31; 'par>rotulo_valor' = 31; 'rotulo_valor>rotulo_valor' = 31; 'rotulo_valor>faixa_total' = 36; 'par>faixa_total' = 36
  'faixa_total>regua' = 86; 'regua>secao' = 40; 'dado>dado' = 31; 'dado>qr' = 42; 'qr>rodape' = 198; 'dado>rodape' = 50
  # pre-conta
  'inicio>topo_data' = 22; 'topo_data>linha_grossa' = 90; 'linha_grossa>faixa_arred' = 26; 'faixa_arred>centro' = 96
  'centro>mesa' = 43; 'centro>centro' = 28; 'linha_grossa>secao_sem_linha' = 29; 'secao_sem_linha>tabela_cab' = 65
  'tabela_cab>regua' = 28; 'regua>tabela_item' = 42; 'tabela_item>tabela_item' = 54; 'tabela_item>regua' = 58
  'regua>par_pc' = 22; 'par_pc>par_pc' = 38; 'par_pc>linha_grossa' = 38; 'linha_grossa>total_grande' = 31
  'total_grande>centro' = 85; 'centro>tracejado' = 28; 'tracejado>centro' = 27; 'espaco>centro' = 56
  'mesa>dado' = 119; 'dado>linha_grossa' = 41
}
# Rabo do documento depois do ultimo ponto de referencia (margem de baixo do modelo).
$RABO = @{ 'rodape' = 32; 'centro' = 59 }

$y = 0.0
$ant = 'inicio'
$extraAnt = 0.0     # quanto o bloco anterior cresceu alem do modelo (linhas quebradas)
$marcasTopo = 0.0
$fimConteudo = 0.0

function Avancar([string]$tipo) {
  $k = "$($script:ant)>$tipo"
  $d = if ($script:AVANCO.ContainsKey($k)) { $script:AVANCO[$k] } else { 30 }
  $script:y += (Px $d) + $script:extraAnt
  $script:extraAnt = 0.0
  $script:ant = $tipo
}

foreach ($b in $doc.blocos) {
  switch ($b.t) {
    'marcas' {
      # Tracos curtos junto as bordas (teste): se um lado do papel cortar, o traco some.
      $alto = [int][Math]::Max(12, (Px 14))
      $yy = if ($y -lt 1) { 6 } else { $y + $extraAnt + (Px 40) }
      $passo = [Math]::Max(24, [int]($dotW / 16))
      for ($x = 0; $x -lt $dotW - 3; $x += $passo) { $g.FillRectangle($preto, $x, [int]$yy, 3, $alto) }
      $g.FillRectangle($preto, $dotW - 3, [int]$yy, 3, $alto)
      if ($y -lt 1) { $y = $alto + 10 } else { $fimConteudo = $yy + $alto + 10 }
    }
    'topo' {
      Avancar 'topo'
      # Logo MZ (circulo), horarios a esquerda e o tipo do pedido a direita.
      $cx = $dotW / 2.0; $d = Px 86; $e = [Math]::Max(2.0, (Px 3))
      $g.FillEllipse($preto, [single]($cx - $d / 2), [single]$y, [single]$d, [single]$d)
      $g.FillEllipse($branco, [single]($cx - $d / 2 + $e), [single]($y + $e), [single]($d - 2 * $e), [single]($d - 2 * $e))
      TextoCentro 'MZ' (Sans 27.5) $cx ($y + (Px 31))
      $g.FillRectangle($preto, [single]($cx - (Px 21.5)), [single]($y + (Px 59)), [single](Px 43), [single][Math]::Max(1.5, (Px 3)))
      # Texto miudo do monograma: no papel estreito encolhe abaixo do minimo geral para
      # caber dentro do circulo (72% do diametro).
      $fMz = New-Object System.Drawing.Font($famSansB, [single][Math]::Max(5.0, (Px 8)), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      while ((Larg 'MENUZIA' $fMz) -gt ($d * 0.6) -and $fMz.Size -gt 4) { $fMz = New-Object System.Drawing.Font($famSansB, [single]($fMz.Size - 0.5), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
      TextoCentro 'MENUZIA' $fMz $cx ($y + (Px 65))
      $fr = Mono 14.5
      $i = 0
      foreach ($par in @($b.linhas)) {
        Texto ([string]$par[0]) $fr ($m + (Px 1)) ($y + (Px 17) + $i * (Px 26)) $cinzaTexto
        Texto ([string]$par[1]) $fr ($m + (Px 91)) ($y + (Px 17) + $i * (Px 26)) $cinzaTexto
        $i++
      }
      $fd = Mono 18 $true
      $txt = [string]$b.direita
      $maxDir = $direita - ($cx + $d / 2) - (Px 6)
      while ((Larg $txt $fd) -gt $maxDir -and $fd.Size -gt 9) { $fd = New-Object System.Drawing.Font($famMonoB, [single]($fd.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
      TextoDir $txt $fd $direita ($y + (Px 31))
    }
    'topo_data' {
      Avancar 'topo_data'
      # Logo MZ (quadrado arredondado) e a data a esquerda.
      $cx = $dotW / 2.0; $w = Px 81; $h = Px 56; $e = [Math]::Max(2.0, (Px 3)); $r = Px 7
      RetArred $preto ($cx - $w / 2) $y $w $h $r
      RetArred $branco ($cx - $w / 2 + $e) ($y + $e) ($w - 2 * $e) ($h - 2 * $e) ([Math]::Max(1, $r - $e))
      TextoCentro 'MZ' (Sans 30) ($cx + (Px 1)) ($y + (Px 20))
      Texto ([string]$b.data) (Mono 16) ($m + (Px 1)) ($y + (Px 13)) $cinzaTexto
      if ($b.via) { TextoDir ([string]$b.via) (Mono 14 $true) $direita ($y + (Px 13)) }
    }
    'faixa_num' {
      Avancar 'faixa_num'
      $h = Px 57
      Faixa $y $h $preto
      Texto ([string]$b.esq) (Sans 38) ($m + (Px 21)) ($y + (Px 17)) $branco
      TextoDir ([string]$b.dir) (Sans 22) ($direita - (Px 18)) ($y + (Px 21)) $branco
    }
    'faixa_arred' {
      Avancar 'faixa_arred'
      RetArred $preto $m $y ($uw + 1) (Px 61) (Px 6)
      TextoCentro ([string]$b.s) (Sans 30) ($dotW / 2.0) ($y + (Px 21)) $branco
    }
    'secao' {
      $depoisDaFaixa = ($ant -eq 'faixa_num')
      Avancar 'secao'
      Texto ([string]$b.s) (Sans 22) $m $y
      # Regua: 27 pontos abaixo do titulo logo depois da faixa do numero, 25 nas outras (modelo).
      Fio $preto ($y + (Px $(if ($depoisDaFaixa) { 27 } else { 25 }))) 2
    }
    'secao_sem_linha' {
      Avancar 'secao_sem_linha'
      Texto ([string]$b.s) (Sans 24.5) $m $y
    }
    'item_bola' {
      Avancar 'item_bola'
      $script:inicioItem = $y
      $r = Px 5.5
      $g.FillEllipse($preto, [single]($m + (Px 2)), [single]($y + (Px 4)), [single](2 * $r), [single](2 * $r))
      $fq = Mono 19 $true; $fn = Mono 20 $true; $fv = Mono 18 $true
      Texto ([string]$b.qtd) $fq ($m + (Px 32)) $y
      TextoDir ([string]$b.valor) $fv ($direita - (Px 1)) ($y + (Px 1))
      $xn = $m + (Px 79)
      $lim = ($direita - (Larg ([string]$b.valor) $fv) - (Px 14)) - $xn
      $ls = Quebrar ([string]$b.nome) $fn $lim
      for ($i = 0; $i -lt $ls.Count; $i++) { Texto $ls[$i] $fn $xn ($y + $i * (Px 26)) }
      $extraAnt = ($ls.Count - 1) * (Px 26)
    }
    'detalhes' {
      $linhas = @($b.linhas | Where-Object { $_ })
      if ($linhas.Count -eq 0 -and -not $b.obs) { continue }
      Avancar 'detalhes'
      $fd = Mono 15; $fo = Mono 14
      $x0 = $m + (Px 41)
      $yy = $y
      $primeira = $true
      foreach ($l in $linhas) {
        if (-not $primeira) { $yy += (Px 24) }
        $primeira = $false
        $vw = 0
        if ($l.valor) { $vw = Larg ([string]$l.valor) $fd; TextoDir ([string]$l.valor) $fd ($direita - (Px 2)) $yy }
        $lim = $direita - (Px 2) - $x0 - $(if ($vw -gt 0) { $vw + (Px 14) } else { 0 })
        $ls = Quebrar ([string]$l.s) $fd $lim
        for ($i = 0; $i -lt $ls.Count; $i++) { if ($i -gt 0) { $yy += (Px 24) }; Texto $ls[$i] $fd $x0 $yy $cinzaTexto }
      }
      if ($b.obs) {
        $ls = Quebrar ([string]$b.obs) $fo ($direita - $x0 - (Px 2))
        for ($i = 0; $i -lt $ls.Count; $i++) { if (-not $primeira -or $i -gt 0) { $yy += (Px 25) }; $primeira = $false; Texto $ls[$i] $fo ($x0 + (Px 2)) $yy $cinzaTexto }
      }
      # Fio vertical cinza a esquerda dos adicionais (como o modelo).
      $g.FillRectangle($cinzaBarra, [single]($m + (Px 7)), [single]($script:inicioItem + (Px 27)), [single][Math]::Max(1.0, (Px 2)), [single]($yy + (Px 14) - ($script:inicioItem + (Px 27))))
      $extraAnt = $yy - $y
    }
    'obs_pedido' {
      Avancar 'obs_pedido'
      $f = Mono 15 $true
      $ls = Quebrar ([string]$b.s) $f $uw
      for ($i = 0; $i -lt $ls.Count; $i++) { Texto $ls[$i] $f $m ($y + $i * (Px 22)) }
      $extraAnt = ($ls.Count - 1) * (Px 22)
    }
    'par' {
      Avancar 'par'
      Texto ([string]$b.rotulo) (Mono 16) ($m + (Px 1)) $y
      TextoDir ([string]$b.valor) (Mono 16 $true) ($direita - (Px 1)) $y
    }
    'rotulo_valor' {
      Avancar 'rotulo_valor'
      $fr = Mono 16
      Texto ([string]$b.rotulo) $fr $m $y $cinzaTexto
      Texto ([string]$b.valor) (Mono 16 $true) ($m + (Larg ('{0} ' -f $b.rotulo) $fr)) $y
    }
    'faixa_total' {
      Avancar 'faixa_total'
      $h = Px 59
      Faixa $y $h $preto
      $fr = Sans 21; $fv = Sans 36
      while (((Larg ([string]$b.rotulo) $fr) + (Larg ([string]$b.valor) $fv) + (Px 60)) -gt $uw -and $fv.Size -gt 12) { $fv = New-Object System.Drawing.Font($famSans, [single]($fv.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
      Texto ([string]$b.rotulo) $fr ($m + (Px 18)) ($y + (Px 18)) $branco
      $vw = Larg ([string]$b.valor) $fv
      TextoDir ([string]$b.valor) $fv ($direita - (Px 20)) ($y + (Px 15)) $branco
      Write-Log ("TOTAL: valor='{0}' x={1}..{2} papel={3} fonte={4}" -f $b.valor, [int]($direita - (Px 20) - $vw), [int]($direita - (Px 20)), $dotW, $fv.Size)
    }
    'regua' {
      Avancar 'regua'
      Fio $cinzaFio $y 1
    }
    'linha_grossa' {
      Avancar 'linha_grossa'
      Fio $preto $y 2
    }
    'dado' {
      Avancar 'dado'
      $fr = Mono 14.5
      $fv = if ($b.negrito) { Mono 16 $true } else { Mono 15 }
      $col = $m + [Math]::Max((Px 104), (Larg ('{0}  ' -f $b.rotulo) $fr))
      Texto ([string]$b.rotulo) $fr ($m + (Px 1)) $y $cinzaTexto
      $ls = Quebrar ([string]$b.valor) $fv ($direita - $col)
      for ($i = 0; $i -lt $ls.Count; $i++) { Texto $ls[$i] $fv $col ($y + $i * (Px 22)) }
      $extraAnt = ($ls.Count - 1) * (Px 22)
    }
    'qr' {
      Avancar 'qr'
      $linhasQr = @($b.linhas)
      $n = $linhasQr.Count
      $mod = [Math]::Max(2, [int][Math]::Round((Px 164) / $n))
      $lado = $mod * $n
      $x0 = [int](($dotW - $lado) / 2)
      $y0 = [int]$y
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
      if ($b.icone -eq 'instagram') { IconeInstagram ($x0 + $lado / 2.0) ($y0 + $lado / 2.0) ($lado * 0.18) }
      Write-Log ("QR: {0}x{0} modulos, {1} pt cada, lado {2} pt, icone='{3}'" -f $n, $mod, $lado, $b.icone)
      $extraAnt = $lado - (Px 164)
    }
    'rodape' {
      Avancar 'rodape'
      TextoCentro ([string]$b.s) (Mono 15) ($dotW / 2.0) $y $cinzaTexto
    }
    'mesa' {
      Avancar 'mesa'
      $ft = Sans 32
      $tit = [string]$b.titulo
      $colR = $m + (Px 307)
      while ((Larg $tit $ft) -gt ($colR - $m - (Px 12)) -and $ft.Size -gt 12) { $ft = New-Object System.Drawing.Font($famSans, [single]($ft.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
      Texto $tit $ft $m $y
      if ($b.sub) { Texto ([string]$b.sub) (Mono 20 $true) $m ($y + (Px 43)) }
      $fr = Mono 16; $fv = Mono 20 $true
      $i = 0
      foreach ($par in @($b.pares)) {
        $yy = $y - (Px 2) + $i * (Px 40)
        Texto ([string]$par[0]) $fr $colR ($yy + (Px 1)) $cinzaTexto
        $v = [string]$par[1]
        $maxV = $direita - $colR - (Larg ('{0}  ' -f $par[0]) $fr)
        while ((Larg $v $fv) -gt $maxV -and $v.Length -gt 2) { $v = $v.Substring(0, $v.Length - 1) }
        TextoDir $v $fv ($direita - (Px 1)) $yy
        $i++
      }
      # A linha de baixo fica 41 pontos abaixo da ultima linha da direita (modelo: 3 linhas).
      $n = [Math]::Max(1, @($b.pares).Count)
      $baixo = [Math]::Max(((Px -2) + ($n - 1) * (Px 40) + (Px 41)), (Px 119))
      $extraAnt = $baixo - (Px 119)
      $script:AVANCO['mesa>linha_grossa'] = 119
    }
    'tabela_cab' {
      Avancar 'tabela_cab'
      $f = Mono 16.5 $true
      TextoCentro 'QTD' $f ($m + (Px 29)) $y $cinzaTexto
      Texto 'DESCRICAO' $f ($m + (Px 71)) $y $cinzaTexto
      TextoDir 'UNIT.' $f ($m + (Px 408)) $y $cinzaTexto
      TextoDir 'TOTAL' $f ($direita - (Px 1)) $y $cinzaTexto
    }
    'tabela_item' {
      Avancar 'tabela_item'
      $fq = Mono 22; $fd = Mono 22; $fu = Mono 20; $ft = Mono 21 $true; $fs = Mono 14
      TextoCentro ([string]$b.qtd) $fq ($m + (Px 26)) $y
      $uwid = Larg ([string]$b.unit) $fu
      TextoDir ([string]$b.unit) $fu ($m + (Px 406)) ($y - (Px 1))
      TextoDir ([string]$b.total) $ft ($direita - (Px 1)) $y
      $xd = $m + (Px 70)
      $lim = ($m + (Px 406)) - $uwid - (Px 14) - $xd
      $ls = Quebrar ([string]$b.desc) $fd $lim
      $yy = $y
      for ($i = 0; $i -lt $ls.Count; $i++) {
        if ($i -gt 0) { $yy += (Px 28) }
        if ((Larg $ls[$i] $fd) -gt $lim + 0.5) { $script:sobreposicoes++ }
        Texto $ls[$i] $fd $xd $yy
      }
      $extra = ($ls.Count - 1) * (Px 24)
      $ySub = $yy + (Px 26)
      foreach ($sub in @($b.subs)) {
        if (-not $sub) { continue }
        foreach ($ln in (Quebrar ([string]$sub) $fs ($direita - $xd - (Px 12)))) { Texto $ln $fs ($xd + (Px 12)) $ySub $cinzaTexto; $ySub += (Px 20); $extra += (Px 20) }
      }
      $extraAnt = $extra
    }
    'par_pc' {
      Avancar 'par_pc'
      $fr = Mono 20; $fv = Mono 20 $true
      TextoDir ([string]$b.valor) $fv ($direita - (Px 2)) $y
      $lim = $uw - (Larg ([string]$b.valor) $fv) - (Px 14)
      $ls = Quebrar ([string]$b.rotulo) $fr $lim
      for ($i = 0; $i -lt $ls.Count; $i++) { Texto $ls[$i] $fr $m ($y + $i * (Px 26)) }
      $extraAnt = ($ls.Count - 1) * (Px 26)
    }
    'total_grande' {
      Avancar 'total_grande'
      $fr = Sans 28; $fv = Sans 36
      while (((Larg ([string]$b.rotulo) $fr) + (Larg ([string]$b.valor) $fv) + (Px 20)) -gt $uw -and $fv.Size -gt 12) {
        $fv = New-Object System.Drawing.Font($famSans, [single]($fv.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        if ($fr.Size -gt 12) { $fr = New-Object System.Drawing.Font($famSans, [single]($fr.Size - 1), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
      }
      Texto ([string]$b.rotulo) $fr $m ($y + (Px 5))
      $vw = Larg ([string]$b.valor) $fv
      TextoDir ([string]$b.valor) $fv ($direita - (Px 2)) $y
      Write-Log ("TOTAL: valor='{0}' x={1}..{2} papel={3} fonte={4}" -f $b.valor, [int]($direita - (Px 2) - $vw), [int]($direita - (Px 2)), $dotW, $fv.Size)
    }
    'centro' {
      Avancar 'centro'
      $f = if ($b.negrito) { Mono 18 $true } elseif ($b.maior) { Mono 18 } else { Mono 16 }
      $ls = Quebrar ([string]$b.s) $f $uw
      for ($i = 0; $i -lt $ls.Count; $i++) { TextoCentro $ls[$i] $f ($dotW / 2.0) ($y + $i * (Px 24)) }
      $extraAnt = ($ls.Count - 1) * (Px 24)
    }
    'tracejado' {
      Avancar 'tracejado'
      $traco = [Math]::Max(3.0, (Px 9)); $vao = [Math]::Max(2.0, (Px 6)); $alt2 = [Math]::Max(1.0, (Px 2))
      for ($x = $m + (Px 30); $x + $traco -le $direita - (Px 31) + 0.5; $x += $traco + $vao) { $g.FillRectangle($preto, [int][Math]::Round($x), [int][Math]::Round($y), [int][Math]::Round($traco), [int][Math]::Round($alt2)) }
    }
    'espaco' { $ant = 'espaco' }
    'corte' { }
  }
  if ($b.t -ne 'marcas' -and $b.t -ne 'corte' -and $b.t -ne 'espaco') { $fimConteudo = [Math]::Max($fimConteudo, $y + $extraAnt + (Px 20)) }
}
# Margem de baixo do modelo e um pouco de papel para o corte.
$rabo = if ($RABO.ContainsKey($ant)) { $RABO[$ant] } else { 40 }
$y = [Math]::Max($fimConteudo, $y + $extraAnt + (Px $rabo)) + 30
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
