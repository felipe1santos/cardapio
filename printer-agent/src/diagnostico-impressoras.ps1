# Diagnostico das impressoras do Windows (Assistente Beta 0.2+). So LE o que o driver
# informa; nunca imprime nem muda configuracao. Uma linha JSON por impressora:
# nome, driver, porta, DPI, papel, area imprimivel, margens e pontos imprimiveis.
# Texto so em ASCII: o PowerShell 5.1 le .ps1 sem BOM como ANSI.
param([string]$Somente = '')

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing

function Mm([double]$centesimosPol) { return [Math]::Round($centesimosPol * 0.254, 1) }

$lista = @()
try { $lista = @(Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus) } catch {}
if ($lista.Count -eq 0) {
  foreach ($n in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) { $lista += [pscustomobject]@{ Name = $n; DriverName = ''; PortName = ''; PrinterStatus = '' } }
}

foreach ($p in $lista) {
  if ($Somente -and $p.Name -ne $Somente) { continue }
  $o = [ordered]@{ nome = [string]$p.Name; driver = [string]$p.DriverName; porta = [string]$p.PortName; status = [string]$p.PrinterStatus }
  try {
    $ps = New-Object System.Drawing.Printing.PrinterSettings
    $ps.PrinterName = $p.Name
    if ($ps.IsValid) {
      $pg = $ps.DefaultPageSettings
      $o.dpiX = [int]$pg.PrinterResolution.X
      $o.dpiY = [int]$pg.PrinterResolution.Y
      $o.papelNome = [string]$pg.PaperSize.PaperName
      $o.papelLarguraMm = Mm $pg.PaperSize.Width
      $o.papelAlturaMm = Mm $pg.PaperSize.Height
      $o.areaImprimivelLarguraMm = Mm $pg.PrintableArea.Width
      $o.margemEsquerdaMm = Mm $pg.HardMarginX
      $o.margemDireitaMm = [Math]::Round((Mm $pg.PaperSize.Width) - (Mm $pg.HardMarginX) - (Mm $pg.PrintableArea.Width), 1)
      if ($o.dpiX -gt 0) { $o.pontosImprimiveis = [int][Math]::Floor($pg.PrintableArea.Width / 100.0 * $o.dpiX) }
      $o.online = ($p.PrinterStatus -eq $null) -or ([string]$p.PrinterStatus -in @('', 'Normal', '0'))
    }
  } catch {}
  $o.coletadoEm = (Get-Date).ToUniversalTime().ToString('o')
  Write-Output ('MENUZIA-DIAG:' + ($o | ConvertTo-Json -Compress))
}
