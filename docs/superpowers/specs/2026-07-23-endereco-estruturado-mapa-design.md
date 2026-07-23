# Endereço estruturado + mapa do PIN + cidade/bairro/avaliação/banner na vitrine

## Contexto

Hoje o endereço da loja é um único campo de texto livre (`restaurantes.endereco`),
preenchido em Ajustes > Perfil da loja. Isso serve pro texto do recibo, pro cálculo de
frete (geocodificado via CEP na aba Entrega) e pra exibição na vitrine — mas não dá pra
mostrar "bairro, cidade" de forma confiável na vitrine, nem pro dono conferir/ajustar
visualmente o PIN da loja no mapa (hoje o PIN só é derivado automaticamente do CEP via
geocode, sem revisão humana).

## Objetivo

1. Ajustes > Perfil da loja > Endereço: trocar o campo único por campos separados (rua,
   número, complemento, bairro, cidade, UF), com um mapa ao lado onde o dono confere e
   ajusta manualmente o PIN da loja.
2. Vitrine do cliente: mostrar "bairro, cidade" da loja logo abaixo de
   "Aberto agora ⏱ 30–45 min".
3. Vitrine do cliente: mostrar nota de avaliação (⭐ "4,9 (912 avaliações)") na mesma
   linha de "Aberto agora ⏱ 30–45 min" — campo manual configurado pelo dono (o sistema
   não tem coleta de avaliações de clientes hoje).
4. Ajustes > Perfil da loja: opção de subir um banner promocional que aparece dentro do
   cardápio da vitrine (diferente do banner de capa que já existe).

## Modelagem de dados

Migration nova em `restaurantes`, adicionando (nullable, mesma convenção de nomes já
usada em `clientes`/pedidos para endereço estruturado — `endereco_rua`,
`endereco_numero`, etc.):

```sql
alter table restaurantes
  add column endereco_rua text,
  add column endereco_numero text,
  add column endereco_complemento text,
  add column endereco_bairro text,
  add column endereco_cidade text,
  add column endereco_estado text; -- UF, 2 letras
```

Colunas existentes mantidas sem migração de dado:
- `endereco` (text) — passa a ser **recomposto automaticamente** a cada save a partir
  dos campos estruturados ("Rua, Nº - Complemento, Bairro, Cidade - UF"), preservando
  compatibilidade com tudo que já lê `restaurante.endereco` (recibo, frete, checkout).
- `cep`, `latitude`, `longitude` — reaproveitados como já são hoje.

Lojas existentes: campos novos ficam `null`/vazios até o dono preencher e salvar uma
vez pela aba Loja. Nenhuma tentativa de parsear o texto livre existente (formato
inconsistente demais pra confiar).

Migration adicional, mesmas colunas nullable em `restaurantes` pra avaliação e banner
promocional:

```sql
alter table restaurantes
  add column avaliacao_nota numeric(2,1),      -- ex: 4.9 (0.0–5.0)
  add column avaliacao_qtd integer,             -- ex: 912
  add column banner_promocional_url text;
```

`avaliacao_nota`/`avaliacao_qtd` só aparecem na vitrine quando ambos estiverem
preenchidos (evita mostrar "0,0 (0 avaliações)" pra loja nova). `banner_promocional_url`
segue o mesmo padrão de `logo_url`/`banner_url` — nulo = não mostra nada.

## Backend (`lib/queries/ajustes.ts`)

- `ConfigLoja` e `CONFIG_SELECT`: adicionar os 6 campos estruturados de endereço +
  `avaliacaoNota`, `avaliacaoQtd`, `bannerPromocionalUrl`.
- `AtualizarConfigLojaInput` e `atualizarConfigLoja`:
  - Aceita os 6 campos estruturados (todos opcionais/patch).
  - Ao salvar, recompõe `endereco` = `composeEndereco(rua, numero, complemento,
    bairro, cidade, estado)` (helper novo, ignora partes vazias, sem vírgulas soltas).
  - Aceita `latitude`/`longitude` no patch e os grava diretamente — **muda o
    comportamento atual**: hoje `atualizarConfigLoja` zera `latitude`/`longitude`
    quando `endereco`/`cep` mudam, forçando um re-geocode posterior (feito na aba
    Entrega, via `verificarCoordenadas`). Isso deixa de acontecer quando o save vem da
    aba Loja com um PIN já confirmado no mapa — o save já grava lat/lng corretos no
    mesmo request. O reset condicional só permanece se o save não incluir lat/lng
    (não deve ocorrer no fluxo normal da UI, mas evita ficar com endereço novo e
    coordenada antiga órfã em uso direto da função).
  - Aceita `avaliacaoNota` (number|null), `avaliacaoQtd` (number|null) e
    `bannerPromocionalUrl` (string|null) no patch, gravação direta.
- `enviarBannerPromocionalLoja(supabase, restauranteId, file)`: mesma implementação de
  `enviarBannerLoja`/`enviarLogoLoja`, reaproveitando `enviarImagemPerfil(...,
  'banner-promo')` — mesmo bucket `cardapio`, sem infra nova.

## Frontend — Ajustes > Loja (`app/admin/ajustes/page.tsx`, `TabLoja`)

