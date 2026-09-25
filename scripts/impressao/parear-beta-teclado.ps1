# Pareia o Assistente Beta ABERTO digitando na janela dele pelo teclado (como uma pessoa):
# traz a janela do processo indicado para frente, Tab ate o campo do codigo, digita o
# codigo, Tab, o nome do computador, Tab e Enter no botao "Parear com codigo".
# So age se a janela em primeiro plano for a do Beta; nao le nem grava credencial.
param([Parameter(Mandatory = $true)][string]$Codigo, [string]$Nome = 'PC Teste Beta', [string]$Processo = 'Assistente Menuzia Beta TESTE LOCAL')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Janela {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
'@
$proc = Get-Process -Name $Processo | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw "Janela do '$Processo' nao encontrada." }
[Janela]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
# O Windows so entrega o foco a quem acabou de receber teclado: Alt pressionado e solto.
[Janela]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [Janela]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
(New-Object -ComObject WScript.Shell).AppActivate($proc.Id) | Out-Null
[Janela]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800
function NaFrente() { $p = 0; [Janela]::GetWindowThreadProcessId([Janela]::GetForegroundWindow(), [ref]$p) | Out-Null; return $p -eq [uint32]$proc.Id }
if (-not (NaFrente)) { throw 'A janela do Beta nao ficou em primeiro plano; nada foi digitado.' }
function Tecla([string]$k) { if (-not (NaFrente)) { throw 'Outra janela ficou na frente; parei de digitar.' }; [System.Windows.Forms.SendKeys]::SendWait($k); Start-Sleep -Milliseconds 250 }
# Recarrega a pagina para o foco comecar do topo (F5 no Electron recarrega a janela).
Tecla '{F5}'; Start-Sleep -Seconds 2
Tecla '{TAB}'
Tecla ($Codigo -replace '([+^%~(){}\[\]])', '{$1}')
Tecla '{TAB}'
Tecla '^a'
Tecla ($Nome -replace '([+^%~(){}\[\]])', '{$1}')
Tecla '{TAB}'
Tecla '{ENTER}'
@{ ok = $true; digitado = 'codigo + nome + Enter'; processo = $proc.Id } | ConvertTo-Json -Compress
