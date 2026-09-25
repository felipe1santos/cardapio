# Monitor SO DE LEITURA da fila do Windows de uma impressora: a cada 200 ms registra os
# trabalhos presentes (id, documento, estado, paginas, bytes). Uma linha JSON por mudanca em
# <Saida>. Serve de prova de que o trabalho entrou na fila, foi aceito pelo driver e saiu.
# Nao altera nada. Para sozinho no prazo ou quando existir o arquivo <Saida>.PARAR.
param([Parameter(Mandatory = $true)][string]$Saida, [string]$Impressora = 'Microsoft Print to PDF', [int]$Segundos = 3600)
$ultimo = ''
$fim = (Get-Date).AddSeconds($Segundos)
while ((Get-Date) -lt $fim -and -not (Test-Path "$Saida.PARAR")) {
  $jobs = @(Get-PrintJob -PrinterName $Impressora -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{ id = $_.Id; documento = $_.DocumentName; estado = [string]$_.JobStatus; paginas = $_.TotalPages; bytes = $_.Size; enviado = $_.SubmittedTime.ToString('o') } })
  $txt = ($jobs | ConvertTo-Json -Compress -Depth 3)
  if ($txt -ne $ultimo) {
    Add-Content -Path $Saida -Value (@{ em = (Get-Date).ToString('o'); trabalhos = $jobs } | ConvertTo-Json -Compress -Depth 4) -Encoding UTF8
    $ultimo = $txt
  }
  Start-Sleep -Milliseconds 200
}
