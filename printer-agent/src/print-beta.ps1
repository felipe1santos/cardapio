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

# -- desenho (v4, 2026-09-28): modelos oficiais com foco em LEITURA -------------------
# Mesma estrutura dos modelos (docs/referencias/impressao), ajustada a pedido do dono para
# ler rapido no balcao e na cozinha: fontes maiores, margem menor, cada secao numa faixa
# preta (ITENS, VALORES, TOTAL...), cinza so escuro (termica nao imprime cinza claro) e QR
# maior. Medidas em pontos de 80 mm (576) escaladas pela largura real do papel; as fontes
# encolhem no maximo ate 78% no papel estreito (58 mm) para continuar legiveis.
$canvasH = 20000
$canvas = New-Object System.Drawing.Bitmap($dotW, $canvasH)
$canvas.SetResolution($dpi, $dpi)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
# Retangulo em coordenada inteira cai exatamente nos pontos.
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$sobreposicoes = 0
$ehPreConta = ($doc.modelo -eq 'pre_conta')

$s = $dotW / 576.0
$escalaFonte = [Math]::Max($s, 0.78)
function Px([double]$v) { return $v * $script:s }

function Pincel([int]$v) { return New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, $v, $v, $v)) }
$preto = Pincel 0
$branco = [System.Drawing.Brushes]::White
$cinzaTexto = Pincel 55
$cinzaBarra = Pincel 110

$m = [Math]::Round((Px 18))
$direita = $dotW - $m
$uw = $direita - $m

# -- fontes -----------------------------------------------------------------------------
# Uma colecao por arquivo: com regular e negrito na mesma colecao o GDI+ troca as faces.
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
if (-not $famSansB) { $famSansB = New-Object System.Drawing.FontFamily('Arial') }
if (-not $famMono) { $famMono = New-Object System.Drawing.FontFamily('Lucida Console') }
if (-not $famMonoB) { $famMonoB = $famMono }
Write-Log ("FONTES: sans='{0}' mono='{1}' monoNegrito='{2}'" -f $famSansB.Name, $famMono.Name, $famMonoB.Name)

