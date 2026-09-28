# Referências oficiais da impressão (Assistente Beta)

Fonte oficial do layout — não usar interpretação livre nem o layout antigo:

- `mockup-comanda-cozinha-termica-menuzia.png` — comanda da cozinha (576 pontos = 80 mm).
- `pre-conta-menuzia-v4.png` — pré-conta / Recibo / Extrato (576 pontos = 80 mm).

O renderizador do Beta (`printer-agent/src/print-beta.ps1`) é uma réplica medida desses
dois PNGs: fontes DejaVu (as dos modelos, embutidas em `printer-agent/src/fonts`), cores,
margens (52 na comanda, 28 na pré-conta) e a distância de cada bloco ao anterior.

Conferir qualquer mudança lado a lado antes de publicar:

```
node scripts/impressao/render-modelos-beta.mjs <pasta>
powershell -File scripts/impressao/comparar-modelo.ps1 -Referencia docs/referencias/impressao/pre-conta-menuzia-v4.png -Saida <pasta>/preconta-mesa-80.png -LadoALado lado.png -Faixas
```

`-Faixas` lista, lado a lado, o y, a altura e a largura de cada linha de tinta da
referência e da saída. `comparacao/` guarda o resultado da última publicação.

O Assistente de Impressão antigo (0.1.23: recibo.js, pre-conta.js, print.ps1) tem o layout
dele e não segue estas referências.
