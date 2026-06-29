# SP-A — Complementos: foto + configuração de quantidade (design/spec)

> Sub-projeto A de uma feature maior (complementos + cadastro de item + vitrine).
> Escopo deste SP: **modelo de dados + admin**. A seleção/persistência de quantidade
> na vitrine é o **SP-B** (fora daqui). Decisão tomada no brainstorming: tamanhos
> de item ficam **compartilhados** no banco (SP-C cuida da UI depois).

## 1. Objetivo

Permitir que a loja cadastre **foto** em cada complemento e marque um **grupo de
complementos como "permite quantidade por opção"** (que, na vitrine — SP-B — vira um
stepper `− 1 +` por complemento, em vez de checkbox). Tudo aditivo: a vitrine atual
ignora os campos novos até o SP-B.

## 2. Modelo de dados — migration `0036_complemento_foto_quantidade.sql`

Aditiva e idempotente (mesmo padrão das anteriores). Aplicada manualmente no SQL editor
do Supabase (`npm run db:setup` está quebrado).

```sql
-- SP-A: foto no complemento + flag de quantidade no grupo. Aditivo e idempotente.

alter table item_complementos add column if not exists imagem_url text;
alter table preset_complemento_itens add column if not exists imagem_url text;

alter table grupos_item_complementos add column if not exists permite_quantidade boolean not null default false;
alter table presets_complementos add column if not exists permite_quantidade boolean not null default false;
```

Notas:
- `imagem_url` nullable → complementos antigos ficam sem foto (a UI mostra placeholder).
- `permite_quantidade` default `false` → grupos antigos seguem como checkbox (comportamento atual).
- A foto vive no **complemento** (item) e no **item do preset** (pra importar junto). A flag
  de quantidade vive no **grupo** (e no **preset de grupo**), não no complemento individual —
  bate com a referência (o grupo inteiro tem stepper ou checkbox).

## 3. Camada de queries — `lib/queries/cardapio.ts`

### Tipos
- `ComplementoItem`: adicionar `imagemUrl: string | null`.
- `GrupoItemComplementos`: adicionar `permiteQuantidade: boolean`.
- `PresetComplementos` (e seu item): adicionar `permiteQuantidade: boolean` no grupo e
  `imagemUrl: string | null` no item.

### Selects / mappers
- `item_complementos` select ganha `imagem_url`; `mapItem` propaga `imagemUrl` em cada complemento.
- `grupos_item_complementos` select ganha `permite_quantidade`; `mapItem` propaga `permiteQuantidade`.
- Selects de preset (`presets_complementos` / `preset_complemento_itens`) ganham os campos
  e os mappers propagam.

### Funções
- `adicionarComplemento(...)` aceita `imagemUrl?: string | null` (default null).
- Novo `atualizarComplemento(supabase, compId, { nome, preco, imagemUrl })` — edita um complemento
  existente (inclui trocar/remover foto). (Hoje só existe adicionar/remover.)
- `criarGrupoItem` / `atualizarGrupoItem` aceitam `permiteQuantidade: boolean`.
- `adicionarItemPreset` / `atualizarItemPreset` aceitam `imagemUrl`.
- `criarPreset` / `atualizarRegrasPreset` (grupo de preset) aceitam `permiteQuantidade`.
- `importarPresetNoItem` copia `imagem_url` (por item) e `permite_quantidade` (no grupo criado).

Reaproveitar `enviarImagemItem(supabase, restauranteId, file)` (bucket `cardapio`) para o
upload da foto do complemento — mesma função usada por itens/sabores.

## 4. Admin — `/admin/cardapio`

### Editor de complementos do item (e de presets)
- Cada **complemento** numa linha ganha: **thumbnail** (foto ou placeholder) + botão
  **"trocar foto"** (`enviarImagemItem` → `atualizarComplemento`/`atualizarItemPreset` com a URL)
  + opção de **remover foto** (seta `imagem_url = null`).
- Cada **grupo** (e grupo de preset) ganha um **toggle "Permitir quantidade por opção"**
  → grava `permite_quantidade`. Texto de ajuda: "Na vitrine, o cliente escolhe a quantidade
  de cada opção (− 1 +) em vez de só marcar."

Seguir o padrão visual existente do editor (mesma densidade, cores Menuzia, `enviarImagemItem`
já usado para sabores).

## 5. Fora de escopo (SP-B / SP-C)

- **SP-B:** stepper na vitrine, contadores por grupo (1/3), recálculo de preço com quantidade,
  e `pedido_itens.complementos` ganhar `quantidade` (snapshot). Aqui o snapshot **não muda**.
- **SP-C:** redesenho do cadastro de item / tamanhos / preview de tags.

## 6. Testes

- Unitários nos mappers (sandbox bloqueia DB): um item/preset com `imagem_url` e
  `permite_quantidade` mapeia para `imagemUrl`/`permiteQuantidade` corretamente; defaults
  (null / false) quando ausentes.
- Verificação manual: cadastrar foto num complemento, marcar grupo como "permite quantidade",
  importar um preset e confirmar que foto+flag vieram juntas.

## 7. Sequência de implementação (para o plano)

1. Migration `0036`.
2. Tipos + selects + mappers em `cardapio.ts` (foto + flag) + testes de mapper.
3. Funções de escrita: `atualizarComplemento`, `imagemUrl` em adicionar/preset, `permiteQuantidade`
   em grupo/preset, e cópia no `importarPresetNoItem`.
4. UI admin: thumbnail + trocar/remover foto no complemento (item e preset).
5. UI admin: toggle "permite quantidade" no grupo (item e preset).
6. Aplicar `0036` no remoto + verificação manual.
