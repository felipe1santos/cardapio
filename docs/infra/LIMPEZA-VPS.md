# Limpeza da VPS e do Coolify

Última revisão: 04/11/2026. Verificador: `npm run vps:lixo` (só leitura, `scripts/infra/verificar-lixo-vps.mjs`).

## Regra

**Depois de cada deploy**, rodar `npm run vps:lixo`. Ele confere se sobrou lixo na VPS e se a limpeza automática do
Coolify está funcionando. "OK" = nada a fazer. "Atenção" = seguir o que ele indica (nunca apagar volume nem imagem em uso).

## Como o lixo nasce

- Cada deploy do Menuzia gera uma **imagem nova** (~577 MB) e **cache de build** (camadas reaproveitadas pelo próximo build).
- O build roda **na mesma VPS das lojas**: por alguns minutos a memória cai (alerta "vps-memoria") e volta sozinha ao fim.
  Isso não é lixo; só some quando o build sair da VPS (pendência "build fora da VPS").

## Limpeza automática do Coolify (já existia; ajustada em 04/11)

Configuração do servidor (`localhost`, Coolify › Servers › Configuration › Docker Cleanup):

| Campo | Valor | O que faz |
|---|---|---|
| `docker_cleanup_frequency` | `0 */6 * * *` | Roda a cada 6 h (00, 06, 12, 18 h UTC = 21, 03, 09, 15 h de Brasília) |
| `force_docker_cleanup` | ligado | Roda sempre, não só quando o disco passa do limite |
| `docker_cleanup_threshold` | 80 % | Só usado quando o "forçar" está desligado |
| `delete_unused_volumes` / `delete_unused_networks` | desligados | **Mantém** volumes (dados) e redes |

Configuração do app Menuzia (`co0swg8ko4scg0g4ssgwosww`):

| Campo | Antes | Agora | Por quê |
|---|---|---|---|
| `docker_images_to_keep` | 3 | **2** | Fica a versão no ar e a anterior (para voltar rápido); o resto a limpeza apaga |

Ajuste feito pela API do Coolify:
`PATCH /api/v1/applications/co0swg8ko4scg0g4ssgwosww` com `{"docker_images_to_keep": 2}` (token em `~/.ssh/coolify_token.txt`).

**Ponto fraco conhecido:** se houver um deploy rodando no minuto da limpeza, ela **pula o cache de build** ("Skipped:
the build cache was not pruned because deployment … is queued or running"). Em dia de muitos deploys o cache acumula até a
próxima rodada sem deploy. O verificador avisa quando isso acontece com o cache acima de 8 GB; aí, fora de deploy:
`ssh <VPS_HOST> "docker builder prune -f"` (só cache, nada em uso).

## O que NÃO se apaga

- **Volumes** (dados de banco e serviços).
- Imagem **em uso** por algum container.
- `coollabsio/coolify-helper` (parado de propósito; o Coolify usa durante o deploy).
- Evolution API (WhatsApp das lojas) e seu Postgres/Redis (`ww0wkggowcwo48www4co8sg4`).
- App `37ifda4wegx7wdksxf8fwp4s`: ainda não confirmado se é o site do Menuzia; não mexer até ter certeza.

## Limpeza de 04/11/2026 (feita com aprovação do dono)

| Item | Como | Resultado |
|---|---|---|
| n8n (serviço `xo8wwg8oosg4oc0w4coks4c4`, sem uso) | Backup do volume em `/root/backups/n8n-data-2026-11-04.tar.gz` (25 MB) → `DELETE /api/v1/services/xo8w…?delete_volumes=true&docker_cleanup=true` → `docker rmi` das imagens `n8nio/n8n` e `n8nio/runners` | ~210 MB de RAM e ~2,5 GB de disco |
| 8 imagens antigas do Menuzia | `docker rmi co0swg8ko4scg0g4ssgwosww:<commit>` (ficaram `697df9b9` no ar e `134096be` anterior) | parte dos ~5 GB |
| Coolify 4.5.3 (já roda a 4.6.0) | `docker rmi coollabsio/coolify:4.5.3` | ~960 MB |
| Cache de build > 72 h | `docker builder prune -f --filter until=72h` | 0 B (todo o cache era do dia; a limpeza automática pega na rodada seguinte sem deploy) |

Antes → depois: disco **37 GB → 32 GB** (39 % → 34 %); memória disponível **5,34 GB → 5,44 GB**. Site e Evolution conferidos no ar.
