-- Canal do pedido — a fronteira entre delivery, salão e balcão.
--
-- `comanda_id is not null` NÃO serve como fronteira de segurança: até o checkpoint S
-- qualquer um podia inserir pedido com comanda_id arbitrário, e pedido legado pode ter
-- combinações estranhas. A RLS do garçom precisa de um discriminador que só o servidor
-- escreve.
--
-- `canal` fica fora de todo grant de escrita do navegador (ver 0060): quem define é
-- exclusivamente o código de servidor que cria o pedido.

alter table public.pedidos
  add column if not exists canal text not null default 'delivery';

alter table public.pedidos
  drop constraint if exists pedidos_canal_check;
alter table public.pedidos
  add constraint pedidos_canal_check check (canal in ('delivery', 'mesa', 'balcao'));

-- Backfill determinístico. Coluna nova, nenhum código lê `canal` ainda — não há
-- conversão de formato de dado existente aqui (a lição da 0047 continua valendo).
update public.pedidos set canal =
  case
    when origem = 'pdv' and comanda_id is not null then 'mesa'
    when origem = 'pdv'                            then 'balcao'
    else 'delivery'
  end
where canal = 'delivery';

-- Pedido de mesa exige comanda. Pedido público malformado ou legado com comanda_id mas
-- origem='cardapio' fica 'delivery' pelo backfill e NÃO passa a ser visível ao garçom.
alter table public.pedidos
  drop constraint if exists pedidos_canal_mesa_exige_comanda;
alter table public.pedidos
  add constraint pedidos_canal_mesa_exige_comanda
  check (canal <> 'mesa' or comanda_id is not null);

comment on column public.pedidos.canal is
  'delivery | mesa | balcao. Server-authoritative: nunca aceito do navegador.';
