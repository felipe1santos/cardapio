# Spec — Vitrine: banner maior com ponto de foco, fonte Rubik e modo de exibição "gaveta"

**Data:** 2026-09-13
**Escopo:** vitrine do cliente (`app/loja/[slug]/`), painel (Ajustes e Gestor de Cardápio), schema.

---

## 1. Por que

Três pedidos do dono do produto, na mesma área:

1. **O banner da vitrine está pequeno.** Hoje são 112 px de altura numa tela de 390 px — proporção 3,5:1, uma tarja. A capa é o primeiro contato do cliente com a loja e não está cumprindo esse papel.
2. **O dono da loja não controla o recorte da capa.** O `<img>` usa `object-cover` centralizado, então uma foto com o assunto fora do centro (o logo no topo, o prato na base) é cortada sem que o lojista possa fazer nada.
3. **Falta um modo de cardápio navegado por categoria.** O lojista quer a experiência em que o cliente escolhe primeiro a categoria, num cartão grande com foto, e só então vê os produtos. Os dois modos atuais continuam existindo; este é um terceiro.

E um pedido de identidade visual: **fonte Rubik na vitrine**.

## 2. Estado atual

| Coisa | Onde | Hoje |
|---|---|---|
| Altura da capa | `vitrine.tsx:2311` | `h-28` / `sm:h-40` / `lg:h-80` |
| Recorte da capa | `vitrine.tsx:2324` | `object-cover`, sem `object-position` |
| Modo de exibição | `lib/queries/cardapio.ts:783` | `LayoutCardapio = 'categoria' \| 'lista'`, default `'categoria'` |
| Uso do modo | `vitrine.tsx:2533`, `:2550` | passado ao `ItemsGrid`; muda só a grade dos itens |
| Foto de categoria | `grupos_cardapio` | **não existe** |
| Fonte | `app/layout.tsx:20` | Inter via `next/font/google`, raiz de todo o app; `tailwind.config.ts:81` mapeia `sans` |
| Layout da vitrine | `app/loja/[slug]/` | só `page.tsx` e `vitrine.tsx` — **não há `layout.tsx`** |

CLAUDE.md §3 declara Inter como fonte oficial de todo o app. Este spec abre uma exceção documentada.

## 3. Decisões tomadas

| # | Questão | Decisão |
|---|---|---|
| 1 | Comportamento do modo gaveta | **Tela cheia por categoria** — tocar entra numa tela com os itens e botão voltar |
| 2 | Alcance da Rubik | **Só a vitrine do cliente**; painel/PDV/kanban/cozinha seguem Inter |
| 3 | Altura do banner no celular | **2:1** (~195 px a 390 px de largura) |
| 4 | Controle de recorte | **Ponto de foco arrastável** (X e Y), não moldura com zoom |
| 5 | Foto de categoria | **Obrigatória** para ligar o modo; sem fallback na foto de item (ver 5.5 para a categoria criada depois) |
| 6 | Categoria sem foto | **Trava o modo** no painel; nada some da vitrine |

### Por que ponto de foco e não recorte de verdade

O banner renderiza em proporções diferentes conforme a largura: 2:1 no celular, bem mais largo no desktop (`lg:h-80` num contêiner de até 1216 px). Um recorte "queimado" na imagem acertaria uma dessas proporções e erraria a outra. O ponto de foco é um par de coordenadas que a CSS âncora em qualquer proporção, serve as duas com o mesmo arquivo, não reprocessa imagem e funciona nas capas **já enviadas**.

### Por que travar o modo em vez de esconder a categoria

Esconder uma categoria sem foto esconde junto **todos os itens dela**, que o cliente deixa de conseguir comprar, sem aviso nenhum. No cardápio da Pizza do Rosa isso sumiria com Molhos, Congelados e Loja Virtual. O custo tem que cair no lojista, no painel, antes de ir pro ar — onde ele vê o que falta e resolve.

## 4. Schema

Migration aditiva e idempotente. **Todos os defaults preservam o comportamento atual** — aplicar a migration não muda a aparência de nenhuma loja já existente.

```sql
-- Ponto de foco da capa: 0-100 em cada eixo, percentual, consumido como
-- `object-position: X% Y%`. 50/50 é exatamente o object-cover centralizado
-- de hoje, então nenhuma loja muda de aparência ao aplicar isto.
alter table restaurantes
  add column if not exists banner_foco_x numeric(5,2) not null default 50,
  add column if not exists banner_foco_y numeric(5,2) not null default 50;

-- Foto de categoria: só o modo "gaveta" consome. NULL = categoria sem foto,
-- que é o que trava o modo no painel.
alter table grupos_cardapio
  add column if not exists imagem_url text,
  add column if not exists imagem_foco_x numeric(5,2) not null default 50,
  add column if not exists imagem_foco_y numeric(5,2) not null default 50;
```

`layout_cardapio` é `text` livre no banco; o valor `'gaveta'` entra apenas no tipo TypeScript. Não há constraint a alterar.

**Faixa dos valores de foco:** 0 a 100. A UI nunca produz valor fora disso; a leitura satura por segurança (`Math.min(100, Math.max(0, n))`), de modo que um valor corrompido vira uma borda, nunca um layout quebrado.

## 5. Componentes

### 5.1 `lib/foco-imagem.ts` (novo)

Módulo puro, sem React, testável isolado:

- `type Foco = { x: number; y: number }`
- `focoValido(x: unknown, y: unknown): Foco` — satura em 0-100, cai em `{50,50}` pro que não for número finito
- `objectPosition(foco: Foco): string` — devolve `"50% 50%"`
- `FOCO_PADRAO: Foco`

