# Nevo - Atendimento Inteligente

SaaS multi-tenant de atendimento inteligente por WhatsApp com IA configurável.

## Stack Tecnológico

- **Frontend**: Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions)
- **Canal**: WhatsApp Business API (Twilio) ou Chat Próprio
- **IA**: Configurável pelo cliente (OpenAI, Claude, Gemini)

## Configuração

1. Instale as dependências:
```bash
npm install
```

2. Configure as variáveis de ambiente:
```bash
cp .env.example .env.local
```

3. Configure as variáveis no `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

4. Execute o projeto:
```bash
npm run dev
```

### Testar WhatsApp em local (Twilio Sandbox)

Para receber mensagens da Twilio no localhost, use ngrok (instale em [ngrok.com/download](https://ngrok.com/download) ou `choco install ngrok`):

1. Em um terminal: `npm run tunnel` (ou instale o [ngrok](https://ngrok.com/) e rode `ngrok http 3000`).
2. Copie a URL HTTPS que o ngrok exibir (ex.: `https://abc123.ngrok-free.app`).
3. No `.env.local`, defina `NEXT_PUBLIC_APP_URL=https://abc123.ngrok-free.app`.
4. Reinicie o `npm run dev`. No Nevo, em **Agentes** → **Canais** → **Salvar credenciais**; a URL do webhook aparecerá. Configure essa URL na Twilio (Sandbox → "When a message comes in").

Detalhes: [docs/twilio-sandbox-teste.md](docs/twilio-sandbox-teste.md).

## Estrutura do Projeto

- `/src/app` - Rotas Next.js (App Router)
- `/src/components` - Componentes React
- `/src/lib` - Bibliotecas e utilitários
- `/supabase/migrations` - Migrations SQL
- `/supabase/functions` - Edge Functions
- `/docs` - Documentação do projeto

## Regras Importantes

- **Mobile First**: Todas as telas devem ser desenvolvidas mobile first
- **Sem CSS hardcoded**: Tudo via Tailwind CSS
- **RLS ativo**: Todas as tabelas têm RLS habilitado
- **Tenant Isolation**: Isolamento estrito entre tenants
- **IA Restrita**: IA apenas para extração e reescrita, sem decisões

## Documentação

Veja `/docs/mvp_nevo_plano_completo.md` para a documentação completa do projeto.
