import Link from 'next/link'
import { AuthShell, authLink } from '@/components/auth/auth-shell'
import { LoginCartao } from '@/components/auth/login-cartao'
import { entrarComGoogle, signIn } from './actions'
import { googleLigado } from '@/lib/auth/google'

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
  // Escondido até o provedor Google ser ligado no Supabase (o motoboy entra só com login e senha).
  const comGoogle = !voltar && (await googleLigado())

  return (
    <AuthShell
      heading="Entrar"
      subtitulo="Bem-vindo de volta! Entre para continuar."
      rodape={
        <>
          Não tem uma conta? <Link href="/cadastro" className={authLink}>Cadastre-se</Link>
        </>
      }
    >
      <LoginCartao
        signIn={signIn}
        entrarComGoogle={entrarComGoogle}
        comGoogle={comGoogle}
        voltar={voltar}
        aviso={noticeMessage}
        erro={errorMessage}
      />
    </AuthShell>
  )
}
