# Repaginação — referências observadas (2026-10-01)

Regra de identidade: copiamos **estrutura, organização e comportamento**; a cara é da Menuzia
(azul `#0688D4` no lugar do roxo, Inter, cantos de 3–6 px, ícones lucide). Nada de logo, nome,
texto de marca ou ícone proprietário da referência.

## 1. Portal de referência — Cardápio › Produtos (só observado, nada salvo)

### Lista de categorias (coluna/linhas)
- Linha de categoria com ~49 px de altura, texto 14/600.
- **Hover**: fundo cinza bem claro; aparecem à esquerda o ícone de arrastar (↕ / pontilhado) e à direita
  o menu ⋮. Fora do hover, só nome e contagem.
- **Selecionada**: barra colorida de 3 px na borda esquerda + texto na cor de marca.

### Cartão/linha de produto
- **Hover**: fundo levemente acinzentado, borda um pouco mais escura; as ações (editar, pausar, ⋮)
  ficam visíveis. Transição curta (~150 ms).

### Modal "Editar produto" (aberto e fechado com Cancelar, sem alterações)
- Largura ~650 px, cabeçalho com abas **INFORMAÇÕES / COMPLEMENTOS / DISPONIBILIDADE** e X.
- Coluna esquerda: foto grande com "Remover imagem" e caixa "+" para fotos extras.
- Coluna direita, campos com **rótulo flutuante** (o rótulo vive na borda do campo):
  - Nome do produto
  - Categoria + Etiqueta (selects) e toggle **Destaque**
  - Preço de venda + Preço promocional e toggle **Promocional**
  - "Personalizar dia/hora para promoção" (recolhível)
  - Preço de custo + toggle "Custo automático pela ficha técnica"
  - Código PDV + Código interno
  - Descrição (textarea) com dica de formatação
  - "Configurações avançadas" (recolhível)
- Rodapé fixo: CANCELAR / SALVAR, os dois desabilitados enquanto nada mudou.

## 2. Portal de referência — Administrativo › Usuários
Não foi possível observar: a extensão do navegador perdeu acesso à aba do portal (três tentativas,
"Couldn't determine which page"). Não insisti — a especificação da tarefa já descreve a lista
(busca, "+ Adicionar usuário", colunas, ícones de ação) e o modal de duas colunas
(Informações do usuário | Permissões com cartões e toggles, rodapé fixo). A implementação segue a
especificação.

## 3. Prints enviados (docs/referencias/repaginacao/)
| Arquivo | Uso |
|---|---|
| `…143941.png` | Campanhas › Visão geral: filtro de período com ‹ ›, cartões de métrica com ícone em círculo colorido e (?), gráfico, tabela de envios |
| `…143859.png` | Agendamentos: busca, "+ Filtro", contadores clicáveis, tabela com miniatura, ações, "Registros por página" |
| `…144223.png` | Mensagens automáticas: cartão por etapa com toggle, badge Ativo/Inativo, texto com variáveis destacadas, Editar |
| `…144423.png` | Página de configuração com submenu vertical à esquerda |
| `…143301.png` | Estilo de cartão (borda fina, cabeçalho com ícone, respiro) |
| `…144019.png` | Gráfico de barras |

## 4. O que foi tirado de cada print (Fase 2)
- **143941/143859**: cabeçalho com título + (?) e, à direita, "Boas práticas" (contorno) e "Disparar mensagem" (cheio). Na Menuzia: azul #0688D4 no lugar do roxo, botões em caixa normal (padrão do painel) e o "Ligado/Desligado" virou um selo clicável que leva às mensagens automáticas.
- **143941**: cartões com ícone em círculo de cor clara e (?) ao lado do rótulo; linha de 4 indicadores numa faixa única; tabela com ordenação; vazio com ilustração + período. A ilustração é desenho próprio (megafone).
- **143859**: contadores "0 Ativas / 1 Processadas / 1 Canceladas" em pílula dupla (número + rótulo) que filtram; ações por ícone; "Registros por página".
- **144223**: cartão por etapa com toggle e selo Ativo; texto com {variáveis} em destaque; "Mensagem padrão"; Editar. A parte da API oficial da Meta não se aplica (a Menuzia usa a instância própria) e virou o aviso de WhatsApp conectado/desconectado.
- **144423**: submenu vertical à esquerda — reaproveitado o SubmenuVertical que já existe em Ajustes/Fidelidade.
- **143301**: cartão com bolha de ícone + título + subtítulo (Modelos, Boas práticas).
- **144019**: barras horizontais com valor ao lado ("Receita por campanha"); o gráfico diário usa barras verticais no mesmo azul (#2779bd, cor de gráfico do painel).
