# Upload em massa de imagens — itens de categoria e complementos de preset

**Data:** 2026-07-14
**Status:** Aprovado pelo usuário

## Objetivo

Permitir cadastro em massa arrastando várias fotos de uma vez:

1. **Categoria do cardápio** → cria um item por foto (nome derivado do arquivo, pausado, R$ 0,00).
2. **Grupo de complementos (preset)** → cria um complemento por foto (nome derivado do arquivo, R$ 9,90).

Depois do upload, tela de revisão no próprio modal para acertar nome e preço rapidamente.

## Abordagem

Tudo client-side (Abordagem A aprovada): componente compartilhado `BulkUploadModal`, upload direto pro Supabase Storage via `enviarImagemItem` (já tenant-scoped, bucket público `cardapio`), criação de registros via queries existentes do browser client. Sem API route nova, sem migration.

## Pontos de entrada

- **Categoria:** botão com ícone de pasta nos botões hover da lista de categorias (`app/admin/cardapio/page.tsx` ~linha 2305), entre ✎ (renomear) e 🗑 (excluir). Tooltip: "Subir fotos em massa".
- **Preset:** mesmo botão no header roxo do `PresetGroupCard`.

## Fluxo do modal (3 fases)

### Fase 1 — soltar
- Dropzone grande: arrastar ou clicar para selecionar (`<input type="file" multiple accept="image/*">`).
- Mostra o nome da categoria/grupo alvo.
- Validação: só imagens; máx 10MB por arquivo; máx 50 arquivos por lote. Arquivos inválidos são listados e ignorados, o resto prossegue.

### Fase 2 — enviando
- Barra de progresso na cor primária: "Enviando X de N...".
- Concorrência limitada a 3 uploads paralelos.
- Por arquivo: upload da imagem → criação do registro já com `imagem_url`.
- Falha em um arquivo não trava o lote: entra numa lista de erros exibida ao final, com botão "Tentar de novo" (reprocessa só os que falharam).

### Fase 3 — revisão
- Lista: thumbnail + input de nome + input de preço por linha.
- Botão "Salvar tudo" aplica todas as edições de uma vez (`atualizarItem` / `atualizarItemPreset`).
- Fechar sem salvar é seguro: registros já existem com os defaults.

## Regras de nomeação

- Nome do arquivo limpo: remove extensão, troca `-`/`_` por espaço, colapsa espaços, capitaliza palavras. Ex.: `x-burger-duplo.jpg` → "X Burger Duplo".
- Nome genérico (padrões tipo `IMG_1234`, `DSC...`, `WhatsApp Image...`, `Screenshot...`, só números) → fallback "Item 1", "Item 2"... na ordem do lote.

## Defaults por modo

| Campo | Item de categoria | Complemento de preset |
|---|---|---|
| Nome | arquivo limpo / "Item N" | arquivo limpo / "Item N" |
| Descrição | "Sem descrição" | — (não tem) |
| Preço | R$ 0,00 | R$ 9,90 |
| Status | **Pausado** (não aparece na vitrine até editar) | — (complemento criado já vale) |
| Imagem | url do upload | url do upload |
| Grupo | categoria alvo | preset alvo |
| tipo_item | simples | — |

Racional: item pausado com preço zero não vaza de graça na vitrine; complemento a R$ 9,90 evita brinde acidental caso o grupo já esteja importado em itens ativos.

## Mudanças de código

1. `lib/queries/cardapio.ts`:
   - `NovoItemInput` / `criarItem`: aceitar `imagemUrl` opcional (hoje só via `atualizarItem`).
   - `adicionarItemPreset`: aceitar `imagemUrl` opcional.
2. Novo componente `BulkUploadModal` (arquivo próprio em `app/admin/cardapio/`), com prop de modo: `{ tipo: 'item', grupoId }` ou `{ tipo: 'complemento', presetId }` — muda defaults e funções de criar/atualizar; dropzone, progresso e revisão são compartilhados.
3. `app/admin/cardapio/page.tsx`: botão de pasta nos dois pontos de entrada + estado de abertura do modal + refresh da lista ao fechar.

## Visual

Identidade Menuzia: Inter, radius 3px (`rounded-menuzia`), primary `#0688D4`, barra de progresso primária, botões caixa alta 11px. Modal centralizado com overlay, mesma linguagem dos drawers existentes.

## Fora de escopo

- Compressão/resize de imagem no client.
- Reordenação de itens dentro do lote.
- Upload em massa para sabores de pizza ou tamanhos.
