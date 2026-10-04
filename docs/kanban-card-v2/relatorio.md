# Kanban — card mínimo + painel lateral do pedido (2026-10-03)

A lógica dos pedidos não mudou. As telas **"Despacho de rotas"** e **Cozinha** não foram tocadas: o teste confere pelo
git que os arquivos delas, os mapas, `Badge` e `Button` estão iguais ao main.

## 1. Card mínimo (3 linhas)
- **Linha 1:** número, origem (PDV/Delivery/Salão), tempo ("3 horas") e tipo (RETIRADA/ENTREGA/MESA), sem fundo.
- **Linha 2:** cliente (+ telefone no PDV) à esquerda. À direita, o **ícone da forma** (Pix, dinheiro, cartão) e o
  **preço em verde negrito** (o mesmo verde do botão Pronto, conferido pelo teste).
  - O tooltip do ícone diz "Dinheiro · A receber na entrega · Troco p/ R$ 200,00". Mesa não tem ícone (paga no
    fechamento).
- **Linha 3:** só o botão de etapa, largura total, com a seta: Aceitar → / Pronto → / Entregue → / Saiu p/ entrega →.
  Na loja com Logística, a entrega pronta mostra "Na logística".
- **Saíram do card:**
  - lista de itens, linha separada de pagamento e "Ver";
  - o **✕ de recusar**: cancelar fica no painel;
  - o selo "Novo": a coluna laranja já diz isso, e ele quebrava a linha 1 com o painel aberto.
- Clicar em qualquer parte do card abre o painel (cursor de mão, realce no hover). O card aberto fica com borda azul e
  fundo levemente azulado. O botão de etapa só avança, sem abrir o painel. Enter/Espaço abrem pelo teclado.
- Altura: cerca de 100 px no desktop (antes ~150–190 px).

## 2. Painel lateral (`components/pedidos/painel-pedido.tsx`)
- **Sem overlay:**
  - o painel fica **ao lado** do quadro, e o quadro encolhe;
  - com o painel aberto, as colunas têm largura mínima e o quadro rola para o lado, sem nenhum card escondido atrás;
  - clicar em outro card troca o painel na hora.
- **Tempo real:** o painel acompanha o pedido nas listas. Se o pedido sai delas (cancelado), relê do banco e mostra
  "Pedido cancelado".
- **Fecha** pelo X, por Esc ou clicando de novo no card selecionado. **Celular:** tela cheia com "← Voltar".
- **Conteúdo, com letra maior** (itens 15 px, total 20 px):
  - **cabeçalho:** número, origem/tipo, cliente, "Feito às 21:06 · há 14 min", agendamento;
  - **linha do tempo horizontal:** feitas em verde, a atual em azul, as próximas em cinza, com o horário embaixo.
    Retirada e mesa sem "Em rota";
  - **itens:** quantidade, nome, tamanho/sabor/borda/massa, adicionais (com preço) e preço;
  - **observações** do item e do pedido com **fundo vermelho claro, texto vermelho e ícone de alerta**;
  - **totais:** subtotal, taxa de entrega, desconto e total, todos no verde do Pronto, com o total maior e em negrito;
  - **cliente e pagamento:**
    - nome, telefone clicável (`tel:`) com o selo "não verif." quando for o caso;
    - endereço com bairro, cidade, CEP e referência;
    - lançamento (senha/comanda/quem lançou);
    - forma com ícone, status (Pago / A pagar / A receber) e "Troco p/ R$ 200,00 · levar R$ 103,00";
    - "Alterar pagamento", com as regras de aprovação de antes;
    - em preparo/preparado por;
  - **entrega:** motoboy atribuído e status (aguardando saída / em rota / entregue).
- **Rodapé fixo:** Reimprimir pedido, "Concluir sem entregador" (quando cabe, como antes) e **Cancelar pedido** em
  vermelho escuro (`#991B1B`) com texto branco. O cancelar abre a mesma janela de motivo de antes. O rodapé deixa espaço
  para o botão flutuante de atendimento.
- Dados novos na consulta do pedido: horário de cada etapa (colunas da 0078) e nome do motoboy. Não precisou de
  migration.

