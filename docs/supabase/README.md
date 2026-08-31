# Migração do projeto Supabase Menuzia para outra conta

Documento operacional. Descreve **o que existe** no projeto Supabase do Menuzia e
**como recriá-lo** em outra conta, caso a transferência oficial não seja possível.

- **Projeto:** `nclnxmdvxmrzrkqystka` · PostgreSQL 17.6 · `aws-1-sa-east-1`
- **Organização atual:** `meu SaaS delivery` (`tsmbvmesdeuaclsxyxnd`, Free)
- **Organização de destino:** `MENUZIA` (`pnjbfjutkvjvgcsgcnfo`, Free) — conta `dayseebrandao1998@gmail.com`
- **Não envolvido:** `SAAS NR13` (`qqsesrntfvmdxqxrfvmw`) permanece na organização atual

> ⚠️ **Este repositório é público.** Nada aqui contém dados de clientes, hashes de
> senha ou chaves. O dump com dados fica **fora do repositório** — ver
> [Onde está o backup](#onde-está-o-backup).

---

## Leia isto antes de escolher o caminho

Existem dois caminhos, e eles **não** são equivalentes.

### Caminho A — Project Transfer (oficial)

Move o mesmo projeto para outra organização. Preserva **tudo**, inclusive o que o
caminho manual não consegue preservar:

- mesmo `project ref`, mesma URL, **mesmas chaves** — `.env.local` e as variáveis do
  Coolify continuam válidas, sem redeploy obrigatório;
- os 469 arquivos do Storage vão junto, sem download;
- usuários do Auth, hashes de senha e sessões seguem intactos;
- RLS, policies, functions, triggers, Realtime — tudo preservado.

**Pré-requisito:** quem executa precisa ser membro das duas organizações.

**Verificado em 2026-08-31:** a restrição de Fair Use (HTTP 402,
`exceed_cached_egress_quota`) **não bloqueia** a transferência. O diálogo abre, aceita
destino e o botão de confirmação fica habilitado.

### Caminho B — recriação manual em projeto novo

Só faz sentido se o Caminho A for impossível. Custos reais:

| Item | Consequência |
|---|---|
| `project ref` e URL | **Mudam.** É obrigatório atualizar `.env.local` e as variáveis do Coolify |
| `anon` / `service_role` | **Mudam.** Todo cliente e integração precisa da chave nova |
| JWT secret | **Muda.** Sessões ativas do painel são invalidadas (basta relogar) |
| Usuários do Auth | Migráveis via INSERT direto em `auth.users` com os hashes do backup — funciona, mas é delicado |
| **Arquivos do Storage** | **É aqui que trava — ver abaixo** |

### O bloqueio que o Caminho B não resolve

Recriar em projeto novo exige **baixar os 469 objetos (183 MB) do Storage** e subir no
projeto novo. Enquanto a organização estiver restrita, o Storage responde `402` e **o
download é impossível**.

Ou seja:

- se o 402 for resolvido → o Caminho A funciona, e é estritamente melhor;
- se o 402 **não** for resolvido → o Caminho B também não funciona.

**O caminho manual não contorna o bloqueio — ele depende mais dele.** A única variante
que "funciona" com o 402 ativo é criar o projeto novo deixando as `imagem_url` apontando
para o bucket do projeto antigo, o que significa manter o projeto antigo vivo para
sempre. Se ele for apagado, todas as imagens morrem.

---

## O que existe no projeto

### Banco — schema `public`

39 tabelas, **3.726 linhas**, todas com RLS habilitado.

| Tabela | Linhas | | Tabela | Linhas |
|---|---:|---|---|---:|
| `item_complementos` | 1.224 | | `presets_complementos` | 24 |
| `pedido_itens` | 669 | | `order_bumps` | 20 |
| `pedidos` | 388 | | `cliente_codigos` | 18 |
| `itens_cardapio` | 379 | | `fechamentos_caixa` | 13 |
| `clientes` | 225 | | `mesas` | 13 |
| `grupos_item_complementos` | 165 | | `restaurantes` | 11 |
| `preset_complemento_itens` | 142 | | `usuarios` | 11 |
| `taxas_entrega_bairro` | 88 | | `estacoes` | 10 |
| `tamanhos_item` | 80 | | `comandas` | 9 |
| `grupos_cardapio` | 56 | | `entregadores` | 9 |
| `schema_migrations` | 46 | | `campanhas` | 7 |
| `campanha_envios` | 38 | | `taxas_entrega_raio` | 7 |
| `fidelidade_progresso` | 33 | | demais (14 tabelas) | ≤ 6 cada |

Estrutura: **7 enums · 115 constraints · 45 índices · 7 funções · 4 triggers · 0 views ·
59 policies · 39 tabelas com RLS**.

DDL completa em [`schema-public.sql`](./schema-public.sql).

### Auth

| Tabela | Linhas |
|---|---:|
| `auth.users` | 12 (todos com senha) |
| `auth.identities` | 12 |
| `auth.mfa_amr_claims` | 67 |
| `auth.mfa_factors` | 0 |
| SSO / SAML | 0 |

### Storage

| Bucket | Público | Objetos | Bytes |
|---|---|---:|---:|
| `cardapio` | sim | 469 | ~183 MB |
| `agente-impressao` | sim | 0 | 0 |

4 policies no schema `storage`. Inventário completo (path, bytes, mime, cacheControl)
no backup fora do repositório.

### Edge Functions

**Nenhuma.** Verificado no dashboard em 2026-08-31 — a tela exibe "Deploy your first
edge function". Não existe `supabase/functions/` no repositório.

### Extensões

`pg_stat_statements` · `pgcrypto` · `plpgsql` · `supabase_vault` · `uuid-ossp`

### Configuração da aplicação (nomes, sem valores)

`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` ·
`DATABASE_URL` · `EVOLUTION_API_URL` · `EVOLUTION_API_KEY` ·
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` · `SUPERADMIN_EMAILS` · `SEED_*`

Integrações externas ao Supabase, que **não** são movidas por nenhum dos caminhos:
Evolution API (WhatsApp), Nexta Delivery (webhook registrado no suporte deles),
Coolify (deploy), printer-agent (URL fixa no código).

---

## Onde está o backup

Fora do repositório, em `C:\projetos\_backup-menuzia-2026-08-31\`:

| Arquivo | Conteúdo |
|---|---|
| `01-schema-public.sql` | DDL do `public` (cópia em `schema-public.sql` aqui) |
| `02-dados-public.sql` | Dados do `public` — **contém dados de clientes** |
| `03-dados-auth.sql` | Usuários do Auth — **contém hashes de senha** |
| `04-storage-metadados.sql` | Buckets + inventário dos objetos |
| `inventario.json` · `storage-objetos.json` | Contagens e catálogo |
| `MANIFESTO.md` | Como foi gerado, o que cobre e o que **não** cobre |

Conferido contra o banco vivo: 39/39 tabelas, 3.726 linhas exatas, 12/12 usuários com
hash bcrypt presente, zero credenciais de conexão nos arquivos.

**Nunca commitar esses arquivos.** O repositório é público.

---

## Runbook do Caminho A — Project Transfer

1. A conta de destino convida a conta de origem para a organização MENUZIA, como
   **Owner** (é o único papel cuja descrição inclui "transferring projects").
2. A conta de origem **aceita o convite** pelo link do e-mail.
3. Na conta de origem: *Project Settings → General → Transfer project*.
4. Selecionar a organização **MENUZIA** e confirmar.
5. Validar (ver checklist abaixo).
6. Só depois de validado, remover a conta de origem da organização MENUZIA.

Nada de `.env` muda. Nada precisa ser reimplantado.

---

## Runbook do Caminho B — recriação manual

**Só executar com autorização explícita.** Exige que o Storage esteja acessível.

1. **Pré-requisito:** resolver o 402. Sem isso, os passos 6 e 7 são impossíveis.
2. Criar projeto novo na organização MENUZIA, região `sa-east-1`, PostgreSQL 17.
3. Aplicar as migrations versionadas de `supabase/migrations/` (49 arquivos) — é a
   forma correta de recriar o schema, mais confiável que a DDL extraída.
   Usar `schema-public.sql` apenas para conferir o resultado.
4. Carregar `02-dados-public.sql`.
5. Carregar `03-dados-auth.sql` para preservar os logins com as senhas atuais.
6. Baixar os 469 objetos do bucket `cardapio` do projeto antigo.
7. Subir os objetos no bucket `cardapio` do projeto novo, mantendo **exatamente os
   mesmos paths** — assim as `imagem_url` do banco continuam resolvendo.
   Aplicar `cacheControl: 31536000` no upload.
8. Recriar as 4 policies do schema `storage`.
9. Atualizar `.env.local` e as variáveis do Coolify com a URL e as chaves novas.
10. Atualizar a URL do projeto no printer-agent, se aplicável.
11. Reconfigurar a webhook da Nexta com o suporte deles (a URL muda).
12. Validar (checklist abaixo).
13. **Não apagar o projeto antigo** até tudo estar validado por vários dias.

---

## Checklist de validação (vale para os dois caminhos)

- [ ] Projeto aparece na organização MENUZIA
- [ ] `SAAS NR13` permanece na organização antiga
- [ ] `project ref` e URL conferem com o que está no `.env`
- [ ] `GET /rest/v1/restaurantes?select=id&limit=1` → **200**
- [ ] Objeto público do Storage → **200** (e não 402)
- [ ] Login do painel administrativo funciona
- [ ] Vitrine pública carrega o cardápio
- [ ] Imagens dos produtos aparecem
- [ ] PDV abre e lista os itens
- [ ] Criar um pedido de teste funciona
- [ ] Upload de imagem novo funciona e sai em WebP com `max-age=31536000`
- [ ] Realtime entrega evento no Kanban
- [ ] Integrações (Evolution, Nexta) respondem
