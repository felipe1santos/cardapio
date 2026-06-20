-- Cor de marca do cardápio do cliente: chave de paleta (ex: 'azul', 'laranja')
-- ou cor hexadecimal customizada (ex: '#FF5733').
alter table restaurantes
  add column cor_tema text not null default 'azul';
