-- Volta o PIN a exatamente 6 números (definição anterior à 0169). PINs de 4/5 já criados deixam de valer.
create or replace function public.usuario_definir_pin(p_usuario uuid, p_pin text)
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $function$
begin
  if p_pin !~ '^[0-9]{6}$' then raise exception 'pin_invalido' using errcode = '22023'; end if;
  if p_pin ~ '^(.)\1{5}$' or p_pin in ('123456', '654321', '012345', '543210') then raise exception 'pin_fraco' using errcode = '22023'; end if;
  update public.usuarios set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), pin_falhas = 0, pin_bloqueado_ate = null, pin_definido_em = now()
   where id = p_usuario;
end $function$;

create or replace function public.usuario_verificar_pin(p_restaurante uuid, p_usuario uuid, p_pin text)
returns text language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare u public.usuarios%rowtype;
begin
  select * into u from public.usuarios where id = p_usuario and restaurante_id = p_restaurante for update;
  if not found or u.desativado_em is not null then return 'inativo'; end if;
  if u.pin_hash is null then return 'sem_pin'; end if;
  if u.pin_bloqueado_ate is not null and u.pin_bloqueado_ate > now() then return 'bloqueado'; end if;
  if p_pin ~ '^[0-9]{6}$' and extensions.crypt(p_pin, u.pin_hash) = u.pin_hash then
    update public.usuarios set pin_falhas = 0, pin_bloqueado_ate = null where id = p_usuario;
    return 'ok';
  end if;
  update public.usuarios set pin_falhas = u.pin_falhas + 1,
         pin_bloqueado_ate = case when u.pin_falhas + 1 >= 5 then now() + interval '15 minutes' else null end
   where id = p_usuario;
  return case when u.pin_falhas + 1 >= 5 then 'bloqueado' else 'errado' end;
end $function$;
