import { AuthShell, authLink } from '@/components/auth/auth-shell'
import { LoginCartao } from '@/components/auth/login-cartao'
import Link from 'next/link'
import { SUPORTE_MENUZIA } from '@/lib/suporte'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarAssinaturaDoUsuario, urlDeFaturaAsaas } from '@/lib/assinatura/repo'
import { planoValido } from '@/lib/assinatura/planos'
import { ModalAdquirir } from '@/components/auth/modal-adquirir'
import { signIn } from './actions'

const ERROR_MESSAGES: Record<string, string> = {
  pendente: 'Seu cadastro ainda não foi concluído. Acesse o link de primeiro acesso enviado pela Menuzia.',
  // Assinatura (02/11): venceu no login (entrada.ts) ou no meio do uso (middleware → error=acesso).
  expirado: 'Seu acesso expirou. Regularize o pagamento para voltar a usar o sistema.',
  acesso: 'Seu acesso está bloqueado. Se a assinatura venceu, regularize o pagamento para voltar a usar o sistema.',
  'google-sem-conta': 'Não encontramos uma conta Menuzia com este e-mail. Fale com o suporte.',
  'google-falhou': 'Não foi possível entrar com o Google. Tente de novo ou entre com usuário e senha.',
}

const NOTICE_MESSAGES: Record<string, string> = {
  'cadastro-concluido': 'Cadastro concluído! Faça login com seu usuário e senha.',
  'senha-alterada': 'Senha alterada! Faça login com a nova senha.',
  kds: 'A tela da cozinha agora é o KDS. Entre com o usuário da cozinha (a loja cria em Equipe › cargo Cozinha).',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; next?: string; pagar?: string; adquirir?: string; plano?: string; erro_assinar?: string }>
}) {
  const { error, notice, next, pagar, adquirir, plano, erro_assinar } = await searchParams
  // Modal "Adquirir acesso" reaberto pelo servidor (erro ao gerar a cobrança): passo 2 com o plano e a mensagem.
  const passoAdquirir: 0 | 1 | 2 = adquirir === '2' ? 2 : adquirir === '1' ? 1 : 0
  const planoAdquirir = planoValido(plano) ? plano : 'completo'
  // Vindo do app do motoboy (10/10): depois de entrar, volta para lá (no pedido do QR). O servidor valida o destino.
  const voltar = typeof next === 'string' && next.startsWith('/motoboy') ? next : null
  const errorMessage = error ? ERROR_MESSAGES[error] ?? error : null
  const noticeMessage = notice ? NOTICE_MESSAGES[notice] ?? null : null
  // "Pagar agora": fatura vinda do entrada.ts (expirado, já deslogado) ou, no meio do uso (acesso), da sessão ainda viva.
  let pagarUrl = error === 'expirado' ? urlDeFaturaAsaas(pagar) : null
  if (error === 'acesso' && !pagarUrl) {
    try {
      const supabase = await getServerSupabase()
      const { data } = await supabase.auth.getUser()
      if (data.user) pagarUrl = urlDeFaturaAsaas((await buscarAssinaturaDoUsuario(getAdminSupabase(), data.user.id))?.faturaUrl)
    } catch { pagarUrl = null }
  }

  // Sem o botão do Google na tela (pedido do dono, 26/10).
  return (
    <AuthShell
      heading="Acesse sua conta"
      rodape={
        <>
          <p>
            <Link href="/recuperar-senha" className={`text-[16px] ${authLink}`}>Esqueci minha senha</Link>
          </p>
          <p className="pt-[8px] text-[14px]">
            Precisa de ajuda?{' '}
            <a href={`https://wa.me/${SUPORTE_MENUZIA.whatsapp}`} target="_blank" rel="noopener noreferrer" className={authLink}>
              Fale com nosso suporte
            </a>
          </p>
          <p className="text-[14px]">
            Ainda não tem uma conta?{' '}
            <ModalAdquirir passoInicial={passoAdquirir} planoInicial={planoAdquirir} erro={erro_assinar ?? null} />
            {' · '}
            <a href="https://menuzia.com.br" className={authLink}>Conheça o Menuzia</a>
          </p>
        </>
      }
    >
      <LoginCartao signIn={signIn} voltar={voltar} aviso={noticeMessage} erro={errorMessage} pagarUrl={pagarUrl} />
    </AuthShell>
  )
}
