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

const FONTE = '"PingFang SC","PingFangSC-Regular",var(--font-inter),-apple-system,"Segoe UI",sans-serif'

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

  // Molde: portal de lojistas da 99Food (foto cheia, barra escura no topo, cartão à direita).
  return (
    <main
      className="relative flex min-h-screen flex-col bg-[#F2F3F5] bg-cover bg-[position:30%_15%]"
      style={{ backgroundImage: 'url(/login-bg.webp)', fontFamily: FONTE }}
    >
      <header className="flex h-[56px] shrink-0 items-center bg-black/50 px-[16px] sm:h-[70px] sm:px-[40px]">
        <span className="flex items-center gap-[8px] text-[24px] font-semibold tracking-[-0.01em] text-white">
          <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[6px] bg-[linear-gradient(135deg,#1B45C2,#2F6FEB)] text-[20px] leading-none">
            +
          </span>
          Menuzia
        </span>
      </header>

      <div className="flex flex-1 items-center justify-center px-[16px] py-[32px] sm:justify-end sm:px-[40px] lg:pr-[12%]">
        <LoginCartao
          signIn={signIn}
          entrarComGoogle={entrarComGoogle}
          comGoogle={comGoogle}
          voltar={voltar}
          aviso={noticeMessage}
          erro={errorMessage}
        />
      </div>

      <footer className="bg-black/50 py-[6px] text-center text-[12px] text-white/80">
        © {new Date().getFullYear()} Menuzia
      </footer>
    </main>
  )
}
