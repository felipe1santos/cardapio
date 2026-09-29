# SERVIDOR DE IMPRESSAO do ASSISTENTE BETA (0.2.0-beta.7).
#
# UM PowerShell que fica aberto: carrega o System.Drawing e compila o envio RAW uma vez so
# e recebe os pedidos pela entrada padrao, uma linha JSON por pedido:
#   {"id":"1","acao":"imagem","impressora":"POS-80","arquivo":"C:\\...\\x.png","copias":1,"desloc":0,"titulo":"Menuzia - Comanda"}
#   {"id":"2","acao":"raw","impressora":"POS-80","arquivo":"C:\\...\\x.bin","titulo":"...","bloco":0,"pausaMs":0}
#   {"id":"3","acao":"texto","impressora":"POS-80","arquivo":"C:\\...\\x.txt","copias":1}
#   {"id":"4","acao":"ping"}
# Responde uma linha:  MENUZIA-RESP:{"id":"1","ok":true,"ms":123,"log":["MENUZIA: ..."]}
# Poupa o PowerShell novo (~0,2 s) e o Get-Printer (~0,35 s) a cada impressao. O
# Assistente fecha este processo quando fica muito tempo sem imprimir (memoria).
#
# Texto do script so em ASCII: o PowerShell 5.1 le .ps1 sem BOM como ANSI.
param([string]$LogNome = 'menuzia-beta-print.log')

$ErrorActionPreference = 'Stop'
$script:LogNome = $LogNome
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'impressao-funcoes.ps1')
Garantir-Raw
[Console]::Out.WriteLine('MENUZIA-PRONTO')
[Console]::Out.Flush()

while ($true) {
  $linha = [Console]::In.ReadLine()
  if ($null -eq $linha) { break }
  if (-not $linha.Trim()) { continue }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $script:bufferLog = New-Object System.Collections.ArrayList
  $id = $null
  try {
    $p = $linha | ConvertFrom-Json
    $id = $p.id
    $copias = if ($p.copias) { [int]$p.copias } else { 1 }
    switch ([string]$p.acao) {
      'imagem' { Imprimir-ImagemArquivo ([string]$p.impressora) ([string]$p.arquivo) $copias ([int]$p.desloc) ([string]$p.titulo) }
      'texto' { Imprimir-TextoArquivo ([string]$p.impressora) ([string]$p.arquivo) $copias }
      'raw' { Enviar-RawArquivo ([string]$p.impressora) ([string]$p.arquivo) ([string]$p.titulo) ([int]$p.bloco) ([int]$p.pausaMs) }
      'ping' { }
      default { throw "acao desconhecida: $($p.acao)" }
    }
    $resp = @{ id = $id; ok = $true; ms = $sw.ElapsedMilliseconds; log = @($script:bufferLog) }
  } catch {
    $resp = @{ id = $id; ok = $false; erro = $_.Exception.Message; ms = $sw.ElapsedMilliseconds; log = @($script:bufferLog) }
  }
  $script:bufferLog = $null
  [Console]::Out.WriteLine('MENUZIA-RESP:' + ($resp | ConvertTo-Json -Compress -Depth 3))
  [Console]::Out.Flush()
}
