# PDV / Mesas — janelas sobre a tela, lançar itens, configurar item, sabor da pizza (2026-10-01)

Branch `feat/pdv-janelas`. Refina "PDV e Mesas – navegação sem telas empilhadas". Sem migration. Nenhuma
mudança em impressão, caixa, permissões ou regras de fechamento; a única regra de valor mexida é a dos
sabores da pizza (bug abaixo), igual em todos os canais e no servidor.

## Mapa de navegação

| De | Ação | Abre |
|---|---|---|
| **Grade de mesas** (fundo) | toque em mesa ocupada | janela **Conta da mesa** por cima da grade |
| Grade de mesas | toque em mesa livre | janela **Abrir mesa** por cima da grade → ao abrir, fundo vira **Lançar itens** |
| Grade de mesas | toque em mesa em limpeza | janela **Limpeza** |
| Grade de mesas | Balcão | Central de balcão (fundo) |
| **Lançar itens** (fundo) | toque num produto com opções | janela **Configurar item** → Adicionar → volta ao Lançar itens com toast |
| Lançar itens | **Ver conta** | janela **Conta da mesa** por cima do Lançar itens |
| Conta da mesa | **Lançar** / **+ Lançar itens** | fecha a conta; fundo vira **Lançar itens** daquela mesa |
| Conta da mesa | Receber, Fechar conta, Pendências, Cliente, Histórico, Cancelar | janela grande **no lugar** da conta (a conta some na hora e volta igual no Voltar) |
| Conta da mesa | **Desconto**, **Taxas**, "x" de uma linha (confirmação) | janela **pequena** sobre a conta (a conta continua à vista) |
| Fechar conta | Taxas | janela pequena sobre o Fechar |
| Qualquer janela | ← Voltar / Esc / voltar do navegador | fecha esta e mostra a anterior como estava |
| Qualquer janela | X | fecha todas (pergunta só com dado não salvo) |

Implementação: `components/pdv/tela-pdv.tsx` — janela GRANDE (≤ 1200 px × 94%, tela cheia no celular) com o
fundo escurecido (`rgba(0,0,0,.5)`), só uma visível por vez (a de baixo fica invisível, montada, estado
preservado); janela PEQUENA (≤ 560 px) sobre a atual. Transição de 150 ms (transform/opacity).

## Lançar itens
- Categorias à esquerda e busca (300 px, lupa e "x") à direita **na mesma linha**, 52 px, texto 15 px;
  categorias rolam para o lado sem barra; a linha não rola com os produtos.
- Telas abaixo de 1024 px: a busca vira uma lupa que expande o campo.
- A busca procura em **todas** as categorias (a categoria escolhida volta ao limpar).
- Barra de baixo com 84 px (Mesas, Ver conta, Lançar na cozinha); o selo do valor do "Ver conta" ficou no canto
  de cima, dentro do botão, sem cobrir ícone nem texto.

## Configurar item (`components/pdv/configurar-item.tsx`)
- Foto do produto (ou ícone neutro), nome, descrição e preço; cada opção numa linha de 68 px com miniatura
  52 px (lazy), nome, preço e marca grande — ou contador [− n +] nos grupos com "permite quantidade".
- "Obrigatório · escolha 1" / "Faltam N"; opções pausadas não aparecem; grupo sem opções não aparece nem trava.
- Quantidade [− 1 +] e "Adicionar · R$ total" ao vivo; com pendência o botão diz "Escolha: …" e, tocado, rola
  até o grupo e o destaca. Preço calculado pela mesma conta do servidor (`precoUnitarioPdv`).

## Bug do sabor da pizza — causa real
Todas as telas (vitrine, PDV, garçom, QR da mesa) e o servidor só ofereciam o **sabor ativo com preço > 0
no tamanho escolhido**. O PDV e a vitrine usavam a MESMA regra (não era diferença de consulta). Por isso:

- **Menuzia · "Pizza Baiana"**: cadastrada como pizza **sem nenhum sabor** (e preço R$ 0,00) → lista vazia em
  todos os tamanhos → "SABOR *" obrigatório → venda travada.
- **Menuzia · "pizza"**: 2 sabores (mussarela, mista) **sem preço em nenhum tamanho** → mesma trava.
- **Pizza do Rosa · "Pizza Brotinho"** (loja real): 20 sabores **sem preço por sabor** (o preço R$ 49 está só
  no item) → travava em todos os canais, inclusive na vitrine.

### Correção (`lib/pizza-sabores.ts`, regra única)
1. Pizza precificada por sabor: igual a antes (sabores ativos com preço no tamanho).
2. Pizza **sem nenhum preço por sabor**: os sabores ativos valem com o **preço do item**.
3. Pizza **sem sabores**: o sabor deixa de ser obrigatório; sai pelo preço do item; a tela avisa "Este tamanho
   não tem sabores cadastrados" e o servidor registra no log.
