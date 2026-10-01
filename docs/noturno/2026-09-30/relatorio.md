# Relatório — tarefa noturna 30/09 → 01/10/2026

## 1. Resumo

- **As 7 fases estão no ar em produção.** Os deploys foram feitos entre 00:00 e ~02:10 (horário de Brasília). Exceção: o push da Fase 1 saiu às 23:59 (ver §6).
- **Migrations 0117 a 0121 aplicadas.** Antes de cada uma: backup em `~/backups/menuzia/2026-10-01-pre-NNNN` e dry-run com conferência.
- **Testes:** vitest 1802 ✅. Em cada fase, e2e local com prints em `prints/faseN/`. As suítes de regressão rodaram verdes (lista na §2).
- **O que ficou pendente:**
  - envio real de WhatsApp para o número de teste (o WhatsApp da Menuzia está desconectado);
  - smoke do painel em produção na loja Menuzia (a sessão do Chrome está em outra loja e eu não digito senha em produção).
- **Nenhuma mensagem real foi enviada a clientes. Nada foi impresso em impressora física. Nenhum dado de loja real foi apagado.**
- **Impressão:** o recibo e o Assistente não foram tocados. Na Fase 7 só mudou *quando* o pedido agendado entra na fila.
- **O que ficou desligado por padrão:**
  - agendamento (todas as lojas);
  - acessos por funcionário (todo mundo segue no "padrão do papel" até o dono editar);
  - botões de campanha (só aparecem se a loja preencher).

## 2. Tabela por fase

| Fase | O que entrou | Testes | Deploy |
|---|---|---|---|
| 1 Bugs | Robô (toggle, webhook, estado), checkout no celular, prévia do link, produtos com nome-código / R$ 0 | integrações 26/26, robô 106/106, checkout 360/390/414 72/72, prévia ok | b6531de 00:05 · smoke público ok |
| 2 Menu lateral | Card da loja com sino e alerta, modal "Resolver", "copiar link" na linha "Ver meu cardápio" | e2e-menu-lateral 16/16 | ac6fffa 00:06 |
| 3 Vitrine | Banner 1,41:1, "Mais Pedidos", etiquetas (0117), preço com desconto, botão WhatsApp | vitrine 51/51, admin-etiquetas 7/7 | 56efcc0 00:18 · smoke 360/390/414 15/15 |
| 4 Botões | Até 2 botões de link nas campanhas (0118), enviados como links no texto | campanha-botoes 9/9, campanhas 63/63 | 298942e ~00:26 |
| 5 Cozinha | Menu Cozinha, estações em cartões com QR, KDS novo, ficha "Como fazer" (0119) | cozinha 26/26, ficha 2/2 | ad89bff ~00:50 |
| 6 Permissões | Acessos por área e ações sensíveis, modelos, menu filtrado, checagem no servidor (0120) | equipe-acessos 27/27 + 11 suítes de regressão | f415e59 ~01:35 |
| 7 Agendamento | Agendar na vitrine, faixa "Agendados", liberação perto do horário, Ajustes (0121) | agendamento 25/25 + 6 suítes de regressão | 6a15b99 ~02:10 |

**Suítes de regressão rodadas na noite:**
- garçom 47
- PDV v2 70
- regressão-release 52
- estabilidade 53
- caixa 18
- checkpoint-e 85/86 (a única falha é o "defina QRDIR", que já falhava antes, por ambiente)
- balcão 84
- atendimento 71
- robô 106
- campanhas 63
- checkout 72
- cozinha 26

## 3. Causas (Fase 1)

### Robô que "não ativava"
- O interruptor ficava travado enquanto o estado da conexão era "verificando".
- A rota de status esperava o registro do webhook na Evolution antes de responder. Com a Evolution lenta, a tela ficava presa nesse estado.
- **Correção:**
  - o interruptor só trava quando a desconexão está confirmada;
  - a consulta de estado tem limite de 8 s;
  - o registro do webhook não bloqueia mais a resposta;
  - a tela atualiza a cada 30 s e quando volta a ficar visível.
- Webhook: a conferência (só leitura, 02:1x) mostra as 5 lojas com instância (Belgas, Estância, Menuzia, Nossa Cozinha, Villa Lanches) já com o webhook do Menuzia registrado no lote anterior. Nesta noite não houve escrita em outras lojas; o registro agora também acontece sozinho quando a loja conecta.

### Prévia borrada do link
- A og:image era a imagem crua da loja (logo ou banner). Ela tinha proporção e peso errados, e o WhatsApp a recortava ou reduzia.
- **Correção:** agora há uma prévia própria, `/api/loja/[slug]/previa`:
  - JPEG de 1200×630 com menos de 300 KB, em URL absoluta;
  - versão na URL, para o WhatsApp não usar a imagem antiga do cache;
  - meta og/twitter completas;
  - quando não há imagem, usa logo + nome + cor da loja.
- Resultado medido em produção: Menuzia 26 KB, Villa 85 KB.

### Produtos com nome em código
- O cadastro em massa por foto usava o nome do arquivo (UUID, hash ou "download") como nome do produto.
- **Correção:**
  - o upload agora detecta esses padrões e pede um nome;
  - a vitrine esconde item com nome-código e item vendável com preço R$ 0.
- 9 itens assim foram pausados na Menuzia.
- Em outras lojas fiz só leitura. Na Mama Pizza, "ESFIHA DE OVOMALTINE" está a R$ 0 e agora fica oculta na vitrine. O dono dessa loja deve corrigir o preço.

## 4. Fase 3 — vitrine

**Comparações lado a lado** com as referências, em `prints/fase3/`:
- `lado-a-lado-banner.jpg`
- `lado-a-lado-destaques.jpg`
- `lado-a-lado-etiquetas.jpg`

