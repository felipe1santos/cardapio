-- Ciclo da seleção do cliente e idempotência do envio à cozinha.
--
-- CICLO: quando o garçom envia um lançamento com sucesso, a seleção que ele estava
-- vendo encerra — o cliente volta a ter um rascunho vazio e pode selecionar de novo.
-- Encerrar é marcar `encerrada_em`, nunca apagar: fica o histórico, e apagar em cascata
-- não teria como ser desfeito. O pedido oficial não depende da seleção em nada.
--
-- Só encerra a seleção na VERSÃO que o garçom viu (compare-and-set na aplicação). Se o
-- cliente mexeu na lista enquanto o garçom enviava, a versão mudou e a lista continua
-- aberta — é o rascunho seguinte, e não pode sumir por engano.

alter table public.selecoes_mesa add column if not exists encerrada_em timestamptz;

comment on column public.selecoes_mesa.encerrada_em is
  'Ciclo encerrado por um envio do garçom. A seleção deixa de aparecer; o aparelho ganha um rascunho novo.';

-- Um rascunho ABERTO por aparelho por sessão. As encerradas ficam de fora do índice,
-- senão o aparelho não conseguiria abrir o próximo rascunho depois do envio.
drop index if exists public.selecoes_mesa_dispositivo_unq;
create unique index if not exists selecoes_mesa_dispositivo_aberta_unq
  on public.selecoes_mesa (sessao_id, dispositivo) where encerrada_em is null;

-- IDEMPOTÊNCIA: cada lançamento carrega uma chave gerada quando o garçom começa a montá-lo.
-- Clique duplo, retry de rede ou a mesma requisição reenviada batem na mesma chave e o
-- banco recusa o segundo pedido. Único parcial: pedido antigo e de delivery não têm chave.
alter table public.pedidos add column if not exists chave_idempotencia text;

create unique index if not exists pedidos_chave_idempotencia_unq
  on public.pedidos (restaurante_id, chave_idempotencia) where chave_idempotencia is not null;

comment on column public.pedidos.chave_idempotencia is
  'Chave do lançamento. Repetir o envio devolve o mesmo pedido em vez de criar outro. Só servidor escreve.';
