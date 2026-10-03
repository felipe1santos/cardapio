# Painel de Pedidos — avisos no topo, barra de botões e som de pedido novo

## 2026-10-03 — diagnóstico do som (antes de mexer)

Código: `app/admin/pedidos/page.tsx` (alarme dentro da própria página).

| Hipótese | O que o código fazia | Falha? |
|---|---|---|
| a) Autoplay bloqueado | O áudio só era destravado no **primeiro clique/tecla depois de abrir a página**. Painel recarregado e deixado sem toque: o mp3 era recusado, o "beep" de reserva também (o AudioContext continuava suspenso e a função **saía em silêncio**). Nenhum aviso na tela. | **Sim — principal causa** |
| b) Aba em segundo plano / economia de energia | O alarme repetia com `setInterval`, que o Chrome reduz a 1 vez por minuto em aba escondida. Sem notificação do navegador e sem Wake Lock, a tela dormia e o computador economizava energia. | **Sim** (repetição atrasada; tela apagada) |
| c) Tempo real cai e volta | Ao reconectar, o canal chamava o refetch (`aoSincronizar`) e o pedido novo era detectado. Mas nada reagia ao evento `online` do navegador: dependia do poll de 8 s. | Parcial |
| d) Só um caminho / deduplicação | Tempo real e poll chamam o mesmo `refetch`, que compara com os "recebidos conhecidos": OK. Mas **pedido que já estava esperando quando a página abriu (ou recarregou) nunca tocava**: a primeira leitura só gravava a lista, sem som. | **Sim** |
| e) Mesmo elemento de áudio | Um `<audio>` só. Pedido novo durante o alarme chamava `pause()` + `play()`; o `play()` anterior era abortado e caía no beep (que podia estar bloqueado). Dois pedidos juntos tocavam uma vez. | **Sim** (perde toque) |
| f) Várias abas | Cada aba tocava sozinha: som duplicado e defasado, sem falha. | Não falha, duplica |
| g) Botão Som | Preferência salva no `localStorage` e restaurada: OK. Mas o alarme **parava sozinho depois de 2 minutos**, mesmo com o pedido sem aceitar. | **Sim** (silêncio depois de 2 min) |
| — | Nenhum erro de reprodução era registrado. | Sem rastro |

## Plano
1. Ícone de avisos (badge âmbar, pulso ao surgir aviso novo, painel com ações) no lugar da faixa amarela.
2. Barra de controles logo após o título, separada dos botões do sistema. Botões de 44 px com ícone + texto, estado
   ligado/desligado e tooltip, e menu "Mais ⋯" em telas menores.
3. Alarme novo em `lib/alarme-pedidos.ts` + `components/pedidos/use-alarme.ts`:
   - mp3 decodificado no Web Audio, uma fonte nova por toque (dois pedidos = dois sons);
   - destrave na primeira interação e aviso clicável enquanto bloqueado;
   - toca também para o que já estava esperando ao abrir/reconectar, e no evento `online`;
   - repetição configurável enquanto houver pedido não aceito (sem o corte de 2 min);
   - notificação do navegador com a aba escondida;
   - Wake Lock;
   - botão "Testar som";
   - log de falha no servidor;
   - uma aba só toca cada pedido.

## 2026-10-03 (tarde) — implementado e testado
- Etapas 1 (avisos), 2 (barra) e 3 (som) feitas. Suíte `e2e-kanban-topo.mjs` 55/55, regressão verde, Vitest 1948.
- Achados durante os testes, já corrigidos:
  - aba que não tocou repetia na hora;
  - "Silenciar" valia só numa aba;
  - liberação do áudio pelo navegador não tocava o pendente;
  - notificação duplicada com a do layout;
  - menu "Mais" para fora da tela no tablet/celular.
