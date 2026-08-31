-- DDL — schema public
-- Projeto Supabase: nclnxmdvxmrzrkqystka (Menuzia)
-- Gerado em: 2026-08-31T10:44:07.890Z
-- Backup de ROLLBACK. Restaurar apenas sob decisão explícita.

BEGIN;

CREATE SCHEMA IF NOT EXISTS public;

-- ─── Tipos enumerados ───────────────────────────────────────────
CREATE TYPE public.forma_pagamento AS ENUM ('pix', 'cartao', 'dinheiro');
CREATE TYPE public.papel_usuario AS ENUM ('dono', 'atendente', 'cozinha', 'logistica', 'entregador');
CREATE TYPE public.status_entregador AS ENUM ('online', 'ocupado', 'offline');
CREATE TYPE public.status_item_cardapio AS ENUM ('disponivel', 'pausado', 'esgotado');
CREATE TYPE public.status_pedido AS ENUM ('recebido', 'preparando', 'pronto', 'em_rota', 'entregue', 'cancelado');
CREATE TYPE public.tipo_item_cardapio AS ENUM ('simples', 'pizza', 'marmita');
CREATE TYPE public.tipo_pedido AS ENUM ('entrega', 'retirada');

-- ─── Tabelas ────────────────────────────────────────────────────
CREATE TABLE public.bordas_pizza (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  preco numeric(10,2) NOT NULL DEFAULT 0,
  posicao integer NOT NULL DEFAULT 0
);

CREATE TABLE public.campanha_envios (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL,
  restaurante_id uuid NOT NULL,
  telefone text NOT NULL,
  nome_cliente text NOT NULL DEFAULT ''::text,
  status text NOT NULL DEFAULT 'pendente'::text,
  erro text,
  enviado_em timestamp with time zone,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.campanhas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho'::text,
  tipo_mensagem text NOT NULL DEFAULT 'texto'::text,
  mensagem text NOT NULL DEFAULT ''::text,
  imagem_url text,
  audio_url text,
  filtro jsonb NOT NULL DEFAULT '{}'::jsonb,
  agendado_em timestamp with time zone,
  total_destinatarios integer NOT NULL DEFAULT 0,
  total_enviados integer NOT NULL DEFAULT 0,
  total_erros integer NOT NULL DEFAULT 0,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.campanhas_fidelidade (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  descricao text NOT NULL DEFAULT ''::text,
  ativa boolean NOT NULL DEFAULT true,
  tipo_meta text NOT NULL,
  meta_valor numeric(10,2),
  meta_quantidade integer,
  dias_semana_contam smallint[] NOT NULL DEFAULT '{}'::smallint[],
  dias_semana_resgate smallint[] NOT NULL DEFAULT '{}'::smallint[],
  premio_tipo text NOT NULL,
  premio_item_id uuid,
  premio_valor numeric(10,2),
  repetivel boolean NOT NULL DEFAULT true,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT campanhas_fidelidade_premio_tipo_check CHECK ((premio_tipo = ANY (ARRAY['item_gratis'::text, 'desconto_percentual'::text, 'desconto_valor'::text, 'entrega_gratis'::text]))),
  CONSTRAINT campanhas_fidelidade_tipo_meta_check CHECK ((tipo_meta = ANY (ARRAY['valor_gasto'::text, 'qtd_pedidos'::text, 'qtd_itens'::text])))
);

CREATE TABLE public.cliente_codigos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  telefone text NOT NULL,
  codigo text NOT NULL,
  tentativas integer NOT NULL DEFAULT 0,
  expira_em timestamp with time zone NOT NULL,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.clientes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  telefone text NOT NULL,
  nome text NOT NULL DEFAULT ''::text,
  endereco_rua text NOT NULL DEFAULT ''::text,
  endereco_numero text NOT NULL DEFAULT ''::text,
  endereco_complemento text NOT NULL DEFAULT ''::text,
  endereco_bairro text NOT NULL DEFAULT ''::text,
  endereco_cep text NOT NULL DEFAULT ''::text,
  token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'::text),
  verificado_em timestamp with time zone,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  sexo text NOT NULL DEFAULT ''::text,
  CONSTRAINT clientes_sexo_check CHECK ((sexo = ANY (ARRAY[''::text, 'M'::text, 'F'::text])))
);

CREATE TABLE public.comandas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  mesa_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'aberta'::text,
  aberta_em timestamp with time zone NOT NULL DEFAULT now(),
  fechada_em timestamp with time zone
);

CREATE TABLE public.config_plataforma (
  id integer NOT NULL DEFAULT 1,
  cadastro_automatico boolean NOT NULL DEFAULT false,
  cadastro_automatico_dias integer NOT NULL DEFAULT 30,
  CONSTRAINT config_plataforma_id_check CHECK ((id = 1))
);

CREATE TABLE public.cupom_usos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  cupom_id uuid NOT NULL,
  restaurante_id uuid NOT NULL,
  cliente_telefone text NOT NULL,
  pedido_id uuid NOT NULL,
  usado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.cupons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  codigo text NOT NULL,
  descricao text NOT NULL DEFAULT ''::text,
  ativo boolean NOT NULL DEFAULT true,
  tipo text NOT NULL,
  valor numeric(10,2),
  item_id uuid,
  publico text NOT NULL DEFAULT 'todos'::text,
  dias_inatividade integer,
  dias_semana smallint[] NOT NULL DEFAULT '{}'::smallint[],
  validade_inicio date,
  validade_fim date,
  valor_minimo_pedido numeric(10,2),
  uso_unico_por_cliente boolean NOT NULL DEFAULT true,
  max_usos integer,
  usos integer NOT NULL DEFAULT 0,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT cupons_publico_check CHECK ((publico = ANY (ARRAY['todos'::text, 'primeira_compra'::text, 'recompra'::text]))),
  CONSTRAINT cupons_tipo_check CHECK ((tipo = ANY (ARRAY['desconto_percentual'::text, 'desconto_valor'::text, 'entrega_gratis'::text, 'item_gratis'::text])))
);

