param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [int]$Copies = 1,
  [int]$Cols = 0
)

$ErrorActionPreference = 'Stop'

# Garante que a impressora ainda existe no Windows antes de mandar imprimir.
# Sem isso, um nome errado/removido faria o spooler "aceitar" sem imprimir nada
# e o pedido seria marcado como impresso (perdido). Falhar aqui faz o agente
# tentar de novo no próximo ciclo em vez de dar o pedido como impresso.
$existe = $false
try { if (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue) { $existe = $true } } catch {}
if (-not $existe) {
  try {
    Add-Type -AssemblyName System.Drawing
    foreach ($p in [System.Drawing.Printing.PrinterSettings]::InstalledPrinters) { if ($p -eq $PrinterName) { $existe = $true } }
  } catch {}
}
if (-not $existe) { throw "Impressora '$PrinterName' nao encontrada no Windows." }

# Método legado (à prova de falhas): manda o texto puro pelo spooler. É o que sempre
# funcionou; fica como fallback caso o render gráfico abaixo dê problema em alguma
# impressora. Assim a impressão NUNCA para — no pior caso volta ao visual antigo.
function Invoke-ImpressaoTexto {
  for ($i = 0; $i -lt $Copies; $i++) {
    Get-Content -Path $FilePath -Raw -Encoding UTF8 | Out-Printer -Name $PrinterName
  }
}

# Render gráfico: imprime o cupom com fonte MONOESPAÇADA NEGRITO e pixels sólidos
# (sem anti-aliasing), deixando as letras grossas e escuras — em vez da fonte fina
# padrão do Out-Printer. A largura da fonte é auto-ajustada pra linha mais larga
# caber no papel, e a altura do papel é igual ao conteúdo (não desperdiça bobina).
function Invoke-ImpressaoGrafica {
  Add-Type -AssemblyName System.Drawing

  $texto = Get-Content -Path $FilePath -Raw -Encoding UTF8
  $linhas = $texto -replace "`r", '' -split "`n"
  # Tira linhas em branco no fim pra não sobrar bobina.
  while ($linhas.Length -gt 0 -and $linhas[-1].Trim().Length -eq 0) {
    $linhas = $linhas[0..($linhas.Length - 2)]
  }
  if ($linhas.Length -eq 0) { return }

  $maxLen = 1
  foreach ($l in $linhas) { if ($l.Length -gt $maxLen) { $maxLen = $l.Length } }

  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $PrinterName
  $doc.PrinterSettings.Copies = [int]$Copies
  $doc.DocumentName = 'Menuzia Recibo'

  # Graphics offscreen (bitmap) só pra MEDIR o texto. Antes usávamos
  # CreateMeasurementGraphics(), que inicializa o driver da impressora — lento em
  # térmicas e somado ao Print() dobrava a inicialização (impressão demorava).
  # A medição de fonte em pontos é física (independe do DPI), então o bitmap em
  # unidade Display (1/100") dá a mesma largura/altura em polegadas que a impressora.
  $tmpBmp = New-Object System.Drawing.Bitmap(1, 1)
  $mg = [System.Drawing.Graphics]::FromImage($tmpBmp)
  $mg.PageUnit = [System.Drawing.GraphicsUnit]::Display

  $paper = $doc.DefaultPageSettings.PaperSize
  # Largura útil: a MENOR entre área imprimível e largura do papel. Drivers térmicos
  # às vezes reportam uma área imprimível maior que o papel físico — pegar a menor
  # evita dimensionar a fonte larga demais e cortar o texto na borda direita.
  $larguraUtil = $doc.DefaultPageSettings.PrintableArea.Width
  if ($larguraUtil -le 0 -or $larguraUtil -gt $paper.Width) { $larguraUtil = $paper.Width }
  $margemLat = 10  # 0,10" de respiro lateral
  # Fator de segurança: deixa ~6% de folga pra absorver diferença entre o texto medido
  # e o realmente rasterizado na impressora (medição nunca bate 100% com o desenho).
  $larguraTexto = ($larguraUtil - (2 * $margemLat)) * 0.94
  if ($larguraTexto -le 0) { $larguraTexto = $larguraUtil }

  # Dimensiona a fonte pra PREENCHER o papel no nº de colunas alvo (Cols) — assim
  # menos colunas = fonte maior, e o tamanho fica consistente (teste = pedido real),
  # em vez de encolher conforme o conteúdo. Se o conteúdo passar de Cols (não deveria,
  # o recibo é montado nessa largura), usa o maior pra não cortar. Mede do MESMO jeito
  # que desenha (MeasureString padrão), senão a medição sai mais estreita e estoura a borda.
  $alvo = if ($Cols -gt 0) { [Math]::Max($Cols, $maxLen) } else { $maxLen }
  $amostra = ('M' * $alvo)
  $font = $null
  for ($sz = 18.0; $sz -ge 5.0; $sz -= 0.5) {
    $f = New-Object System.Drawing.Font('Consolas', $sz, [System.Drawing.FontStyle]::Bold)
    $w = $mg.MeasureString($amostra, $f).Width
    if ($w -le $larguraTexto) { $font = $f; break }
    $f.Dispose()
  }
  if ($null -eq $font) { $font = New-Object System.Drawing.Font('Consolas', 5.0, [System.Drawing.FontStyle]::Bold) }

  $alturaLinha = [double]$font.GetHeight($mg)
  $margemTopo = 4.0
  $alturaTotal = [int]([math]::Ceiling($margemTopo + ($linhas.Length * $alturaLinha) + 8))

  # Papel sob medida: mesma largura, altura = conteúdo. Evita avançar a bobina até o
  # fim de uma página "Carta". Margens zeradas (controlamos o respiro na mão).
  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('ReciboMenuzia', [int]$paper.Width, $alturaTotal)
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.OriginAtMargins = $false

  $script:linhasImpr = $linhas
  $script:fontImpr = $font
  $script:alturaLinhaImpr = $alturaLinha
  $script:margemLatImpr = $margemLat
  $script:margemTopoImpr = $margemTopo

  $handler = {
    param($s, $e)
    $g = $e.Graphics
    # Pixels sólidos, sem suavização: letras escuras e grossas no térmico.
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
    $brush = [System.Drawing.Brushes]::Black
    $y = [double]$script:margemTopoImpr
    foreach ($linha in $script:linhasImpr) {
      $g.DrawString($linha, $script:fontImpr, $brush, [single]$script:margemLatImpr, [single]$y)
      $y += $script:alturaLinhaImpr
    }
    $e.HasMorePages = $false
  }

  $doc.add_PrintPage($handler)
  try {
    $doc.Print()
  } finally {
    $mg.Dispose()
    $tmpBmp.Dispose()
    $font.Dispose()
    $doc.Dispose()
  }
}

try {
  Invoke-ImpressaoGrafica
} catch {
  # Qualquer problema no render gráfico: cai pro método de texto puro que sempre funcionou.
  Invoke-ImpressaoTexto
}
