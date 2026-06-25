param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [int]$Copies = 1
)

$ErrorActionPreference = 'Stop'

# Garante que a impressora ainda existe no Windows antes de mandar imprimir.
# Sem isso, um nome errado/removido faria o spooler "aceitar" sem imprimir nada
# e o pedido seria marcado como impresso (perdido). Falhar aqui faz o agente
# tentar de novo no próximo ciclo em vez de dar o pedido como impresso.
$existe = $false
try { if (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue) { $existe = $true } } catch {}
if (-not $existe) {
  try {
    Add-Type -AssemblyName System.Drawing
    foreach ($p in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) { if ($p -eq $PrinterName) { $existe = $true } }
  } catch {}
}
if (-not $existe) { throw "Impressora '$PrinterName' nao encontrada no Windows." }

for ($i = 0; $i -lt $Copies; $i++) {
  Get-Content -Path $FilePath -Raw -Encoding UTF8 | Out-Printer -Name $PrinterName
}
