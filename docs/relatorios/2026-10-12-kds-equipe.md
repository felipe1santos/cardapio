# Relatório 12/10/2026 (noite) — KDS único + acesso por usuário + origem "Notificação do app"

Commits: `c8e1152` + `6736bbf` (origem push), `d76c39c` (KDS + acessos). Migrações aplicadas: **0191** (origem push) e
**0192** (modo de preparo). Próxima livre: **0193**. Rollbacks em `docs/rollback/0191_*` e `0192_*`.
Tudo do KDS e dos perfis novos só vale com "Novidades em teste" (hoje, só a Menuzia). Nenhum acesso de usuário de loja real mudou.

## Parte 3 — Cozinha antiga: NÃO removida (parada pela regra)
Lojas reais usaram estação nos últimos 30 dias (`estacoes.ultimo_visto_em`):
- **Ponto 400** — "cozinha 1 - pedro" (produção), última vez **01/10**; "complet" e "entrega" em julho.
- **Estância** — "Chapa" (completa), última vez **21/09**.
- Menuzia — "COZINHA" (10/10), "compelta" (01/10), "cozinha 2" (29/09).
Nada foi apagado (menu "Cozinha", /cozinha/<token>, estacoes, preparando_por continuam). Para remover depois: combinar
com Ponto 400 e Estância a troca pelo KDS (usuário "Cozinha" em vez do QR) e então apagar com migração + rollback.
Obs.: o KDS novo reaproveita `pedidos.preparando_por/preparado_por` (as mesmas colunas da Cozinha antiga).

## Parte 1 — Um KDS só (/admin/kds; menu "KDS")
- Três colunas: **Na fila** (aceitos no Painel, sem preparo começado) → **Em preparo** → **Prontos** (8 últimos, com
  **Voltar** para desfazer engano). Topo mostra quantos ainda esperam aceite no Painel.
- **Tocar na fila = Começar preparo**: abre o pedido em destaque com todos os itens, adicionais, observações e, por item, o
  **Modo de preparo** e os **ingredientes/passos** da ficha de preparo. Itens riscáveis. **Pronto** = "Pronto p/ despacho"
  no Kanban (e aviso de "pronto" ao cliente, como no Kanban). Despacho continua só no Kanban.
- **Modo de preparo**: campo novo (texto curto, até 500) na Ficha de preparo do item, no Cardápio. Fica na tabela privada
  `fichas_preparo` (a vitrine nunca lê); o KDS lê pelo servidor. Sem nada cadastrado, o bloco não aparece.
- Ações pelo servidor (`/api/admin/kds`): compare-and-set no status, quem mexeu antes vence (Kanban ou outro KDS); confere
  sessão, permissão e "Novidades em teste".
- Tempo real pelo mesmo canal do Kanban (eventos do banco) + rede de segurança lenta (sem polling agressivo).
- Filtro por setor (categoria do cardápio) **lembrado no aparelho**; cronômetro com cores ajustáveis, modo escuro, letra
  grande, tela cheia, botão **Sair** (da conta) discreto. Print: `docs/kds/4-kds-unico-fila-preparo-prontos.jpg`.

## Parte 2 — Acesso por usuário (Equipe)
- Já existia (Fase 6, `usuarios.acessos`): login e senha por usuário, telas marcáveis, cobradas no **menu** e no
  **servidor** (middleware: página → "Sem acesso", API → 403). Reaproveitado; nada duplicado.
- Novo: área **"KDS (tela da cozinha)"** (só aparece na Equipe com "Novidades em teste") e rota `/api/admin/kds` mapeada.
- Perfis prontos com "Novidades em teste": **Cozinha = só KDS** (ao entrar cai direto no KDS, em tela cheia, sem menu);
  **Caixa = Painel de Pedidos, PDV, Mesas**; **Garçom = Mesas e Comandas**; Dono/Gerente = tudo; Motoboy = só o app (como
  hoje). Sem a chave, os perfis de antes (lojas reais iguais). Cada usuário continua ajustável (marcar/desmarcar).
- KDS fora da trava automática por inatividade. Sessão: a do Supabase já é longa (o aparelho fica conectado até sair).
- Módulos pagos seguem bloqueados por loja (permissão não libera módulo).
- Pendente (não feito): perfis prontos **editáveis por loja** (hoje o perfil é o mesmo para todas; a loja ajusta usuário a
  usuário).

## Extra — origem "Notificação do app"
- Pedidos que vêm do link do push (`utm_source=push`) entram como **"Notificação do app"**, com ícone de sino próprio no
  card do Kanban e cor própria em "Vendas por origem". Todas as lojas. Pedidos antigos não mudam.

## Testes (Menuzia)
| Teste | Resultado |
|---|---|
| Acessos (`.medidas/e2e-acessos.mjs`, produção) | Caixa, Garçom e Cozinha de teste criados, cada um entrou com a própria senha (aleatória, nunca mostrada): **29/29 ok** — telas permitidas 200, proibidas → "Sem acesso"; APIs proibidas **403**; Cozinha ao entrar **cai no KDS**. Usuários **apagados** (restam 0) |
| Menu por perfil (`lib/menu-lateral.test.ts`) | Cozinha só KDS; Garçom só Mesas; Caixa Painel/PDV/Mesas |
| KDS ↔ Kanban (`.medidas/e2e-kds-kanban.mjs`, produção) | Pedidos **#304/#305**: novo não aparece no KDS; aceito → **Na fila**; Começar → **Em preparo** (por "Cozinha Teste"); 2º Começar → 409; **Pronto → Pronto p/ despacho** no Kanban; Voltar → Em preparo; inverso: **Pronto pelo Kanban** → sai do KDS e o KDS não consegue mais "começar" (409). Fechados **Não entregue**; usuário apagado |
| Automáticos | kds 9, acessos/cargos/menu/auth/queries/financeiro/componentes 857+; tsc e lint limpos |

Semgrep não rodou (Docker desligado, PC de 8 GB).

## Como o Felipe testa (Menuzia)
1. Equipe › Novo usuário › cargo **Cozinha** (vem só "KDS" marcado) › defina login e senha.
2. Num tablet/TV, entre com esse usuário: abre direto o **KDS**. Toque em tela cheia.
3. Faça um pedido de teste na vitrine e **aceite no Painel de Pedidos**: ele aparece em **Na fila**.
4. Toque nele (Começar preparo) → confira itens e o Modo de preparo (cadastre em Cardápio › item › Ficha de preparo) → **Pronto**.
5. No Painel, ele está em **Pronto p/ despacho**. Feche como "Não entregue".

## Só na Menuzia, esperando liberação
KDS (menu "KDS"), área "KDS" na Equipe e perfis Cozinha/Caixa novos. A origem "Notificação do app" já vale para todas.
