# Financeiro — Fase 3: Motoboy (app, pagamento na entrega, troco e acerto)

Data: 2026-10-03. Migration `0136_financeiro_motoboy`. O financeiro continua ligado **só na Menuzia** (flag
`restaurantes.financeiro_ativo`). As outras lojas mudam em uma coisa só, de segurança: o link do motoboy agora pode ser
revogado.

## O que mudou

### 1. Troco do motoboy (Logística)
- **Por pedido** (padrão).
  - Ao despachar um pedido em dinheiro com troco, a Logística mostra "Troco para levar", com o valor necessário já
    preenchido e **editável**.
  - "Registrar troco" tira o dinheiro da gaveta e coloca em "com o motoboy" no livro-caixa.
  - Clique repetido não duplica.
- **Fundo fixo** por turno.
  - Em Financeiro › Acerto, "Entregar fundo" passa o fundo para o motoboy.
  - No despacho, quando o troco necessário passa do que ele tem, aparece: "o motoboy tem cerca de R$ 50,00". O botão
    **Complementar troco** cobre a diferença.
- **Troca de modo:** vale na hora se nenhum motoboy tem dinheiro. Se algum tem, vale no próximo caixa aberto.
- **"Dinheiro com cada motoboy agora"** aparece no topo da Logística.
  - Só quem tem a permissão "ver valores do financeiro" vê o saldo.
  - Quem só opera vê o troco a entregar, mas não o saldo, porque o acerto é cego.

### 2. App do motoboy com login
- O login é criado na própria Logística ("Segurança do acesso" › Criar login do app), com papel `entregador` e cargo
  Motoboy.
- O motoboy entra pelo login normal e cai direto em `/motoboy`, um app instalável (manifest próprio). O painel fica
  fechado para ele.
- **Card do pedido:** número, cliente, telefone, endereço com bairro, valor, forma, observações e o troco em destaque
  ("Levar R$ 46,00 de troco").
- **Ações:** abrir a rota no Google Maps ou no Waze, "Saí para entrega", "Entregue", e "Não consegui entregar" com
  motivo.
- **"Dinheiro comigo"** e o **histórico do dia** vêm do livro-caixa.
- **Sem internet:** a ação fica numa fila no aparelho e é reenviada quando a conexão volta, com a mesma chave. O servidor
  não duplica.
- **Link/QR revogável:**
  - "Gerar link novo" faz o antigo parar na hora.
  - "Desativar" derruba o link e o login.
  - Bloquear ou pausar na Equipe também corta o app e o link.

### 3. Pagamento na entrega (app ou operador)
O registro é feito pela função `entrega_registrar`, no banco, numa transação só, idempotente. Ela grava a tabela
imutável `fin_entregas_pagamento`, o livro-caixa e o status do pedido.

| Forma | O que acontece |
|---|---|
| Dinheiro | Motoboy diz quanto recebeu. O **troco é calculado no servidor**. Recebido menor que o total é recusado. |
| Cartão | Valor do pedido (o enviado pelo app é ignorado) + NSU. Vai para a carteira Cartão. |
| Pix | Fica **a conferir**. O pedido não fica pago até alguém com a permissão "Conferir Pix" confirmar. |
| Não pagou | Motivo obrigatório. Vira **a receber**. |

### 4. Acerto cego (Financeiro › Acerto de Motoboys)
- Pode acertar por motoboy, só alguns pedidos dele, ou tudo de uma vez (no modo fundo, o acerto é um só).
- O operador conta primeiro. Só depois o sistema mostra o esperado e a diferença.
- **Diferença vira pendência do motoboy**, com alerta ao dono.
  - A pendência é quitada num novo acerto ou baixada **só pelo dono, com motivo**.
- O acerto entra no turno de quem acertou e exige caixa aberto.
- Motoboy com dinheiro aparece nas **pendências do fechamento** do caixa.
- Entrega feita com o caixa fechado fica "a acertar" com o motoboy, sem turno, até o próximo caixa.

### 5. Entrega sem motoboy e Nexta
- A mesma tela lista as entregas **sem registro**.
  - Sem motoboy em dinheiro: entra na gaveta.
  - Nexta: fica "a receber do Nexta" até o **repasse**, que leva o valor para a gaveta.

### 6. O que não mudou
- Lojas sem financeiro: o link do motoboy entrega como antes, sem perguntar a forma, e o "Fechamento de caixa" da
  Logística segue igual.
