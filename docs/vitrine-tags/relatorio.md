# Relatório — tags da vitrine, preço com desconto, fonte única e tela cheia (01/10/2026)

Em produção desde ~03:45 (Brasília). Commit a0fbb05. Migration **0122** aplicada às ~03:40, com backup antes em `~/backups/menuzia/2026-10-01-pre-0122` e teste a seco.

Este documento **substitui** as regras de tags e de preço com desconto da Fase 3 do noturno.

## 1. O que mudou

### Tags de topo
- Ficam na **mesma linha do nome**, à direita. Se o nome não deixar espaço, descem para a linha de baixo, inteiras e sem mexer na foto.
- No máximo 2, nesta ordem: **Mais vendido › Combo especial › Oferta limitada › Novidade**.
- **Mais vendido** é automático: é a estrela ★ do Gestor, a mesma regra do antigo "★ Favorito"/"Mais pedido".
- **Oferta limitada** é a antiga "Edição limitada". Usa a mesma coluna, então todos os produtos que já tinham a marcação continuam com ela, sem converter dado.
- Nos destaques ("Mais Pedidos") aparece só a tag de topo mais importante, sobre a foto, no canto superior esquerdo.

### Tags utilitárias
- Ficam abaixo da descrição e logo acima do preço, lado a lado (quebram linha se precisar).
- Ordem: **Serve até X pessoas** ("Serve 1 pessoa" no singular) · **Item promocional** · **Tag personalizada**.
- A tag personalizada é um texto livre de até 24 caracteres, em uma linha, preta ou azul.
- Tags iguais nunca se repetem. Um produto sem tags fica como era antes.

### O que saiu
- **"Entrega grátis" saiu das tags**: este documento não lista essa tag. A coluna `entrega_gratis` continua no banco e não foi apagada nem alterada.

### Preço com desconto
- Em cima: o preço original, cinza claro, riscado e menor.
- Embaixo: o preço atual, no estilo de sempre, mais uma pílula verde com o ticket e o percentual (ex.: -25%).
- Com preço "A partir de", o texto continua e a regra é a mesma.
- Na sacola e no "Revisar pedido", a linha de um item com desconto também mostra o preço original riscado.

### Onde vale
Lista por categoria, destaques, busca, ficha do produto e sacola: todos usam os mesmos componentes (`components/vitrine/etiquetas.tsx`).

### Admin (Cardápio › editar produto › Exibição)
Seção "Etiquetas do produto", com **prévia ao vivo** feita com os componentes da vitrine:
- Mais vendido: só leitura. Explica a regra e mostra se o produto está com a tag agora.
- Combo especial, Oferta limitada e Item promocional: liga/desliga.
- Novidade: continua com o prazo em dias.
- Serve até X: liga/desliga e botões − / + (de 1 a 20, começa em 2), com o texto ao vivo.
- Tag personalizada: liga/desliga, campo com contador (24) e escolha Preta/Azul.
- Aviso quando há mais de 2 tags de topo ligadas.
- Ao salvar aparece uma confirmação na tela ("Produto salvo.").

**Segurança:**
- O banco recusa tag personalizada com mais de 24 caracteres ou com quebra de linha (constraint da 0122).
- Gravar continua passando pela RLS de `itens_cardapio`, que é por loja e por papel.
- A área Cardápio continua protegida pelo controle de acessos da Fase 6.

### Fonte e layout
- **Fonte:** a auditoria encontrou só Montserrat em todas as etapas. O seletor `.font-loja *` já forçava a fonte em inputs, botões e selects. Removi as 26 classes `font-sans` que sobravam na vitrine.
- **Botão principal do checkout:** agora é verde, largo e com o valor à direita em **todas** as etapas. Antes era azul e sem valor em Pagamento e Endereço.
- **Formas de pagamento:** os ícones agora ficam em quadrado cinza claro, como no Revisar.
- **Resumo da sacola:** igual ao bloco de valores do Revisar.
- A ordem e a lógica das etapas não mudaram.

### Tela cheia no celular (5.1)
- **A) Rolagem do documento:**
  - A home já rolava na própria página.
  - O checkout era uma camada fixa com rolagem interna. **No celular ele passou a rolar na própria página**, com a home escondida, então a barra do navegador agora pode recolher.
  - Ao fechar o checkout, o cliente volta para a posição em que estava no cardápio.
  - Cada etapa começa do topo.
  - A trava de rolagem do fundo continua só no desktop.
- **B) Menu da vitrine:**
  - O menu de baixo (com o "Tirar dúvidas no WhatsApp" dentro) some ao rolar para baixo e volta ao rolar para cima, perto do topo e no fim da página.
  - A barra "Ver sacola" acompanha: desce para perto do fundo sem cobrir nada.
  - No checkout o menu não aparece, e o botão principal fica sempre visível.
- **B) Viewport, safe-area e cor da barra:**
  - `viewport-fit=cover`.
  - Safe-area embaixo **só no iPhone** (`@supports (-webkit-touch-callout: none)`). No Chrome Android esse respiro já tinha causado uma faixa branca: lá ele vale só no app instalado.
  - `theme-color` com a cor da loja no tema claro e no escuro.