4. O sabor do próprio produto ("Pizza Calabresa" → Calabresa) vem marcado ao escolher o tamanho.
5. Meio a meio inalterado (limite do tamanho, média/maior da loja).
Aplicada na vitrine, no PDV, no garçom, no QR da mesa (`lib/selecao-preco.ts`) e no servidor (`resolverPizza`).

**No admin**: ao salvar um produto, o Cardápio avisa "O tamanho X não tem nenhum sabor disponível…", "não tem
nenhum sabor cadastrado" ou "O grupo obrigatório … não tem nenhuma opção disponível" (`lib/avisos-cadastro.ts`).

### ⚠️ Decisão para a loja
Com a correção, a "Pizza Brotinho" da Pizza do Rosa volta a vender por **R$ 49,00 em todos os tamanhos**
(Pequena a Gigante), porque o cadastro não diz em qual tamanho ela é vendida. O certo é a loja **desligar os
tamanhos que não valem** nessa pizza (ou cadastrar o preço por sabor). A Menuzia precisa cadastrar sabores e
preço na "Pizza Baiana" e na "pizza".

## Lojas com cadastro problemático (produção, só leitura)
| Loja | Produto | Problema |
|---|---|---|
| menuzia | Pizza Baiana | nenhum sabor; preço R$ 0,00 |
| menuzia | pizza | 2 sabores sem preço; preço R$ 0,00 |
| pizza-do-rosa | Pizza Brotinho | 20 sabores sem preço por sabor (preço só no item, R$ 49) |
| pizza-do-rosa | Pizza Promocional | preço só no Gigante — correto (só o Gigante aparece) |
| todas | grupos obrigatórios sem opções | nenhum encontrado |

## Conta da mesa
- Barra de ações com 84 px e ícone de 28 px; Receber e Fechar conta com 84 px.
- "+ Lançar itens" grande (68 px) na coluna da direita, embaixo.
- Resumo: **desconto** em pílula verde (#1AA764 sobre #EBFDF5, ícone de ticket, "− R$"); **taxas** (serviço,
  couvert, entrega, outras) em pílula azul (#0369A1 sobre #E0F2FE); taxa zerada em tom claro; "x" para
  remover com confirmação em janela pequena e conforme a permissão (desconto: ajustar valores; cupom: aplicar
  cupom; taxas: taxa extra). As mesmas cores no Receber e no Fechar conta.

## Botão flutuante
O botão verde do atendimento WhatsApp não aparece no PDV nem em Mesas/Comandas/Balcão.

## Testes
- **E2E novo** `scripts/seguranca/e2e-pdv-janelas.mjs`: **53/53**.
  - Grade → mesa livre (janela por cima, fundo à vista) → Lançar itens: linha única, busca em todas as categorias, linha fixa, barra 84 px.
  - Açaí: miniaturas, pausada fora, grupo vazio fora, pendência destacada, contador, total ao vivo e toast.
  - Pizzas: sabores do tamanho, sabor do produto marcado, meio a meio pela regra da loja, sem sabores, Brotinho.
  - Cozinha gravou sabores e preços certos.
  - Conta por cima, selo sem cobrir, Desconto e Taxas pequenas sobre a conta, pílulas, remover com confirmação.
  - Receber no lugar da conta e Voltar com a conta igual; Fechar com desconto verde; concluir.
  - Mesa ocupada → conta sobre a grade → Lançar itens.
  - 1024×768, 1280×800, 1920×1080, 390×844; vitrine com a mesma regra.
- Busca em tela estreita (820 px): lupa → campo → resultado (print 12).
- **Regressão**: navegação 30/30 (teste ajustado ao fundo à vista), PDV v2 71, atendimento 98, balcão/entrega 84,
  caixa 35 + turnos 18, garçom 48, modelos/taxas 58, cozinha 26, estabilidade 53, regressão-release 52,
  release-mesas 254, checkpoint-e 90, etapa-f 136, retoque 46 (altura esperada 80–88 px), checkout 72,
  tags 27, pedido idempotente 12, unitários 1830.
- **Impressão** (impressoras virtuais) 39/40. O teste esperava o estado da pré-conta num texto que saiu no retoque; corrigido para ler o título do botão.
  A falha restante é o log do Assistente real aberto neste computador, que mudou sozinho durante o teste. É do ambiente, não deste código.
- Prints: `prints/antes` (main) e `prints/depois` (e2e).

## Publicação
Pendente: deploy 00:00–10:00, conferência na Menuzia (pedidos TESTE cancelados no fim).
