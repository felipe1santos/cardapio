# Compactar o topo das telas — Etapa 1 (só relatório, 16/10/2026)

Nenhum arquivo de código foi alterado. Medido em produção, na loja **Angus Burguer** (slug `menuzia`, a loja de teste),
com o Chromium do Playwright (login feito pelo Felipe na janela, roteiro só navegou). Roteiro: `.medidas/compactar-topo.mjs`.
Prints (1366×768 e 1920×1080, 35 telas × 2) em `.shots/compactar-topo/` — **fora do git** (repositório público; Clientes
e Auditoria mostram nomes e telefones). Medidas brutas em `.shots/compactar-topo/medidas.json`.

**Como medi:** % = distância do topo da janela até o começo do conteúdo principal (cabeçalho da tabela, primeira linha da
lista, quadro do Kanban, grade de mesas) ÷ altura da janela. Onde a medida automática não achou tabela (telas vazias,
formulários), conferi no print. "Depois" é estimativa: barra do topo 57px + 16px de respiro + linha 1 (36px) + 8px +
linha 2 (36px) + 12px ≈ **165px → ~21% em 768 e ~15% em 1080**.

## O que mais pesa hoje (vale para todo o Financeiro)

| Bloco | Altura em 1366×768 | O que acontece |
|---|---|---|
| Aviso "Crie seu PIN" (cartão branco, 3 linhas) | 95px (12%) | aparece em TODAS as 11 seções enquanto o dono/gerente não tem PIN |
| Título dentro da página ("Contas e DRE ⓘ") | ~45px (6%) | repete o item ativo do submenu, logo ao lado |
| 2º título + frase (Precificação, Fluxo, Dashboard) | ~55px (7%) | "Precificação / CMV" e logo abaixo "Precificação e CMV" |
| Abas em botões | ~45px | ocupa uma linha inteira |
| Cartões de resumo grandes (4 por linha) | ~80px | cada número numa caixa de 78px |
| Filtros quebrando em 2–3 linhas | 45–130px | CSV e botão principal caem para uma linha só deles |

Resultado: em 1366×768 só a barra do topo (57px) + aviso do PIN + títulos já consomem **~26%** antes de qualquer
conteúdo.

## Padrão proposto (resumo)

1. **Caminho na barra do topo:** "Financeiro › Contas e DRE ⓘ" (seção menor, cinza, com o "i" do guia). Sai o título de
   dentro da página e o 2º título/frase (a frase vai para o "i").
2. **Aviso do PIN na barra do topo:** faixa baixa (32px) entre o caminho e a impressora, no amarelo da conversa que pede
   atendente na central (fundo `#FEF3C7`, borda `#FCD34D`, faixa à esquerda `#F59E0B` — tokens `DESTAQUE_NOVO`/`FAIXA_NOVO`
   que já existem em `components/ui/tokens-central.ts` e hoje não são usados): "Crie seu PIN de aprovação" + botão
   "Criar PIN" + "i" com a explicação completa. Só no Financeiro, só para dono/gerente sem PIN (mesma regra do
   `PassoPin` de hoje). No celular: faixa fina logo abaixo da barra.
3. **Linha 1:** resumos em pílulas numa linha (ícone 14px + rótulo + valor, cor do status) à esquerda; à direita, lista
   suspensa da sub-seção no lugar da fileira de botões.
4. **Linha 2:** situação como controle segmentado pequeno (32px), busca, ordenação; à direita CSV + botão principal.
5. **Tabela:** ocupa a altura que sobra, rola por dentro, cabeçalho fixo.
6. **Nada some:** toda aba vira opção da lista suspensa (1 clique a mais); todo filtro/botão continua na linha 2.

Componentes reutilizáveis a criar na Etapa 2 (não existe nenhum hoje — cada tela monta filtros à mão):
`CaminhoTopo` (prop nova e opcional na `TopBar`), `AvisoTopo` (amarelo), `LinhaResumos` (pílulas), `SeletorSecao`
(lista suspensa), `BarraFiltros` (segmentado + busca + ações). O padrão entra no `docs/design/guia-visual-menuzia.md`.

## Financeiro

