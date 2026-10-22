# Auditoria de desempenho e estabilidade — 22/10/2026 (noite, modo autônomo)

Regras: só desempenho/estabilidade/eficiência; nada de lógica de negócio, texto, design ou layout. Testes só na Menuzia;
impressão/Assistente intocados. Medir antes e depois. Se o terminal fechar: ler este arquivo e continuar do "Próximo passo".

## Estado / próximo passo
- [x] P1 VPS: CPU, memória, disco, containers
- [x] P1 crons do Coolify (duração, sobreposição)
- [x] P1 login falhando na 1ª tentativa — causa achada (ver P1.3)
- [ ] P1 IA/APIs pagas: chamadas duplicadas por mensagem, retries
- [ ] P2 ponta a ponta (salvamentos)
- [ ] P3 banco (advisors, índices), realtime/polling, bundle

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
