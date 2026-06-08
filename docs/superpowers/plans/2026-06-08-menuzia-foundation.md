# Menuzia Foundation — Setup, Design System & Multi-tenant Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Menuzia project skeleton — Next.js + TypeScript + Tailwind configured with the "Menuzia" design tokens, Supabase wired up (DB, Auth, Storage, Realtime), a multi-tenant database schema with Row Level Security, a working sign-in flow scoped to a restaurant + role, and a base app-shell layout (sidebar + top bar) that later modules (Dashboard, Kanban, Logística, Cardápio admin, Cardápio do cliente) will be built inside of.

**Architecture:** Single Next.js (App Router) app serving both the admin panel (`/(admin)` route group, behind auth) and the public storefront (`/(loja)/[slug]` route group, per-tenant). Supabase Postgres holds all data with `restaurante_id` columns + Row Level Security policies enforcing tenant isolation; Supabase Auth issues sessions; a `usuarios` table maps `auth.users` to a `restaurante_id` + `papel` (role). Tailwind theme tokens mirror the color/radius/typography variables already used in the four HTML prototypes (`dashboard.html`, `kanban.html`, `cardapiro-admin.html`, `cliente.html`), so every screen we build later inherits the "Menuzia" identity automatically.

**Tech Stack:** Next.js 14+ (App Router, TypeScript), Tailwind CSS, Supabase (Postgres + Auth + Storage + Realtime), `@supabase/ssr`, Vitest + React Testing Library + jsdom for unit/component tests, Supabase CLI for local Postgres + migrations.

---

## Before you start

- This plan assumes an empty/near-empty repo at `C:\projetos\cardapio`. If `package.json` already exists, read it first and adapt Task 1 instead of overwriting.
- You'll need a Supabase project (cloud) and the Supabase CLI installed locally (`npx supabase --version` to check, `npm install -g supabase` if missing) to run migrations against a local Postgres instance during development.
- Keep the four prototype HTML files (`dashboard.html`, `kanban.html`, `cardapiro-admin.html`, `cliente.html`) — do not delete them. They remain the visual reference until each module is rebuilt for real inside the Next.js app.

---

### Task 1: Initialize the Next.js project with TypeScript, Tailwind, and Vitest

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.js`, `tailwind.config.ts`, `vitest.config.ts`, `vitest.setup.ts`
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`
- Test: `app/page.test.tsx`

- [ ] **Step 1: Scaffold the Next.js app**

Run:
```bash
npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*" --use-npm
```
When prompted to scaffold into a non-empty directory, confirm yes (the HTML prototypes and `CLAUDE.md` can coexist with the Next.js project files).

- [ ] **Step 2: Install testing dependencies**

Run:
```bash
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 3: Create the Vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

Create `vitest.setup.ts`:
```typescript
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 4: Add the test script to `package.json`**

In the `"scripts"` section of `package.json`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write a failing smoke test for the home page**

Create `app/page.test.tsx`:
```typescript
import { render, screen } from '@testing-library/react'
import Page from './page'

describe('Home page', () => {
  it('renders the Menuzia heading', () => {
    render(<Page />)
    expect(screen.getByRole('heading', { name: /menuzia/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- app/page.test.tsx`
