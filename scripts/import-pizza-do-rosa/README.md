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

**A ordem importa e não é intuitiva.** `itens_cardapio.grupo_id` é
`on delete set null` (não `cascade`) — ver `0002_menu_cardapio.sql`. Isso
quer dizer que apagar `grupos_cardapio` primeiro **não** derruba os itens:
só desvincula cada item do seu grupo (`grupo_id` vira `null`) e o item, os
sabores, os preços de sabor e os complementos ficam todos órfãos e vivos
no banco — 1303 linhas fantasmas (121 itens + 110 sabores + 335 preços de
sabor + 40 grupos de complemento + 697 complementos), e a guarda de "loja
vazia" do `importar.mjs` passa a bloquear pra sempre um novo import, já
que `itens_cardapio` nunca esvazia.

Quem cascateia de verdade é `itens_cardapio` (via `item_id on delete
cascade` em `pizza_sabores`, `pizza_sabor_precos`, `grupos_item_complementos`
e `item_complementos`). Por isso `itens_cardapio` tem que ser a **primeira**
tabela apagada — antes de `grupos_cardapio`, não depois:

**Só rode isto antes da loja receber pedidos de verdade.** `pedido_itens.item_id`
é `on delete set null` (`0003_pedidos_logistica.sql:89`), não `cascade` — então
o `delete from itens_cardapio` acima é seguro enquanto não existir nenhum
`pedido_itens` real apontando pra esses itens (é o caso logo após o import,
loja ainda sem pedidos). Depois que a loja começar a operar, rodar essa
reversão vai deixar as linhas de pedido histórico com `item_id = null` —
o pedido em si continua existindo, mas perde a referência de qual item do
cardápio foi vendido.

```sql
-- Reversão completa do import (rodar como service role, tenant pizza-do-rosa)
-- ORDEM IMPORTA: itens_cardapio primeiro — é o único delete que cascateia
-- (sabores, preços, grupos de complemento, complementos). grupos_cardapio
-- não cascateia pra itens_cardapio (grupo_id é "on delete set null"), então
-- apagá-lo antes só deixaria os itens órfãos e vivos.
delete from itens_cardapio         where restaurante_id = '<rid>';
delete from grupos_cardapio        where restaurante_id = '<rid>';
delete from presets_complementos   where restaurante_id = '<rid>';
delete from bordas_pizza           where restaurante_id = '<rid>';
delete from tamanhos_padrao_pizza  where restaurante_id = '<rid>';
update restaurantes set pizza_calculo_preco = 'media' where id = '<rid>';
-- e apagar a pasta <rid>/import-expresso-2026-09/ do bucket `cardapio`
```

O último `update` acima **não é uma restauração** — é o mesmo valor que o
import grava (`importar.mjs` seta `pizza_calculo_preco = 'media'`
incondicionalmente sob `--apply`, e `'media'` também é o default da
coluna). Pra esta loja, vazia antes do import, isso é inofensivo. Mas se
um dia este script rodar numa loja que já tivesse escolhido `'maior'`, o
import trocaria o valor sem avisar e esta reversão não devolveria o que
era antes — o `update` aqui só está deixando o valor como o import o
deixou, não restaurando um estado anterior.

(`<rid>` é o id do restaurante `pizza-do-rosa`, impresso pelo `importar.mjs` na
primeira linha do log.)
