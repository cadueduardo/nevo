# Instruções para subir alterações no VPS

Após `git push` do repositório, use uma das opções abaixo **no servidor (VPS)**.

---

## Opção 1: Um comando só (recomendado)

No seu computador, rode (troque `seu_usuario` e `ip_do_vps`; o projeto no VPS fica em `/opt/nevo`):

```bash
ssh seu_usuario@ip_do_vps "cd /opt/nevo && chmod +x scripts/deploy-vps.sh && ./scripts/deploy-vps.sh"
```

Ou conecte no VPS e depois rode:

```bash
cd /opt/nevo
./scripts/deploy-vps.sh
```

(O script usa `/opt/nevo` como pasta padrão se for chamado de outro diretório.)

(O script faz: `git pull`, `npm ci`, `npm run build` e o restart do app.)

**Restart no seu VPS:** o Nevo está no PM2 com **id 0**; o script já usa `sudo pm2 restart 0` por padrão. Se o seu for diferente, edite `RESTART_CMD` em `scripts/deploy-vps.sh` ou exporte antes: `export RESTART_CMD="sudo pm2 restart 0"`.

**Configurar o restart:** por padrão o script usa `pm2 restart nevo`. Para outro comando (ex.: systemd), exporte antes de rodar:

```bash
export RESTART_CMD="sudo systemctl restart nevo"
./scripts/deploy-vps.sh
```

Ou edite as variáveis no topo de `scripts/deploy-vps.sh` (`RESTART_CMD`, `BRANCH`, `PROJECT_DIR`).

---

## Opção 2: Passo a passo manual

### 1. Conectar no VPS

```bash
ssh seu_usuario@ip_ou_dominio_do_vps
```

### 2. Ir até a pasta do projeto

```bash
cd /opt/nevo
```

### 3. Atualizar o código do remoto

```bash
git fetch origin
git pull origin master
```

### 4. Instalar dependências e build

```bash
npm ci
npm run build
```

### 5. Reiniciar a aplicação

- **PM2:** `pm2 restart nevo`
- **systemd:** `sudo systemctl restart nevo`
- **Sem gerenciador:** parar o processo e rodar `npm run start` (ou `nohup npm run start > app.log 2>&1 &`)

---

## Verificar se subiu

- Abra no navegador a URL do app no VPS.
- As alterações da Edge Function já estão no Supabase; no VPS o código e a documentação ficam atualizados após o deploy.
