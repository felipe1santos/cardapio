# Financeiro Fase 5b — Contas a pagar/receber, compras e DRE: regras

Tela: Financeiro › Contas e DRE. Abas: A pagar, A receber, Compras de insumos, DRE, Categorias e fornecedores.
Migration **0143**, com rollback em `docs/rollback/0143_contas_compras_dre.down.sql`, testado no banco local.

## Duas carteiras
| Carteira | O que é | Regra |
|---|---|---|
| **CAIXA** (`gaveta`) | dinheiro da gaveta do turno | pagar com ela exige caixa aberto e vira movimentação do turno (despesa ou compra) |
| **EMPRESA** (`empresa`) | conta bancária, cartão da empresa, boleto | — |

- A contrapartida vai para a carteira `resultado`, com a categoria em `dados`. É dali que o DRE tira as despesas.
- O nome da categoria também vai no `motivo`, que entra no hash.

O card mostra a **Conta da empresa (movimento)**:
- é a soma do que passou pela empresa DENTRO do sistema: sangrias, fundo de troco, contas pagas e recebidas;
- não é o saldo do banco, porque o sistema não sabe o saldo inicial.

## Contas
**Campos:** descrição, fornecedor (cadastro reutilizável), categoria, valor, vencimento, forma prevista, observação,
anexo e recorrência.

**Status gravado:** `a_pagar` → `pago` | `cancelado`. O status **vencida** é calculado pela data, não é gravado.

**Recorrência:**
| Tipo | Regra |
|---|---|
| Mensal | mantém o dia; em mês curto cai no último dia (31/01 → 28/02 → 31/03) |
| Semanal | +7 dias |

- A próxima conta é gerada com antecedência: 31 dias (mensal) ou 7 dias (semanal).
- Gera ao abrir a lista e pelo cron `financeiro-diario`.
- A chave é única por série + vencimento, então nunca duplica.
- "Cancelar e as próximas" encerra a série.

**Alertas de vencimento** (no painel):
- "vence hoje/amanhã" e "vencida", uma vez por dia por conta;
- gravidade "atenção", então não vão para o WhatsApp.

**Baixa (pagar/receber):**
- Escolhe Empresa (com a forma) ou Caixa.
- Repetir a baixa (clique duplo) não lança de novo.
- PIN de outra pessoa:
  - pela gaveta, acima do limite de saída do caixa (padrão R$ 100,00, o mesmo da sangria);
  - pela empresa, acima de `limite_conta_centavos` (padrão **R$ 1.000,00**, provisório);
  - o dono não precisa;
  - receber nunca precisa.

**Estorno da baixa:**
- Grava o lançamento oposto, com cada linha apontando a original.
- Pede PIN de gerente, menos para o dono; ninguém aprova a si mesmo.
- O dinheiro da gaveta volta para o turno aberto, que é obrigatório.
- A conta volta para "a pagar" e o dono recebe um alerta.

**Editar:** só conta em aberto, com antes/depois na auditoria.

**Cancelar:**
- Só conta em aberto; conta paga precisa ser estornada antes.
- Nada se apaga. O banco recusa DELETE e recusa mudar o valor de conta paga ou cancelada, até para o service_role.

**Anexo:**
- Formatos PDF, JPG, PNG ou WEBP, até 5 MB.
- Ficam no bucket **privado** `financeiro-anexos`, e a tela recebe um link assinado de 60 s.
- Anexo novo não apaga o anterior.

## Contas a receber e vendas do sistema
- As vendas do sistema (vitrine, PDV, mesas, entregas) já entram sozinhas no livro-caixa.
- Contas a receber servem para entradas de fora: repasse do iFood, aporte do sócio, venda avulsa feita fora do sistema.

**Bloqueio de duplicidade** em categorias cujo nome começa com "Venda". O lançamento é recusado (409
`venda_duplicada`) quando:
- a descrição ou a observação cita `#N` de um pedido existente; ou
- o valor é igual ao total de um pedido não cancelado do mesmo dia.