Expected: FAIL — either the heading isn't found, or `Page` doesn't render an `h1` with "Menuzia" (the default `create-next-app` page won't match).

- [ ] **Step 7: Replace the default home page**

Replace the contents of `app/page.tsx`:
```tsx
export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page">
      <h1 className="text-2xl font-semibold text-text-main">Menuzia</h1>
    </main>
  )
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- app/page.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind and Vitest"
```

---

### Task 2: Configure the Tailwind theme with Menuzia design tokens

The four HTML prototypes define a consistent CSS custom-property palette (see `CLAUDE.md` section 3). Port those tokens into the Tailwind theme so every component built from here on uses `bg-page`, `text-price`, `bg-status-pending`, `rounded-menuzia`, etc., instead of hard-coded hex values.

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `app/globals.css`
- Test: `tailwind.config.test.ts`

- [ ] **Step 1: Write a failing test asserting the theme tokens exist**

Create `tailwind.config.test.ts`:
```typescript
import config from './tailwind.config'

describe('Menuzia Tailwind theme tokens', () => {
  const colors = (config.theme?.extend?.colors ?? {}) as Record<string, any>

  it('defines the core palette from the Menuzia prototypes', () => {
    expect(colors.page).toBe('#EDEEF1')
    expect(colors['text-main']).toBe('#1F2937')
    expect(colors['text-subtle']).toBe('#6B7280')
    expect(colors.primary).toEqual({ DEFAULT: '#06B6D4', dark: '#0891B2' })
    expect(colors['status-pending']).toBe('#F97316')
    expect(colors['status-preparing']).toBe('#3B82F6')
    expect(colors['status-ready']).toBe('#10B981')
    expect(colors.price).toEqual({ bg: '#DCFCE7', text: '#16A34A' })
    expect(colors.alert).toEqual({ bg: '#E0F2FE', text: '#0369A1' })
    expect(colors.danger).toBe('#EF4444')
    expect(colors.warn).toBe('#F59E0B')
  })

  it('defines the near-square Menuzia border radius', () => {
    expect(config.theme?.extend?.borderRadius?.menuzia).toBe('3px')
  })

  it('uses Inter as the sans font family', () => {
    const sans = config.theme?.extend?.fontFamily?.sans
    expect(sans?.[0]).toBe('Inter')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tailwind.config.test.ts`
Expected: FAIL — `colors.page` (and the rest) are `undefined` because the theme extension doesn't exist yet.

- [ ] **Step 3: Extend the Tailwind theme**

Replace the `theme` section of `tailwind.config.ts` (keep `content` as generated by `create-next-app`):
```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        main: '#FFFFFF',
        page: '#EDEEF1',
        border: '#E5E7EB',
        'text-main': '#1F2937',
        'text-subtle': '#6B7280',
        sidebar: {
          bg: '#111827',
          hover: '#1F2937',
          text: '#9CA3AF',
        },
        primary: {
          DEFAULT: '#06B6D4',
          dark: '#0891B2',
        },
        'status-pending': '#F97316',
        'status-preparing': '#3B82F6',
        'status-ready': '#10B981',
        price: {
          bg: '#DCFCE7',
          text: '#16A34A',
        },
        alert: {
          bg: '#E0F2FE',
          text: '#0369A1',
        },
        danger: '#EF4444',
        'danger-bg': '#FEE2E2',
        warn: '#F59E0B',
        'warn-bg': '#FEF3C7',
        purple: '#A855F7',
      },
      borderRadius: {
        menuzia: '3px',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tailwind.config.test.ts`
Expected: PASS

- [ ] **Step 5: Load the Inter font and apply base page colors in `app/globals.css`**

At the top of `app/globals.css`, above the `@tailwind` directives, add the Google Fonts import (matching the prototypes):
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
```

After the `@tailwind base; @tailwind components; @tailwind utilities;` block, add:
```css
body {
  @apply bg-page text-text-main font-sans;
  font-size: 14px;
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: extend Tailwind theme with Menuzia design tokens"
```

---

### Task 3: Build base UI primitives — Button and Badge

These two primitives encode the visual language described in `CLAUDE.md` (uppercase, weight-600, near-square radius, color variants matching status/price/alert tokens). Every later module reuses them instead of re-styling buttons/badges from scratch.

**Files:**
- Create: `components/ui/button.tsx`
- Create: `components/ui/badge.tsx`
- Test: `components/ui/button.test.tsx`
- Test: `components/ui/badge.test.tsx`

- [ ] **Step 1: Write the failing test for `Button`**

Create `components/ui/button.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { Button } from './button'

describe('Button', () => {
  it('renders its label', () => {
    render(<Button>Avançar etapa</Button>)
    expect(screen.getByRole('button', { name: 'Avançar etapa' })).toBeInTheDocument()
  })

  it('applies the primary variant classes by default', () => {
    render(<Button>Salvar</Button>)
    const btn = screen.getByRole('button', { name: 'Salvar' })
    expect(btn.className).toContain('bg-primary')
    expect(btn.className).toContain('rounded-menuzia')
  })

  it('applies the secondary variant classes when requested', () => {
    render(<Button variant="secondary">Cancelar</Button>)
    const btn = screen.getByRole('button', { name: 'Cancelar' })
    expect(btn.className).toContain('bg-border')
  })

  it('applies the success variant classes when requested', () => {
    render(<Button variant="success">Pronto</Button>)
    const btn = screen.getByRole('button', { name: 'Pronto' })
    expect(btn.className).toContain('bg-status-ready')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- components/ui/button.test.tsx`
Expected: FAIL with "Cannot find module './button'"

- [ ] **Step 3: Implement `Button`**

Create `components/ui/button.tsx`:
```tsx
import { ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'outline' | 'success' | 'dispatch' | 'ghost'

const variantClasses: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark',
  secondary: 'bg-border text-text-main hover:bg-gray-300',
  outline: 'bg-white text-text-main border border-border hover:border-primary hover:text-primary',
  success: 'bg-status-ready text-white hover:brightness-95',
  dispatch: 'bg-sidebar-bg text-white hover:bg-sidebar-hover',
  ghost: 'bg-transparent text-text-subtle hover:bg-page hover:text-text-main',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className = '', ...props }, ref) => {
    const classes = [
      'inline-flex items-center justify-center gap-1.5',
      'rounded-menuzia px-3 py-1.5',
      'text-[11px] font-semibold uppercase tracking-wide',
      'transition-colors duration-150',
      variantClasses[variant],
      className,
    ].join(' ')

    return <button ref={ref} className={classes} {...props} />
  }
)
Button.displayName = 'Button'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- components/ui/button.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing test for `Badge`**

Create `components/ui/badge.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { Badge } from './badge'

describe('Badge', () => {
  it('renders its label', () => {
    render(<Badge tone="ok">Disponível</Badge>)
    expect(screen.getByText('Disponível')).toBeInTheDocument()
  })

  it('applies price-tone classes', () => {
    render(<Badge tone="ok">Disponível</Badge>)
    const el = screen.getByText('Disponível')
    expect(el.className).toContain('bg-price-bg')
    expect(el.className).toContain('text-price-text')
  })

  it('applies danger-tone classes', () => {
    render(<Badge tone="danger">Esgotado</Badge>)
    const el = screen.getByText('Esgotado')
    expect(el.className).toContain('bg-danger-bg')
    expect(el.className).toContain('text-danger')
  })

  it('applies paused-tone classes', () => {
    render(<Badge tone="paused">Pausado</Badge>)
    const el = screen.getByText('Pausado')
    expect(el.className).toContain('text-purple')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- components/ui/badge.test.tsx`
Expected: FAIL with "Cannot find module './badge'"

- [ ] **Step 7: Implement `Badge`**

Create `components/ui/badge.tsx`:
```tsx
import { HTMLAttributes } from 'react'

type Tone = 'ok' | 'danger' | 'paused' | 'pending' | 'preparing' | 'ready' | 'alert'

const toneClasses: Record<Tone, string> = {
  ok: 'bg-price-bg text-price-text',
  danger: 'bg-danger-bg text-danger',
  paused: 'bg-purple/10 text-purple',
  pending: 'bg-status-pending/10 text-status-pending',
  preparing: 'bg-status-preparing/10 text-status-preparing',
  ready: 'bg-status-ready/10 text-status-ready',
  alert: 'bg-alert-bg text-alert-text',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone: Tone
}

export function Badge({ tone, className = '', ...props }: BadgeProps) {
  const classes = [
    'inline-block rounded-menuzia px-2 py-0.5',
    'text-[10px] font-bold uppercase tracking-wide',
    toneClasses[tone],
    className,
  ].join(' ')

  return <span className={classes} {...props} />
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- components/ui/badge.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add Button and Badge UI primitives with Menuzia variants"
```

---

### Task 4: Wire up Supabase clients (browser + server)

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `.env.local.example`
- Test: `lib/supabase/client.test.ts`

- [ ] **Step 1: Install the Supabase libraries**

Run:
```bash
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Document the required environment variables**

Create `.env.local.example`:
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Copy it to `.env.local` and fill in the real values from your Supabase project's API settings (never commit `.env.local`).

- [ ] **Step 3: Write the failing test for the browser client factory**

Create `lib/supabase/client.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(() => ({ mocked: true })),
}))

import { createBrowserClient } from '@supabase/ssr'
import { getBrowserSupabase } from './client'

describe('getBrowserSupabase', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  })

  it('creates a browser client with the public env vars', () => {
    getBrowserSupabase()
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key'
    )
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- lib/supabase/client.test.ts`
Expected: FAIL with "Cannot find module './client'"

- [ ] **Step 5: Implement the browser client factory**

Create `lib/supabase/client.ts`:
```typescript
import { createBrowserClient } from '@supabase/ssr'

export function getBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- lib/supabase/client.test.ts`
Expected: PASS

- [ ] **Step 7: Implement the server client factory (no test — depends on `next/headers`, exercised via integration in Task 6)**

Create `lib/supabase/server.ts`:
```typescript
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function getServerSupabase() {
  const cookieStore = cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options })
        },
      },
    }
  )
}
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Supabase browser and server client factories"
```

---

### Task 5: Multi-tenant database schema with Row Level Security

This migration creates the foundation tables every later module depends on: `restaurantes` (tenants), `usuarios` (maps `auth.users` → tenant + role), and RLS policies that scope all reads/writes to the caller's `restaurante_id`. Later plans (Cardápio, Kanban, Logística, Dashboard) will add their own migrations on top of this one and follow the same `restaurante_id` + RLS pattern.

**Files:**
- Create: `supabase/migrations/0001_init_multitenant.sql`
- Test: `supabase/migrations/0001_init_multitenant.test.ts`

- [ ] **Step 1: Initialize the local Supabase project (if not already done)**

Run: `npx supabase init`
Run: `npx supabase start`

This boots a local Postgres + Auth + Storage stack for development and testing. Note the local API URL and anon key it prints — use them in `.env.local` while developing locally.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0001_init_multitenant.sql`:
```sql
-- Restaurants (tenants)
create table restaurantes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  criado_em timestamptz not null default now()
);

-- App users: maps an auth.users row to a tenant + role
create type papel_usuario as enum ('dono', 'atendente', 'cozinha', 'logistica', 'entregador');

create table usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  restaurante_id uuid not null references restaurantes (id) on delete cascade,
  papel papel_usuario not null,
  nome text not null,
  criado_em timestamptz not null default now()
);

create index usuarios_restaurante_id_idx on usuarios (restaurante_id);

-- Helper: current user's tenant id, used by every RLS policy in this and future migrations
create or replace function auth_restaurante_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select restaurante_id from usuarios where id = auth.uid()
$$;

alter table restaurantes enable row level security;
alter table usuarios enable row level security;

-- A user can read only their own tenant row
create policy "Tenant members can read their restaurant"
  on restaurantes for select
  using (id = auth_restaurante_id());

-- A user can read only co-workers within the same tenant
create policy "Tenant members can read co-workers"
  on usuarios for select
  using (restaurante_id = auth_restaurante_id());

-- A user can update only their own profile row
create policy "Users can update their own profile"
  on usuarios for update
  using (id = auth.uid());
```

