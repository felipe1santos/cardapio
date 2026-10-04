# Financeiro Fase 6 — Dashboard, alertas, regras de PIN, aprovação pelo celular e risco

Migration **0144**. O rollback está em `docs/rollback/0144_dashboard_alertas_pin_risco.down.sql` e foi testado no banco
local.

Seções novas em Financeiro:
- Dashboard;
- Risco por funcionário (só dono e gerente);
- Regras e limites (só o dono altera).

## Dashboard (do livro-caixa)
| Card | De onde vem |
|---|---|
| Faturamento bruto | Σ recebimento + troco + estorno fora de empresa/resultado, pela data da linha (mesma regra do Fluxo e do DRE) |
| CMV / lucro bruto / lucro líquido estimado | os mesmos números do DRE (custo guardado na venda; despesas da carteira resultado). Exige "Ver DRE" |
| Ticket médio | faturamento ÷ vendas distintas (comanda ou pedido com recebimento) |
| Pagos × não pagos × a conferir | não pagos = carteira `a_receber`; a conferir = Pix em `pix_conferir` sem resolução; pagos = o resto. Os três somam o faturamento |
| Vendas por origem e por forma | as mesmas linhas de venda, agrupadas como no Fluxo |
| Despesas | carteira `resultado`, sem compras de insumo (já estão no CMV) e sem aporte |
| Sangrias | saídas da gaveta por sangria e retirada |
| Divergências | Σ \|ajuste\| da gaveta no fechamento, mais o número de caixas fechados com diferença |
| Dinheiro com motoboy | saldo da carteira `motoboy` agora (não depende do período) |
| Mais vendido | maior quantidade nos pedidos do período |
| Mais lucrativo / pior margem | custo guardado na venda. Exige "Ver custos" |
| Evolução | por dia, semana (começa na segunda) ou mês: faturamento (série 1), lucro bruto (série 2), despesas (barras) |

Linhas de referência do gráfico:
- **Meta** (linha sólida): `meta_faturamento_dia_centavos` × dias do grupo. É opcional; sem meta, a linha não aparece.
- **Média do período** (linha tracejada).

O **medidor** mostra o CMV como % do faturamento, comparado ao alvo (100 − margem-alvo do CMV). Fica vermelho
quando passa do alvo.

### Gráfico único (`components/financeiro/ui/grafico.tsx`)
As cores são as do Gerenciador de Eventos da Meta:

| Elemento | Cor |
|---|---|
| Série 1 | linha #1877F2, área #EDF5FE→#DFF2FB |
| Série 2 | linha #32CDCD, área #EFFBFB→#CCF2F2 |
| Barras | #83C8C0 |
| Meta | sólida #007A80, tracejada #83C8C0 |
| Medidor | alerta #D93616, trilho #EFF1F3 |
| Linha do hover | #BABDC2 |
| Grade | #EEEEEE |
| Texto | #1C2B33 |
| Eixos | #465A69 |
| Borda do tooltip | #CBD2D9 |
| Fundo | #FFFFFF |

Comportamento:
- Linhas de 1,5 px; até 4 valores no eixo Y; datas curtas no X ("out 4").
- No hover:
  - aparece uma linha vertical cinza;
  - os pontos viram bolinhas brancas com a borda da cor da série;
  - o tooltip é branco com sombra, com seções em negrito, o quadradinho da cor, o valor à direita e o período no
    rodapé.
- A legenda fica abaixo, com o quadradinho e o texto em negrito.

## Alertas ao dono
Os alertas ficam no painel (Auditoria e Alertas).

Os **graves** vão também pelo WhatsApp da loja, mas só se a loja configurou `alerta_whatsapp`. Nos testes, o
WhatsApp é simulado e as lojas de teste não têm número.