- Impressão, recibo e Assistente: nada mudou.

## Antifraude — tentativas testadas

| Tentativa | Resultado |
|---|---|
| Motoboy marca entregue o pedido de outro motoboy | 403 `pedido_de_outro` |
| Motoboy diz que saiu, ou que não conseguiu entregar, com pedido de outro | 404 / recusado; pedido segue em rota |
| Motoboy manda valor diferente (`totalCentavos: 1`) | Ignorado: grava o total do pedido |
| Motoboy informa recebido menor que o total | 409; nada gravado |
| Mesma requisição repetida (rede ruim, fila offline) | Idempotente: um registro, um lançamento |
| Trocar a forma depois de registrar (dinheiro → pix) | 409 `ja_registrado` |
| "Desmarcar" a entrega (não consegui, depois de entregue) | Recusado; pedido segue entregue |
| Motoboy confirma o próprio Pix | Bloqueado (fora do painel) |
| Atendente sem "Conferir Pix" confirma Pix | 403 |
| Motoboy altera o pedido direto no banco (RLS) | Nada alterado |
| Motoboy grava registro de pagamento / lê o livro-caixa / chama a função do banco | Negado |
| Alterar lançamento do livro-caixa | Negado (imutável) |
| Operador vê o esperado antes de contar | Não vê (API e tela cegas) |
| Gerente dá baixa em pendência | 403 (só o dono) |
| Dono dá baixa sem motivo | 400 |
| Acertar pedido que não está com o motoboy | 400 |
| Acerto com o caixa fechado | 409 `caixa_fechado` |
| Registrar a mesma entrega duas vezes (operador) | 409 |
| Link antigo depois de "link novo" / desativar | 404 |
| App aberto depois de desativar ou bloquear na Equipe | 401 (sessão cortada) |
| Motoboy bloqueado tenta entrar de novo | Não entra |
| Motoboy abre o painel ou a API do painel | Bloqueado |
| Operador troca o modo do troco | 403 (gerente/dono) |
| Loja vizinha ou sem flag usa o acerto do financeiro | 404 |

## Testes

| Suíte | Resultado |
|---|---|
| `e2e-financeiro-fase3.mjs` (nova) | **99/99** |
| `e2e-financeiro-integrado.mjs` (migrada para o acerto novo) | 52/52 |
| `e2e-pdv-pagamento.mjs` (migrada; espera da mensagem de troco) | 57/57 |
| Vitest (unitários) | 1930 ok |
| Rollback 0136 (desfazer + reaplicar no banco local) | ok |
| Regressão | ver abaixo |

Cobertura da suíte nova:
- troco por pedido (valor editado, repetido);
- fundo fixo (aviso, complemento, troca de modo imediata e no próximo caixa);
- login, com o app em Android (Pixel 7) e iPhone (13) emulados;
- só as próprias entregas;
- cada forma de pagamento; Pix a conferir e confirmação; não pago;
- não consegui entregar; offline e reenvio;
- acerto que bate, que falta e que sobra; pendência no fechamento; baixa pelo dono; acerto parcial;
- a acertar com o caixa fechado;
- link revogado (link novo, desativar, Equipe);
- entrega sem motoboy e Nexta com repasse;
- fraudes; auditoria; integridade da cadeia de hash;
- loja sem financeiro igual.

### Regressão (build local com o código final)

| Suíte | Resultado |
|---|---|
| financeiro-fase1 / fase2 | 66/66 · 55/55 |
| caixa-turnos / caixa-e-regras | 18/18 · 34/34 |
| balcao-entrega / pdv-v2 | 84/84 · 70/70 |
| cozinha-fase5 / impressao-v2 | 26/26 · 40/40 |
| equipe-repaginada / equipe-acessos | 75/75 · 27/27 |
| robo-whatsapp | 106/106 |

Duas suítes falharam por dados das lojas de teste locais, em telas que esta fase não mexe (vitrine e checkout não
foram alterados):
- `regressao-release`: um modal da vitrine cobre o clique;
- `pedido-idempotente`: a loja padrão não tem o item "Coca Lata".

**Bug achado pela regressão e corrigido antes do commit:** a checagem "login desativado" do app lia uma coluna que não
existe (`usuarios.ativo`). O certo é `desativado_em`. Com o erro, o app recusava todo motoboy. A suíte da fase 3 rodou
de novo, 99/99.

