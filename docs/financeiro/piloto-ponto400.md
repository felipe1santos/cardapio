# Piloto do Financeiro na Ponto 400 — preparo (NÃO LIGADO)

Levantado em 2026-10-09 só por leitura (SELECT) no banco de produção. Nada foi alterado na Ponto 400.
Script: `.medidas/fin/19-ponto400.mjs` (fora do repositório).

## 1. Checklist antes de ligar

| # | Item | Situação hoje (09/10) | O que fazer |
|---|---|---|---|
| 1 | **Gerente com PIN além do dono** | Só existe 1 usuário ativo: **Guilherme Silva (dono), sem PIN**. Nenhum gerente. | Criar pelo menos 1 gerente na Equipe e ele criar o PIN em "Minha conta". Sem isso, ninguém além do dono faz estorno, cancelamento depois da cozinha, sangria acima do limite nem fecha caixa com diferença. |
| 2 | **Casa limpa** | 1 conta aberta: balcão **#7 "Girlene Pereira", R$ 33,00, aberta desde 07/10**. Caixa "automático" aberto desde 08/10 20:56 (o caixa do dia operacional, de quando a loja está sem financeiro). Nenhum pedido em andamento parado. | Fechar ou cancelar a conta #7. Fechar o caixa automático (a Ponto 400 está sem financeiro: ele vira pelo dia operacional às 05:00). Ligar a flag com o caixa fechado e abrir o primeiro caixa já com o fundo contado. |
| 3 | **Motoboys** | 5 entregadores cadastrados (Guilherme o 01, Cleyverson, Lucas 2, ld motoboy, Junin Motoboy). Sem livro-caixa ainda, então não há saldo de motoboy a acertar. | Cada motoboy que leva troco precisa estar ativo e com acesso ao app (/motoboy). Combinar quem faz o acerto no fim do turno. |
| 4 | **Custo dos 15 itens mais vendidos** (últimos 30 dias, entregues) | 0 insumos e 0 fichas cadastrados: o CMV vai mostrar "Cadastre o custo dos itens para ver o CMV". | Cadastrar o custo (ficha técnica ou custo simples) destes 15, nesta ordem: X - TUDO (53), HAMBURGUER (25), X - BACON (22), X - PODRÃO (20), COMBO CASAL (19), BURGUER SIMPLES (14), BURGUER CHEDDAR (12), PICANHA BRUTO (11), IATE GUARANÁ 2L (11), X - FRANGO (11), X - EGG BACON (9), X - BURGUER (9), COCA-COLA LATA (8), COMBO TRIPLO (8), COCA-COLA 2L (8). O CMV só conta vendas feitas DEPOIS do cadastro. |
| 5 | **Fundo de caixa e tolerância** | Sem `fin_config` (nasce com os padrões ao ligar): limite de saída sem PIN R$ 100,00; diferença acima de R$ 5,00 pede PIN; qualquer diferença pede justificativa; caixa aberto há mais de 14 h gera alerta. | Definir com o dono: valor do fundo de troco (sugestão: o que ele já deixa na gaveta hoje), limite de sangria sem PIN e o número de WhatsApp que recebe os alertas graves. Ajustar em Financeiro › Regras e limites. |
| 6 | Movimento para comparar | 140 pedidos entregues em 30 dias (R$ 8.670,93): Pix 52, cartão 51, dinheiro 37. | Usar como referência do 1º dia (ticket e mix de formas). |

## 2. Como LIGAR e como DESLIGAR (voltar atrás)

Não há botão na tela: a flag é por loja, no banco (com backup antes, como nas outras publicações).

