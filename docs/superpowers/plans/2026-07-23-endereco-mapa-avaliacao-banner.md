# Endereço Estruturado + Mapa do PIN + Avaliação + Banner Promocional — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o campo de endereço em texto livre da loja por campos estruturados com mapa interativo pro dono ajustar o PIN, e adicionar nota de avaliação + banner promocional na vitrine do cliente.

**Architecture:** Migration aditiva em `restaurantes` (6 colunas de endereço estruturado + avaliação + banner promo). Backend (`lib/queries/ajustes.ts`, `lib/queries/cardapio.ts`) expõe os campos novos e recompõe o `endereco` texto-livre automaticamente (compat com recibo/frete/checkout, que continuam lendo só essa string). Frontend: `app/admin/ajustes/page.tsx` ganha grid de campos + mapa Google (componente novo `StorePinMap`, reaproveitando o loader/estilo já usados por `RouteMap`); `app/loja/[slug]/page.tsx` exibe os dados novos na vitrine.

**Tech Stack:** Next.js 15 (App Router) + TypeScript + Supabase (Postgres + Storage) + Google Maps JavaScript API (já integrada via `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) + Vitest.

## Global Constraints

- Design system Menuzia obrigatório: paleta oficial, fonte Inter, `border-radius: 3px` (classe utilitária `rounded-menuzia` já mapeia isso — usar ela, nunca `rounded-lg`/`rounded-xl` etc.).
- PROIBIDO alterar layout/formatação do recibo térmico (`printer-agent`/`recibo.js`) — `endereco` deve continuar sendo uma string simples, só passa a ser composta automaticamente.
- Migrations em `supabase/migrations/` são aditivas e idempotentes (`if not exists`), nunca destrutivas.
- Todo texto de UI em português (pt-BR), como o resto do admin/vitrine.
- Não parsear/migrar o `endereco` de texto livre já cadastrado — campos novos ficam vazios até o dono preencher.

---

### Task 1: Migration — colunas novas em `restaurantes`

**Files:**
- Create: `supabase/migrations/0045_endereco_estruturado_avaliacao_banner.sql`

**Interfaces:**
- Produces: colunas `restaurantes.endereco_rua`, `endereco_numero`, `endereco_complemento`, `endereco_bairro`, `endereco_cidade`, `endereco_estado` (todas `text`, nullable), `avaliacao_nota` (`numeric(2,1)`, nullable), `avaliacao_qtd` (`integer`, nullable), `banner_promocional_url` (`text`, nullable).

- [ ] **Step 1: Escrever a migration**

```sql
-- Endereço estruturado da loja (rua/número/etc separados, pra exibir
-- bairro/cidade na vitrine e permitir o mapa de ajuste do PIN em Ajustes >
-- Loja). O campo `endereco` (texto livre) continua existindo e passa a ser
-- recomposto automaticamente a partir destes campos — todo o resto do
-- sistema (recibo, frete, checkout) continua lendo só essa string, sem
-- mudança de contrato. Aditivo e idempotente.
alter table restaurantes add column if not exists endereco_rua text;
alter table restaurantes add column if not exists endereco_numero text;
alter table restaurantes add column if not exists endereco_complemento text;
alter table restaurantes add column if not exists endereco_bairro text;
alter table restaurantes add column if not exists endereco_cidade text;
alter table restaurantes add column if not exists endereco_estado text;

-- Nota de avaliação exibida na vitrine (⭐ 4,9 · 912 avaliações). Preenchida
-- manualmente pelo dono — o sistema não coleta avaliações de clientes hoje.
alter table restaurantes add column if not exists avaliacao_nota numeric(2,1);
alter table restaurantes add column if not exists avaliacao_qtd integer;

-- Banner promocional exibido dentro do cardápio da vitrine (separado do
-- banner_url, que é a capa/hero do topo).
alter table restaurantes add column if not exists banner_promocional_url text;
```

- [ ] **Step 2: Aplicar a migration**

Run: `cd C:/projetos/cardapio && node scripts/setup-db.mjs`
Expected: log mostrando `0045_endereco_estruturado_avaliacao_banner.sql` aplicada (script pula migrations já aplicadas, então é seguro rodar de novo se algo já tiver sido aplicado antes).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0045_endereco_estruturado_avaliacao_banner.sql
git commit -m "feat(db): endereco estruturado, avaliacao e banner promocional em restaurantes"
```

---

### Task 2: `composeEndereco` — helper de composição de endereço

**Files:**
- Create: `lib/endereco.ts`
- Test: `lib/endereco.test.ts`

**Interfaces:**
- Produces: `export interface EnderecoPartes { rua: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string }` e `export function composeEndereco(partes: EnderecoPartes): string`.

- [ ] **Step 1: Escrever o teste (falhando)**

```ts
// lib/endereco.test.ts
import { describe, it, expect } from 'vitest'
import { composeEndereco } from './endereco'

describe('composeEndereco', () => {
  it('compõe endereço completo com todos os campos', () => {
    const texto = composeEndereco({
      rua: 'Rua das Flores',
      numero: '123',
      complemento: 'Sala 2',
      bairro: 'Centro',
      cidade: 'Fortaleza',
      estado: 'CE',
    })
    expect(texto).toBe('Rua das Flores, 123 - Sala 2, Centro, Fortaleza - CE')
  })

  it('omite complemento vazio sem deixar traço sobrando', () => {
    const texto = composeEndereco({
      rua: 'Rua das Flores',
      numero: '123',
      complemento: '',
      bairro: 'Centro',
      cidade: 'Fortaleza',
      estado: 'CE',
    })
    expect(texto).toBe('Rua das Flores, 123, Centro, Fortaleza - CE')
  })

  it('omite estado vazio sem deixar traço sobrando', () => {
    const texto = composeEndereco({
      rua: 'Rua das Flores',
      numero: '123',
      complemento: '',
      bairro: 'Centro',
      cidade: 'Fortaleza',
      estado: '',
    })
    expect(texto).toBe('Rua das Flores, 123, Centro, Fortaleza')
  })

  it('retorna string vazia quando todos os campos estão vazios', () => {
    const texto = composeEndereco({ rua: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' })
    expect(texto).toBe('')
  })

  it('ignora espaços em branco nas pontas de cada campo', () => {
    const texto = composeEndereco({ rua: '  Rua X ', numero: ' 10 ', complemento: '', bairro: '', cidade: ' Fortaleza ', estado: '' })
    expect(texto).toBe('Rua X, 10, Fortaleza')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd C:/projetos/cardapio && npx vitest run lib/endereco.test.ts`
Expected: FAIL — `Cannot find module './endereco'` (arquivo ainda não existe).

- [ ] **Step 3: Implementar**

```ts
// lib/endereco.ts

export interface EnderecoPartes {
  rua: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  estado: string
}

/**
 * Compõe o endereço completo em texto livre a partir dos campos estruturados,
 * ignorando partes vazias (sem vírgula/traço sobrando). Formato:
 * "Rua, Nº - Complemento, Bairro, Cidade - UF".
 */
export function composeEndereco(partes: EnderecoPartes): string {
  const rua = partes.rua.trim()
  const numero = partes.numero.trim()
  const complemento = partes.complemento.trim()
  const bairro = partes.bairro.trim()
  const cidade = partes.cidade.trim()
  const estado = partes.estado.trim()

  const ruaNumero = [rua, numero].filter(Boolean).join(', ')
  const linha1 = [ruaNumero, complemento].filter(Boolean).join(' - ')
  const cidadeUf = [cidade, estado].filter(Boolean).join(' - ')
  const linha2 = [bairro, cidadeUf].filter(Boolean).join(', ')

  return [linha1, linha2].filter(Boolean).join(', ')
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd C:/projetos/cardapio && npx vitest run lib/endereco.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/endereco.ts lib/endereco.test.ts
git commit -m "feat: helper composeEndereco pra montar endereço texto a partir dos campos estruturados"
```

---

### Task 3: Extrair estilo de mapa compartilhado

**Files:**
- Create: `lib/maps/style.ts`
- Modify: `components/maps/route-map.tsx:20-32` (remove `LIGHT_MAP_STYLE` local, importa do módulo novo)

**Interfaces:**
- Produces: `export const LIGHT_MAP_STYLE: google.maps.MapTypeStyle[]` em `lib/maps/style.ts`.
- Consumes (em route-map.tsx): nada de outra task — só reorganiza código já existente.

- [ ] **Step 1: Criar o módulo de estilo**

```ts
// lib/maps/style.ts

/** Estilo neutro/claro do Google Maps usado em todos os mapas do admin Menuzia. */
export const LIGHT_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f5f6f8' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#d1d5db' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'road.arterial', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbeafe' }] },
]
```

- [ ] **Step 2: Atualizar `route-map.tsx` pra importar o estilo compartilhado**

Em `components/maps/route-map.tsx`, remova o bloco `const LIGHT_MAP_STYLE: google.maps.MapTypeStyle[] = [...]` (linhas 20-32) e adicione o import:

```ts
import { LIGHT_MAP_STYLE } from '@/lib/maps/style'
```

(mantém a linha `import { loadGoogleMaps } from '@/lib/maps/loader'` já existente logo acima; o resto do arquivo usa `LIGHT_MAP_STYLE` sem nenhuma outra mudança.)

- [ ] **Step 3: Verificar que o projeto ainda compila**

Run: `cd C:/projetos/cardapio && npx tsc --noEmit -p tsconfig.json 2>&1 | grep route-map`
Expected: nenhuma linha de erro para `route-map.tsx`.

- [ ] **Step 4: Commit**

```bash
git add lib/maps/style.ts components/maps/route-map.tsx
git commit -m "refactor: extrai LIGHT_MAP_STYLE pra módulo compartilhado lib/maps/style.ts"
```

---

### Task 4: Componente `StorePinMap`

**Files:**
- Create: `components/maps/store-pin-map.tsx`

**Interfaces:**
- Consumes: `loadGoogleMaps(apiKey: string): Promise<typeof google>` de `lib/maps/loader.ts`; `LIGHT_MAP_STYLE` de `lib/maps/style.ts` (Task 3).
- Produces: `export function StorePinMap({ apiKey, address, lat, lng, onChange, className }: StorePinMapProps): JSX.Element`, usado pela Task 6.

- [ ] **Step 1: Implementar o componente**

```tsx
// components/maps/store-pin-map.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/maps/loader'
import { LIGHT_MAP_STYLE } from '@/lib/maps/style'

interface StorePinMapProps {
  apiKey?: string
  /** Endereço composto (rua, número, bairro, cidade, UF) usado pro geocode automático. */
  address: string
  lat: number | null
  lng: number | null
  /** Chamado tanto pelo geocode automático quanto pelo arraste manual do pin. */
  onChange: (lat: number, lng: number) => void
  className?: string
}

const FALLBACK_CENTER = { lat: -3.73, lng: -38.53 }

/** Mapa com um único PIN arrastável pro dono conferir/ajustar a localização da loja. */
export function StorePinMap({ apiKey, address, lat, lng, onChange, className }: StorePinMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markerRef = useRef<google.maps.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // Endereço já processado (no geocode automático ou como valor inicial no mount) —
  // evita regeocodificar (e sobrescrever um ajuste manual) sem o texto ter mudado de fato.
  const lastAddressRef = useRef<string>(address)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!apiKey || !containerRef.current) return
    let cancelled = false
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return
        const center = lat != null && lng != null ? { lat, lng } : FALLBACK_CENTER
        const map = new google.maps.Map(containerRef.current, {
          center,
          zoom: lat != null && lng != null ? 16 : 12,
          styles: LIGHT_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
        })
        const marker = new google.maps.Marker({ map, position: center, draggable: true })
        marker.addListener('dragend', () => {
          const pos = marker.getPosition()
          if (!pos) return
          onChangeRef.current(pos.lat(), pos.lng())
        })
        mapRef.current = map
        markerRef.current = marker
        setReady(true)
      })
      .catch(() => setError('Não foi possível carregar o mapa.'))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  // Reposiciona o marker quando lat/lng mudam externamente (geocode automático ou
  // carregamento inicial de uma loja já cadastrada).
  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!ready || !map || !marker || lat == null || lng == null) return
    const pos = { lat, lng }
    marker.setPosition(pos)
    map.setCenter(pos)
    map.setZoom(16)
  }, [ready, lat, lng])

  // Geocodifica o endereço (debounced) sempre que o texto mudar de verdade — não
  // dispara no primeiro render (lastAddressRef já começa igual ao address inicial),
  // então um PIN ajustado manualmente só é sobrescrito se o dono editar o endereço.
  useEffect(() => {
    if (!ready || !address.trim() || address === lastAddressRef.current) return
    lastAddressRef.current = address
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const geocoder = new google.maps.Geocoder()
      geocoder.geocode({ address, region: 'BR' }, (results, status) => {
        if (status !== google.maps.GeocoderStatus.OK || !results?.[0]) {
          setError('Não foi possível localizar esse endereço no mapa — ajuste o pin manualmente.')
          return
        }
        setError(null)
        const pos = results[0].geometry.location
        onChangeRef.current(pos.lat(), pos.lng())
      })
    }, 800)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [ready, address])

  if (!apiKey) {
    return (
      <div className={`flex items-center justify-center rounded-menuzia border border-dashed border-border bg-page p-8 text-center text-sm text-text-subtle ${className ?? ''}`}>
        Mapa indisponível — configure a chave do Google Maps.
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden rounded-menuzia ${className ?? ''}`}>
      <div ref={containerRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-x-2 bottom-2 rounded-menuzia bg-white/95 px-3 py-1.5 text-center text-[11px] font-medium text-danger shadow">
          {error}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd C:/projetos/cardapio && npx tsc --noEmit -p tsconfig.json 2>&1 | grep store-pin-map`
Expected: nenhuma linha de erro.

- [ ] **Step 3: Commit**

```bash
git add components/maps/store-pin-map.tsx
git commit -m "feat: componente StorePinMap com pin arrastável e geocode automático debounced"
```

---

### Task 5: Backend — `lib/queries/ajustes.ts`

**Files:**
- Modify: `lib/queries/ajustes.ts:1-152`

**Interfaces:**
- Consumes: `composeEndereco` de `lib/endereco.ts` (Task 2).
- Produces: `ConfigLoja` com os campos novos; `ConfigLojaPatch` com os campos novos; `enviarBannerPromocionalLoja(supabase: SupabaseClient, restauranteId: string, file: File): Promise<string>`.

- [ ] **Step 1: Atualizar `ConfigLoja`, `ConfigRow` e `CONFIG_SELECT`**

Em `lib/queries/ajustes.ts`, adicione o import e os campos:

```ts
import { composeEndereco } from '@/lib/endereco'
```

```ts
export interface ConfigLoja {
  id: string
  nome: string
  slug: string
  logoUrl: string | null
  bannerUrl: string | null
  bannerPromocionalUrl: string | null
  telefone: string
  endereco: string
  enderecoRua: string
  enderecoNumero: string
  enderecoComplemento: string
  enderecoBairro: string
  enderecoCidade: string
  enderecoEstado: string
  cep: string
  taxaEntregaPadrao: number
  freteGratisAcima: number | null
  facebookPixelId: string | null
  googleTagId: string | null
  layoutCardapio: LayoutCardapio
  corTema: string
  imagemGrande: boolean
  latitude: number | null
  longitude: number | null
  avaliacaoNota: number | null
  avaliacaoQtd: number | null
  horarioFuncionamento: HorarioFuncionamento | null
  statusLoja: StatusLoja
}

interface ConfigRow {
  id: string
  nome: string
  slug: string
  logo_url: string | null
  banner_url: string | null
  banner_promocional_url: string | null
  telefone: string
  endereco: string
  endereco_rua: string | null
  endereco_numero: string | null
  endereco_complemento: string | null
  endereco_bairro: string | null
  endereco_cidade: string | null
  endereco_estado: string | null
  cep: string | null
  taxa_entrega_padrao: number
  frete_gratis_acima: number | null
  facebook_pixel_id: string | null
  google_tag_id: string | null
  layout_cardapio: LayoutCardapio
  cor_tema: string
  imagem_grande: boolean
  latitude: number | null
  longitude: number | null
  avaliacao_nota: number | null
  avaliacao_qtd: number | null
  horario_funcionamento: HorarioFuncionamento | null
  status_loja: StatusLoja
}

const CONFIG_SELECT =
  'id, nome, slug, logo_url, banner_url, banner_promocional_url, telefone, endereco, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado, cep, taxa_entrega_padrao, frete_gratis_acima, facebook_pixel_id, google_tag_id, layout_cardapio, cor_tema, imagem_grande, latitude, longitude, avaliacao_nota, avaliacao_qtd, horario_funcionamento, status_loja'
```

- [ ] **Step 2: Atualizar `mapConfig`**

```ts
function mapConfig(row: ConfigRow): ConfigLoja {
  return {
    id: row.id,
    nome: row.nome,
    slug: row.slug,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    bannerPromocionalUrl: row.banner_promocional_url,
    telefone: row.telefone,
    endereco: row.endereco,
    enderecoRua: row.endereco_rua ?? '',
    enderecoNumero: row.endereco_numero ?? '',
    enderecoComplemento: row.endereco_complemento ?? '',
    enderecoBairro: row.endereco_bairro ?? '',
    enderecoCidade: row.endereco_cidade ?? '',
    enderecoEstado: row.endereco_estado ?? '',
    cep: row.cep ?? '',
    taxaEntregaPadrao: Number(row.taxa_entrega_padrao),
    freteGratisAcima: row.frete_gratis_acima === null ? null : Number(row.frete_gratis_acima),
    facebookPixelId: row.facebook_pixel_id,
    googleTagId: row.google_tag_id,
    layoutCardapio: row.layout_cardapio ?? 'categoria',
    corTema: row.cor_tema ?? 'azul',
    imagemGrande: row.imagem_grande ?? false,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    avaliacaoNota: row.avaliacao_nota === null || row.avaliacao_nota === undefined ? null : Number(row.avaliacao_nota),
    avaliacaoQtd: row.avaliacao_qtd ?? null,
    horarioFuncionamento: row.horario_funcionamento ?? null,
    statusLoja: row.status_loja ?? 'automatico',
  }
}
```

- [ ] **Step 3: Atualizar `ConfigLojaPatch` e `atualizarConfigLoja`**

```ts
export interface ConfigLojaPatch {
  nome?: string
  logoUrl?: string | null
  bannerUrl?: string | null
  bannerPromocionalUrl?: string | null
  telefone?: string
  endereco?: string
  enderecoRua?: string
  enderecoNumero?: string
  enderecoComplemento?: string
  enderecoBairro?: string
  enderecoCidade?: string
  enderecoEstado?: string
  cep?: string
  latitude?: number | null
  longitude?: number | null
  avaliacaoNota?: number | null
  avaliacaoQtd?: number | null
  taxaEntregaPadrao?: number
  freteGratisAcima?: number | null
  facebookPixelId?: string | null
  googleTagId?: string | null
  layoutCardapio?: LayoutCardapio
  corTema?: string
  imagemGrande?: boolean
  horarioFuncionamento?: HorarioFuncionamento
}

export async function atualizarConfigLoja(supabase: SupabaseClient, restauranteId: string, patch: ConfigLojaPatch): Promise<ConfigLoja> {
  const row: Record<string, unknown> = {}
  if (patch.nome !== undefined) row.nome = patch.nome
  if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl
  if (patch.bannerUrl !== undefined) row.banner_url = patch.bannerUrl
  if (patch.bannerPromocionalUrl !== undefined) row.banner_promocional_url = patch.bannerPromocionalUrl
  if (patch.telefone !== undefined) row.telefone = patch.telefone

  // Campos estruturados vêm sempre juntos (o form da aba Loja manda os 6 de uma vez) —
  // quando presentes, recompõe o endereco texto-livre automaticamente. `patch.endereco`
  // direto continua aceito pra qualquer chamada legada que não use os campos separados.
  let enderecoMudou = false
  if (patch.enderecoRua !== undefined) {
    row.endereco_rua = patch.enderecoRua
    row.endereco_numero = patch.enderecoNumero ?? ''
    row.endereco_complemento = patch.enderecoComplemento ?? ''
    row.endereco_bairro = patch.enderecoBairro ?? ''
    row.endereco_cidade = patch.enderecoCidade ?? ''
    row.endereco_estado = patch.enderecoEstado ?? ''
    row.endereco = composeEndereco({
      rua: patch.enderecoRua,
      numero: patch.enderecoNumero ?? '',
      complemento: patch.enderecoComplemento ?? '',
      bairro: patch.enderecoBairro ?? '',
      cidade: patch.enderecoCidade ?? '',
      estado: patch.enderecoEstado ?? '',
    })
    enderecoMudou = true
  } else if (patch.endereco !== undefined) {
    row.endereco = patch.endereco
    enderecoMudou = true
  }
  if (patch.cep !== undefined) {
    row.cep = patch.cep
    enderecoMudou = true
  }

  // Se quem chamou já manda lat/lng junto (aba Loja, com o PIN confirmado no mapa),
  // grava direto. Senão, se endereço/CEP mudaram sem coordenada nova junto (chamada
  // legada), invalida o cache pro próximo cálculo de frete regeocodificar.
  if (patch.latitude !== undefined && patch.longitude !== undefined) {
    row.latitude = patch.latitude
    row.longitude = patch.longitude
  } else if (enderecoMudou) {
    row.latitude = null
    row.longitude = null
  }

  if (patch.avaliacaoNota !== undefined) row.avaliacao_nota = patch.avaliacaoNota
  if (patch.avaliacaoQtd !== undefined) row.avaliacao_qtd = patch.avaliacaoQtd
  if (patch.taxaEntregaPadrao !== undefined) row.taxa_entrega_padrao = patch.taxaEntregaPadrao
  if (patch.freteGratisAcima !== undefined) row.frete_gratis_acima = patch.freteGratisAcima
  if (patch.facebookPixelId !== undefined) row.facebook_pixel_id = patch.facebookPixelId
  if (patch.googleTagId !== undefined) row.google_tag_id = patch.googleTagId
  if (patch.layoutCardapio !== undefined) row.layout_cardapio = patch.layoutCardapio
  if (patch.corTema !== undefined) row.cor_tema = patch.corTema
  if (patch.imagemGrande !== undefined) row.imagem_grande = patch.imagemGrande
  if (patch.horarioFuncionamento !== undefined) row.horario_funcionamento = patch.horarioFuncionamento

  const { data, error } = await supabase.from('restaurantes').update(row).eq('id', restauranteId).select(CONFIG_SELECT).single()
  if (error) throw error
  return mapConfig(data as ConfigRow)
}
```

- [ ] **Step 4: Adicionar `enviarBannerPromocionalLoja`**

Logo abaixo de `enviarBannerLoja` (perto da linha 247 original):

```ts
export function enviarBannerPromocionalLoja(supabase: SupabaseClient, restauranteId: string, file: File): Promise<string> {
  return enviarImagemPerfil(supabase, restauranteId, file, 'banner-promo')
}
```

- [ ] **Step 5: Verificar tipos**

Run: `cd C:/projetos/cardapio && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "queries/ajustes"`
Expected: nenhuma linha de erro.

- [ ] **Step 6: Commit**

```bash
git add lib/queries/ajustes.ts
git commit -m "feat: ConfigLoja aceita endereço estruturado, avaliação e banner promocional"
```

---

### Task 6: Frontend — Ajustes > Loja (campos + mapa + avaliação + banner)

**Files:**
- Modify: `app/admin/ajustes/page.tsx:1-401` (import, estado do form, `TabLoja`)

**Interfaces:**
- Consumes: `StorePinMap` (Task 4), `composeEndereco` (Task 2), `ConfigLoja`/`ConfigLojaPatch`/`enviarBannerPromocionalLoja` (Task 5).

- [ ] **Step 1: Atualizar imports**

```ts
import { StorePinMap } from '@/components/maps/store-pin-map'
import { composeEndereco } from '@/lib/endereco'
```

E no import existente de `@/lib/queries/ajustes`, adicionar `enviarBannerPromocionalLoja`:

```ts
import {
  buscarConfigLoja,
  atualizarConfigLoja,
  enviarLogoLoja,
  enviarBannerLoja,
  enviarBannerPromocionalLoja,
  listarTaxasBairro,
  criarTaxaBairro,
  atualizarTaxaBairro,
  removerTaxaBairro,
  listarTaxasRaio,
  criarTaxaRaio,
  atualizarTaxaRaio,
  removerTaxaRaio,
  salvarCoordenadasLoja,
  type TaxaRaio,
  type ConfigLoja,
  type TaxaBairro,
} from '@/lib/queries/ajustes'
```

- [ ] **Step 2: Ampliar o estado do form em `TabLoja`**

Substitua a linha do `useState` do form (linha 159 original):

```ts
const [form, setForm] = useState({
  nome: '',
  telefone: '',
  enderecoRua: '',
  enderecoNumero: '',
  enderecoComplemento: '',
  enderecoBairro: '',
  enderecoCidade: '',
  enderecoEstado: '',
  cep: '',
  latitude: null as number | null,
  longitude: null as number | null,
  avaliacaoNota: '',
  avaliacaoQtd: '',
  logoUrl: '',
  bannerUrl: '',
  bannerPromocionalUrl: '',
  layoutCardapio: 'categoria' as LayoutCardapio,
  imagemGrande: false,
})
const [uploadingBannerPromo, setUploadingBannerPromo] = useState(false)
const bannerPromoInputRef = useRef<HTMLInputElement>(null)
```

- [ ] **Step 3: Atualizar o `useEffect` de carga e o helper `set`**

```ts
useEffect(() => {
  if (loaded) return
  buscarConfigLoja(supabase, restauranteId).then((c) => {
    if (!c) return
    setConfig(c)
    setForm({
      nome: c.nome,
      telefone: c.telefone,
      enderecoRua: c.enderecoRua,
      enderecoNumero: c.enderecoNumero,
      enderecoComplemento: c.enderecoComplemento,
      enderecoBairro: c.enderecoBairro,
      enderecoCidade: c.enderecoCidade,
      enderecoEstado: c.enderecoEstado,
      cep: c.cep,
      latitude: c.latitude,
      longitude: c.longitude,
      avaliacaoNota: c.avaliacaoNota === null ? '' : String(c.avaliacaoNota),
      avaliacaoQtd: c.avaliacaoQtd === null ? '' : String(c.avaliacaoQtd),
      logoUrl: c.logoUrl ?? '',
      bannerUrl: c.bannerUrl ?? '',
      bannerPromocionalUrl: c.bannerPromocionalUrl ?? '',
      layoutCardapio: c.layoutCardapio,
      imagemGrande: c.imagemGrande,
    })
    setHorarioDias(horarioSemanaFromConfig(c.horarioFuncionamento))
    setLoaded(true)
  })
}, [supabase, restauranteId, loaded])

function set(
  key:
    | 'nome' | 'telefone' | 'cep'
    | 'enderecoRua' | 'enderecoNumero' | 'enderecoComplemento' | 'enderecoBairro' | 'enderecoCidade' | 'enderecoEstado'
    | 'avaliacaoNota' | 'avaliacaoQtd'
    | 'logoUrl' | 'bannerUrl' | 'bannerPromocionalUrl',
  value: string
) {
  setForm((f) => ({ ...f, [key]: value }))
  setSaved(false)
}

function setPin(lat: number, lng: number) {
  setForm((f) => ({ ...f, latitude: lat, longitude: lng }))
  setSaved(false)
}
```

- [ ] **Step 4: Handler de upload do banner promocional**

Logo abaixo de `handleBannerPick`:

```ts
async function handleBannerPromoPick(event: React.ChangeEvent<HTMLInputElement>) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  setUploadingBannerPromo(true)
  setError(null)
  try {
    const url = await enviarBannerPromocionalLoja(supabase, restauranteId, file)
    set('bannerPromocionalUrl', url)
  } catch {
    setError('Não foi possível enviar a imagem. Verifique se o bucket "cardapio" existe no Supabase Storage.')
  } finally {
    setUploadingBannerPromo(false)
  }
}
```

- [ ] **Step 5: Atualizar `save()`**

```ts
async function save() {
  if (!form.nome.trim()) { setError('O nome do estabelecimento é obrigatório.'); return }
  setSaving(true)
  setError(null)
  try {
    const horarioFuncionamento: NonNullable<ConfigLoja['horarioFuncionamento']> = {}
    for (const [dia, v] of Object.entries(horarioDias)) {
      horarioFuncionamento[dia] = v.ativo ? { abre: v.abre, fecha: v.fecha } : null
    }
    const updated = await atualizarConfigLoja(supabase, restauranteId, {
      nome: form.nome.trim(),
      telefone: form.telefone.trim(),
      enderecoRua: form.enderecoRua.trim(),
      enderecoNumero: form.enderecoNumero.trim(),
      enderecoComplemento: form.enderecoComplemento.trim(),
      enderecoBairro: form.enderecoBairro.trim(),
      enderecoCidade: form.enderecoCidade.trim(),
      enderecoEstado: form.enderecoEstado.trim(),
      cep: form.cep.trim(),
      latitude: form.latitude,
      longitude: form.longitude,
      avaliacaoNota: form.avaliacaoNota.trim() === '' ? null : Number(form.avaliacaoNota.replace(',', '.')),
      avaliacaoQtd: form.avaliacaoQtd.trim() === '' ? null : Math.round(Number(form.avaliacaoQtd)),
      logoUrl: form.logoUrl.trim() || null,
      bannerUrl: form.bannerUrl.trim() || null,
      bannerPromocionalUrl: form.bannerPromocionalUrl.trim() || null,
      layoutCardapio: form.layoutCardapio,
      imagemGrande: form.imagemGrande,
      horarioFuncionamento,
    })
    setConfig(updated)
    setForm((f) => ({ ...f, latitude: updated.latitude, longitude: updated.longitude }))
    setHorarioDias(horarioSemanaFromConfig(updated.horarioFuncionamento))
    setSaved(true)
  } catch {
    setError('Não foi possível salvar as alterações. Verifique sua conexão e tente novamente.')
  } finally {
    setSaving(false)
  }
}
```

- [ ] **Step 6: Trocar o JSX do campo "Endereço" pelo grid + mapa**

Substitua o bloco `<Field label="Endereço">...</Field>` (linhas 267-269 originais) por:

```tsx
<Field label="Endereço">
  <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-text-subtle">Rua</label>
          <Input value={form.enderecoRua} onChange={(e) => set('enderecoRua', e.target.value)} placeholder="Rua das Flores" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-text-subtle">Número</label>
          <Input value={form.enderecoNumero} onChange={(e) => set('enderecoNumero', e.target.value)} placeholder="123" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-text-subtle">Complemento</label>
        <Input value={form.enderecoComplemento} onChange={(e) => set('enderecoComplemento', e.target.value)} placeholder="Sala, bloco, referência (opcional)" />
      </div>
      <div className="grid grid-cols-[1fr_1fr_70px] gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-text-subtle">Bairro</label>
          <Input value={form.enderecoBairro} onChange={(e) => set('enderecoBairro', e.target.value)} placeholder="Centro" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-text-subtle">Cidade</label>
          <Input value={form.enderecoCidade} onChange={(e) => set('enderecoCidade', e.target.value)} placeholder="Fortaleza" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-text-subtle">UF</label>
          <Input value={form.enderecoEstado} onChange={(e) => set('enderecoEstado', e.target.value.toUpperCase().slice(0, 2))} placeholder="CE" maxLength={2} />
        </div>
      </div>
    </div>
    <div className="flex flex-col gap-1.5">
      <StorePinMap
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
        address={composeEndereco({
          rua: form.enderecoRua,
          numero: form.enderecoNumero,
          complemento: form.enderecoComplemento,
          bairro: form.enderecoBairro,
          cidade: form.enderecoCidade,
          estado: form.enderecoEstado,
        })}
        lat={form.latitude}
        lng={form.longitude}
        onChange={setPin}
        className="h-[220px] w-full border border-border"
      />
      <p className="text-[11px] text-text-subtle">Arraste o pin pra ajustar a localização exata da loja no mapa.</p>
    </div>
  </div>
