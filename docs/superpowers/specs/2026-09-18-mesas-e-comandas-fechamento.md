# Mesas e Comandas — fechamento da release candidate

Complementa `2026-09-18-mesas-e-comandas-release-candidate.md`. Aquele documento fechou
as etapas A–G; este registra **o que a auditoria final achou faltando** contra os 22
requisitos do módulo e como cada lacuna foi fechada, com o porquê.

Branch: `feature/mesas-e-comandas`. Migrations novas: **0071, 0072** (só locais).

---

## 1. O que a auditoria achou

| # | Lacuna | Gravidade | Onde ficou |
|---|---|---|---|
| 1 | A feature flag só escondia o **menu**. `/admin/mesas` e `/api/admin/mesas/*` rodavam com ela desligada. | bloqueante | middleware + `contextoSalao` |
| 2 | Nenhuma tela para o dono **ligar o módulo**: era `update` no banco. | alta | Ajustes › Mesas |
| 3 | O **atendente/caixa** não entrava no salão: pagamento, divisão e fechamento eram do garçom. | alta | permissões + 0071 |
| 4 | Regras "conforme permitido" (garçom recebe? transfere? caixa dá desconto?) não existiam. | alta | 0071 + Conta e pagamentos |
| 5 | O garçom não tinha como **pedir** cancelamento de item já enviado. | alta | 0072 |
| 6 | Desconto só em **reais**. | alta | 0072 |
| 7 | Transferência de mesa e de itens **sem motivo**. | alta | 0072 |
| 8 | `restaurantes` aceitava UPDATE do navegador em todas as colunas: o atendente ligava o módulo ou mudava a taxa pelo console. | alta (segurança) | 0071 |
| 9 | O **token do QR** saía para qualquer papel que lê `mesas` (o garçom incluso), na resposta do PDV e no HTML do salão, e podia ser **escolhido** por quem inseria a mesa. | alta (segurança) | 0071 + rota do QR |
| 10 | Não havia "**revogar** QR" sem gerar outro. | média | 0071 |
| 11 | Cancelar item/lançamento ou dar desconto podia deixar o **pago maior que o total**. | alta | 0072 |
| 12 | O corpo do **lançamento** ia para `criarPedido` sem allowlist. | média (segurança) | `sanearItensLancamento` |
| 13 | Auditoria sem **papel** do ator e sem **correlação**; transferências sem nome de mesa. | média | 0071 |
| 14 | Cozinha sem o **número da comanda**. | média | 0072 + `PEDIDO_SELECT` |
| 15 | Fiado sem dizer **de quem** é a conta. | média | 0072 |
| 16 | Excluir mesa apagava em cascata a comanda sem pedido; pausar pela tela antiga ignorava conta aberta. | média | 0071 |
| 17 | Salão sem filtro por setor. | baixa | salão |

Nada disso estava coberto pelas provas anteriores porque as provas testavam o que
existia. As suítes foram estendidas para cada item acima.

---

## 2. Decisões

### 2.1 A flag vale no servidor, e falha fechada

O middleware consulta `auth_modulo_mesas()` **só quando a decisão envolve o salão** (rota
do módulo ou redirecionamento para ele), para não pagar uma consulta por requisição do
painel. Desligado: API do módulo responde **404** (para quem está de fora o módulo não
existe) e a página manda para a tela inicial do papel. `telaInicialDoPapel` ignora o
salão quando o módulo está desligado — senão o garçom entraria num laço de
redirecionamento.

Toda rota do salão entra por `contextoSalao(permissao)`, que relê do banco sessão,
flag e regras. Um teste varre as rotas e reprova a que não passar por ele.

Aqui a falha é **fechada**: se a leitura da flag der erro, o módulo não existe. É o
contrário do papel no middleware (que deixa passar num soluço, porque a RLS ainda
barra o dado): abrir o módulo numa loja que não o contratou é pior do que o dono perder
o salão por alguns segundos.

### 2.2 Ligar o módulo é do dono, e desligar com conta aberta é recusado

