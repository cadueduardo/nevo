# Script para testar a Evolution API diretamente
# Uso: .\scripts\test-evolution.ps1 -BaseUrl "http://localhost:8080" -Instance "nevo" -ApiKey "evonevo2025"

param(
    [string]$BaseUrl = "http://localhost:8080",
    [string]$Instance = "nevo",
    [string]$ApiKey = "evonevo2025"
)

$ErrorActionPreference = "Stop"
$url = "$($BaseUrl.TrimEnd('/'))/instance/connect/$Instance"

Write-Host "Testando Evolution API..." -ForegroundColor Cyan
Write-Host "URL: $url" -ForegroundColor Gray
Write-Host ""

try {
    $headers = @{ apikey = $ApiKey }
    $response = Invoke-WebRequest -Uri $url -Method Get -Headers $headers -UseBasicParsing

    Write-Host "Status: $($response.StatusCode) OK" -ForegroundColor Green
    $json = $response.Content | ConvertFrom-Json

    if ($json.code) {
        Write-Host "Evolution retornou 'code' (QR). Tamanho: $($json.code.Length) caracteres" -ForegroundColor Green
    }
    if ($json.base64) {
        Write-Host "Evolution retornou 'base64' (QR em imagem)." -ForegroundColor Green
    }
    if ($json.pairingCode) {
        Write-Host "Pairing Code: $($json.pairingCode)" -ForegroundColor Yellow
    }
    if (-not $json.code -and -not $json.base64) {
        Write-Host "Resposta completa:" -ForegroundColor Yellow
        $response.Content
    }
} catch {
    if ($_.Exception.Response) {
        $statusCode = [int]$_.Exception.Response.StatusCode
        Write-Host "Erro HTTP: $statusCode" -ForegroundColor Red
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $body = $reader.ReadToEnd()
            Write-Host "Corpo: $body" -ForegroundColor Red
        } catch { }
    } else {
        Write-Host "Erro de conexão: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Verifique se os containers estão rodando: docker ps" -ForegroundColor Yellow
    }
}
