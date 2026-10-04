# Item 4b — Financeiro no estilo da Meta (2026-10-04)

Só visual: nenhum cálculo, ledger, permissão ou regra mudou. O tema vale do menu lateral do financeiro para
dentro (`.fin-meta`); o topo do sistema (avisos, status do caixa, impressora, Dúvidas, perfil) e as outras telas
não mudam.

Referência: os cinco prints da Meta (cópias em `referencia-meta/`):
`linhas-detalhamento` (234143), `barras-origem-menu` (234328), `medidor-avisos-botoes` (234249),
`linha-meta-tracejada` (234301), `contas-cards-botoes` (234451). O 230130 foi ignorado, como pedido.

## Paleta (dos prints) e cores medidas

Exatamente a do pedido: azul `#0A78BE`, verde de ação `#006B4E`, texto `#1C2B33` / `#465A69`, ativo
`#E1EDF7`, destaque `#E7F5FF`, atenção `#D47B04`, erro `#D93616`, bordas `#CBD2D9`, trilho `#EFF1F3`, cards
brancos, fundo em gradiente `#E5F0FA → #FAF1F1`. Gráficos: as cores da Fase 6 (inalteradas).
Medidas nos próprios prints (pixel a pixel): coluna do hover nas barras `#F2F2F2`, faixa do aviso informativo
`#CBD2D9`, faixa verde-água do card de destaque `#4DBBA6`, botão azul `#0A78BE`, botão verde `#006B4E`,
aba/menu ativos `#E1EDF7`, bloco de estimativa `#E7F5FF`.

## Kit de componentes (`components/financeiro/ui/meta.tsx` + `app/globals.css`)

| Peça | O que é |
|---|---|
| `Card` | branco, cantos de 8 px, sombra suave, respiro de 20 px; título + subtítulo + ações; faixa colorida opcional à esquerda |
| `CabecalhoSecao` | título forte `#1C2B33` + subtítulo `#465A69` |
| `Kpi` | rótulo, valor grande, ícone em bolha e variação ▲▼ contra o período anterior (verde/vermelho; `inverso` para despesas e CMV) |
| `Aviso` | faixa à esquerda (informação, atenção, erro, sucesso), ícone, título, texto, ação e fechar |
| `Destaque` | bloco azul-claro `#E7F5FF` (como a "Estimativa de resultados diários") |
| `Abas` / `Chip` | aba ativa em `#E1EDF7` com texto azul |
| `FiltroPeriodo` | botão branco com calendário + período + seta; abre a lista por cima (Flutuante, camada máxima) |
| `FIN_BTN` | principal azul, ação verde, contorno, perigo, texto — com normal, hover, clique, foco e desabilitado |
| `SeloMeta` / `ValorSinal` | selo sólido com texto branco; entradas em verde e saídas em vermelho |
| `BotaoGaveta` | Sangria, Reforço, Despesa, Retirada e Perda com ícone e cor por tipo |
| `GraficoFinanceiro` | o componente único da Fase 6, agora com a coluna cinza do hover nas barras, o período em negrito no topo do tooltip das barras, bolinha na meta no hover e rodapé "Fuso horário — America/Sao_Paulo" |
| `Medidor` | circular, cópia do "19%": anel `#EFF1F3`, arco `#D93616` (alerta), % grande no centro, meta embaixo |
| Tabelas | cabeçalho discreto `#F5F7F9` 12,5 px/600, linhas com hover `#F5F7F9` |
| Transições | 150 ms em cor, fundo, borda e sombra; abrir/fechar do filtro com seta girando |

Fonte: **Figtree** (SIL OFL), a gratuita mais parecida com a Optimistic da Meta, pesos 400–700, só dentro do
financeiro, sem pré-carregamento. Ícones: **Lucide** (traço de 2 px, já usado no sistema).
⚠️ O CLAUDE.md lista só Inter e Montserrat; a Figtree entrou porque o pedido manda usar a mais parecida com a
da Meta. Se preferir, volta para a Mulish do painel trocando uma linha (`--font-meta` em `.fin-meta`).