$cacheFonte = @{}
$cacheTopo = @{}
function NovaFonte([string]$tipo, [double]$tam, [bool]$negrito) {
  $fam = if ($tipo -eq 'sans') { $script:famSansB } elseif ($negrito) { $script:famMonoB } else { $script:famMono }
  $st = if ($negrito -or $tipo -eq 'sans') { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  return New-Object System.Drawing.Font($fam, [single][Math]::Max(9.0, $tam), $st, [System.Drawing.GraphicsUnit]::Pixel)
}
function Fonte2([string]$tipo, [double]$px, [bool]$negrito) {
  $tam = [Math]::Round([Math]::Max(10.0, $px * $script:escalaFonte) * 2) / 2
  $k = "$tipo|$tam|$negrito"
  if (-not $script:cacheFonte.ContainsKey($k)) { $script:cacheFonte[$k] = NovaFonte $tipo $tam $negrito }
  return $script:cacheFonte[$k]
}
function Sans([double]$px) { return Fonte2 'sans' $px $true }
function Mono([double]$px, [bool]$negrito = $false) { return Fonte2 'mono' $px $negrito }
# Encolhe a fonte ate o texto caber na largura (valores e titulos em papel estreito).
function Caber([string]$t, $f, [double]$maxW) {
  $tipo = if ($f.FontFamily.Name -like '*Mono*' -or $f.FontFamily.Name -like 'Lucida*') { 'mono' } else { 'sans' }
  $neg = ($f.Style -band [System.Drawing.FontStyle]::Bold) -ne 0
  while ((Larg $t $f) -gt $maxW -and $f.Size -gt 9) { $f = NovaFonte $tipo ($f.Size - 0.5) $neg }
  return $f
}

# Topo da tinta das maiusculas ('H') em relacao ao ponto de desenho.
function TopoTinta($f) {
  $k = "$($f.Name)|$($f.Size)|$($f.Style)"
  if (-not $script:cacheTopo.ContainsKey($k)) {
    $bmp = New-Object System.Drawing.Bitmap(60, 140)
    $gg = [System.Drawing.Graphics]::FromImage($bmp)
    $gg.Clear([System.Drawing.Color]::White)
    $gg.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $gg.DrawString('H', $f, [System.Drawing.Brushes]::Black, 5, 10, $script:sf)
    $topo = 0
    for ($yy = 0; $yy -lt 140 -and $topo -eq 0; $yy++) { for ($xx = 0; $xx -lt 60; $xx++) { if ($bmp.GetPixel($xx, $yy).R -lt 128) { $topo = $yy - 10; break } } }
    $gg.Dispose(); $bmp.Dispose()
    $script:cacheTopo[$k] = $topo
  }
  return $script:cacheTopo[$k]
}
# Altura "de maiuscula" da fonte (para centralizar texto em faixa) e altura de linha.
function Caps($f) { return $f.Size * 0.73 }
function LH($f, [double]$fator = 1.32) { return $f.Size * $fator }

function Texto([string]$t, $f, [double]$x, [double]$tinta, $pincel = $preto) {
  $g.DrawString($t, $f, $pincel, [single]$x, [single]($tinta - (TopoTinta $f)), $sf)
}
function TextoDir([string]$t, $f, [double]$xDireita, [double]$tinta, $pincel = $preto) { Texto $t $f ($xDireita - (Larg $t $f)) $tinta $pincel }
function TextoCentro([string]$t, $f, [double]$cx, [double]$tinta, $pincel = $preto) { Texto $t $f ($cx - (Larg $t $f) / 2.0) $tinta $pincel }
function Retangulo($pincel, [double]$x, [double]$yy, [double]$w, [double]$h) { $g.FillRectangle($pincel, [int][Math]::Round($x), [int][Math]::Round($yy), [int][Math]::Round($w), [int][Math]::Max(1, [Math]::Round($h))) }
function Fio($pincel, [double]$yy, [double]$esp) { Retangulo $pincel $m $yy ($uw + 1) ([Math]::Max(1, [Math]::Round((Px $esp)))) }

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

# Faixa preta de secao, com o titulo em branco (ITENS, VALORES, TOTAL, DADOS...).
function FaixaSecao([string]$titulo) {
  $h = Px 46
  Retangulo $preto $m $script:y ($uw + 1) $h
  $f = Caber $titulo (Sans 24) ($uw - (Px 28))
  Texto $titulo $f ($m + (Px 14)) ($script:y + ($h - (Caps $f)) / 2.0) $branco
  $script:y += $h
}

# Fluxo: $y = topo do proximo bloco. Cada bloco soma o espaco de antes e a propria altura.
$y = 8.0
$ant = 'inicio'
$ESPACO = @{
  'topo' = 10; 'topo_data' = 10; 'faixa_num' = 18; 'faixa_arred' = 14; 'centro' = 20; 'secao' = 26; 'mesa' = 22
  'item_bola' = 22; 'detalhes' = 6; 'obs_pedido' = 18; 'par' = 8; 'rotulo_valor' = 8; 'par_pc' = 8
  'faixa_total' = 20; 'regua' = 12; 'linha_grossa' = 16; 'dado' = 8; 'qr' = 22; 'rodape' = 16
  'tabela_cab' = 14; 'tabela_item' = 20; 'tracejado' = 14; 'total_grande' = 20
}
function Espaco([string]$tipo) {
  $d = if ($script:ESPACO.ContainsKey($tipo)) { $script:ESPACO[$tipo] } else { 12 }
  # Primeira linha depois de uma faixa de secao: respiro um pouco maior.
  if ($script:ant -eq 'secao' -and $tipo -ne 'secao') { $d = [Math]::Max($d, 16) }
  if ($script:ant -eq 'tabela_cab' -and $tipo -eq 'regua') { $d = 8 }
  # Depois da faixa do TOTAL e do tracejado, o rodape respira.
  if (($script:ant -eq 'faixa_total' -or $script:ant -eq 'tracejado') -and $tipo -eq 'centro') { $d = 24 }
  $script:y += (Px $d)
  $script:ant = $tipo
}

# Colunas da tabela da pre-conta.
$colQtdCentro = $m + (Px 22)
$colDesc = $m + (Px 56)
$colUnitDir = $m + $uw * 0.755

foreach ($b in $doc.blocos) {
  switch ($b.t) {
    'marcas' {
      # Tracos curtos junto as bordas (teste): se um lado do papel cortar, o traco some.
      $alto = [int][Math]::Max(12, (Px 14))
      $yy = if ($ant -eq 'inicio') { 4 } else { $y + (Px 24) }
      $passo = [Math]::Max(24, [int]($dotW / 16))
      for ($x = 0; $x -lt $dotW - 3; $x += $passo) { $g.FillRectangle($preto, $x, [int]$yy, 3, $alto) }
      $g.FillRectangle($preto, $dotW - 3, [int]$yy, 3, $alto)
      $y = $yy + $alto + 8
    }
    'topo' {
      Espaco 'topo'
      # Logo MZ (circulo), horarios a esquerda, tipo do pedido a direita.
      $cx = $dotW / 2.0; $d = Px 92; $e = [Math]::Max(2.0, (Px 3))
      $g.FillEllipse($preto, [single]($cx - $d / 2), [single]$y, [single]$d, [single]$d)
      $g.FillEllipse($branco, [single]($cx - $d / 2 + $e), [single]($y + $e), [single]($d - 2 * $e), [single]($d - 2 * $e))
      $fMz = NovaFonte 'sans' (Px 30) $true
      TextoCentro 'MZ' $fMz $cx ($y + $d * 0.24)
      Retangulo $preto ($cx - $d * 0.25) ($y + $d * 0.66) ($d * 0.5) ([Math]::Max(2, (Px 3)))
      # Texto miudo do monograma: pode ficar abaixo do minimo geral para caber no circulo.
      $tamN = [Math]::Max(5.0, (Px 9))
      $fN = New-Object System.Drawing.Font($famSansB, [single]$tamN, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      while ((Larg 'MENUZIA' $fN) -gt ($d * 0.6) -and $tamN -gt 4.5) { $tamN -= 0.5; $fN = New-Object System.Drawing.Font($famSansB, [single]$tamN, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
      TextoCentro 'MENUZIA' $fN $cx ($y + $d * 0.73)
      # Horarios: rotulo e hora empilhados em duas colunas, legiveis.
      $fr = Mono 17; $fh = Mono 19 $true
      $larLado = $cx - $d / 2 - $m - (Px 6)
      $linhas = @($b.linhas)
      $hl = LH $fh 1.45
      $yl = $y + [Math]::Max(0, ($d - $linhas.Count * $hl) / 2.0)
      foreach ($par in $linhas) {
        $rot = [string]$par[0]; $hora = [string]$par[1]
        # Rotulo e hora lado a lado, longe da logo.
        $fr2 = Caber $rot $fr ($larLado * 0.58)
        Texto $rot $fr2 $m $yl $cinzaTexto
        $xh = $m + (Larg 'Recebido ' $fr2)
        Texto $hora (Caber $hora $fh ($m + $larLado - $xh)) $xh $yl
        $yl += $hl
      }
      $txt = [string]$b.direita
      $fd = Caber $txt (Mono 22 $true) ($direita - ($cx + $d / 2) - (Px 6))
      TextoDir $txt $fd $direita ($y + ($d - (Caps $fd)) / 2.0)
      $y += $d
    }
    'topo_data' {
      Espaco 'topo_data'
      $cx = $dotW / 2.0; $w = Px 88; $h = Px 60; $e = [Math]::Max(2.0, (Px 3)); $r = Px 8
      RetArred $preto ($cx - $w / 2) $y $w $h $r
      RetArred $branco ($cx - $w / 2 + $e) ($y + $e) ($w - 2 * $e) ($h - 2 * $e) ([Math]::Max(1, $r - $e))
      $fMz = NovaFonte 'sans' (Px 32) $true
      TextoCentro 'MZ' $fMz $cx ($y + ($h - (Caps $fMz)) / 2.0)
      $fdt = Caber ([string]$b.data) (Mono 19) ($cx - $w / 2 - $m - (Px 6))
      Texto ([string]$b.data) $fdt $m ($y + ($h - (Caps $fdt)) / 2.0) $cinzaTexto
      if ($b.via) {
        $fv = Caber ([string]$b.via) (Mono 19 $true) ($direita - ($cx + $w / 2) - (Px 6))
        TextoDir ([string]$b.via) $fv $direita ($y + ($h - (Caps $fv)) / 2.0)
      }
      $y += $h
    }
    'linha_grossa' {
      Espaco 'linha_grossa'
      Fio $preto $y 2
      $y += (Px 2)
    }
    'faixa_num' {
      Espaco 'faixa_num'
      $h = Px 64
      Retangulo $preto $m $y ($uw + 1) $h
      $fe = Caber ([string]$b.esq) (Sans 42) ($uw * 0.5)
      $fdd = Caber ([string]$b.dir) (Sans 26) ($uw * 0.45)
      Texto ([string]$b.esq) $fe ($m + (Px 16)) ($y + ($h - (Caps $fe)) / 2.0) $branco
      TextoDir ([string]$b.dir) $fdd ($direita - (Px 16)) ($y + ($h - (Caps $fdd)) / 2.0) $branco
      $y += $h
    }
    'faixa_arred' {
      Espaco 'faixa_arred'
      $h = Px 64
      RetArred $preto $m $y ($uw + 1) $h (Px 6)
      $f = Caber ([string]$b.s) (Sans 34) ($uw - (Px 20))
      TextoCentro ([string]$b.s) $f ($dotW / 2.0) ($y + ($h - (Caps $f)) / 2.0) $branco
      $y += $h
    }
    { $_ -eq 'secao' -or $_ -eq 'secao_sem_linha' } {
      Espaco 'secao'
      FaixaSecao ([string]$b.s)
    }
    'centro' {
      Espaco 'centro'
      $f = if ($b.negrito) { Mono 20 $true } elseif ($b.maior) { Mono 21 } else { Mono 19 }
      $ls = Quebrar ([string]$b.s) $f $uw
      foreach ($ln in $ls) { TextoCentro $ln $f ($dotW / 2.0) $y; $y += (LH $f) }
      $y -= (LH $f) - (Caps $f)
    }
    'item_bola' {
      Espaco 'item_bola'
      $script:inicioItem = $y
      $fq = Mono 24 $true; $fn = Mono 24 $true; $fv = Mono 23 $true
      $r = Px 6
      $g.FillEllipse($preto, [single]$m, [single]($y + (Caps $fn) / 2.0 - $r), [single](2 * $r), [single](2 * $r))
      $xq = $m + (Px 24)
      Texto ([string]$b.qtd) $fq $xq $y
      $xn = $xq + (Larg ('{0} ' -f $b.qtd) $fq) + (Px 4)
      TextoDir ([string]$b.valor) $fv $direita $y
      $lim = $direita - (Larg ([string]$b.valor) $fv) - (Px 14) - $xn
      $ls = Quebrar ([string]$b.nome) $fn $lim
      for ($i = 0; $i -lt $ls.Count; $i++) { if ($i -gt 0) { $y += (LH $fn 1.25) }; Texto $ls[$i] $fn $xn $y }
      $y += (Caps $fn)
    }
    'detalhes' {
      $linhas = @($b.linhas | Where-Object { $_ })
      if ($linhas.Count -eq 0 -and -not $b.obs) { continue }
      Espaco 'detalhes'
      $fd = Mono 20; $fvl = Mono 20; $fo = Mono 20 $true
      $x0 = $m + (Px 32)
      $ini = $y
      foreach ($l in $linhas) {
        $y += (LH $fd 1.25) - (Caps $fd)
        $vw = 0
        if ($l.valor) { $vw = Larg ([string]$l.valor) $fvl; TextoDir ([string]$l.valor) $fvl $direita $y }
        $lim = $direita - $x0 - $(if ($vw -gt 0) { $vw + (Px 14) } else { 0 })
        $ls = Quebrar ([string]$l.s) $fd $lim
        for ($i = 0; $i -lt $ls.Count; $i++) { if ($i -gt 0) { $y += (LH $fd 1.25) }; Texto $ls[$i] $fd $x0 $y $cinzaTexto }
        $y += (Caps $fd)
      }
      if ($b.obs) {
        $ls = Quebrar ([string]$b.obs) $fo ($direita - $x0)
        foreach ($ln in $ls) { $y += (LH $fo 1.3) - (Caps $fo); Texto $ln $fo $x0 $y; $y += (Caps $fo) }
      }
      # Fio vertical a esquerda dos adicionais: agrupa o que e do item.
      Retangulo $cinzaBarra ($m + (Px 5)) ($ini - (Px 2)) ([Math]::Max(2, (Px 3))) ($y - $ini + (Px 6))
    }
    'obs_pedido' {
      Espaco 'obs_pedido'
      $f = Mono 20 $true
      $ls = Quebrar ([string]$b.s) $f $uw
      for ($i = 0; $i -lt $ls.Count; $i++) { if ($i -gt 0) { $y += (LH $f) }; Texto $ls[$i] $f $m $y }
      $y += (Caps $f)
    }
    'par' {
      Espaco 'par'
      $y += (Px 4)
      $fr = Mono 21; $fv = Mono 21 $true
      Texto ([string]$b.rotulo) $fr $m $y
      TextoDir ([string]$b.valor) $fv $direita $y
      $y += (Caps $fr) + (Px 4)
    }
    'rotulo_valor' {
      Espaco 'rotulo_valor'
      $y += (Px 4)
      $fr = Mono 21; $fv = Mono 21 $true
      Texto ([string]$b.rotulo) $fr $m $y $cinzaTexto
      TextoDir ([string]$b.valor) $fv $direita $y
      $y += (Caps $fr) + (Px 4)
    }
    'par_pc' {
      Espaco 'par_pc'
      $y += (Px 4)
      $fr = Mono 22; $fv = Mono 22 $true
      $vw = Larg ([string]$b.valor) $fv
      TextoDir ([string]$b.valor) $fv $direita $y
      $ls = Quebrar ([string]$b.rotulo) $fr ($uw - $vw - (Px 14))
      for ($i = 0; $i -lt $ls.Count; $i++) { if ($i -gt 0) { $y += (LH $fr) }; Texto $ls[$i] $fr $m $y }
      $y += (Caps $fr) + (Px 4)
    }
    { $_ -eq 'faixa_total' -or $_ -eq 'total_grande' } {
      Espaco 'faixa_total'
      $h = Px 72
      Retangulo $preto $m $y ($uw + 1) $h
      $fr = Caber ([string]$b.rotulo) (Sans 26) ($uw * 0.48)
      $fv = Caber ([string]$b.valor) (Sans 42) ($uw - (Larg ([string]$b.rotulo) $fr) - (Px 44))
      Texto ([string]$b.rotulo) $fr ($m + (Px 16)) ($y + ($h - (Caps $fr)) / 2.0) $branco
      $vw = Larg ([string]$b.valor) $fv
      TextoDir ([string]$b.valor) $fv ($direita - (Px 16)) ($y + ($h - (Caps $fv)) / 2.0) $branco
      Write-Log ("TOTAL: valor='{0}' x={1}..{2} papel={3} fonte={4}" -f $b.valor, [int]($direita - (Px 16) - $vw), [int]($direita - (Px 16)), $dotW, $fv.Size)
      $y += $h
    }
    'regua' {
      Espaco 'regua'
      Fio $preto $y 1
      $y += (Px 1)
    }
    'dado' {
      Espaco 'dado'
      $y += (Px 4)
      $fr = Mono 18
      $fv = if ($b.negrito) { Mono 21 $true } else { Mono 20 }
      $col = $m + [Math]::Max((Larg 'Endereco:  ' $fr), (Larg ('{0}  ' -f $b.rotulo) $fr))
      Texto ([string]$b.rotulo) $fr $m ($y + ((Caps $fv) - (Caps $fr))) $cinzaTexto
      $ls = Quebrar ([string]$b.valor) $fv ($direita - $col)
      for ($i = 0; $i -lt $ls.Count; $i++) { if ($i -gt 0) { $y += (LH $fv 1.25) }; Texto $ls[$i] $fv $col $y }
      $y += (Caps $fv) + (Px 4)
    }
    'qr' {
      Espaco 'qr'
      $linhasQr = @($b.linhas)
      $n = $linhasQr.Count
      $mod = [Math]::Max(3, [int][Math]::Floor((Px 200) / $n))
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
      $y = $y0 + $lado
    }
    'rodape' {
      Espaco 'rodape'
      $f = Mono 18
      TextoCentro ([string]$b.s) $f ($dotW / 2.0) $y $cinzaTexto
      $y += (Caps $f)
    }
    'mesa' {
      Espaco 'mesa'
      $colR = $m + $uw * 0.5
      $ft = Caber ([string]$b.titulo) (Sans 38) ($colR - $m - (Px 12))
      $top = $y
      Texto ([string]$b.titulo) $ft $m $y
      $yEsq = $y + (Caps $ft)
      if ($b.sub) { $fs = Mono 22 $true; $yEsq += (Px 16); Texto ([string]$b.sub) $fs $m $yEsq $cinzaTexto; $yEsq += (Caps $fs) }
      $fr = Mono 19; $fv = Mono 22 $true
      $yDir = $y
      $primeiro = $true
      foreach ($par in @($b.pares)) {
        if (-not $primeiro) { $yDir += (LH $fv 1.5) }
        $primeiro = $false
        $rot = [string]$par[0]; $v = [string]$par[1]
        Texto $rot $fr $colR ($yDir + ((Caps $fv) - (Caps $fr))) $cinzaTexto
        $fv2 = Caber $v $fv ($direita - $colR - (Larg ('{0}  ' -f $rot) $fr))
        TextoDir $v $fv2 $direita $yDir
      }
      $yDir += (Caps $fv)
      $y = [Math]::Max($yEsq, $yDir)
    }
    'tabela_cab' {
      Espaco 'tabela_cab'
      $f = Mono 18 $true
      TextoCentro 'QTD' $f $colQtdCentro $y
      Texto 'DESCRICAO' $f $colDesc $y
      TextoDir 'UNIT.' $f $colUnitDir $y
      TextoDir 'TOTAL' $f $direita $y
      $y += (Caps $f)
    }
    'tabela_item' {
      Espaco 'tabela_item'
      $fq = Mono 23 $true; $fd = Mono 23; $fu = Mono 20; $ft = Mono 23 $true; $fs = Mono 18
      $ft = Caber ([string]$b.total) $ft ($direita - $colUnitDir - (Px 10))
      $fu = Caber ([string]$b.unit) $fu ($colUnitDir - $colDesc - (Px 60))
      TextoCentro ([string]$b.qtd) $fq $colQtdCentro $y
      $uwid = Larg ([string]$b.unit) $fu
      TextoDir ([string]$b.unit) $fu $colUnitDir ($y + ((Caps $fd) - (Caps $fu)))
      TextoDir ([string]$b.total) $ft $direita $y
      $lim = $colUnitDir - $uwid - (Px 12) - $colDesc
      $ls = Quebrar ([string]$b.desc) $fd $lim
      for ($i = 0; $i -lt $ls.Count; $i++) {
        if ($i -gt 0) { $y += (LH $fd 1.22) }
        if ((Larg $ls[$i] $fd) -gt $lim + 0.5) { $script:sobreposicoes++ }
        Texto $ls[$i] $fd $colDesc $y
      }
      $y += (Caps $fd)
      foreach ($sub in @($b.subs)) {
        if (-not $sub) { continue }
        foreach ($ln in (Quebrar ([string]$sub) $fs ($direita - $colDesc - (Px 10)))) { $y += (LH $fs 1.25) - (Caps $fs); Texto $ln $fs ($colDesc + (Px 8)) $y $cinzaTexto; $y += (Caps $fs) }
      }
    }
    'tracejado' {
      Espaco 'tracejado'
      $traco = [Math]::Max(4.0, (Px 10)); $vao = [Math]::Max(3.0, (Px 6)); $alt2 = [Math]::Max(1.0, (Px 2))
      for ($x = $m; $x + $traco -le $direita + 0.5; $x += $traco + $vao) { Retangulo $preto $x $y $traco $alt2 }
      $y += $alt2
    }
    'espaco' { $y += (Px 8) }
    'corte' { }
  }
}
# Margem de baixo e papel para o corte.
$y += (Px 40) + 24
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
  # So para teste automatizado: impressora virtual grava direto no arquivo, sem a janela.
  if ($env:MENUZIA_PRINT_TO_FILE) { $pd.PrinterSettings.PrintToFile = $true; $pd.PrinterSettings.PrintFileName = $env:MENUZIA_PRINT_TO_FILE }
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
    $dpiDisp = [double]$e.Graphics.DpiX
    if ([Math]::Abs($dpiDisp - $script:dpi) -le 12) {
      # Termica (203 dpi): ponto a ponto, nitido.
      $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Pixel
      $e.Graphics.DrawImage($script:imgImpr, $script:deslocX, 0, $script:imgImpr.Width, $script:imgImpr.Height)
    } else {
      # PDF, XPS, laser...: no tamanho fisico do papel (80/58 mm). Ponto a ponto, num
      # dispositivo de 600 dpi, a comanda saia com menos de 3 cm de largura.
      $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Display
      $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $k = 100.0 / $script:dpi
      $e.Graphics.DrawImage($script:imgImpr, [single]($script:deslocX * $k), [single]0, [single]($script:imgImpr.Width * $k), [single]($script:imgImpr.Height * $k))
    }
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