| Alerta | Quando | Como |
|---|---|---|
| divergência no fechamento | acima da tolerância | na hora (fechamento) — grave |
| caixa reaberto | sempre | na hora — grave |
| cancelamento depois de pago | pedido com recebimento no livro-caixa, ou conta com pagamento | vigia — **grave** |
| desconto alto | acima de 10% ou R$ 20,00 (por loja) | vigia |
| sangria/retirada alta | acima do limite de saída, mesmo aprovada | vigia |
| caixa esquecido aberto | há mais de 14 h | vigia |
| caixa sem abrir | loja aberta pela grade há ≥ 30 min e nenhum caixa aberto | vigia |
| motoboy com dinheiro | há mais de 3 h sem acerto | vigia |
| valor manipulado | pedido da vitrine com preço/total/desconto no corpo (o servidor ignora e usa o cardápio) | na hora — grave |
| login simultâneo | mesmo login em dois aparelhos | na hora (Fase 1) |
| muitas ações sensíveis | funcionário acima do limite no turno (cancelar, desconto, estorno, reimpressão, sangria) | vigia |
| Pix a conferir no fechamento / comanda que passou de turno | ao fechar | na hora |

**Vigia:**
- Cron `POST /api/cron/financeiro-vigia` (cabeçalho `x-cron-secret`), a cada 15 min, só nas lojas com o financeiro
  ligado.
- Cada alerta tem chave e **não se repete**.
- Relógio de teste: só com `VIGIA_RELOGIO_TESTE=1` no servidor **local** (cabeçalho `x-vigia-agora`). Em produção, a
  variável não existe.

## Regras de PIN no fechamento (PROVISÓRIAS, por loja)
| Situação | Exige |
|---|---|
| diferença na gaveta até a tolerância (padrão R$ 2,00) | justificativa |
| diferença acima da tolerância | justificativa + PIN de gerente/dono |
| maquininha com diferença | justificativa; PIN acima da tolerância |
| motoboy sem acerto | justificativa + PIN |
| entrega marcada "não pago" no turno | justificativa + PIN |
| Pix a conferir | nada: fecha e vai para a lista do dono (alerta) |
| mesa/comanda aberta | passa para o próximo turno com justificativa; PIN acima de R$ 100,00 em aberto |

Regras gerais:
- O dono nunca precisa de PIN, mas também justifica.
- **Mudança:** antes, diferença até R$ 5,00 fechava sem nada. Agora qualquer diferença pede justificativa, e a
  tolerância do PIN é de R$ 2,00.

## Aprovação pelo celular
**Fluxo:**
1. Quando a ação pede PIN, a tela mostra **"Pedir pelo celular do gerente/dono"**.
2. O servidor devolve, no 409, a ação e o valor exatos a pedir.
3. O gerente/dono vê, em qualquer tela do painel, a faixa "X pede aprovação". Ela fica por cima de tudo, também no
   celular.
4. O gerente/dono abre o pedido, confere ação, valor, quem pediu e o aparelho, e aprova ou recusa com **o próprio PIN**.
5. A tela de quem pediu espera e conclui sozinha.

**Segurança:**
- Ninguém aprova o próprio pedido (CHECK no banco + servidor).
- A aprovação vale **uma vez**, para a mesma ação, o mesmo valor e a mesma pessoa, por 10 minutos.
- O aprovador precisa continuar ativo e com permissão no momento do uso.
- Tudo fica auditado: pedido, decisão e uso.
- O pedido não se apaga.

**Push:** o PWA do painel ainda não tem push. O aviso é a faixa, que consulta a cada 10 s. O ponto de troca é
`avisarAprovadores()`.

## Abertura rápida do caixa
- Logo depois do login, e só na primeira tela, quem pode abrir o caixa e o encontra fechado vê "Abrir o caixa agora?"
  com o fundo de troco.
- "Agora não" não bloqueia nada. A pergunta aparece uma vez por sessão do navegador.

## Risco por funcionário
**O que conta**, por pessoa e período: cancelamentos, descontos, estornos, reimpressões, divergências de caixa (de
quem fechou) e ajustes/perdas. As fontes são a auditoria (imutável, com hash) e os fechamentos.

**Fora do padrão:** pelo menos 3 no período **e** mais que 2× a mediana da equipe. É um sinal para conferir, não uma
acusação.

**Quem vê:** só dono e gerente, mesmo que outra pessoa tenha "ver auditoria" marcado.
