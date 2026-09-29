# Comanda padrão + compatibilidade com impressoras (2026-09-29)

Referência oficial: `docs/referencias/impressao/comanda-padrao.png` (80 mm, letra grande).
Amostras e comparação: `docs/referencias/impressao/comparacao/`.

## Como a impressão era gerada e enviada (Assistente Beta ≤ 0.2.0-beta.6)

1. `ticket-canvas.js` desenha a comanda/pré-conta num canvas (janela oculta do Electron) na
   largura em pontos (576 em 80 mm, 384 em 58 mm, ou a calibrada). Saía um PNG **em tons de
   cinza** (o canvas suaviza as letras).
2. `print-imagem.ps1` entregava o PNG ao **driver do Windows** (GDI `PrintDocument`), num
   bloco só, com papel sob medida. Com ~203 dpi desenhava ponto a ponto; senão, redimensionava
   com suavização.
3. **Preto e branco, largura, densidade e corte: decididos pelo driver.** Nenhum ESC/POS.

## Causas do problema do cliente (POS-8370, 80 mm)

- **Cortado:** o driver instalado/configurado é de 58 mm (384 pontos). Pelo driver, é ele quem
  manda na largura: a comanda de 576 pontos sai cortada em ~2/3. Acontecia também com o layout
  antigo.
- **Apagado:** o texto fino da pré-conta tinha bordas cinza; o driver dessa impressora converte
  cinza em pontos ralos. Preto sólido (faixas, QR) saía perfeito.

## O que mudou

| Item | Onde |
|---|---|
| Comanda no padrão novo (mesa / entrega / retirada; TOTAL sem fundo; complementos grandes; valores e dados em mono; rodapé em duas colunas com o QR) | `printer-agent/src/ticket-canvas.js`, `cozinha-beta.js` |
| B1 — tudo em **1 bit** no tamanho exato de pontos; texto por limiar; faixa da OBS e logo em retícula uniforme; pré-conta com letra mínima e traço de reforço | `ticket-canvas.js` (`monocromatizar`) |
| B2 — **Intensidade** (Normal = hoje / Escura / Mais escura): limiar do desenho e, no envio direto, o comando de densidade (GS ( K) | `ticket-canvas.js`, `escpos.js` |
| B3 — Largura 384 / 512 / 576 e **Teste de largura** (barras nas bordas, régua, acentos) | `components/impressao/envio-impressora.tsx`, `calibracao.js` |
| B4 — Envio em faixas de 192 linhas (GS v 0), avanço de 5 linhas antes do corte | `escpos.js` |
| B5 — Modo **Texto** (ESC/POS nativo, PC850 para acentos, QR como imagem) | `escpos.js` |
| Envio direto: **fila do Windows (RAW)** e **rede IP:9100** | `print-raw.ps1`, `envio-direto.js`, `printer.js` |
| Aviso "Seu driver está em 58 mm, mas a impressora é de 80 mm" | `lib/impressao/regras-calibracao.ts` |
| Colunas por impressora (padrões = comportamento de hoje) | migration **0109** |
| Guia do cliente | `public/guia-impressora-80mm.html` |

Padrões: envio pelo driver, modo imagem, intensidade normal. Para quem já imprime bem, a única
mudança é o desenho sair em 1 bit (igual ou mais nítido).

## Testes

- `npx vitest run` — escpos (bytes decodificados de volta), regras de calibração, comanda.
- `node scripts/impressao/amostras-comanda-padrao.mjs` — 18 comandas (3 tipos × 58/80 × 3 letras),
  pré-conta em 384/512/576, lado a lado com a referência; confere 1 bit e nada nas bordas.
- `node scripts/impressao/simular-envio-direto.mjs` — cenário do cliente: driver de 58 mm (aviso
  e o corte que ele faria) × envio direto por IP (impressora falsa em 127.0.0.1 recebe e a
  imagem é remontada) e pela fila (print-raw.ps1 em modo arquivo + compilação do winspool).
- `node scripts/impressao/golden-assistente-0123.mjs` — o Assistente antigo imprime igual.

## Publicar

1. Aplicar a **0109** em produção (rollback: `docs/rollback/0109_impressao_envio_direto.down.sql`)
   — ANTES do deploy: o painel e a fila leem as colunas novas.
2. Deploy.
3. Gerar e publicar o instalador **0.2.0-beta.7** (`npm run dist:beta` em `printer-agent/`) como
   pré-release e trocar o link em `lib/impressao/rotulos.ts`.
4. Lojas instalam o 0.2.0-beta.7 por cima. Sem ele: a prévia do painel já mostra o padrão novo,
   mas o papel continua no layout do beta.6 e sem envio direto.

## Passo a passo para o cliente com problema

1. Instale o **Assistente Menuzia Beta 0.2.0-beta.7** por cima do atual.
2. Abra **Impressão › Calibrar impressora** e escolha a impressora.
3. Se aparecer "Seu driver está em 58 mm…": clique em **Usar envio direto** (ou ajuste o papel do
   driver para 80 mm — guia em "Como resolver").
4. Impressora com cabo de rede? Em **Envio**, escolha **Direto pela rede (IP)** e digite o IP do
   autoteste (segure FEED ao ligar), porta 9100.
5. **Largura: 576**. Letra clara? **Intensidade: Escura**.
6. **Imprimir teste de largura**: as duas barras pretas e o último número da régua precisam sair
   inteiros. Ainda com problema: **Modo de impressão: Texto** e mande a foto do teste.
