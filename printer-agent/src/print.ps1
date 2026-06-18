param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [int]$Copies = 1
)

for ($i = 0; $i -lt $Copies; $i++) {
  Get-Content -Path $FilePath -Raw -Encoding UTF8 | Out-Printer -Name $PrinterName
}
