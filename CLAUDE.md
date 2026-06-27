# Menuzia — Plataforma SaaS de Cardápio Digital & Gestão de Delivery

## 1. O que é este projeto

A **Menuzia** é uma plataforma **multi-tenant (SaaS)**: vários restaurantes/lojas usarão o
mesmo sistema, cada um com seu próprio cardápio, pedidos, equipe e entregadores — com
isolamento total de dados entre lojas (tenants).

O sistema tem **dois lados**:

1. **Painel administrativo** (uso interno do restaurante: dono, atendentes, cozinha,
   logística) — composto pelos módulos Dashboard, Painel de Pedidos (Kanban), Logística
   (entregas) e Gestor de Cardápio.
2. **Cardápio digital do cliente final** (`cliente.html`) — a vitrine pública onde o
   consumidor navega, monta o pedido e acompanha a entrega.

Hoje existem 4 protótipos estáticos em HTML/CSS/JS na raiz do projeto, com **dados
mockados**, que servem como referência **de design e de telas**, mas **não implementam o
funcionamento real** (não há backend, banco de dados, autenticação, nem sincronização
entre as telas). A tarefa é transformar isso em um **produto real, full-stack,
multi-tenant**, mantendo (e em um caso, refazendo) a identidade visual.

Arquivos de referência (raiz do projeto):
- `dashboard.html` — Dashboard de métricas/faturamento
- `kanban.html` — Painel de Pedidos (Kanban)
- `cardapiro-admin.html` — Gestor de Cardápio (admin)
- `cliente.html` — Cardápio do cliente final (⚠️ **fora do padrão visual — ver seção 6**)

---

## 2. Stack e arquitetura — a ser definida por você (Claude Code)

Não está decidido ainda qual stack usar. **Antes de escrever qualquer linha de código de
produto**, analise os requisitos abaixo (multi-tenant, tempo real entre módulos, upload de
imagens, autenticação/papéis de usuário, app de cliente final responsivo e fluido) e
**proponha** a stack mais adequada — com justificativa — para minha aprovação. Considere
pelo menos:

- Framework front-end (ex.: Next.js + Tailwind CSS, ou outra opção que você julgue
  superior para SSR/SEO do cardápio público + performance do painel admin);
- Camada de dados/backend (ORM, banco relacional, necessidade de tempo real —
  websockets/SSE/polling — para o pedido fluir do cliente → kanban → logística →
  dashboard);
- Estratégia de autenticação e controle de papéis (dono da loja, atendente, cozinha,
  entregador);
- Estrutura multi-tenant (isolamento de dados por restaurante/loja, subdomínio ou
  slug por loja, etc.);
- Armazenamento de imagens (fotos dos itens do cardápio).

Não presuma que precisa manter HTML/CSS/JS puro só porque os protótipos foram feitos
assim — eles são apenas a referência visual.

---

## 3. Identidade visual / Design System "Menuzia"

Os três painéis administrativos (`dashboard.html`, `kanban.html`,
`cardapiro-admin.html`) já seguem um design system consistente — **esse é o padrão
oficial a ser preservado e expandido** (inclusive no cardápio do cliente, adaptando para
um contexto mobile-first de vitrine).

> **⚠️ Paleta e fonte oficiais — sempre seguir em qualquer alteração visual.**
> A paleta de cores abaixo e a fonte **Inter** (a mesma usada no painel de despacho
> de rotas e em todo o app) são o padrão oficial da Menuzia. Toda mudança de UI em
> qualquer módulo — incluindo o **PDV** — deve usar exatamente estas cores, a fonte
> Inter e o radius `3px`. Não introduzir cores ou fontes fora desta paleta.

### Paleta de cores
```
--bg-main:      #FFFFFF   (superfícies/cards)
--bg-page:      #EDEEF1   (fundo da aplicação)
--border-color: #E5E7EB
--text-main:    #1F2937
--text-subtle:  #6B7280

--sidebar-bg:    #111827
--sidebar-hover: #1F2937
--sidebar-text:  #9CA3AF

--primary:      #0688D4   (azul — cor de marca)
--primary-dark: #0570AE

--status-pending:   #F97316  (laranja — pedido recebido)
--status-preparing: #3B82F6  (azul — preparando)
--status-ready:     #10B981  (verde — pronto)

--bg-price:  #DCFCE7  --text-price: #16A34A   (preço/valores positivos)
--bg-alert:  #E0F2FE  --text-alert: #0369A1   (informativo)
--danger:    #EF4444  --bg-danger: #FEE2E2
--warn:      #F59E0B  --bg-warn:  #FEF3C7
--purple:    #A855F7  (uso pontual, ex. categorias no dashboard)
```

