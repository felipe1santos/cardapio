# SP-A — Complementos: foto + quantidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar foto por complemento e uma flag "permite quantidade" por grupo de complementos (modelo + admin); a vitrine/persistência de quantidade é o SP-B (fora daqui).

**Architecture:** Tudo aditivo no Postgres (colunas nullable / default false). Camada de queries em `lib/queries/cardapio.ts` ganha os campos no read path (tipos/selects/mappers) e nas funções de escrita. UI no `app/admin/cardapio/page.tsx` (editor de grupo do item + editor de preset).

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (Postgres), Tailwind, Vitest.

## Global Constraints

- Migrations são **aditivas e idempotentes** (`add column if not exists`), aplicadas **manualmente no SQL editor do Supabase** (`npm run db:setup` está quebrado). Numerar `0036`.
- Novos parâmetros de função são **opcionais com default** (`imagemUrl?: string | null`, `permiteQuantidade?: boolean = false`) — não quebrar call sites existentes.
- Foto: reusar `enviarImagemItem(supabase, restauranteId, file)` (bucket público `cardapio`).
- `permite_quantidade` vive no **grupo** (e no grupo de preset), não no complemento individual.
- Paleta/fonte Menuzia, radius `rounded-menuzia` (3px). Sem libs novas.
- Verificação de tipos: `npx tsc --noEmit 2>&1 | grep -v "\.test\." | grep "error TS"` deve sair vazio (erros em `*.test.*` são pré-existentes — globals do vitest). Integração com DB é bloqueada no sandbox; validar via tsc + revisão.

---

### Task 1: Modelo de leitura — migration 0036 + tipos/selects/mappers

**Files:**
- Create: `supabase/migrations/0036_complemento_foto_quantidade.sql`
- Modify: `lib/queries/cardapio.ts` (tipos `ComplementoItem`, `GrupoItemComplementos`, `PresetComplementos`; `ItemRow`; `ITEM_SELECT`; `mapItem`; `listarPresets`)

**Interfaces:**
- Produces: `ComplementoItem.imagemUrl: string | null`; `GrupoItemComplementos.permiteQuantidade: boolean`; `PresetComplementos.permiteQuantidade: boolean` e `PresetComplementos.itens[].imagemUrl: string | null`.

- [ ] **Step 1: Criar a migration**

`supabase/migrations/0036_complemento_foto_quantidade.sql`:
```sql
-- SP-A: foto no complemento + flag de quantidade no grupo. Aditivo e idempotente.

alter table item_complementos add column if not exists imagem_url text;
alter table preset_complemento_itens add column if not exists imagem_url text;

alter table grupos_item_complementos add column if not exists permite_quantidade boolean not null default false;
alter table presets_complementos add column if not exists permite_quantidade boolean not null default false;
```

- [ ] **Step 2: Tipos — adicionar campos**

Em `lib/queries/cardapio.ts`, `ComplementoItem` (após `presetOrigemId`):
```ts
export interface ComplementoItem {
  id: string
  nome: string
  preco: number
  presetOrigemId: string | null
  imagemUrl: string | null
}
```
`GrupoItemComplementos` (após `posicao`):
```ts
export interface GrupoItemComplementos {
  id: string
  nome: string
  obrigatorio: boolean
  minEscolhas: number
  maxEscolhas: number
  posicao: number
  permiteQuantidade: boolean
  complementos: ComplementoItem[]
}
```
`PresetComplementos`:
```ts
export interface PresetComplementos {
  id: string
  nome: string
  obrigatorio: boolean
  minEscolhas: number
  maxEscolhas: number
  permiteQuantidade: boolean
  itens: { id: string; nome: string; preco: number; imagemUrl: string | null }[]
}
```

- [ ] **Step 3: `ItemRow` — incluir os campos crus**

