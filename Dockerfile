# Imagem enxuta do Menuzia (29/10/2026): antes o Nixpacks levava o projeto inteiro + node_modules (~2,4 GB).
# Aqui o estágio 1 monta como sempre (npm ci + npm run build, com as guardas do prebuild) e o estágio 2 leva só o
# .next/standalone (servidor + node_modules rastreados), os estáticos e o public.
# Node igual ao que o Nixpacks usa hoje (22.11.0); "slim" e não "alpine" porque o sharp precisa da glibc.

FROM node:22.11.0-bookworm-slim AS builder
WORKDIR /app

# Variáveis "Build time" do Coolify chegam como --build-arg. Só neste estágio: o build fica igual ao de hoje e
# nenhum segredo vai para a imagem final (lá elas vêm do Coolify na hora de rodar).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG SUPABASE_SERVICE_ROLE_KEY
ARG EVOLUTION_API_URL
ARG EVOLUTION_API_KEY
ARG SUPERADMIN_EMAILS
ARG CRON_SECRET
ARG WHATSAPP_ROBO_LIBERADO
ARG VAPID_SUBJECT
ARG PAGAMENTOS_CHAVE
ARG VAPID_PUBLIC_KEY
ARG VAPID_PRIVATE_KEY
ARG MP_WEBHOOK_SECRET
ARG MP_CLIENT_SECRET
ARG MP_CLIENT_ID
ARG GOOGLE_MAPS_BROWSER_KEY
ARG ANTHROPIC_API_KEY
ARG ENTREGAS_UBER_LIBERADO
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ARG NOVENOVE_APP_ID
ARG NOVENOVE_APP_SECRET
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
    EVOLUTION_API_URL=$EVOLUTION_API_URL \
    EVOLUTION_API_KEY=$EVOLUTION_API_KEY \
    SUPERADMIN_EMAILS=$SUPERADMIN_EMAILS \
    CRON_SECRET=$CRON_SECRET \
    WHATSAPP_ROBO_LIBERADO=$WHATSAPP_ROBO_LIBERADO \
    VAPID_SUBJECT=$VAPID_SUBJECT \
    PAGAMENTOS_CHAVE=$PAGAMENTOS_CHAVE \
    VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY \
    VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY \
    MP_WEBHOOK_SECRET=$MP_WEBHOOK_SECRET \
    MP_CLIENT_SECRET=$MP_CLIENT_SECRET \
    MP_CLIENT_ID=$MP_CLIENT_ID \
    GOOGLE_MAPS_BROWSER_KEY=$GOOGLE_MAPS_BROWSER_KEY \
    ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
    ENTREGAS_UBER_LIBERADO=$ENTREGAS_UBER_LIBERADO \
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
    NOVENOVE_APP_ID=$NOVENOVE_APP_ID \
    NOVENOVE_APP_SECRET=$NOVENOVE_APP_SECRET \
    NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
# O ffmpeg-static baixa o binário do Linux aqui (install do pacote), como no Nixpacks.
RUN npm ci
COPY . .
RUN npm run build

FROM node:22.11.0-bookworm-slim AS runner
WORKDIR /app
# curl para o healthcheck do Coolify (/api/vivo roda dentro do container; a imagem slim não tem curl nem wget).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
# HOSTNAME é só o endereço em que o servidor escuta; não entra nos redirecionamentos (testado 29/10: /admin sem
# sessão devolve "Location: /login", relativo, com qualquer Host — ver memória "next start sem -H").
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
# Roda como root, igual ao Nixpacks: o volume /app/dados/ancoras (âncora do Financeiro) precisa ser gravável.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
