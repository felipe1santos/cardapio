# Topo do painel v2 — progresso (2026-10-03)

Regras permanentes (valem para todo trabalho de UI no painel):
1. Botões do sistema (avisos, caixa, impressora, Dúvidas, perfil) sempre à direita, na mesma linha do topo, sem quebrar.
2. Cores vivas e legíveis: fundo sólido com texto claro OU fundo claro com texto/ícone colorido (ex.: verde sobre verde-claro). O que vale é o contraste mínimo de 4,5:1 no texto (regra atualizada em 2026-10-06).
3. Tooltips, popups, menus e avisos sempre por cima: portal no `<body>`, z-index 9999, dentro da tela.
4. Não mexer no design do "Despacho de rotas".

## Feito
- [x] Reproduzido o bug: no tablet/celular o popup de avisos ficava atrás do menu lateral e saía da tela; o Mais saía da
  tela no celular (prints `antes-*`).
- [x] Componente compartilhado `components/ui/flutuante.tsx`:
  - `Flutuante` (popup/menu ancorado, portal, z 9999, preso na tela, vira para cima se não couber, Esc e clique fora);
  - `Dica` (tooltip no hover/foco do teclado; `alternarNoClique` para ícones de explicação no toque).
- [x] `TopBar`: grupo do sistema sempre à direita na 1ª linha; título encolhe; ações da tela descem no celular.
  Novas props `sistema` e `semTitulo`.
- [x] Kanban: sem título; status com texto (verde/vermelho vivo); Som, Aceite, Rotas (capacete) e Mais só ícone, 44 px
  (36 px no celular), com dica e aria-label; Métricas/Entregas/Tela cheia no Mais; Som/Aceite/Rotas no Mais no celular.
- [x] Avisos, menu de status, Mais e menu da conta no `Flutuante`.
- [x] Caixa (financeiro) e "Dúvidas?" em cor viva com texto branco; textos longos só a partir de 1280 px.
- [x] Outras telas: menu ⋮ da categoria e "Ação" em lote (Cardápio), CSV (Clientes), sugestões de cliente (PDV/Mesas),
  Ajuda (Campanhas) e ⓘ (Dashboard) migrados para `Flutuante`/`Dica`.
- [x] E2E novo `e2e-kanban-topo-v2.mjs` (105/105); `e2e-kanban-topo.mjs` atualizado.
- [x] Regressão completa (ver relatório).
- [x] Prints depois.
- [ ] Publicação + conferência na Menuzia.
- [x] Aviso "Novo sistema de impressão" desligado (pedido de 2026-10-04).