## O que mudou por tela

- **Menu lateral do financeiro**: item ativo azul-claro com texto azul, hover cinza, cantos de 6 px; no celular,
  o trilho rola sozinho até a seção ativa.
- **Caixa**: card de situação com faixa (verde-água aberto / vermelha fechado), título de 18 px, "Abrir caixa"
  no verde de ação; saldos como indicadores; "Movimentar a gaveta" com os botões por tipo; **gráfico novo
  "Entradas por hora do turno"** (barras, só para quem vê valores — a contagem cega continua cega); extrato em
  card com entradas verdes e saídas vermelhas; último fechamento em indicadores.
- **Movimentações**: mesma tela do caixa (botões da gaveta com ícone).
- **Fluxo de Caixa**: cabeçalho, filtros em card, chips de período como abas Meta, totais, **gráfico novo
  "Recebido por turno"** (barras + linha da diferença), tabela leve (aberto em azul-claro, rodapé de totais em
  `#E7F5FF`), cartões no celular. Cores de situação na paleta Meta (também no PDF do fluxo).
- **Acerto de Motoboys / Conferir Pix**: cards, avisos com faixa, selos sólidos, botões Meta.
- **Precificação / CMV**: cabeçalho; **medidor circular da margem média ("Meta >= alvo")** + **barras de
  margem por produto com a margem-alvo tracejada** e a margem baixa sólida; tabela leve; "CMV das vendas" com o
  medidor; configuração em card com a fórmula num bloco azul-claro.
- **Contas e DRE**: abas Meta, avisos com faixa, cards, seleção de carteira/forma em azul; DRE em tabela leve.
- **Dashboard**: título, **filtro de período com calendário** + Dia/Semana/Mês, 12 indicadores com **variação
  ▲▼ contra o período anterior**, evolução em card com o **medidor circular do CMV**, origem/forma/produtos em
  cards, conciliação com o total num bloco de destaque, diferenças por turno.
- **Auditoria e Alertas**: integridade, alertas com faixa colorida por gravidade e selo sólido, acessos e
  aprovações em cards com tabela/lista leve.
- **Risco por funcionário / Regras e limites**: cards, avisos, botões e campos Meta.
- **Janelas**: abertura, fechamento (contar, pendências, divergência, PIN, feito), reabrir, movimento — modal da
  Meta (cantos de 8 px, sombra, título de 18 px, X com hover); **aprovação por PIN** como aviso de atenção
  (faixa laranja) com botões Meta; **abertura rápida** com faixa verde-água; **pedido de aprovação no celular**
  (faixa do topo em âmbar escuro e janela Meta); painel lateral (filtros, extrato, aplicar preço) no padrão.

## Inferido (sem print de referência)

1. **Hover**: um pouco mais escuro — azul `#0868A6`, verde `#005C43`, vermelho `#C02F12`, contorno `#F5F6F7`.
2. **Clique (active)**: mais escuro — azul `#075890`, verde `#004D38`, vermelho `#A6280F`, contorno `#E4E7EA`.
3. **Foco de teclado**: anel azul `#0A78BE` de 2 px com folga branca de 2 px.
4. **Desabilitado**: 45% de opacidade, cursor de bloqueio.
5. **Transições**: 150 ms (cor, fundo, borda, sombra); seta do filtro gira 180°.
6. **Sombra do card**: `0 1px 2px` + `0 2px 8px` em `rgba(28,43,51,…)`, borda `#CBD2D9` a 70%.
7. **Campos**: borda `#CBD2D9`, hover `#9AA6B1`, foco azul com 1 px de anel.
8. **Tabelas**: cabeçalho `#F5F7F9`; hover de linha `#F5F7F9`.
9. **Medidor "bom"**: arco azul `#1877F2` (o print só mostra o vermelho de alerta).
10. **Variação ▲▼**: verde `#006B4E` quando melhora, vermelho `#D93616` quando piora.
11. **Botões da gaveta**: cores por tipo dentro da família da paleta.
12. **Ajustes de contraste** (regra ≥ 4,5:1, que a Meta não cumpre em todo lugar): texto azul sobre `#E1EDF7`
    em `#0868A6` (o `#0A78BE` dá 3,96:1); laranja `#D47B04` só como faixa/ícone; texto de atenção e selo
    laranja em `#8A4B00`; verdes de texto em `#006B4E` (o `#16A34A` antigo dava 3,3:1).
