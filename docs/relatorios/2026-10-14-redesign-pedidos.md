# Redesign da tela Pedidos (abas Pedidos e Entregadores) — 14/10/2026

Só visual e clareza. **Nenhuma função mudou** e o visual novo aparece **só na Menuzia** (lojas com "Novidades em
teste", `useEstadoSessao()?.novidades`). As outras lojas, a Villa, a impressão e o Assistente não foram mexidos.

## Skill escolhida

`npx skills add https://github.com/Leonxlnx/taste-skill --list` trouxe 14 variantes: brandkit, industrial-brutalist-ui,
gpt-taste, image-to-code, imagegen-frontend-mobile, imagegen-frontend-web, **minimalist-ui**, full-output-enforcement,
redesign-existing-projects, high-end-visual-design, stitch-design-taste, design-taste-frontend (v2),
design-taste-frontend-v1, design-taste-frontend-v2-experimental.

Instalada **só a `minimalist-ui`** (`.claude/skills/minimalist-ui/SKILL.md`, só texto): interface calma, plana, borda
fina, cor só para dizer estado. Das regras dela **não** usei: troca de fonte e de ícones (o CLAUDE.md manda a fonte do
painel e o projeto usa lucide), animação de entrada, cascata e fundos "com profundidade" — painel usado na correria.
Também segui `web-design-guidelines` (foco visível, aria-label em botão-ícone, `tabular-nums`, `Intl` para hora,
"…") e `vercel-react-best-practices` (sem estado novo, sem effect novo; tudo derivado do que a página já tinha).

## O que mudou

| Problema | Como ficou |
|---|---|
| "Em rota agora" duas vezes | Fica só no cartão do topo. A lista se chama **"Saíram para entrega"** e só aparece com pedido na rua (vazia, o cartão já diz 0). |
| "Entregadores disponíveis 4 de 5" contradiz o Kanban | Cartão **"Online agora X de Y"** = app do motoboy aberto (sinal < 2 min, a mesma regra do Kanban) entre os não desativados. Cada motoboy mostra o **status real**: Online / Em rota · #nº / Offline · visto há X / Desativado (`lib/motoboy/status-real.ts`, 12 testes). O seletor manual continua, discreto, com o rótulo "Disponibilidade". |
| Cards de entregador grandes, texto vazio, bolinha cinza x selo verde | Lista compacta, uma linha por motoboy: avatar com ponto do status real, nome, etiqueta de status, telefone e veículo **só se preenchidos**. Acesso / Mapa / Editar viram botões-ícone com rótulo no hover (texto visível e 44px no celular). Desativados vão para o fim. "Novo entregador" e "Fechamento de caixa" no topo da lista. |
| Aba Pedidos quase vazia | Em rota em lista compacta (nº, cliente + pagamento, bairro, motoboy, há quanto saiu, Mapa, Entregue, Não entregue; aviso de troco mantido). Finalizados em **tabela** (nº, hora, cliente, bairro, motoboy, valor, pagamento, status com cor), filtros numa barra só, estado vazio de uma linha. No celular a tabela vira cartão de duas linhas. |
| Topo | 3 cartões do mesmo tamanho: rótulo pequeno, número grande, uma linha de detalhe. |

Arquivos: `components/logistica/pedidos-novo.tsx` (peças novas), `app/admin/lista-pedidos/page.tsx` (escolhe o visual
pela chave; o código antigo ficou intacto), `lib/motoboy/status-real.ts` (+ teste), `lib/queries/pedidos.ts`
(`ultimoAcessoEm` passa a ser lido — a coluna já vinha na consulta). "Mapa" da lista em rota abre o mesmo mapa do
motoboy da aba Entregadores.

## Prints

Antes (produção) e depois (código novo rodando local contra o mesmo banco e a mesma loja), 1440px e 390px:

- `docs/redesign/pedidos-antes-pedidos-{1440,390}.png` · `pedidos-depois-pedidos-{1440,390}.png`
- `docs/redesign/pedidos-antes-pedidos-7dias-{1440,390}.png` · `pedidos-depois-pedidos-7dias-{1440,390}.png`
- `docs/redesign/pedidos-antes-entregadores-{1440,390}.png` · `pedidos-depois-entregadores-{1440,390}.png`

Os 2 pedidos "em rota" e o motoboy Jose "online" dos prints são **simulados só na resposta que chega ao navegador**
(`page.route`) — nada foi gravado em pedidos nem em entregadores. A sessão foi de um dono temporário criado e apagado
pelo script (autorizado por você).

## Testes (Playwright headless, `.medidas/redesign-pedidos-prints.mjs depois <base> --testar`)

42/42 ok nas duas larguras: 3 cartões com a mesma altura; "Online agora X de Y"; "Em rota agora" uma vez só; lista em
rota com Entregue/Não entregue e Mapa abrindo a localização; período 7 dias (247 pedidos), filtro de status, busca,
limpar filtros e clique na linha abrindo o detalhe; tabela no desktop e cartões no celular; status real "em rota" no
motoboy simulado; seletor de disponibilidade presente; nada de "Sem telefone"/"Veículo não informado"; rótulo no hover
(desktop) e alvo de 44px com texto (celular); Acesso, Mapa, Editar, Novo entregador e Fechamento de caixa abrindo;
sem rolagem horizontal. As ações só foram **abertas** (nada salvo, nada marcado como entregue). Também: `tsc`, lint,
`vitest lib/motoboy lib/custo` (80) e a regra de custo nº 1.

## Pendente

- **Commit, push e deploy**: o classificador de permissões bloqueou o `git commit` na `main` (worktree
  `C:/projetos/cardapio-estab`). Arquivos prontos, não commitados. Depois do deploy, conferir na Menuzia de verdade.
- Ao carregar, a tela mostra o visual antigo por um instante até a chave "Novidades" chegar (igual ao Kanban novo).
- A coluna Motoboy dos finalizados mostra "—" quando o pedido não tem motoboy próprio (como antes).
- Próximo passo sugerido: as regras usadas estão em `docs/design/guia-visual-menuzia.md` para as próximas telas.