## Prints
Ficam em `prints-fase3/`:
- 01: Logística — troco para levar;
- 02 a 04: app Android (card, pagamento em dinheiro, histórico);
- 05: Conferir Pix;
- 06 e 07: app iPhone, com e sem internet;
- 08 a 10: acerto cego (lista, contagem e resultado);
- 11: fundo e complementar;
- 12: sem registro / Nexta;
- 13: painel da Logística.

## Rollback
- O rollback é `docs/rollback/0136_financeiro_motoboy.down.sql`.
- Ele remove a função, a tabela de registros de entrega e as colunas novas, e restaura o gatilho da 0135.
- Os lançamentos do livro-caixa ficam: são imutáveis.
- Se for preciso, reverter o código para o main anterior (5289dc5) e redeploy.

## Publicação (2026-10-03)
- **01:45** — 0136 aplicada em produção pelo `aplicar-migration-producao.mjs`: dry-run ok, aplicada e conferida.
  - Backup em `~/backups/menuzia/2026-10-03-pre-0136`.
  - A migration só adiciona: o código antigo seguia funcionando com ela.
- **01:47** — main `40c3744` publicado. Redeploy pelo Coolify, no ar às ~01:55.
- **Conferência em produção:**
  - Banco (só leitura): financeiro ligado só na Menuzia, `troco_modo = pedido`; nenhuma loja com mudança de dados.
  - Sem login: `/motoboy` 200, `/api/motoboy` 401, manifest 200, link inválido 404, APIs do acerto e do Pix 401,
    `sw-motoboy.js` servido.
  - **No navegador, PAREI:** a sessão aberta no Chrome era de outra loja (5 entregadores, a Ponto 400), não da Menuzia.
    Só li a tela, sem nenhum clique ou gravação. Ela confirma que uma loja sem financeiro continua sem o bloco novo na
    Logística.
  - A conferência logada na Menuzia fica para quando houver o perfil do Chrome separado, só com a Menuzia
    (admin/admin).
- Rollback não foi necessário.

## Conferência logada em produção — Menuzia (2026-10-03 ~13:55)
Feita no perfil do Chrome "Menuzia teste". Antes de cada ação conferi a loja (`menuzia`, exibida como "Angus Burguer",
única com o financeiro) e o usuário (Administrador, dono). A impressão foi autorizada: saiu 1 comanda TESTE.

| Passo | Resultado |
|---|---|
| Abrir caixa (fundo R$ 100) | ok |
| Criar "TESTE Motoboy Fase3" pela Logística; "Segurança do acesso" aparece | ok |
| "Gerar link novo": link antigo 200 → 404 na hora | ok |
| Pedido TESTE #145 (PDV balcão → entrega, dinheiro, troco p/ R$ 50) → pronto → atribuído | ok |
| Logística: "Troco para levar R$ 41,00", campo pré-preenchido; "Registrar troco" | ok — motoboy com R$ 41 |
| App (link): loja certa, "Dinheiro comigo R$ 41,00", troco em destaque, Maps/Waze | ok |
| Saí → Entregue → dinheiro, recebi R$ 50 → "Dar de troco R$ 41,00" | ok — entregue, pago, troco calculado no servidor |
| Livro-caixa: gaveta −41 / motoboy +41 / +50 / −41 | ok |
| Acerto cego R$ 50 (esperado só depois de contar) | **bateu** |
| Desativar: link 404, app "Link inválido", selo "Desativado" | ok |
| Fechar caixa contando R$ 109 | ok, diferença 0 |

Não foi criado login com senha em produção (regra de segurança). O app com login foi testado no ambiente local; em
produção, `/motoboy` com a conta do dono responde "não está ligado a um entregador", como esperado.

**Achados (para corrigir):**
1. **Comanda do PDV não quita na entrega.** Pedido de balcão → entrega pago ao motoboy fica com o pedido pago e o
   dinheiro no livro-caixa, mas a comanda segue "aberta" com o total a receber (comanda TESTE #145, R$ 9,00, deixada
   aberta de propósito). Pedidos da vitrine não têm comanda e não são afetados. Correção: `entrega_registrar` também
   quitar a comanda, sem lançar de novo no livro-caixa (migration 0137).
2. **Visual:** no extrato do turno, a carteira "motoboy" aparece −R$ 9, porque o recebimento do motoboy não tem turno; o
   saldo real dele é 0.
3. **Texto:** `/motoboy` sem entregador ligado mostra o título "Link inválido"; o certo seria "Acesso não liberado".
