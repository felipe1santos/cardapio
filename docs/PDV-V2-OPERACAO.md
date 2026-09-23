# PDV v2 + Etapa 0 de segurança — operação

Documento de operação da release candidate `rc/pdv-v2`. Nada aqui foi aplicado em
produção. Cada passo que mexe em produção depende de autorização explícita do dono do
produto.

---

## 1. Etapa 0 — isolamento de `restaurantes` (migration 0080)

### O que corrige

Um usuário logado de uma loja lia **todas as colunas de todas as lojas** em
`restaurantes`, inclusive `impressao_agente_token`. Com o token, `/api/agente/pedidos`
entrega a fila de impressão da outra loja (nome, telefone e endereço de clientes).
Medido em produção em 2026-09-23 por leitura read-only: 7 lojas visíveis a partir de uma
conta comum, 4 com token legível.

A 0080 faz duas coisas:

1. **Linhas** — `authenticated` só lê a própria loja (`id = auth_restaurante_id()`).
   A leitura aberta da vitrine vale só para `anon` (que já está limitado às colunas
   públicas pela 0055).
2. **Coluna** — `impressao_agente_token` sai do navegador, até para o dono da própria
   loja. Leitura e geração passam pela rota de servidor `/api/admin/impressao/token`
   (só `ajustes.editar` = dono), que audita `impressao.gerou_token` sem o valor.

### Consequência para migrations futuras

Coluna nova em `restaurantes` **não fica visível para o painel sozinha**. Toda migration
que adicionar coluna lida/gravada pelo navegador precisa de:

```sql
grant select (coluna_nova) on public.restaurantes to authenticated;
grant update (coluna_nova) on public.restaurantes to authenticated; -- se o painel grava
```

`scripts/seguranca/verificar-isolamento-lojas.mjs` falha se alguma coluna ficar sem grant.

### Ordem de deploy (obrigatória)

1. **Código primeiro.** Deploy do código que não lê o token pelo navegador:
   - `app/api/admin/impressao/token/route.ts` (nova)
   - `lib/queries/impressao.ts` (token fora do select do navegador)
   - `app/admin/ajustes/page.tsx` (Ajustes › Impressão usa a rota)
   - `app/loja/[slug]/page.tsx` (vitrine lida no servidor com a chave anon)
2. Conferir no ar: Ajustes › Impressão mostra o token (dono) e a vitrine abre.
3. **Depois** aplicar `supabase/migrations/0080_seg_restaurantes_isolamento.sql`
   (idempotente; pode rodar de novo sem efeito).
4. Conferir de novo: Ajustes › Impressão, Kanban, vitrine de 2 lojas, Assistente de
   Impressão imprimindo (ele usa o token pela API do agente, não pelo navegador — não é
   afetado).

Código antigo + 0080 = `permission denied for column impressao_agente_token` em
Ajustes › Impressão. Por isso a ordem.

### Verificação local (já executada nesta RC)

```bash
node scripts/seguranca/verificar-isolamento-lojas.mjs   # 41/41
node scripts/seguranca/verificar-rls-papeis.mjs         # 60/60
node scripts/seguranca/verificar-checkpoint-s.mjs       # 15/15
node scripts/seguranca/regressao-checkpoint-s.mjs       # 12/12
```

O teste de isolamento foi validado nos dois sentidos: com o rollback aplicado ele
**falha** (detecta o vazamento); com a 0080 ele passa. Tokens de teste são UUIDs
aleatórios, nunca impressos, e zerados ao fim.

### Rollback da 0080

`docs/rollback/0080_seg_restaurantes_isolamento.down.sql`.

⚠ **Reabre o vazamento.** Só usar se a 0080 derrubar o painel e o código novo não
puder subir. Preferência sempre: corrigir para frente (grant da coluna que faltou).

Sintoma típico que **não** pede rollback: uma tela quebrando com
`permission denied for column X` — é coluna nova sem grant; resolver com
`grant select (X) on public.restaurantes to authenticated`.

---

## 2. Rotação dos tokens do Assistente de Impressão

> **Não executado.** Os 4 tokens expostos estão comprometidos e serão rodados depois,
> uma loja por vez, com alguém no PC de cada loja. Só com autorização específica.

**Pré-requisito:** a 0080 aplicada. Rodar antes dela não adianta: qualquer usuário
logado leria o token novo pelo mesmo buraco.

**Inventário** (não imprime o token):

```sql
select slug, nome,
       impressao_agente_token is not null as tem_token,
       impressao_agente_visto_em          as ultimo_heartbeat
  from restaurantes
 where impressao_agente_token is not null
 order by impressao_agente_visto_em desc nulls last;
```

**Uma loja por vez:**

1. Combinar horário fora do pico, com alguém no PC da loja.
2. Confirmar o Assistente rodando (Ajustes › Impressão mostra a impressora conectada).
3. Dono da loja (ou suporte logado como dono) gera token novo em Ajustes › Impressão.
   O token antigo morre na hora — a loja fica sem imprimir até o passo 4.
4. No PC da loja, colar o token novo no Assistente e parear.
5. Imprimir um pedido de teste (reimpressão serve).
6. Confirmar heartbeat:
   ```sql
   select slug, impressao_agente_visto_em from restaurantes where slug = '<slug>';
   ```
7. Conferir a auditoria: `impressao.gerou_token` registrado, sem valor.
8. Só então a próxima loja.

Loja que não atende ou Assistente fora do ar: **não rodar**. Sem ninguém no PC a loja
fica sem impressão.

**Rollback da rotação:** não existe voltar ao token antigo (ele está comprometido). Se
o pareamento falhar, gerar outro token e parear de novo; em último caso a loja imprime
pelo navegador (Kanban) até resolver.
