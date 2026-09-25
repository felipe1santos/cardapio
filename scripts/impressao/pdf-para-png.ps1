# Abre um PDF com o leitor do proprio Windows (Windows.Data.Pdf, so leitura) e salva a
# pagina 1 como PNG na resolucao pedida. Usado para conferir o que a impressora virtual
# "Microsoft Print to PDF" gravou: numero de paginas, tamanho da pagina e conteudo.
# Saida: uma linha JSON { paginas, larguraPt, alturaPt, png }.
param([Parameter(Mandatory = $true)][string]$Pdf, [Parameter(Mandatory = $true)][string]$Png, [int]$Dpi = 600)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$metodos = [System.WindowsRuntimeSystemExtensions].GetMethods()
$asTaskOp = ($metodos | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskAc = ($metodos | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Esperar($op, [type]$tipo) { $t = $asTaskOp.MakeGenericMethod($tipo).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
function EsperarAcao($ac) { $t = $asTaskAc.Invoke($null, @($ac)); $t.Wait(-1) | Out-Null }
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
$arq = Esperar ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $Pdf).Path)) ([Windows.Storage.StorageFile])
$doc = Esperar ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($arq)) ([Windows.Data.Pdf.PdfDocument])
$pag = $doc.GetPage(0)
$w = [double]$pag.Size.Width; $h = [double]$pag.Size.Height   # em DIP (1/96 pol)
$opc = New-Object Windows.Data.Pdf.PdfPageRenderOptions
$opc.DestinationWidth = [uint32][Math]::Round($w / 96.0 * $Dpi)
$opc.DestinationHeight = [uint32][Math]::Round($h / 96.0 * $Dpi)
$mem = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
EsperarAcao ($pag.RenderToStreamAsync($mem, $opc))
$leitor = New-Object Windows.Storage.Streams.DataReader($mem.GetInputStreamAt(0))
Esperar ($leitor.LoadAsync([uint32]$mem.Size)) ([uint32]) | Out-Null
$bytes = New-Object byte[] ([int]$mem.Size)
$leitor.ReadBytes($bytes)
[IO.File]::WriteAllBytes($Png, $bytes)
@{ paginas = $doc.PageCount; larguraPt = [Math]::Round($w * 0.75, 1); alturaPt = [Math]::Round($h * 0.75, 1); larguraPx = $opc.DestinationWidth; alturaPx = $opc.DestinationHeight; png = $Png } | ConvertTo-Json -Compress