CREATE TABLE public.entregadores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  telefone text NOT NULL DEFAULT ''::text,
  status status_entregador NOT NULL DEFAULT 'offline'::status_entregador,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  ultimo_acesso_em timestamp with time zone,
  localizacao_lat double precision,
  localizacao_lng double precision,
  localizacao_atualizada_em timestamp with time zone,
  foto_url text,
  veiculo text NOT NULL DEFAULT ''::text,
  placa text NOT NULL DEFAULT ''::text
);

CREATE TABLE public.estacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  modo text NOT NULL,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  ativo boolean NOT NULL DEFAULT true,
  ultimo_visto_em timestamp with time zone,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.fechamentos_caixa (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  entregador_id uuid NOT NULL,
  valor_esperado numeric(10,2) NOT NULL DEFAULT 0,
  troco_levado numeric(10,2) NOT NULL DEFAULT 0,
  valor_declarado numeric(10,2) NOT NULL DEFAULT 0,
  diferenca numeric(10,2) NOT NULL DEFAULT 0,
  observacao text NOT NULL DEFAULT ''::text,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  fechado_em timestamp with time zone
);

CREATE TABLE public.fidelidade_progresso (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  campanha_id uuid NOT NULL,
  cliente_telefone text NOT NULL,
  progresso_valor numeric(10,2) NOT NULL DEFAULT 0,
  progresso_qtd integer NOT NULL DEFAULT 0,
  ciclos_completados integer NOT NULL DEFAULT 0,
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.fidelidade_recompensas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  campanha_id uuid NOT NULL,
  cliente_telefone text NOT NULL,
  status text NOT NULL DEFAULT 'disponivel'::text,
  pedido_resgate_id uuid,
  ganho_em timestamp with time zone NOT NULL DEFAULT now(),
  resgatado_em timestamp with time zone,
  CONSTRAINT fidelidade_recompensas_status_check CHECK ((status = ANY (ARRAY['disponivel'::text, 'resgatado'::text, 'cancelado'::text])))
);

CREATE TABLE public.grupos_cardapio (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  posicao integer NOT NULL DEFAULT 0,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  horario_ativo_inicio time without time zone,
  horario_ativo_fim time without time zone
);

CREATE TABLE public.grupos_item_complementos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  preset_origem_id uuid,
  nome text NOT NULL,
  obrigatorio boolean NOT NULL DEFAULT false,
  min_escolhas integer NOT NULL DEFAULT 0,
  max_escolhas integer NOT NULL DEFAULT 1,
  posicao integer NOT NULL DEFAULT 0,
  permite_quantidade boolean NOT NULL DEFAULT false
);

CREATE TABLE public.impressoras (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  fabricante text NOT NULL DEFAULT ''::text,
  impressora_sistema text NOT NULL DEFAULT ''::text,
  tamanho_fonte text NOT NULL DEFAULT 'pequena'::text,
  largura integer NOT NULL DEFAULT 48,
  copias integer NOT NULL DEFAULT 1,
  ativa boolean NOT NULL DEFAULT true,
  posicao integer NOT NULL DEFAULT 0,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.item_complementos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  nome text NOT NULL,
  preco numeric(10,2) NOT NULL DEFAULT 0,
  posicao integer NOT NULL DEFAULT 0,
  preset_origem_id uuid,
  grupo_id uuid,
  imagem_url text,
  pausado boolean NOT NULL DEFAULT false
);

CREATE TABLE public.itens_cardapio (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  grupo_id uuid,
  nome text NOT NULL,
  descricao text NOT NULL DEFAULT ''::text,
  preco numeric(10,2) NOT NULL DEFAULT 0,
  imagem_url text,
  status status_item_cardapio NOT NULL DEFAULT 'disponivel'::status_item_cardapio,
  dias_disponiveis smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}'::smallint[],
  promocao_preco numeric(10,2),
  promocao_inicio date,
  promocao_fim date,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  mais_vendido boolean NOT NULL DEFAULT false,
  tipo_item tipo_item_cardapio NOT NULL DEFAULT 'simples'::tipo_item_cardapio,
  tag text
);

CREATE TABLE public.massas_pizza (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  preco numeric(10,2) NOT NULL DEFAULT 0,
  posicao integer NOT NULL DEFAULT 0
);

CREATE TABLE public.mesas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.nexta_config (
  restaurante_id uuid NOT NULL,
  ativo boolean NOT NULL DEFAULT false,
  base_url text NOT NULL DEFAULT ''::text,
  client_id text NOT NULL DEFAULT ''::text,
  client_secret text NOT NULL DEFAULT ''::text,
  merchant_id text NOT NULL DEFAULT ''::text,
  merchant_name text NOT NULL DEFAULT ''::text,
  cnpj text NOT NULL DEFAULT ''::text,
  webhook_token text NOT NULL DEFAULT (gen_random_uuid())::text,
  pickup_rua text NOT NULL DEFAULT ''::text,
  pickup_numero text NOT NULL DEFAULT ''::text,
  pickup_complemento text NOT NULL DEFAULT ''::text,
  pickup_bairro text NOT NULL DEFAULT ''::text,
  pickup_cidade text NOT NULL DEFAULT ''::text,
  pickup_uf text NOT NULL DEFAULT ''::text,
  pickup_cep text NOT NULL DEFAULT ''::text,
  pickup_latitude double precision,
  pickup_longitude double precision,
  vehicle_type text NOT NULL DEFAULT 'MOTORBIKE_BAG'::text,
  container text NOT NULL DEFAULT 'THERMIC'::text,
  container_size text NOT NULL DEFAULT 'MEDIUM'::text,
  pickup_limit_min integer NOT NULL DEFAULT 30,
  delivery_limit_min integer NOT NULL DEFAULT 60,
  limit_times_as_datetime boolean NOT NULL DEFAULT false,
  peso_padrao_g integer NOT NULL DEFAULT 1500,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.nexta_entregas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  pedido_id uuid NOT NULL,
  delivery_id text,
  status text NOT NULL DEFAULT 'PENDING'::text,
  preco numeric(10,2),
  cotacao jsonb,
  eta_coleta timestamp with time zone,
  eta_entrega timestamp with time zone,
  entregador_nome text,
  entregador_telefone text,
  entregador_foto_url text,
  tracking_url text,
  rejeicao_motivo text,
  problema jsonb,
  eventos jsonb NOT NULL DEFAULT '[]'::jsonb,
  cancel_additional_charges boolean,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.order_bumps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  item_id uuid NOT NULL,
  posicao integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.pedido_itens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL,
  item_id uuid,
  nome text NOT NULL,
  preco_unitario numeric(10,2) NOT NULL DEFAULT 0,
  quantidade integer NOT NULL DEFAULT 1,
  observacao text NOT NULL DEFAULT ''::text,
  complementos jsonb NOT NULL DEFAULT '[]'::jsonb,
  tamanho_nome text NOT NULL DEFAULT ''::text,
  sabor_nome text NOT NULL DEFAULT ''::text,
  borda_nome text NOT NULL DEFAULT ''::text,
  massa_nome text NOT NULL DEFAULT ''::text
);

