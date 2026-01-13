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
