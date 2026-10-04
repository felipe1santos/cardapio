# Topo do painel v2 — topo mais limpo + regras visuais permanentes (2026-10-03/04)

Lógica dos pedidos, card e painel lateral do Kanban sem mudança. "Despacho de rotas" intocado (o teste confere pelo git
que `rota-panel.tsx` e `rota-map.tsx` estão iguais ao main).

## 1. Topo do Kanban
- **Título "Painel de Pedidos" saiu da vista** (continua para leitor de tela). Tudo numa linha só.
- **Esquerda:**
  - status da loja com texto, em verde vivo `#15803D` ("Recebendo pedidos") ou vermelho vivo `#B91C1C` ("Loja fechada"),
    com Manual/Automático e o menu de abrir/fechar. Abaixo de 1280 px vira "Aberta"/"Fechada";
  - **Som, Aceite automático, Rotas e Mais só ícone**, quadrados de 44 px (36 px no celular), cantos de 4 px, com
    **dica** (tooltip) que diz o estado e a ação ("Som de pedido novo ligado – clique para desligar") e aria-label:

    | Botão | Ícone | Ligado | Desligado |
    |---|---|---|---|
    | Som | sino / sino riscado | azul `#0369A1` | cinza-escuro `#4B5563` |
    | Silenciar (alarme tocando) | sino tocando | laranja `#C2410C` | — |
    | Aceite automático | raio / raio riscado | roxo `#7E22CE` | cinza-escuro `#4B5563` |
    | Rotas | capacete de motoboy | escuro `#1F2937` (ação) | cinza-escuro riscado (loja sem motoboy) |
    | Mais | três pontos | `#374151` | — |

  - Métricas, Entregas e Tela cheia moram no **Mais** (com o estado Ligado/Desligado). No celular, Som, Aceite e Rotas
    também vão para o Mais; o Silenciar fica na barra quando o alarme toca.
- **Direita (sistema):** avisos (âmbar vivo `#B45309` com badge vermelho quando há aviso; cinza-escuro sem aviso),
  caixa (financeiro), impressora, "Dúvidas?" (laranja vivo `#C2410C`, texto branco) e perfil.
- Contraste medido no teste: todos ≥ 4,5:1 (status 5,0; Som 5,9; Aceite 7,6; Mais 10,3; avisos 5,0; Dúvidas 5,2).

## 2. Popups sempre por cima — componente compartilhado
`components/ui/flutuante.tsx`:
- **`Flutuante`**: popup/menu ancorado num botão, renderizado no `<body>` (portal), `z-index: 9999`, posição presa
  dentro da tela (vira para cima se não couber embaixo), fecha com Esc e clique fora.
- **`Dica`**: tooltip de verdade, também no `<body>` em z 9999, no hover do mouse e no foco do teclado; com
  `alternarNoClique` para ícones de explicação (ⓘ, ?) no toque.

Causa do bug: os popups eram `absolute` dentro do cabeçalho; no tablet/celular o cabeçalho quebrava linha e o popup de
avisos ficava atrás do menu lateral e fora da tela (prints `antes-avisos-tablet.png`, `antes-mais-celular.png`).

Migrados para o componente:

| Tela | Popup |
|---|---|
| Painel de Pedidos | avisos, Mais, status da loja |
| Todas (topo) | menu da conta |
| Cardápio | menu ⋮ da categoria (era cortado pela lista lateral que rola), "Ação" em lote (agora fecha com clique fora e Esc) |
| Clientes | menu CSV |
| PDV / Mesas | sugestões de cliente no campo "Nome" (eram cortadas pela janela que rola) |
| Campanhas | ajuda (?) |
| Dashboard | ⓘ das métricas da vitrine |

Varredura das telas Financeiro, Integrações, Mesas e PDV: sem outros popups soltos.

## 3. Topo das outras telas
`TopBar` (vale para todas):
- grupo do sistema sempre à direita, na **1ª linha**, sem quebrar;
- o título encolhe com reticências;
- no celular as ações da própria tela descem para uma 2ª linha.

Também:
- a pílula do caixa ficou em cor viva com texto branco; abaixo de 1280 px mostra só "Caixa";
- o PDV tem cabeçalho próprio, sem os botões do sistema, e não mudou.

