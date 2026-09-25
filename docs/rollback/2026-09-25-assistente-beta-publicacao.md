# Rollback — publicação do Assistente Beta 0.2.0-beta.1 (2026-09-25)

Publicado: merge `59ddff4` na `main` (antes: `5c2a0a6`), migração `0100` aplicada em
produção às 17:42:51Z, pré-release `printer-agent-v0.2.0-beta.1` no GitHub. Beta desligado
em todas as lojas; o Assistente de Impressão 0.1.23 não mudou.

Use o passo mais leve que resolve. Em quase todo problema operacional, o passo 1 basta.

## 1. Voltar uma loja do piloto para o Assistente atual (segundos, sem deploy)

- **Pelo painel da loja** (dono/gerente), menu Impressão › "O que o Assistente Beta
  imprime" › **Somente teste**. A cozinha volta na hora para o 0.1.23; nenhum pedido se
  perde (o que o Beta reservou e não imprimiu volta para a fila do antigo em até 90 s).
- **Pela plataforma** (superadmin), coluna "Impressão Beta" › **Retirar**: volta a loja para
  "Somente teste" e tira a liberação.
- Não é preciso desinstalar nem reinstalar nada no computador da loja.

## 2. Tirar o Beta do computador da loja

Windows › Aplicativos › "Assistente Menuzia Beta 0.2.0-beta.1" › Desinstalar. Fecha só o
Beta e remove pasta, dados, atalho e início automático dele. O 0.1.23 fica como está
(testado neste computador: instalação, configuração, processos e log idênticos).
No painel, "Desconectar" o computador revoga a credencial dele.

## 3. Retirar o instalador

```
gh release delete printer-agent-v0.2.0-beta.1 --yes --cleanup-tag
```

A página Impressão só mostra o download do Beta para loja liberada; sem loja liberada o
link não aparece para ninguém. A release "latest" continua sendo a do 0.1.23.

## 4. Código (volta ao `5c2a0a6`)

Antes: passo 1 em todas as lojas liberadas (nenhuma em "Somente Caixa"/"Cozinha e Caixa").

```
git checkout main && git pull --ff-only
git revert -m 1 59ddff4        # desfaz o merge inteiro, sem reescrever histórico
git push origin main           # sem force
```

Depois, Redeploy no Coolify. O código anterior ignora as colunas novas da 0100 (são só
adições), então a migração pode ficar.

## 5. Migração 0100 (só depois do passo 4 em produção)

Só adiciona colunas e funções. Remover apenas se for realmente necessário:

```
docs/rollback/0100_impressao_beta_modos_e_calibracao.down.sql
```

Idempotente; antes de tirar as colunas, devolve para o roteamento antigo qualquer loja em
"Cozinha e Caixa". Não apaga pedido, trabalho de impressão nem auditoria. Depois, remover a
linha `0100_impressao_beta_modos_e_calibracao.sql` de `schema_migrations`.
Ensaiado: `ULTIMA_EM_PRODUCAO=0099 node scripts/seguranca/verificar-migrations.mjs`.
