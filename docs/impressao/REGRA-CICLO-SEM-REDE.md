# Regra permanente: o ciclo de impressão não vai à rede à toa (10/10/2026)

**Origem:** auditoria do atraso da impressão (10/10/2026). O ciclo de pedidos do Assistente baixava a logo da
loja da internet a cada rodada com pedido, antes de imprimir — e no Beta/Alfa 1 esse arquivo nem era usado.
Corrigido na Alfa 1 **1.1.2** (`printer-agent/src/ciclo-logo.js`).

## A regra

1. O ciclo de impressão do Assistente **NUNCA** faz download nem chamada de rede que não seja estritamente
   necessária para aquele pedido. Necessário: buscar a fila (`/api/agente/pedidos`) e confirmar o impresso.
2. Logo, fontes e imagens fixas ficam **guardadas no computador** e só são atualizadas **fora do ciclo**:
   ao iniciar o Assistente ou quando a loja mudar a logo (versão da logo diferente).
3. Toda mudança no Assistente mede **"pedido criado → impresso"** antes e depois, na mesma loja e do mesmo jeito
   (captura só leitura: `impressao_reservas` = buscado, `pedidos.impresso` = impresso). **Não pode piorar.**
   O número vai no commit/PR da versão.

## Como conferir numa revisão

- Procurar `fetch`, `baixar`, `download`, `https.get` dentro de `cicloDePolling` e do que ele chama até a impressora.
  Tudo que não for a fila do pedido é suspeito.
- Cache local com versão: `logoParaDesenho(versao)` é o modelo (só busca de novo quando a versão muda).
