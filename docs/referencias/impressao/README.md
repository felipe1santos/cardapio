# Referências oficiais da impressão (Assistente Beta)

Fonte oficial do layout — não usar interpretação livre nem o layout antigo:

- `mockup-comanda-cozinha-termica-menuzia.png` — comanda da cozinha (576 pontos = 80 mm).
- `pre-conta-menuzia-v4.png` — pré-conta / Recibo / Extrato (576 pontos = 80 mm).

O renderizador do Beta (`printer-agent/src/print-beta.ps1`) segue a estrutura, a ordem dos
blocos, as faixas pretas, as fontes (DejaVu, embutidas em `printer-agent/src/fonts`) e os
textos desses dois PNGs. Em 2026-09-28 o dono pediu ajustes de LEITURA sobre essa base, que
valem daqui em diante:

- fontes cerca de 30% maiores e margem de 18 pontos (mais largura útil);
- cada seção numa faixa preta: ITENS CONSUMIDOS, VALORES e TOTAL A PAGAR na pré-conta;
  ITENS DO PEDIDO, VALORES e DADOS na comanda;
- cinza só escuro (a térmica não imprime cinza claro) e QR maior;
- no papel de 58 mm as fontes encolhem no máximo até 78%.

Impressora que não é térmica (PDF, XPS, laser): o documento sai no tamanho físico do papel
(80/58 mm), não ponto a ponto — antes, num PDF de 600 dpi, saía com ~2,4 cm de largura.

Conferir qualquer mudança lado a lado antes de publicar:

```
node scripts/impressao/render-modelos-beta.mjs <pasta>
powershell -File scripts/impressao/comparar-modelo.ps1 -Referencia docs/referencias/impressao/pre-conta-menuzia-v4.png -Saida <pasta>/preconta-mesa-80.png -LadoALado lado.png -Faixas
```

`-Faixas` lista, lado a lado, o y, a altura e a largura de cada linha de tinta da
referência e da saída. `comparacao/` guarda o resultado da última publicação.

O Assistente de Impressão antigo (0.1.23: recibo.js, pre-conta.js, print.ps1) tem o layout
dele e não segue estas referências.
