# Financeiro Fase 5 — Precificação / CMV: regras

Tela: Financeiro › Precificação / CMV, com quatro abas: Precificação, Insumos, CMV das vendas e Margens e preço.
Migration **0142**.

## Unidades e precisão
- Dinheiro em **centavos inteiros**: custo da compra, preço, CMV gravado.
- O custo por **unidade base** (g, ml ou unidade) tem fração de centavo. Ex.: R$ 8,00/kg = 0,8 centavo/g.
  - **No banco**, as contas intermediárias usam `numeric`, e o custo guardado na venda tem 6 casas decimais
    (`custo_unitario`).
  - **Na tela**, as contas usam número com casas decimais e só o **resultado** é arredondado para o centavo
    (`custo_unitario_centavos`).
- O CMV de um período soma `custo_unitario × quantidade` e arredonda só no total.

## Insumo
- **Conversão automática:**
  - kg → 1000 g
  - L → 1000 ml
  - dúzia → 12 un
  - g, ml e un → 1
- **Pacote, caixa, fardo, saco, lata e garrafa:** a pessoa informa quanto vem em cada unidade e a unidade base.
  Ex.: pacote com 24 un; caixa com 12 L = 12000 ml.
- **Custo por unidade base** = custo da compra ÷ (quantidade comprada × unidades base por unidade) ÷ aproveitamento.
  Aproveitamento de 85% → ÷ 0,85: o custo real por grama sobe.
- **Preparado (sub-receita)** = Σ(quantidade × custo do componente) ÷ rendimento ÷ aproveitamento.
  - Até 5 níveis.
  - Ciclo vira erro de cálculo, e a venda continua: ver "Custo na venda".
- **Histórico de custos:** cada mudança de custo, quantidade, conversão ou aproveitamento grava uma linha
  **imutável** (antigo, novo, quem, quando, motivo). A trava vale até para o acesso do servidor.
- **Recálculo:** como as fichas calculam o custo a partir dos insumos, mudar um insumo recalcula na hora todos os
  itens que o usam.
- **Exclusão:** insumo **não se apaga**, só se desativa. A tela não tem exclusão, a API responde 405 e o banco
  recusa apagar insumo em uso ou com histórico.

## Ficha de custo
- **CMV da ficha** = Σ quantidade (na unidade base) × custo por unidade base.
- A tela mostra o custo de cada componente, o CMV, o lucro bruto e a margem:
  - lucro = preço − CMV;
  - margem = lucro ÷ preço.

**Uma ficha por alvo vendável:**

| Alvo | Quando |
|---|---|
| `item` | produto sem tamanhos (ou ficha geral do produto) |
| `tamanho` | cada tamanho de `tamanhos_item` (P/M/G de lanche, açaí, marmita); o preço do tamanho **substitui** o do produto |
| `sabor` (× tamanho) | pizza: cada sabor em cada tamanho da loja (`tamanhos_padrao_pizza`) |
| `complemento` | adicional do produto (ficha simples; ex.: bacon 30 g) |
| `borda` / `massa` | catálogo da loja (pizza) |

**Pizza meio a meio:**
- A venda grava os sabores pelo nome, juntos com " / ", sem fração.
- A regra é a mesma do preço: o sabor antigo cujo próprio nome contém " / " vale como um sabor só.
- **Custo = média do custo da ficha de cada sabor naquele tamanho**, isto é, fração 1/N de cada um. Isso vale mesmo
  quando a loja cobra pelo sabor mais caro: o preço segue a regra da loja e o custo segue a fração.
- Sabor sem ficha deixa a pizza inteira "sem ficha" (não se inventa custo).

**Importar da ficha de preparo:**
- Copia os ingredientes da "Ficha de preparo" da cozinha como sugestão.
- Casa pelo nome do insumo e lê a quantidade quando ela é numérica ("30 g", "1,5 kg", "200 ml", "1 un").
- Depois de salva, a ficha de custo é **independente** da ficha de preparo.
- A ficha de preparo e a tela da cozinha **nunca** mostram custo: os custos ficam em tabelas que só o servidor lê.

## Lista de precificação
- Uma linha por variante vendável: produto, tamanho, ou sabor × tamanho da pizza.
- Colunas: foto, nome, categoria, status, preço, custo, lucro, margem e preço sugerido.
- Destaques "Sem ficha" e **"Margem baixa"**: abaixo do limite da loja, 30% por padrão.
- O resumo do topo mostra itens com ficha × sem ficha, a margem média e quantos têm margem baixa.
- CSV com o mesmo padrão da Fase 4, exige "Exportar relatórios financeiros" e é auditado.

## Sugestão e aplicação de preço
**Preço sugerido** = custo ÷ (1 − margem-alvo − custos variáveis).
- Arredonda PARA CIMA até o final escolhido: ,90, ,99, ,00, ,50 ou sem arredondar. Nunca baixa abaixo do cálculo.
- A margem-alvo é da loja (padrão 65%) ou da categoria, quando definida.
- Custos variáveis: taxa de cartão ou marketplace, em %.
- Exemplo: custo R$ 7,48, margem 65%, cartão 5% → 7,48 ÷ 0,30 = R$ 24,94 → **R$ 25,90** (final ,90).

**"Aplicar novo preço":**
- **Nunca automático:** só com o botão e a confirmação, mostrando o preço antigo, o novo e a margem nova.
- Exige a permissão própria **"Aplicar novo preço sugerido"**.
- O servidor confere que o preço "antigo" é o do banco agora. Tela velha ou corpo manipulado → 409.
- Grava no mesmo lugar da edição do cardápio: produto, tamanho ou sabor × tamanho. Por isso vale na vitrine (a página
  é revalidada), no PDV e nas mesas.
- Fica na auditoria (`cmv.preco_aplicado`, com o antigo e o novo).

## Custo na venda (momento exato)
**Quando:** o custo vigente é guardado **no momento em que a linha do pedido é gravada** (`pedido_itens`), por um
gatilho do banco. Isso cobre:
- o pedido da vitrine, quando o cliente confirma;
- o lançamento no PDV, no balcão ou na mesa;
- o lançamento do garçom.

**O que é guardado:** item + tamanho + sabores + borda + massa + cada adicional (adicional repetido conta de novo).

**Transferência entre mesas:** quando a transferência copia uma linha em parte, a cópia guarda o custo do momento da
transferência.

**CMV de um período:** usa **só o custo guardado**, nunca o custo atual.
- Vendas anteriores à Fase 5, ou de produto sem ficha, aparecem como **"sem custo registrado"**.
- O passado não é recalculado.

**Falha no cálculo:** nunca atrapalha o pedido.
- O pedido entra normalmente.
- A linha fica com situação `erro` e a mensagem registrada. Exemplo: sub-receita em ciclo.

O custo só é guardado nas lojas com o financeiro ligado (hoje, só a Menuzia).

## Permissões (sempre no servidor)
| Permissão | O que libera | Padrão |
|---|---|---|
| Ver custos e margens (`custos_ver`) | lista, ficha, insumos, histórico, CMV das vendas | dono e gerente |
| Editar insumos e fichas (`custos_editar`) | cadastrar e editar insumos, fichas, margens | dono e gerente |
| Aplicar novo preço sugerido (`precos_aplicar`) | trocar o preço pelo CMV | dono e gerente |
| Exportar relatórios financeiros | CSV da precificação | dono e gerente |

- Garçom, cozinha, caixa e motoboy não veem custos, nem pela API.
- As tabelas de custo têm RLS sem políticas: o navegador não as lê.
- Insumo ou produto de outra loja pelo ID → 404.
