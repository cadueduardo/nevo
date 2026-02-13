# Ambiente local, mas online (sem custo inicial)

Este guia mostra como deixar o Nevo acessivel online para testes com poucas pessoas, sem contratar VPS agora.

Arquitetura recomendada para esta fase:

- App Nevo (Next.js) em `Vercel` (estavel e gratis no inicio).
- Evolution API em uma VM sua (ou maquina dedicada) com `Docker` + `Coolify`.
- Exposicao da Evolution com `Cloudflare Tunnel` (URL fixa sem IP publico).
- Supabase continua como backend principal (Auth, DB, Edge Functions).

---

## 1) Objetivo e resultado final

Ao finalizar, voce tera:

- `https://app.seudominio.com` -> app Nevo (Vercel)
- `https://evolution.seudominio.com` -> Evolution API (sua VM, via Cloudflare Tunnel)
- Webhook da Evolution apontando para:
  - `https://app.seudominio.com/api/webhooks/evolution/{agentId}`
- Provisionamento automatico de novo agente com Evolution funcionando (quando as envs estiverem configuradas).

---

## 2) Pre-requisitos

- Conta Cloudflare com dominio ja configurado.
- Conta Vercel.
- Uma VM/maquina sua rodando Linux (ou ambiente equivalente) para o Docker.
- Docker e Docker Compose instalados na VM.
- Projeto Nevo ja funcionando localmente.

---

## 3) Subir o app na Vercel

1. Conecte o repositorio na Vercel.
2. Configure as variaveis de ambiente do projeto na Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL=https://app.seudominio.com`
   - `EVOLUTION_AUTO_BASE_URL=https://evolution.seudominio.com`
   - `EVOLUTION_AUTO_API_KEY=<sua-api-key-da-evolution>`
3. Deploy do app.
4. No DNS da Cloudflare, crie `app.seudominio.com` apontando para a Vercel (CNAME conforme instrucoes da Vercel).

---

## 4) Subir Evolution na sua VM com Docker (via Coolify ou compose)

Se usar Coolify, crie um service Docker com base no `docker-compose.evolution.yaml` do projeto.

Se preferir compose direto na VM:

```bash
docker compose -f docker-compose.evolution.yaml pull
docker compose -f docker-compose.evolution.yaml up -d
```

Valide localmente na VM:

```bash
curl http://localhost:8080
```

---

## 5) Expor Evolution com Cloudflare Tunnel (URL fixa)

Instale e autentique `cloudflared` na VM.

Fluxo resumido:

1. Criar tunnel:
   - `cloudflared tunnel create nevo-evolution`
2. Criar rota DNS:
   - `cloudflared tunnel route dns nevo-evolution evolution.seudominio.com`
3. Criar config do tunnel (exemplo):

```yaml
tunnel: nevo-evolution
credentials-file: /home/SEU_USUARIO/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: evolution.seudominio.com
    service: http://localhost:8080
  - service: http_status:404
```

4. Subir tunnel:
   - `cloudflared tunnel run nevo-evolution`
5. Opcional: registrar como service/systemd para iniciar automatico no boot.

---

## 6) Configurar Evolution para webhooks

No Nevo, a URL de webhook por agente deve ficar:

- `https://app.seudominio.com/api/webhooks/evolution/{agentId}`

Com o provisionamento automatico implementado no onboarding:

- novos agentes tentam criar instancia e configurar webhook automaticamente;
- em caso de falha, o erro fica em `last_error` no canal WhatsApp do agente.

---

## 7) Variaveis importantes (resumo)

### Vercel (app)

- `NEXT_PUBLIC_APP_URL=https://app.seudominio.com`
- `EVOLUTION_AUTO_BASE_URL=https://evolution.seudominio.com`
- `EVOLUTION_AUTO_API_KEY=...`
- Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)

### VM (Evolution)

- API key da Evolution (a mesma usada no app).
- Containers Docker da Evolution, Redis e Postgres ativos.

---

## 8) Checklist de validacao rapida

1. Abrir `https://app.seudominio.com` (app online).
2. Abrir `https://evolution.seudominio.com` (Evolution acessivel).
3. Criar um novo agente pelo onboarding.
4. Ir em `Agente -> Canais`:
   - deve aparecer Evolution configurada (ou erro claro em `last_error`).
5. Clicar em `Conectar WhatsApp` e verificar QR.
6. Enviar mensagem no WhatsApp e validar recebimento/resposta.

---

## 9) Limites desta estrategia "sem custo"

- Sua VM/maquina precisa ficar ligada 24/7.
- Queda de energia/internet derruba Evolution.
- Nao e ideal para producao critica.
- Bom para validacao com primeiros usuarios.

---

## 10) Quando evoluir para producao

Quando tiver tracao:

- Migrar Evolution para VPS/cloud com alta disponibilidade.
- Manter app na Vercel.
- Adicionar monitoramento e backup.
- Configurar alertas para webhook/tunnel/containers.

---

## 11) Referencias no projeto

- `docs/evolution-api-whatsapp.md`
- `docker-compose.evolution.yaml`
- `src/app/api/onboarding/migrate/route.ts`
- `src/app/api/app/agents/[id]/channel/whatsapp/route.ts`
- `src/app/api/webhooks/evolution/[agentId]/route.ts`

