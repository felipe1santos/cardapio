# Referências oficiais da impressão (Assistente Beta)

Modelos oficiais desde 2026-09-28 (0.2.0-beta.6) — copiar na íntegra:

- `v3/COMANDA.png` — comanda da cozinha (1230 px = largura do papel).
- `v3/PRE-CONTA.png` — pré-conta / Recibo / Extrato (1020 px).

Pedidos do dono que valem junto com as imagens:

- no topo, a **logo da loja** (Ajustes › Perfil da loja; opção "Imprimir logo da loja").
  Sem logo, a comanda mostra o nome da loja em letras grandes; a pré-conta começa em
  PRE-CONTA (o nome já sai no rodapé);
- rodapé com nome, telefone e endereço **da loja** (cadastro), nunca os do cliente;
- comanda: "#129" com o tipo num selo preto; ITEM / VALOR (R$); cada item com
  qtd × preço (sem adicionais) e cada adicional com o próprio valor — a coluna soma o
  Subtotal; observação em faixa cinza clara na largura toda; VALORES como estavam, com o
  ícone da forma de pagamento (Pix, cartão, dinheiro, vale, celular);
- pré-conta: topo só com mesa (ou balcão/senha), cliente e data/hora; QTD estreita;
  TOTAL (R$) só com o número; adicionais com o valor; "2 L" / "500 ML" nunca quebram.

## Como é desenhado

Um desenho só, em `printer-agent/src/ticket-canvas.js` (canvas), usado por:

- o Assistente Beta — janela oculta do Electron (`renderer/ticket.html`) → PNG →
  `print-imagem.ps1` (térmica ponto a ponto; PDF/XPS/laser no tamanho físico); a logo
  vem de `/api/agente/logo` e entra no desenho como data URL;
- a **pré-visualização** da página Impressão (`components/impressao/previa-beta.tsx`) —
  o que aparece na tela é o que sai no papel, com as "Opções da impressão" da loja;
- os testes (`scripts/impressao/render-ticket.mjs`, Chromium sem janela).

Montadores: `cozinha-beta.js`, `pre-conta-beta.js` e `valores-item.js` (reparte a
linha do item entre ele e os adicionais, em centavos).

Fontes (licenças livres, em `printer-agent/src/fonts`, com cópia idêntica em
`public/impressao/fonts` — um teste confere): Arimo e Roboto Condensed (comanda),
DejaVu Sans Condensed e DejaVu Sans Mono (pré-conta; a Mono também em VALORES/DADOS da
comanda) e Iosevka (faixas da comanda).

Tamanho da letra por impressora: **Grande = o modelo**, Média (92%) e Pequena (85%).

## Conferir antes de publicar

```
node scripts/impressao/render-modelos-v3.mjs <pasta> [grande|media|pequena] [logo.png]
node scripts/impressao/lado-a-lado-v3.mjs COMANDA <pasta>/cozinha-80-grande.png lado-comanda.png
node scripts/impressao/lado-a-lado-v3.mjs PRE-CONTA <pasta>/preconta-80-grande.png lado-pre-conta.png
node scripts/impressao/render-casos-v3.mjs <pasta> [logo.png]   # casos difíceis, 58 mm, 3 letras
node scripts/impressao/faixas-png.mjs <png>                     # mede as linhas de tinta
```

`comparacao/` guarda o resultado da última publicação (e a tela Impressão).

O Assistente de Impressão antigo (0.1.23: recibo.js, pre-conta.js, print.ps1) tem o layout
dele e não segue estas referências.