### Tipografia e tom visual
- Fonte: **Inter** (Google Fonts, pesos 400/500/600/700/800), `font-size` base 14px.
- **`--radius-max: 3px`** — cantos quase retos em todos os elementos (cards, botões,
  inputs, badges, thumbnails). Essa "quadratura" é uma marca registrada do visual Menuzia
  — não usar `border-radius` arredondado generoso, exceto em elementos circulares
  (avatares, dots de status, steppers, sheets de mobile).
- Paleta enxuta, fundo neutro `--bg-page` cinza-azulado, cards brancos com borda fina
  `1px solid var(--border-color)` e sombras discretas.
- Botões: caixa alta, `font-size: 11px`, `letter-spacing`, peso 600 — variantes
  `primary` (ciano), `secondary` (cinza), `outline`, `success` (verde), `dispatch`
  (escuro), `ghost`.

### Padrões estruturais do painel administrativo
- **Sidebar fixa** à esquerda (`240px`, colapsável para `70px`), fundo escuro
  `--sidebar-bg`, com topo na cor primária e navegação por ícones com texto abaixo.
  Item ativo destacado com borda esquerda `--primary`.
- **Top bar** de 60px com título da seção + breadcrumb + ações contextuais.
- **Drawers laterais** (slide-in pela direita) para criar/editar registros (pedido,
  item de cardápio, presets de complementos).
- Indicadores de status sempre como **badges/pills** coloridos (ex.:
  Disponível/Pausado/Esgotado, Pago/A receber, Entrega/Retirada).
- Gráficos em SVG nativo (linha suave, donut, barras) — sem libs pesadas de gráfico.

### Padrão do cardápio do cliente (mobile-first / vitrine)
- Contêiner central tipo "app" (`max-width: 600px`), cartão de loja com capa em
  gradiente, badge de "aberto agora", chips de categoria com scroll horizontal sticky.
- Lista de produtos com foto, descrição truncada e preço em destaque (`--text-price`).
- Interações via **bottom sheets** (detalhe do produto, sacola) e **telas full-screen**
  deslizantes (checkout em etapas, acompanhamento do pedido com timeline vertical).
- Barra de sacola flutuante que aparece quando há itens.

> Use esse mesmo vocabulário visual (cores, radius, tipografia, tom dos componentes) em
> toda tela nova que você criar — o objetivo é que dashboard, pedidos, logística,
> cardápio admin e cardápio do cliente pareçam parte do **mesmo produto**.

---

## 4. Módulos do sistema e como cada um funciona

### 4.1 Dashboard
Visão consolidada de desempenho do restaurante: faturamento (hoje/semana/mês/ano/tudo),
ticket médio, distribuição por categoria, formas de pagamento, top itens vendidos,
canal (entrega x retirada), horário de pico e taxa de conclusão. Hoje é só uma
visualização — no produto final, todos esses números devem vir de dados reais
agregados a partir dos pedidos do tenant logado.

### 4.2 Painel de Pedidos (Kanban)
Fluxo de vida de um pedido dentro da cozinha/loja:

1. **Pedido Recebido** — pedido novo chega em tempo real (feito pelo cliente no
   cardápio digital, ou inserido manualmente pelo atendente). O operador pode **aceitar**
   o pedido (avança para "Preparando") ou abrir os detalhes.
2. **Preparando** — cozinha está montando o pedido. Operador marca como **Pronto**
   quando finalizado.
3. **Pronto p/ Despacho** — pedido finalizado, aguardando ser roteado.
   - Se for **retirada (pickup)**, o operador marca como **Entregue** diretamente aqui
     (cliente retira no balcão).
   - Se for **entrega (delivery)**, o pedido é **enviado para o módulo de Logística**
     (não fica esperando no kanban — ele "sai" dessa tela e aparece na aba de
     entregas/logística para ser despachado a um entregador).