CREATE TABLE public.pedidos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  numero integer NOT NULL DEFAULT 0,
  tipo tipo_pedido NOT NULL DEFAULT 'entrega'::tipo_pedido,
  status status_pedido NOT NULL DEFAULT 'recebido'::status_pedido,
  cliente_nome text NOT NULL DEFAULT ''::text,
  cliente_telefone text NOT NULL DEFAULT ''::text,
  endereco_rua text NOT NULL DEFAULT ''::text,
  endereco_numero text NOT NULL DEFAULT ''::text,
  endereco_complemento text NOT NULL DEFAULT ''::text,
  endereco_bairro text NOT NULL DEFAULT ''::text,
  endereco_cep text NOT NULL DEFAULT ''::text,
  forma_pagamento forma_pagamento NOT NULL DEFAULT 'pix'::forma_pagamento,
  troco_para numeric(10,2),
  pago boolean NOT NULL DEFAULT false,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  taxa_entrega numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  observacao text NOT NULL DEFAULT ''::text,
  entregador_id uuid,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  impresso boolean NOT NULL DEFAULT false,
  reimprimir boolean NOT NULL DEFAULT false,
  preparando_por text,
  preparado_por text,
  telefone_verificado boolean NOT NULL DEFAULT true,
  preparando_notificado boolean NOT NULL DEFAULT false,
  origem text NOT NULL DEFAULT 'cardapio'::text,
  mesa text,
  comanda_id uuid,
  cupom_codigo text,
  desconto numeric(10,2) NOT NULL DEFAULT 0,
  recompensa_id uuid,
  fidelidade_processado boolean NOT NULL DEFAULT false,
  nexta_entrega_id uuid,
  entrega_latitude double precision,
  entrega_longitude double precision,
  cancelado_motivo text,
  cancelado_observacao text,
  cancelado_por text,
  cancelado_em timestamp with time zone
);

CREATE TABLE public.pizza_sabor_precos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sabor_id uuid NOT NULL,
  tamanho_padrao_id uuid NOT NULL,
  preco numeric(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE public.pizza_sabores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  nome text NOT NULL,
  descricao text NOT NULL DEFAULT ''::text,
  imagem_url text,
  status status_item_cardapio NOT NULL DEFAULT 'disponivel'::status_item_cardapio,
  posicao integer NOT NULL DEFAULT 0
);

CREATE TABLE public.preset_complemento_itens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  preset_id uuid NOT NULL,
  nome text NOT NULL,
  preco numeric(10,2) NOT NULL DEFAULT 0,
  posicao integer NOT NULL DEFAULT 0,
  imagem_url text,
  pausado boolean NOT NULL DEFAULT false
);

CREATE TABLE public.presets_complementos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  obrigatorio boolean NOT NULL DEFAULT false,
  min_escolhas integer NOT NULL DEFAULT 0,
  max_escolhas integer NOT NULL DEFAULT 1,
  permite_quantidade boolean NOT NULL DEFAULT false,
  pausado boolean NOT NULL DEFAULT false
);

CREATE TABLE public.restaurantes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  slug text NOT NULL,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  logo_url text,
  telefone text NOT NULL DEFAULT ''::text,
  endereco text NOT NULL DEFAULT ''::text,
  taxa_entrega_padrao numeric(10,2) NOT NULL DEFAULT 0,
  facebook_pixel_id text,
  google_tag_id text,
  order_bump_max integer NOT NULL DEFAULT 4,
  layout_cardapio text NOT NULL DEFAULT 'categoria'::text,
  banner_url text,
  evolution_instance text,
  impressao_mostrar_numero_item boolean NOT NULL DEFAULT true,
  impressao_mostrar_preco_complementos boolean NOT NULL DEFAULT true,
  impressao_mostrar_nome_complementos boolean NOT NULL DEFAULT true,
  impressao_fonte_maior_producao boolean NOT NULL DEFAULT false,
  impressao_multiplicar_opcoes_qtd boolean NOT NULL DEFAULT false,
  impressao_logo boolean NOT NULL DEFAULT true,
  impressao_comprovante_cancelamento boolean NOT NULL DEFAULT false,
  impressao_qrcode_avaliacao boolean NOT NULL DEFAULT true,
  impressao_ativar_assistente boolean NOT NULL DEFAULT false,
  impressao_automatica boolean NOT NULL DEFAULT false,
  impressao_aceitar_pedidos_automaticamente boolean NOT NULL DEFAULT false,
  impressao_agente_token uuid,
  cor_tema text NOT NULL DEFAULT 'azul'::text,
  imagem_grande boolean NOT NULL DEFAULT false,
  cep text NOT NULL DEFAULT ''::text,
  despacho_aberto boolean NOT NULL DEFAULT false,
  impressao_agente_impressora_id uuid,
  impressao_agente_visto_em timestamp with time zone,
  latitude double precision,
  longitude double precision,
  frete_gratis_acima numeric(10,2),
  horario_funcionamento jsonb,
  status_loja text NOT NULL DEFAULT 'automatico'::text,
  endereco_rua text,
  endereco_numero text,
  endereco_complemento text,
  endereco_bairro text,
  endereco_cidade text,
  endereco_estado text,
  avaliacao_nota numeric(2,1),
  avaliacao_qtd integer,
  banner_promocional_url text,
  CONSTRAINT restaurantes_layout_cardapio_check CHECK ((layout_cardapio = ANY (ARRAY['categoria'::text, 'lista'::text]))),
  CONSTRAINT restaurantes_status_loja_check CHECK ((status_loja = ANY (ARRAY['automatico'::text, 'aberto_manual'::text, 'fechado_manual'::text])))
);

