# Task 4 Report — Rota POST de ação (gate por modo + tenant)

## File Created
`app/api/cozinha/[token]/pedidos/[id]/acao/route.ts`

## TSC Output
`npx tsc --noEmit 2>&1 | grep -E "api/cozinha" || echo "OK"` → **OK** (no TypeScript errors in the api/cozinha path)

## Self-Review: Tenant Ownership Check

The tenant-ownership check is present and correct at lines 42–45 of the created file:

```typescript
const { data: pedido } = await admin.from('pedidos').select('id, restaurante_id, tipo, status').eq('id', id).maybeSingle()
if (!pedido || pedido.restaurante_id !== estacao.restauranteId) {
  return NextResponse.json({ error: 'Pedido não encontrado nesta loja' }, { status: 409 })
}
```

The admin client (bypasses RLS) fetches the pedido and compares `pedido.restaurante_id` against `estacao.restauranteId` (derived from the station's token). If the IDs do not match — e.g., a token from loja A is used against a pedido from loja B — the route returns 409 before any mutation occurs. This is the critical security gate.

Additional gates implemented:
- `acao` not in `['aceitar','pronto','entregue']` → 400
- `podeExecutar(estacao.modo, acao)` returns false → 403
- Token not found in DB → 404
- `pedido.restaurante_id !== estacao.restauranteId` or pedido not found → 409
- `acao === 'entregue' && pedido.tipo !== 'retirada'` → 409
- Unexpected throw → 500

## Commit Hash
`3288288` — `feat(cozinha): rota POST de ação com gate por modo + verificação de tenant`

---

## Fix wave (final review)

### Edits applied

**`app/api/cozinha/[token]/pedidos/[id]/acao/route.ts`**

1. **Finding 1 — current-status guard (CRITICAL)**
   Added `ORIGEM_ESPERADA` map (`aceitar→recebido`, `pronto→preparando`, `entregue→pronto`) and a guard before the mutation block that returns 409 if `pedido.status !== ORIGEM_ESPERADA[acao]`. Prevents stale/concurrent clicks from regressing order status.
   Also added `type StatusPedido` to the existing import from `@/lib/queries/pedidos`.

2. **Finding 2 — WhatsApp notification (IMPORTANT)**
   Imported `notificarPedido` from `@/lib/whatsapp`. After a successful non-`viaEntregue` transition, fire-and-forget call: `notificarPedido(admin, id, status).catch(() => {})` when `status === 'preparando' || status === 'pronto'`. Does not await; does not block or break the response on failure.

**`lib/queries/estacoes.ts`**

3. **Finding 3 — non-UUID token → 404 not 500 (MINOR)**
   Added module-level `UUID_RE` constant. At the top of `buscarEstacaoPorToken`, before the Supabase query, validates the token against `UUID_RE`; returns `null` immediately if invalid, so the calling route returns 404 instead of a Postgres invalid-uuid 500.

### Verification results

| Command | Result |
|---------|--------|
| `npx tsc --noEmit \| grep -E "api/cozinha\|estacoes"` | No matches (OK — no errors in target files) |
| `npx vitest run lib/cozinha/modo.test.ts` | 10 passed (1) |
| `npm run build` | ✓ Compiled successfully; ✓ Generating static pages (28/28) — only pre-existing warnings |

### Commit Hash
`c773ffc` — `fix(cozinha): guarda de status na ação + notificação WhatsApp + token não-UUID retorna 404`
