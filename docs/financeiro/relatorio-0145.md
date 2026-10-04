# 0145 — Dashboard e DRE na mesma base (2026-10-04)

Pedido do dono depois da conferência da Fase 6 (dashboard com "Despesas −R$ 41" e "Mais vendido" fora do caixa).

## O que mudou

1. **Diferenças de caixa** (sobras − faltas dos fechamentos) saíram de "Despesas" e viraram linha própria:
   - Dashboard: card "Diferenças de caixa (N turnos)" com "sobras R$ X · faltas R$ Y" e o quadro
     "Diferenças de caixa por turno" (quem fechou, quando, justificativa, cartão só informativo).
   - DRE: linha "(±) Diferenças de caixa (sobras − faltas)" com o detalhe por turno logo abaixo.
   - Lucro líquido = lucro bruto + outras receitas − despesas ± diferenças de caixa (explícito; o card do
     dashboard diz "com sobra/falta de caixa de R$ X").
2. **Mesma base em todos os cards**: faturamento, produtos, CMV, origens e formas contam só vendas com
   recebimento no livro-caixa do período (`fin_vendas_base`). Pedido sem lançamento (antigo), pedido estornado
   inteiro, item cancelado e pedido cancelado dentro da comanda não entram. Uma venda pertence ao período do
   primeiro recebimento. Ticket médio: venda estornada inteira não conta.
   - Quadro "Do que é feito o faturamento": produtos + taxas − descontos + serviço/gorjeta/parciais
     + recebido de outro período + vendas sem pedido = faturamento (sempre fecha).
3. **Celular**: abaixo de 400 px, 1 card por linha; título em até 2 linhas sem cortar; valor nunca quebra
   (`CartaoNumero`, vale para todas as telas que usam o cartão). Status do caixa no topo do celular: quadrado
   de 36 px (verde aberto / vermelho fechado, ícone branco), com dica e rótulo acessível. Conferidas as outras
   telas do financeiro a 390 px (caixa, fluxo, motoboys, Pix, movimentações, CMV, contas, auditoria, risco,
   regras): sem rolagem lateral, títulos e valores inteiros.

## Migration 0145 (só funções)

- `fin_dashboard` recriada (despesas sem `ajuste`; chaves `diferencas_caixa`, `sobras`, `faltas`; série com
  `diferencas`; vendas = saldo positivo). Novas: `fin_diferencas_caixa`, `fin_vendas_base`. Todas fechadas
  para `anon`/`authenticated`.
- Ensaio em produção (aplica, confere, desfaz) → ok. Aplicada às 14h34 com backup em
  `C:\Users\felipe\backups\menuzia\2026-10-04-pre-0145` (`fin_config` + `rollback-0145.sql`, que recria o
  `fin_dashboard` da 0144 e apaga as duas funções novas).
- Main **f9ae772**, deploy Coolify `mbv7izrhmdd0p1j2m611ovmm` (disparado pela API, POST) — finished 14h42.

## Testes (local)

| Suíte | Resultado |
|---|---|
| e2e-financeiro-mesma-base (novo: banco, API, tela desktop e 390 px) | 53/53 |
| e2e-financeiro-fase6 (ajustado: despesas sem ajuste, ticket, mais vendido na base do caixa) | 97/97 |
| e2e-financeiro-contas (lucro líquido ± diferenças) | 80/80 |
| e2e-financeiro-cmv | 61/61 |
| e2e-financeiro-atomico | 23/23 |
| e2e-financeiro-fluxo | 86/86 |
| e2e-financeiro-integrado | 52/52 |
| e2e-loja-sem-financeiro | 6/6 |
| vitest lib/financeiro | 75/75 |
| tsc, eslint dos arquivos tocados | ok |

Teste novo pedido pelo dono: **soma dos produtos = faturamento − taxas + descontos − outros − sem pedido**.

Limites conhecidos:
- O caso "recebido de vendas de outro período" não dá para simular no banco local (o livro-caixa grava
  `criado_em = now()`); fica coberto pela identidade da conciliação.
- `verificar-migrations.mjs` falha na **0132** (o banco vazio do verificador não tem o schema `extensions`),
  antes de chegar na 0145 — problema antigo do verificador, não desta mudança.
- A tela Precificação/CMV › Vendas continua contando pelos pedidos (é um relatório de margem por item, com
  base própria e coerente consigo mesma).

## Conferência em produção (Menuzia, Angus Burguer, Administrador)

- Rota neutra `/api/sessao/estado` → Administrador, financeiro ligado; página com "Angus Burguer".
- Dashboard (30 dias): faturamento R$ 9,00 = conciliação; produtos "Xtudo 1 un · R$ 9,00" (antes: Coca 18 un
  · R$ 112,56, fora do caixa); Despesas R$ 0,00; Diferenças de caixa +R$ 41,00 (turnos de 02/10 +R$ 30 e 04/10
  +R$ 11); lucro líquido R$ 50,00 "com sobra de caixa de R$ 41,00".
- Lojas reais: vitrines 200, nenhum pedido parado, sem custo gravado fora da Menuzia, logs sem erro.

Prints: `publicacao-prints/0145-local-*.png` (local) e `0145-producao-*` (produção, quando tirados).