## 3. Prints (`prints/`)
- **Antes:** `antes-desktop/tablet/celular.png` (card com itens e pagamento embaixo) e `antes-painel-*.png` (painel
  antigo, com fundo escuro bloqueando a tela).
- **Depois:** `depois-desktop/tablet/celular.png` e `depois-painel-*.png` (painel ao lado, linha do tempo,
  observações em vermelho, Cancelar vermelho-escuro).

## 4. Testes

`scripts/seguranca/e2e-kanban-card.mjs` (reescrita): **72/72** em desktop 1600, tablet 1024, celular 390 e tela cheia.
- **Card:**
  - 3 linhas em todas as colunas e tipos (vitrine, entrega, retirada, PDV, mesa);
  - ícone + tooltip de cada forma, com troco no tooltip; mesa sem ícone;
  - preço no verde do Pronto;
  - botão de etapa em largura total com seta;
  - cursor de mão; nome longo e valor alto sem vazar; card compacto;
  - Aceitar avança sem abrir o painel.
- **Painel:**
  - abre pelo card; card destacado;
  - sem overlay, com o quadro terminando antes do painel;
  - troca na hora ao clicar em outro card;
  - fecha pelo clique no selecionado, por Esc e pelo X;
  - celular em tela cheia com "← Voltar";
  - linha do tempo horizontal (entrega com 5 etapas, retirada com 4);
  - observações em vermelho; preços verdes; total maior; itens 15 px;
  - telefone `tel:`, endereço, troco "· levar"; Cancelar `rgb(153,27,27)` com texto branco;
  - **tempo real:** a etapa mudou para Pronto e o cancelamento apareceu no painel sem recarregar;
  - tela cheia com o painel aberto, sem rolagem lateral.
- **Despacho de rotas e Cozinha:** sem nenhuma diferença do main.

**Regressão:**

| Suíte | Resultado |
|---|---|
| responsivo-kanban / kanban-topo (topo, avisos e som) | 24/24 · 55/55 |
| cozinha-fase5 / agendamento | 26/26 · 25/25 |
| pdv-pagamento / pdv-atendimento / balcao-entrega | 57/57 · 97/97 · 84/84 |
| financeiro-fase3 (Logística/motoboy) / estabilidade / regressao-release | 106/106 · 53/53 · 52/52 |
| Vitest | 1953 ok |

Quatro suítes antigas abriam o painel pelo botão "Detalhes" ou liam a forma de pagamento no texto do card. Agora elas
clicam no card e leem o tooltip do ícone.

A regressão pegou uma perda real, já corrigida: o selo **"não verif."** do telefone tinha ficado de fora do painel
novo.

## Publicação (2026-10-03 ~21:45)
- Sem migration. main `9f42a03`, Redeploy no Coolify, build novo no ar às ~21:47.
- **Conferência na Menuzia**, perfil "Menuzia teste": loja "Angus Burguer" e usuário "Administrador" confirmados na
  tela antes de cada ação.
  - Pedido TESTE **#148** (PDV, retirada, dinheiro com troco para R$ 50, item com observação).
  - **Card:** 3 linhas. Tooltip do ícone "Dinheiro · A pagar na retirada · Troco p/ R$ 50,00". Preço R$ 18,00 em
    `rgb(16,185,129)`. Botão "Pronto" (o aceite automático da Menuzia já tinha avançado o pedido).
  - **Painel:** abriu pelo clique no card, sem overlay, com o card destacado. Linha do tempo com Recebido feito e
    Preparando atual. "Obs.: TESTE sem cebola" em vermelho. "Troco p/ R$ 50,00 · levar R$ 32,00". Cancelar
    `rgb(153,27,27)`. Esc fechou.
  - **#148 e a comanda cancelados** no fim.
- Esta conferência também cobre a etapa anterior (card limpo, `kanban-card`), que tinha ficado sem conferência logada.
- **Acompanhamento pós-deploy** (21:49–21:52, só leitura): a Villa Lanches recebeu o pedido #69 e ele foi aceito no
  painel novo (em preparo). Vitrines 200.
- Rollback não foi necessário.
