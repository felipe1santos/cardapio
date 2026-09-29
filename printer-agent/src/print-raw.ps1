# ENVIO DIRETO pela FILA do Windows (Assistente Beta 0.2.0-beta.7).
#
# Manda os bytes ESC/POS prontos (escpos.js) para a fila da impressora com o tipo de
# dados RAW: o driver NAO desenha nada, entao nao decide largura nem preto e branco.
# Serve para impressora USB com driver instalado (POS-80, Xprinter, Elgin, Epson...).
# Se o driver recusar RAW (alguns drivers v4/XPS), o erro volta para o Assistente.
#
# Teste automatizado: MENUZIA_PRINT_TO_FILE=<arquivo> grava os bytes no arquivo em vez de
# abrir a fila (nada vai para impressora nenhuma).
#
# Texto do script so em ASCII: o PowerShell 5.1 le .ps1 sem BOM como ANSI.
param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$Arquivo,
  [string]$Titulo = 'Menuzia',
  [string]$LogNome = 'menuzia-beta-print.log',
  [switch]$Verificar
)

$ErrorActionPreference = 'Stop'
$LogFile = Join-Path $env:TEMP $LogNome
function Write-Log($msg) {
  try { Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -Encoding UTF8 } catch {}
  [Console]::Out.WriteLine("MENUZIA: " + $msg)
}

$dados = [System.IO.File]::ReadAllBytes($Arquivo)
if ($env:MENUZIA_PRINT_TO_FILE -and -not $Verificar) {
  [System.IO.File]::WriteAllBytes($env:MENUZIA_PRINT_TO_FILE, $dados)
  Write-Log ("RAW (arquivo de teste) {0} bytes -> {1}" -f $dados.Length, $env:MENUZIA_PRINT_TO_FILE)
  return
}

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
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
  public static int Enviar(string impressora, string titulo, byte[] dados) {
    IntPtr h;
    if (!OpenPrinter(impressora, out h, IntPtr.Zero)) throw Falha("OpenPrinter");
    try {
      DocInfo di = new DocInfo(); di.pDocName = titulo; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw Falha("StartDocPrinter (o driver aceita RAW?)");
      try {
        if (!StartPagePrinter(h)) throw Falha("StartPagePrinter");
        int total = 0;
        while (total < dados.Length) {
          int n = Math.Min(65536, dados.Length - total);
          byte[] parte = new byte[n];
          Array.Copy(dados, total, parte, 0, n);
          int escritos;
          if (!WritePrinter(h, parte, n, out escritos)) throw Falha("WritePrinter");
          if (escritos <= 0) throw new Exception("WritePrinter nao escreveu nada");
          total += escritos;
        }
        EndPagePrinter(h);
        return total;
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@

# -Verificar: so confere que a chamada ao spooler compila (teste/diagnostico), sem enviar.
if ($Verificar) { Write-Log "RAW pronto: chamada ao spooler (winspool) compilada; nada enviado."; return }

$n = [MenuziaRaw]::Enviar($PrinterName, $Titulo, $dados)
Write-Log ("RAW OK: printer='{0}' {1} bytes (ESC/POS direto, sem o driver desenhar)." -f $PrinterName, $n)
