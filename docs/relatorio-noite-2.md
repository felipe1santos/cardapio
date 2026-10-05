# Relatório da noite 2 (05/10/2026): impressão v3 + estudo do WhatsApp oficial

## Resumo

1. **Nada publicado.** Sem merge, sem deploy, sem migration em produção e sem instalador publicado. Produção foi só lida (lojas e versões). Tudo está na branch **`impressao-v3`** (8 commits verdes sobre o `main` ef34a80).
2. **Impressão v3 idêntica aos modelos** na comanda e na pré-conta, em 576, 512 e 384 pontos: modelo × antes × v3 em `docs/impressao-final/comparacao/lado-a-lado-*.png`.
3. **Regras novas:**
   - nome do item quebra antes do preço;
   - telefone "(27) 99239-9932";
   - endereço sem hífen no começo da linha;
   - observações do item e geral;
   - linhas zeradas fora;
   - "PIX ONLINE - PAGO" só quando pago; pedido aguardando pagamento não imprime.
4. **Via da cozinha** pronta (sem valores, letra maior), **desligada por padrão**, com prévia no painel. Precisa da migration **0150**, que só está no banco local.
5. **Prévia em /admin/impressao** com o mesmo desenho do papel: Comanda / Pré-conta / Via da cozinha, nos tipos entrega, retirada, mesa e balcão.
6. **Calibração:**
   - envio direto (USB RAW ou IP 9100) recomendado e "Tentar envio direto" em um clique;
   - aviso "Seu driver está em 58 mm";
   - modo Texto com ESC @, FS . e ESC t 16 (WPC1252), com o teste "ÇÃÉÕ".
7. **Instalador 0.2.0-beta.9** gerado só nesta máquina (`printer-agent/dist-beta/`), compatível com o servidor atual e com o novo.
8. **Lojas:**
   - menuzia beta.7, ponto-400 beta.6 e villa beta.7; estância só no Assistente antigo;
   - o aviso "Novo sistema de impressão" foi religado só para quem não tem o beta.9 (as 4 que imprimem).
9. **Testes verdes:**
   - vitest: 2089;
   - e2e de impressão: v3 20/20, Assistente Beta 48/48, modelos 57/57, aviso 34/34, impressão v2 40/40 e topo do Kanban 121/121;
   - matriz de 20 documentos × 3 larguras, modo Texto e tempo de 23 a 39 ms por comanda.
10. **WhatsApp oficial:** a recomendação é a Cloud API com a Menuzia como Tech Provider (Embedded Signup + coexistência). São 22 a 32 dias de desenvolvimento, mais 2 a 6 semanas de espera pela Meta. Estudo em `docs/whatsapp-oficial/estudo.md`.

---

## Impressão v3

Detalhes completos em **`docs/impressao-final/README.md`**: conferência, regras, testes, lojas, mensagem e checklist.

### O que já estava igual no beta.8
- logo no topo;
- faixas pretas com o título branco;
- valor do item à direita, com tracejado entre os itens;
- TOTAL grande;
- dados do cliente;
- QR;
- 1 bit na largura exata.

### O que foi feito
- **Topo:** dados da loja (nome, endereço sem a cidade, telefone formatado), data e hora, e ENTREGA/RETIRADA/MESA 04/BALCÃO.
- **Faixas:** "PEDIDO #135" (ou "PRÉ-CONTA"), "ITENS", "OBSERVAÇÃO", "PAGAMENTO"/"VALORES" e "CLIENTE"/"MESA".
- **Letra:** tudo em DejaVu Sans Mono, com o item como foi cadastrado ("1x Acai Grande") e o adicional no nome ("(+ Bacon)").
- **Pagamento:** TOTAL depois de uma linha sólida e "Pagamento: PIX" embaixo.
- **Pré-conta:**
  - "Serviço (10%)" e "Couvert 1x15,00";
  - Total da conta / Já pago / **A PAGAR**;
  - "Conferência de conta - não é documento fiscal";
  - faixa MESA com Mesa, Comanda, Atendente e Cliente.