`/api/admin/modulos/mesas` fica **fora** de `/api/admin/mesas` de propósito: aquele
prefixo responde 404 com o módulo desligado, e é justamente desligado que o dono precisa
ligá-lo. Exige `ajustes.editar` (só o dono). Desligar com **conta de mesa aberta** é 409:
a conta ficaria pendurada numa tela que some, com dinheiro a receber.

### 2.3 O caixa entra no salão para cobrar — e só para isso

Nova permissão **`comanda.ver`** (dono, gerente, garçom, atendente) abre o salão e a
conta. O caixa **recebe e fecha** (`comanda.fechar`); **não lança, não atende chamado,
não assume a mesa, não pede cancelamento, não lê o token do QR**. A mesa abre direto na
aba Conta para ele.

A RLS acompanha: `atendente` passa a **ler** mesas, comandas, pagamentos e pedidos de
mesa. Escrita continua só pelas rotas (service_role).

### 2.4 Regras por loja, com os defaults da matriz

Três células da matriz a loja escolhe (`podeNoSalao`):

| Regra | Default | Efeito |
|---|---|---|
| `salao_garcom_recebe` | **não** | garçom registra pagamento e fecha a conta |
| `salao_garcom_transfere` | **sim** | garçom transfere mesa e itens (sempre com motivo) |
| `salao_caixa_desconto` | **não** | caixa ajusta taxa e desconto (sempre com motivo) |

**Por que o garçom não recebe por padrão:** a matriz oficial do módulo põe pagamento
com o caixa. A loja pequena, em que o garçom passa a maquininha, liga a regra. Estorno
e fiado **não** entram em regra nenhuma: são decisões da gestão.

**Só o dono altera as regras.** Elas decidem o que gerente, garçom e caixa podem fazer
com dinheiro; não ficam com quem elas mesmas regulam. Taxa padrão e formas continuam com
quem gerencia mesas.

### 2.5 Pedido de cancelamento, não cancelamento

O garçom não cancela o que já foi para a cozinha (mexe em conta e estoque), mas agora
tem um caminho: **pede**, com motivo; a gestão **aprova** (o item cai pelo mesmo
`item_cancelar`, com "pedido por <garçom>" no motivo) ou **recusa**. Um pendente por
alvo (índice único parcial); pedir de novo devolve o mesmo.

**A conta não fecha com pedido pendente** (`cancelamento_pendente`): fechar cobraria (ou
não) um item cuja sorte ninguém decidiu.

Alvo cancelado por **outro caminho** (gestão direto, Kanban, conta cancelada) resolve o
pedido pendente por trigger — senão ele travaria o fechamento para sempre.

### 2.6 Desconto percentual acompanha a conta

`desconto_tipo` ('valor' | 'percentual'). O percentual incide sobre o **consumo** e é
recalculado em `comanda_totais()`: cancelou um item, o desconto recalcula. A taxa de
serviço continua sobre o consumo cheio. Comanda existente nasce `'valor'` — nada muda.

**Só mexer na taxa** ("cliente recusou a taxa") mantém o desconto e o motivo que já
estavam. A primeira versão exigia o motivo de novo e o teste de banco pegou.

### 2.7 O pago nunca passa do total

`comanda_conferir_pago()` roda depois de cancelar item, cancelar lançamento, ajustar
valores, juntar contas e transferir itens para fora de uma conta que já recebeu. Se o
pago passar do novo total, a transação inteira desfaz e a tela diz: estorne antes. O
aviso de "pago a mais" da tela continua, mas agora só aparece em dado anterior à 0072.

O cancelamento de **lançamento inteiro** saiu do `update` solto da rota e virou função
(`pedido_mesa_cancelar`), com trava da comanda.

### 2.8 Token do QR fora do navegador

Grant por coluna em `mesas`: `authenticated` lê tudo menos `token`, insere e atualiza só
nome/ordem/ativa/setor/capacidade. O token sai por `/api/admin/mesas/qr` (gestão, sem
cache) e a rotação não o devolve na resposta. `Mesa` (o tipo) deixou de carregar o
token — ele vazava também na resposta do PDV.

Revogar sem substituto troca o token por um valor que ninguém conhece e marca
`qr_revogado_em`; o salão mostra "QR revogado — gere um novo" e a folha A4 pula a mesa.

