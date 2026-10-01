# PDV / Mesas — janelas sobre a tela, lançar itens, configurar item, sabor da pizza (2026-10-01)

Branch `feat/pdv-janelas`. Refina "PDV e Mesas – navegação sem telas empilhadas" (onde conflita, vale este).
Sem mudar lógica de negócio além do descrito. Deploy só 00:00–10:00.
Legenda: ⬜ a fazer · 🔧 em andamento · ✅ feito e testado · 🚀 no ar · ⚠️ ressalva

## 1. Modelo de navegação
- ⬜ Telas de fundo: grade de mesas e Lançar itens
- ⬜ Janelas por cima com fundo visível e escurecido (Conta, Configurar item, Receber, Fechar, Pendências, Cliente, Histórico, Cancelar)
- ⬜ Janelas pequenas (~480–560 px) sobre a janela atual sem fechá-la: Desconto, Taxas, confirmações
- ⬜ a) Mesa ocupada → Conta por cima da grade; mesa livre → abrir mesa como janela
- ⬜ b) Conta › Lançar → fundo vira Lançar itens daquela mesa, conta fecha
- ⬜ c) Lançar itens › Ver conta → Conta por cima
- ⬜ d) Só uma janela principal visível; a nova substitui na hora (sem empilhar duas grandes)
- ⬜ e) Voltar reabre a anterior igual; X fecha tudo (confirma só com dado não salvo); Esc e voltar do navegador
- ⬜ f) Desconto/Taxas como janela pequena sobre a Conta; conta atualiza ao aplicar
- ⬜ g) Ação concluída volta à anterior atualizada com toast
- ⬜ h) Transições ≤150 ms (transform/opacity)

## 2. Lançar itens
- ⬜ Categorias à esquerda + busca à direita na mesma linha (busca ~280–340 px, lupa e "x")
- ⬜ Muitas categorias rolam para o lado sem barra; busca sempre visível
- ⬜ Altura ~52 px, texto maior; linha fixa (sticky)
- ⬜ Telas estreitas: busca vira lupa que expande
- ⬜ Busca filtra em todas as categorias
- ⬜ Barra de baixo 80–88 px; selo do "Ver conta" no canto sem cobrir nada

## 3. Configurar item
- ⬜ Foto em destaque, nome, descrição, preço base
- ⬜ Opções em linhas grandes com miniatura (ou ícone neutro), preço, seleção grande ou contador
- ⬜ Obrigatórios claros ("Escolha 1", quantos faltam)
- ⬜ Quantidade + "Adicionar · R$" ao vivo; se faltar algo, mostra e rola até o grupo
- ⬜ Imagens leves (lazy)
- ⬜ BUG do sabor: causa real investigada e registrada
- ⬜ Sabores corretos por tamanho no PDV e na vitrine (mesma regra)
- ⬜ Sabor do próprio produto pré-selecionado; meio a meio respeitando limite e preço
- ⬜ Grupo obrigatório sem opções não trava a venda (aviso + log)
- ⬜ Admin avisa ao salvar produto com grupo obrigatório sem opções em algum tamanho
- ⬜ Outras lojas verificadas (só leitura) e listadas

## 4. Conta da mesa
- ⬜ Barra de ações 80–88 px, ícone ~28 px; Receber/Fechar na mesma altura
- ⬜ "+ Lançar itens" grande na coluna direita
- ⬜ Desconto em pílula verde, taxas em pílula azul, "x" para remover (confirmação + permissão); taxa zero mais clara
- ⬜ Mesmas cores no Receber e no Fechar conta

## 5. Botão flutuante
- ⬜ Escondido no PDV, Mesas, Comandas e Balcão

## 6. Testes
- ⬜ Navegação completa (mesa → conta → lançar → configurar → adicionar → ver conta → desconto/taxas → receber/voltar → fechar)
- ⬜ Lançar itens (linha única, rolagem, busca, sticky, selo)
- ⬜ Pizza (tamanhos, pré-seleção, meio a meio, cozinha/impressão virtual, vitrine) + grupo vazio
- ⬜ Testes automatizados da regra de sabores e grupo vazio
- ⬜ 1024×768, 1280×800, 1366×768, 1920×1080 e celular
- ⬜ Regressão (valores, taxas, descontos, pagamentos, fechamento, impressão, cozinha, caixa, açaí)
- ⬜ Prints antes/depois

## 7. Publicação
- ⬜ Menuzia (TESTE cancelados) · deploy 00:00–10:00 · conferência · relatório

## Registro
- 2026-10-01 tarde: início.