CREATE TABLE public.schema_migrations (
  name text NOT NULL,
  aplicada_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.tamanhos_item (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  nome text NOT NULL,
  preco numeric(10,2) NOT NULL DEFAULT 0,
  posicao integer NOT NULL DEFAULT 0
);

CREATE TABLE public.tamanhos_padrao_marmita (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  peso text NOT NULL DEFAULT ''::text,
  posicao integer NOT NULL DEFAULT 0
);

CREATE TABLE public.tamanhos_padrao_pizza (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  nome text NOT NULL,
  fatias integer NOT NULL DEFAULT 0,
  posicao integer NOT NULL DEFAULT 0
);

CREATE TABLE public.taxas_entrega_bairro (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  bairro text NOT NULL,
  taxa numeric(10,2) NOT NULL DEFAULT 0,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.taxas_entrega_raio (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurante_id uuid NOT NULL,
  ate_km numeric(6,2) NOT NULL,
  taxa numeric(10,2) NOT NULL DEFAULT 0,
  posicao integer NOT NULL DEFAULT 0,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.usuarios (
  id uuid NOT NULL,
  restaurante_id uuid,
  papel papel_usuario NOT NULL,
  nome text NOT NULL,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  email text NOT NULL DEFAULT ''::text,
  telefone text NOT NULL DEFAULT ''::text,
  nome_loja text NOT NULL DEFAULT ''::text,
  autorizado boolean NOT NULL DEFAULT false,
  ultimo_login_em timestamp with time zone,
  usuario text NOT NULL DEFAULT ''::text,
  acesso_expira_em timestamp with time zone,
  logins_total integer NOT NULL DEFAULT 0
);

-- ─── Chaves primárias, únicas e estrangeiras ────────────────────
ALTER TABLE public.bordas_pizza ADD CONSTRAINT bordas_pizza_pkey PRIMARY KEY (id);
ALTER TABLE public.campanha_envios ADD CONSTRAINT campanha_envios_pkey PRIMARY KEY (id);
ALTER TABLE public.campanhas ADD CONSTRAINT campanhas_pkey PRIMARY KEY (id);
ALTER TABLE public.campanhas_fidelidade ADD CONSTRAINT campanhas_fidelidade_pkey PRIMARY KEY (id);
ALTER TABLE public.cliente_codigos ADD CONSTRAINT cliente_codigos_pkey PRIMARY KEY (id);
ALTER TABLE public.clientes ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);
ALTER TABLE public.clientes ADD CONSTRAINT clientes_restaurante_id_telefone_key UNIQUE (restaurante_id, telefone);
ALTER TABLE public.comandas ADD CONSTRAINT comandas_pkey PRIMARY KEY (id);
ALTER TABLE public.config_plataforma ADD CONSTRAINT config_plataforma_pkey PRIMARY KEY (id);
ALTER TABLE public.cupom_usos ADD CONSTRAINT cupom_usos_pkey PRIMARY KEY (id);
ALTER TABLE public.cupons ADD CONSTRAINT cupons_pkey PRIMARY KEY (id);
ALTER TABLE public.cupons ADD CONSTRAINT cupons_restaurante_id_codigo_key UNIQUE (restaurante_id, codigo);
ALTER TABLE public.entregadores ADD CONSTRAINT entregadores_pkey PRIMARY KEY (id);
ALTER TABLE public.estacoes ADD CONSTRAINT estacoes_pkey PRIMARY KEY (id);
ALTER TABLE public.estacoes ADD CONSTRAINT estacoes_token_key UNIQUE (token);
ALTER TABLE public.fechamentos_caixa ADD CONSTRAINT fechamentos_caixa_pkey PRIMARY KEY (id);
ALTER TABLE public.fidelidade_progresso ADD CONSTRAINT fidelidade_progresso_pkey PRIMARY KEY (id);
ALTER TABLE public.fidelidade_progresso ADD CONSTRAINT fidelidade_progresso_campanha_id_cliente_telefone_key UNIQUE (campanha_id, cliente_telefone);
ALTER TABLE public.fidelidade_recompensas ADD CONSTRAINT fidelidade_recompensas_pkey PRIMARY KEY (id);
ALTER TABLE public.grupos_cardapio ADD CONSTRAINT grupos_cardapio_pkey PRIMARY KEY (id);
ALTER TABLE public.grupos_item_complementos ADD CONSTRAINT grupos_item_complementos_pkey PRIMARY KEY (id);
ALTER TABLE public.impressoras ADD CONSTRAINT impressoras_pkey PRIMARY KEY (id);
ALTER TABLE public.item_complementos ADD CONSTRAINT item_complementos_pkey PRIMARY KEY (id);
ALTER TABLE public.itens_cardapio ADD CONSTRAINT itens_cardapio_pkey PRIMARY KEY (id);
ALTER TABLE public.massas_pizza ADD CONSTRAINT massas_pizza_pkey PRIMARY KEY (id);
ALTER TABLE public.mesas ADD CONSTRAINT mesas_pkey PRIMARY KEY (id);
ALTER TABLE public.nexta_config ADD CONSTRAINT nexta_config_pkey PRIMARY KEY (restaurante_id);
ALTER TABLE public.nexta_config ADD CONSTRAINT nexta_config_webhook_token_key UNIQUE (webhook_token);
ALTER TABLE public.nexta_entregas ADD CONSTRAINT nexta_entregas_pkey PRIMARY KEY (id);
ALTER TABLE public.order_bumps ADD CONSTRAINT order_bumps_pkey PRIMARY KEY (id);
ALTER TABLE public.order_bumps ADD CONSTRAINT order_bumps_restaurante_id_item_id_key UNIQUE (restaurante_id, item_id);
ALTER TABLE public.pedido_itens ADD CONSTRAINT pedido_itens_pkey PRIMARY KEY (id);
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_pkey PRIMARY KEY (id);
ALTER TABLE public.pizza_sabor_precos ADD CONSTRAINT pizza_sabor_precos_pkey PRIMARY KEY (id);
ALTER TABLE public.pizza_sabor_precos ADD CONSTRAINT pizza_sabor_precos_sabor_id_tamanho_padrao_id_key UNIQUE (sabor_id, tamanho_padrao_id);
ALTER TABLE public.pizza_sabores ADD CONSTRAINT pizza_sabores_pkey PRIMARY KEY (id);
ALTER TABLE public.preset_complemento_itens ADD CONSTRAINT preset_complemento_itens_pkey PRIMARY KEY (id);
ALTER TABLE public.presets_complementos ADD CONSTRAINT presets_complementos_pkey PRIMARY KEY (id);
ALTER TABLE public.restaurantes ADD CONSTRAINT restaurantes_pkey PRIMARY KEY (id);
ALTER TABLE public.restaurantes ADD CONSTRAINT restaurantes_slug_key UNIQUE (slug);
ALTER TABLE public.schema_migrations ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);
ALTER TABLE public.tamanhos_item ADD CONSTRAINT tamanhos_item_pkey PRIMARY KEY (id);
ALTER TABLE public.tamanhos_padrao_marmita ADD CONSTRAINT tamanhos_padrao_marmita_pkey PRIMARY KEY (id);
ALTER TABLE public.tamanhos_padrao_pizza ADD CONSTRAINT tamanhos_padrao_pizza_pkey PRIMARY KEY (id);
ALTER TABLE public.taxas_entrega_bairro ADD CONSTRAINT taxas_entrega_bairro_pkey PRIMARY KEY (id);
ALTER TABLE public.taxas_entrega_raio ADD CONSTRAINT taxas_entrega_raio_pkey PRIMARY KEY (id);
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);

