# Guia visual do painel Menuzia (proposta, 14/10/2026)

Regras usadas no redesign da tela **Pedidos** (`components/logistica/pedidos-novo.tsx`). É uma **proposta** para as
próximas telas do painel; nenhuma outra tela foi alterada. O CLAUDE.md continua valendo acima disto (paleta oficial,
fonte do painel, impressão intocada). Não vale para a vitrine (`/loja`), que tem escala própria, nem para o Kanban.

Base: variante **minimalist-ui** da Taste Skill (interface calma: plana, borda fina, cor só com significado), sem a
parte de animação e sem a troca de fonte/ícones dela (CLAUDE.md vence). Painel usado na correria: nada pisca, nada entra
deslizando, nada de gradiente.

## 1. Medidas

- **Em px, nunca em `rem`** (`gap-[12px]`, `h-[36px]`): a raiz do painel é 87,5%, então `gap-3` vale 10,5px.
- Espaçamento em múltiplos de 4: **4, 8, 12, 16, 24**. Dentro de cartão: 16px de lado, 12px em cima/embaixo. Entre
  cartões: 12px (8px no celular).
- Canto: **6px** em cartão (o `--adm-raio` do tema), **4px** em botão, campo e etiqueta. Círculo só em avatar e ponto
  de status.
- Altura de controle: **36px** no desktop; **44px abaixo de `lg`** com `max-lg:h-[44px]` — use `h`, não `min-h`: o
  piso global de toque (`[data-painel] button { min-height: 40px }`) tem especificidade maior e anula `min-h-*`.

## 2. Cor

