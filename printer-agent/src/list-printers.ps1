# Lista os nomes das impressoras instaladas no Windows.
# Tenta o cmdlet moderno (Get-Printer); se indisponível/falhar, usa o .NET
# (InstalledPrinters), que enxerga as mesmas impressoras de "Impressoras e scanners".
$ErrorActionPreference = 'SilentlyContinue'

$nomes = @()
try { $nomes += Get-Printer | Select-Object -ExpandProperty Name } catch {}

if (-not $nomes -or $nomes.Count -eq 0) {
  try {
    Add-Type -AssemblyName System.Drawing
    $nomes += [System.Drawing.Printing.PrinterSettings]::InstalledPrinters
  } catch {}
}

$nomes | Where-Object { $_ -and $_.Trim() -ne '' } | Select-Object -Unique
