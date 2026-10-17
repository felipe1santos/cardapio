# Compactar o topo das telas — Etapa 2 (16/10/2026)

Publicado em produção para todas as lojas (só visual), em 4 blocos + 1 ajuste. Cada deploy foi conferido assim:
pedidos das lojas continuaram entrando (`.medidas/acompanhar.mjs`: Estância e Ponto 400 recebendo, nenhum pedido sem
imprimir, 0 linhas de erro no log), vitrines respondendo em menos de 0,4 s e prints do painel na loja de teste
(Angus Burguer, slug `menuzia`). Não mexi em Kanban, PDV, KDS, Mesas, Impressão, no Assistente nem na Villa.

| Bloco | Commit | O que entrou |
|---|---|---|
| 1 | `c42b0659` | Peças comuns, caminho na barra do topo, aviso amarelo do PIN, foco do guia nos chips, guia visual §7 |
| 2 | `487c180f` | Contas e DRE, Precificação/CMV, Fluxo de Caixa |
| 3 | `4a494427` | Caixa, Movimentações, Motoboys, Pix, Dashboard financeiro, Auditoria, Risco, Regras |
| 4 | `9fe079f4` | Pedidos/Entregadores, Campanhas, Integrações, Equipe (cabeçalho fixo), Cardápio (coluna Item), Super Admin |
| ajuste | (este commit) | Resumo de Pedidos volta a aparecer no celular (abaixo das abas) |

## Peças (components/ui/topo-compacto.tsx, components/layout/caminho-topo.tsx)

- `TopBar secao={{ nome, ajuda }}` → "Financeiro › Contas e DRE (i)"; `TopBar aviso={…}` → faixa baixa entre o título e a
  impressora (no celular, faixa fina abaixo da barra; some sozinha quando não há aviso).
