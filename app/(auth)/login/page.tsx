import { AuthShell, authLink } from '@/components/auth/auth-shell'
import { LoginCartao } from '@/components/auth/login-cartao'
import { signIn } from './actions'

const ERROR_MESSAGES: Record<string, string> = {
  pendente: 'Seu cadastro ainda não foi concluído. Acesse o link de primeiro acesso enviado pela Menuzia.',
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
  searchParams: Promise<{ error?: string; notice?: string; next?: string }>
}) {
  const { error, notice, next } = await searchParams
  // Vindo do app do motoboy (10/10): depois de entrar, volta para lá (no pedido do QR). O servidor valida o destino.
  const voltar = typeof next === 'string' && next.startsWith('/motoboy') ? next : null
  const errorMessage = error ? ERROR_MESSAGES[error] ?? error : null
  const noticeMessage = notice ? NOTICE_MESSAGES[notice] ?? null : null

  // Layout da imagem-modelo do dono (26/10): sem o botão do Google na tela.
  return (
    <AuthShell
      heading="Bem-vindo de volta!"
      subtitulo="Acesse sua conta para continuar."
      rodape={
        <>
          Ainda não tem uma conta?
          <br />
          <a href="https://menuzia.com.br" className={authLink}>Conheça o Menuzia</a>
        </>
      }
    >
      <LoginCartao signIn={signIn} voltar={voltar} aviso={noticeMessage} erro={errorMessage} />
    </AuthShell>
  )
}