Trocar as duas linhas do `ItemRow` (≈104-105):
```ts
  item_complementos: { id: string; nome: string; preco: number; grupo_id: string | null; preset_origem_id: string | null; imagem_url: string | null }[]
  grupos_item_complementos: { id: string; nome: string; obrigatorio: boolean; min_escolhas: number; max_escolhas: number; posicao: number; permite_quantidade: boolean }[]
```

- [ ] **Step 4: `ITEM_SELECT` — pedir as colunas novas**

Trocar as 2 linhas (≈224-225):
```ts
  item_complementos ( id, nome, preco, grupo_id, preset_origem_id, imagem_url ),
  grupos_item_complementos ( id, nome, obrigatorio, min_escolhas, max_escolhas, posicao, permite_quantidade ),
```

- [ ] **Step 5: `mapItem` — propagar os campos**

No `mapItem`, no `.map` dos grupos (≈121-131), adicionar `permiteQuantidade` e o `imagemUrl` dos complementos:
```ts
    .map((g) => ({
      id: g.id,
      nome: g.nome,
      obrigatorio: g.obrigatorio,
      minEscolhas: g.min_escolhas,
      maxEscolhas: g.max_escolhas,
      posicao: g.posicao,
      permiteQuantidade: g.permite_quantidade ?? false,
      complementos: (row.item_complementos ?? [])
        .filter((c) => c.grupo_id === g.id)
        .map((c) => ({ id: c.id, nome: c.nome, preco: Number(c.preco), presetOrigemId: c.preset_origem_id, imagemUrl: c.imagem_url ?? null })),
    }))
```
E no `complementos` de nível-item (≈147-149):
```ts
    complementos: (row.item_complementos ?? [])
      .filter((c) => !c.grupo_id)
      .map((c) => ({ id: c.id, nome: c.nome, preco: Number(c.preco), presetOrigemId: c.preset_origem_id, imagemUrl: c.imagem_url ?? null })),
```

- [ ] **Step 6: `listarPresets` — select + map**

