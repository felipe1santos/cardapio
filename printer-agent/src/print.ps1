param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [int]$Copies = 1,
  [int]$Cols = 0,
  [string]$LogoPath = '',
  [int]$PaperWidthMm = 80,
  [int]$FonteMaior = 0,
  [string]$DebugPng = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$SOH = [char]1  # inicio de linha marcada
$STX = [char]2  # separador de campo

# --- Diagnostico: grava em %TEMP%\menuzia-print.log E emite pro stdout (MENUZIA:) pra
# o agente mostrar na janela. ---
$LogFile = Join-Path $env:TEMP 'menuzia-print.log'
function Write-Log($msg) {
  try { Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -Encoding UTF8 } catch {}
  Write-Output ("MENUZIA: " + $msg)
}

# Bitmap de largura FIXA em dots (independe do que o driver reporta): 576 p/ 80mm,
# 384 p/ 58mm @203dpi. Renderizar tudo numa imagem e imprimir a imagem 1:1 (PageUnit
# Pixel) e o jeito que POS profissional garante fonte grande + logo + barras pretas
# em qualquer driver termico.
$dpi = 203.0
$dotW = if ($PaperWidthMm -le 58) { 384 } else { 576 }
Write-Log "==== IMPRIMIR: printer='$PrinterName' cols=$Cols paperMm=$PaperWidthMm dotW=$dotW logo='$LogoPath' ===="

# Impressora ainda existe?
$existe = $false
try { if (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue) { $existe = $true } } catch {}
if (-not $existe) {
  try { foreach ($p in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) { if ($p -eq $PrinterName) { $existe = $true } } } catch {}
}
if (-not $existe) { throw "Impressora '$PrinterName' nao encontrada no Windows." }

# ── Le e parseia as linhas marcadas ─────────────────────────────────────────
$texto = Get-Content -Path $FilePath -Raw -Encoding UTF8
$linhas = $texto -replace "`r", '' -split "`n"
$ops = @()
foreach ($ln in $linhas) {
  if ($ln.Length -gt 0 -and $ln[0] -eq $SOH) {
    $parts = $ln.Substring(1).Split($STX)
    # Atribuição direta (NÃO via if-expressão): o if-como-expressão do PowerShell
    # desembrulha um array de 1 elemento pra escalar, e aí F[0] viraria o 1º caractere.
    $campos = @()
    if ($parts.Count -gt 1) { $campos = @($parts[1..($parts.Count - 1)]) }
    $ops += , @{ Type = $parts[0]; F = $campos }
  } elseif ($ln.Trim().Length -gt 0) {
    $ops += , @{ Type = 'PLAIN'; F = @($ln) }
  }
}

# Comprimento "visivel" (ignora marcadores) pra dimensionar a fonte base.
function VisLen($op) {
  switch ($op.Type) {
    'I' { return ($op.F[0].Length + 2 + $op.F[1].Length) }
    'P' { return ($op.F[0].Length + 2 + $op.F[1].Length) }
    'T' { return ($op.F[0].Length + 2 + $op.F[1].Length) }
    'H' { return ($op.F[0].Length + 4) }
    'S' { return ($op.F[0].Length + 2) }
    'R' { return 1 }
    default { if ($op.F.Count) { return $op.F[0].Length } else { return 0 } }
  }
}

# ── Fonte base: dimensiona pra `alvo` colunas preencherem a largura em DOTS ──
$margem = [int]($dotW * 0.03)          # respiro lateral (~3%)
$usable = $dotW - 2 * $margem
$maxVis = 1
foreach ($op in $ops) { $v = VisLen $op; if ($v -gt $maxVis) { $maxVis = $v } }
$alvo = [Math]::Max($Cols, $maxVis)
if ($alvo -lt 1) { $alvo = 1 }

$measBmp = New-Object System.Drawing.Bitmap(4, 4)
$measBmp.SetResolution($dpi, $dpi)
$mg = [System.Drawing.Graphics]::FromImage($measBmp)
$mg.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit

