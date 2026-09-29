# IMPRESSAO DE IMAGEM do ASSISTENTE BETA (2026-09-28).
#
# O Beta desenha a comanda e a pre-conta com o ticket-canvas.js (o mesmo desenho da
# pre-visualizacao do painel) e manda o PNG pronto para ca. Este script so imprime:
# termica (~203 dpi) ponto a ponto; PDF, XPS, laser no tamanho fisico do papel.
# Sem imagem (o desenho falhou), imprime o texto do documento - nunca deixa de sair.
#
# Texto do script so em ASCII: o PowerShell 5.1 le .ps1 sem BOM como ANSI.
param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [string]$ImagemPng = '',
  [string]$TextoArquivo = '',
  [int]$Copies = 1,
  [int]$DeslocamentoPontos = 0,
  [string]$Titulo = 'Menuzia',
  [string]$LogNome = 'menuzia-beta-print.log'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$LogFile = Join-Path $env:TEMP $LogNome
function Write-Log($msg) {
  try { Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -Encoding UTF8 } catch {}
  [Console]::Out.WriteLine("MENUZIA: " + $msg)
}
$dpi = 203.0
if ($DeslocamentoPontos -lt -64 -or $DeslocamentoPontos -gt 64) { $DeslocamentoPontos = 0 }

$existe = $false
try { if (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue) { $existe = $true } } catch {}
if (-not $existe) {
  try { foreach ($p in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) { if ($p -eq $PrinterName) { $existe = $true } } } catch {}
}
if (-not $existe) { throw "Impressora '$PrinterName' nao encontrada no Windows." }

function Imprimir-Bitmap([System.Drawing.Bitmap]$img, [bool]$usarCustom) {
  $pd = New-Object System.Drawing.Printing.PrintDocument
  $pd.PrinterSettings.PrinterName = $PrinterName
  $pd.PrinterSettings.Copies = [int]$Copies
  # So para teste automatizado: impressora virtual grava direto no arquivo, sem a janela.
  if ($env:MENUZIA_PRINT_TO_FILE) { $pd.PrinterSettings.PrintToFile = $true; $pd.PrinterSettings.PrintFileName = $env:MENUZIA_PRINT_TO_FILE }
  $pd.DocumentName = $Titulo
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
    # Driver mais estreito que a comanda (ex.: driver de 58 mm numa impressora de 80 mm):
    # quem manda na largura e o driver, e a direita sai cortada. Fica no log; a tela de
    # Calibrar impressora mostra o aviso e oferece o envio direto (ESC/POS).
    try {
      $pontosDriver = [int][Math]::Floor($e.PageSettings.PrintableArea.Width / 100.0 * $dpiDisp)
      if ($pontosDriver -gt 0 -and [Math]::Abs($dpiDisp - $script:dpi) -le 12 -and $pontosDriver + 16 -lt $script:imgImpr.Width) {
        Write-Log ("AVISO: o driver imprime so {0} pontos e a comanda tem {1}: a direita vai cortar. Confira o papel do driver (80 mm) ou use o envio direto." -f $pontosDriver, $script:imgImpr.Width)
      }
    } catch {}
    if ([Math]::Abs($dpiDisp - $script:dpi) -le 12) {
      # Termica (203 dpi): ponto a ponto, nitido.
      $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Pixel
      $e.Graphics.DrawImage($script:imgImpr, $script:deslocX, 0, $script:imgImpr.Width, $script:imgImpr.Height)
    } else {
      # PDF, XPS, laser...: no tamanho fisico do papel (80/58 mm). A imagem ja vem em
      # 1 bit: sem suavizar (suavizar devolveria o cinza que tiramos).
      $e.Graphics.PageUnit = [System.Drawing.GraphicsUnit]::Display
      $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
      $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
      $k = 100.0 / $script:dpi
      $e.Graphics.DrawImage($script:imgImpr, [single]($script:deslocX * $k), [single]0, [single]($script:imgImpr.Width * $k), [single]($script:imgImpr.Height * $k))
    }
    $e.HasMorePages = $false
  })
  try { $pd.Print() } finally { $pd.Dispose() }
}

if ($ImagemPng -and (Test-Path -LiteralPath $ImagemPng)) {
  $tmp = [System.Drawing.Image]::FromFile($ImagemPng)
  try { $bmp = New-Object System.Drawing.Bitmap($tmp) } finally { $tmp.Dispose() }
  $bmp.SetResolution($dpi, $dpi)
  Write-Log ("==== IMAGEM BETA: printer='{0}' {1}x{2} ====" -f $PrinterName, $bmp.Width, $bmp.Height)
  try {
    try {
      Imprimir-Bitmap $bmp $true
      Write-Log "GRAFICA OK (imagem, papel custom)."
    } catch {
      Write-Log ("Papel custom rejeitado ({0}); tentando papel padrao." -f $_.Exception.Message)
      Imprimir-Bitmap $bmp $false
      Write-Log "GRAFICA OK (imagem, papel padrao)."
    }
  } finally { $bmp.Dispose() }
  return
}

# Emergencia: sem imagem, o texto do documento.
Write-Log "SEM IMAGEM -> TEXTO"
$txt = if ($TextoArquivo -and (Test-Path -LiteralPath $TextoArquivo)) { Get-Content -Path $TextoArquivo -Raw -Encoding UTF8 } else { 'Menuzia' }
for ($i = 0; $i -lt $Copies; $i++) { ($txt + "`r`n`r`n") | Out-Printer -Name $PrinterName }
