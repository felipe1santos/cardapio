# Vitrine estilo iFood (pendência 9)

Sacola, checkout (Entrega → Pagamento → "Revise o seu pedido"), ficha do produto e selos no padrão
iFood, mais tamanho da imagem da lista (90/100/110) e fonte "Estilo iFood" (Figtree, peso até 600).

## Chave por loja: `restaurantes.vitrine_nova` (migration 0152)

- **Desligada (padrão, todas as lojas):** a página usa `app/loja/[slug]/vitrine-classica.tsx`, cópia
  exata da vitrine do main de 07/10. Selo de desconto, preço riscado, sacola e checkout continuam os de
  sempre (o `e2e-vitrine-p9` confere byte a byte e na tela).
- **Ligada:** `app/loja/[slug]/vitrine.tsx` (a nova). Em Ajustes › Apresentação aparecem o tamanho da
  imagem e a fonte; nas outras lojas, o "Imagem grande" de sempre. A Gaveta saiu da tela para todas
  (nenhuma loja usava; quem tivesse, a vitrine nova mostra como Lista).
- **Ligar/desligar** (só nós, não pelo painel):
  `update restaurantes set vitrine_nova = true where slug = 'menuzia';`
- "Pagar agora (Pix online)" só aparece com o Pix online ativo E as credenciais do Mercado Pago no
  servidor — hoje oculto em todas as lojas.

## Testes

`scripts/vitrine-p9/e2e-vitrine-p9.mjs` (liga a chave só nas lojas do teste e devolve no fim).
As suítes do checkout de hoje (larguras, celular, agendamento, pixel, fase3, origem, tags, P8, Pix)
rodam contra a vitrine clássica.

Prints: `antes-*`/`depois-*`, `e2e/`, `lado-a-lado-*.png` (iFood × Menuzia).
