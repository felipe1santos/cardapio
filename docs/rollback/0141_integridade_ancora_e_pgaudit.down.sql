-- Rollback da 0141: desliga o pgaudit dos papéis e tira a função da âncora (os arquivos de âncora no servidor ficam).
alter role postgres reset pgaudit.log;
alter role postgres reset pgaudit.role;
alter role authenticator reset pgaudit.role;
revoke update, delete, truncate on public.fin_lancamentos, public.eventos_auditoria, public.fin_entregas_pagamento from menuzia_auditoria;
drop role if exists menuzia_auditoria;
drop extension if exists pgaudit;
drop function if exists public.fin_ancora_integridade();
