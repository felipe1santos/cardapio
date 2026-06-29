import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import {
  buscarProximoEnvio,
  marcarEnvioSucesso,
  marcarEnvioErro,
  verificarConclusaoCampanha,
} from '@/lib/queries/campanhas'
import { enviarWhatsapp, enviarMidia, enviarAudioPtt } from '@/lib/whatsapp'
import { formatarTelefoneWhatsapp } from '@/lib/whatsapp'

// Cron chamado pelo Coolify (ou qualquer scheduler) — protegido por CRON_SECRET.
// Configuração sugerida no Coolify: POST /api/cron/campanhas a cada 60 segundos
// com header "x-cron-secret: <CRON_SECRET>".
//
// Cada invocação processa até BATCH_SIZE mensagens com delays aleatórios entre elas.

const BATCH_SIZE = 5
const DELAY_MIN_MS = 4_000
const DELAY_MAX_MS = 12_000

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function randomDelay() {
  return Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS) + DELAY_MIN_MS)
}

export async function POST(request: Request) {
  try {
    // Fail-closed: sem CRON_SECRET configurado OU header errado → recusa. Evita que o
    // endpoint fique aberto (disparo de WhatsApp em massa) se a variável não estiver setada.
    const secret = process.env.CRON_SECRET
    const header = request.headers.get('x-cron-secret')
    if (!secret || header !== secret) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const admin = getAdminSupabase()
    const resultados: { telefone: string; status: 'enviado' | 'erro'; detalhe?: string }[] = []

    for (let i = 0; i < BATCH_SIZE; i++) {
      const envio = await buscarProximoEnvio(admin)
      if (!envio) break

      if (!envio.evolutionInstance) {
        await marcarEnvioErro(admin, envio.id, envio.campanhaId, 'Instância WhatsApp não configurada')
        resultados.push({ telefone: envio.telefone, status: 'erro', detalhe: 'sem instância' })
        continue
      }

      const numero = formatarTelefoneWhatsapp(envio.telefone)
      if (!numero) {
        await marcarEnvioErro(admin, envio.id, envio.campanhaId, 'Telefone inválido')
        resultados.push({ telefone: envio.telefone, status: 'erro', detalhe: 'telefone inválido' })
        continue
      }

      let ok = false
      const tipo = envio.tipoMensagem ?? 'texto'
      const mensagem = envio.mensagem ?? ''

      if (tipo === 'imagem' && envio.imagemUrl) {
        ok = await enviarMidia(numero, envio.imagemUrl, mensagem, envio.evolutionInstance)
      } else if (tipo === 'audio' && envio.audioUrl) {
        ok = await enviarAudioPtt(numero, envio.audioUrl, envio.evolutionInstance)
      } else {
        ok = await enviarWhatsapp(numero, mensagem, envio.evolutionInstance)
      }

      if (ok) {
        await marcarEnvioSucesso(admin, envio.id, envio.campanhaId)
        resultados.push({ telefone: envio.telefone, status: 'enviado' })
      } else {
        await marcarEnvioErro(admin, envio.id, envio.campanhaId, 'Falha no envio via Evolution API')
        resultados.push({ telefone: envio.telefone, status: 'erro', detalhe: 'evolution api' })
      }

      await verificarConclusaoCampanha(admin, envio.campanhaId)

      // Delay aleatório entre envios para reduzir risco de bloqueio.
      if (i < BATCH_SIZE - 1) await sleep(randomDelay())
    }

    return NextResponse.json({ processados: resultados.length, resultados })
  } catch (err) {
    console.error('[cron/campanhas] erro:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
