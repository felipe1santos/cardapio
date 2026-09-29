# IMPRESSAO DE IMAGEM do ASSISTENTE BETA (2026-09-28; funcoes em impressao-funcoes.ps1).
#
# O Beta desenha a comanda e a pre-conta com o ticket-canvas.js (o mesmo desenho da
# pre-visualizacao do painel) e manda o PNG pronto para ca. Este script so imprime:
# termica (~203 dpi) ponto a ponto; PDF, XPS, laser no tamanho fisico do papel.
# Sem imagem (o desenho falhou), imprime o texto do documento - nunca deixa de sair.
# O Assistente 0.2.0-beta.7 usa de preferencia o servidor-impressao.ps1 (ja aberto);
# este script e o caminho de reserva (um PowerShell por impressao).
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
$script:LogNome = $LogNome
. (Join-Path $PSScriptRoot 'impressao-funcoes.ps1')

if ($ImagemPng -and (Test-Path -LiteralPath $ImagemPng)) {
  Imprimir-ImagemArquivo $PrinterName $ImagemPng $Copies $DeslocamentoPontos $Titulo
  return
}
# Emergencia: sem imagem, o texto do documento.
Imprimir-TextoArquivo $PrinterName $TextoArquivo $Copies