**Ligar** (com o caixa automático fechado e a conta #7 resolvida):

```sql
-- backup da linha antes
select id, slug, financeiro_ativo from restaurantes where slug = 'ponto-400-hamburgueria';
update restaurantes set financeiro_ativo = true where slug = 'ponto-400-hamburgueria';
```

Depois: equipe sai e entra de novo no painel (o aparelho do caixa precisa entrar COM SENHA depois da flag para a troca de operador por PIN funcionar); o gerente abre o caixa em Financeiro › Caixa com o fundo contado.

**Desligar** (volta ao comportamento de hoje na hora; nada é apagado):

```sql
update restaurantes set financeiro_ativo = false where slug = 'ponto-400-hamburgueria';
```

O livro-caixa e a auditoria que já foram gravados ficam (são imutáveis) e voltam a aparecer se ligar de novo. Com a flag desligada a loja volta a vender sem abrir caixa e o PIN deixa de ser pedido.

## 3. Guia de 1 página para a equipe

**Abrir o caixa (começo do turno)**
1. Conte o dinheiro do troco que está na gaveta.
2. Financeiro › Caixa › **Abrir caixa** › digite o valor contado › Confirmar.
3. Sem caixa aberto o sistema não recebe pagamento no balcão nem na mesa.

**Vender**
- Igual a hoje. No balcão, escolha a forma de pagamento antes de lançar. Dinheiro: informe "troco para quanto".
- Pix no balcão: depois, em Financeiro › Conferir Pix, marque "caiu" quando o dinheiro aparecer na conta.

**Sangria (tirar dinheiro da gaveta para o cofre)**
- Financeiro › Caixa › **Sangria** › valor e motivo.
- Não dá para tirar mais do que o sistema calcula que há na gaveta ("Só há R$ X na gaveta").
- Acima de R$ 100 (ou o limite da loja), outra pessoa precisa aprovar com o PIN.

**Fechar o caixa (fim do turno)**
1. Acerte os motoboys primeiro (Financeiro › Acerto de Motoboys).
2. Financeiro › Caixa › **Fechar caixa**.
3. Conte o dinheiro e o total da maquininha e digite. O sistema **não mostra** quanto deveria ter antes de você contar.
4. Se der diferença, explique o motivo. Acima de R$ 5,00, o gerente aprova com o PIN e o dono recebe um alerta.

**Quando aparece o PIN de outra pessoa**
- Estornar um pagamento.
- Cancelar pedido ou item que já foi para a cozinha.
- Sangria, despesa, retirada ou perda acima do limite.
- Fechar o caixa com diferença acima de R$ 5,00 ou com contas abertas acima do limite.
- Quem pede nunca aprova. Chame o gerente: ele escolhe o nome dele na janela e digita o PIN (ou aprova pelo celular).
- 5 PINs errados bloqueiam o PIN por 15 minutos.

**Se der diferença**
- Não "ajuste" contando de novo até bater: toda contagem fica registrada.
- Escreva o que aconteceu (troco errado, sangria sem lançar, nota que sumiu). O dono vê a diferença e o motivo no painel.

## 4. O que acompanhar no 1º dia e no 1º fechamento

- **Abertura:** caixa aberto por quem, com qual fundo (Financeiro › Caixa; aviso verde no topo).
- **Durante o turno:** Conferir Pix (Pix de balcão a conferir); alertas em Financeiro › Auditoria e Alertas; motoboy com dinheiro há mais de 2 h.
- **Fechamento:** diferença do dinheiro e da maquininha; justificativa; quem aprovou; contas que passaram para o turno seguinte (deve ser zero).
- **Depois do fechamento:** Fluxo de Caixa do dia (esperado × informado), DRE e Dashboard do dia batendo com o faturamento que o dono conhece; `node .medidas/fin/conciliar.mjs` adaptado para a loja (ou a mesma conferência feita na mão pelo suporte).
- **Assistente de impressão:** continua no beta.13; conferir que os pedidos seguem saindo depois de ligar a flag (a flag não mexe na impressão).
- **Plano B:** se travar a operação em horário de pico, desligar a flag (seção 2) e anotar o que aconteceu; nada se perde.
