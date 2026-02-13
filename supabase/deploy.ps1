# Deploy Supabase: migrations + edge functions
# Usa SUPABASE_PROJECT_REF e SUPABASE_DB_PASSWORD do .env ou .env.local (ou do ambiente).
# .env e depois .env.local (o segundo sobrescreve).

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

foreach ($envFile in @(".env", ".env.local")) {
  $path = Join-Path $projectRoot $envFile
  if (Test-Path $path) {
    Get-Content $path | ForEach-Object {
      if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim().Trim('"').Trim("'")
        Set-Item -Path "Env:$name" -Value $value
      }
    }
  }
}

$ref = $env:SUPABASE_PROJECT_REF
$password = $env:SUPABASE_DB_PASSWORD

if (-not $ref) {
  Write-Host "ERRO: Defina SUPABASE_PROJECT_REF (ex: no dashboard Supabase, Project Settings -> General -> Reference ID)" -ForegroundColor Red
  exit 1
}
if (-not $password) {
  Write-Host "ERRO: Defina SUPABASE_DB_PASSWORD (ex: Project Settings -> Database -> Database password)" -ForegroundColor Red
  exit 1
}

Set-Location $projectRoot

Write-Host "Linking projeto $ref ..." -ForegroundColor Cyan
npx supabase link --project-ref $ref --password $password
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Aplicando migrations (tabelas) ..." -ForegroundColor Cyan
npx supabase db push
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Fazendo deploy das Edge Functions ..." -ForegroundColor Cyan
npx supabase functions deploy
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Deploy concluido." -ForegroundColor Green
