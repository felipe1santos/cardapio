# Vitrine — tags, preço com desconto, fonte única e tela cheia (2026-10-01)

Branch `feat/vitrine-tags`. Este documento substitui as regras de tags/preço da Fase 3 do noturno.
Deploy só 00:00–10:00. Legenda: ⬜ a fazer · 🔧 em andamento · ✅ feito e testado · 🚀 no ar · ⚠️ ressalva

## Referências
- ✅ Copiar referências para docs/referencias/vitrine-tags/ (REF-TAGS, REF-CORES = WhatsApp 22.37.25, Serve 4, Item promocional, caso Chrome iPhone 3 barras)
- ✅ Medir cores por script (fundo predominante + pixels mais saturados do texto/ícone) e registrar hex finais
- ✅ REF-FONTE: etapa "Revisar pedido" da Menuzia como padrão

## 1. Ícones
- ✅ Biblioteca livre, monocromática preenchida, SVG local (sem emoji/CDN) + arquivo de licença
- ✅ Fogo · diamante · ampulheta/relógio · pessoas · etiqueta · ticket — mesmo tamanho visual, cor da tag
- ✅ Comparação ampliada lado a lado com a referência

## 2. Hierarquia e posição
- ✅ Topo na linha do nome, à direita; nome longo → linha de baixo sem cortar/empurrar foto; máx. 2
- ✅ Prioridade: Mais vendido (vermelho, fogo branco, automático) > Combo especial (roxo) > Oferta limitada (rosa, migra Edição limitada) > Novidade
- ✅ Utilitárias abaixo da descrição, acima do preço: Serve até X (singular/plural) · Item promocional · Tag personalizada (preta/azul, 24 caracteres, sem quebra)
- ✅ Sem duplicadas; sem tags = layout de hoje
- ✅ Mesmo sistema em lista, destaques (só 1 de topo sobre a foto, canto sup. esq.), busca e modal

## 3. Preço com desconto
- ✅ Original cinza claro riscado menor em cima; atual + pílula verde com ticket "-25%"
- ✅ "A partir de" mantém a regra
- ✅ Lista, destaques, busca, modal e sacola (original riscado)

## 4. Admin (Cardápio › editar produto)
- ✅ Seção "Etiquetas do produto" com prévia ao vivo (componentes da vitrine)
- ✅ Mais vendido automático (explica a regra, mostra se está ativo agora)
- ✅ Combo especial · Oferta limitada · Item promocional (liga/desliga)
- ✅ Serve até X: liga/desliga + − / + (1–20, padrão 2), texto ao vivo
- ✅ Tag personalizada: liga/desliga + texto (24, contador) + cor Preta/Azul
- ✅ Aviso de mais de 2 tags de topo
- ✅ Salvar com toast; migration + rollback; migração sem perda (Favorito → automático, Edição limitada → Oferta limitada)
- ✅ Isolamento por loja e permissão de editar cardápio (servidor/banco)

## 5. Fonte e layout únicos
- ✅ Fonte definida uma vez na raiz da vitrine, herança em inputs/botões/selects
- ✅ Escala tipográfica única (tokens) igual home/Revisar
- ✅ Sacola, entrega/retirada, endereço, pagamento (troco/Pix), cupons, login/código, acompanhamento, Pedidos, Cupons, Perfil, modal do produto, erros — layout do Revisar (cards, ícone em quadrado, botão verde fixo com valor)
- ✅ Script Playwright 390 px listando font-family de todos os textos visíveis (nenhuma outra fonte)

## 5.1 Tela cheia no celular
- ✅ A) Rolagem do documento (sem container de altura fixa), dvh/svh
- ✅ B) Menu da vitrine some ao rolar para baixo e volta ao subir/fim; sacola e WhatsApp acompanham; checkout sem menu e botão sempre visível
- ✅ B) viewport-fit=cover + safe-area; theme-color (inclusive escuro)
- ✅ C) Manifesto por loja (standalone, start_url, nome/ícone/cor) + meta iOS
- ✅ C) Convite de instalar (Android beforeinstallprompt; dica iOS), 1×/semana, nunca no checkout, nunca para instalado/dispensado; links externos fora do app
- ⚠️ D) Fullscreen API no Android: avaliada e NÃO implementada (motivo no relatório)
- ⚠️ E) Emulação por navegador 30/30 (quadros parado/descendo/subindo/checkout); antes = foto do usuário (caso-chrome-iphone-3-barras.jpeg); aparelho real/BrowserStack não feito

## 6. Testes
- ✅ Produtos TESTE na Menuzia (cada tag, várias de topo, topo+utilitárias, Serve 1 e 10, personalizada preta/azul no limite, nome longo, desconto, desconto+tags, A partir de, sem tags)
- ✅ Prints 360/390/414/desktop (lista, destaques, busca, modal, sacola) + lado a lado REF-TAGS × resultado e REF-CORES × resultado
- ✅ Checkout inteiro 390 px entrega e retirada com prints por etapa
- ✅ Unitários: prioridade/limite, singular/plural, desconto, migração, validação da personalizada
- ✅ Regressão: checkout, pedidos, cupons, impressão

## 7. Publicação
- ✅ Backup + migration + deploy (00:00–10:00) + conferência na Menuzia; rollback se falhar
- ✅ Ocultar produtos TESTE da Menuzia
- ✅ Relatório docs/vitrine-tags/relatorio.md

## Registro
- 02:45 início; referências copiadas.