Existe pra que a saturação e o formato da string tenham um dono só, usado pela vitrine, pelo painel e pelos dois lugares que gravam.

### 5.2 `components/seletor-foco.tsx` (novo)

O componente da mira, usado em **dois** lugares (capa da loja e foto de categoria):

- Props: `src`, `foco`, `onChange(foco)`, e `proporcoes: { rotulo: string; ratio: number }[]`
- Mostra a imagem inteira com a mira arrastável por ponteiro e por teclado (setas movem 1%, Shift+setas 10%) — teclado não é enfeite: é o que torna o ajuste fino possível.
- Desenha uma moldura sombreada por proporção recebida, mostrando o que sai fora. Na capa recebe duas (celular 2:1 e desktop); na categoria, uma.
- Não sobe imagem, não salva: só emite `foco`. Quem persiste é a tela.

### 5.3 Vitrine

- **Capa** (`vitrine.tsx:2311`): a caixa vira `aspect-[2/1]` no celular, mantendo `lg:h-80`; o `<img>` recebe `style={{ objectPosition: objectPosition(foco) }}`.
- **Modo gaveta**: quando `restaurante.layoutCardapio === 'gaveta'`, a aba Home renderiza `<CategoriasGaveta>` em vez da lista de seções. Selecionar uma categoria guarda `categoriaAberta` no estado e a Home passa a renderizar a tela daquela categoria, com cabeçalho e voltar.
- A sacola, a busca, o bottom nav, as fichas de produto e o checkout **não mudam** — muda só como o cliente chega no item.
- A busca, quando ativa, mostra resultados de todas as categorias mesmo no modo gaveta: buscar é a saída de emergência de quem não quer navegar.

### 5.4 Painel

- **Ajustes › Perfil**: abaixo do upload da capa, o `SeletorFoco` com as duas proporções. O foco entra no mesmo `form` da tela (via a função `set`, `page.tsx:326`) e é persistido pelo botão **"Salvar alterações"** que já existe (`page.tsx:212`) — a tela NÃO salva sozinha ao editar, e o ponto de foco não vira exceção.
- **Gestor de Cardápio › categoria**: o formulário de categoria (`startEditCategoria`, `page.tsx:2209`) ganha upload de foto + `SeletorFoco`.
- **Ajustes › seletor de modo**: a opção "Gaveta" fica desabilitada enquanto houver categoria sem `imagem_url`, com a lista das pendentes e um atalho pro gestor. A trava é de UI; o servidor não recusa `'gaveta'` — uma loja que já esteja no modo e depois crie uma categoria nova sem foto **não** quebra: ver 5.5.

### 5.5 Categoria sem foto com o modo já ligado

A trava do painel impede **ligar** o modo, não impede criar uma categoria depois. Nesse caso a vitrine renderiza o cartão daquela categoria **sem imagem**, com o nome sobre a cor do tema da loja. É deliberadamente a opção que o dono do produto recusou para o estado inicial, e está certa aqui pelo motivo oposto: entre um cartão feio e um produto invisível, o cartão feio é o certo. O painel mostra o aviso de pendência para que ele apareça e seja resolvido.

## 6. Fonte Rubik

- Criar `app/loja/[slug]/layout.tsx` que carrega Rubik por `next/font/google` (pesos 400/500/600/700) e envolve a rota numa `div` com a classe da variável.
- `tailwind.config.ts` ganha `fontFamily.vitrine = ["var(--font-rubik)", "Rubik", "sans-serif"]`.
- A vitrine aplica `font-vitrine` no contêiner raiz. Inter segue intocada no resto do app.
- **CLAUDE.md §3 é atualizado** registrando a exceção: Inter no painel, Rubik na vitrine. O documento hoje diz "Inter em todo o app" e passaria a mentir.

## 7. Semear as categorias da Pizza do Rosa

A origem serve uma imagem de fundo por sessão (`sessao_catbackgroundmobile`), e as 12 sessões têm — verificado em 2026-09-13, todas respondendo HTTP 200. As 15 categorias do Menuzia derivam dessas 12 (PIZZA gera Salgadas e Doces; Hambúrguers gera Hambúrguers e Pizza Burguer; Bebidas gera Bebidas e Cervejas e Vinhos), então todas as 15 ficam cobertas.

Script `scripts/import-pizza-do-rosa/semear-fotos-categoria.mjs`, no mesmo molde do `repor-fotos.mjs` que já existe: dry-run por padrão, só grava em categoria cujo `imagem_url` é NULL, não cria nem apaga linha, rodar de novo é no-op, e sobe pra mesma pasta marcada (`<rid>/import-expresso-2026-09/`) para que a reversão documentada continue pegando tudo.

## 8. O que este spec NÃO faz

- Não gera recortes de imagem no servidor; o ponto de foco é só CSS.
- Não mexe na folha de impressão térmica (CLAUDE.md §7).
- Não muda os modos `'categoria'` e `'lista'`.
- Não muda ficha de produto, sacola, checkout, PDV, kanban nem cozinha.
- Não troca a fonte do painel.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Banner 2:1 empurra o primeiro produto pra baixo da dobra em telas pequenas | Foi a opção escolhida entre três, com o trade-off mostrado; 2:1 foi a mais conservadora das que aumentam |
| Foco gravado fora de 0-100 por dado corrompido | `focoValido` satura na leitura; pior caso é a imagem ancorada numa borda |
| Loja liga gaveta e depois cria categoria sem foto | Cartão sem imagem na cor do tema + pendência no painel (5.5); nenhum item fica inacessível |
| Duas fontes aumentam o peso da vitrine | Rubik só na rota da vitrine, via `next/font` (self-host, sem request a terceiro); o painel não baixa Rubik e a vitrine não baixa Inter |
