# Retoque visual — painel, vitrine e PDV/Mesas (2026-10-01)

Branch `feat/retoque-visual`. Deploy só 00:00–10:00. Decisões do dono (01/10): recibo/extrato IMPRESSO e
Assistente de Impressão intactos (taxas separadas só na tela, pré-conta na tela, fechamento e financeiro);
conferência do painel em produção só com o dono logado (eu não digito senha em produção).
Legenda: ⬜ a fazer · 🔧 em andamento · ✅ feito e testado · 🚀 no ar · ⚠️ ressalva

## 1. Clientes
- ⬜ 1.1 Rolagem vertical própria (altura até o fim da tela) com cabeçalho fixo
- ⬜ 1.1 Rolagem horizontal com a coluna "Cliente" fixa à esquerda
- ⬜ 1.1 Barra de rolagem fina e discreta (mouse, trackpad, toque)
- ⬜ 1.1 Paginação/carregamento por partes + virtualização; busca em TODOS os clientes
- ⬜ 1.2 Busca e "Exportar CSV (Meta Ads)" dentro do card, à direita do título
- ⬜ 1.2 "Clientes · 175 clientes" / "12 de 175 clientes"
- ⬜ 1.2 Celular: título/contador em cima, busca/botão embaixo em largura total

## 2. Painel de Pedidos — cards de resumo
- ⬜ Componente compartilhado com Clientes (ícone em círculo, rótulo pequeno cinza, valor grande)
- ⬜ 4 cards (laranja, azul, roxo, verde), faturamento em verde, tempo real mantido; kanban e botões intactos

## 3. Ajustes — bug do "aviso em texto" com e-mail
- ⬜ a) Autopreenchimento do navegador (autocomplete, name/id, campos ocultos)
- ⬜ b) Dado salvo: vazio limpa de verdade; outras lojas conferidas (leitura)
- ⬜ Teste: apagar, salvar, recarregar, relogar

## 4. Aviso da vitrine personalizável
- ⬜ Cor do texto e do fundo (paleta + hex), ícone acompanha o texto
- ⬜ Efeito pulsar (transform/opacity, ~1,2 s), botão Padrão
- ⬜ Prévia ao vivo + alerta de contraste
- ⬜ Migration por loja + rollback; lojas atuais no padrão

## 5. Cupom/prêmio na vitrine
- ⬜ 5.1 Faixa azul (#E0F2FE/#0369A1), ícone SVG local com balanço, pulsar leve; mesmo texto e lógica
- ⬜ 5.2 Clique → aba Cupons com o disponível em destaque; botão Resgatar
- ⬜ 5.2 Sucesso: check + confetes CSS (~1 s) + vibração; cupom aplicado / brinde na sacola; vai para a sacola
- ⬜ 5.3 Só consome no pedido concluído (servidor); remover/esvaziar/abandonar/falhar → volta; uso duplo bloqueado; motivo quando inválido

## 6. Mesas, comandas e PDV
- ⬜ 6.1 Lançar itens: toast de sucesso com "Ver conta"; barra de baixo [Mesas] [Ver conta + badge] [Lançar na cozinha]; topo livre para o novo pedido
- ⬜ 6.2 Conta da mesa: barra de ações fixa embaixo (Receber, Fechar conta grandes; secundárias com ícone; Cancelar separado com confirmação); coluna da direita só resumo + cupom; fotos na lista
- ⬜ 6.3 Nome do cliente com sugestões da base (2+ caracteres, debounce, toque/teclado), em mesa/comanda, balcão, PDV e "Cliente" da conta
- ⬜ 6.4 Fechar conta em etapas: pendentes (decidir todos) → taxas (várias, padrão em Ajustes › Mesas) → pagamento (saldo coberto; zero com confirmação e auditoria)
- ⬜ 6.5 Pagamento no padrão do PDV (duas colunas, botões grandes, teclado numérico, atalhos, troco, dividir)
- ⬜ 6.6 Selos coloridos de status (balcão, mesas/comandas, conta); linha com ação pendente destacada
- ⬜ 6.7 Fotos (40–48 px, lazy) em todas as listas do PDV/Mesas

## 7. Testes
- ⬜ Clientes · Painel (lado a lado) · bug e-mail · aviso · cupom (fluxos e uso duplo) · mesas/PDV (todos os itens) · desempenho (CPU 4x, reduced-motion) · regressão

## 8. Publicação
- ⬜ Backup + migrations + deploy (00:00–10:00) + conferência (painel com o dono logado) · TESTE removidos · relatório

## Registro
- 04:0x início.
