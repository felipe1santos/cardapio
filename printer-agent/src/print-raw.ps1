# ENVIO DIRETO pela FILA do Windows (Assistente Beta 0.2.0-beta.7; funcoes em
# impressao-funcoes.ps1).
#
# Manda os bytes ESC/POS prontos (escpos.js) para a fila da impressora com o tipo de
# dados RAW: o driver NAO desenha nada, entao nao decide largura nem preto e branco.
# Serve para impressora USB com driver instalado (POS-80, Xprinter, Elgin, Epson...).
# Se o driver recusar RAW (alguns drivers v4/XPS), o erro volta para o Assistente.
# O Assistente usa de preferencia o servidor-impressao.ps1 (ja aberto e compilado).
#
# Teste automatizado: MENUZIA_PRINT_TO_FILE=<arquivo> grava os bytes no arquivo em vez de
# abrir a fila (nada vai para impressora nenhuma). -Verificar: so compila e sai.
#
# Texto do script so em ASCII: o PowerShell 5.1 le .ps1 sem BOM como ANSI.
param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$Arquivo,
  [string]$Titulo = 'Menuzia',
  [string]$LogNome = 'menuzia-beta-print.log',
  [int]$Bloco = 0,
  [int]$PausaMs = 0,
  [switch]$Verificar
)

$ErrorActionPreference = 'Stop'
$script:LogNome = $LogNome
. (Join-Path $PSScriptRoot 'impressao-funcoes.ps1')

if ($Verificar) {
  Garantir-Raw
  Write-Log "RAW pronto: chamada ao spooler (winspool) compilada; nada enviado."
  return
}
Enviar-RawArquivo $PrinterName $Arquivo $Titulo $Bloco $PausaMs
