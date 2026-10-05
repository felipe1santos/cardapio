# Impressão — modelo oficial v3 (2026-10-05)

**Branch `impressao-v3`. Nada publicado.**
- Instalador **0.2.0-beta.9** gerado só nesta máquina: `printer-agent/dist-beta/AssistenteMenuziaBeta-Setup-0.2.0-beta.9.exe`, SHA-256 `58dc4276…798b5f`.
- Migration **0150** escrita, mas aplicada só no banco local.

Referências: `referencias/comanda_v3.png` e `referencias/preconta_v3.png`, com papel de 432 px.

## 1. Conferência: antes (beta.8) × modelo

Os dados são os mesmos das imagens: pedido #135 da Ponto 400 e a pré-conta da mesa 04. O desenho saiu do renderizador real, em 576, 512 e 384 pontos.

Arquivos: `comparacao/lado-a-lado-comanda-<576|512|384>.png` e `comparacao/lado-a-lado-pre-conta-<…>.png`, cada um com três colunas: modelo × antes × v3.

**O que o beta.8 já tinha igual ao modelo:**
- logo da loja no topo;
- faixas pretas com o título em branco;
- itens com o valor à direita e tracejado entre eles;
- TOTAL grande;
- dados do cliente;
- QR do cardápio;
- Subtotal e taxa de entrega com R$;
- impressão em 1 bit na largura exata.

**O que faltava (e agora está igual):**

| Modelo v3 | beta.8 |
|---|---|
| Topo: nome, endereço (rua, nº - bairro), telefone **(27) 99999-0000**, data e hora, ENTREGA/RETIRADA/MESA 04/BALCÃO | "COMANDA COZINHA", "#135" com selo, "Recebido 20:43"; a loja ia no rodapé, com o telefone cru (27999990000) |
| Faixas "PEDIDO #135" e "ITENS" | "ITENS DO PEDIDO" com o cabeçalho ITEM / VALOR (R$) |
| Tudo em monoespaçada (DejaVu Sans Mono), nome do item como cadastrado ("1x Acai Grande") | Roboto Condensed e Arimo, item em MAIÚSCULAS |
| Adicional no nome: "2x X-Egg Bacon (+ Bacon) 52,00" | Adicional em linha própria, com o valor separado (44,00 + 8,00) |
| Faixa "PAGAMENTO": Subtotal, Taxa, linha sólida, TOTAL, "Pagamento: PIX" | Faixa "VALORES" com "Pagamento ❖ PIX" antes do TOTAL e linha dupla tracejada |
| Faixa "CLIENTE": Cliente / Tel.: (27) 99239-9932 / End. | "DADOS DA ENTREGA" com Telefone / Endereço / Bairro em colunas |
| Rodapé: QR no centro, "Peça de novo pelo nosso cardápio", "Obrigado pela preferência!", "feito por Menuzia.com.br" | QR ao lado dos dados da loja e "Feito por Sistema Menuzia" |
| Pré-conta: faixas PRÉ-CONTA / ITENS / VALORES / MESA, "Serviço (10%)", "Couvert 1x15,00", Total da conta / Já pago / **A PAGAR**, "Conferência de conta - não é documento fiscal" | "PRE-CONTA" sem acento, tabela QTD/DESCRICAO, "Taxa de serviço" sem o %, detalhe do couvert numa linha solta, sem a nota e sem a faixa MESA |

**Diferenças que restam** (medidas sobre a mesma largura):
- a altura total fica de 0 a 2% maior;
- a logo do teste foi recortada da própria imagem do modelo;
- o QR tem outro conteúdo (o link da loja), então os quadradinhos diferem.

Fontes, tamanhos, faixas, linhas, quebras e alinhamentos batem com o modelo.

## 2. O que foi feito

- **Montador** `printer-agent/src/v3.js`:
  - comanda: entrega, retirada, mesa e balcão;
  - pré-conta: mesa e balcão;
  - via da cozinha.
