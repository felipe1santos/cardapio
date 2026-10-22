# Auditoria de desempenho e estabilidade — 22/10/2026 (noite, modo autônomo)

Regras: só desempenho/estabilidade/eficiência; nada de lógica de negócio, texto, design ou layout. Testes só na Menuzia;
impressão/Assistente intocados. Medir antes e depois. Se o terminal fechar: ler este arquivo e continuar do "Próximo passo".

## Estado / próximo passo
- [x] P1 VPS: CPU, memória, disco, containers
- [x] P1 crons do Coolify (duração, sobreposição)
- [x] P1 login falhando na 1ª tentativa — causa achada (ver P1.3)
- [x] P1 IA/APIs pagas: sem loop (ver P1.4)
- [~] P2 banner promocional: permissões e gatilhos conferidos, não reproduzido (ver P2)
- [x] P3 banco: 0218 pronta (RLS 15× mais rápido) — **falta aplicar** (dono)
- [x] P3 polling/realtime do painel e carregamento da vitrine medidos
- Próximo (se continuar): P2 ponta a ponta logado na Menuzia (a sessão do Chrome está na Ponto 400 — não usar para gravar).

## O que o dono precisa fazer (bloqueado para o Claude por regra/permissão)
1. **Aplicar a 0218** (RLS initplan; ensaio feito: 0 diferenças em 16 usuários × 63 tabelas). A foto "antes" pode ser
   refeita na hora: `node <scratchpad>/foto-rls.mjs foto.json` e `ENSAIO=0 node .medidas/aplicar-0218.mjs foto.json`.
   Ou pedir ao Claude com permissão explícita para rodar.
2. **Fixar `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`** no Coolify (Build + Runtime): valor = 32 bytes aleatórios em base64
   (ex.: `openssl rand -base64 32`). Depois, um deploy. Acaba com o "login falha na 1ª tentativa" depois de deploy.
3. **Trocar o `CRON_SECRET`** no Coolify e deixar os 10 comandos com `$CRON_SECRET` (6 têm o valor escrito no comando
   e ele apareceu no terminal desta sessão).
4. **VPS:** tirar `discard` da montagem de `/` (`mount -o remount,nodiscard /` e remover `discard` do `/etc/fstab`).
   `fstrim.timer` semanal já faz o TRIM. Reversível.
5. Banner promocional: dizer a loja e o horário em que não salvou (ou mandar print do erro) — não reproduzi.

## P1 — custo e derrubada

### P1.1 VPS (06:10 UTC)
- 2 vCPU, 7,9 GB RAM, **sem swap**, disco 96 GB (26% usado). Dividida com Evolution, n8n, painel/worker de outro
  sistema e mais ~10 apps. App Menuzia: ~275 MB, 8% CPU.
- Carga 2,7–4,3 com **iowait 40–50%** e `/proc/pressure/io` some=60%, full=47% (avg60) — mas leitura/gravação ≈ 0.
  Causa: kworker em `ext4_discard_work` → `blkdev_issue_discard` travado há 43 min. A partição `/` está montada com
  **`discard`** (TRIM online): cada vez que o Coolify apaga imagens antigas depois de um deploy, o kernel manda TRIM
  síncrono pro disco virtual, que é lento. `fstrim.timer` (semanal) já está ativo, então o `discard` online é redundante.
- Recomendação (servidor, não código): remontar sem `discard` (`mount -o remount,nodiscard /` + tirar do `/etc/fstab`).
  Reversível. Ver decisão abaixo.

### P1.2 Crons do Coolify
10 tarefas; 7 rodam a cada minuto (campanhas, entregas, loja-horário, pix-online, push, whatsapp, canais), 2 por hora/15 min,
1 diária. Duração mediana 1–3 s, máx. 6 s (financeiro-vigia máx. 21 s a cada 15 min). **Sem sobreposição**, ~1 falha a
cada 60 execuções (rede). Nenhum loop.
- ⚠️ Segurança: 6 dos 10 comandos têm o valor do `x-cron-secret` escrito no comando (os outros 4 usam `$CRON_SECRET`).
  Apareceu no terminal desta sessão ao listar. **Dono: trocar o CRON_SECRET no Coolify** e deixar todos com `$CRON_SECRET`.