### 2.9 Colunas do salão em `restaurantes`

A policy de UPDATE em `restaurantes` (dono, gerente, atendente) é da loja inteira e o
grant é de tabela. Revogar por coluna exigiria listar as ~70 colunas e quebraria toda
coluna nova no futuro. Em vez disso, um **trigger** recusa mudança em
`modulo_mesas_ativo`, `taxa_servico_padrao`, `formas_pagamento_mesa` e nas regras quando
quem escreve é o JWT de usuário (`auth.role()`); rotas (service_role) e conexões de
operação passam. Nenhuma tela escrevia essas colunas pelo navegador.

### 2.10 Auditoria com papel e correlação, preenchidos no banco

`eventos_auditoria.papel` (o papel **no momento** do evento) e `correlacao`. Um trigger
preenche os dois, inclusive para eventos gravados por função SQL: o papel sai de
`usuarios`; a correlação, do cabeçalho `x-correlacao` que `getAdminSupabase({ correlacao })`
manda ao PostgREST. Cabeçalho malformado nunca derruba a operação auditada.

Eventos novos: `conta.alterou_taxa`, `conta.removeu_taxa`, `conta.desconto`,
`conta.solicitou_cancelamento`, `conta.aprovou_cancelamento`,
`conta.recusou_cancelamento`, `mesa.revogou_qr`, `mesas.ligou_modulo`,
`mesas.desligou_modulo`. O fechamento registra como a taxa terminou (aceita, removida,
alterada) e transferências gravam os nomes das mesas e o motivo.

### 2.11 Número da comanda

Sequencial por loja, gerado por trigger com contador em `restaurantes.comanda_seq`
(UPDATE trava a linha da loja: duas comandas simultâneas nunca recebem o mesmo número).
Comanda antiga fica sem número. Aparece na conta, no salão, no Kanban e na cozinha
("Salão · Mesa 4 · Comanda 12"). **O recibo não mudou** (CLAUDE.md §7).

---

## 3. Matriz de permissões final

| Permissão | dono | gerente | garçom | atendente (caixa) | cozinha | logística |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| ver salão e conta (`comanda.ver`) | ✅ | ✅ | ✅ | ✅ | — | — |
| atender chamado, reimprimir (`mesas.operar`) | ✅ | ✅ | ✅ | — | — | — |
| lançar e enviar à cozinha | ✅ | ✅ | ✅ | — | — | — |
| mesas e QR (`mesas.gerenciar`) | ✅ | ✅ | — | — | — | — |
| receber e fechar (`comanda.fechar`) | ✅ | ✅ | regra | ✅ | — | — |
| transferir (`comanda.transferir`) | ✅ | ✅ | regra (sim) | — | — | — |
| taxa e desconto (`comanda.desconto`) | ✅ | ✅ | — | regra | — | — |
| estornar (`comanda.estornar`) | ✅ | ✅ | — | — | — | — |
| fiado (`comanda.fiado`) | ✅ | ✅ | — | — | — | — |
| cancelar item/lançamento/conta | ✅ | ✅ | — | — | — | — |
| pedir cancelamento | ✅ | ✅ | ✅ | — | — | — |
| regras do salão, ligar módulo (`ajustes.editar`) | ✅ | — | — | — | — | — |
| auditoria (`auditoria.ver`) | ✅ | ✅ | — | — | — | — |
| equipe (`equipe.gerenciar`) | ✅ | ✅ | — | — | — | — |

---

## 4. Riscos de deploy que a 0071 cria (e por que são aceitáveis)

- **Mesa com conta aberta não é mais pausada** pela aba antiga de Ajustes, nem **mesa com
  histórico é excluída**. As duas coisas eram perda de dado silenciosa; a tela agora
  explica o motivo.
- O **trigger de `restaurantes`** barra a escrita dessas colunas pelo navegador. Nenhum
  caminho de produção escrevia nelas pelo navegador (conferido no código).
- O **`PEDIDO_SELECT`** passa a embutir `comandas(numero)`: o código novo exige a 0072
  aplicada antes do deploy — a mesma ordem que 0058/0059 já exigem (§1 da operação).