**Banner:**
- Proporção **1,41:1** (`aspect-[141/100]`), cantos de 10px, margem de 16px.
- Tamanho recomendado no Ajustes: 1200×850.
- No desktop, largura máxima de 640px.

**Etiquetas (fundo / texto):**

| Etiqueta | Fundo | Texto |
|---|---|---|
| Novidade | #A3F7B5 | #14532D |
| Mais pedido | #FFEDD5 | #9A3412 |
| Edição limitada | #FCE7F3 | #BE185D |
| Entrega grátis | #EEF3F5 | #2E6788 |
| Promocional | — | #2E6788 |
| Serve N pessoas | — | #3E3E3E |

A cor do texto da Novidade foi escurecida para dar contraste (ver §6).

**Ícones e licença:**
- Fluent UI Emoji (Microsoft), licença **MIT**.
- Os arquivos estão em `public/vitrine/emoji/`; a licença está em `LICENSE-fluentui-emoji.txt`.
- O ícone do WhatsApp é SVG próprio, em `public/vitrine/whatsapp.svg`.

**Botão "Tirar dúvidas":** abre o wa.me com o **número de cada loja**.

## 5. Fase 4 — provedor de WhatsApp

- As lojas usam Evolution API 2.3.7 com Baileys (conexão por QR).
- Os botões interativos não são confiáveis nesse modo: aparecem para uns e somem para outros, e a issue #2390 foi fechada como "not planned".
- **Decisão:** os botões sempre saem como links no texto. O histórico mostra "(botões enviados como links no texto)".
- Botões nativos só ficam confiáveis com a API oficial do WhatsApp Business (integração `WHATSAPP-BUSINESS` da Evolution). Detalhes em `fase4-pesquisa-botoes.md`.

## 6. Decisões tomadas sem perguntar

- **Botão WhatsApp na vitrine:** some quando a sacola está aberta, para não cobrir o botão de finalizar.
- **Título "Mais Pedidos"** para a seção de destaques.
- **Cores da Novidade** ajustadas para ter contraste legível.
- **Banner** com proporção 1,41 e largura máxima de 640px no desktop.
- **Itens R$ 0 vendáveis** ficam ocultos na vitrine. Pizza com preço por tamanho não é afetada.
- **"Copiar link"** saiu do rodapé do menu e foi para a linha "Ver meu cardápio".
- **Modelo Cozinha** = papel atendente com só o Painel de Pedidos. A tela de preparo continua sendo o link da estação, sem login.
- **Modelo Entregador/Logística** = papel `logistica`, que passou a ser cadastrável pelo dono. A suíte checkpoint-e foi ajustada para isso.
- **Dashboard** exige, além da área, a permissão "ver valores/relatórios financeiros".
- **Agendamento:**
  - não criei status novo: o pedido nasce "recebido" com `agendado_para` preenchido;
  - ele entra no fluxo `agendamento_libera_min` minutos antes (padrão 30), sem job: cada tela compara com o relógio;
  - os itens são conferidos pelo dia e hora do agendamento, não pelo momento da compra.
- **Push da Fase 1 às 23:59:26, Redeploy às 23:59:52** — 8 s antes da janela. O build terminou e entrou no ar às 00:05.
- **Memória do PC:** às 01:2x o Windows derrubou o servidor local e as suítes por falta de memória. Retomei uma por vez, todas verdes.

## 7. Dados TESTE criados

**Na Menuzia (produção):**
- nenhum pedido, funcionário, estação, ficha, banner, campanha ou tag de teste;
- a única escrita foram os 9 itens com nome-código, que foram **pausados** (não apagados).

**Em outras lojas:** nenhuma escrita (só leitura para diagnóstico).

**Local (stack de desenvolvimento):**
- funcionários "TESTE …" na cantina-pdv2, desativados no fim;
- pedidos, estação e config de agendamento na ordem-qr-e2e, apagados e restaurados no fim.
- Efeito colateral local: os pedidos ativos da cantina-pdv2 ficaram como "entregue", porque um gatilho impede voltar o status.

## 8. O que não foi testado

- **Envio real de WhatsApp** (prévia do link, botões de campanha, confirmação do agendado) para 5527992534407. O WhatsApp da Menuzia está desconectado. Zero mensagens reais na noite.
- **Painel em produção logado na Menuzia** (menu novo, campanhas, Cozinha, Equipe, agendamento no Kanban e em Ajustes). A sessão do Chrome é do Ponto 400; ali fiz só leitura, e o dono vê o menu completo e a coluna "Acessos". Não digito senha em produção.
- **Impressora física:** de propósito. A fila foi testada pela função do banco.

**Limitação conhecida do agendamento:** com a loja fechada, uma categoria com horário próprio (ex.: Pizzas 18h–23h) continua escondida na vitrine fora da janela. Para a regra valer pelo horário agendado também na vitrine, o próximo passo é usar a hora escolhida no filtro.

## 9. Próximos passos

1. Logar na Menuzia e conferir:
   - o menu lateral;
   - Cozinha › estações;
   - Equipe › Editar acessos;
   - Ajustes › Loja › Pedidos agendados, ligando só para testar e desligando depois.
2. Reconectar o WhatsApp da Menuzia e mandar 1 teste para 5527992534407:
   - link da loja, para ver a prévia;
   - campanha com botão;
   - um pedido agendado.
3. Corrigir o preço da "ESFIHA DE OVOMALTINE" (Mama Pizza) e renomear os 9 itens pausados da Menuzia.
4. Vitrine em modo "Somente agendados": filtrar categorias com horário pela hora agendada.
5. Botões nativos de WhatsApp só migrando para a API oficial (custo por conversa).
