-- Rollback da 0130. Perde custo/códigos e as fotos extras cadastrados depois dela; a promoção
-- volta a valer sempre (o código antigo ignora a agenda).
--
-- PRIMEIRO a função do gatilho de preço volta à versão da 0120 (ela lê as colunas da
-- agenda; apagar as colunas antes quebraria todo UPDATE de item).
create or replace function public.itens_cardapio_preco_sensivel()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and (new.preco is distinct from old.preco or new.promocao_preco is distinct from old.promocao_preco)
     and not public.auth_pode_sensivel('editar_precos') then
    raise exception 'sem_permissao_editar_precos' using errcode = '42501';
  end if;
  return new;
end $$;

drop table if exists public.itens_cardapio_gestao;
alter table public.itens_cardapio drop constraint if exists itens_cardapio_promocao_datas_check;
alter table public.itens_cardapio drop constraint if exists itens_cardapio_promocao_horas_check;
alter table public.itens_cardapio drop constraint if exists itens_cardapio_promocao_dias_check;
alter table public.itens_cardapio drop column if exists promocao_hora_fim;
alter table public.itens_cardapio drop column if exists promocao_hora_inicio;
alter table public.itens_cardapio drop column if exists promocao_dias;
alter table public.itens_cardapio drop constraint if exists itens_cardapio_imagens_extras_check;
alter table public.itens_cardapio drop column if exists imagens_extras;
