# Endereço estruturado + mapa do PIN + cidade/bairro na vitrine

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

## Backend (`lib/queries/ajustes.ts`)

- `ConfigLoja` e `CONFIG_SELECT`: adicionar os 6 campos estruturados.
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

- `RestauranteVitrine` ganha `bairro: string | null` e `cidade: string | null`.
- `buscarRestaurantePorSlug` seleciona `endereco_bairro, endereco_cidade` e mapeia.
- Abaixo da linha `Aberto agora / Loja fechada` + `⏱ 30–45 min` (por volta da
  page.tsx:1742-1753), nova linha: `📍 {bairro}, {cidade}`.
  - Se só um dos dois estiver preenchido, mostra só ele (sem vírgula sobrando).
  - Se os dois estiverem vazios, a linha não é renderizada.

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