Tokens do tema (`--adm-*` em `app/globals.css`). Texto `--adm-texto` (#1F2937), secundário `--adm-texto-medio`
(#4B5563), terciário `--adm-texto-suave` (#5B6472, ainda AA em branco). Borda `--adm-borda` (#E5E7EB), 1px.
Fundo de faixa (barra de filtros) `--adm-superficie-2`. Ação: `--adm-azul`.

Cor aparece **só para dizer estado** (etiqueta, ponto), nunca para pintar bloco. Tons das etiquetas (fundo pastel +
texto da mesma cor, todos ≥ 4,5:1):

| Tom | Fundo | Texto | Ponto | Uso |
|---|---|---|---|---|
| verde | #DCFCE7 | #15803D | #10B981 | online, entregue, retirado |
| roxo | #F3E8FF | #7E22CE | #A855F7 | em rota |
| cinza | #F1F2F4 | #4B5563 | #9CA3AF | offline, neutro |
| vermelho | #FEE2E2 | #B91C1C | #EF4444 | cancelado, desativado, parado |
| azul | #E0F2FE | #0369A1 | #0688D4 | automático, informativo |
| laranja | #FFEDD5 | #C2410C | #F97316 | dinheiro / atenção |

## 3. Tipografia

Fonte do painel (herdada). Rótulo 12px/500; texto de linha 13–13,5px; título de cartão 14px/600; número de resumo
26px/600 (22px no celular) com `tabular-nums`. Coluna de número/valor/hora sempre `tabular-nums`.

## 4. Peças

**Cartão de resumo** — fileira de 3, `grid-cols-3` também no celular, mesma altura. Ordem: rótulo pequeno → número
grande (com sufixo menor, ex. "1 de 4") → uma linha de detalhe curta (cabe em 110px). Sem ícone em bolha: o número é o
protagonista.

**Cabeçalho de cartão** — uma linha: ícone 16px cinza + título 14/600 + contador em cinza (sem pílula) + descrição
curta após "·" (só a partir de `md`). Ações à direita; no celular ocupam a largura, lado a lado, sem quebrar texto.

**Lista compacta** — `ul` com `divide-y`, linha de 12px/16px de respiro. Avatar 36px com ponto de status (12px, borda
branca) no canto. Nome 14/600; embaixo, a etiqueta de status e só os dados que existem (nunca "Sem telefone",
"Veículo não informado"). Ações à direita como botão-ícone 36px com rótulo em tooltip CSS no hover/foco; abaixo de
`lg` o texto do botão aparece e os botões viram uma fileira de 44px.

**Tabela** — `table-fixed`, cabeçalho 11,5px/600 cinza, linha de 8px de respiro, hover `--adm-superficie-2`, linha
aberta `--adm-azul-claro`. A linha é clicável e a primeira célula tem um `<button>` (teclado). Colunas menos
importantes somem antes de `lg`. **Abaixo de `md` vira cartão**: linha 1 = nº + nome + valor; linha 2 = meta
truncada + etiqueta.

**Etiqueta de status** — 11,5px/600, canto 4px, `px 8 / py 2`, opcional ponto de 6px. Texto curto e específico
("Em rota · #412", "Offline · visto há 3 h"), sem caixa alta.

**Barra de filtros** — uma faixa só, fundo `--adm-superficie-2`, campos de 36px, busca com lupa, "Limpar filtros" só
quando há filtro.

**Estado vazio** — uma linha centralizada de 13px em cinza (com ação opcional ao lado), ~60px de altura. Nada de
ícone grande nem bloco que ocupa a tela. Se a informação já está num cartão de resumo, a seção vazia some.

**Botões** — primário azul cheio; contorno branco com borda; sucesso verde; destrutivo = contorno com texto
vermelho. 12px/600, sem caixa alta, `whitespace-nowrap` (nunca botão em 2 linhas).

## 5. Comportamento

- Foco visível sempre (`focus-visible:ring-2` azul 40%); nada de `outline-none` sem substituto.
- Transição só de cor/opacidade, 150ms. Sem entrada animada, sem pulsar (exceção: o que já é alerta, como o Kanban).
- Botão só de ícone tem `aria-label`; ícone decorativo `aria-hidden`.
- Sem rolagem horizontal a 390px.
- Novidade visual entra atrás de "Novidades em teste" (`useEstadoSessao()?.novidades`) e as funções chegam por props
  — a tela antiga continua igual para as outras lojas.

## 6. Tokens da central do WhatsApp (Kanban v3, 15/10/2026)

Extraídos de `components/atendimento/central.tsx` e guardados em `components/ui/tokens-central.ts` (classes prontas +
`COR` em hex). O Kanban v3 que os usava foi cancelado e apagado em 16/10/2026; os tokens seguem para o AvisoTopo (§7).

| Token | Valor | Origem na central |
|---|---|---|
| Fonte | Mulish (`var(--font-painel)`), a do painel — a central não define outra | herdada |
| Selo verde (`SELO_VERDE`) | fundo #ECFDF5, texto #047857, pílula, 11,5px/600, px 8 / py 2 | "Robô ativo" |
| Selo azul (`SELO_AZUL`) | fundo #DBEAFE, texto #1D4ED8 | "Em atendimento" |
| Selo âmbar / vermelho / cinza | #FEF3C7/#92400E · #FEF2F2/#B91C1C · #F3F4F6/#4B5563 | "Aguardando atendente", aviso de erro, "Robô" |
| Botão primário (`BOTAO_VERDE`) | #047857 (hover #065F46), cantos 8px, 12,5px/600 | "Resolvido" |
| Botão azul / contorno | #0688D4 (hover #0570AE) · branco com borda #D1D5DB | "Assumir" · "Encerrar" |
| Destaque novo (`DESTAQUE_NOVO`) | fundo #FEF3C7 (forte #FDE68A), borda #FCD34D, faixa à esquerda #F59E0B | conversa pedindo atendente |
| Atraso (`ATRASO`) | texto #B91C1C sobre #FEF2F2 | faixa de erro |
| Raios | 8px botão/campo, 10px cartão/balão, 12px janela; pílula em selo | janela, balões, botões |

No Kanban v3 o card e o painel usam negrito (700/800) por pedido do modelo — exceção anotada em `lib/peso-fonte.test.ts`.

## 7. Topo compacto (16/10/2026)

Meta: o topo ocupa no máximo ~20–25% da altura (1366×768) e o conteúdo principal (tabela, lista) o resto. Peças em
`components/ui/topo-compacto.tsx` e `components/layout/caminho-topo.tsx`; relatório em
`docs/relatorios/2026-10-16-compactar-topo.md`.

- **Caminho na barra do topo** — `TopBar secao={{ nome, ajuda }}` mostra "Financeiro › Contas e DRE (i)": o nome da
  seção em 15px cinza e o "i" que leva à ajuda. A tela **não repete** o título dentro da página nem põe frase de
  explicação no topo (a explicação vai para o "i").
- **Aviso que pede ação** — `TopBar aviso={<AvisoTopo …/>}`: faixa baixa (34px) entre o caminho e a impressora, no
  amarelo da conversa que pede atendente na central (fundo #FEF3C7, borda #FCD34D, faixa à esquerda #F59E0B, texto
  #92400E), texto curto + um botão pequeno + "i" com a explicação. No celular desce para uma faixa fina abaixo da barra.
  Se o aviso não tiver nada a mostrar, a faixa some sozinha.
- **No máximo 2 linhas antes da tabela:**
  - **Linha 1 — `LinhaResumos`**: números em pílulas de 30px (ícone 14px na cor do tom + rótulo cinza + valor
    `tabular-nums`; o valor ganha a cor do tom só quando pede atenção, ex. vencidas > 0). À direita, **`SeletorSecao`**
    (lista suspensa nativa) no lugar da fileira de abas.
  - **Linha 2 — `BarraFiltros`**: `Segmentado` (situação/período, 32px), busca e listas com `CAMPO_FILTRO` (34px) à
    esquerda; CSV e o botão principal à direita.
- **Tabela** — rola por dentro com o cabeçalho fixo e usa a altura que sobra (`max-h-[calc(100dvh-196px)]`).
  Gráfico e painel de filtros grandes ficam atrás de um botão ("Gráfico", "Filtros (n)") ou depois da tabela.
- **Nada some**: toda aba vira opção do seletor; todo filtro e botão continua na linha 2 (no máximo 1 clique a mais).
- **Foco** — `FOCO_GUIA` (anel azul a 40%) nas abas, chips, segmentado e seletor, no lugar do anel forte do tema.
- No toque (abaixo de `lg`) os controles crescem para 44px.

## 8. Painel de Pedidos — redesign (18/10/2026, em aprovação)

Branch `redesign-kanban`, só local até o dono aprovar. Só visual: mesmos handlers, permissões, realtime e alarme.

- **Pílulas do topo**: o padrão é "Recebendo pedidos" (fundo #DCFCE7, texto #15803D). Avisos: fundo #FEE2E2, ícone
  #B91C1C, contador mantido. Suporte (antes "Dúvidas?"): fundo `--adm-laranja-claro`, texto `--adm-laranja`.
- **Tag Aberto/Fechado** no card da loja (menu), nas mesmas cores da pílula; sincronizada por evento
  (`lib/status-loja-cliente.ts`) e reavaliada a cada minuto pela grade de horário.
- **Quadro**: sem a faixa vazia abaixo do topo (`px-3 pt-2`), colunas com cabeçalho de 12,5px/`py-2`, cantos retos,
  gap 10px. Meta: o 100% de zoom com a proporção que o 90% tinha.
- **Card** (`components/pedidos/card-pedido.tsx`): fundo #F7F8FA, borda #E5E7EB, canto 0, sombra 0 1px 2px 4%. Linha 1
  nº 13/600 + origem discreta (13px, opacidade 70%) + tempo; **valor 13,5/600 verde à direita**. Linha 2 cliente 13/600
  + tipo (Entrega/Retirada/Mesa) com o ícone do Pix (pago ✓ / aguard.). Itens em 12px cinza, 2 linhas, "+N itens".
  Barra de ações no rodapé: botões 28px, canto 2px — Imprimir · Editar (pagamento) · Mais informações · ação principal
  azul #0688D4 (Aceitar / Pronto / Entregue / Despachar / Saiu p/ entrega; Lalamove ao lado quando ligada).
- **Mais informações** (`components/pedidos/mais-info.tsx`): menu sobre o card (Usuário · Destino · Pagamento ·
  Pedidos) → modal central só com aquele assunto. Pagamento tem o mesmo "Alterar pagamento" de sempre.
- **Painel da direita**: 420px, fundo #F7F8FA, cantos retos; no topo 5 barrinhas (5px, verde #16A34A até a etapa
  atual, cinza #E5E7EB depois, vermelho claro se cancelado) + nome da etapa; seções Cliente · Entrega · Itens ·
  Pagamento em caixas brancas; ações fixas no rodapé (Reimprimir, Cancelar).
- **Despachar flutuante**: 46px, `rounded-none`, azul `--adm-azul`, sombra leve.