$sample = ('M' * $alvo)
$base = 10.0
for ($px = 52.0; $px -ge 9.0; $px -= 1.0) {
  $f = New-Object System.Drawing.Font('Consolas', $px, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $w = $mg.MeasureString($sample, $f).Width
  $f.Dispose()
  if ($w -le $usable) { $base = $px; break }
}

function NovaFonte([double]$mult, [bool]$bold) {
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  return New-Object System.Drawing.Font('Consolas', [double]($base * $mult), $style, [System.Drawing.GraphicsUnit]::Pixel)
}
$fStore = NovaFonte 1.6  $true
$fSecao = NovaFonte 1.0  $true
$fTipo  = NovaFonte 1.1  $true
# "Fonte maior na via de producao": aumenta itens e complementos (o que a cozinha le).
$multItem = if ($FonteMaior -eq 1) { 1.55 } else { 1.2 }
$multSub  = if ($FonteMaior -eq 1) { 1.15 } else { 0.85 }
$fItem  = NovaFonte $multItem $true
$fSub   = NovaFonte $multSub ($FonteMaior -eq 1)
$fData  = NovaFonte 1.0  $false
$fTotal = NovaFonte 1.8  $true
$fFoot  = NovaFonte 0.7  $false
$H = [double]$fData.GetHeight($mg)

# Quebra `txt` em linhas que cabem em `maxW` px na fonte `font` (corta palavra gigante).
function Quebrar($g, $txt, $font, $maxW) {
  $words = ($txt -split '\s+') | Where-Object { $_ -ne '' }
  $lines = @(); $cur = ''
  foreach ($w0 in $words) {
    $w = $w0
    $try = if ($cur) { "$cur $w" } else { $w }
    if ($g.MeasureString($try, $font).Width -le $maxW) { $cur = $try; continue }
    if ($cur) { $lines += $cur; $cur = '' }
    while ($g.MeasureString($w, $font).Width -gt $maxW -and $w.Length -gt 1) {
      $n = $w.Length
      while ($n -gt 1 -and $g.MeasureString($w.Substring(0, $n), $font).Width -gt $maxW) { $n-- }
      $lines += $w.Substring(0, $n); $w = $w.Substring($n)
    }
    $cur = $w
  }
  if ($cur) { $lines += $cur }
  if ($lines.Count -eq 0) { $lines = @('') }
  return , $lines
}

# ── Logo (imagem) opcional no topo ──────────────────────────────────────────
$logoImg = $null; $logoW = 0.0; $logoH = 0.0
if ($LogoPath -and (Test-Path $LogoPath)) {
  try {
    $logoImg = [System.Drawing.Image]::FromFile($LogoPath)
    $logoW = [Math]::Min($dotW * 0.55, [double]$logoImg.Width)
    $logoH = $logoW * ([double]$logoImg.Height / [double]$logoImg.Width)
    $maxLogoH = $dotW * 0.6
    if ($logoH -gt $maxLogoH) { $logoW = $logoW * ($maxLogoH / $logoH); $logoH = $maxLogoH }
  } catch { $logoImg = $null; $logoW = 0.0; $logoH = 0.0 }
}

# ── Desenha tudo numa bitmap grande e depois recorta na altura exata ─────────
$sfC = New-Object System.Drawing.StringFormat
$sfC.Alignment = [System.Drawing.StringAlignment]::Center
$estMult = if ($FonteMaior -eq 1) { 3.2 } else { 2.4 }  # fonte maior quebra mais linhas
$estH = [int]($H * 2 + $logoH + ($ops.Count + 4) * ($base * $estMult) + 80)
$canvas = New-Object System.Drawing.Bitmap($dotW, $estH)
$canvas.SetResolution($dpi, $dpi)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$black = [System.Drawing.Brushes]::Black
$white = [System.Drawing.Brushes]::White
$penFina = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, [single]([Math]::Max(1.0, $base * 0.08)))

$y = [double]($H * 0.4)
$rightX = $dotW - $margem
if ($logoImg) {
  $g.DrawImage($logoImg, [single](($dotW - $logoW) / 2.0), [single]$y, [single]$logoW, [single]$logoH)
  $y += $logoH + $H * 0.4
}

