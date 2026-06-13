-- Nome da instância Evolution API conectada ao WhatsApp da loja (multi-tenant:
-- cada restaurante tem sua própria instância/número, conectado via QR code em
-- Ajustes > Integrações).
alter table restaurantes
  add column evolution_instance text;
