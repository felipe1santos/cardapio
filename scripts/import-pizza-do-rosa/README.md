# Import do cardápio — Pizza do Rosa

Migração do cardápio da **Pizza do Rosa** (`www.pizzadorosa.com.br`, plataforma
Expresso Delivery) para o tenant `pizza-do-rosa` no Menuzia. Ver o plano completo em
`docs/superpowers/specs/2026-09-12-pizza-do-rosa-migracao.md`.

## Ordem de execução

```
node scripts/import-pizza-do-rosa/extrair.mjs
node scripts/import-pizza-do-rosa/mapear.mjs
node scripts/import-pizza-do-rosa/importar.mjs              # dry-run
node scripts/import-pizza-do-rosa/importar.mjs --apply       # grava em produção
```

Cada script lê o JSON gerado pelo anterior; rodar fora de ordem falha ao abrir o
arquivo de entrada.

### 1. `extrair.mjs`

Faz scraping **somente leitura** do cardápio público da Pizza do Rosa (sessões,
itens, preços por tamanho de pizza, adicionais, bordas). Não requer login nem
variáveis de ambiente — só rede. Respeita o servidor de terceiro: um único
`User-Agent` realista, sem concorrência, com uma pausa de 800ms entre as chamadas
à API por sessão.

Gera `dados/cardapio-origem.json` — o "retrato" do cardápio de origem em
2026-09-12. Os detalhes não óbvios do site de origem (cookie de sessão, header
`Referer` obrigatório, onde ficam as sessões/bordas/tamanhos no HTML, a troca
`/180/` → `/800/` nas fotos) estão comentados no próprio script.

### 2. `mapear.mjs`

Puramente local — não acessa rede nem banco. Lê `dados/cardapio-origem.json` e
aplica as regras de mapeamento da seção 4 do spec (separação de pizzas
salgadas/doces, Promocional só em Gigante com `tag='promocao'`, Brotinho só em
Brotinho, presets de adicionais, etc.), produzindo `dados/cardapio-menuzia.json`
já no formato que `importar.mjs` espera.

Também exporta `mapear(origem)`, testado em `mapear.test.mjs`.

### 3. `importar.mjs`

Lê `dados/cardapio-menuzia.json` e grava no Supabase do tenant `pizza-do-rosa`
(`grupos_cardapio`, `itens_cardapio`, `pizza_sabores`, `pizza_sabor_precos`,
`tamanhos_padrao_pizza`, `bordas_pizza`, `presets_complementos`,
`preset_complemento_itens`, `grupos_item_complementos`, `item_complementos`) e
sobe as fotos pro bucket `cardapio`.

Lê de `.env.local` na raiz do projeto:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Sem `--apply` roda em **dry-run**: nenhuma linha é gravada e nenhuma foto é
enviada, só o log do que seria feito (ids fake, URLs `dry-run://...`). Isso serve
pra conferir os totais antes de tocar em produção.

**`--apply` escreve na conta de produção de um cliente real.** Só rodar depois de
autorização explícita (Task 11 do plano) e com a loja `pizza-do-rosa` ainda vazia
— o script recusa rodar se já houver itens cadastrados.

## Como reverter

Tudo que o import cria está marcado pelo tenant (`restaurante_id`) e as fotos
ficam sob `<restauranteId>/import-expresso-2026-09/` no bucket `cardapio`.
Apagar os grupos derruba itens, sabores, preços e complementos em cascata:

```sql
-- Reversão completa do import (rodar como service role, tenant pizza-do-rosa)
delete from grupos_cardapio        where restaurante_id = '<rid>';
delete from presets_complementos   where restaurante_id = '<rid>';
delete from bordas_pizza           where restaurante_id = '<rid>';
delete from tamanhos_padrao_pizza  where restaurante_id = '<rid>';
update restaurantes set pizza_calculo_preco = 'media' where id = '<rid>';
-- e apagar a pasta <rid>/import-expresso-2026-09/ do bucket `cardapio`
```

(`<rid>` é o id do restaurante `pizza-do-rosa`, impresso pelo `importar.mjs` na
primeira linha do log.)
