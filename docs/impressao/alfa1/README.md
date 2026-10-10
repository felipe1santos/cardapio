# Impressão Alfa 1 (Assistente 1.1.0, 09/10/2026)

Layout ÚNICO e oficial da comanda e da pré-conta. Referência aprovada pelo dono: `referencia/Impressao-Alfa-1.html`
(prints em `referencia/ref-*.png`). Amostras EXATAS do que vai para a impressora (pontos em 1 bit): `amostras/`
(576, 574 e 384 pontos; simulação do modo Texto em 48 e 32 colunas). Regerar:
`cd printer-agent && npx electron ferramentas/amostras-alfa1.js ../docs/impressao/alfa1/amostras`.

## Como funciona
- `printer-agent/src/alfa1.js`: dados (comanda/pré-conta), HTML/CSS da referência (tinta preta pura), modo Texto
  (ESC/POS: negrito, letra dupla, faixa invertida, observação em caixa, WPC1252, QR nativo + link) e regras puras
  (largura real, colunas, caminho do envio).
- `printer-agent/src/alfa1-render.js`: desenha o HTML numa janela oculta (offscreen) com zoom 576/302 compensando a
  escala da tela do Windows, captura em pedaços e converte em preto e branco (limiar 175/200/215).
- Fonte Comfortaa (OFL) embutida: `printer-agent/src/fonts/Comfortaa-wght.ttf` — não depende de internet.
- Largura: a real do driver (`pontosImprimiveis`), arredondada para baixo em múltiplo de 8 (574 → 568).
- Envio: DIRETO (fila RAW ou rede) em faixas de 64 linhas com 40 ms de pausa. Windows só de RESERVA quando o
  direto dá erro (fica no log e em `impressao_dispositivos.envio_caminho`), ou forçado pelo suporte com
  `envio = 'driver'` no banco (sem tela). Impressora virtual (PDF/XPS) sempre pelo Windows.
- Imagem/Texto por impressora: `impressao_dispositivos.modo_impressao`, escolhido no "Avançado" da tela de Impressão.
- Atualização: instala com a fila vazia (nada imprimindo, nada esperando, 1 min sem imprimir), a qualquer hora.
  O beta.13 instalado nas lojas segue a regra antiga dele (03:00–10:30 / 14:30–17:00, parado 10 min).
- Lojas fora da atualização: `restaurantes.impressao_sem_atualizacao` (Villa) — o latest.yml dá 404 para o IP
  gravado em `impressao_agentes.visto_ip`.
- Versão 1.1.0 (maior que 0.2.0-beta.13 para o atualizador; "alpha" seria MENOR que "beta").
  appId, pasta de dados e executável continuam os do Beta: as lojas seguem pareadas.