ALTER TABLE public.bordas_pizza ADD CONSTRAINT bordas_pizza_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.campanha_envios ADD CONSTRAINT campanha_envios_campanha_id_fkey FOREIGN KEY (campanha_id) REFERENCES campanhas(id) ON DELETE CASCADE;
ALTER TABLE public.campanha_envios ADD CONSTRAINT campanha_envios_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.campanhas ADD CONSTRAINT campanhas_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.campanhas_fidelidade ADD CONSTRAINT campanhas_fidelidade_premio_item_id_fkey FOREIGN KEY (premio_item_id) REFERENCES itens_cardapio(id) ON DELETE SET NULL;
ALTER TABLE public.campanhas_fidelidade ADD CONSTRAINT campanhas_fidelidade_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.cliente_codigos ADD CONSTRAINT cliente_codigos_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.clientes ADD CONSTRAINT clientes_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.comandas ADD CONSTRAINT comandas_mesa_id_fkey FOREIGN KEY (mesa_id) REFERENCES mesas(id) ON DELETE CASCADE;
ALTER TABLE public.comandas ADD CONSTRAINT comandas_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.cupom_usos ADD CONSTRAINT cupom_usos_cupom_id_fkey FOREIGN KEY (cupom_id) REFERENCES cupons(id) ON DELETE CASCADE;
ALTER TABLE public.cupom_usos ADD CONSTRAINT cupom_usos_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
ALTER TABLE public.cupom_usos ADD CONSTRAINT cupom_usos_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.cupons ADD CONSTRAINT cupons_item_id_fkey FOREIGN KEY (item_id) REFERENCES itens_cardapio(id) ON DELETE SET NULL;
ALTER TABLE public.cupons ADD CONSTRAINT cupons_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.entregadores ADD CONSTRAINT entregadores_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.estacoes ADD CONSTRAINT estacoes_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.fechamentos_caixa ADD CONSTRAINT fechamentos_caixa_entregador_id_fkey FOREIGN KEY (entregador_id) REFERENCES entregadores(id) ON DELETE CASCADE;
ALTER TABLE public.fechamentos_caixa ADD CONSTRAINT fechamentos_caixa_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.fidelidade_progresso ADD CONSTRAINT fidelidade_progresso_campanha_id_fkey FOREIGN KEY (campanha_id) REFERENCES campanhas_fidelidade(id) ON DELETE CASCADE;
ALTER TABLE public.fidelidade_progresso ADD CONSTRAINT fidelidade_progresso_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.fidelidade_recompensas ADD CONSTRAINT fidelidade_recompensas_campanha_id_fkey FOREIGN KEY (campanha_id) REFERENCES campanhas_fidelidade(id) ON DELETE CASCADE;
ALTER TABLE public.fidelidade_recompensas ADD CONSTRAINT fidelidade_recompensas_pedido_resgate_id_fkey FOREIGN KEY (pedido_resgate_id) REFERENCES pedidos(id) ON DELETE SET NULL;
ALTER TABLE public.fidelidade_recompensas ADD CONSTRAINT fidelidade_recompensas_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.grupos_cardapio ADD CONSTRAINT grupos_cardapio_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.grupos_item_complementos ADD CONSTRAINT grupos_item_complementos_item_id_fkey FOREIGN KEY (item_id) REFERENCES itens_cardapio(id) ON DELETE CASCADE;
ALTER TABLE public.grupos_item_complementos ADD CONSTRAINT grupos_item_complementos_preset_origem_id_fkey FOREIGN KEY (preset_origem_id) REFERENCES presets_complementos(id) ON DELETE SET NULL;
ALTER TABLE public.impressoras ADD CONSTRAINT impressoras_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.item_complementos ADD CONSTRAINT item_complementos_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES grupos_item_complementos(id) ON DELETE CASCADE;
ALTER TABLE public.item_complementos ADD CONSTRAINT item_complementos_item_id_fkey FOREIGN KEY (item_id) REFERENCES itens_cardapio(id) ON DELETE CASCADE;
ALTER TABLE public.item_complementos ADD CONSTRAINT item_complementos_preset_origem_id_fkey FOREIGN KEY (preset_origem_id) REFERENCES presets_complementos(id) ON DELETE SET NULL;
ALTER TABLE public.itens_cardapio ADD CONSTRAINT itens_cardapio_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES grupos_cardapio(id) ON DELETE SET NULL;
ALTER TABLE public.itens_cardapio ADD CONSTRAINT itens_cardapio_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.massas_pizza ADD CONSTRAINT massas_pizza_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.mesas ADD CONSTRAINT mesas_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.nexta_config ADD CONSTRAINT nexta_config_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.nexta_entregas ADD CONSTRAINT nexta_entregas_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
ALTER TABLE public.nexta_entregas ADD CONSTRAINT nexta_entregas_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.order_bumps ADD CONSTRAINT order_bumps_item_id_fkey FOREIGN KEY (item_id) REFERENCES itens_cardapio(id) ON DELETE CASCADE;
ALTER TABLE public.order_bumps ADD CONSTRAINT order_bumps_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_itens ADD CONSTRAINT pedido_itens_item_id_fkey FOREIGN KEY (item_id) REFERENCES itens_cardapio(id) ON DELETE SET NULL;
ALTER TABLE public.pedido_itens ADD CONSTRAINT pedido_itens_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_comanda_id_fkey FOREIGN KEY (comanda_id) REFERENCES comandas(id);
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_entregador_id_fkey FOREIGN KEY (entregador_id) REFERENCES entregadores(id) ON DELETE SET NULL;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_nexta_entrega_id_fkey FOREIGN KEY (nexta_entrega_id) REFERENCES nexta_entregas(id) ON DELETE SET NULL;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_recompensa_id_fkey FOREIGN KEY (recompensa_id) REFERENCES fidelidade_recompensas(id) ON DELETE SET NULL;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.pizza_sabor_precos ADD CONSTRAINT pizza_sabor_precos_sabor_id_fkey FOREIGN KEY (sabor_id) REFERENCES pizza_sabores(id) ON DELETE CASCADE;
ALTER TABLE public.pizza_sabor_precos ADD CONSTRAINT pizza_sabor_precos_tamanho_padrao_id_fkey FOREIGN KEY (tamanho_padrao_id) REFERENCES tamanhos_padrao_pizza(id) ON DELETE CASCADE;
ALTER TABLE public.pizza_sabores ADD CONSTRAINT pizza_sabores_item_id_fkey FOREIGN KEY (item_id) REFERENCES itens_cardapio(id) ON DELETE CASCADE;
ALTER TABLE public.preset_complemento_itens ADD CONSTRAINT preset_complemento_itens_preset_id_fkey FOREIGN KEY (preset_id) REFERENCES presets_complementos(id) ON DELETE CASCADE;
ALTER TABLE public.presets_complementos ADD CONSTRAINT presets_complementos_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.tamanhos_item ADD CONSTRAINT tamanhos_item_item_id_fkey FOREIGN KEY (item_id) REFERENCES itens_cardapio(id) ON DELETE CASCADE;
ALTER TABLE public.tamanhos_padrao_marmita ADD CONSTRAINT tamanhos_padrao_marmita_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.tamanhos_padrao_pizza ADD CONSTRAINT tamanhos_padrao_pizza_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.taxas_entrega_bairro ADD CONSTRAINT taxas_entrega_bairro_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.taxas_entrega_raio ADD CONSTRAINT taxas_entrega_raio_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_restaurante_id_fkey FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE;