- **Desenho** `layoutV3` no `ticket-canvas.js`: o mesmo do papel e da prévia; papel de 432 px escalado para 384, 512 ou 576 pontos.
- **Regras:**
  - **Espaço mínimo entre o nome e o preço** (um caractere). Se não couber, o nome quebra; o "(+ Bacon)" nunca se parte.
  - **Telefone** sempre "(27) 99239-9932", sem o 55: o do cliente e o da loja.
  - **Endereço** quebrado por partes (rua, nº / complemento / bairro / cidade), juntas com " - " quando cabem. Uma linha **nunca começa com hífen**: o "- DASDAS" do modelo virou "DASDAS".
  - **Observação do item** logo abaixo dele, em negrito e numa caixa. A **observação geral** fica na faixa "OBSERVAÇÃO", antes de PAGAMENTO. Vazias não saem.
  - **Linhas com valor zero são omitidas**: taxa de entrega, desconto, serviço e taxas.
  - **"PAGO" só quando pago de verdade.** Pix online confirmado imprime "Pagamento: PIX ONLINE - PAGO". Pedido **aguardando pagamento nunca imprime**: a fila do banco já não o entrega, e o Assistente tem uma segunda trava. A fila agora manda `pagamentoOnline` e `status`.
  - **Via da cozinha** (opção da loja, migration 0150, **desligada por padrão**): sem valores e sem PAGAMENTO, com itens e observações maiores. Ligada, sai logo depois da comanda, na mesma impressora.
  - Também valem as opções da loja já existentes:
    - número do item;
    - nome dos adicionais;
    - multiplicar pela quantidade;
    - fonte maior na via de produção (+12% nos itens);
    - logo.

    "Mostrar preço dos complementos" não muda o v3, porque o adicional vai no nome. A opção continua valendo para o Assistente antigo.
- **Prévia em /admin/impressao:**
  - abas **Comanda / Pré-conta / Via da cozinha**;
  - tipos **Entrega / Retirada / Mesa / Balcão** (a pré-conta só tem mesa e balcão);
  - mesmo montador e mesmo desenho do papel, em 1 bit;
  - na aba da via da cozinha, a chave "Imprimir também a via da cozinha (sem valores)".
- **Calibração:**
  - **envio direto (fila RAW por USB, ou rede IP:9100) marcado como recomendado**; o driver do Windows aparece como alternativa;
  - o padrão gravado continua "driver" para quem já usa, porque mudar o envio de quem funciona é arriscado;
  - **"Tentar envio direto"** em um clique: liga o envio direto (pela rede se a impressora já tem IP, senão pela fila) e já imprime o teste de largura;
  - aviso **"Seu driver está em 58 mm, mas a impressora é de 80 mm"**, agora também quando o driver só informa os pontos (384 = 58 mm).
- **Modo Texto:** começa com **ESC @**, **FS .** (sai do modo chinês dos clones) e **ESC t 16** (WPC1252). Até o beta.8 era PC850. O teste de largura em texto imprime "ÇÃÉÕ çãéõ áíú".
- **Aviso "Novo sistema de impressão disponível":**
  - religado no código, mas **só para a loja que imprime e não tem nenhum computador no 0.2.0-beta.9 ou mais novo**;
  - rota `/api/admin/impressao/versao`, só para dono e gerente;
  - quem já atualizou, ou não imprime, não vê.

## 3. Testes (todos verdes)

- **Unitários:**
  - `printer-agent/src/v3.test.ts`: 11 testes;
  - `escpos.test.ts`, com o WPC1252 e o v3 em texto;
  - `regras-calibracao.test.ts`, com o papel efetivo e o envio sugerido;
  - `avisos-painel.test.ts`, com as versões.

  Impressão inteira: 45 arquivos e 326 testes.
- **`scripts/impressao/comparar-v3.mjs`:** modelo × antes × v3 em 576, 512 e 384 pontos; 1 bit, bordas limpas e altura a até 2% do modelo.
- **`scripts/impressao/casos-v3.mjs`** gera `comparacao/casos/`:
  - **20 documentos × 3 larguras**, com o mosaico em `mosaico-<pontos>.png`:
    - comanda de entrega, retirada, mesa e balcão;
    - Pix, Pix online pago, dinheiro com troco, crédito, débito e vale;
    - desconto e observações;
    - nomes longos (loja, cliente, endereço, pizza com 3 sabores e borda);
    - 18 itens;
    - loja sem logo;
    - QR do Instagram;
    - pré-conta de mesa (com e sem pagamento parcial), balcão e 2ª via;
    - via da cozinha (entrega e mesa);
  - **impressora virtual de rede** (servidor TCP local): imagem ESC/POS e **modo Texto** em 576 e 384, com os bytes recebidos (`texto-*.bin`) e a versão legível (`texto-*.txt`);
  - **tempo**, na mediana de 5 medidas: desenho + 1 bit de 23 a 39 ms, ESC/POS menos de 1 ms, envio 1 ms. Detalhes em `tempos.json`.