foreach ($op in $ops) {
  switch ($op.Type) {
    'N' {
      foreach ($ln in (Quebrar $g $op.F[0] $fStore $usable)) {
        $g.DrawString($ln, $fStore, $black, (New-Object System.Drawing.RectangleF(0, [single]$y, $dotW, [single]$fStore.GetHeight($mg))), $sfC)
        $y += $fStore.GetHeight($mg)
      }
      $y += $H * 0.2
    }
    'H' {
      $y += $H * 0.3
      $barH = [double]$fSecao.GetHeight($mg) + $H * 0.5
      $g.FillRectangle($black, 0, [single]$y, $dotW, [single]$barH)
      $g.DrawString($op.F[0], $fSecao, $white, (New-Object System.Drawing.RectangleF(0, [single]($y + $H * 0.25), $dotW, [single]$fSecao.GetHeight($mg))), $sfC)
      $y += $barH + $H * 0.25
    }
    'C' {
      $g.DrawString($op.F[0], $fTipo, $black, (New-Object System.Drawing.RectangleF(0, [single]$y, $dotW, [single]$fTipo.GetHeight($mg))), $sfC)
      $y += $fTipo.GetHeight($mg) + $H * 0.15
    }
    'I' {
      $preco = $op.F[1]
      $precoW = $g.MeasureString($preco, $fItem).Width
      $g.DrawString($preco, $fItem, $black, [single]($rightX - $precoW), [single]$y)
      $nameMax = $usable - $precoW - ($base * 0.5)
      $lns = Quebrar $g $op.F[0] $fItem $nameMax
      foreach ($ln in $lns) {
        $g.DrawString($ln, $fItem, $black, [single]$margem, [single]$y)
        $y += $fItem.GetHeight($mg)
      }
      $y += $H * 0.1
    }
    'S' {
      $indent = $margem + [int]($base * 1.2)
      foreach ($ln in (Quebrar $g $op.F[0] $fSub ($usable - ($indent - $margem)))) {
        $g.DrawString($ln, $fSub, $black, [single]$indent, [single]$y)
        $y += $fSub.GetHeight($mg)
      }
    }
    'P' {
      $g.DrawString($op.F[0], $fData, $black, [single]$margem, [single]$y)
      $vW = $g.MeasureString($op.F[1], $fData).Width
      $g.DrawString($op.F[1], $fData, $black, [single]($rightX - $vW), [single]$y)
      $y += $fData.GetHeight($mg)
    }
    'T' {
      $y += $H * 0.15
      $g.DrawLine($penFina, [single]$margem, [single]$y, [single]$rightX, [single]$y)
      $y += $H * 0.15
      $g.DrawString($op.F[0], $fTotal, $black, [single]$margem, [single]$y)
      $vW = $g.MeasureString($op.F[1], $fTotal).Width
      $g.DrawString($op.F[1], $fTotal, $black, [single]($rightX - $vW), [single]$y)
      $y += $fTotal.GetHeight($mg) + $H * 0.2
    }
    'L' {
      foreach ($ln in (Quebrar $g $op.F[0] $fData $usable)) {
        $g.DrawString($ln, $fData, $black, [single]$margem, [single]$y)
        $y += $fData.GetHeight($mg)
      }
    }
    'R' {
      $penDot = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, [single]([Math]::Max(1.0, $base * 0.07)))
      $penDot.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dot
      $midY = $y + $H * 0.35
      $g.DrawLine($penDot, [single]$margem, [single]$midY, [single]$rightX, [single]$midY)
      $penDot.Dispose()
      $y += $H * 0.7
    }
    'F' {
      $y += $H * 0.6
      $g.DrawString($op.F[0], $fFoot, $black, (New-Object System.Drawing.RectangleF(0, [single]$y, $dotW, [single]$fFoot.GetHeight($mg))), $sfC)
      $y += $fFoot.GetHeight($mg)
    }
    default {
      foreach ($ln in (Quebrar $g $op.F[0] $fData $usable)) {
        $g.DrawString($ln, $fData, $black, [single]$margem, [single]$y)
        $y += $fData.GetHeight($mg)
      }
    }
  }
}

