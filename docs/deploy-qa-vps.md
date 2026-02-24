# Deploy do Nevo QA no VPS (nevoqa.pratikapp.com.br)

Produção e QA rodam **no mesmo VPS**, em **pastas e processos diferentes**.

---

## Estrutura no VPS

| Ambiente | Pasta        | Porta (ex.) | PM2 (ex.) | Domínio                  |
|----------|--------------|-------------|-----------|---------------------------|
| Produção | `/opt/nevo`  | 3000        | `nevo` ou id 0 | seu-dominio.com          |
| QA       | `/opt/nevo-qa` | 3010      | `nevo-qa` | nevoqa.pratikapp.com.br  |

Cada pasta tem seu próprio código, `.env` e build. Não misture os `.env` (prod usa um projeto Supabase, QA usa outro).

---

## 1. Criar a pasta e o projeto QA (uma vez)

No VPS:

```bash
# Criar pasta para QA
sudo mkdir -p /opt/nevo-qa
sudo chown cadu:cadu /opt/nevo-qa

# Clonar o repositório (ou copiar de /opt/nevo e ajustar remote)
cd /opt/nevo-qa
git clone <URL_DO_SEU_REPO> .
# Ou, se preferir copiar de prod: cp -r /opt/nevo/. /opt/nevo-qa/ (e depois cd /opt/nevo-qa && git status)
```

---

## 2. Arquivo .env do QA no VPS

Na pasta `/opt/nevo-qa`, crie o arquivo `.env` com o **mesmo conteúdo** do seu `.env.qa` local (Supabase do projeto QA, URL do app QA, etc.):

```bash
cd /opt/nevo-qa
nano .env
# Colar as variáveis do .env.qa (NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY,
# SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD, NEXT_PUBLIC_APP_URL=https://nevoqa.pratikapp.com.br, etc.)
```

Ou, da sua máquina, enviar o arquivo (cuidado: não enviar por canal inseguro):

```bash
scp .env.qa cadu@ip_do_vps:/opt/nevo-qa/.env
```

---

## 3. Porta diferente para o QA

O app QA precisa rodar em outra porta (ex.: **3001**) para coexistir com o prod (3000).

**Opção A — Variável de ambiente no .env do QA**

No `.env` em `/opt/nevo-qa`, adicione:

```
PORT=3001
```

O Next.js usa `PORT` quando você roda `npm run start` (build de produção).

**Opção B — Definir na hora de subir o PM2**

Ao criar o processo no PM2 (passo 5), use `-- --port 3001` ou a variável `PORT=3001` no ecosystem.

---

## 4. Build e primeiro start do QA

```bash
cd /opt/nevo-qa
npm ci
npm run build
PORT=3001 npm run start
# Conferir se abre em http://localhost:3001; depois Ctrl+C e seguir para o PM2.
```

---

## 5. PM2: processo separado para o QA

Registrar o app QA no PM2 com **nome e porta** diferentes:

```bash
cd /opt/nevo-qa
pm2 start npm --name "nevo-qa" -- run start -- -p 3001
# Ou, se o Next já ler PORT do .env: pm2 start npm --name "nevo-qa" -- run start
```

Ou use o arquivo **`ecosystem.qa.config.cjs`** (na raiz do repositório):

```bash
cd /opt/nevo-qa
pm2 start ecosystem.qa.config.cjs
pm2 save
```

(O arquivo aponta `cwd` para `/opt/nevo-qa` e porta **3001**; ajuste o `cwd` no arquivo se sua pasta for outra.)

Assim você tem:
- `pm2 list` → nevo (prod, 3000) e nevo-qa (3001)
- `pm2 restart nevo-qa` para reiniciar só o QA

---

## 6. Reverse proxy (Nginx ou Caddy)

O subdomínio **nevoqa.pratikapp.com.br** deve apontar para a porta **3001**.

**Nginx** — novo server block (ex.: `/etc/nginx/sites-available/nevoqa`):

```nginx
server {
    server_name nevoqa.pratikapp.com.br;
    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ativar e recarregar:

```bash
sudo ln -s /etc/nginx/sites-available/nevoqa /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Caddy** — adicionar no Cfile:

```
nevoqa.pratikapp.com.br {
    reverse_proxy localhost:3001
}
```

Lembre de ter o DNS de **nevoqa.pratikapp.com.br** apontando para o IP do VPS.

---

## 7. Deploy posterior do QA (após alterações no código)

Use o script **`scripts/deploy-vps-qa.sh`** (no VPS, na pasta do QA):

```bash
cd /opt/nevo-qa
chmod +x scripts/deploy-vps-qa.sh
./scripts/deploy-vps-qa.sh
```

Ou por SSH a partir da sua máquina:

```bash
ssh cadu@ip_do_vps "cd /opt/nevo-qa && ./scripts/deploy-vps-qa.sh"
```

O script usa por padrão a branch `feature/assistente-pessoal-orcamento` e o comando `pm2 restart nevo-qa`. Para outra branch: `BRANCH=main ./scripts/deploy-vps-qa.sh`.

---

## Resumo

- **Nova pasta:** `/opt/nevo-qa` (não reutilizar `/opt/nevo`).
- **Mesmo repositório**, branch pode ser a de feature; `.env` é o do **projeto QA** (Supabase + `NEXT_PUBLIC_APP_URL=https://nevoqa.pratikapp.com.br`).
- **Porta 3001** para o app QA; **PM2** com nome `nevo-qa`.
- **Proxy** em nevoqa.pratikapp.com.br → `localhost:3001`.