</Field>
```

- [ ] **Step 7: Adicionar o campo de Avaliação**

Logo após o `Field label="CEP"` (linhas 270-272 originais), antes do `Field label="Horário de funcionamento"`:

```tsx
<Field label="Avaliação" hint="Exibida na vitrine como prova social — preencha manualmente com base nas avaliações reais da loja (Google, iFood, etc.). Deixe em branco pra não mostrar nada.">
  <div className="grid grid-cols-2 gap-3">
    <Input
      value={form.avaliacaoNota}
      onChange={(e) => set('avaliacaoNota', e.target.value)}
      placeholder="Nota (ex: 4.9)"
      inputMode="decimal"
    />
    <Input
      value={form.avaliacaoQtd}
      onChange={(e) => set('avaliacaoQtd', e.target.value)}
      placeholder="Qtd. de avaliações (ex: 912)"
      inputMode="numeric"
    />
  </div>
</Field>
```

- [ ] **Step 8: Adicionar o campo de Banner promocional**

Logo após o `Field label="Banner de capa"` existente (após a linha 349 original, fechamento daquele Field):

```tsx
<Field label="Banner promocional" hint="Aparece dentro do cardápio, entre a busca e as categorias — use pra destacar uma promoção. Deixe em branco pra não mostrar nada.">
  <div className="space-y-2.5">
    {form.bannerPromocionalUrl && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={form.bannerPromocionalUrl} alt="Banner promocional" className="h-28 w-full rounded-menuzia border border-border object-cover" />
    )}
    <input ref={bannerPromoInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerPromoPick} />
    <div className="flex items-center gap-3">
      <Button variant="outline" type="button" onClick={() => bannerPromoInputRef.current?.click()} disabled={uploadingBannerPromo}>
        {uploadingBannerPromo ? 'Enviando…' : form.bannerPromocionalUrl ? 'Trocar imagem' : 'Enviar imagem'}
      </Button>
      {form.bannerPromocionalUrl && (
        <button type="button" onClick={() => set('bannerPromocionalUrl', '')} className="text-[12px] text-text-subtle hover:text-danger">Remover</button>
      )}
    </div>
  </div>