- [ ] **Step 3: Write a verification test that runs the migration and checks the resulting schema**

This test talks to the local Supabase Postgres instance started in Step 1, so it needs a connection string. Add to `.env.local`:
```
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Install the Postgres client for tests:
```bash
npm install -D pg @types/pg
```

Create `supabase/migrations/0001_init_multitenant.test.ts`:
```typescript
import { Client } from 'pg'

describe('0001_init_multitenant migration', () => {
  let client: Client

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await client.connect()
  })

  afterAll(async () => {
    await client.end()
  })

  it('creates the restaurantes and usuarios tables', async () => {
    const { rows } = await client.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name in ('restaurantes', 'usuarios')`
    )
    const names = rows.map((r) => r.table_name).sort()
    expect(names).toEqual(['restaurantes', 'usuarios'])
  })

  it('enables row level security on both tables', async () => {
    const { rows } = await client.query(
      `select relname, relrowsecurity from pg_class
       where relname in ('restaurantes', 'usuarios')`
    )
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true)
    }
  })

  it('creates the auth_restaurante_id helper function', async () => {
    const { rows } = await client.query(
      `select proname from pg_proc where proname = 'auth_restaurante_id'`
    )
    expect(rows).toHaveLength(1)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- supabase/migrations/0001_init_multitenant.test.ts`
Expected: FAIL — `restaurantes`/`usuarios` are not in `information_schema.tables` yet because the migration hasn't been applied to the local DB.

- [ ] **Step 5: Apply the migration to the local Supabase instance**

Run: `npx supabase db reset`

This drops and recreates the local database, applying every file in `supabase/migrations/` in order — including the new `0001_init_multitenant.sql`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- supabase/migrations/0001_init_multitenant.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add multi-tenant schema (restaurantes, usuarios) with RLS"
```

---

### Task 6: Sign-in flow scoped to tenant + role

**Files:**
- Create: `lib/auth/session.ts`
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/login/actions.ts`
- Test: `lib/auth/session.test.ts`

- [ ] **Step 1: Write the failing test for `getCurrentSession`**

Create `lib/auth/session.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { getCurrentSession } from './session'

function buildSupabaseStub(opts: {
  authUser: { id: string } | null
  usuarioRow: { restaurante_id: string; papel: string; nome: string } | null
}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.authUser }, error: null })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: opts.usuarioRow, error: null })),
        })),
      })),
    })),
  }
}

describe('getCurrentSession', () => {
  it('returns null when there is no authenticated user', async () => {
    const supabase = buildSupabaseStub({ authUser: null, usuarioRow: null })
    const session = await getCurrentSession(supabase as any)
    expect(session).toBeNull()
  })

  it('returns the tenant id, role and name for an authenticated user', async () => {
    const supabase = buildSupabaseStub({
      authUser: { id: 'user-1' },
      usuarioRow: { restaurante_id: 'tenant-1', papel: 'dono', nome: 'Carlos Silva' },
    })
    const session = await getCurrentSession(supabase as any)
    expect(session).toEqual({
      userId: 'user-1',
      restauranteId: 'tenant-1',
      papel: 'dono',
      nome: 'Carlos Silva',
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/auth/session.test.ts`
Expected: FAIL with "Cannot find module './session'"

- [ ] **Step 3: Implement `getCurrentSession`**

Create `lib/auth/session.ts`:
```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AppSession {
  userId: string
  restauranteId: string
  papel: string
  nome: string
}

export async function getCurrentSession(
  supabase: SupabaseClient
): Promise<AppSession | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('restaurante_id, papel, nome')
    .eq('id', user.id)
    .single()

  if (!usuario) return null

  return {
    userId: user.id,
    restauranteId: usuario.restaurante_id,
    papel: usuario.papel,
    nome: usuario.nome,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/auth/session.test.ts`
Expected: PASS

- [ ] **Step 5: Implement the sign-in server action**

Create `app/(auth)/login/actions.ts`:
```typescript
'use server'

import { redirect } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase/server'

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const supabase = getServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  redirect('/dashboard')
}
```

- [ ] **Step 6: Build the login page using the Menuzia UI primitives**

Create `app/(auth)/login/page.tsx`:
```tsx
import { Button } from '@/components/ui/button'
import { signIn } from './actions'

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page">
      <form
        action={signIn}
        className="w-full max-w-sm rounded-menuzia border border-border bg-main p-6 shadow-sm"
      >
        <h1 className="mb-1 text-lg font-semibold text-text-main">menuzia</h1>
        <p className="mb-5 text-xs text-text-subtle">Entre com sua conta da loja</p>

        {searchParams.error && (
          <p className="mb-4 rounded-menuzia bg-danger-bg px-3 py-2 text-xs text-danger">
            {searchParams.error}
          </p>
        )}

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            E-mail
          </span>
          <input
            name="email"
            type="email"
            required
            className="w-full rounded-menuzia border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="mb-5 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            Senha
          </span>
          <input
            name="password"
            type="password"
            required
            className="w-full rounded-menuzia border border-border px-3 py-2 text-sm"
          />
        </label>

        <Button type="submit" className="w-full">
          Entrar
        </Button>
      </form>
    </main>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add tenant-scoped sign-in flow"
```

---

### Task 7: App-shell layout — Sidebar + TopBar

This is the structural shell every admin module (Dashboard, Pedidos, Logística, Cardápio, Ajustes) renders inside of, matching the sidebar/top-bar pattern shared by `dashboard.html`, `kanban.html`, and `cardapiro-admin.html`.

**Files:**
- Create: `components/layout/sidebar.tsx`
- Create: `components/layout/topbar.tsx`
- Create: `app/(admin)/layout.tsx`
- Test: `components/layout/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test for `Sidebar`**

Create `components/layout/sidebar.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { Sidebar } from './sidebar'

const ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pedidos', label: 'Painel de Pedidos' },
  { href: '/logistica', label: 'Logística' },
  { href: '/cardapio', label: 'Cardápio' },
]

describe('Sidebar', () => {
  it('renders every navigation item label', () => {
    render(<Sidebar items={ITEMS} activeHref="/dashboard" />)
    for (const item of ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument()
    }
  })

  it('marks the active item with the active styling', () => {
    render(<Sidebar items={ITEMS} activeHref="/pedidos" />)
    const active = screen.getByText('Painel de Pedidos').closest('a')
    expect(active?.className).toContain('text-primary')
  })

  it('renders the lowercase brand name', () => {
    render(<Sidebar items={ITEMS} activeHref="/dashboard" />)
    expect(screen.getByText('menuzia')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- components/layout/sidebar.test.tsx`
Expected: FAIL with "Cannot find module './sidebar'"

- [ ] **Step 3: Implement `Sidebar`**

Create `components/layout/sidebar.tsx`:
```tsx
import Link from 'next/link'

export interface SidebarItem {
  href: string
  label: string
}

export interface SidebarProps {
  items: SidebarItem[]
  activeHref: string
}

export function Sidebar({ items, activeHref }: SidebarProps) {
  return (
    <aside className="flex h-screen w-[240px] flex-shrink-0 flex-col bg-sidebar-bg shadow-lg">
      <div className="flex h-[60px] items-center bg-primary px-4 text-white">
        <span className="text-lg font-bold lowercase tracking-wide">menuzia</span>
      </div>
      <nav className="flex flex-col gap-0.5 overflow-y-auto py-2.5">
        {items.map((item) => {
          const isActive = item.href === activeHref
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'flex flex-col items-center gap-1.5 border-l-[3px] px-1.5 py-3.5 text-center text-[12px] font-medium transition-colors',
                isActive
                  ? 'border-primary bg-sidebar-hover font-semibold text-primary'
                  : 'border-transparent text-sidebar-text hover:bg-sidebar-hover hover:text-white',
              ].join(' ')}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- components/layout/sidebar.test.tsx`
Expected: PASS

- [ ] **Step 5: Implement `TopBar` (no isolated test — covered by the admin layout integration in Step 7)**

Create `components/layout/topbar.tsx`:
```tsx
export interface TopBarProps {
  title: string
  breadcrumb: string
}

export function TopBar({ title, breadcrumb }: TopBarProps) {
  return (
    <header className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-border bg-main px-5">
      <div>
        <div className="text-[16px] font-semibold text-text-main">{title}</div>
        <div className="mt-0.5 text-xs text-text-subtle">{breadcrumb}</div>
      </div>
    </header>
  )
}
```

- [ ] **Step 6: Write the failing test for the admin layout**

Create `app/(admin)/layout.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import AdminLayout from './layout'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))

describe('AdminLayout', () => {
  it('renders the sidebar navigation alongside the page content', () => {
    render(
      <AdminLayout>
        <p>Conteúdo da página</p>
      </AdminLayout>
    )
    expect(screen.getByText('menuzia')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Painel de Pedidos')).toBeInTheDocument()
    expect(screen.getByText('Conteúdo da página')).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test -- app/\(admin\)/layout.test.tsx`
Expected: FAIL with "Cannot find module './layout'"

- [ ] **Step 8: Implement the admin layout**

Create `app/(admin)/layout.tsx`:
```tsx
'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pedidos', label: 'Painel de Pedidos' },
  { href: '/logistica', label: 'Logística' },
  { href: '/cardapio', label: 'Cardápio' },
  { href: '/ajustes', label: 'Ajustes' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar items={NAV_ITEMS} activeHref={pathname} />
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test -- app/\(admin\)/layout.test.tsx`
Expected: PASS

- [ ] **Step 10: Run the full test suite**

Run: `npm test`
Expected: All tests PASS (page, tailwind tokens, button, badge, supabase client, migration, session, sidebar, admin layout).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add admin app-shell layout with Sidebar and TopBar"
```

---

## What comes after this plan

With this foundation in place (project skeleton, Menuzia design tokens in Tailwind, base UI primitives, Supabase wiring, multi-tenant schema + RLS, tenant-scoped login, and the admin app shell), the next plans — one per module, each its own document under `docs/superpowers/plans/` — are:

1. **Cardápio admin** — schema for `categorias`, `itens`, `complementos`, `grupos_de_complementos`, `promocoes`, `disponibilidade_semanal`; image upload via Supabase Storage; the table/grid views and edit drawer described in `CLAUDE.md` §4.4.
2. **Cardápio do cliente (redesign)** — public storefront at `/(loja)/[slug]`, rebuilt with the frontend-design skill per `CLAUDE.md` §5/§6 (premium look, bottom nav Home/Promoções/Carrinho, promo price styling), reading from the same `itens`/`promocoes` tables.
3. **Painel de Pedidos (Kanban)** — `pedidos`/`itens_do_pedido` schema, Supabase Realtime subscription so new orders appear instantly, drag-and-drop status flow (recebido → preparando → pronto → [entregue | enviado p/ logística]).
4. **Logística** — `entregadores`, `entregas`, `fechamentos_de_caixa` schema; assignment UI; cash/troco reconciliation per `CLAUDE.md` §4.3.
5. **Dashboard** — aggregation queries/views over real `pedidos` data feeding the charts already prototyped in `dashboard.html`.

Each of those plans should be written only after the previous module is working end-to-end, so later plans can rely on real (not assumed) schema and components.
