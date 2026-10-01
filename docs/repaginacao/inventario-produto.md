# Inventário do cadastro de produto (antes da repaginação, 2026-10-01)

Levantado do formulário em etapas (`app/admin/cardapio/page.tsx`, drawer "Novo/Editar item") e da
tabela `itens_cardapio`. Cada linha diz onde o campo foi parar no modal novo. Nada saiu.

| # | Campo (antes) | Coluna / origem | Onde ficou no modal novo |
|---|---|---|---|
| 1 | Tipo do item (Lanche/Simples, Açaí/Volumes, Pizza, Marmita) | `tipo_item` + "tem tamanhos" | Informações (no topo para item novo; em Configurações avançadas para item salvo) |
| 2 | Nome | `nome` | Informações |
| 3 | Descrição com negrito/cor e prévia | `descricao` (lib/descricao-rica) | Informações (mesmo editor, com a dica de formatação) |
| 4 | Foto + miniatura | `imagem_url`, `imagem_thumb_url` | Informações › coluna da esquerda (foto grande, Trocar, Remover) |
| 5 | Categoria | `grupo_id` | Informações |
| 6 | Preço / Preço base | `preco` | Informações (Preço de venda) |
| 7 | Preço promocional | `promocao_preco` | Informações (com o interruptor Promocional) |
| 8 | Tamanhos e preços da pizza (sabor × tamanho, ocultar tamanho) | `pizza_sabores`, `pizza_sabor_precos`, `pizza_tamanhos_ocultos` | Informações › Tamanhos e preços (mesmo componente) |
| 9 | Tamanhos (marmita) / Volumes (açaí) | `tamanhos_item` | Informações › Tamanhos e preços (mesmo componente) |
| 10 | Grupos de complementos (importar, criar, obrigatório, mín/máx, quantidade, pausar opção, ordenar) | `grupos_item_complementos`, `item_complementos` | Complementos |
| 11 | Adicionais avulsos (legado) | `item_complementos` sem grupo | Complementos |
| 12 | Mais vendido / Destaque (estrela) | `mais_vendido` | Informações (interruptor Destaque) + estrela da lista |
| 13 | Novidade (+ dias) | `novidade_ate` | Etiquetas |
| 14 | Combo especial | `combo_especial` | Etiquetas |
| 15 | Oferta limitada | `edicao_limitada` | Etiquetas |
| 16 | Item promocional | `item_promocional` | Etiquetas |
| 17 | Serve até X pessoas | `serve_pessoas` | Etiquetas |
| 18 | Tag personalizada + cor | `tag_personalizada`, `tag_personalizada_cor` | Etiquetas |
| 19 | Entrega grátis | `entrega_gratis` | Etiquetas (como antes, carregado no formulário) |
| 20 | Etiqueta antiga | `tag` | Preservada (lida como antes, regravada igual) |
| 21 | Ficha de preparo | `fichas_preparo` | Ficha de preparo |
| 22 | Status (Disponível/Pausado/Esgotado) | `status` | Disponibilidade |
| 23 | Dias disponíveis (D S T Q Q S S) | `dias_disponiveis` | Disponibilidade |
| 24 | Onde vender (Delivery/retirada, Salão/balcão) | `disponivel_delivery`, `disponivel_salao` | Disponibilidade |
| 25 | Ordem na categoria / na mesa | `posicao`, `posicao_mesa` | Não editados no modal (arrastar na lista) — preservados |
| 26 | Período da promoção | `promocao_inicio`, `promocao_fim` (existiam, sem tela) | Informações › Personalizar dia/hora da promoção |

## Campos novos (0130)
| Campo | Onde |
|---|---|
| Fotos extras (até 4) | `imagens_extras` — Informações, abaixo da foto |
| Dias da semana e horário da promoção | `promocao_dias`, `promocao_hora_inicio/fim` — Personalizar dia/hora |
| Preço de custo | `itens_cardapio_gestao.preco_custo` (só gestor lê) — Informações e Custo |
| Código PDV / Código interno | `itens_cardapio_gestao` — Informações |

A comparação campo a campo (antes × depois de abrir e salvar) está no e2e `e2e-produto-repaginado.mjs`.