Trocar o `.select(...)` (≈461) e o `.map(...)` (≈466-477):
```ts
    .select('id, nome, obrigatorio, min_escolhas, max_escolhas, permite_quantidade, preset_complemento_itens ( id, nome, preco, imagem_url )')
```
```ts
  return (data ?? []).map((preset) => ({
    id: preset.id,
    nome: preset.nome,
    obrigatorio: preset.obrigatorio,
    minEscolhas: preset.min_escolhas,
    maxEscolhas: preset.max_escolhas,
    permiteQuantidade: preset.permite_quantidade ?? false,
    itens: (preset.preset_complemento_itens ?? []).map((item: { id: string; nome: string; preco: number; imagem_url: string | null }) => ({
      id: item.id,
      nome: item.nome,
      preco: Number(item.preco),
      imagemUrl: item.imagem_url ?? null,
    })),
  }))
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "\.test\." | grep "error TS"`
Expected: vazio. (Vão aparecer erros TS nos call sites de `criarPreset`/`adicionarComplemento` etc. que retornam objetos sem os campos novos — corrigidos na Task 2. Se aparecerem, é esperado; seguir pra Task 2. Se preferir manter verde, fazer Task 1 e 2 juntas antes do typecheck final.)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0036_complemento_foto_quantidade.sql lib/queries/cardapio.ts
git commit -m "feat(cardapio): read path de foto+quantidade nos complementos (migration 0036)"
```

---

### Task 2: Funções de escrita — foto + flag

**Files:**
- Modify: `lib/queries/cardapio.ts` (`criarGrupoItem`, `atualizarGrupoItem`, `adicionarComplemento`, novo `atualizarComplemento`, `adicionarItemPreset`, `atualizarItemPreset`, `criarPreset`, `atualizarRegrasPreset`, `importarPresetNoItem`)

**Interfaces:**
- Consumes: tipos da Task 1.
- Produces (assinaturas que a UI da Task 3/4 usa):
  - `atualizarComplemento(supabase, compId: string, dados: { nome: string; preco: number; imagemUrl: string | null }): Promise<void>`
  - `adicionarComplemento(supabase, itemId, nome, preco, posicao, grupoId?, imagemUrl?)`
  - `criarGrupoItem(supabase, itemId, nome, obrigatorio, minEscolhas, maxEscolhas, posicao, permiteQuantidade?)`
  - `atualizarGrupoItem(supabase, grupoId, nome, obrigatorio, minEscolhas, maxEscolhas, permiteQuantidade?)`
  - `adicionarItemPreset(supabase, presetId, nome, preco, posicao, imagemUrl?)` retorna `{ id, nome, preco, imagemUrl }`
  - `atualizarItemPreset(supabase, itemId, nome, preco, imagemUrl?)`
  - `criarPreset` retorna `PresetComplementos` com `permiteQuantidade`
  - `atualizarRegrasPreset(supabase, presetId, obrigatorio, minEscolhas, maxEscolhas, permiteQuantidade?)`

- [ ] **Step 1: `criarGrupoItem` + `atualizarGrupoItem` — flag**

`criarGrupoItem`: novo parâmetro `permiteQuantidade: boolean = false`, gravar `permite_quantidade`, e retornar no objeto:
```ts
export async function criarGrupoItem(
  supabase: SupabaseClient,
  itemId: string,
  nome: string,
  obrigatorio: boolean,
  minEscolhas: number,
  maxEscolhas: number,
  posicao: number,
  permiteQuantidade: boolean = false,
): Promise<GrupoItemComplementos> {
  const { data, error } = await supabase
    .from('grupos_item_complementos')
    .insert({ item_id: itemId, nome, obrigatorio, min_escolhas: minEscolhas, max_escolhas: maxEscolhas, posicao, permite_quantidade: permiteQuantidade })
    .select('id, nome, obrigatorio, min_escolhas, max_escolhas, posicao, permite_quantidade')
    .single()
  if (error) throw error
  return {
    id: data.id,
    nome: data.nome,
    obrigatorio: data.obrigatorio,
    minEscolhas: data.min_escolhas,
    maxEscolhas: data.max_escolhas,
    posicao: data.posicao,
    permiteQuantidade: data.permite_quantidade ?? false,
    complementos: [],
  }
}
```
`atualizarGrupoItem`: novo parâmetro `permiteQuantidade: boolean = false`, incluir no update:
```ts
export async function atualizarGrupoItem(
  supabase: SupabaseClient,
  grupoId: string,
  nome: string,
  obrigatorio: boolean,
  minEscolhas: number,
  maxEscolhas: number,
  permiteQuantidade: boolean = false,
) {
  const { error } = await supabase
    .from('grupos_item_complementos')
    .update({ nome, obrigatorio, min_escolhas: minEscolhas, max_escolhas: maxEscolhas, permite_quantidade: permiteQuantidade })
    .eq('id', grupoId)
  if (error) throw error
}
```

- [ ] **Step 2: `adicionarComplemento` + novo `atualizarComplemento` — foto**

`adicionarComplemento`: novo parâmetro `imagemUrl?: string | null`, gravar e retornar:
```ts
export async function adicionarComplemento(
  supabase: SupabaseClient,
  itemId: string,
  nome: string,
  preco: number,
  posicao: number,
  grupoId?: string | null,
  imagemUrl?: string | null,
): Promise<ComplementoItem> {
  const { data, error } = await supabase
    .from('item_complementos')
    .insert({ item_id: itemId, nome, preco, posicao, grupo_id: grupoId ?? null, imagem_url: imagemUrl ?? null })
    .select('id, nome, preco, preset_origem_id, imagem_url')
    .single()
  if (error) throw error
  return { id: data.id, nome: data.nome, preco: Number(data.preco), presetOrigemId: data.preset_origem_id, imagemUrl: data.imagem_url ?? null }
}
```
Novo `atualizarComplemento` (logo após `adicionarComplemento`):
```ts
export async function atualizarComplemento(
  supabase: SupabaseClient,
  complementoId: string,
  dados: { nome: string; preco: number; imagemUrl: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('item_complementos')
    .update({ nome: dados.nome, preco: dados.preco, imagem_url: dados.imagemUrl })
    .eq('id', complementoId)
  if (error) throw error
}
```

- [ ] **Step 3: Preset — item com foto, grupo com flag**

`adicionarItemPreset`: novo `imagemUrl?: string | null`, gravar e retornar `imagemUrl`:
```ts
export async function adicionarItemPreset(
  supabase: SupabaseClient,
  presetId: string,
  nome: string,
  preco: number,
  posicao: number,
  imagemUrl?: string | null,
): Promise<{ id: string; nome: string; preco: number; imagemUrl: string | null }> {
  const { data, error } = await supabase
    .from('preset_complemento_itens')
    .insert({ preset_id: presetId, nome, preco, posicao, imagem_url: imagemUrl ?? null })
    .select('id, nome, preco, imagem_url')
    .single()
  if (error) throw error
  return { id: data.id, nome: data.nome, preco: Number(data.preco), imagemUrl: data.imagem_url ?? null }
}
```
`atualizarItemPreset`: novo `imagemUrl?: string | null`:
```ts
export async function atualizarItemPreset(supabase: SupabaseClient, itemId: string, nome: string, preco: number, imagemUrl?: string | null) {
  const { error } = await supabase.from('preset_complemento_itens').update({ nome, preco, imagem_url: imagemUrl ?? null }).eq('id', itemId)
  if (error) throw error
}
```
`criarPreset`: retornar `permiteQuantidade` (default false):
```ts
export async function criarPreset(supabase: SupabaseClient, restauranteId: string, nome: string): Promise<PresetComplementos> {
  const { data, error } = await supabase
    .from('presets_complementos')
    .insert({ restaurante_id: restauranteId, nome })
    .select('id, nome, obrigatorio, min_escolhas, max_escolhas, permite_quantidade')
    .single()
  if (error) throw error
  return { id: data.id, nome: data.nome, obrigatorio: data.obrigatorio, minEscolhas: data.min_escolhas, maxEscolhas: data.max_escolhas, permiteQuantidade: data.permite_quantidade ?? false, itens: [] }
}
```
`atualizarRegrasPreset`: novo `permiteQuantidade: boolean = false`:
```ts
export async function atualizarRegrasPreset(
  supabase: SupabaseClient,
  presetId: string,
  obrigatorio: boolean,
  minEscolhas: number,
  maxEscolhas: number,
  permiteQuantidade: boolean = false,
) {
  const { error } = await supabase
    .from('presets_complementos')
    .update({ obrigatorio, min_escolhas: minEscolhas, max_escolhas: maxEscolhas, permite_quantidade: permiteQuantidade })
    .eq('id', presetId)
  if (error) throw error
}
```

- [ ] **Step 4: `importarPresetNoItem` — copiar foto + flag**

No insert do grupo, incluir `permite_quantidade: preset.permiteQuantidade`; no insert dos itens, incluir `imagem_url: item.imagemUrl`:
```ts
    .insert({
      item_id: itemId,
      preset_origem_id: preset.id,
      nome: preset.nome,
      obrigatorio: preset.obrigatorio,
      min_escolhas: preset.minEscolhas,
      max_escolhas: preset.maxEscolhas,
      posicao,
      permite_quantidade: preset.permiteQuantidade,
    })
```
```ts
  const { error } = await supabase.from('item_complementos').insert(
    preset.itens.map((item, index) => ({
      item_id: itemId,
      grupo_id: grupoData.id,
      nome: item.nome,
      preco: item.preco,
      posicao: index,
      preset_origem_id: preset.id,
      imagem_url: item.imagemUrl,
    }))
  )
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "\.test\." | grep "error TS"`
Expected: vazio.

- [ ] **Step 6: Commit**

```bash
git add lib/queries/cardapio.ts
git commit -m "feat(cardapio): funcoes de escrita p/ foto do complemento e flag de quantidade"
```

---

### Task 3: Admin — foto do complemento (item + preset)

**Files:**
- Modify: `app/admin/cardapio/page.tsx` (componente do editor de grupo do item — onde renderiza `grupo.complementos.map((comp) => ...)`, ≈468; e o editor de preset — onde renderiza os itens do preset)

**Interfaces:**
- Consumes: `enviarImagemItem`, `atualizarComplemento` (item), `atualizarItemPreset` (com `imagemUrl`), `adicionarComplemento` (com `imagemUrl`), `adicionarItemPreset` (com `imagemUrl`). Já importados no arquivo (adicionar `atualizarComplemento` ao import de `@/lib/queries/cardapio`).

- [ ] **Step 1: Import**

Adicionar `atualizarComplemento` na lista de imports de `@/lib/queries/cardapio` no topo de `app/admin/cardapio/page.tsx`.

- [ ] **Step 2: Linha do complemento (item) — thumbnail + trocar/remover foto**

Na linha de cada `comp` (≈468, dentro do editor de grupo do item), antes do nome, adicionar um thumbnail clicável que abre um `<input type="file">` oculto; ao escolher, fazer upload e salvar:
```tsx
// dentro do .map((comp) => ( ... ))  — adicionar no início da <div> da linha:
<label className="relative h-9 w-9 flex-shrink-0 cursor-pointer overflow-hidden rounded-menuzia border border-border bg-page">
  {comp.imagemUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={comp.imagemUrl} alt={comp.nome} className="h-full w-full object-cover" />
  ) : (
    <span className="flex h-full w-full items-center justify-center text-[14px] text-text-subtle/50">＋</span>
  )}
  <input
    type="file"
    accept="image/*"
    className="hidden"
    onChange={async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const url = await enviarImagemItem(supabase, restauranteId, file)
        await atualizarComplemento(supabase, comp.id, { nome: comp.nome, preco: comp.preco, imagemUrl: url })
        onChanged() // recarrega a lista de itens — usar o handler de refresh já existente neste componente
      } catch { setError?.('Não foi possível enviar a foto do complemento.') }
    }}
  />