- **Rodapé:** QR no centro, "Peça de novo pelo nosso cardápio", "Obrigado pela preferência!" e "feito por Menuzia.com.br".
- **Código:**
  - `printer-agent/src/v3.js` (montador) e `layoutV3` no `ticket-canvas.js`;
  - o Assistente (`main.js`) e a prévia do painel usam o v3;
  - os montadores antigos ficaram no repositório.

### Comparações
- **`docs/impressao-final/comparacao/`:**
  - `lado-a-lado-comanda-{576,512,384}.png`;
  - `lado-a-lado-pre-conta-{576,512,384}.png`;
  - `v3-*.png`.
- **`comparacao/casos/`:**
  - mosaicos `mosaico-{576,512,384}.png` com 20 documentos cada;
  - modo Texto (`texto-*.bin` e `texto-*.txt`);
  - `tempos.json`.
- **`comparacao/painel/`:** prints da prévia no painel (comanda nos 4 tipos, pré-conta mesa e balcão, via da cozinha) e o aviso.

### Via da cozinha (prévia)
- `comparacao/painel/previa-via-cozinha.png`;
- `comparacao/casos/via-cozinha-entrega-*.png` e `via-cozinha-mesa-*.png`.

### Instalador
- `printer-agent/dist-beta/AssistenteMenuziaBeta-Setup-0.2.0-beta.9.exe`, com 82 MB e SHA-256 `58dc42762d1057b7a11587bc8cd90ee9db2cd7b84b1eb7ccadfb533f3d798b5f`.
- Leva `v3.js`, `ticket-canvas.js`, o modo Texto novo e as fontes.
- Instala por cima do Beta (mesmo appId) e não toca no Assistente antigo.
- Compatível com o servidor de hoje: sem os campos novos, assume "não pago online" e "via da cozinha desligada".

### Lojas e versão do Assistente (produção, só leitura)

| Loja | Imprime | Beta | Antigo visto | Aviso |
|---|---|---|---|---|
| menuzia | sim | beta.7 | 05/10 02:59 | sim |
| ponto-400-hamburgueria | sim | beta.6 | 04/10 23:36 | sim |
| villa-lanches | sim | beta.7 (2 PCs) | 03/10 23:55 | sim |
| estancia-burger | sim | — | 04/10 22:35 | sim |
| pizza-do-rosa | não | beta.6 | — | não |
| db-doces, mama-pizza, nossa-cozinha, teste, w-lanches-reviver | não | — | — | não |

### Mensagem para os clientes
Está na seção 5 de `docs/impressao-final/README.md`, pronta para colar. Tem:
- como atualizar, em 3 passos;
- o que melhorou;
- o "Tentar envio direto" para comanda cortada ou clara.

### Checklist de publicação (amanhã, com a sua autorização)
1. Backup.
2. **Aplicar a 0150 antes do deploy.**
3. Merge de `impressao-v3`, deploy e conferência do bundle.
4. Conferir só na Menuzia "Angus Burguer" / "Menuzia teste": prévia, aviso, e nada impresso em loja real.
5. Release do GitHub `printer-agent-v0.2.0-beta.9` e, só depois, a troca do link em `lib/impressao/rotulos.ts`.
6. beta.9 no PC da Menuzia: teste e o aviso some.
7. Mensagem às 4 lojas.
8. Rollback e acompanhamento por 1 h.

Detalhes na seção 6 do README.

## WhatsApp oficial: resumo e recomendação

Estudo completo em `docs/whatsapp-oficial/estudo.md`.

**Hoje:**
- tudo sai pela Evolution API (WhatsApp Web, não oficial), que viola os Termos e pode banir o número da loja;
- já caiu em produção com "Connection Closed";
- os maiores riscos são o OTP para números desconhecidos e as campanhas.