</Field>
```

- [ ] **Step 9: Verificar tipos e lint**

Run: `cd C:/projetos/cardapio && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "admin/ajustes" && npx eslint app/admin/ajustes/page.tsx`
Expected: nenhum erro novo (avisos pré-existentes tudo bem).

- [ ] **Step 10: Commit**

```bash
git add app/admin/ajustes/page.tsx
git commit -m "feat(ajustes): endereço estruturado com mapa de PIN, avaliação e banner promocional"
```

---

### Task 7: Backend — vitrine (`lib/queries/cardapio.ts`)

**Files:**
- Modify: `lib/queries/cardapio.ts:718-765`

**Interfaces:**
- Produces: `RestauranteVitrine` com `bairro`, `cidade`, `avaliacaoNota`, `avaliacaoQtd`, `bannerPromocionalUrl`; consumido pela Task 8.

- [ ] **Step 1: Atualizar `RestauranteVitrine` e a query**

```ts
export interface RestauranteVitrine {
  id: string
  nome: string
  slug: string
  logoUrl: string | null
  bannerUrl: string | null
  bannerPromocionalUrl: string | null
  telefone: string
  endereco: string
  bairro: string | null
  cidade: string | null
  taxaEntregaPadrao: number
  /** Pedidos com subtotal >= este valor têm entrega grátis. Null = desativado. */
  freteGratisAcima: number | null
  facebookPixelId: string | null
  googleTagId: string | null
  orderBumpMax: number
  layoutCardapio: LayoutCardapio
  corTema: string
  imagemGrande: boolean
  /** true se a loja está aceitando pedidos agora (manual ou pela grade de horário — ver lib/timezone.ts). */
  lojaAberta: boolean
  avaliacaoNota: number | null
  avaliacaoQtd: number | null
}