$finalH = [int]([Math]::Ceiling($y + $H * 0.8))
if ($finalH -gt $estH) { $finalH = $estH }
$bmp = New-Object System.Drawing.Bitmap($dotW, $finalH)
$bmp.SetResolution($dpi, $dpi)
$g2 = [System.Drawing.Graphics]::FromImage($bmp)
$g2.DrawImage($canvas, 0, 0)
$g2.Dispose(); $g.Dispose(); $canvas.Dispose()
Write-Log ("BITMAP montado: dotW=$dotW finalH=$finalH baseFont=$base alvo=$alvo logo=" + ($null -ne $logoImg))

# Modo debug (dev): salva a bitmap como PNG e sai, sem imprimir. Producao passa vazio.
if ($DebugPng) {
  $bmp.Save($DebugPng, [System.Drawing.Imaging.ImageFormat]::Png)
  if ($logoImg) { $logoImg.Dispose() }
  $bmp.Dispose(); $mg.Dispose(); $measBmp.Dispose()
  Write-Log "DEBUG PNG salvo: $DebugPng"
  return
}

# ── Imprime a bitmap 1:1 (PageUnit Pixel) — 2 camadas: papel custom -> padrao ──
function Imprimir-Bitmap([System.Drawing.Bitmap]$img, [bool]$usarCustom) {
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $PrinterName
  $doc.PrinterSettings.Copies = [int]$Copies
  $doc.DocumentName = 'Menuzia Recibo'
  if ($usarCustom) {
    $wIn = [int]([Math]::Round($img.Width / $dpi * 100))
    $hIn = [int]([Math]::Round($img.Height / $dpi * 100))
    $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('ReciboMenuzia', $wIn, $hIn)
  }
  try { $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0); $doc.OriginAtMargins = $false } catch {}
  $script:imgImpr = $img
  $handler = {
    param($s, $e)
    $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Pixel
    $e.Graphics.DrawImage($script:imgImpr, 0, 0, $script:imgImpr.Width, $script:imgImpr.Height)
    $e.HasMorePages = $false
  }
  $doc.add_PrintPage($handler)
  try { $doc.Print() } finally { $doc.Dispose() }
}

# ── Fallback texto puro (se o GDI falhar de vez): limpa os marcadores ─────────
function Plano($op, $cols) {
  function Centro($c, $t) { $t = $t.Substring(0, [Math]::Min($t.Length, $c)); $p = [Math]::Max(0, [int](($c - $t.Length) / 2)); return (' ' * $p) + $t }
  function Colunas($c, $e, $d) { $s = [Math]::Max(1, $c - $e.Length - $d.Length); return $e + (' ' * $s) + $d }
  switch ($op.Type) {
    'N' { return Centro $cols $op.F[0] }
    'H' { return Centro $cols (" $($op.F[0]) ").PadLeft([int]((($cols) + $op.F[0].Length) / 2) + 1, '=').PadRight($cols, '=') }
    'C' { return Centro $cols $op.F[0] }
    'I' { return Colunas $cols $op.F[0] $op.F[1] }
    'S' { return "  $($op.F[0])" }
    'P' { return Colunas $cols $op.F[0] $op.F[1] }
    'T' { return Colunas $cols $op.F[0] $op.F[1] }
    'R' { return ('-' * $cols) }
    'F' { return Centro $cols $op.F[0] }
    default { if ($op.F.Count) { return $op.F[0] } else { return '' } }
  }
}
function Invoke-Fallback-Texto {
  Write-Log "FALLBACK: texto puro (Out-Printer)."
  $c = if ($Cols -gt 0) { $Cols } else { 42 }
  $linhasTxt = @(); foreach ($op in $ops) { $linhasTxt += (Plano $op $c) }
  $conteudo = ($linhasTxt -join "`r`n") + "`r`n`r`n"
  for ($i = 0; $i -lt $Copies; $i++) { $conteudo | Out-Printer -Name $PrinterName }
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
  Write-Log ("ERRO GRAFICA -> FALLBACK TEXTO: {0}" -f $_.Exception.Message)
  Write-Log ("STACK: {0}" -f ($_.ScriptStackTrace))
  Invoke-Fallback-Texto
} finally {
  if ($logoImg) { $logoImg.Dispose() }
  $bmp.Dispose(); $mg.Dispose(); $measBmp.Dispose()
}