</label>
```
> Observação para o implementador: este componente já tem acesso a `supabase`, `restauranteId` e a um mecanismo de refresh (ex.: recarregar `items` via `listarItens`). **Use o mecanismo de refresh que já existe** no componente (procure como `removerComplemento`/`adicionarComplemento` atualizam a tela hoje) em vez de inventar um novo. Se houver `setError`, reutilize; senão, omita o catch-set.

- [ ] **Step 3: Item do preset — mesma foto**

No editor de preset, na linha de cada item do preset, adicionar o mesmo thumbnail+input, mas salvando com `atualizarItemPreset(supabase, item.id, item.nome, item.preco, url)` e dando refresh na lista de presets (usar o refresh já existente do editor de preset).

- [ ] **Step 4: Typecheck + lint + build**

Run: `npx tsc --noEmit 2>&1 | grep -v "\.test\." | grep "error TS"` → vazio
Run: `npx eslint "app/admin/cardapio/page.tsx" 2>&1 | grep -v "no-img-element"` → sem erros
Run: `npx next build` → sucesso

- [ ] **Step 5: Commit**

```bash
git add app/admin/cardapio/page.tsx
git commit -m "feat(cardapio-admin): foto por complemento (item + preset)"
```

---

### Task 4: Admin — toggle "permite quantidade" (grupo do item + preset)

**Files:**
- Modify: `app/admin/cardapio/page.tsx` (form de edição do cabeçalho do grupo do item; form de regras do preset; e os pontos de criação `criarGrupoItem`/`criarPreset`)

**Interfaces:**
- Consumes: `criarGrupoItem`/`atualizarGrupoItem`/`criarPreset`/`atualizarRegrasPreset` (todos com o parâmetro `permiteQuantidade` opcional da Task 2).

- [ ] **Step 1: Estado do form do grupo**

No componente do editor de grupo do item, no estado do form de edição do cabeçalho (onde já existem `nome`, `obrigatorio`, `min`, `max`), adicionar `permiteQuantidade` inicializado de `grupo.permiteQuantidade`.

- [ ] **Step 2: Checkbox no form do grupo**

No form de edição do cabeçalho do grupo, adicionar abaixo das regras min/max:
```tsx
<label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] font-medium text-text-main">
  <input type="checkbox" checked={permiteQuantidade} onChange={(e) => setPermiteQuantidade(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
  Permitir quantidade por opção
</label>
<p className="text-[11px] text-text-subtle">Na vitrine o cliente escolhe a quantidade de cada opção (− 1 +) em vez de só marcar.</p>
```
E passar `permiteQuantidade` na chamada `atualizarGrupoItem(supabase, grupo.id, nome, obrigatorio, min, max, permiteQuantidade)` (e em `criarGrupoItem(...)` no ponto de criação de grupo, passando `permiteQuantidade` — pode ser `false` na criação inicial se o form de criação não tiver o campo).

- [ ] **Step 3: Mesmo toggle no preset**

No form de regras do preset, adicionar o mesmo checkbox (estado inicializado de `preset.permiteQuantidade`) e passar em `atualizarRegrasPreset(supabase, preset.id, obrigatorio, min, max, permiteQuantidade)`.

- [ ] **Step 4: Typecheck + lint + build**

Run: `npx tsc --noEmit 2>&1 | grep -v "\.test\." | grep "error TS"` → vazio
Run: `npx eslint "app/admin/cardapio/page.tsx" 2>&1 | grep -v "no-img-element"` → sem erros
Run: `npx next build` → sucesso

- [ ] **Step 5: Commit**

```bash
git add app/admin/cardapio/page.tsx
git commit -m "feat(cardapio-admin): toggle permite-quantidade no grupo (item + preset)"
```

---

### Task 5: Aplicar migration + verificação manual

**Files:** nenhum (passo operacional do controlador/usuário).

- [ ] **Step 1:** Pedir ao usuário aplicar `0036_complemento_foto_quantidade.sql` no SQL editor do Supabase.
- [ ] **Step 2:** Verificação manual: cadastrar foto num complemento; marcar um grupo como "permite quantidade"; importar um preset (com foto + flag) num item e confirmar que foto e flag vieram juntas; recarregar a página e confirmar persistência.
- [ ] **Step 3:** Confirmar que a vitrine atual continua funcionando (ignora os campos novos até o SP-B).

---

## Self-Review

- **Cobertura da spec:** modelo (Task 1) ✓; queries de escrita incl. `atualizarComplemento`, foto em adicionar/preset, flag em grupo/preset, cópia no import (Task 2) ✓; admin foto (Task 3) ✓; admin toggle (Task 4) ✓; migration + verificação (Task 1/5) ✓.
- **Placeholders:** parâmetros opcionais com default evitam quebrar call sites; código completo em cada passo de query. As Tasks 3/4 deixam explícito "usar o refresh já existente" porque o nome do handler varia no componente — o implementador deve ler o componente; não é placeholder de lógica, é instrução de seguir o padrão local.
- **Consistência de tipos:** `imagemUrl: string | null` e `permiteQuantidade: boolean` usados de forma idêntica em tipos, selects, mappers e funções. `atualizarComplemento` assinatura idêntica na Task 2 (define) e Task 3 (usa).
- **Fora de escopo confirmado:** snapshot de pedido (`quantidade`), stepper na vitrine e recálculo de preço = SP-B.
