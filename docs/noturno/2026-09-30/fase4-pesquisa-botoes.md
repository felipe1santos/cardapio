# Fase 4 — botões clicáveis no WhatsApp: pesquisa de viabilidade (2026-09-30)

**Provedor das lojas:** Evolution API **2.3.7** (`clientName: evolution_v2`), integração
WhatsApp Web/Baileys, conexão por **QR Code** (não é a API oficial da Meta).

## O que o provedor suporta
- Existe `POST /message/sendButtons/{instance}` e o código da 2.3.7 aceita botões
  `type: "url"` (`displayText` + `url`).
- **Mas na 2.3.7 o envio quebra no Baileys**: erro 400 `TypeError: this.isZero is not a
  function` (issue EvolutionAPI/evolution-api#2390, fechada como "not planned").
- Mesmo nas versões em que sai, **os botões de link não aparecem de forma confiável**:
  no desktop aparece "não pode ser exibida no computador" e no celular não aparece nada
  (issue #2104, v2.3.5); botões nativos chegam só na Web e não no Android/iOS
  (evolution-foundation/evolution-api PR #2742); o Baileys não tem suporte oficial a
  esse tipo de mensagem (WhiskeySockets/Baileys#2626).

## Riscos
- Mensagem chegando vazia/sem botão para parte dos clientes.
- Conexão não oficial + disparo em massa + mensagens interativas "imitadas" aumentam a
  chance de o número ser restrito/banido — e com ele param os avisos de pedido e o código
  do checkout da loja.

## Decisão (implementada)
- **Os botões saem sempre como links no texto**, um por linha
  (`👉 Ver cardápio: https://...`). O WhatsApp torna o link clicável e o primeiro gera a
  prévia com a imagem da loja (corrigida na Fase 1.3). A campanha nunca falha por causa
  dos botões. O histórico da central registra "(botões enviados como links no texto)".
- O robô continua mandando o link do cardápio no texto, como hoje.

## Para ter botões de verdade no futuro (API oficial)
- WhatsApp Business Platform (Cloud API): conta Meta Business verificada, número
  dedicado e WABA.
- Campanha = **modelo de mensagem de MARKETING aprovado pela Meta**, com até 2 botões de
  URL (cobrado por mensagem). Fora da janela de 24 h só modelos.
- Na Evolution: integração `WHATSAPP-BUSINESS` (token + id do número + id da conta) e envio
  por `/message/sendTemplate/{instance}` com o modelo criado em `/template/create`.

Fontes: github.com/EvolutionAPI/evolution-api/issues/2390 ·
github.com/EvolutionAPI/evolution-api/issues/2104 ·
github.com/evolution-foundation/evolution-api/pull/2742 ·
github.com/evolution-foundation/evolution-api/issues/1249 ·
raw.githubusercontent.com/EvolutionAPI/evolution-api/2.3.7/src/api/dto/sendMessage.dto.ts ·
github.com/WhiskeySockets/Baileys/issues/2626