-- ─── Índices ────────────────────────────────────────────────────
CREATE INDEX bordas_pizza_restaurante_id_idx ON public.bordas_pizza USING btree (restaurante_id);
CREATE INDEX campanha_envios_campanha_status_idx ON public.campanha_envios USING btree (campanha_id, status);
CREATE INDEX campanha_envios_pendentes_idx ON public.campanha_envios USING btree (status, criado_em) WHERE (status = 'pendente'::text);
CREATE INDEX campanhas_agendado_idx ON public.campanhas USING btree (status, agendado_em) WHERE (status = 'agendada'::text);
CREATE INDEX campanhas_restaurante_status_idx ON public.campanhas USING btree (restaurante_id, status);
CREATE INDEX campanhas_fidelidade_restaurante_id_idx ON public.campanhas_fidelidade USING btree (restaurante_id);
CREATE INDEX cliente_codigos_lookup_idx ON public.cliente_codigos USING btree (restaurante_id, telefone);
CREATE UNIQUE INDEX clientes_token_idx ON public.clientes USING btree (token);
CREATE UNIQUE INDEX comandas_mesa_aberta_unq ON public.comandas USING btree (restaurante_id, mesa_id) WHERE (status = 'aberta'::text);
CREATE INDEX idx_comandas_mesa ON public.comandas USING btree (mesa_id);
CREATE INDEX idx_comandas_restaurante ON public.comandas USING btree (restaurante_id);
CREATE INDEX idx_cupom_usos_cliente ON public.cupom_usos USING btree (cupom_id, cliente_telefone);
CREATE INDEX entregadores_restaurante_id_idx ON public.entregadores USING btree (restaurante_id);
CREATE UNIQUE INDEX entregadores_token_idx ON public.entregadores USING btree (token);
CREATE INDEX fechamentos_caixa_restaurante_id_idx ON public.fechamentos_caixa USING btree (restaurante_id);
CREATE INDEX idx_fidelidade_recompensas_cliente ON public.fidelidade_recompensas USING btree (restaurante_id, cliente_telefone, status);
CREATE INDEX grupos_cardapio_restaurante_id_idx ON public.grupos_cardapio USING btree (restaurante_id);
CREATE INDEX grupos_item_complementos_item_id_idx ON public.grupos_item_complementos USING btree (item_id);
CREATE INDEX impressoras_restaurante_id_idx ON public.impressoras USING btree (restaurante_id);
CREATE INDEX item_complementos_grupo_id_idx ON public.item_complementos USING btree (grupo_id);
CREATE INDEX item_complementos_item_id_idx ON public.item_complementos USING btree (item_id);
CREATE INDEX itens_cardapio_grupo_id_idx ON public.itens_cardapio USING btree (grupo_id);
CREATE INDEX itens_cardapio_restaurante_id_idx ON public.itens_cardapio USING btree (restaurante_id);
CREATE INDEX massas_pizza_restaurante_id_idx ON public.massas_pizza USING btree (restaurante_id);
CREATE INDEX idx_mesas_restaurante ON public.mesas USING btree (restaurante_id);
CREATE UNIQUE INDEX nexta_entregas_ativa_por_pedido ON public.nexta_entregas USING btree (pedido_id) WHERE (status <> ALL (ARRAY['REJECTED'::text, 'CANCELLED'::text, 'DELIVERY_FINISHED'::text, 'ORDER_DELIVERED'::text, 'RETURNED_TO_MERCHANT'::text]));
CREATE INDEX nexta_entregas_pedido_idx ON public.nexta_entregas USING btree (pedido_id);
CREATE INDEX nexta_entregas_restaurante_idx ON public.nexta_entregas USING btree (restaurante_id, criado_em DESC);
CREATE INDEX order_bumps_restaurante_idx ON public.order_bumps USING btree (restaurante_id);
CREATE INDEX pedido_itens_pedido_id_idx ON public.pedido_itens USING btree (pedido_id);
CREATE INDEX idx_pedidos_comanda ON public.pedidos USING btree (comanda_id);
CREATE INDEX pedidos_restaurante_id_idx ON public.pedidos USING btree (restaurante_id);
CREATE INDEX pedidos_status_idx ON public.pedidos USING btree (restaurante_id, status);
CREATE INDEX pizza_sabor_precos_sabor_id_idx ON public.pizza_sabor_precos USING btree (sabor_id);
CREATE INDEX pizza_sabores_item_id_idx ON public.pizza_sabores USING btree (item_id);
CREATE INDEX preset_complemento_itens_preset_id_idx ON public.preset_complemento_itens USING btree (preset_id);
CREATE INDEX presets_complementos_restaurante_id_idx ON public.presets_complementos USING btree (restaurante_id);
CREATE UNIQUE INDEX restaurantes_agente_token_uniq ON public.restaurantes USING btree (impressao_agente_token) WHERE (impressao_agente_token IS NOT NULL);
CREATE INDEX tamanhos_item_item_id_idx ON public.tamanhos_item USING btree (item_id);
CREATE INDEX tamanhos_padrao_marmita_restaurante_id_idx ON public.tamanhos_padrao_marmita USING btree (restaurante_id);
CREATE INDEX tamanhos_padrao_pizza_restaurante_id_idx ON public.tamanhos_padrao_pizza USING btree (restaurante_id);
CREATE INDEX taxas_entrega_bairro_restaurante_id_idx ON public.taxas_entrega_bairro USING btree (restaurante_id);
CREATE INDEX taxas_entrega_raio_restaurante_id_idx ON public.taxas_entrega_raio USING btree (restaurante_id);
CREATE INDEX usuarios_restaurante_id_idx ON public.usuarios USING btree (restaurante_id);
CREATE UNIQUE INDEX usuarios_usuario_unique ON public.usuarios USING btree (lower(usuario)) WHERE (usuario <> ''::text);

