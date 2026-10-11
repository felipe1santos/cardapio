# Decisões da noite — 10/10/2026 (trabalho autônomo, dono ausente)

Regra da noite: toda novidade VISÍVEL fica atrás da chave por loja **"Novidades em teste"**
(`restaurantes.novidades_teste`, migração 0178), ligada só na Menuzia. Sem a chave, tudo como antes.

## Bloco 0 — menus

| # | Decisão | Por quê |
|---|---|---|
| N1 | A chave mora em `restaurantes.novidades_teste` e chega ao painel pelo `/api/sessao/estado` (`novidades`). | Uma leitura que o painel já faz; nenhum pedido a mais. |
| N2 | A reorganização de menus (publicada para todas às 23:28, commit 07ac8ee) foi para trás da chave às 23:46 (2bb3c7b). Lojas reais voltaram ao menu de antes. | Ordem do dono: novidades só na Menuzia. |
| N3 | Links do painel (ícone de impressora, alertas, PDV, Fidelidade) voltaram aos endereços antigos; com a chave, as páginas antigas levam às novas. | Sem a chave, nenhuma tela nova aparece nem de passagem. |
| N4 | Para conferir "como uma loja real vê", desliguei a chave **só da Menuzia** por alguns minutos e religuei. | Não tenho (nem devo ter) a senha de loja real; a Menuzia sem a chave é idêntica. |
| N5 | **Bug achado na conferência:** sem a chave, Agente de IA e Impressão ficaram sem ícone no menu (a reorganização tinha tirado os desenhos). Corrigido em fa87fd1 + teste "todo item do menu tem ícone". | — |
| N6 | Super Admin: coluna e ação "Novidades em teste" por loja; "Liberar novidades para todas" pede LIBERAR digitado. Tudo na auditoria da loja e da plataforma. | Igual ao padrão do "Excluir dados" e do Beta da impressão. |
| N7 | O módulo Disparos está bloqueado na Menuzia desde 22:38 (ação do dono no Super Admin). Não religuei. | Decisão do dono. |

## Bloco 1 — fotos do item

| # | Decisão | Por quê |
|---|---|---|
| F1 | Sem migração: 1ª foto = `imagem_url`/`imagem_thumb_url`; as outras = `imagens_extras` (0130, que já existia). | O banco já guardava até 4 extras; só faltava a tela e a vitrine. |
| F2 | Limite novo de 4 no TOTAL só vale para quem adiciona. Item antigo com principal + 4 extras continua com as 5. | "Nada some". |
| F3 | Recusa não-imagem e arquivo acima de 15 MB antes de enviar; a otimização de sempre reduz para 1200 px / WebP. | Mensagem clara; a otimização já existente cumpre o "~200 KB". |
| F4 | Carrossel só na ficha do item (tela de adicionais), por scroll-snap nativo; com capa de gaveta, fica a capa (como antes). | Deslizar sem biblioteca; não mexer no comportamento da gaveta. |
| F5 | **0179** dá à vitrine (anon) leitura da coluna `novidades_teste`. | `restaurantes` tem SELECT POR COLUNA: sem isso, pôr a coluna no select derrubaria a vitrine de todas as lojas. Pego antes de publicar. |
| F6 | Bug achado na conferência: a seta do carrossel não andava numa aba sem animação → completa a rolagem se a suave não andar (b70edbc). | — |

## Bloco 2 — origem das vendas

| # | Decisão | Por quê |
|---|---|---|
| O1 | A origem já existia (itens 55/56: última origem não-direta em 7 dias, gravada no pedido, selo no card, "Origem das visitas"). Melhorei em vez de duplicar. | Pedido do dono. |
| O2 | Primeira origem: guardada no aparelho (`mz-origem1-<slug>`) na 1ª abertura, mesmo direta, nunca trocada; vai em `origem_detalhe.primeira` (sem migração). Também `utm_content`. | Invisível, todas as lojas; o servidor recalcula o canal. |
| O3 | QR da mesa e do balcão não ganharam etiqueta: pedido de mesa/balcão já é canal próprio (Mesa / PDV). | Evitar mudar o QR impresso (impressão aprovada). |
| O4 | Card: só acrescentei o selo "Direto" e "?" (sem origem) — PDV e Salão já tinham etiqueta; os outros selos já existiam. | Não aumentar o card. |
| O5 | "Vendas por origem" usa a MESMA lista de pedidos do Resumo (total bate por construção; conferido: R$ 2.044,63 nos dois). | Pedido do dono. |
| O6 | **Não fiz um pedido real na Menuzia**: o checkout exige o código do WhatsApp num telefone que eu não leio. Conferi a captura no navegador (primeira = Google/site, última = Instagram/bio) e a gravação pelos testes do servidor. | Não forçar o login do cliente. |
| O7 | Links legíveis (endereço do cardápio + utm), sem encurtador externo. | Pedido do dono; nada de serviço externo. |

## Bloco 3 — segurança

| # | Decisão | Por quê |
|---|---|---|
| S1 | Isolamento em duas camadas: guarda estática (build + suíte: nenhuma rota escolhe a loja pela requisição) e teste real local com 2 lojas (91 tabelas, 76 GET, 35 alterações). Resultado: **nenhum vazamento**. | O teste real precisa de banco/servidor locais; a guarda roda em todo build. |
| S2 | `grupos_cardapio` e `itens_cardapio` legíveis por outra loja = cardápio público de propósito (até o visitante lê). Não é vazamento. | Política "Anyone can read menu items" da vitrine. |
| S3 | Cadastro (`verificar-email`/`verificar-usuario`) continua dizendo "já em uso". | É o cadastro, não o login; já tem limite de 20/min por IP. Fica para o dono decidir. |
| S4 | 0180 retirou TRUNCATE de anon/authenticated (42 grants) e das tabelas futuras; rollback exato salvo. | Nenhuma função usa; TRUNCATE não respeita RLS. |
| S5 | Prints: a partir de ~00:20 a janela do Chrome parou de desenhar (tela bloqueada). As conferências seguintes foram feitas lendo a página (DOM), sem print. | — |
