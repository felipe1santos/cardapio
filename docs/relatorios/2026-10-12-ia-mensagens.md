# IA do WhatsApp: mensagens organizadas, uma pergunta por vez + 3 bugs do teste (12/10/2026, noite)

Publicado para **todas as lojas** (main 34d534f + correções do teste real defa879, f8a47dc, 8eb3369; migração **0194**
aplicada: coluna `whatsapp_conversas.ia_rascunho`). Teste real só na Menuzia; pedido #313 fechado como **Não entregue**.
Impressão, Assistente e Villa: não mexidos. Decisões D46–D51 em `docs/robo-whatsapp/autoatendimento-decisoes.md`.

## Causa dos bugs (conversa do Felipe, 19:36–19:38)

| Bug | Causa | Correção |
|---|---|---|
| "1 234" virou 3 adicionais | Quem lia a resposta era a IA, e ninguém conferia o mínimo antes do resumo. | O **servidor** guarda o pedido em andamento e entende "1 234", "1,2,3,4", "1234", "todos", "os 4" e nomes. Confere o mínimo e o máximo do grupo: "Faltou escolher mais 1 😉". |
| Duas mensagens → duas respostas | Cada mensagem chamava a IA na hora. | Na rota da IA, o motor espera 4 s. Chegou outra mensagem depois: só a última responde (vendo as duas). |
| "Fica quanto?" sem resposta | A IA não tinha o valor parcial (só o resumo final calcula). | O servidor calcula o valor parcial (itens + complementos, sem taxa), responde e repete a pergunta pendente. |

## Como ficou o fluxo

O servidor pergunta o que falta, **uma coisa por mensagem**, nesta ordem: obrigatórios → extras pagos → entrega ou
retirada → endereço → pagamento → troco → (Peça também) → resumo → "sim". Os textos das perguntas são do servidor, no
formato pedido (nome em negrito, escolhas e valores em cinza, emoji da tabela, sem número na frente). Respostas
simples não gastam IA. A IA entra para endereço, mudanças e dúvidas e anota pelo `montar_pedido` (parcial). Se a IA
juntar duas perguntas, o servidor corta a segunda. Se a IA listar os adicionais sozinha, o servidor assume a pergunta.

## Conversa real (Menuzia, 12/10, 23:28–23:35)

> **oi** → Robô: menu com link
> **me manda o link do cardápio** → Robô: Nosso pedido é feito *online*, no link abaixo 👇 + link
> **quero pedir por aqui, um açaí grandão** → *Acai grandao* `R$ 32,00` 🍇 / Escolha 4 opções de adicionais (obrigatório): / 🍌 Banana / 🥛 Leite em po / 🥛 Leite ninho / 🥣 Sucrilhos / _Pode responder com os nomes._
> **1 2 3** → Faltou escolher mais 1 😉 / 🥣 Sucrilhos
> **sucrilhos** → Anotado ✍️: *Acai grandao* com `Banana` `Leite em po` `Leite ninho` `Sucrilhos`
> (outra mensagem) Quer adicionar frutas? (`+R$ 2,00` cada, até 3) / 🍌 Banana / 🍎 Maca / 🍐 Pera / 🍇 Uva / 🍋 Limao / Paimito / _Se não quiser, é só dizer "nenhuma"._
> **uva** → Anotado ✍️: *Acai grandao* com … `Uva` / Agora, vai ser `Entrega` ou `Retirada no balcão`?
> **fica quanto?** → Até agora fica `R$ 34,00` (sem a taxa de entrega). / Agora, vai ser `Entrega` ou `Retirada no balcão`?
> **Vou querer entrega** + **Rua Sete, 100, Jaburuna** (seguidas) → UMA resposta: "Show, endereço anotado! …" + Como prefere pagar? / 💠 Pix / 💵 Dinheiro / 💳 Cartão na entrega
> **pix** → Quer acompanhar? 😋 / *heinetken* `R$ 33,00` / _Se não quiser, é só dizer "não"._
> **prefiro pagar na entrega** → Beleza! Na entrega, é em dinheiro ou cartão?
> **cartão** → 🧾 Resumo: 🍇 *1x Acai grandao* `R$ 34,00` (Banana, Leite em po, Leite ninho, Sucrilhos, 🍇 Uva `+R$ 2,00`) · Entrega `R$ 3,00` · *Total:* `R$ 37,00` · Cartão na entrega
> **sim** → *📥 PEDIDO RECEBIDO!* pedido `#313` … Total: `R$ 37,00` (uma mensagem) → depois "Pedido aceito" (aceite automático da Menuzia)

Segunda passada, com o caso exato do bug: **"1 234"** → os 4 aceitos → extras; **"nenhuma"** → Anotado + "Agora, vai
ser `Entrega` ou `Retirada no balcão`?". Nenhuma das duas passou pela IA (custo zero).

**Custo da IA nas duas conversas: US$ 0,0023 (≈ R$ 0,013).** Das 15 respostas, 5 usaram a IA. As outras (robô, escolhas,
"fica quanto?", pagamento) saíram do servidor.

## Achados do teste real, corrigidos na hora

1. "quero pedir por aqui, um açaí grandão" recebia "O que você vai querer?" (a regra do prompt foi lida ao pé da letra). A regra agora diz: só pergunta se o cliente não disse o item. (defa879)
2. A IA listou os adicionais ela mesma, copiando do histórico de um teste anterior, e o servidor não assumia. Corrigido por dois lados: a busca no cardápio manda chamar `montar_pedido`, e o servidor detecta a lista e assume a pergunta. (f8a47dc, 8eb3369)

## Observações

- **Pix:** o copia e cola é gerado logo depois do "sim", porque o Pix precisa do pedido criado. Não foi gerado Pix de verdade neste teste: o cliente trocou para cartão antes do resumo, como no roteiro.
- **Texto dos obrigatórios:** "Escolha 4 opções de adicionais (obrigatório)" no lugar de "Escolha os adicionais (obrigatório, de 4 a 10)". O cadastro não diz o artigo do grupo ("os/as"). Além disso, o grupo tem só 4 opções, então "até 10" não existe na prática.
- **Nomes sem acento** ("Acai grandao", "Leite em po", "Maca", "Limao") e "heinetken": é assim que estão cadastrados na Menuzia. A tabela de emojis já reconhece sem acento.
- **"Banana" em dois grupos** (adicionais grátis e frutas `+R$ 2,00`): o servidor separa por grupo. Porém o cálculo final do pedido (o mesmo da vitrine) procura a opção pelo nome. Se alguém escolher Banana nos dois grupos, a segunda pode sair com o preço da primeira. Isso já acontece na vitrine e não foi mexido.
- **Mensagem extra da IA:** quando a IA anota, às vezes manda uma frase curta antes da pergunta do servidor ("Show, endereço anotado!…"). É permitido só sem pergunta.
- **"Nada inventado":** a régua conferiu as 24 mensagens e não achou nenhum item fora do cardápio (só falsos alarmes nos títulos do robô).
- **Testes:** 2.504 (lib/app/components) passando, mais os novos `rascunho.test.ts` (28), `tom.test.ts` e `atender.test.ts`. `tsc` e lint sem erro.