| Tela | Problema encontrado | O que vai mudar (em português simples) | Hoje → depois (1366 / 1920) | Risco | Prioridade |
|---|---|---|---|---|---|
| **Contas e DRE › A pagar** | Aviso do PIN + título + 5 abas em botões + 4 cartões + filtros em 2 linhas (CSV e "Nova conta" sozinhos numa linha) | Caminho no topo; linha 1 = "A pagar R$ · Vencidas R$ · Vence hoje R$ · Conta da empresa R$" + lista "A pagar ▾"; linha 2 = Em aberto/Vencidas/Pagas/Canceladas/Todas + Buscar + CSV + Nova conta a pagar | **59% → 21%** / 35% → 15% | baixo | **1** |
| Contas › A receber | Igual ao A pagar + um aviso a mais | Mesmo padrão; o aviso vira "i" ao lado do seletor | **68% → 21%** / 39% → 15% | baixo | **1** |
| Contas › Compras de insumos | Título + abas + frase de ajuda + botão sozinho | Seletor na linha 1, "Nova compra" na linha 2; frase vai para o "i" | 41% → 17% / 28% → 13% | baixo | 2 |
| Contas › DRE | Abas + período em outra linha + linha de datas | Período (Hoje…Mês passado) como segmentado na linha 2; datas comparadas ao lado, em cinza | 45% → 21% / 30% → 15% | baixo | 2 |
| Contas › Categorias e fornecedores | Só o peso do topo (PIN + título + abas) | Ganha o caminho e o seletor; os 2 cartões lado a lado ficam | ~35% → 15% | baixo | 3 |
| **Precificação / CMV › Precificação** | Pior caso: PIN + "Precificação / CMV" + "Precificação e CMV" + frase + 4 abas + 4 cartões + filtros em 2 linhas | Linha 1 = "Com ficha 0 · Sem ficha 27 · Margem média — · Margem baixa 0" + "Precificação ▾"; linha 2 = busca, categoria, status, ordenação, "Sem ficha" e "Margem baixa" (filtros rápidos) + CSV | **68% → 21%** / 41% → 15% | baixo | **1** |
| CMV › Insumos | Topo pesado para uma lista curta | Seletor na linha 1; busca + "Novo insumo" na linha 2 | 50% → 17% / 34% → 13% | baixo | 2 |
| CMV › CMV das vendas | 4 cartões grandes + aviso + gráfico de anel abaixo da dobra | Pílulas na linha 1 (com o aviso "90% sem custo" como pílula âmbar); período na linha 2 | gráfico em ~66% → ~25% | baixo | 2 |
| CMV › Margens e preço | Formulário; só o topo pesa | Só caminho + seletor | form em ~35% → 15% | baixo | 3 |
| **Fluxo de Caixa** | Título duplo + período + datas + 3 botões + cartão de filtros sempre aberto (4 blocos) + 6 cartões + gráfico: a **tabela começa abaixo da dobra** | Linha 1 = 6 resumos em pílulas + período; linha 2 = datas, botão "Filtros (n)" que abre o painel (hoje sempre aberto), Colunas, CSV, PDF. Gráfico vira "Mostrar gráfico" recolhível | **~150% → ~22%** / ~95% → 16% | **médio** (tela grande, com tfoot fixo e colunas configuráveis) | **1** |
| Dashboard (financeiro) | PIN + título duplo + 12 cartões de 110px; o gráfico fica na dobra | Título duplo sai; período na mesma linha do caminho; cartões viram grade compacta de 6 por linha (rótulo + valor, 64px) | gráfico 100% → ~45% / 62% → 30% | baixo | 2 |
| Auditoria e Alertas | PIN + título + cartão "Integridade" inteiro antes dos alertas | "Verificar integridade" vira botão na linha 2; alertas, acessos e aprovações viram seletor (3 opções) | lista 55% → 21% / 33% → 15% | baixo | 2 |
| Risco por funcionário | PIN + título + período + linha de ajuda | Período na linha 1; ajuda no "i" | 42% → 17% / 26% → 13% | baixo | 2 |
| Acerto de Motoboys | PIN + título + cartão "Troco do motoboy" | "Troco: Por pedido / Fundo fixo" vira segmentado pequeno na linha 1 | 39% → 17% / 26% → 13% | baixo | 2 |
| Conferir Pix | Só o PIN + título | Só o caminho | 30% → 12% / 19% → 9% | baixo | 3 |
| Caixa | PIN + título + cartão "Caixa automático" + cartão "Caixa fechado" (o extrato só aparece com caixa aberto) | "Caixa automático · Nível 1" e "● Caixa fechado" viram uma linha de status com os botões (Ativar controle / Abrir caixa) à direita | 1º conteúdo em ~56% → ~21% | **médio** (tela do dia a dia do caixa; botões de abrir/fechar precisam continuar óbvios) | 2 |
| Movimentações | PIN + título + cartão "Caixa fechado" | Igual ao Caixa | ~30% → ~15% | baixo | 3 |
| Regras e limites | PIN + título + bloco de regras de 4 linhas | Bloco vira "i"/recolhível "Como o PIN funciona"; formulário sobe | ~41% → ~17% | baixo | 3 |