Cards de pedido devem trazer: ID, tipo (entrega/retirada), tempo decorrido (com
indicação visual de atraso), cliente, bairro/distância, itens (resumidos), forma de
pagamento e status de pagamento (pago/a receber), valor total. Drag-and-drop entre
colunas e botões de ação avançam o status. Um drawer de detalhes mostra timeline
completa do pedido, itens com complementos, dados do cliente e endereço.

> Pedidos novos devem chegar **em tempo real** (sem precisar dar refresh) — o operador
> da cozinha precisa ver o pedido aparecer assim que o cliente finaliza a compra.

### 4.3 Logística / Entregas (novo módulo — outro item do menu lateral)
Tela dedicada à distribuição de pedidos prontos para entrega. Funcionamento:

- Lista de **entregadores disponíveis** (nome, status online/ocupado/offline, quantas
  entregas estão em andamento).
- Lista de **pedidos prontos para despachar** (vindos do Kanban, etapa "Pronto" +
  tipo entrega).
- O operador **distribui/atribui** cada pedido a um entregador disponível
  (manual, ou com sugestão do sistema por proximidade/carga de trabalho — a definir).
- Cada pedido em rota mostra claramente a **forma de pagamento** (dinheiro, cartão,
  Pix etc.) e, quando for **dinheiro**, se o cliente **precisa de troco** e para qual
  valor (ex. "troco para R$ 50,00").
- **Controle de caixa do entregador**: ao final do turno/rota, o sistema precisa
  registrar quanto **dinheiro físico** o entregador arrecadou (somatório dos pedidos
  pagos em espécie) e quanto ele **levou de troco** consigo (e quanto efetivamente
  devolveu/usou) — para conferência de caixa entre o que saiu, o que voltou e o que foi
  recebido. Modele isso como um **fechamento de caixa por entregador/rota**
  (valor esperado x valor declarado x diferença).
- Status do pedido evolui para **Saiu para entrega** → **Entregue**, refletindo na
  timeline que o cliente acompanha.

### 4.4 Gestor de Cardápio (admin)
Onde o dono/gestor da loja monta e mantém o cardápio:

- **Cadastro de itens**: nome, descrição, categoria/grupo, preço, **upload de fotos**
  (imagem real do prato — os protótipos usam placeholders/emoji, no produto final deve
  haver upload e exibição da imagem do item).
