# Sobe o projeto QA no Supabase (migrações + Edge Functions).
# Pré-requisito: ter feito login uma vez: npx supabase login
# Uso (a partir da pasta do projeto): .\scripts\supabase-qa-up.ps1
#     Ou, estando em scripts\: .\supabase-qa-up.ps1

$ErrorActionPreference = "Stop"
$ProjectRef = "jfxlbffnzliapmcxfata"
$RootDir = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path "$RootDir\.env.qa")) {
    Write-Host "ERRO: .env.qa nao encontrado em $RootDir" -ForegroundColor Red
    exit 1
}

# Carrega .env.qa no processo (encoding UTF-8 sem BOM para evitar caractere extra)
$envLines = Get-Content "$RootDir\.env.qa" -Encoding UTF8
foreach ($line in $envLines) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $idx = $line.IndexOf('=')
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if ($name -and $value) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
}

if (-not $env:SUPABASE_DB_PASSWORD) {
    Write-Host "ERRO: SUPABASE_DB_PASSWORD nao definido no .env.qa (senha do banco do projeto QA)" -ForegroundColor Red
    Write-Host "Dashboard: Project Settings -> Database -> Database password" -ForegroundColor Yellow
    exit 1
}

Set-Location $RootDir

Write-Host "[supabase-qa] 1/3 Link projeto QA ($ProjectRef)..." -ForegroundColor Cyan
npx supabase link --project-ref $ProjectRef
if ($LASTEXITCODE -ne 0) {
    Write-Host "Falha no link. Confirme: npx supabase login (e acesso ao projeto $ProjectRef)" -ForegroundColor Red
    exit 1
}

Write-Host "[supabase-qa] 2/3 Aplicando migracoes (db push)..." -ForegroundColor Cyan
npx supabase db push --password $env:SUPABASE_DB_PASSWORD
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "[supabase-qa] 3/3 Deploy das Edge Functions..." -ForegroundColor Cyan
npx supabase functions deploy
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "[supabase-qa] Concluido. Projeto QA: https://$ProjectRef.supabase.co" -ForegroundColor Green