- `AvisoTopo` (amarelo da central do WhatsApp: #FEF3C7 / borda #FCD34D / faixa #F59E0B / texto #92400E) + `BOTAO_AVISO_TOPO`.
- `LinhaResumos` (números numa linha, separados por traço fino; um número pode ser filtro rápido), `SeletorSecao`
  (lista suspensa nativa), `BarraFiltros`, `Segmentado`, `CAMPO_FILTRO`, `FOCO_GUIA` (anel azul a 40%).
- Regras registradas em `docs/design/guia-visual-menuzia.md` §7. Teste: `components/ui/topo-compacto.test.tsx` (6).

## Antes → depois (medido no Playwright, em produção)

% = onde começa o conteúdo principal (cabeçalho da tabela / primeira linha da lista / quadro) ÷ altura da janela.
"Antes" = medição da etapa 1 (mesma loja, mesmo roteiro). Meta: ≤ 25% em 1366×768.

### Financeiro

| Tela | 1366×768 antes → depois | 1920×1080 antes → depois | Como ficou |
|---|---|---|---|
| Contas › A pagar | 59% → **22%** | 35% → **15%** | caminho + aviso no topo; pílulas + "A pagar ▾"; situação segmentada, busca, CSV, Nova conta |
| Contas › A receber | 68% → **22%** | 39% → **15%** | idem; o aviso "o que entra aqui" virou "i" |
| Contas › Compras | 41% → **16%** | 28% → **11%** | texto + Nova compra + seletor numa linha |
| Contas › DRE | 45% → **18%** | 30% → **11%** | período segmentado + datas + seletor numa linha; tabela com cabeçalho fixo |
| Contas › Categorias e fornecedores | ~35% → ~15% (cartões) | — | 1 linha (texto + seletor) |
| Precificação / CMV › Precificação | 68% → **22%** | 41% → **15%** | título duplo saiu; "Sem ficha" e "Margem baixa" são número e filtro; gráfico depois da tabela |
| CMV › Insumos | 50% → **16%** | 34% → **11%** | busca + Novo insumo + seletor numa linha |
| CMV › CMV das vendas | gráfico ~66% → números a ~9% | — | pílulas + período segmentado |
| CMV › Margens e preço | ~35% → ~15% (formulário) | — | 1 linha + formulário |
| Fluxo de Caixa | ~150% (abaixo da dobra) → **~22%** | ~95% → **~13%** | 6 totais numa linha; período em lista; Filtros (n), Gráfico e Colunas por botão |
| Dashboard financeiro | cartões a ~32% → **~15%** (gráfico 100% → 71%) | gráfico 62% → 40% | sem título duplo; período + Dia/Semana/Mês numa linha. Os cartões são o conteúdo principal |
| Auditoria e Alertas | 55% → **24%** | 33% → **17%** | números + Verificar integridade + seletor (Alertas / Acessos / Aprovações) |
| Risco por funcionário | 42% → **15%** | 26% → **11%** | período segmentado + "i"; tabela com cabeçalho fixo |
| Acerto de Motoboys | 39% → **17%** | 26% → **12%** | troco: segmentado Por pedido / Fundo fixo numa linha |
| Conferir Pix | 30% → **10%** | 19% → **7%** | só o caminho |
| Caixa | 1º conteúdo ~56% → ~12% | — | faixa do nível mais baixa; saldos e último fechamento numa linha; **Abrir/Fechar caixa continuam grandes** (≥ 36px, verde/azul) |
| Movimentações | ~30% → ~8% | — | só o caminho + cartão do caixa |
| Regras e limites | ~41% → ~12% (formulário) | — | o bloco de regras de PIN foi para o "i" |

### Resto do sistema

| Tela | 1366 antes → depois | 1920 antes → depois | Como ficou |
|---|---|---|---|
| Pedidos (finalizados) | ~53% → **~17%** | ~37% → **~12%** | aviso de pedido parado na barra do topo; resumo numa linha ao lado das abas; contagem no fim da barra de filtros |
| Pedidos › Entregadores | 38% → **15%** | 27% → **11%** | idem |
| Campanhas (Visão geral) | cartões ~27% → **~20%** (gráfico 62% → 55%) | gráfico 41% → 37% | caminho "Campanhas via WhatsApp › Visão geral"; Boas práticas e Disparar mensagem na barra do topo |
| Integrações | cartões ~30% → **~17%** | — | a faixa "Sentiu falta…" virou o botão Sugerir integração na barra |
| Equipe | 17% → 17% | 12% → 12% | cabeçalho fixo na tabela |
| Cardápio | 26% → 26% | 19% → 19% | coluna Item: o texto usa a largura toda e a descrição fica em até 2 linhas (antes quebrava palavra por palavra) |
| Super Admin | não medido (conta não é da plataforma) | — | os 6 números numa linha só |
| Dashboard, Kanban, PDV, Mesas, KDS, Clientes, Fidelidade, Impressão, Ajustes | iguais | iguais | não mexidos |

## Testes

- `tsc` sem erro; `eslint` sem aviso novo; **vitest 2845 passando** (277 arquivos).
- **Funções em produção** (`.medidas/compactar-topo-funcoes.mjs`, só leitura): **35 de 35** — caminho e aviso do PIN no
  topo; "Criar PIN" abre e fecha sem criar; seletor troca as 5 partes de Contas e as 4 do CMV; situação "Todas"; busca;
  pílulas "Sem ficha"/"Margem baixa" filtram; ordenação/status; CSV de Contas, CMV e Fluxo baixam; Filtros (n) abre,
  filtra pela URL e "Limpar filtros" limpa; período em lista; gráfico e Colunas; Auditoria troca Alertas/Acessos/
  Aprovações; botão do Caixa ≥ 36px; Pedidos, Campanhas e Integrações com o novo topo; **390px sem rolagem lateral**
  em 7 telas.
- Roteiros e2e locais do Financeiro atualizados para a lista suspensa e o botão de filtros (contas, fluxo, mesma-base,
  fase 1); não rodados aqui (precisam da stack local do Supabase/Docker).

## Observações

- **Erro já existente (não é do topo):** em Campanhas › Visão geral o React acusa "hydration #418" entre 21h e
  meia-noite: o período das métricas usa a data de hoje, e o servidor (UTC) já está no dia seguinte. Não corrigi
  (fora do escopo); conserto simples é calcular as datas só no navegador.
- Contas não tinha ordenação; não inventei uma (a linha 2 tem situação, busca, CSV e o botão principal).
- Prints antes/depois e medidas: `.shots/compactar-topo/{antes,depois,prod-bloco*,funcoes-390-*}` — fora do git
  (o repositório é público).
- O Chromium com janela travou por falta de memória na máquina (8 GB, ~1,3 GB livres); as medições finais rodaram sem
  janela (`HEADLESS=1`), com a sessão que o Felipe abriu.
