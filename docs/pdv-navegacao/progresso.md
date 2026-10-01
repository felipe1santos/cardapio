# PDV e Mesas — navegação sem telas empilhadas + telas maiores (2026-10-01)

Branch `feat/pdv-navegacao`. Sem mudar lógica de negócio (valores, fechamento, permissões, impressão,
caixa). Mantém o retoque visual (barra de ações, fechar em etapas, pagamento em duas colunas).
Deploy só 00:00–10:00 (início às 11:03 → publicação a partir da meia-noite).
Legenda: ⬜ a fazer · 🔧 em andamento · ✅ feito e testado · 🚀 no ar · ⚠️ ressalva

## 1. Uma tela por vez
- ✅ Controlador único de pilha (Mesas, Comandas, Balcão, PDV): só a tela da frente visível
- ✅ "← Voltar" volta à tela de trás exatamente como estava (rolagem, digitação, seleção)
- ✅ Caminho no cabeçalho com o identificador ("Mesa 04 · Comanda 26 · ul › Receber")
- ✅ Voltar por Esc, voltar do Android/navegador (histórico) e gesto
- ✅ "X" fecha a pilha; confirma só com dado não salvo
- ✅ Ação concluída volta à anterior com toast; "Registrar e fechar" volta às mesas com toast
- ✅ Confirmações simples dentro da própria tela (sem modal por cima)
- ✅ Transição ~150 ms (transform/opacity), sem animação com reduzir movimento

## 2. Telas maiores
- ✅ ~90% × 90% (máx. 1200 px) no desktop/tablet; tela cheia no celular
- ✅ Conteúdo com rolagem própria e barra de ações sempre fixa embaixo
- ✅ Itens com foto, resumo em destaque, restante sempre visível (mantido do retoque)

## 3. Botões maiores com ícones
- ✅ Toque ≥ 48×48, principais 56–64 px, 8 px entre botões
- ✅ Todo botão com ícone + texto (mesmo estilo)
- ✅ Formas de pagamento grandes com ícone, selecionada destacada (cor + check)
- ✅ Receber: teclado numérico, atalhos (Valor exato, R$ 50/100/200), troco grande
- ✅ Hierarquia: 1 principal forte, secundárias em contorno, destrutiva vermelha separada

## 4. Textos
- ✅ Sem textos técnicos para o operador
- ✅ Rótulos curtos, valores grandes; erros que dizem o que fazer

## 5. Inventário
- ✅ Todos os modais de Mesas, Comandas, Balcão e PDV listados no relatório com o que virou

## 6. Testes
- ✅ Mesa → Conta → Receber → Voltar → Fechar → etapas → Pagamento → concluir (mesas + toast)
- ✅ Balcão → Pedido → Receber e fechar · PDV pagamento dividido
- ✅ Voltar por botão/Esc/navegador; dados preservados; X confirma só com dado não salvo
- ✅ 1024×768, 1280×800, 1366×768, 1920×1080 e celular; barra sempre visível
- ✅ Regressão (valores, taxas, troco, pagamentos, fechamento, pré-conta, caixa, permissões)
- ✅ Prints antes/depois em docs/pdv-navegacao/prints/

## 7. Publicação
- ⬜ Deploy 00:00–10:00 + conferência em produção (painel com o dono logado) · TESTE removidos · relatório

## Registro
- 11:03 início (fora da janela de deploy).
- ~12:40 tudo implementado e testado (e2e novo 30/30 + 15 suítes + unitários verdes); prints em
  `prints/antes` e `prints/depois` (5 resoluções); relatório em `relatorio.md`. Branch
  `feat/pdv-navegacao` commitada; **publicação aguardando a janela 00:00–10:00**.
