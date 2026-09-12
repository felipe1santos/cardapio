# Spec — Migração do cardápio da Pizza do Rosa (Expresso Delivery → Menuzia)

**Data:** 2026-09-12
**Tenant destino:** `Pizza do Rosa`, slug `pizza-do-rosa` (app.menuzia.com.br), cardápio hoje **vazio** (0 itens, 0 categorias).
**Origem:** `www.pizzadorosa.com.br` — plataforma Expresso Delivery, `cod_filial=61616`, `contratacao=13187`.

---

## 1. Contexto

O cliente é assinante Menuzia e vai sair do Expresso Delivery. O cardápio dele
(227 itens, todos com foto) precisa ser recriado dentro do Menuzia, com
complementos, matriz de preço por tamanho de pizza e bordas.

Não é digitação manual: o cardápio dele é público e expõe dados estruturados.

### Como os dados foram obtidos

| Fonte | Como | O que traz |
|---|---|---|
| `/cardapio/` (HTML) | `<input id="sessions">` | 12 sessões (categorias raiz) |
| `/cardapio/itens/<link>` (HTML) | cards `schema.org/Product` | 227 itens: nome, descrição, preço, foto, subcategoria |
| `/exec/menu/getItemsBySession?sessionId=<id>` (JSON) | requer cookie `__Secure-PHPSESSID` + header `Referer: https://www.pizzadorosa.com.br/cardapio/` | matriz de preço por tamanho, ingredientes, adicionais com preço por tamanho, tamanhos |
| `/montar/pizza/` (HTML) | `var bordas_lista`, `var alltamanho` | 5 bordas, 4 tamanhos com fatias e máx. de sabores |
| `Downloads/Cardápio 2026.pdf` | `pdftotext -raw -enc UTF-8` | conferência cruzada de preços |

Fotos disponíveis em três larguras: `/180/`, `/600/`, `/800/`. **Usar `/800/`.**

---

## 2. O que existe na origem

### 2.1 Volume

| Sessão (origem) | Itens | Subcategorias |
|---|---|---|
| PIZZA | 75 | Tradicionais (56), Doces (19) |
| Pizza Promocional | 15 | Pizza Popular (15) |
| Pizza Brotinho | 20 | Pizza Brotinho (20) |
| Hambúrguers | 19 | Hambúrguers (16), Pizza Burguer (3) |
| Porções | 10 | Porções (10) |
| Massas | 6 | Massas (6) |
| Sobremesas | 31 | Balcão (31) |
| Bebidas | 36 | Refrigerante (20), Suco (4), Cerveja (6), Água (2), vinho (4) |
| Saladas | 1 | salada (1) |
| Molhos | 3 | Molhos (3) |
| Congelados | 2 | esfihas (2) |
| Loja Virtual | 9 | Bonés (6), chaveiro (1), camiseta (2) |
| **Total** | **227** | todos com foto |

### 2.2 Tamanhos de pizza (sessão PIZZA)

| id | Nome | Fatias | Máx. sabores |
|---|---|---|---|
| 13 | Pizza Pequena | 4 | 1 |
| 14 | Pizza Média | 6 | 2 |
| 15 | Pizza Grande | 8 | 3 |
| 16 | Pizza Gigante | 12 | 4 |

Faixas de preço encontradas na matriz sabor × tamanho:

- Tradicionais comuns: 69 / 79 / 89 / 99
- Tradicionais especiais: 79 / 89 / 99 / 109
- Doces: 79 / 89 / 99 / 109
- Doces premium: 89 / 99 / 109 / 119
- Um doce fora da curva: 63 / 89 / 99 / 109

Pizza Promocional: tamanho único "Pizza Gigante" a **R$ 79,00**, máx. 2 sabores.
Pizza Brotinho: tamanho único, **R$ 49,00**, 1 sabor.

### 2.3 Regra de preço com mais de um sabor

O campo `sessao_formacalculoitem` da origem:

| Sessão | Regra |
|---|---|
| PIZZA | **MEDIA** (média aritmética dos sabores escolhidos) |
| Pizza Promocional | MAIOR |
| Pizza Brotinho | MAIOR |

Como todos os sabores da Promocional custam o mesmo (79), média e maior dão o
mesmo resultado. **Regra única da loja no Menuzia: MÉDIA.**

### 2.4 Bordas (5)

Catupiry, Cheddar, Chocolate Branco, Chocolate Preto, Cream Cheese.

Preço por tamanho na origem: P 15 / M 17 / G 19 / GG 22.

### 2.5 Adicionais

