# Referências oficiais da impressão (Assistente Beta)

Modelos oficiais desde 2026-09-28 (0.2.0-beta.5) — o dono pediu que o papel saia
**idêntico** a eles:

- `v2/COMANDA.png` — comanda da cozinha.
- `v2/PRE-CONTA.png` — pré-conta / Recibo / Extrato.

Com três pedidos do dono sobre os modelos:

- a comanda **não tem preço** em ITENS DO PEDIDO (a cozinha lê rápido o que preparar);
- a quantidade (`1x`) fica colada na descrição, sem coluna larga;
- `Pedido #129` menor que no modelo (lá estava exagerado).

A observação do item sai sobre um fundo cinza claro, como no modelo.

## Como é desenhado

Um desenho só, em `printer-agent/src/ticket-canvas.js` (canvas), usado por:

- o Assistente Beta — janela oculta do Electron (`renderer/ticket.html`) → PNG →
  `print-imagem.ps1` (térmica ponto a ponto; PDF/XPS/laser no tamanho físico);
- a **pré-visualização** da página Impressão (`components/impressao/previa-beta.tsx`) —
  o que aparece na tela é o que sai no papel;
- os testes (`scripts/impressao/render-ticket.mjs`, Chromium sem janela).

Fontes: Iosevka (texto) e Roboto Condensed (Pedido e TOTAL), licença OFL, em
`printer-agent/src/fonts` — com cópia idêntica em `public/impressao/fonts` para o painel
(um teste confere). A logo MENUZiA foi recortada do modelo (`logo-menuzia.png`).

Tamanho da letra por impressora (Impressão › Escolher impressoras › Mais opções, ou na
própria pré-visualização): **Grande = o modelo**, Média (92%) e Pequena (85%).

## Conferir antes de publicar

```
node scripts/impressao/render-modelos-v2.mjs <pasta> [grande|media|pequena]
node scripts/impressao/lado-a-lado-v2.mjs COMANDA <pasta>/cozinha-80-grande.png lado-comanda.png
node scripts/impressao/lado-a-lado-v2.mjs PRE-CONTA <pasta>/preconta-80-grande.png lado-pre-conta.png
node scripts/impressao/render-casos-v2.mjs <pasta>   # nomes longos, mesa, balcão, 58 mm, 3 letras
```

`comparacao/` guarda o resultado da última publicação.

O Assistente de Impressão antigo (0.1.23: recibo.js, pre-conta.js, print.ps1) tem o layout
dele e não segue estas referências.