**Recomendação:**
- **Cloud API com a Menuzia como Tech Provider:**
  - Embedded Signup com **coexistência**: a loja continua com o app no celular e o mesmo número;
  - cada loja tem a própria WABA e paga a Meta direto, em reais.
- O código já tem a interface `ProvedorWhatsapp`: é uma segunda implementação, não uma reescrita.
- **Custos no Brasil:**
  - utility e authentication: R$ 0,035;
  - marketing: R$ 0,3217;
  - serviço: cobrado desde 01/10/2026, com 1.000 grátis por mês. Esse ponto ainda precisa de confirmação na tabela oficial.
- **Ordem:** OTP e avisos de pedido primeiro, depois robô e central, e campanhas por último. A 360dialog pode servir de ponte enquanto a verificação da Meta não sai.
- **Esforço:** 22 a 32 dias de desenvolvimento, mais 2 a 6 semanas da Meta (verificação do negócio e App Review).
- **Nada foi cadastrado em Meta ou BSP.**

## Decisões que tomei sozinho
1. **Referência das regras:** os documentos de impressão citados no pedido não existem no repositório. Segui as imagens v3 e o `docs/impressao/comanda-padrao-e-envio-direto.md`.
2. **Adicional no nome do item** ("2x X-Egg Bacon (+ Bacon) 52,00"), como no modelo, com o valor do item já somado. Por isso a opção "Mostrar preço dos complementos" saiu da prévia do Beta (continua valendo no Assistente antigo).
3. **Fonte maior na via de produção:** passou a aumentar 12% os itens da comanda v3, para a opção continuar fazendo efeito.
4. **Observação do item numa caixa com borda** e em negrito ("em destaque"). A observação geral fica na faixa "OBSERVAÇÃO".
5. **Envio direto "recomendado" só na tela.** O valor gravado de quem já usa continua "driver": trocar o envio de quem funciona poderia parar a impressão.
6. **"Tentar envio direto"** usa a rede se a impressora já tem IP; senão, a fila (USB). Em seguida imprime o teste de largura.
7. **Via da cozinha:**
   - é uma coluna nova (`impressao_via_cozinha`, migration 0150, padrão falso);
   - já está ligada no Assistente beta.9: só imprime se a loja ligar;
   - a migration ficou só no banco local.
8. **Aviso de atualização:** aparece para a loja que **imprime** e não tem **nenhum** computador ativo no beta.9 ou mais novo. Só dono e gerente veem. Na Impressão e no Kanban não aparece.
9. **Alvo do aviso = 0.2.0-beta.9.** O link de download (`rotulos.ts`) continua no beta.8 até a release.
10. **Modo Texto passou de PC850 para WPC1252** (ESC t 16), como foi pedido. Nas impressoras sem a página 16, os acentos podem sair trocados; nesse caso, o modo Imagem continua sendo o padrão.
11. **Branch `kanban-volta` (945daa6), não publicada:** Kanban do jeito de antes + ícone da origem + Pix e cartão coloridos. Continua esperando a sua autorização.

## Riscos
- **0150 antes do deploy:** sem ela, a leitura da configuração da impressão falha.
- **WPC1252 no modo Texto:** quem já usa o modo Texto (raro) numa impressora sem a página 16 pode ver acento errado. Basta voltar ao modo Imagem.
- **Lojas no beta.6/beta.7 continuam no modelo antigo** até instalarem o beta.9. O servidor novo serve os dois.
- **O aviso vai aparecer para as 4 lojas que imprimem** logo depois do deploy, inclusive a Menuzia (beta.7). Para segurar, use `NEXT_PUBLIC_AVISO_NOVA_IMPRESSAO=0` no Coolify.
- **Instalador não assinado**, como os anteriores: o Windows pode mostrar o aviso do SmartScreen.
- **Medidas:** a altura das comandas ficou de 0 a 2% maior que a dos modelos, e o QR difere (o conteúdo é outro).
