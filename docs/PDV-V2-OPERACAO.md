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
node scripts/seguranca/verificar-isolamento-lojas.mjs   # 46/46
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

### 0081 — funções do servidor e escrita anônima

Varredura sistemática depois da 0080 (tabelas sem RLS, policies sem filtro de loja,
views, funções SECURITY DEFINER executáveis de fora):

- nenhuma tabela sem RLS; nenhuma view; as únicas leituras abertas entre lojas são o
  catálogo público da vitrine (itens, grupos, complementos, pizza, taxas de entrega) —
  intencional;
- `restaurante_id_por_agente_token` (oráculo de token) e
  `campanha_incrementar_enviados/erros` eram executáveis por `anon`/`authenticated`;
  a 0081 deixa só `service_role`;
- `anon` tinha INSERT/UPDATE/DELETE/TRUNCATE de tabela em ~38 tabelas (a RLS barrava);
  a 0081 revoga — nada no produto escreve com a chave anônima.

Sem ordem de deploy. Rollback: `docs/rollback/0081_seg_funcoes_definer_e_escrita_anon.down.sql`.

Achado **fora do escopo** (mesma loja, não entre lojas), registrado para depois: as
policies "Tenant members manage …" (cardápio, cupons, campanhas, entregadores,
fidelidade, impressoras) valem para qualquer papel da loja, inclusive garçom.

Verificação local: `verificar-isolamento-lojas.mjs` 46/46 (5 checagens novas da 0081).

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

---

## 3. PDV v2 — o que entra nesta RC

Balcão como comanda avulsa e mesa sobre o mesmo motor de conta. Tudo atrás da flag
`restaurantes.pdv_v2` (default `false`). Nenhuma loja real é ligada por migration.

| Peça | Onde |
|---|---|
| Modelo (comanda de balcão, senha, flag) | `0082_pdv_comanda_balcao.sql` |
| Estados separados, transição segura, número sob trava, lançamento só em conta aberta, tabela de reserva de impressão | `0083_pdv_pedidos_estados.sql` |
| Pagamento com canal/origem (backfill aditivo) | `0084_pdv_pagamentos_canal.sql` |
| Funções do motor (abrir, lançar, pagar, atender, transicionar, pendências, fechar, resolver, reabrir, cancelar) | `0085_pdv_rpcs_conta_presencial.sql` |
| Realtime de comandas/pagamentos + reserva atômica da fila de impressão | `0086_pdv_realtime_e_reserva_impressao.sql` |
| Serviço único (PDV e salão) | `lib/servicos/conta-presencial.ts` |
| Rotas novas | `/api/admin/balcao/comandas`, `/api/admin/comandas/[id]`, `/api/admin/pdv/lancamento` |
| Tela | `components/pdv/central-balcao.tsx`, `components/pdv/conta-presencial.tsx`, `app/admin/pdv/page.tsx` |
| Assistente de Impressão 0.1.24 (NÃO publicado) | `printer-agent/` — senha só no balcão + `X-Agente-Instancia` |

### O que muda para quem NÃO liga a flag (vale no deploy)

- Rotas antigas do PDV: permissão no handler, corpo em lista fechada, telemetria.
- "Receber" do PDV antigo registra pagamento real (forma escolhida, valor restante).
- "Fechar" do PDV antigo exige saldo zero e grava autor/total.
- "Cancelar" do PDV antigo exige motivo; atendente só cancela direto pedido recebido de
  conta sem pagamento.
- Cancelar pelo Kanban um pedido que tem conta segue a mesma regra.
- Kanban avança status com compare-and-set (aba velha não sobrescreve). Visual igual.
- Banco: cancelado/entregue não voltam; presencial não vai para em_rota; cancelar
  zera reimpressão; "Entregue" presencial registra o atendimento.
- Fila de impressão: reserva por Assistente, inclui "pronto" não impresso, nunca
  cancelado nem pedido sem item. Com impressão automática desligada nada é reservado.

## 4. Deploy (quando autorizado)

Ordem obrigatória:

1. **Etapa 0**: código (commits `c8c3a5f`, `529ff13`) → conferir → migration 0080 →
   conferir (seção 1). 0081 a qualquer momento depois.
2. **Migrations 0082–0086** (aditivas; código antigo funciona com elas — o fechamento
   só muda com a flag). Aplicar em transação, uma por arquivo, registrando em
   `schema_migrations`, com o mesmo procedimento usado na 0078/0079.
   - A 0083 cria `pedidos_numero_unq` só se não houver duplicados (checado em
     2026-09-23: 0 em 620). Se houver, avisa e segue sem o índice.