- Substituir o `Field label="Endereço"` único por um bloco com 2 colunas (`lg:` grid):
  - Coluna esquerda: campos Rua, Número, Complemento, Bairro, Cidade, UF (grid 2
    colunas internamente pra número/complemento/UF ficarem compactos).
  - Coluna direita: mapa (`StorePinMap`, ver abaixo).
  - Em telas estreitas, mapa empilha abaixo dos campos (mobile-first, como o resto do
    admin).
- Estado do formulário ganha os 6 campos + `latitude`/`longitude` (inicializados do
  `ConfigLoja` carregado).
- `save()` inclui os 6 campos + lat/lng atual do mapa no patch.
- Novo `Field label="Avaliação"` (perto do endereço, campo simples): dois inputs numéricos
  lado a lado — "Nota (0 a 5)" (step 0.1) e "Quantidade de avaliações" (inteiro). Hint:
  "Exibido na vitrine como prova social — preencha manualmente com base nas avaliações
  reais da loja (Google, iFood, etc.)."
- Novo `Field label="Banner promocional"` logo após o "Banner de capa" existente, mesmo
  padrão de upload/preview/remover (usa `enviarBannerPromocionalLoja`). Hint: "Aparece
  dentro do cardápio, entre a busca e as categorias — use pra destacar uma promoção."

## Componente novo: `components/maps/store-pin-map.tsx`

Reaproveita `lib/maps/loader.ts` (`loadGoogleMaps`, já usado por `RouteMap`) — mesma
API key `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, sem dependência nova.

Props: `apiKey`, `address` (string composta, pros geocodes), `lat`, `lng`,
`onChange(lat, lng)`.

Comportamento:
- Marker único, `draggable: true`.
- Debounce (~800ms) em mudanças de `address`: dispara `Geocoder.geocode` e reposiciona
  o marker + centraliza o mapa, chamando `onChange` com o resultado.
- `dragend` do marker: chama `onChange` direto com a posição arrastada. Esse é o
  "ajuste manual" — fica valendo até o endereço mudar de novo (nova mudança de texto
  reativa o auto-geocode e sobrescreve).
- Sem `apiKey`: mesmo estado vazio padrão usado em `RouteMap` ("Mapa indisponível —
  configure a chave do Google Maps.").
- Estilo visual reaproveita o `LIGHT_MAP_STYLE` já definido em `route-map.tsx` (mesmo
  tom neutro usado no resto do admin) — extraído pra um módulo compartilhado
  (`lib/maps/style.ts`) pra não duplicar o array em dois componentes.

## Vitrine (`app/loja/[slug]/page.tsx`, `lib/queries/cardapio.ts`)

- `RestauranteVitrine` ganha `bairro: string | null`, `cidade: string | null`,
  `avaliacaoNota: number | null`, `avaliacaoQtd: number | null`,
  `bannerPromocionalUrl: string | null`.
- `buscarRestaurantePorSlug` seleciona `endereco_bairro, endereco_cidade,
  avaliacao_nota, avaliacao_qtd, banner_promocional_url` e mapeia.
- Linha `Aberto agora / Loja fechada` + `⏱ 30–45 min` (page.tsx:1742-1753) ganha um
  terceiro item inline, só quando `avaliacaoNota` e `avaliacaoQtd` estão preenchidos:
  `⭐ 4,9 (912 avaliações)` (nota formatada com vírgula, `toLocaleString('pt-BR', {
  minimumFractionDigits: 1 })`).
- Abaixo dessa linha, nova linha: `📍 {bairro}, {cidade}`.
  - Se só um dos dois estiver preenchido, mostra só ele (sem vírgula sobrando).
  - Se os dois estiverem vazios, a linha não é renderizada.
- Banner promocional: quando `bannerPromocionalUrl` estiver preenchido, renderiza um
  card de imagem full-width (`rounded-md`, borda fina, radius 3px do design system)
  logo abaixo do cartão de cabeçalho da loja (nome/status/busca) e antes dos chips de
  categoria — só na aba Home. Sem link/clique (puramente ilustrativo/decorativo por
  ora), sem carrossel (é um banner só).

## Fora de escopo

- Não altera layout/formatação do recibo térmico (`printer-agent`/`recibo.js`) — regra
  dura do projeto. `endereco` continua sendo uma string, só passa a ser composta
  automaticamente.
- Não tenta migrar/parsear `endereco` de texto livre já cadastrado.
- Não altera a lógica de cálculo de frete (`lib/frete.ts`) além de se beneficiar de um
  lat/lng mais preciso quando o dono ajustar o PIN.
- Não mexe na aba Entrega (`verificarCoordenadas`) além de manter compatibilidade —
  ela continua funcionando como fallback pra lojas que não passaram pela aba Loja
  atualizada ainda.
- Sem sistema de coleta de avaliações — o campo é 100% manual, preenchido pelo dono.
- Banner promocional é único (não é carrossel/lista), sem link clicável.

## Validação

Depois de implementado, validar visualmente com a extensão do Chrome (não só
typecheck/lint): abrir Ajustes > Loja e a vitrine pública da loja de teste, preencher
endereço estruturado, arrastar o pin no mapa, salvar, subir banner promocional, setar
avaliação, e conferir na vitrine: card "Aberto agora ⏱ 30–45 min ⭐ 4,9 (912
avaliações)", linha de bairro/cidade abaixo, e o banner promocional aparecendo entre o
cabeçalho da loja e as categorias.