export async function buscarRestaurantePorSlug(supabase: SupabaseClient, slug: string): Promise<RestauranteVitrine | null> {
  const { data, error } = await supabase
    .from('restaurantes')
    .select(
      'id, nome, slug, logo_url, banner_url, banner_promocional_url, telefone, endereco, endereco_bairro, endereco_cidade, taxa_entrega_padrao, frete_gratis_acima, facebook_pixel_id, google_tag_id, order_bump_max, layout_cardapio, cor_tema, imagem_grande, status_loja, horario_funcionamento, avaliacao_nota, avaliacao_qtd'
    )
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id,
    nome: data.nome,
    slug: data.slug,
    logoUrl: data.logo_url,
    bannerUrl: data.banner_url,
    bannerPromocionalUrl: data.banner_promocional_url,
    telefone: data.telefone,
    endereco: data.endereco,
    bairro: data.endereco_bairro,
    cidade: data.endereco_cidade,
    taxaEntregaPadrao: Number(data.taxa_entrega_padrao),
    freteGratisAcima: data.frete_gratis_acima === null || data.frete_gratis_acima === undefined ? null : Number(data.frete_gratis_acima),
    facebookPixelId: data.facebook_pixel_id,
    googleTagId: data.google_tag_id,
    orderBumpMax: Number(data.order_bump_max ?? 4),
    layoutCardapio: (data.layout_cardapio as LayoutCardapio) ?? 'categoria',
    corTema: (data.cor_tema as string) ?? 'azul',
    imagemGrande: Boolean(data.imagem_grande),
    lojaAberta: lojaEstaAberta({ statusLoja: data.status_loja ?? 'automatico', horarioFuncionamento: data.horario_funcionamento ?? null }),
    avaliacaoNota: data.avaliacao_nota === null || data.avaliacao_nota === undefined ? null : Number(data.avaliacao_nota),
    avaliacaoQtd: data.avaliacao_qtd ?? null,
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd C:/projetos/cardapio && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "queries/cardapio"`
Expected: nenhuma linha de erro.

- [ ] **Step 3: Commit**

```bash
git add lib/queries/cardapio.ts
git commit -m "feat: RestauranteVitrine expõe bairro, cidade, avaliação e banner promocional"
```

---

### Task 8: Frontend — vitrine (`app/loja/[slug]/page.tsx`)

**Files:**
- Modify: `app/loja/[slug]/page.tsx:103` (helper), `:1742-1776` (linha de status), `:1776-1778` (banner promocional)

**Interfaces:**
- Consumes: `RestauranteVitrine.bairro/cidade/avaliacaoNota/avaliacaoQtd/bannerPromocionalUrl` (Task 7).

- [ ] **Step 1: Helper de formatação da nota**

Logo abaixo da linha `const brl = (value: number) => ...` (linha 103 original):

```ts
const formatarNota = (nota: number) => nota.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
```

- [ ] **Step 2: Adicionar a nota de avaliação na linha de status**

Dentro do bloco da barra única da loja, logo após o `<span>⏱ 30–45 min</span>` (linha 1752 original), ainda dentro da mesma `<div className="mt-1 inline-flex ...">`:

```tsx
<span>⏱ 30–45 min</span>
{restaurante.avaliacaoNota !== null && restaurante.avaliacaoQtd !== null && (
  <span className="inline-flex items-center gap-1">
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-[#F59E0B]"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
    {formatarNota(restaurante.avaliacaoNota)} ({restaurante.avaliacaoQtd} avaliações)
  </span>
)}
```

- [ ] **Step 3: Adicionar a linha de bairro/cidade**

Logo abaixo do `</div>` que fecha a linha de status (fechamento da `div` que contém "Aberto agora" + tempo + avaliação, imediatamente antes do `</div>` que fecha `min-w-0 flex-1` — linha 1754 original), adicione uma nova linha condicional dentro do mesmo `<div className="min-w-0 flex-1">`:

```tsx
{(restaurante.bairro || restaurante.cidade) && (
  <p className="mt-0.5 text-xs font-medium text-text-subtle sm:text-[13px]">
    📍 {[restaurante.bairro, restaurante.cidade].filter(Boolean).join(', ')}
  </p>
)}
```

- [ ] **Step 4: Renderizar o banner promocional**

Depois do `</div>` que fecha a "Barra única da loja" (linha 1776 original — o `<div className="relative z-10 px-4 lg:px-8">...</div>`), antes do bloco `{/* Search (colapsável) ... */}` (linha 1778 original):

```tsx
{restaurante.bannerPromocionalUrl && (
  <div className="mx-4 mt-3 lg:mx-8">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      src={restaurante.bannerPromocionalUrl}
      alt="Promoção"
      className="h-28 w-full rounded-md border border-border object-cover sm:h-36"
    />
  </div>
)}
```

- [ ] **Step 5: Verificar tipos e lint**

Run: `cd C:/projetos/cardapio && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "loja/\[slug\]" && npx eslint "app/loja/[slug]/page.tsx"`
Expected: nenhum erro novo.

- [ ] **Step 6: Commit**

```bash
git add "app/loja/[slug]/page.tsx"
git commit -m "feat(vitrine): mostra avaliação, bairro/cidade e banner promocional da loja"
```

---

### Task 9: Deploy e validação visual (Chrome)

Esta task NÃO é delegada a um subagente fresco — precisa da sessão autenticada do
Chrome (só existe em produção, não em localhost) e de julgamento visual em tempo real.
Executada pela sessão principal, depois que as Tasks 1-8 estiverem todas commitadas.

**Files:** nenhum (validação manual).

- [ ] **Step 1: Push pra main**

```bash
git push origin main
```

- [ ] **Step 2: Aguardar o deploy do Coolify concluir**

Sem endpoint de status exposto neste projeto — aguardar um tempo razoável (2-4 min) e então confirmar que o build novo está no ar (ex: checar se os campos novos aparecem em Ajustes > Loja).

- [ ] **Step 3: Validar Ajustes > Perfil da loja**

Via extensão do Chrome: abrir `https://app.menuzia.com.br/admin/ajustes` (loja de teste já logada), aba "Perfil da loja". Confirmar:
- Campos Rua/Número/Complemento/Bairro/Cidade/UF aparecem separados, com o layout em grid.
- Mapa aparece ao lado dos campos, com o pin (ou o fallback "Mapa indisponível" se a key não carregar — investigar se acontecer).
- Preencher um endereço de teste e confirmar que o pin se move sozinho (geocode automático).
- Arrastar o pin manualmente e confirmar visualmente que ele fica na nova posição.
- Preencher Avaliação (nota + quantidade) e Banner promocional (upload de imagem).
- Clicar Salvar, confirmar "Alterações salvas." e dar reload pra confirmar persistência (campos, pin e imagens continuam lá).

- [ ] **Step 4: Validar a vitrine pública**

Abrir `https://app.menuzia.com.br/loja/<slug-da-loja-de-teste>`. Confirmar:
- Linha "Aberto agora ⏱ 30–45 min" agora mostra também "⭐ 4,9 (912 avaliações)" (ou os valores reais salvos) com a estrela visível.
- Logo abaixo, nova linha "📍 Bairro, Cidade" com os valores salvos.
- Banner promocional aparece entre o cabeçalho da loja e a busca/categorias, com o radius de 3px do design system (não arredondado).
- Testar em mobile viewport (resize da janela do Chrome) pra confirmar responsividade do grid de campos e do banner.

- [ ] **Step 5: Regressão rápida do fix de bugs (Tasks anteriores da sessão)**

Abrir `https://app.menuzia.com.br/admin/pedidos`, deixar aberto, fazer um pedido de teste pela vitrine (loja aberta) e confirmar visualmente: o card aparece no Kanban SEM precisar de F5, e o som toca uma vez só, no momento certo.

- [ ] **Step 6: Reportar resultado**

Se tudo passar: reportar sucesso ao usuário com screenshots/descrição do que foi validado. Se algo falhar visualmente: **não improvisar fix "rápido"** — voltar pra systematic-debugging (Phase 1) no problema específico antes de mexer em qualquer código.