| Grupo | Qtd | Preço por tamanho? |
|---|---|---|
| Adicionais de Pizza | 33 | Sim (ex. Bacon 3/6/9/12) |
| Adicionais de Hambúrguer | 22 | Não (preço único) |
| Adicionais de Massa | 19 | Não |
| Adicionais de Porção | 3 | Não |
| Adicionais de Salada | 3 | Não |

---

## 3. Lacunas do Menuzia e decisões tomadas

| # | Lacuna | Decisão |
|---|---|---|
| 1 | Menuzia só deixa escolher **1 sabor** por pizza (`vitrine.tsx`, `selectedSaborId` singular) | **Construir meio a meio antes de importar** |
| 2 | `bordas_pizza.preco` é preço único, sem variação por tamanho | Importar com **o preço do Grande (R$ 19,00)** |
| 3 | `item_complementos.preco` é preço único | Importar adicionais de pizza com **a coluna do Grande** |
| 4 | Item pizza na vitrine mostra **todos** os tamanhos da loja, mesmo os sem preço | Filtrar tamanhos sem preço (necessário pra Brotinho e Promocional) |
| 5 | `promocao_preco` é ignorado em item tipo pizza (preço vem da matriz) | Marcar Pizza Promocional com `tag = 'promocao'`, não com `promocao_preco` |

---

## 4. Estrutura final desejada no Menuzia

### 4.1 Catálogo da loja (tamanhos / bordas)

`tamanhos_padrao_pizza`:

| Nome | Fatias | Máx. sabores | Posição |
|---|---|---|---|
| Pequena | 4 | 1 | 0 |
| Média | 6 | 2 | 1 |
| Grande | 8 | 3 | 2 |
| Gigante | 12 | 4 | 3 |
| Brotinho | 4 | 1 | 4 |

`bordas_pizza`: 5 bordas a R$ 19,00.
`massas_pizza`: nenhuma (a origem não tem massas cadastradas).

### 4.2 Categorias (`grupos_cardapio`) e itens

| # | Categoria | Conteúdo | Tipo |
|---|---|---|---|
| 1 | Pizzas Salgadas | 1 item pizza, 56 sabores, preços em Pequena/Média/Grande/Gigante | pizza |
| 2 | Pizzas Doces | 1 item pizza, 19 sabores, preços em Pequena/Média/Grande/Gigante | pizza |
| 3 | Pizza Promocional | 1 item pizza, 15 sabores, preço só em Gigante (R$ 79), `tag='promocao'` | pizza |
| 4 | Pizza Brotinho | 1 item pizza, 20 sabores, preço só em Brotinho (R$ 49) | pizza |
| 5 | Hambúrguers | 16 itens simples | simples |
| 6 | Pizza Burguer | 3 itens simples (subcategoria própria na origem) | simples |
| 7 | Porções | 10 itens simples | simples |
| 8 | Massas | 6 itens simples | simples |
| 9 | Saladas | 1 item simples | simples |
| 10 | Sobremesas | 31 itens simples | simples |
| 11 | Bebidas | 26 itens (Refrigerante 20, Suco 4, Água 2) | simples |
| 12 | Cervejas e Vinhos | 10 itens (Cerveja 6, vinho 4) | simples |
| 13 | Molhos | 3 itens simples | simples |
| 14 | Congelados | 2 itens simples | simples |
| 15 | Loja Virtual | 9 itens simples | simples |

Os 4 itens de pizza reaproveitam os mesmos tamanhos da loja; o filtro da
lacuna #4 é o que faz a Brotinho mostrar só "Brotinho" e a Promocional só
"Gigante".

### 4.3 Presets de complementos (`presets_complementos`)

| Preset | Itens | Regra | Aplicado em |
|---|---|---|---|
| Adicionais de Pizza | 33 (preço do Grande) | opcional, múltipla | 4 itens de pizza |
| Adicionais de Hambúrguer | 22 | opcional, múltipla | 19 itens de hambúrguer |
| Adicionais de Massa | 19 | opcional, múltipla | 6 itens de massa |
| Adicionais de Porção | 3 | opcional, múltipla | 10 itens de porção |
| Adicionais de Salada | 3 | opcional, múltipla | 1 item de salada |

---

## 5. Fora de escopo

- Pedidos, clientes e histórico do sistema antigo.
- Programa de fidelidade e cupons da origem.
- Área de entrega / taxas por bairro (já configuráveis no Menuzia, decisão do lojista).
- Qualquer alteração no layout da folha de impressão térmica (CLAUDE.md §7).