13. **Celular**: indicadores empilhados, tabelas viram cartões (como antes), tooltip do gráfico pelo toque.

## Testes

| O quê | Resultado |
|---|---|
| **Valores iguais antes × depois** (`scripts/financeiro/comparar-valores.mjs`: todo R$, % e data-valor de 18 telas × desktop/celular) | 34/36 iguais; as 2 da Auditoria diferem só porque as próprias capturas geraram alertas novos de "login em 2 aparelhos" e a lista (limitada) empurrou dois antigos — dado, não visual |
| **Contraste automático** (`capturas-redesign.mjs`, todo texto visível, WCAG 4,5:1 / 3:1 grande) | antes **78** textos abaixo do mínimo (botão verde 2,5:1, "Caiu", "Grave", vermelhos claros) → depois **0** em 4.202 textos |
| **Hover / clique / foco / toque** (`estados-redesign.mjs`) | 7/7 — azul → hover → clique, anel de foco pelo teclado, menu lateral, filtro pelo teclado (por cima, z 9999, Esc fecha), tooltip com mouse e com toque, seção ativa visível no celular |
| e2e-financeiro-fase6 / mesma-base / contas / cmv | 97/97 · 53/53 · 80/80 · 61/61 |
| e2e-financeiro-atomico / fluxo / integrado / loja-sem-financeiro | 23/23 · 86/86 · 52/52 · 6/6 |
| e2e-financeiro-fase1 / fase2 / fase3 | 66/66 · 55/55 · 106/106 |
| PDV: pagamento / v2 / navegação | 57/57 · 70/70 · 30/30 |
| Mesas (garçom) · Kanban card / topo v2 · Equipe repaginada / acessos · Dashboard geral | 47/47 · 72/72 / 121/121 · 75/75 / 27/27 · 8/8 |
| e2e-produto-repaginado (corrigido para não falhar aos domingos) | 65/65 |
| vitest (lib + components) · tsc · eslint · build | 1725/1725 · ok |

Testes ajustados ao visual novo (sem mudar o que conferem): fase6 (abre o filtro de período antes do atalho;
medidor circular; a coluna cinza do hover não conta como barra), mesma-base (filtro; empate Prato × Porção no
mais vendido), fluxo (vermelho `#D93616`), fluxo-regras.test (cores de situação). Instabilidade vista: contas
falhou 1× com a máquina carregada (montagem do lado a lado em paralelo) e passou 80/80 na repetição.

Achado e corrigido durante os testes: no celular o tooltip do gráfico sumia ao soltar o dedo (o navegador manda
"pointerleave"); agora fica aberto até tocar fora.

## Prints

- `antes/` e `depois/`: cada tela e aba (Caixa, Fluxo, Motoboys, Pix, Movimentações, CMV ×4, Contas ×5,
  Dashboard, Auditoria, Risco, Regras) no desktop (1366) e no celular (390), mais as janelas de abertura e de
  aprovação por PIN. Valores e contraste em `valores-antes.json` / `valores-depois.json`.
- `lado-a-lado/`: antes | depois | referência da Meta, para cada uma das 38 capturas (JPEG).
- `referencia-meta/`: os cinco prints usados.
