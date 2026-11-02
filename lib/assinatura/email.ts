/**
 * E-mail "acesso liberado" (puro: monta assunto/HTML/texto; quem envia é lib/custo/resend.ts).
 * Nunca leva a senha: ela foi escolhida pelo próprio lojista no cadastro.
 */
import { PLANOS, type Plano } from './planos'

export interface DadosAcessoLiberado { nome: string; usuario: string; email: string; nomeLoja: string; slug: string; plano: Plano; urlBase: string }

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function emailAcessoLiberado(d: DadosAcessoLiberado): { assunto: string; html: string; texto: string } {
  const login = `${d.urlBase}/login`
  const vitrine = `${d.urlBase}/loja/${d.slug}`
  const plano = PLANOS[d.plano].nome
  const assunto = `Seu acesso à Menuzia está liberado — ${d.nomeLoja}`
  const texto = [
    `Olá, ${d.nome}!`,
    '',
    `Pagamento confirmado. O acesso da loja "${d.nomeLoja}" (${plano}) está liberado.`,
    '',
    `Entrar no painel: ${login}`,
    `Usuário: ${d.usuario}`,
    `E-mail: ${d.email}`,
    'Senha: a que você escolheu no cadastro.',
    '',
    `Link do seu cardápio para os clientes: ${vitrine}`,
    '',
    'Primeiros passos: Cardápio (cadastre os itens), Ajustes › Perfil (horário, endereço, taxa de entrega) e Impressão.',
    'Dúvidas: responda este e-mail ou fale com o suporte no painel.',
    '',
    'Equipe Menuzia',
  ].join('\n')
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#EDEEF1;font-family:Inter,Arial,sans-serif;color:#1F2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" style="max-width:560px;background:#fff;border:1px solid #E5E7EB;border-radius:3px" cellpadding="0" cellspacing="0">
<tr><td style="background:#0688D4;padding:16px 24px;color:#fff;font-size:18px;font-weight:700">Menuzia</td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:1.6">
<p style="margin:0 0 12px">Olá, <strong>${escapar(d.nome)}</strong>!</p>
<p style="margin:0 0 16px">Pagamento confirmado. O acesso da loja <strong>${escapar(d.nomeLoja)}</strong> (${escapar(plano)}) está liberado.</p>
<p style="margin:0 0 20px"><a href="${login}" style="display:inline-block;background:#0688D4;color:#fff;text-decoration:none;font-weight:600;font-size:12px;letter-spacing:.04em;text-transform:uppercase;padding:12px 20px;border-radius:3px">Entrar no painel</a></p>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 16px">
<tr><td style="color:#6B7280;padding:2px 12px 2px 0">Usuário</td><td><strong>${escapar(d.usuario)}</strong></td></tr>
<tr><td style="color:#6B7280;padding:2px 12px 2px 0">E-mail</td><td>${escapar(d.email)}</td></tr>
<tr><td style="color:#6B7280;padding:2px 12px 2px 0">Senha</td><td>a que você escolheu no cadastro</td></tr>
</table>
<p style="margin:0 0 16px">Link do seu cardápio para os clientes:<br><a href="${vitrine}" style="color:#0570AE">${vitrine}</a></p>
<p style="margin:0 0 4px;color:#6B7280">Primeiros passos: Cardápio (cadastre os itens), Ajustes › Perfil (horário, endereço, taxa de entrega) e Impressão.</p>
<p style="margin:0;color:#6B7280">Dúvidas: responda este e-mail ou fale com o suporte no painel.</p>
</td></tr></table></td></tr></table></body></html>`
  return { assunto, html, texto }
}
