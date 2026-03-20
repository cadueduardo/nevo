param(
  [string]$BaseUrl = "",
  [string]$Secret = ""
)

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = if ($env:NEXT_PUBLIC_APP_URL) { $env:NEXT_PUBLIC_APP_URL } else { "http://localhost:3000" }
}

if ([string]::IsNullOrWhiteSpace($Secret)) {
  $Secret = $env:WHATSAPP_OUTBOX_SECRET
}

if ([string]::IsNullOrWhiteSpace($Secret)) {
  Write-Error "WHATSAPP_OUTBOX_SECRET nao definido."
  exit 1
}

$normalizedBaseUrl = $BaseUrl.TrimEnd('/')
$url = "$normalizedBaseUrl/api/internal/whatsapp-outbox/drain"

try {
  $response = Invoke-RestMethod `
    -Method Post `
    -Uri $url `
    -Headers @{
      Authorization = "Bearer $Secret"
      "Content-Type" = "application/json"
    } `
    -TimeoutSec 30

  $response | ConvertTo-Json -Depth 5
} catch {
  Write-Error $_
  exit 1
}
