# Sistema mais leve — 29–30/10/2026

Plano: [docs/superpowers/plans/2026-10-29-sistema-mais-leve.md](../superpowers/plans/2026-10-29-sistema-mais-leve.md).
Cada etapa: implementador + revisor independentes (subagentes), `npm run checar`, teste de ponta a ponta local e em produção (Menuzia), deploy um por vez depois das 23h.

## No ar (main = 8b1b0512)
| Deploy | O quê | Conferido |
|---|---|---|
| D1 c3e2673b | Lista de impressoras só grava quando muda (+ botão "Atualizar lista de impressoras"); resposta de "tem pedido?" sem a lista quando não há pedido | descoberta da BURGUER MAX gravou 1× após o reinício e não regravou (207 s sem gravar) |
| D2 b7c2c6d6 | Despertador separado (pedido não acorda pré-conta e vice-versa); re-busca do aviso confere o dono antes de reservar | E2E em produção (agente de teste na Menuzia, removido): trabalho chega em 475 ms (mediana), espera vazia 20,1 s |
| D4 31c78a3c | Painel: relógios pausam com a aba escondida e leem ao voltar (Kanban segue com aceite automático ligado); vitrine só consulta com pedido em andamento e lê ao voltar a aba; alerta de requisições compara com o mesmo horário dos dias anteriores | vitrine 200, /admin → /login no host certo, sem erro no log |
| D5 8b1b0512 | Imagem enxuta (Next standalone + Dockerfile; Coolify em build_pack dockerfile) | imagem 577 MB (antes 2,42 GB); app usa 172 MiB; sharp e ffmpeg ok no container; âncoras no volume; fontes 200 |

## Desfeito
- **0234 (sinal de vida a cada 10 s):** aplicada 00:12 e revertida 00:15. Medido na BURGUER MAX: idade de `visto_em` chegou a 28 s
  (limite "online" 30 s), porque o Assistente pergunta a cada ~20–24 s e os 10 s somam em cima. O painel piscaria "sem sinal" e poderia
  tocar o alarme. Função voltou idêntica à anterior; arquivo saiu do repositório (31c78a3c). Refazer só subindo `ONLINE_MS` junto.

## Números (pg_stat_statements, consultas/min)
| Fonte do Assistente (por computador, aprox.) | Antes (18h05–18h33, 2 PCs ÷ 2) | Depois (00h35–00h55, 1 PC) |
|---|---|---|
| impressao_dispositivos (lista de impressoras) | ~8,9 | ~0 |
| impressoras (lista na resposta) | ~3,1 | ~0 |
| impressao_agentes:sel | ~3,1 | 1,3 |
| impressao_funcoes (conferência de dono) | ~9,3 | 7,1 |
| autenticar + reservar pedidos + reservar trabalhos | ~19,6 | 18,3 |
| **Total aproximado por PC** | **~44** | **~27 (−40%)** |
O ganho da Task 4/5 (avisos de pedido) só aparece com pedidos entrando; as telas do painel e a vitrine só no próximo jantar.
Comparar no jantar de 30/10 (mesmo horário de base0/base1) para o número real do banco inteiro.

## Limpeza da VPS
2 imagens antigas + cache de build parado apagados (disco 31% → 30%). Com a imagem nova cada versão guardada ocupa ~0,6 GB.

## Ficou para depois
- Sinal de vida a cada 10 s, só junto com `ONLINE_MS` maior.
- `realtime:list_changes` (~118/min, fixo) é do próprio Realtime do Supabase — próximo alvo.
- Minors adiados das revisões (ledger em `.superpowers/sdd/…/progress.md`): botão de lista limpa todos os PCs da loja; painel de
  Impressão não lê ao voltar a aba; Pix fechado antes de pagar só aparece ao voltar à aba; erro na leitura das fotos do vigia deixa a
  referência vazia por 1 h.
- Volta da imagem enxuta: Coolify `build_pack` → nixpacks + Redeploy de 31c78a3c.
