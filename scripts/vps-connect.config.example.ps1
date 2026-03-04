# Copie este arquivo para vps-connect.config.ps1 e preencha com seus dados.
# O arquivo vps-connect.config.ps1 nao e commitado (esta no .gitignore).

$script:VpsHost = "seu-ip-ou-dominio"
$script:VpsUser = "seu-usuario"
$script:VpsKeyPath = "$env:USERPROFILE\.ssh\id_ed25519"   # ou id_rsa
$script:VpsPort = 22