## 4. Aviso "Novo sistema de impressão"
Desligado em todas as telas (pedido do dono em 2026-10-04): `AVISO_NOVA_IMPRESSAO_LIGADO = false` em
`lib/avisos-painel.ts`. O teste de layout e o e2e v2 conferem que ele não aparece.

## 5. Prints (`prints/`)
- `antes-*` / `depois-*`:
  - `kanban-topo-{1920,1366,tablet,celular}` (só a barra) e `kanban-*` (tela inteira);
  - `avisos-*` (popup de avisos aberto) e `mais-*` (menu Mais aberto);
  - `topo-{pdv,mesas,cardapio,clientes,financeiro,integracoes}-{1366,celular}`.

## 6. Testes
Novo `scripts/seguranca/e2e-kanban-topo-v2.mjs`: **119/119**.

**1920, 1366, 1024, 768, 390, 360 e tela cheia:**
- uma linha só, sem sobreposição, sem rolagem lateral;
- controles à esquerda e sistema colado à direita;
- título fora da vista;
- botões só ícone de 44 px.

**Dicas e estados:**
- dicas com estado e ação, no `<body>` em z 9999 e dentro da tela;
- Som e Aceite alternam cor, aria-pressed e dica;
- aria-label em todos os botões;
- contraste ≥ 4,5.

**Popups** (avisos, Mais, status, conta) no `<body>`, z 9999, inteiros na tela e sem nada por cima (checado ponto a
ponto com `elementFromPoint`). Esc e clique fora fecham.

**Celular:** Som, Aceite e Rotas no Mais.

**Telas** Mesas, Cardápio, Clientes, Financeiro, Integrações, Dashboard, Logística e Impressão, em 1366 e 390:
- sistema à direita na 1ª linha;
- menu da conta por cima;
- sem o aviso de impressão.

Também por cima e dentro da tela: ⋮ do Cardápio, CSV dos Clientes e ajuda de Campanhas.

**Financeiro ligado (768, 1024, 1366):** a pílula do caixa cabe na linha, em cor viva.

**Regressão:** o card abre o painel lateral e o Esc fecha.

| Suíte | Resultado |
|---|---|
| kanban-topo (atualizada: sem título, estado pelo aria-pressed) | 49/49 |
| kanban-card / responsivo-kanban | 72/72 · 24/24 |
| cozinha-fase5 / agendamento | 26/26 · 24/25 (*) |
| pdv-pagamento / pdv-atendimento / pdv-v2 / balcao-entrega | 57/57 · 97/97 · 70/70 · 84/84 |
| financeiro-fase3 / estabilidade-operacional / regressao-release | 106/106 · 53/53 · 52/52 |
| garcom (mesas) / clientes-csv / cardapio-ordem-qr | 47/47 · 77/77 · 110/111 (**) |
| Vitest | 1953 ok |

(*) Agendamento: a única falha é na vitrine e depende do relógio. Rodou às 23h, e o teste espera "Abrimos hoje às
HH:00", mas a próxima abertura era "amanhã às 00:00". Nada a ver com o topo.

`cardapio-ordem-qr` estava desatualizado desde o redesign do cardápio (01/10): procurava o botão "Descer categoria",
que no desktop agora fica no menu ⋮. O teste passou a usar o menu (e assim testa o ⋮ por cima).

(**) A falha que sobrou em `cardapio-ordem-qr` ("vitrine mostra ★ Favorito") também é antiga. O selo da vitrine mudou no
commit `ad54d48` (redesign da vitrine), e esta entrega não mexe na vitrine (diff vazio em `app/loja`).

## Publicação (2026-10-03 ~23:25)
- Sem migration. main `bb6114a`; Redeploy no Coolify; build novo no ar às 23:28.
- **Conferência na Menuzia: PENDENTE.** O Chrome conectado estava logado na **Ponto 400** (loja real). Pela regra, parei:
  - a aba foi fechada na hora, sem nenhum clique, porque o Kanban aberto com aceite automático poderia aceitar pedidos;
  - o banco confirma que nada mudou na loja (último update do #325 às 22:50, antes da visita).
  - Só deu para ver, sem interagir, que o topo novo renderizou em produção: status verde com texto, ícones vivos e
    sistema à direita.
- Acompanhamento pós-deploy (só leitura): pedidos das lojas seguem normais (Ponto 400 #325 em preparo; Villa e
  Estância com entregues).
