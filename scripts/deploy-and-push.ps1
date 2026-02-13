# Deploy Supabase functions + commit e push para o repo
# Uso: .\scripts\deploy-and-push.ps1
# - Deploy das Edge Functions no Supabase (quando houver alteracoes em supabase/functions/)
# - Commit e push automatico (quando houver alteracoes para publicar na VPS)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

# Carrega .env e .env.local
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

# 1. Verifica se ha alteracoes em supabase/functions/
$functionsChanged = $false
$gitStatus = git status --short supabase/functions/ 2>$null
if ($gitStatus) {
  $functionsChanged = $true
}

# 2. Deploy das Edge Functions (se houver alteracoes ou se for executado explicitamente)
if ($functionsChanged) {
  Write-Host "Alteracoes em supabase/functions/ detectadas. Fazendo deploy das Edge Functions..." -ForegroundColor Cyan
  $ref = $env:SUPABASE_PROJECT_REF
  $password = $env:SUPABASE_DB_PASSWORD
  if (-not $ref) {
    Write-Host "ERRO: SUPABASE_PROJECT_REF nao definido no .env" -ForegroundColor Red
    exit 1
  }
  if ($password) {
    npx supabase link --project-ref $ref --password $password 2>$null | Out-Null
  }
  Write-Host "Deploy para projeto $ref ..." -ForegroundColor Gray
  npx supabase functions deploy --project-ref $ref
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Deploy das Edge Functions falhou." -ForegroundColor Red
    exit 1
  }
  Write-Host "Deploy Supabase concluido." -ForegroundColor Green
} else {
  Write-Host "Nenhuma alteracao em supabase/functions/. Pulando deploy Supabase." -ForegroundColor Gray
}

# 3. Verifica se ha alteracoes para commit (arquivos que afetam a VPS)
$allStatus = git status --short 2>$null
# Ignora arquivos temporarios e locais
$excludePatterns = @("supabase/\.temp/", "\.env$", "\.env\.local$")
$relevantChanges = $allStatus | Where-Object {
  $line = $_
  $excluded = $false
  foreach ($p in $excludePatterns) {
    if ($line -match $p) { $excluded = $true; break }
  }
  -not $excluded
}

if ($relevantChanges) {
  Write-Host "Alteracoes detectadas. Preparando commit e push..." -ForegroundColor Cyan
  git add -A
  git reset -- supabase/.temp/ .env .env.local 2>$null | Out-Null
  git diff --cached --quiet 2>$null
  $hasStaged = $LASTEXITCODE -ne 0
  if ($hasStaged) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    git commit -m "chore: sync deploy ($timestamp)"
    if ($LASTEXITCODE -eq 0) {
      git push origin master
      if ($LASTEXITCODE -eq 0) {
        Write-Host "Commit e push concluidos. Atualize na VPS com: git pull origin master" -ForegroundColor Green
      } else {
        Write-Host "ERRO: Push falhou." -ForegroundColor Red
        exit 1
      }
    }
  }
} else {
  Write-Host "Nenhuma alteracao pendente para commit." -ForegroundColor Gray
}
