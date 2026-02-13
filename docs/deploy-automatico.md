# Deploy automático (Supabase + VPS)

## Script local (`npm run deploy:auto`)

Executa `scripts/deploy-and-push.ps1` que:

1. **Deploy Supabase** — quando há alterações em `supabase/functions/`:
   - Faz deploy das Edge Functions via `supabase functions deploy`
   - Usa `SUPABASE_PROJECT_REF` e `SUPABASE_DB_PASSWORD` do `.env` ou `.env.local`

2. **Commit e push** — quando há alterações para publicar na VPS:
   - `git add -A` (exclui `supabase/.temp/`, `.env`, `.env.local`)
   - `git commit -m "chore: sync deploy ($timestamp)"`
   - `git push origin master`

### Uso

```powershell
npm run deploy:auto
```

## GitHub Action (deploy em push)

O workflow `.github/workflows/deploy-supabase-functions.yml`:

- Dispara em **push para `master`** quando há alterações em `supabase/functions/**`
- Faz deploy das Edge Functions no Supabase

### Configuração

Crie os secrets no repositório (Settings → Secrets and variables → Actions):

| Secret | Descrição |
|--------|-----------|
| `SUPABASE_ACCESS_TOKEN` | Token pessoal do Supabase ([criar aqui](https://supabase.com/dashboard/account/tokens)) |
| `SUPABASE_PROJECT_REF` | ID do projeto (Project Settings → General → Reference ID) |

## Fluxo recomendado

1. Alterar código (functions, app, etc.)
2. Rodar `npm run deploy:auto` — faz deploy das functions (se mudaram) e commit + push
3. Na VPS: `cd /opt/nevo && git pull origin master && npm run build && pm2 restart nevo`
