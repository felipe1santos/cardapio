# Robô e IA do WhatsApp: formatação, cardápio por categorias, "Peça também" (12/10/2026)

Publicado para **todas as lojas** (main b2cb9bc + correções c486617 e da781a9; migração **0193** aplicada).
Testes reais só na Menuzia, número de suporte; pedido de teste #312 fechado como **Não entregue**.
Impressão, Assistente e Villa: não mexidos.

## O que mudou

| Item | Como ficou |
|---|---|
| Formatação única (D38) | `lib/mensageria/formato.ts`: emoji da tabela fixa por palavra (sem IA), `*1x Nome*` em negrito, valores em crase (`` `R$ 12,00` ``), complemento grátis sem "(+R$ 0,00)". Usado no resumo da IA, no "Pedido aceito" e nas listas do robô. |
| Listas (D39) | Uma embaixo da outra; para escolher, numeradas (responde número ou nome). O servidor quebra listas que vierem em linha (fila e avisos). Perguntas continuam uma por vez. |
| Link do cardápio (D40/D41) | "Nosso pedido é feito *online*, no link abaixo 👇" + link. A imagem é a prévia do link, no máximo 1x a cada 30 min na conversa. Quem insiste em pedir por ali vai para a IA. |
| Cardápio por categorias sem IA (D42) | "não sei, o que tem?" → categorias numeradas → itens da categoria (nome + preço, até 15). Escolheu → a IA monta o pedido. Custo zero até a escolha. |
| Peça também (D43) | 1x por pedido, antes do resumo: bebida/acompanhamento mais vendidos (60 dias), disponíveis e fora do carrinho. "não" segue sem insistir. |
| Mensagem única no fim (D44) | Só o "Pedido recebido" automático, agora com o total. A IA não manda mais o "anotado" junto. |
| Nada inventado (D45) | Robô lista só o que está no banco; régua `citacoesForaDoCardapio` com teste automático. |

## Conversa real (Menuzia, 12/10, ~22h20)

> Cliente: **oi**
> Robô: 👋 Boa noite! … menu com 1/2/3 e link
>
> Cliente: **1**
> Robô: Nosso pedido é feito *online*, no link abaixo 👇 + link
>
> Cliente: **quero pedir por aqui**
> IA: Perfeito! O que você vai querer? Pode falar que eu anoto 😊
>
> Cliente: **não sei, o que tem?**
> Robô: Temos estas opções 👇 / 1. Gourmet / 2. Bebidas / 3. TESTE Tags / Responda o número ou o nome.
>
> Cliente: **1**
> Robô: *Gourmet* / 1. *Item 3* `R$ 1,00` / 2. *Item 5* `R$ 22,00` / 3. *Item 4* `R$ 12,00` / … / Qual você quer?
>
> Cliente: **3**
> IA: O *Item 4* está disponível por `R$ 12,00` (promoção, antes `R$ 22,00`). Ele não tem opções obrigatórias. Quer pedir quantas unidades?
>
> Cliente: **1, vou retirar**
> IA: Beleza! … Qual a forma de pagamento: / Pix / Dinheiro (com troco) / Cartão na entrega?
>
> Cliente: **dinheiro, não preciso de troco**
> IA (Peça também): Quer acompanhar? 😋 / 1. *heinetken* `R$ 33,00` / Responda o número ou *não* para seguir.
>
> Cliente: **não**
> IA: 🧾 Resumo do pedido / *1x Item 4* `R$ 12,00` / Subtotal / *Total:* `R$ 12,00` / 🏪 Retirada no balcão / 💳 Dinheiro / 👤 Felipe Teste / Responda *sim* para confirmar.
>
> Cliente: **sim**
> Automático: *📥 PEDIDO RECEBIDO!* … pedido `#312` … Total: `R$ 12,00` (uma mensagem só, sem "anotado" duplicado)
> Automático (aceite da loja): ✅ *Pedido `#312` aceito!* / *1x Item 4* `R$ 12,00` / *Total:* `R$ 12,00` / Dinheiro / Retirada

**Custo da IA na conversa inteira: US$ 0,0032 (≈ R$ 0,02)** — 5 respostas da IA; robô (categorias, itens, link) custo zero.

## Problemas achados no teste real e corrigidos na hora

1. "quero pedir por aqui" logo depois da opção 1 recebia o link de novo (a opção 1 não gravava o estado). Agora: última mensagem da loja = link há < 15 min → IA. (c486617, com teste)
2. Na lista de itens, "3" virou "Item 3" (a IA lia o número como parte do nome). Agora o servidor traduz para "Quero o *Item 4* (opção 3 da lista)". (da781a9, com teste)

## Observações

- Régua "nada inventado" nas 19 mensagens da hora: **nenhum item inventado**. Os únicos alertas foram falsos (títulos do robô, nome da loja, "entrega/retirada" em negrito).
- A pergunta de pagamento veio em lista sem número e citou "Cartão na entrega" numa retirada (texto das formas de pagamento da loja). Pequeno; fica para ajuste do prompt se o Felipe quiser.
- A Menuzia tem texto próprio de "recebido": o total é anexado no fim (`comTotalNoRecebido`). Lojas no texto padrão já recebem a linha `Total:`.
- "heinetken" sem emoji: o nome está escrito errado no cardápio da Menuzia; a tabela é por palavra (sem IA), então não reconhece.
- Testes: 2.471 (lib/app/components) + robô/IA 456 passando; `tsc` sem erro.

Decisões registradas em `docs/robo-whatsapp/autoatendimento-decisoes.md` (D38–D45).
