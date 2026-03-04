# Conecta na VPS via SSH sem precisar digitar o comando e a frase secreta toda vez.
#
# Opcao 1 (recomendada): Chave SSH + ssh-agent
#   - Coloque sua chave publica na VPS (ssh-copy-id ou manual em ~/.ssh/authorized_keys).
#   - Uma vez por sessao (ou ao ligar o PC), rode: ssh-add "C:\Users\Voce\.ssh\id_ed25519"
#   - Digite a frase secreta uma vez. Depois e so executar este script.
#
# Opcao 2: Chave sem passphrase (menos seguranca)
#   - Use uma chave sem frase; o script conecta direto com -i.
#
# Configuracao:
#   - Copie vps-connect.config.example.ps1 para vps-connect.config.ps1
#   - Edite vps-connect.config.ps1 com Host, User e caminho da chave.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Carregar config (host, user, key)
$ConfigPath = Join-Path $ScriptDir "vps-connect.config.ps1"
if (-not (Test-Path $ConfigPath)) {
  Write-Host "Config nao encontrado: $ConfigPath" -ForegroundColor Red
  Write-Host "Copie vps-connect.config.example.ps1 para vps-connect.config.ps1 e preencha Host, User e KeyPath." -ForegroundColor Yellow
  exit 1
}
. $ConfigPath

$HostVal = if ($script:VpsHost) { $script:VpsHost } else { $env:VPS_HOST }
$UserVal = if ($script:VpsUser) { $script:VpsUser } else { $env:VPS_USER }
$KeyVal  = if ($script:VpsKeyPath) { $script:VpsKeyPath } else { $env:VPS_KEY_PATH }
$PortVal = if ($script:VpsPort) { $script:VpsPort } else { 22 }

if (-not $HostVal -or -not $UserVal) {
  Write-Host "Defina VpsHost e VpsUser em vps-connect.config.ps1 (ou VPS_HOST e VPS_USER no ambiente)." -ForegroundColor Red
  exit 1
}

$Target = "${UserVal}@${HostVal}"
$SshArgs = @("-p", $PortVal)

if ($KeyVal -and (Test-Path $KeyVal)) {
  $SshArgs += @("-i", $KeyVal)
}

Write-Host "Conectando em $Target ..." -ForegroundColor Cyan
& ssh @SshArgs $Target