- **C) App por loja:**
  - Manifesto em `/api/loja/<slug>/manifest`: `standalone`, `start_url` e escopo no cardápio da loja, nome e cor da loja.
  - Ícones PNG 180/192/512 em `/api/loja/<slug>/icone/<tam>`: a logo, ou a inicial na cor da loja.
  - Metas iOS: `apple-mobile-web-app-capable`, `status-bar-style` e `apple-touch-icon`.
- **C) Convite para instalar:**
  - É discreto e pode ser dispensado.
  - Android: botão "Instalar" (`beforeinstallprompt`).
  - iPhone: dica "Compartilhar › Adicionar à Tela de Início".
  - Aparece no máximo 1 vez por semana, só na home.
  - Nunca aparece no checkout, para quem já instalou ou dispensou, nem nos navegadores internos (WhatsApp/Instagram/Facebook).
  - Os links externos (WhatsApp) já abrem com `target=_blank`, ou seja, fora do app.
- **D) Fullscreen API no Android: não implementada.** Motivos:
  - Eu não tinha um aparelho real para validar o teclado nos campos de endereço.
  - No Android, o botão voltar sai da tela cheia sem aviso.
  - O app instalado (standalone) já entrega a tela sem barra, sem esses riscos.
  - No iPhone ela não existe para páginas.

## 2. Hex finais

As cores foram medidas por `scripts/vitrine/medir-cores-tags.mjs` (sharp; o PC não tem Python). Método: cor predominante do fundo e pixels mais saturados do texto/ícone.

| Tag | Fundo | Texto | Ícone |
|---|---|---|---|
| Mais vendido | #E91E20 | #FFFFFF (700) | #FFFFFF |
| Combo especial | #F2EAFC | #9A3AE1 | #A135F4 |
| Oferta limitada | #FCE7F3 | #BE185D | #BE185D |
| Novidade | #A3F7B5 | #14532D | #14532D |
| Serve até X | #F1F1F1 | #0C0D18 | #0C0D18 |
| Item promocional | #EAF0F3 | #17618B | #17618B |
| Personalizada preta | #1F1F1F | #FFFFFF | — |
| Personalizada azul | #EAF0F3 | #17618B | — |
| Desconto (pílula) | #EAFFF5 | #24A96A | #24A96A |
| Preço antigo | — | #A1A1AA, riscado | — |

**Valores medidos que diferem da estimativa do pedido:**
- Serve: o fundo medido foi #F1F1F1 (o pedido estimava #EBEBEB).
- Desconto: verde medido #24A96A (estimado #1AA764) e fundo #EAFFF5.
- Combo especial:
  - o fundo #F2EAFC foi medido na REF-TAGS, porque o recorte do iFood pega o branco em volta;
  - o texto #9A3AE1 é o roxo das tags "Até R$ 10"/"R$ 7 off" do iFood, um pouco mais escuro que o do ícone, para ler melhor;
  - o ícone #A135F4 é o roxo do selo "Point do Açaí".

**Medidas das tags:** caixa de 22px de altura, canto de 6px, 7px de respiro lateral, texto de 12px, ícone de 14px a 5px do texto e 8px entre tags.

## 3. Ícones
- **Phosphor Icons**, estilo *fill*, **licença MIT**. Licença em `public/vitrine/icones/LICENSE-phosphor-icons.txt`.
- O SVG vai embutido no código (`components/vitrine/icones-tags.tsx`), sem CDN e sem emoji. A cor vem da própria tag.
- Ícones usados:
  - `flame` → Mais vendido;
  - `sketch-logo` (diamante lapidado) → Combo especial;
  - `hourglass-medium` → Oferta limitada;
  - `sparkle` → Novidade;
  - `users-three` → Serve;
  - `tag` → Item promocional;
  - `ticket`, inclinado 45° como no iFood → desconto.
- Escolhi esses comparando 12 candidatos com os recortes ampliados das referências.
- Os emojis Fluent da Fase 3 (`public/vitrine/emoji/`) não são mais usados pelas tags.

## 4. Prints (docs/vitrine-tags/prints/)
- **Lado a lado:**
  - `lado-a-lado-tags-mais-vendido.png` (REF-TAGS X-BURGUER × resultado);
  - `lado-a-lado-tags-combo.png`;
  - `lado-a-lado-cores.png` (REF-CORES × desconto + tags).
- **360/390/414/desktop:** `lista-*`, `destaques-*`, `busca-*`, `ficha-*`, `sacola-*`; recortes por caso em `recorte-*`.
- **Checkout inteiro em 390 px, entrega e retirada:**
  - antes: `checkout-antes/` e `lado-etapas-antes.png`;
  - depois: `checkout/`.
- **Navegadores:** `navegadores/*.png` (parado › descendo › subindo › checkout).
- **Produção (Menuzia):** `producao/prod-*`.