**"Lançar mesmo assim"** (provisório):
- exige justificativa (≥ 10 letras) e PIN de gerente; o dono não precisa do PIN;
- fica auditado (`contas.venda_avulsa_liberada`) e gera o alerta `venda_manual_suspeita` ao dono.

## Compras de insumos
A nota tem fornecedor, número, data e itens (insumo, quantidade, unidade, valor).

**Unidade:** a de compra do insumo (kg, pacote…) ou a unidade base (g, ml, un).

**Custo novo do insumo** = valor ÷ quantidade na base × (quantidade × base por unidade do cadastro).
- Itens do mesmo insumo na nota somam.
- Grava no histórico, que é imutável, com o motivo "Compra nota N — Fornecedor".
- O CMV de todos os produtos que usam o insumo recalcula na hora, porque as fichas calculam a partir do insumo.

**Pagamento:**
| Opção | O que acontece |
|---|---|
| **A prazo** | gera uma conta a pagar (categoria Insumos, vencimento informado) |
| **Paga pela empresa** | gera a conta já paga, com saída da empresa |
| **Dinheiro do caixa** | gera uma saída da gaveta do turno (tipo `compra`); exige caixa aberto |

PIN acima dos mesmos limites da baixa.

**Para o estoque futuro:** a quantidade é guardada também na unidade base (`quantidade_base`). Não há controle de
estoque agora.

**Cancelar compra:**
- Só compra a prazo ainda não paga; a conta é cancelada junto.
- Compra paga pelo caixa não se cancela: registre a devolução como reforço.
- O custo do insumo **não volta sozinho** (o histórico mostra); ajuste em Insumos se precisar.
- A nota e os itens não mudam nem se apagam.

## DRE simplificado
```
Faturamento            = Σ livro-caixa (recebimento + troco + estorno, fora de empresa/resultado), pela data da linha
(−) CMV                = custo GUARDADO na venda (Fase 5) dos pedidos do período
(=) Lucro bruto
(+) Outras receitas    = contas recebidas em categorias "receita" (ex.: repasse iFood)
(−) Despesas           = carteira "resultado" por categoria: contas pagas, despesas e perdas do caixa,
                         diferenças de caixa (sobra entra como despesa negativa)
(=) Lucro líquido
```
- **Não entram como despesa:** compras de insumos e embalagens (grupo "insumo"). O custo delas já entra no CMV quando
  o produto é vendido; contar a compra também seria contar duas vezes. Aparecem como informação.
- **Não entra no resultado:** aporte do sócio (grupo "fora").
- **Regime de caixa nas despesas:** entram as contas pagas no período, não as que vencem nele.
- **Comparação:** com o período anterior de mesmo tamanho.
- **Conferência:** a soma da carteira `resultado` no período, devolvida ao lado, é testada contra SQL direto.
- **Diferença para o Fluxo de Caixa:** o Fluxo agrupa por **turno** (data de abertura) e o DRE por **data da linha**.
  Num turno que vira a meia-noite, os dois podem diferir.

## Permissões (no servidor)
| Permissão | Libera | Padrão |
|---|---|---|
| Ver contas a pagar e a receber (`contas_pagar`) | listas, compras, cadastros, link do anexo | dono, gerente |
| Lançar contas, despesas e compras (`contas_lancar`) | criar, editar, cancelar, anexar, cadastros, compra a prazo | dono, gerente |
| Marcar conta como paga ou recebida (`contas_marcar_pago`) | baixa e estorno; compra paga na hora | dono, gerente |
| Ver DRE e lucro (`dre_ver`) | DRE | dono, gerente |
| Exportar relatórios (`financeiro_exportar`) + ver contas | CSV | dono, gerente |

Gerentes com acessos personalizados que já tinham `contas_pagar` ganham as duas novas na 0143, para manter o que já
faziam.
