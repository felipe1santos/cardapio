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

---

## 8. Impressão com várias impressoras e pré-conta (RC local)

### O que existe agora

| Peça | Onde |
|---|---|
| B1: diagnóstico do Assistente não reserva pedidos | `0087_impressao_listagem_sem_reserva.sql`, `GET /api/agente/diagnostico` |
| Computador = agente com credencial própria (só hash no banco), código de pareamento de uso único (10 min) | `0088_impressao_agentes.sql`, `lib/impressao/credenciais.ts`, `POST /api/agente/parear` |
| Impressoras descobertas por computador; funções Cozinha e Caixa; roteamento da cozinha por função (opt-in) | `0089_impressao_dispositivos_e_funcoes.sql`, `POST /api/agente/impressoras` |
| Fila de trabalhos (pré-conta, teste), snapshot imutável montado no banco, reserva SKIP LOCKED, 5 tentativas, vencimento 10 min | `0090_impressao_trabalhos.sql`, `GET /api/agente/trabalhos`, `POST /api/agente/trabalhos/[id]/resultado` |
| Espera crescente entre tentativas (10/20/30/40 s) | `0091_impressao_espera_entre_tentativas.sql` |
| Observação do item na pré-conta | `0092_impressao_pre_conta_observacao.sql` |
| Ordem determinística da pré-conta: itens na ordem do lançamento (`pedido_itens.lancamento_seq`, só itens novos; antigos desempatam por id), adicionais na ordem do cadastro, pagamentos um a um pela hora de recebimento | `0093_impressao_pre_conta_ordem.sql`, `scripts/seguranca/verificar-pre-conta-ordem.mjs` |
| Tela Impressão (dono e gerente) | `/admin/impressao`, `components/impressao/painel-impressao.tsx`, `/api/admin/impressao/*` |
| Botão pré-conta no PDV (mesa e balcão) | `components/pdv/conta-presencial.tsx` (`PreContaBloco`), `/api/admin/comandas/[id]/pre-conta` |
| Formatador próprio da pré-conta; filas por impressora | `printer-agent/src/pre-conta.js`, `printer-agent/src/fila-dispositivos.js` |
| Permissões | `impressao.configurar` (dono, gerente), `comanda.pre_conta` (dono, gerente, atendente), `comanda.taxa` (dono, gerente) |

A ficha da cozinha continua na fila de sempre (`pedidos.impresso` + reservas). O
`recibo.js` não mudou: golden de texto (`printer-agent/test/golden-recibo.json`) e
render virtual comparado com o baseline — texto idêntico em 40 renderizações, até
4 pixels de diferença (o mesmo ruído do GDI entre duas renderizações iguais).

### O que o sistema sabe (e o que não sabe) sobre o papel

"Aceito pela fila do Windows" (`enviado_spooler`) quer dizer que o Windows recebeu o
trabalho. A impressora térmica comum **não informa** falta de papel, tampa aberta ou
offline: nesses casos o trabalho fica na fila do Windows e sai quando a impressora
volta. O sistema detecta só impressora **ausente** do Windows (erro "não encontrada").
Por isso a tela nunca diz "impresso".

### Versões do Assistente

| Versão | Situação |
|---|---|
| 0.1.23 | publicada (GitHub Release), link atual em Ajustes |
| 0.1.24 | **nunca publicar** — já existe um binário antigo com esse número (15/07) |
| 0.1.25 | correção do B1 (compatível); não empacotada separadamente — vai dentro da 0.1.26 |
| 0.1.26 | pareamento por código, várias impressoras, pré-conta — **instalador local, não publicado** |

Instalador local: `printer-agent/dist/AssistenteImpressaoMenuzia-Setup-0.1.26.exe`
SHA-256 `82EBF4C9022F44E0E30212FC62A845B0D598AC79388E50B99309A213BAD7E140`.

### Ordem de deploy (quando autorizado)

1. PDV v2 (seções 1–5) primeiro: 0080 → código → 0081 → 0082–0086.
2. Migrations 0087–0093 (aditivas; a 0093 só acrescenta coluna nula com default de sequência, sem reescrever `pedido_itens`).
3. Código do servidor (inclui as rotas novas do agente).
4. **Só depois** publicar o Assistente 0.1.26 e trocar o link em Ajustes. Agente 0.1.26
   num servidor antigo: o diagnóstico cai na rota de sempre (compatível); pareamento e
   pré-conta simplesmente não existem ainda — a cozinha segue imprimindo.