-- ─── Funções e procedures ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_restaurante_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select restaurante_id from usuarios where id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.campanha_incrementar_enviados(p_campanha_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  update campanhas set total_enviados = total_enviados + 1, atualizado_em = now()
  where id = p_campanha_id;
$function$
;

CREATE OR REPLACE FUNCTION public.campanha_incrementar_erros(p_campanha_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  update campanhas set total_erros = total_erros + 1, atualizado_em = now()
  where id = p_campanha_id;
$function$
;

CREATE OR REPLACE FUNCTION public.restaurante_id_por_agente_token(token text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from restaurantes
  where token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and impressao_agente_token = token::uuid;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_pedido_numero()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.numero is null or new.numero = 0 then
    select coalesce(max(numero), 0) + 1 into new.numero
    from pedidos where restaurante_id = new.restaurante_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_atualizado_em()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.atualizado_em = now();
  return new;
end;
$function$
;

-- ─── Triggers ───────────────────────────────────────────────────
CREATE TRIGGER nexta_config_touch_atualizado_em BEFORE UPDATE ON public.nexta_config FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();
CREATE TRIGGER nexta_entregas_touch_atualizado_em BEFORE UPDATE ON public.nexta_entregas FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();
CREATE TRIGGER pedidos_set_numero BEFORE INSERT ON public.pedidos FOR EACH ROW EXECUTE FUNCTION set_pedido_numero();
CREATE TRIGGER pedidos_touch_atualizado_em BEFORE UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION touch_atualizado_em();

-- ─── RLS ────────────────────────────────────────────────────────
ALTER TABLE public.bordas_pizza ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanha_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campanhas_fidelidade ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_codigos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comandas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupom_usos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entregadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechamentos_caixa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fidelidade_progresso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fidelidade_recompensas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupos_cardapio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupos_item_complementos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impressoras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_complementos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itens_cardapio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.massas_pizza ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexta_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexta_entregas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_bumps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pizza_sabor_precos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pizza_sabores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preset_complemento_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presets_complementos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tamanhos_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tamanhos_padrao_marmita ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tamanhos_padrao_pizza ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxas_entrega_bairro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxas_entrega_raio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pizza crust catalog" ON public.bordas_pizza
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage their pizza crust catalog" ON public.bordas_pizza
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members manage campanha_envios" ON public.campanha_envios
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members manage campanhas" ON public.campanhas
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members manage campanhas_fidelidade" ON public.campanhas_fidelidade
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members manage cliente_codigos" ON public.cliente_codigos
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members manage clientes" ON public.clientes
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "comandas_tenant_rw" ON public.comandas
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members manage cupom_usos" ON public.cupom_usos
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members manage cupons" ON public.cupons
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members manage entregadores" ON public.entregadores
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant manages own stations" ON public.estacoes
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members manage fechamentos" ON public.fechamentos_caixa
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members manage fidelidade_progresso" ON public.fidelidade_progresso
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members manage fidelidade_recompensas" ON public.fidelidade_recompensas
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Anyone can read menu groups" ON public.grupos_cardapio
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage their menu groups" ON public.grupos_cardapio
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Anyone can read item complement groups" ON public.grupos_item_complementos
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage their item complement groups" ON public.grupos_item_complementos
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM itens_cardapio i
  WHERE ((i.id = grupos_item_complementos.item_id) AND (i.restaurante_id = auth_restaurante_id())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM itens_cardapio i
  WHERE ((i.id = grupos_item_complementos.item_id) AND (i.restaurante_id = auth_restaurante_id())))));
CREATE POLICY "Tenant members manage their impressoras" ON public.impressoras
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Anyone can read item complementos" ON public.item_complementos
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage their item complementos" ON public.item_complementos
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM itens_cardapio i
  WHERE ((i.id = item_complementos.item_id) AND (i.restaurante_id = auth_restaurante_id())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM itens_cardapio i
  WHERE ((i.id = item_complementos.item_id) AND (i.restaurante_id = auth_restaurante_id())))));