- **Complementos e adicionais**: cada item pode ter complementos (ex. "Bacon extra: +R$
  4,00") com nome e valor próprios, marcados como obrigatórios/opcionais e com seleção
  única ou múltipla.
- **Grupos/presets de complementos**: conjuntos reutilizáveis de complementos (ex.
  "Adicionais de Burger") que podem ser **importados com um clique** em qualquer item,
  e depois ajustados individualmente sem afetar o preset original — agiliza o cadastro
  em massa.
- **Grupos do cardápio** (categorias): organização dos itens em grupos (Lanches,
  Combos, Bebidas, Sobremesas, Porções etc.), com contagem de itens, criação,
  reordenação.
- **Promoções/descontos**: possibilidade de aplicar desconto promocional a um item
  específico (percentual ou valor fixo), com data de início/fim quando fizer sentido.
  Esse item passa a ser exibido como "em promoção" no cardápio do cliente (ver 4.5).
- **Disponibilidade por dia da semana**: cada item pode ser marcado como
  disponível/indisponível em dias específicos (ex. "só de quinta a domingo") — refletido
  nos toggles de dia já presentes no protótipo (`D S T Q Q S S`).
- **Status do item**: Disponível / Pausado / Esgotado — controla se aparece e se pode
  ser pedido no cardápio do cliente.
- Visões em **tabela** (edição em massa, seleção múltipla, ações em lote — esgotar,
  pausar, excluir) e em **grade/grid** (cartões visuais com foto).

### 4.5 Cardápio do cliente final (`cliente.html`)
A vitrine pública — onde o consumidor decide o que comprar. Funcionamento esperado:

- **Navegação inferior fixa (bottom nav)** com 3 destinos: **Home** (cardápio
  completo, por categorias), **Promoções** (lista filtrada só com itens em
  desconto/promoção) e **Carrinho** (sacola com os itens selecionados). Esse bottom nav
  não existe no protótipo atual e precisa ser criado.
- **Itens em promoção** devem se destacar visualmente: preço em **verde**
  (`--text-price #16A34A`) sobre **fundo verde claro** (`--bg-price #DCFCE7`), de forma
  consistente com o badge de preço já usado no resto do sistema — deixando claro, à
  primeira vista, que aquele item está com desconto (pode também mostrar o preço
  original riscado ao lado).
- Fluxo completo: navegar pelo cardápio → abrir detalhe do produto (com observações,
  ponto da carne, adicionais obrigatórios/opcionais, quantidade) → adicionar à sacola →
  revisar carrinho → checkout em etapas (pagamento → endereço → revisão) → confirmação →
  **acompanhamento do pedido em tempo real** (timeline: recebido → preparando → pronto →
  saiu para entrega → entregue), espelhando o status que o operador está movendo no
  Kanban/Logística.
- Quando a forma de pagamento for **dinheiro**, perguntar se precisa de troco e para
  qual valor (esse dado deve chegar até o módulo de Logística — ver 4.3).

---

## 5. Atenção especial: redesenhar o `cliente.html`

O `cliente.html` atual **não segue o padrão visual do restante do sistema** — ele tem
uma "cara de protótipo gerado por IA" (emojis como imagem de produto, gradientes
genéricos, hierarquia visual burocrática) que destoa da identidade Menuzia (paleta
ciano + neutros, radius quase reto, tipografia Inter, tom premium e enxuto dos outros
três painéis).

**Instruções para o redesign** (use a skill de frontend-design já instalada):

- Recriar o cardápio do cliente como uma **vitrine premium de delivery**: a primeira
  impressão deve transmitir qualidade do restaurante, apetite e confiança — não
  "formulário de pedido". Pense em referências de produtos como apps de delivery
  premium e cardápios digitais de restaurantes de alto padrão.
- Manter a base de **identidade Menuzia** (cores, radius 3px, fonte Inter, tom dos
  preços/badges) mas elevar a execução: fotos reais dos produtos (não emojis),
  composição visual mais editorial (hero da loja, destaques/banners de promoções,
  cards de produto com mais respiro e hierarquia tipográfica refinada), microinterações
  e transições fluidas (sheets, troca de categoria, adicionar ao carrinho, stepper de
  quantidade), atenção a estados vazios, loading e feedback de ações.
- Implementar o **bottom nav (Home / Promoções / Carrinho)** descrito em 4.5 como parte
  estrutural da nova versão — não é só um detalhe visual, é navegação principal do app.
- Garantir que o resultado seja **responsivo e fluido** em qualquer tamanho de tela
  (mobile primeiro, mas também bem resolvido em tablets/desktop), com UX pensada para
  o cliente "ter vontade de navegar e fechar o pedido com prazer".
- Esse é o módulo onde o capricho de design importa mais — é a vitrine do restaurante
  e o ponto de conversão (fechamento de pedidos) de toda a plataforma.

---

## 6. Plano de ação esperado (faça isto antes de codar o produto)

Antes de implementar qualquer funcionalidade, **monte um plano e apresente para
aprovação**. Esse plano deve cobrir, no mínimo:

1. **Stack escolhida e por quê** (seção 2) — com trade-offs considerados.
2. **Modelagem de dados** de alto nível: tenants/restaurantes, usuários e papéis,
   itens de cardápio, grupos/categorias, complementos/presets, promoções,
   disponibilidade, pedidos e seus itens, entregadores, atribuições de
   entrega/logística, fechamentos de caixa.
3. **Estratégia de tempo real** entre cardápio do cliente → kanban → logística →
   dashboard (como o pedido "viaja" pelo sistema).
4. **Estrutura de autenticação/autorização** multi-tenant e por papel
   (dono, atendente/cozinha, logística, entregador).
5. **Sequenciamento de entregas** — em que ordem construir os módulos (ex.: fundação
   de dados/auth multi-tenant → cardápio admin → cardápio do cliente → kanban →
   logística → dashboard, ou outra ordem que faça mais sentido tecnicamente),
   com checkpoints para eu validar antes de seguir adiante.
6. **Abordagem do redesign do `cliente.html`** (seção 5) como entrega própria dentro
   do plano, já que é o módulo voltado ao cliente final.

Não comece a implementação sem que esse plano seja revisado e aprovado por mim.
