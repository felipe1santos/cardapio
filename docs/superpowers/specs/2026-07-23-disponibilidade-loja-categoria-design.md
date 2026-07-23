# Disponibilidade por dia, loja aberta/fechada e categoria por horário

Data: 2026-07-23

## 1. Bug fix — `dias_disponiveis` não filtra a vitrine

**Root cause**: `itens_cardapio.dias_disponiveis` (migration 0002) é salvo corretamente
pelo admin (`app/admin/cardapio/page.tsx`), mas `listarCardapioPublico`
(`lib/queries/cardapio.ts:754`) só filtra por `status === 'disponivel'`, e
`criarPedido` (`lib/queries/pedidos.ts:851`) também não valida o dia.

**Fix**:
- Extrai `diaSemanaSaoPaulo()` de `lib/fidelidade.ts` para `lib/timezone.ts` (compartilhado).
- `listarCardapioPublico` passa a filtrar item pelo dia atual (SP) em `diasDisponiveis`.
- `criarPedido` valida o mesmo no servidor, rejeitando item indisponível no dia.

## 2. Loja aberta/fechada

**Schema** (migration 0044, tabela `restaurantes`):
- `horario_funcionamento jsonb` — grade semanal, 1 intervalo por dia:
  `{"0": null, "1": {"abre":"18:00","fecha":"23:00"}, ...}` (chave = dia 0-6, `null` = fechado).
- `status_loja text not null default 'automatico'` — `'automatico' | 'aberto_manual' | 'fechado_manual'`.

**Lógica**: `lojaEstaAberta(restaurante)` em `lib/timezone.ts` — se `status_loja` for
manual, retorna o valor forçado; senão calcula a partir de `horario_funcionamento` +
hora atual em `America/Sao_Paulo`. **Importante**: `horario_funcionamento` null (loja
que nunca configurou grade — todas as lojas existentes no dia do deploy) = sempre
aberta, preservando o comportamento de antes da feature. Só depois que o dono configura
a grade em Ajustes é que dias sem intervalo passam a fechar a loja automaticamente.

**Admin/Ajustes**: seção "Horário de funcionamento" — grade dia a dia.

**Kanban**: toggle no topo — estado atual computado + ações "Fechar agora" /
"Abrir agora" / "Voltar ao automático".

**Vitrine**: badge "Aberto agora" (hoje hardcoded em `app/loja/[slug]/page.tsx:1739`)
passa a refletir `lojaEstaAberta`; loja fechada mostra "Loja fechada" e desabilita
finalizar pedido. Reaproveita o polling de 8s já existente.

**API**: `criarPedido` valida `lojaEstaAberta` no servidor antes de criar pedido —
fonte da verdade é o backend, não o front.

## 3. Categoria com horário automático

**Schema** (mesma migration, tabela `grupos_cardapio`):
- `horario_ativo_inicio time`, `horario_ativo_fim time` — nulos = sempre ativa
  (comportamento atual preservado).

**Admin**: checkbox "Ativar automaticamente por horário" + dois campos de hora no
editor de grupo (`app/admin/cardapio/page.tsx`). Sem override manual.

**Vitrine**: `listarCardapioPublico` só inclui o grupo se os campos forem nulos OU a
hora atual (SP) estiver dentro do intervalo.

## Timezone

Fixo `America/Sao_Paulo` em todo o sistema (mesmo padrão já usado em `lib/fidelidade.ts`).

## Decisões já validadas com o usuário

- Timezone fixo, não configurável por loja.
- Loja: manual + horário automático, override manual persiste até ser revertido
  (não expira sozinho).
- Grade de horário da loja: 1 intervalo por dia (sem pausa almoço/janta).
- Categoria: horário fixo diário (não varia por dia da semana), sem override manual.
- Bloqueio de pedido com loja fechada: API + UI.
- Grade de horário da loja configurada em Ajustes; toggle rápido de override no Kanban.