CREATE POLICY "Anyone can read menu items" ON public.itens_cardapio
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage their menu items" ON public.itens_cardapio
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Anyone can read pizza dough catalog" ON public.massas_pizza
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage their pizza dough catalog" ON public.massas_pizza
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "mesas_tenant_rw" ON public.mesas
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members read nexta_entregas" ON public.nexta_entregas
  AS PERMISSIVE FOR SELECT TO public
  USING ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Anyone can read order bumps" ON public.order_bumps
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage order bumps" ON public.order_bumps
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Anyone can create pedido_itens" ON public.pedido_itens
  AS PERMISSIVE FOR INSERT TO anon,authenticated
  WITH CHECK (true);
CREATE POLICY "Tenant members manage pedido_itens" ON public.pedido_itens
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM pedidos p
  WHERE ((p.id = pedido_itens.pedido_id) AND (p.restaurante_id = auth_restaurante_id())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM pedidos p
  WHERE ((p.id = pedido_itens.pedido_id) AND (p.restaurante_id = auth_restaurante_id())))));
CREATE POLICY "Anyone can create pedidos" ON public.pedidos
  AS PERMISSIVE FOR INSERT TO anon,authenticated
  WITH CHECK (true);
CREATE POLICY "Tenant members manage pedidos" ON public.pedidos
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Anyone can read pizza flavor prices" ON public.pizza_sabor_precos
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage their pizza flavor prices" ON public.pizza_sabor_precos
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM (pizza_sabores s
     JOIN itens_cardapio i ON ((i.id = s.item_id)))
  WHERE ((s.id = pizza_sabor_precos.sabor_id) AND (i.restaurante_id = auth_restaurante_id())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (pizza_sabores s
     JOIN itens_cardapio i ON ((i.id = s.item_id)))
  WHERE ((s.id = pizza_sabor_precos.sabor_id) AND (i.restaurante_id = auth_restaurante_id())))));
CREATE POLICY "Anyone can read pizza flavors" ON public.pizza_sabores
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage their pizza flavors" ON public.pizza_sabores
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM itens_cardapio i
  WHERE ((i.id = pizza_sabores.item_id) AND (i.restaurante_id = auth_restaurante_id())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM itens_cardapio i
  WHERE ((i.id = pizza_sabores.item_id) AND (i.restaurante_id = auth_restaurante_id())))));
CREATE POLICY "Tenant members manage their preset complemento items" ON public.preset_complemento_itens
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM presets_complementos p
  WHERE ((p.id = preset_complemento_itens.preset_id) AND (p.restaurante_id = auth_restaurante_id())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM presets_complementos p
  WHERE ((p.id = preset_complemento_itens.preset_id) AND (p.restaurante_id = auth_restaurante_id())))));
CREATE POLICY "Tenant members manage their complemento presets" ON public.presets_complementos
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Anyone can read restaurant storefront" ON public.restaurantes
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members can read their restaurant" ON public.restaurantes
  AS PERMISSIVE FOR SELECT TO public
  USING ((id = auth_restaurante_id()));
CREATE POLICY "Tenant members can update their restaurant" ON public.restaurantes
  AS PERMISSIVE FOR UPDATE TO public
  USING ((id = auth_restaurante_id()))
  WITH CHECK ((id = auth_restaurante_id()));
CREATE POLICY "Anyone can read item tamanhos" ON public.tamanhos_item
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage their item tamanhos" ON public.tamanhos_item
  AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM itens_cardapio i
  WHERE ((i.id = tamanhos_item.item_id) AND (i.restaurante_id = auth_restaurante_id())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM itens_cardapio i
  WHERE ((i.id = tamanhos_item.item_id) AND (i.restaurante_id = auth_restaurante_id())))));
CREATE POLICY "Anyone can read marmita size catalog" ON public.tamanhos_padrao_marmita
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage their marmita size catalog" ON public.tamanhos_padrao_marmita
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Anyone can read pizza size catalog" ON public.tamanhos_padrao_pizza
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage their pizza size catalog" ON public.tamanhos_padrao_pizza
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Anyone can read delivery fees" ON public.taxas_entrega_bairro
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage delivery fees" ON public.taxas_entrega_bairro
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Anyone can read radius fees" ON public.taxas_entrega_raio
  AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY "Tenant members manage radius fees" ON public.taxas_entrega_raio
  AS PERMISSIVE FOR ALL TO public
  USING ((restaurante_id = auth_restaurante_id()))
  WITH CHECK ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Tenant members can read co-workers" ON public.usuarios
  AS PERMISSIVE FOR SELECT TO public
  USING ((restaurante_id = auth_restaurante_id()));
CREATE POLICY "Users can update their own profile" ON public.usuarios
  AS PERMISSIVE FOR UPDATE TO public
  USING ((id = auth.uid()));
CREATE POLICY "Public read of menu photos" ON storage.objects
  AS PERMISSIVE FOR SELECT TO public
  USING ((bucket_id = 'cardapio'::text));
CREATE POLICY "Tenant members delete their menu photos" ON storage.objects
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'cardapio'::text) AND ((storage.foldername(name))[1] = (auth_restaurante_id())::text)));
CREATE POLICY "Tenant members update their menu photos" ON storage.objects
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'cardapio'::text) AND ((storage.foldername(name))[1] = (auth_restaurante_id())::text)));
CREATE POLICY "Tenant members upload their menu photos" ON storage.objects
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'cardapio'::text) AND ((storage.foldername(name))[1] = (auth_restaurante_id())::text)));

COMMIT;