3. **Deploy do código** da branch `rc/pdv-v2` (merge em `main`, Redeploy no Coolify).
4. Verificação em produção (sem ligar flag):
   - Kanban: aceitar, pronto, entregue, cancelar um pedido de teste;
   - PDV antigo: lançar numa mesa de teste, receber (forma), fechar;
   - Assistente imprimindo (pedido de teste);
   - `select count(*) from impressao_reservas;` cresce e esvazia conforme imprime.

**Se o deploy do código vier antes das migrations** (não recomendado): as rotas novas
e a fila de impressão chamam funções que não existem → erro. Sempre migrations antes.

## 5. Rollout da flag (loja por loja)

```sql
-- Ligar numa loja (só com autorização):
update restaurantes set pdv_v2 = true where slug = '<slug>';
-- Desligar (volta ao PDV antigo na hora, sem deploy):
update restaurantes set pdv_v2 = false where slug = '<slug>';
```

1ª semana: só a loja MENUZIA. 2ª semana: 1–2 lojas piloto com salão. Depois as demais.

**Atenção ao ligar numa loja com mesas:** o fechamento passa a bloquear conta com
pedido na cozinha ou pronto sem servir — também no salão (garçom). O botão "Entregue"
do Kanban e o "Servido/Entregue no balcão" do PDV registram o atendimento.

### Telemetria das rotas antigas (critério para desligá-las)

```sql
select r.slug, e.acao, e.dados->>'resultado' resultado, date_trunc('day', e.criado_em) dia, count(*)
  from eventos_auditoria e join restaurantes r on r.id = e.restaurante_id
 where e.acao like 'pdv_legado.%' and e.criado_em > now() - interval '14 days'
 group by 1,2,3,4 order by dia desc, 1;
```

Desligar as rotas antigas quando: 14 dias sem chamada em lojas com `pdv_v2 = true`,
todas as lojas ativas com a flag há ≥ 7 dias e nenhum incidente aberto. Depois,
rotas antigas passam a responder 410 para todos e saem na versão seguinte.

### Assistente de Impressão 0.1.24

Não publicado. Sem ele, o balcão imprime como hoje ("BALCAO (PDV)") sem a linha da
senha, e a reserva vale para todos os Assistentes da loja (sem duplicidade; o
reenvio do "impresso" de um Assistente que perdeu a rede espera a reserva de 90 s
expirar). Publicar pelo procedimento de sempre (release manual via `gh`) quando
autorizado; lojas atualizam instalando o setup novo.

## 6. Rollback

| Camada | Como |
|---|---|
| Fluxo do PDV numa loja | `pdv_v2 = false` (imediato) |
| Código | reverter o deploy; migrations são aditivas e o código anterior roda com elas |
| Trigger de transição (se bloquear algo não mapeado) | `drop trigger pedidos_transicao_valida on public.pedidos;` |
| Banco completo | `docs/rollback/0082_0086_pdv_v2.down.sql` (não apaga dado gravado) |
| Etapa 0 | seção 1 (0080) e `docs/rollback/0081_*.down.sql` |

## 7. Provas locais desta RC

```bash
node scripts/seguranca/verificar-pdv-v2-banco.mjs     # 93/93 — funções, concorrência real
node scripts/seguranca/verificar-conta-sql.mjs        # 74/74 — conta do salão (regressão)
node scripts/seguranca/verificar-isolamento-lojas.mjs # 46/46
node scripts/seguranca/verificar-rls-papeis.mjs       # 60/60
node scripts/seguranca/regressao-checkpoint-s.mjs     # 12/12
node scripts/seguranca/e2e-regressao-release.mjs      # 52/52 — delivery/PDV/vitrine
node scripts/seguranca/e2e-pdv-v2.mjs                 # 67/67 — navegador real
npx vitest run                                        # 1313 passam
```

Suítes antigas que falham por seletor desatualizado (a tela mudou em 19 e 21/09 no
`main`, antes desta branch, e os testes não foram atualizados): `e2e-caixa-e-regras`
(procura "Fiado", que saiu da tela), `e2e-release-mesas` (procura "Selecionar item",
que saiu do cartão), `e2e-garcom` (dois botões "Fechar"). Não são regressão do PDV v2.
