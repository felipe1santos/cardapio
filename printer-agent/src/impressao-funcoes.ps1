# FUNCOES DE IMPRESSAO do ASSISTENTE BETA (0.2.0-beta.7).
#
# Carregadas por print-imagem.ps1 e print-raw.ps1 (um PowerShell por impressao, como
# sempre) e pelo servidor-impressao.ps1 (UM PowerShell aberto, que ja deixa o
# System.Drawing carregado e o envio RAW compilado: poupa ~0,6 s por impressao).
#
#   Imprimir-ImagemArquivo : PNG (ja em 1 bit) pelo driver do Windows (GDI).
#   Imprimir-TextoArquivo  : emergencia, sem imagem.
#   Enviar-RawArquivo      : bytes ESC/POS pela fila do Windows, tipo RAW.
#
# Teste automatizado: MENUZIA_PRINT_TO_FILE=<arquivo> (imagem: impressora virtual grava
# no arquivo; RAW: os bytes vao para o arquivo, nada vai para a fila).
# Texto so em ASCII: o PowerShell 5.1 le .ps1 sem BOM como ANSI.

Add-Type -AssemblyName System.Drawing
$script:dpi = 203.0
if (-not $script:LogNome) { $script:LogNome = 'menuzia-beta-print.log' }
$script:bufferLog = $null

function Write-Log($msg) {
  try { Add-Content -Path (Join-Path $env:TEMP $script:LogNome) -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -Encoding UTF8 } catch {}
  if ($null -ne $script:bufferLog) { [void]$script:bufferLog.Add("MENUZIA: " + $msg) }
  else { [Console]::Out.WriteLine("MENUZIA: " + $msg) }
}

# Lista do .NET (~3 ms). O Get-Printer (CIM) custava ~350 ms a cada impressao.
function Testar-Impressora([string]$nome) {
  foreach ($p in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) { if ($p -eq $nome) { return } }
  throw "Impressora '$nome' nao encontrada no Windows."
}

function Imprimir-Bitmap([System.Drawing.Bitmap]$img, [bool]$usarCustom, [string]$PrinterName, [int]$Copies, [int]$Desloc, [string]$Titulo) {
  $pd = New-Object System.Drawing.Printing.PrintDocument
  $pd.PrinterSettings.PrinterName = $PrinterName
  $pd.PrinterSettings.Copies = [int]$Copies
  # So para teste automatizado: impressora virtual grava direto no arquivo, sem a janela.
  if ($env:MENUZIA_PRINT_TO_FILE) { $pd.PrinterSettings.PrintToFile = $true; $pd.PrinterSettings.PrintFileName = $env:MENUZIA_PRINT_TO_FILE }
  $pd.DocumentName = $Titulo
  if ($usarCustom) {
    $wIn = [int]([Math]::Round($img.Width / $script:dpi * 100))
    $hIn = [int]([Math]::Round($img.Height / $script:dpi * 100))
    $pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('ReciboMenuzia', $wIn, $hIn)
  }
  try { $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0); $pd.OriginAtMargins = $false } catch {}
  $script:imgImpr = $img
  $script:deslocX = $Desloc
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

function Imprimir-ImagemArquivo([string]$PrinterName, [string]$ImagemPng, [int]$Copies = 1, [int]$Desloc = 0, [string]$Titulo = 'Menuzia') {
  Testar-Impressora $PrinterName
  if ($Desloc -lt -64 -or $Desloc -gt 64) { $Desloc = 0 }
  $tmp = [System.Drawing.Image]::FromFile($ImagemPng)
  try { $bmp = New-Object System.Drawing.Bitmap($tmp) } finally { $tmp.Dispose() }
  $bmp.SetResolution($script:dpi, $script:dpi)
  Write-Log ("==== IMAGEM BETA: printer='{0}' {1}x{2} ====" -f $PrinterName, $bmp.Width, $bmp.Height)
  try {
    try {
      Imprimir-Bitmap $bmp $true $PrinterName $Copies $Desloc $Titulo
      Write-Log "GRAFICA OK (imagem, papel custom)."
    } catch {
      Write-Log ("Papel custom rejeitado ({0}); tentando papel padrao." -f $_.Exception.Message)
      Imprimir-Bitmap $bmp $false $PrinterName $Copies $Desloc $Titulo
      Write-Log "GRAFICA OK (imagem, papel padrao)."
    }
  } finally { $bmp.Dispose() }
}

function Imprimir-TextoArquivo([string]$PrinterName, [string]$TextoArquivo, [int]$Copies = 1) {
  Testar-Impressora $PrinterName
  Write-Log "SEM IMAGEM -> TEXTO"
  $txt = if ($TextoArquivo -and (Test-Path -LiteralPath $TextoArquivo)) { Get-Content -Path $TextoArquivo -Raw -Encoding UTF8 } else { 'Menuzia' }
  for ($i = 0; $i -lt $Copies; $i++) { ($txt + "`r`n`r`n") | Out-Printer -Name $PrinterName }
}

# Envio RAW (winspool). Compila uma vez por PowerShell (~0,4 s); o servidor ja deixa pronto.
function Garantir-Raw {
  if ('MenuziaRaw' -as [type]) { return }
  Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
public static class MenuziaRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string nome, out IntPtr h, IntPtr padrao);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern int StartDocPrinter(IntPtr h, int nivel, [In] DocInfo di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int escritos);
  static Exception Falha(string etapa) { return new Win32Exception(Marshal.GetLastWin32Error(), etapa); }
  // bloco/pausaMs: envio em partes com pausa entre elas (padrao: tudo de uma vez, sem pausa).
  public static int Enviar(string impressora, string titulo, byte[] dados, int bloco, int pausaMs) {
    IntPtr h;
    if (!OpenPrinter(impressora, out h, IntPtr.Zero)) throw Falha("OpenPrinter");
    try {
      DocInfo di = new DocInfo(); di.pDocName = titulo; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw Falha("StartDocPrinter (o driver aceita RAW?)");
      try {
        if (!StartPagePrinter(h)) throw Falha("StartPagePrinter");
        int total = 0;
        int parte = bloco > 0 ? bloco : 65536;
        while (total < dados.Length) {
          int n = Math.Min(parte, dados.Length - total);
          byte[] pedaco = new byte[n];
          Array.Copy(dados, total, pedaco, 0, n);
          int escritos;
          if (!WritePrinter(h, pedaco, n, out escritos)) throw Falha("WritePrinter");
          if (escritos <= 0) throw new Exception("WritePrinter nao escreveu nada");
          total += escritos;
          if (pausaMs > 0 && total < dados.Length) Thread.Sleep(pausaMs);
        }
        EndPagePrinter(h);
        return total;
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
}

function Enviar-RawArquivo([string]$PrinterName, [string]$Arquivo, [string]$Titulo = 'Menuzia', [int]$Bloco = 0, [int]$PausaMs = 0) {
  $dados = [System.IO.File]::ReadAllBytes($Arquivo)
  if ($env:MENUZIA_PRINT_TO_FILE) {
    [System.IO.File]::WriteAllBytes($env:MENUZIA_PRINT_TO_FILE, $dados)
    Write-Log ("RAW (arquivo de teste) {0} bytes -> {1}" -f $dados.Length, $env:MENUZIA_PRINT_TO_FILE)
    return
  }
  Garantir-Raw
  $n = [MenuziaRaw]::Enviar($PrinterName, $Titulo, $dados, $Bloco, $PausaMs)
  Write-Log ("RAW OK: printer='{0}' {1} bytes (ESC/POS direto, sem o driver desenhar)." -f $PrinterName, $n)
}
