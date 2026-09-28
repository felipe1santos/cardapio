# Comparacao visual: referencia (docs/referencias/impressao) x saida do Beta.
# Gera o PNG lado a lado (referencia | saida, mesma escala) e lista as faixas de tinta
# (linhas com texto/desenho) de cada imagem: y inicial, altura e extensao em x.
#   powershell -File comparar-modelo.ps1 -Referencia ref.png -Saida beta.png -LadoALado lado.png [-Faixas]
param(
  [Parameter(Mandatory = $true)][string]$Referencia,
  [Parameter(Mandatory = $true)][string]$Saida,
  [Parameter(Mandatory = $true)][string]$LadoALado,
  [switch]$Faixas
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Carregar([string]$p) {
  $tmp = [System.Drawing.Image]::FromFile((Resolve-Path $p))
  try { return New-Object System.Drawing.Bitmap($tmp) } finally { $tmp.Dispose() }
}

function FaixasDe([System.Drawing.Bitmap]$bmp) {
  $w = $bmp.Width; $h = $bmp.Height
  $bd = $bmp.LockBits((New-Object System.Drawing.Rectangle(0, 0, $w, $h)), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($bd.Stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)
  $stride = $bd.Stride
  $bmp.UnlockBits($bd)
  $out = New-Object System.Collections.Generic.List[string]
  $ini = -1; $x0 = $w; $x1 = -1
  for ($y = 0; $y -le $h; $y++) {
    $tem = $false
    if ($y -lt $h) {
      $o = $y * $stride
      for ($x = 0; $x -lt $w; $x++) {
        $i = $o + $x * 4
        $lum = 0.114 * $bytes[$i] + 0.587 * $bytes[$i + 1] + 0.299 * $bytes[$i + 2]
        if ($lum -lt 160) { $tem = $true; if ($x -lt $x0) { $x0 = $x }; if ($x -gt $x1) { $x1 = $x } }
      }
    }
    if ($tem -and $ini -lt 0) { $ini = $y }
    if (-not $tem -and $ini -ge 0) {
      $out.Add(('{0,5} h={1,3} x={2,3}..{3,3}' -f $ini, ($y - $ini), $x0, $x1))
      $ini = -1; $x0 = $w; $x1 = -1
    }
  }
  return $out
}

$a = Carregar $Referencia
$b = Carregar $Saida
$h = [Math]::Max($a.Height, $b.Height)
$gap = 24
$lado = New-Object System.Drawing.Bitmap(($a.Width + $b.Width + $gap), $h)
$g = [System.Drawing.Graphics]::FromImage($lado)
$g.Clear([System.Drawing.Color]::FromArgb(255, 210, 210, 210))
$g.DrawImage($a, 0, 0, $a.Width, $a.Height)
$g.DrawImage($b, $a.Width + $gap, 0, $b.Width, $b.Height)
$g.Dispose()
$lado.Save($LadoALado, [System.Drawing.Imaging.ImageFormat]::Png)
"REF $($a.Width)x$($a.Height)  SAIDA $($b.Width)x$($b.Height)  -> $LadoALado"
if ($Faixas) {
  $fa = FaixasDe $a; $fb = FaixasDe $b
  $n = [Math]::Max($fa.Count, $fb.Count)
  for ($i = 0; $i -lt $n; $i++) {
    $l = if ($i -lt $fa.Count) { $fa[$i] } else { '' }
    $r = if ($i -lt $fb.Count) { $fb[$i] } else { '' }
    '{0,3} {1,-30} | {2}' -f $i, $l, $r
  }
}
$a.Dispose(); $b.Dispose(); $lado.Dispose()