**Só o aviso do PIN no topo + título no caminho** já devolvem ~140px (18% da tela em 1366) em **todas** as 11 seções.

## Resto do sistema

| Tela | Problema encontrado | O que vai mudar | Hoje → depois (1366 / 1920) | Risco | Prioridade |
|---|---|---|---|---|---|
| Pedidos (finalizados) | Aviso amarelo largo + 3 cartões de 100px + abas + cabeçalho "Pedidos finalizados" + filtros: a lista começa na metade | Aviso vira faixa baixa; resumo em pílulas na linha das abas (já há "Ocultar resumo"); cabeçalho e filtros numa linha | **~53% → ~25%** / ~37% → 18% | baixo | **1** |
| Pedidos › Entregadores | Mesmo topo + cabeçalho com 2 botões | Mesmo padrão | 38% → 22% / 27% → 15% | baixo | 2 |
| Campanhas (Visão geral) | Barra de ações numa 2ª linha só para 2 botões; 9 cartões grandes em 3 linhas antes do gráfico | "Boas práticas" e "Disparar mensagem" sobem para a barra do topo (`right`); números em pílulas/grade compacta | gráfico 62% → ~35% / 41% → 25% | baixo | 2 |
| Integrações | Faixa azul "Sentiu falta…" de 80px no começo | Vira link discreto no fim ou botão pequeno na barra do topo | cartões 30% → 20% | baixo | 3 |
| Dashboard (geral) | — | Já bom | 17% / 12% | — | não mexer |
| Painel de Pedidos (Kanban) | — | Já bom (controles na barra do topo, resumos de 60px). Regra: não mexer no Kanban/Despacho | 19% / 14% | — | não mexer |
| PDV | — | Já bom (grade direto, sem barra de topo) | ~9% | — | não mexer |
| Mesas e Comandas | — | Já bom (ações na barra, filtros numa linha) | ~23% / ~17% | — | não mexer |
| KDS | — | Já bom (tela de cozinha, cabeçalho próprio de 58px) | ~9% | — | não mexer |
| Cardápio | Topo bom (26% / 19%) | Nada no topo. **Outro achado:** a coluna "Item" fica estreita e a descrição do "Mega Burguer" quebra palavra por palavra (linha de 290px) | 26% / 19% | — | não mexer (achado à parte) |
| Clientes | — | Já é o modelo: 4 resumos baixos + cabeçalho com busca e CSV numa linha + cabeçalho fixo | 29% / 21% | — | não mexer |
| Fidelidade | — | Já bom | 20% / 13% | — | não mexer |
| Equipe | — | Já bom (busca + botão numa linha). Só falta o cabeçalho fixo da tabela | 17% / 12% | baixo | 3 (só o cabeçalho fixo) |
| Impressão | — | Formulário em passos; não é tabela. Regra: não mexer em impressão | — | — | não mexer |
| Ajustes | — | Formulário com submenu; topo já mínimo | — | — | não mexer |
| Agente de IA | — | Hoje abre dentro de Ajustes (`?aba=agente`) | — | — | não mexer |
| Super Admin | Não medido (a conta não é da plataforma; abriu `/login`). Pelo código: cabeçalho próprio fixo + 6 cartões + linha de filtros + tabela com cabeçalho fixo | Se quiser, 6 cartões → pílulas | estimado ~35% → ~20% | baixo | 3 |

## Proposta de ordem para a Etapa 2

1. Peças comuns + barra do topo com caminho + aviso do PIN amarelo (ganho imediato nas 11 seções do Financeiro).
2. Contas a pagar/receber, Precificação/CMV e Fluxo de Caixa (as três piores, com tabela).
3. O resto do Financeiro (prioridade 2 e 3).
4. Pedidos finalizados/Entregadores e Campanhas.

## Observações

- A troca de sub-seção por lista suspensa custa 1 clique a mais em Contas (5 opções) e CMV (4 opções). No celular a
  lista suspensa nativa é melhor que a fileira de botões que hoje rola de lado.
- A `TopBar` é usada em todas as telas: o caminho entra como prop **opcional** — quem não passar continua igual.
- Achado sem relação com o topo: depois do clique, a aba ativa do Financeiro fica com uma borda azul de foco forte
  (aparece nos prints de CMV e Contas) — dá para alinhar com o `focus-visible` do guia.
