# Financeiro — mensagens para os lojistas (WhatsApp)

## Mensagem única (10/10/2026) — mandar para todas as lojas

> **O Financeiro chegou:** abra o menu **Financeiro**, crie seu **PIN**, siga o **passo a passo** e veja o **guia no ícone i**.

O nível 1 (financeiro ligado, caixa automático) está LIGADO nas 9 lojas desde 09/10 19:39: PDV, mesa e delivery vendem
como antes, sem abrir caixa. O nível 2 (controle de caixa) é o dono que liga, pelo passo a passo, quando a loja estiver pronta.

### Pendências de cada loja para o nível 2 (checklist de 10/10 ~14h, só leitura)

| Loja | Nível 1 | Dono/gerente com PIN | Pendências para o nível 2 |
|---|---|---|---|
| DB Doces | ligado | não | criar o PIN |
| Estância Burger | ligado | não | criar o PIN; fechar/cancelar a conta #36 (Juninho, R$ 61,60, desde 09/10) |
| Mama Pizza | ligado | não | criar o PIN |
| Menuzia (teste) | ligado + **nível 2** | sim (gerentes de teste) | contas de teste abertas (#110–#118) |
| Nossa Cozinha | ligado | não | criar o PIN |
| Pizza do Rosa | ligado | não | criar o PIN |
| Ponto 400 | ligado | não | criar o PIN; fechar/cancelar a conta #7 (Girlene Pereira, R$ 33,00, desde 06/10) |
| Villa Lanches | ligado | não | criar o PIN (impressão da Villa: não mexer) |
| W Lanches Reviver | ligado | não | criar o PIN |

O caixa automático de ontem da Estância, Ponto 400 e Villa fecha sozinho na virada do dia (05:00), na próxima venda.
Custo dos 15 mais vendidos: opcional, no passo ⑤ (Financeiro › Precificação / CMV).

---

## Histórico (09/10/2026)

Raio-x de 09/10/2026 (`node scripts/financeiro-flag.mjs <loja> --checklist`, só leitura). Nenhuma loja real
está pronta: falta, em todas, um **gerente com PIN** além do dono; Estância, Ponto 400 e Villa têm também uma
conta antiga aberta. Mande a mensagem da loja e, quando o lojista disser que fez, rode o checklist de novo.

> "Criar meu PIN" passou a aparecer no menu mesmo com o financeiro desligado (publicado em 09/10, commit
> ee2e04e). Antes disso o lojista não tinha como criar o PIN.

---

## Trecho para colar no fim de cada mensagem (guia de 1 página)

> **Como vai funcionar o caixa no Menuzia (resumo)**
> • **Abrir o caixa:** no começo do turno, conte o troco da gaveta e abra em Financeiro › Caixa.
> • **Vender:** igual a hoje. No balcão, escolha a forma de pagamento antes de lançar.
> • **Sangria:** Financeiro › Caixa › Sangria. Não dá para tirar mais do que tem na gaveta. Acima de R$ 100, o gerente aprova com o PIN dele.
> • **Fechar o caixa:** acerte os motoboys, depois conte o dinheiro e a maquininha. O sistema não mostra quanto deveria ter antes de você contar.
> • **PIN de outra pessoa** é pedido para: estornar pagamento, cancelar o que já foi para a cozinha, sangria/despesa acima do limite e fechar com diferença acima de R$ 5. Quem pede nunca aprova.
> • **Deu diferença?** Explique o motivo. O dono recebe o aviso.

---

## Estância Burger

> Oi! Para ligarmos o **controle de caixa** do Menuzia na Estância Burger faltam 2 coisas:
> 1. **Um gerente com PIN.** No painel, vá em **Equipe › Adicionar usuário**, cadastre a pessoa com o cargo **Gerente** e passe o login para ela. Ela entra no painel, toca no nome dela no canto de cima e escolhe **Criar meu PIN** (6 números, só ela sabe). É esse PIN que aprova estornos, cancelamentos e sangrias.
> 2. **Fechar a conta antiga do balcão #31 (R$ 125,50, aberta desde 04/10).** Abra o PDV, entre na conta #31 e feche (se foi paga) ou cancele (se não vai ser paga).
> Depois que ligarmos, no 1º dia vale cadastrar o custo dos lanches mais vendidos em **Financeiro › Precificação/CMV**: Clássico, Hambúrguer, Fritas individual, Crispy, Cheddar Bacon, Egg Burger, Cheddar Bacon 2.0, Chicken Bacon, X Tudo, Pork, Combo Família, DUO Especial, Kids, Combo Clássico e X Burguer. É isso que mostra quanto sobra de cada venda.
> *(colar o trecho do guia)*

## Ponto 400 Hamburgueria

> Oi! Para ligarmos o **controle de caixa** do Menuzia na Ponto 400 faltam 2 coisas:
> 1. **Um gerente com PIN.** No painel, **Equipe › Adicionar usuário**, cargo **Gerente**. A pessoa entra com o login dela, toca no nome no canto de cima e escolhe **Criar meu PIN** (6 números).
> 2. **Fechar a conta antiga do balcão #7 (Girlene Pereira, R$ 33,00, aberta desde 06/10).** No PDV, entre na conta #7 e feche ou cancele.
> No 1º dia depois de ligar: cadastrar o custo em **Financeiro › Precificação/CMV** dos mais vendidos: X - TUDO, HAMBURGUER, X - BACON, X - PODRÃO, COMBO CASAL, BURGUER SIMPLES, BURGUER CHEDDAR, X - FRANGO, PICANHA BRUTO, IATE GUARANÁ 2L, X - EGG BACON, X - BURGUER, COMBO TRIPLO, COCA-COLA 2L e COCA-COLA LATA.
> *(colar o trecho do guia)*

## Villalanches Gourmet

> Oi! Para ligarmos o **controle de caixa** do Menuzia na Villa faltam 2 coisas:
> 1. **Um gerente com PIN.** Hoje a equipe tem o dono, 1 atendente e 2 garçons — nenhum gerente. No painel, **Equipe**: crie um usuário com o cargo **Gerente** (ou mude o cargo de quem vai cuidar do caixa). A pessoa entra, toca no nome no canto de cima e escolhe **Criar meu PIN** (6 números).
> 2. **Fechar a conta antiga do balcão #62 (R$ 0,00, aberta desde 07/10).** No PDV, entre na conta #62 e cancele.
> No 1º dia depois de ligar: cadastrar o custo em **Financeiro › Precificação/CMV** dos mais vendidos: Guaravita 200ml, Pastel de Carne Moída, Pastel de Queijo, Pastel de Calabresa com Queijo, Doces Diversos 3$, Pastel de Carne Moída com Catupiry, Pastel Sabor Pizza, Diversos 1$, Pastel de Morango com Nutella, Batata Frita Tradicional, Pastel de Frango com Catupiry, Pastel Nordestino, Pastel de Camarão com Catupiry e Pastel de Frango. (Tem também um "PRODUTO TESTE" entre os mais vendidos — vale conferir se ele deve continuar no cardápio.)
> *(colar o trecho do guia)*

## Pizza do Rosa

> Oi! Para ligarmos o **controle de caixa** do Menuzia na Pizza do Rosa falta só **um gerente com PIN**: no painel, **Equipe › Adicionar usuário**, cargo **Gerente**. A pessoa entra com o login dela, toca no nome no canto de cima e escolhe **Criar meu PIN** (6 números, só ela sabe). O PIN aprova estornos, cancelamentos e sangrias. Depois de ligar, no 1º dia, cadastre o custo das pizzas mais vendidas em **Financeiro › Precificação/CMV**.
> *(colar o trecho do guia)*

## Mama Pizza · Golden Burger · Nossa Cozinha · W Lanches Reviver · DB Doces

(Mesma mensagem para cada uma — todas sem vendas nos últimos 30 dias e só falta o gerente.)

> Oi! Para ligarmos o **controle de caixa** do Menuzia na sua loja falta só **um gerente com PIN**: no painel, **Equipe › Adicionar usuário**, cargo **Gerente**. A pessoa entra com o login dela, toca no nome no canto de cima e escolhe **Criar meu PIN** (6 números, só ela sabe). Quando começarem as vendas, cadastre o custo dos itens mais vendidos em **Financeiro › Precificação/CMV**.
> *(colar o trecho do guia)*

---

Lojas fora da lista: **Menuzia** (loja de teste, financeiro já ligado) e **teste** (loja interna).
Guia completo para a equipe: `docs/financeiro/piloto-ponto400.md`, seção 3.

---

## Mensagem única — Financeiro ligado (nível 1) — PODE ENVIAR

> Status em 09/10, 19:39: o Financeiro foi **ligado no nível 1** em todas as lojas reais (Estância, Ponto 400, Villa, Pizza do
> Rosa, Mama Pizza, Nossa Cozinha, DB Doces, W Lanches, Jhonatan), com a 0167 aplicada às 19:18. PDV, mesa e delivery vendem
> sem abrir caixa (caixa automático do dia). Nenhuma loja está no nível 2 (controle de caixa): quem liga é o dono, no
> passo a passo de Financeiro › Caixa. A Menuzia (teste) segue no nível 2.

> Oi! O **Financeiro** chegou no seu Menuzia. 🎉
> 1. Abra o menu **Financeiro** no painel.
> 2. Crie seu **PIN de aprovação** (4 a 6 números) — aparece logo no topo. Como dono, você vale como gerente.
> 3. Siga o **passo a passo "Ativar controle de caixa"** quando quiser começar a abrir e fechar o caixa.
> 4. Dúvidas? Toque no ícone **i** ao lado do título de cada tela: abre o guia, com tudo explicado.
> Até você ativar o controle de caixa, o PDV, as mesas e o delivery continuam funcionando exatamente como hoje.

**O que vai aparecer pendente no passo a passo de cada loja (raio-x de 09/10):**
- Estância Burger: conta #31 (R$ 125,50, desde 04/10); PIN do dono.
- Ponto 400: conta #7 (R$ 33,00, desde 06/10); PIN do dono.
- Villalanches: conta #62 (R$ 0,00, desde 07/10); PIN do dono.
- Pizza do Rosa, Mama Pizza, Golden Burger, Nossa Cozinha, W Lanches Reviver, DB Doces: só o PIN do dono.