## 5. Script de fontes (`scripts/vitrine/auditar-fontes-vitrine.mjs`, 390 px)

Resultado: 18/18 etapas só com Montserrat. Telas cobertas:
- home, aba Pedidos, aba Cupons, login;
- ficha do produto;
- sacola, telefone, pagamento com troco, endereço/seus dados, revisar e pedido feito — em entrega e retirada.

A mesma verificação passou em produção. Ela ignora `<script>`, que não é texto.

## 6. Resultado por navegador (5.1)

Testei por emulação no Chromium, com o user-agent e a tela de cada navegador: `scripts/vitrine/e2e-tela-cheia-navegadores.mjs`, 30/30. Em todos:
- a rolagem é a da página;
- o menu fica no fundo e some ao descer e volta ao subir;
- o checkout fica sem menu e com o botão visível;
- o convite de instalar aparece só onde deve.

| Navegador | Barra do navegador ao rolar | Menu da vitrine | Instalar |
|---|---|---|---|
| Chrome no iPhone (o caso das 3 barras) | a página agora rola no documento (inclusive no checkout), que é o que permite ao Chrome recolher a barra de baixo; **não conferido em aparelho real** | some/volta | dica Compartilhar › Tela de Início |
| Safari iOS | a barra de endereço compacta ao rolar | some/volta; safe-area acima da barrinha | dica; app abre sem barra |
| Chrome Android | a barra de endereço recolhe | some/volta | botão "Instalar" quando o Chrome dispara o evento |
| Samsung Internet | as barras recolhem (comportamento padrão) | some/volta | menu do próprio navegador (o evento pode não disparar) |
| WhatsApp (Android) | abre numa aba do navegador / custom tab; a barra de cima é do WhatsApp | some/volta | sem convite (não instala) |
| Instagram/Facebook (navegador interno) | as barras são do app, não recolhem | some/volta | sem convite |

**Limites:**
- A emulação não desenha a barra real do navegador.
- **Não houve teste em aparelho real nem em BrowserStack.**
- Nenhum site consegue esconder à força a barra de ferramentas ou a de navegação do sistema numa aba comum. Recolher ao rolar é decisão do navegador.
- Validar no seu iPhone (Chrome, aberto por link do WhatsApp) é o próximo passo.

## 7. Testes
- Unitários: `lib/etiquetas-vitrine.test.ts` 13 e `components/vitrine/tela-cheia.test.ts` 5.
  - Cobrem prioridade e limite de tags, migração das tags antigas, singular/plural, desconto, validação da personalizada, menu ao rolar e frequência do convite.
- vitest completo: 1810 ✅.
- e2e locais:
  - vitrine-tags 20/20;
  - admin-etiquetas 14/14 (inclui o banco recusando 25 caracteres);
  - fontes 18/18;
  - navegadores 30/30;
  - vitrine-fase3 51/51 (atualizada para as regras novas);
  - checkout-larguras 72/72;
  - regressão-release 52/52;
  - agendamento 25/25.
- Produção: `scripts/vitrine/smoke-tags-producao.mjs` 13/13, só na vitrine pública da Menuzia, sem login, sem telefone e sem pedido.
- Impressão não foi tocada.

## 8. Produtos TESTE na Menuzia (produção)
- Criei a categoria **"TESTE Tags"** com 13 produtos:
  - TESTE X-Burger · TESTE Combo · TESTE Oferta · TESTE Quatro de topo;
  - TESTE Serve 1 · TESTE Serve 10;
  - TESTE Personalizada preta · TESTE Personalizada azul;
  - TESTE X-Burger artesanal duplo com cheddar e bacon crocante;
  - TESTE Desconto · TESTE Desconto com tags · TESTE Sem tags · TESTE A partir de (com tamanhos).
- Depois da conferência, todos foram **pausados** (`scripts/vitrine/teste-tags-menuzia-producao.mjs ocultar`) e não aparecem mais na vitrine.
- Nada foi apagado. A categoria vazia fica oculta sozinha.

## 9. Diferenças em relação às referências
- **Utilitárias em 2 linhas a 390 px:** na REF-TAGS, "Serve 4 pessoas" e "Item promocional" cabem lado a lado. Duas coisas mudam aqui:
  - a coluna de texto da vitrine tem ~234 px (a foto de 120 px e os respiros foram mantidos), contra ~300 px na referência;
  - o texto agora é "Serve **até** 4 pessoas".
  - Mudar a largura da foto mexeria no resto da vitrine, que o pedido manda não tocar.
- **"Combo especial" no topo**, junto do nome. A REF-TAGS mostra "Combo premium" abaixo da descrição, mas a regra do pedido é topo.
- **Nomes com "TESTE "** são mais longos que "X - BURGUER": em 390 px a tag "Mais vendido" desce para a linha de baixo. Com um nome curto ela fica na mesma linha (conferido no e2e).
- **Fontes:** a REF-TAGS usa nomes em caixa alta. A vitrine mantém o nome como a loja cadastrou.