5. Loja piloto: instalar 0.1.26 no computador piloto, parear, atribuir funções,
   imprimir teste. Roteamento da cozinha por função só depois de validar a pré-conta.

### Instalação no computador piloto (teste físico)

1. Anotar a versão atual do Assistente (canto do título) e o token em uso — não trocar o token.
2. Rodar `AssistenteImpressaoMenuzia-Setup-0.1.26.exe` (instala por cima; mantém a configuração).
3. Conferir que a cozinha continua saindo como antes (modo compatível, nada configurado ainda).
4. No painel › Impressão (gerente ou dono): "+ Parear computador"; no Assistente: cartão
   "Várias impressoras", digitar o código, nome do computador, "Parear com código".
5. No painel: conferir as impressoras do computador; apelidos (Cozinha 01 / Caixa 02),
   largura 58/80; "Imprimir teste" em cada uma **com alguém ao lado**.
6. Funções: Caixa → impressora do caixa. (Cozinha pode ficar no modo de sempre.)

### Roteiro físico (com alguém ao lado das impressoras, só dados de demonstração)

1. Identificar fisicamente a Impressora 01 e a 02; confirmar 58 ou 80 mm de cada.
2. Lançar um pedido de demonstração → ficha sai só na 01; nada na 02.
3. Abrir a conta no PDV → "Imprimir pré-conta" → sai só na 02; nada na 01.
4. Conferir no papel: acentos, quebra de linhas longas, valores, taxa, desconto, pago,
   restante, via, aviso "NÃO É DOCUMENTO FISCAL", corte, densidade e legibilidade.
5. Tirar o papel da 02 (ou desligá-la) → lançar pedido: a cozinha (01) continua.
6. Recolocar/ligar a 02 → o trabalho que ficou na fila do Windows sai.
7. Registrar o resultado; fotografar só papel de demonstração.

### Roteamento da cozinha por função (opcional)

Desligado por padrão. Ligar em Impressão › Funções só quando: impressora de Cozinha
num computador pareado e online, e nenhum Assistente antigo (token) consultou a fila
nos últimos 2 minutos. Ligado, **só** o computador da Cozinha consome a fila da ficha
(com reserva); todos os outros recebem lista vazia — nunca há duas filas imprimindo o
mesmo pedido. Desfazer: desmarcar, ou tirar a função Cozinha (desliga sozinho).

### Rollback

| Camada | Como |
|---|---|
| Computador piloto | reinstalar a 0.1.23 (GitHub Release `printer-agent-v0.1.23`); o token da loja continua valendo |
| Pré-conta numa loja | tirar a função Caixa (o botão avisa "sem impressora de Caixa") |
| Roteamento da cozinha | desmarcar em Impressão, ou tirar a função Cozinha |
| Computador comprometido | "Revogar" em Impressão (só ele para; os outros seguem) |
| Banco | `docs/rollback/0087_0091_impressao.down.sql` e `docs/rollback/0092_0093_pre_conta.down.sql` (não apagam dado) |

### Pendências

- Publicar 0.1.26 e trocar o link de download em Ajustes (código em `app/admin/ajustes/page.tsx`) — só com autorização.
- Garçom fora desta versão (decisão).
- Rotação dos 4 tokens antigos segue pendente (seção 2); o pareamento por código é o caminho para aposentar o token da loja.

---

## 9. Atendimento identificado, entrega manual, fechamento e mesa em limpeza (RC local)

Tudo vale só para loja com `pdv_v2` ligado. Loja sem a flag segue exatamente como antes
(mesa abre sem nome, fecha e volta livre).