### P1.3 Login falhando na 1ª tentativa (21/10)
- 21/10 teve **18 deploys entre 19:39 e 00:49** (33 desde 20/10). Duas causas somadas:
  1. **Server Action do login muda a cada build** (Next 15: IDs de Server Action são recalculados por build). Quem estava
     com a tela de login aberta antes de um deploy manda o ID antigo → servidor responde `404 X-Nextjs-Action-Not-Found`
     → a 1ª tentativa falha; recarregou, funciona. Reproduzido: POST com ID inexistente → 404 "Server action not found".
  2. Build roda **na própria VPS** (nixpacks, ~6 min, 2 vCPU) — durante o build o app e o Evolution ficam lentos.
     Health check do app está **desligado** no Coolify (Next sobe em ~1,1 s, então a janela é curta).

### P1.4 APIs pagas (api_uso_dia / ia_uso_dia)
Ontem: IA 5 chamadas (US$ 0,0017), Maps JS 13, Geocoding 5, Uber 16 (testes). 7 dias: IA 166, Maps 80, Geocoding 39.
Nenhum loop, nenhum bloqueio por teto. Custo da IA na faixa de centavos por semana.

## P2 — salvamentos
- Banner promocional: grants de UPDATE de todas as 51 colunas que Ajustes grava em `restaurantes` estão OK (o bug da
  0204 não se repete); bucket `cardapio` sem limite de tamanho/tipo; gatilhos `config_so_gestao`/`protege_salao` só
  barram papel sem gestão e colunas de mesa. Não reproduzido. Hipóteses: (a) o salvar manda TODOS os campos num UPDATE —
  qualquer CHECK de outro campo (ex.: `instagram_url` fora do formato) derruba o banner junto, com mensagem genérica;
  (b) falha no envio da imagem (mensagem "Verifique se o bucket…"). Mostrar o motivo real do erro mudaria texto de tela —
  fica para decisão do dono.

## P3 — banco, polling, vitrine
### Banco (pg_stat_statements desde 22/05)
- Banco pequeno (1.533 pedidos) e folgado: tempo total de todas as consultas ≈ 6–7 min/dia.
- 57% desse tempo é o Realtime lendo o WAL (`list_changes`, 9,5 mi chamadas × 6 ms) — custo fixo do Supabase Realtime.
- `restaurantes` recebe **1,65 mi UPDATEs** (`impressao_agente_impressora_id`, batimento do Assistente) e
  `impressao_agentes` 495 mil — gera WAL que o Realtime precisa ler. É impressão: **não mexi** (regra). Sugestão para
  quando o dono liberar: só gravar quando o valor mudar.
- **Causa do painel lento nas consultas de pedidos (40–140 ms por chamada):** políticas RLS chamam
  `auth_restaurante_id()`/`auth_papel()`/`auth_e_gestor()` (SECURITY DEFINER, não embutíveis) **por linha** →
  2 consultas a `usuarios` por linha (56 mi leituras sequenciais em `usuarios`). Corrigido na **0218**:
  `(select fn())` = InitPlan, 1 vez por consulta. A/B só-leitura, pedidos da Menuzia, 300 linhas:
  **23,5 ms → 1,6 ms** (mediana de 9). Afeta as 69 políticas do public (pedidos, comandas, itens, mesas…).

### Painel (Kanban aberto, parado, Ponto 400 — só leitura)
- Carregamento: DCL 519 ms, load 696 ms, 790 KB de JS em 59 arquivos (cache), 264 nós.
- Parado: 28 requisições em 70 s (~24/min): aprovações remotas 10 s (já só para quem pode aprovar), alarme 15–20 s,
  Kanban por Realtime + batimento. Refetch ao voltar a aba = 1 (as "3 iguais" eram Kanban/Logística/Concluídos).
- `/api/admin/financeiro/aprovacoes-remotas`: ~250 ms por chamada (4 idas ao Supabase em série), a cada 10 s por aba
  de quem aprova. Trocar para 30 s mudaria quanto tempo o aprovador leva para ver o pedido → **decisão do dono**.
- Relógio de 1 s re-renderiza a página inteira do Kanban; com 0 pedidos: 0 quadros lentos em 20 s. Sem número com
  pedidos reais → não mexi (medir num horário de movimento antes).

### Vitrine (Ponto 400, sem login)
- Servidor 0,15–0,24 s (5 lojas × 3); HTML 10 KB. No navegador: TTFB 146 ms, **LCP 332 ms** (banner), load 1,1 s,
  112 KB de JS, 273 KB total, 34 de 38 imagens com lazy. Boa — nada urgente.
- `grupos_cardapio` é buscado 2× (cardápio + itens por id), +42 ms em paralelo, depois do LCP → não vale o risco.

## Não mexido de propósito
Impressão/Assistente (batimentos acima), textos de erro, intervalos que mudam o tempo de reação de alguém, Kanban
(visual travado por ordem do dono).