- **`scripts/impressao/e2e-impressao-v3.mjs`** (servidor local), com prints em `comparacao/painel/`:
  - prévia: abas, tipos, 1 bit, opção da via da cozinha gravando no banco;
  - aviso por versão.

## 4. Lojas e versão do Assistente (produção, só leitura, 05/10 ~03:00)

| Loja | Imprime | Assistente Beta (computadores ativos) | Assistente antigo visto | Vai ver o aviso? |
|---|---|---|---|---|
| menuzia | sim | 0.2.0-beta.7 (visto 05/10 02:59) | 05/10 02:59 | sim |
| ponto-400-hamburgueria | sim | 0.2.0-beta.6 (04/10 23:36) | 04/10 23:36 | sim |
| villa-lanches | sim | 0.2.0-beta.7 ×2 (03/10) | 03/10 23:55 | sim |
| estancia-burger | sim | — (só o Assistente antigo) | 04/10 22:35 | sim |
| pizza-do-rosa | não | 0.2.0-beta.6 (28/09) | — | não (não imprime) |
| db-doces, mama-pizza, nossa-cozinha, teste, w-lanches-reviver | não | — | — | não |

Nenhuma loja está no beta.8, nem a Menuzia (beta.7).

## 5. Mensagem para os clientes

Pronta para mandar só **depois** da publicação:

> **Impressão nova no Menuzia 🖨️**
>
> Atualizamos o Assistente de Impressão. A comanda agora sai no modelo novo:
> - dados da loja no topo;
> - itens maiores e com espaço até o preço;
> - telefone e endereço fáceis de ler;
> - observação de cada item em destaque;
> - "PAGO" só quando o pagamento foi confirmado (Pix online).
>
> **Como atualizar (2 minutos):**
> 1. No computador da impressora, abra o painel em **Impressão** (menu lateral) e clique em **Baixar Assistente**.
> 2. Instale por cima. Quem já usa o Assistente Beta não precisa desinstalar nem parear de novo; quem ainda usa o Assistente antigo segue o pareamento da própria tela (código de 8 letras).
> 3. Clique em **Testar impressão** para conferir.
>
> **Se a comanda sair cortada ou clara:** em **Impressão › Calibrar impressora**, clique em **Tentar envio direto**. Ele manda a comanda pronta na largura certa, sem depender do driver do Windows.
>
> Qualquer dúvida, é só chamar a gente no WhatsApp.

## 6. Checklist de publicação

Só com a autorização do dono, seguindo a regra de sempre.

1. **Backup** do banco.
2. Aplicar a **0150** (aditiva: `impressao_via_cozinha boolean not null default false` + grants) **antes** do deploy. O código novo lê a coluna.
3. Merge de `impressao-v3` no `main`, deploy pelo Coolify e conferência do bundle (marcador ASCII).
4. Conferir só na **Menuzia "Angus Burguer"**, perfil "Menuzia teste":
   - /admin/impressao: as três abas e os tipos;
   - aviso (aparece, porque a Menuzia está no beta.7);
   - **nada impresso em loja real**.
5. Publicar o instalador **0.2.0-beta.9**:
   - release do GitHub `printer-agent-v0.2.0-beta.9`, com o .exe gerado aqui (conferir o SHA-256) ou um novo build da branch;
   - depois, trocar o link em `lib/impressao/rotulos.ts` (versao + url) e publicar de novo.
6. Instalar o beta.9 no PC da Menuzia, imprimir o teste e confirmar que o aviso some.
7. Mandar a mensagem acima às lojas que imprimem (menuzia, ponto-400, villa-lanches, estancia-burger).
8. **Rollback:**
   - código: voltar o `main` ao commit anterior e fazer o redeploy;
   - a 0150 pode ficar, porque é aditiva;
   - o aviso pode ser desligado sem deploy de código (`NEXT_PUBLIC_AVISO_NOVA_IMPRESSAO=0` + Redeploy);
   - as lojas no beta.9 voltam para o beta.8 instalando o .exe antigo por cima.
9. Acompanhar a fila de impressão e os pedidos das lojas por 1 h depois do deploy.