| Peça | Onde |
|---|---|
| Nome obrigatório na mesa (tela, API e banco); telefone opcional normalizado (55+DDD+número) e vinculado ao cadastro `clientes` da loja; entrega manual no card preto; taxa de entrega da conta; `pedidos.lancado_via` | `0094_pdv_atendimento_identificado.sql` |
| Mesa EM LIMPEZA após fechar (bloqueia comanda, pedido, sessão do QR, chamado e transferência); liberar; reabrir devolve a mesa | `0095_pdv_mesa_em_limpeza.sql` |
| Fechar conta numa transação: decisões da cozinha (entregue/cancelar com motivo), pagamentos, cupom, fechamento; simulação; trava de fidelidade por conta | `0096_pdv_fechamento_completo.sql` |
| Rotas | `POST /api/admin/balcao/comandas` (+ `entrega`), `POST /api/admin/mesas/[id]/atendimento` (`abrir`/`liberar`), `POST /api/admin/comandas/[id]` (`identificar`, `simular_fechamento`, `fechar_completo`, `aplicar_cupom`, `remover_cupom`) |
| Telas | `components/pdv/central-balcao.tsx` (card preto), `components/pdv/atendimento.tsx` (abrir mesa, identificar, limpeza), `components/pdv/fechar-conta.tsx`, `app/mesa/[token]` (aviso de mesa em preparação) |
| Permissão `comanda.fechamento_resolver` (dono, gerente, atendente) | `lib/auth/permissoes.ts` — sem migration: é regra de rota, o banco já prende a decisão à comanda |
| Provas locais | `verificar-pdv-atendimento-banco.mjs`, `e2e-pdv-atendimento.mjs`, `verificar-pdv-v2-banco.mjs`, `e2e-pdv-v2.mjs` |

### Regras que mudam para a operação (com a flag)

- **Card preto:** nome sempre obrigatório. "Adicionar dados de entrega" transforma o
  atendimento em `PDV · ENTREGA MANUAL`: pedido `tipo = entrega`, mesma cozinha, depois
  logística. Telefone é SEMPRE opcional no card preto, inclusive na entrega: sem ele,
  nome e endereço ficam como snapshot do atendimento, sem cadastro, sem fidelidade e sem
  cupom (a tela explica isso). Taxa vazia = tabela de frete da loja; digitada = manual
  (auditada). Pré-conta não se aplica a entrega.
- **Mesa:** só abre com nome. Dois operadores ao mesmo tempo: um abre, o outro cai na
  conta dele. Conta antiga sem nome continua legível e pede o nome antes do próximo
  lançamento ou do fechamento (nenhum nome é inventado).
- **Fechar conta:** cada pedido na cozinha precisa de decisão ("Marcar como entregue"
  ou "Cancelar" com motivo). Quem decide: gerente/dono (`comanda.resolver_forcado`) ou o
  atendente/caixa pela permissão `comanda.fechamento_resolver`, que só vale DENTRO do
  "Fechar conta" da comanda aberta (pedidos de outra comanda são recusados). O atendente
  não reabre conta nem estorna: se um cancelamento deixar o pago acima do novo total,
  nada é aplicado até gerente/dono estornar. Auditoria: um evento por decisão (banco) e
  `conta.fechamento_decisoes` com operador, permissão, pedidos, itens, estado anterior,
  decisão, motivo e totais antes/depois.
- **Limpeza:** fechada, a mesa fica laranja, badge EM LIMPEZA, com último cliente, horário
  e responsável pelo fechamento e o botão "Tornar mesa disponível" (`mesas.operar` ou
  `balcao.abrir`). O QR (mesmo token) mostra "Esta mesa está em limpeza e ficará
  disponível em breve." Liberar nunca desbloqueia nem reativa mesa.
- **Cliente/fidelidade/cupom:** com telefone, conta entra no histórico do cliente;
  fidelidade conta uma vez por conta, no fechamento; cupom (mesmas regras do delivery,
  exige telefone) tem o uso contado no fechamento, uma vez. Item grátis só na vitrine.
  Sem telefone: nada disso, e nunca vínculo por nome.
- **Cores das mesas:** verde livre, azul ocupada (azul claro = aberta sem lançamento),
  laranja em limpeza, escuro bloqueada, cinza inativa.

### Ordem de deploy (quando autorizado)

Depois das migrations 0080–0093: **0094 → 0095 → 0096** (aditivas; colunas novas com
default constante, sem reescrever tabela). Depois o código. Código antes das
migrations quebra: o Kanban lê `pedidos.lancado_via` e `comandas.senha`, e as rotas
chamam funções novas.

### Rollback

`docs/rollback/0094_0096_atendimento.down.sql` (não apaga dado). Preferível: desligar
`pdv_v2` na loja.

### Pendências conhecidas

- "Entrega grátis acima de X" da loja não se aplica à entrega manual: a taxa é decidida
  na abertura (tabela ou manual) — o operador ajusta digitando a taxa.
- Dashboard ainda não separa faturamento por canal (`pedidos.origem/canal` já gravados).
- Entrega manual paga na entrega: o entregador vê o pedido na logística como hoje; o
  pagamento é registrado na conta (pelo caixa) ao voltar.
