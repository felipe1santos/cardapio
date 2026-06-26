# Onde paramos — Cozinha + PDV (retomar aqui)

_Atualizado: 2026-06-25._

## Estado atual (tudo na `main`, último commit `1c81200`)

### ✅ Pronto e no ar
- **Estações de cozinha v1** — acesso restrito por token/QR, 3 modos (produção/expedição/completa),
  gate server-side, gestão em Ajustes › Cozinha.
  Spec: `docs/superpowers/specs/2026-06-25-acesso-estacoes-cozinha-design.md`
  Plano: `docs/superpowers/plans/2026-06-25-acesso-estacoes-cozinha.md`
- **Cozinha Produção v2** — nome do cozinheiro, claim atômico (pegar), 2 colunas
  (Disponíveis/Em preparo), cronômetro de urgência, modal de preparo (adicionais VERDE /
  restrições VERMELHO CAIXA-ALTA), Devolver/Concluir, "Preparado por" no admin, redesign das
  estações (link truncado, copiar, QR, cores por modo).
  Plano: `docs/superpowers/plans/2026-06-25-cozinha-producao-v2.md`

### ⚠️ AÇÃO PENDENTE DO FELIPE (fazer antes/junto do deploy v2)
Rodar no **SQL editor do Supabase** (senão TODA query de pedido quebra, inclusive portal do entregador):
```sql
alter table pedidos
  add column preparando_por text,
  add column preparado_por text;
```
> A migration `0028` (frete por raio) e `0029` (estações) + RLS das estações já foram aplicadas.
> A `0030` (acima) é a que falta confirmar no remoto.

Depois: deploy no Coolify (manual). **Ordem: SQL primeiro, deploy depois.**

## Minors adiados da v2 (não quebram nada — pegar quando der)
- Limite de caracteres (`maxLength`) no input de nome do cozinheiro (`NameOverlay` em `app/cozinha/[token]/page.tsx`).
- Notificação WhatsApp duplicada em casos de borda: `pegar`→`devolver`→`pegar` reenvia "preparando";
  `concluir` com 0 linhas (Kanban já moveu) ainda dispara "pronto". Estado final fica certo; só ping extra.
- `devolver` no front manda `cozinheiro` no body (rota ignora) — limpar.
- `qrData` de estação excluída fica órfão no state do Ajustes (inócuo).
- Kanban "Aceitar" não grava `preparando_por` (degrade esperado — card aparece sem nome na cozinha).

## PRÓXIMO SUB-PROJETO: PDV frente de caixa (sub-projeto 3 de 3)
Ainda **não iniciado**. É o maior. Brainstorm + spec + plano antes de codar.

Pontos já levantados:
- **Acesso**: conta compartilhada (caixa/admin/campanhas já funcionam com 1 conta, uso simultâneo).
  Só a cozinha tem acesso restrito (já feito). PDV usa o painel admin normal.
- **Tag de origem no card** (pedido do PDV): requisito do Felipe — ver memória `project_pdv_origem_tag.md`.
  Precisa coluna `origem` em `pedidos` (`'cardapio' | 'pdv' | 'manual'`) + renderizar tag no Kanban/cozinha/logística.
- Escopo a definir no brainstorm: lançar pedido no balcão (busca de itens, complementos, quantidade),
  forma de pagamento, **abrir/fechar caixa** (sangria, suprimento, conferência), impressão (já existe printer-agent),
  cliente avulso vs cadastrado, integração com o fluxo de pedidos existente (mesmo Kanban).

### Como retomar
1. Conferir que o deploy v2 subiu e a coluna 0030 está no remoto.
2. Testar a cozinha v2 em produção (checklist no plano v2, Task 7).
3. Iniciar PDV: `brainstorming` → decidir escopo do caixa (abertura/fechamento, sangria, formas de pgto,
   cliente avulso) → spec → plano → subagent-driven (mesmo fluxo das estações).

## Fluxo de trabalho (lembrete)
- Trabalhar direto na `main`; commit+push após validar; deploy é manual no Coolify (Felipe).
- Migrations novas: aplicar manual no SQL editor do Supabase (Claude não acessa o banco remoto).
- Execução de planos: subagent-driven-development (implementer + review por task + review final da branch).
