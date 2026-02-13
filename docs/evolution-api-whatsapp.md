# Evolution API como canal WhatsApp (não oficial)

Este documento analisa a **Evolution API** como opção para conectar o Nevo ao WhatsApp **sem usar a API oficial** (Meta/Twilio), com base na [documentação oficial](https://doc.evolution-api.com/v2/pt/get-started/introduction) e no [repositório](https://github.com/EvolutionAPI/evolution-api).

---

## O que é a Evolution API

- **API aberta** que conecta ao WhatsApp usando **Baileys** (protocolo tipo WhatsApp Web), ou à **API oficial** (Cloud API).
- Projeto gratuito, focado em pequenos negócios e desenvolvedores.
- Suporta:
  - **WhatsApp (Baileys)** – conexão via QR Code, sem aprovação Meta; sujeito a políticas do WhatsApp.
  - **WhatsApp Cloud API** – API oficial da Meta (requer aprovação e pode ter custo).
- Recursos relevantes para o Nevo: **webhooks** (mensagens recebidas), **envio de texto/mídia**, **múltiplas instâncias**, integrações (Typebot, Chatwoot, etc.).

Referência: [Introdução v1](https://doc.evolution-api.com/v1/pt/get-started/introduction), [Introdução v2](https://doc.evolution-api.com/v2/pt/get-started/introduction).

---

## Viabilidade para o Nevo

### Vantagens

| Aspecto | Detalhe |
|--------|--------|
| **Conexão sem API oficial** | Conexão via QR Code (Baileys); não exige número Business aprovado pela Meta nem conta Twilio. |
| **Sem limite de sandbox** | Não há restrição de “poucas mensagens” como no sandbox da Twilio. |
| **Webhooks** | Evento `MESSAGES_UPSERT` permite receber mensagens em tempo real e chamar a mesma Edge Function `conversations-turn` que o Twilio já usa. |
| **Envio de texto** | Endpoint para enviar mensagem de texto ([Send Plain Text](https://doc.evolution-api.com/v1/api-reference/message-controller/send-text.md)); suficiente para respostas do bot. |
| **Self-hosted** | Pode ser instalada no seu próprio servidor (Docker/NVM), controlando dados e disponibilidade. |
| **Custo** | Software gratuito; custo fica em servidor/hosting. |

### Riscos e limitações

| Aspecto | Detalhe |
|--------|--------|
| **Políticas do WhatsApp** | Uso não oficial (Baileys) pode violar os [Termos de Serviço](https://www.whatsapp.com/legal/updates/terms-of-service) do WhatsApp. Risco de bloqueio do número. |
| **Estabilidade** | Depende do protocolo não oficial; quebras e mudanças pelo WhatsApp podem afetar a Evolution. |
| **Produção** | A documentação recomenda docker-compose para produção; uso apenas para testes/baixo volume costuma ser o cenário mais seguro. |
| **Funcionalidades** | Templates, listas e botões podem ter suporte diferente da API oficial; para “texto + opções em texto” o Nevo já está preparado. |

### Conclusão de viabilidade

- **Viável para:** testes, MVP, ambientes controlados ou negócios que aceitam o risco de uso não oficial.
- **Não recomendado como única opção** para negócios que dependem de conformidade e alta disponibilidade; nesses casos a API oficial (Twilio/Meta) continua mais adequada.
- **Recomendação:** tratar a Evolution API como **canal opcional** (ex.: “WhatsApp via Evolution”), em paralelo ao canal Twilio, com aviso na UI de que a conexão é não oficial e pode ter restrições.

---

## O que seria necessário no Nevo

Para oferecer “conectar no WhatsApp sem API oficial” via Evolution API, o projeto precisaria de:

1. **Backend**
   - Novo **webhook** (ex.: `POST /api/webhooks/evolution/[agentId]`) que:
     - Recebe o payload do evento `MESSAGES_UPSERT` (ou similar) da Evolution.
     - Extrai remetente (`from`), texto da mensagem e instância.
     - Chama a Edge Function `conversations-turn` com `channel: 'whatsapp'`, `from`, `message`, `tenant_id`, `agent_id`, etc. (mesmo contrato usado pelo webhook Twilio).
     - Envia a resposta ao usuário via **API da Evolution** (endpoint de envio de texto da instância).
   - Configuração por agente: **URL da Evolution API**, **nome da instância**, **API key** (ou JWT), em vez de Twilio (Account SID / Auth Token).
   - Opcional: tela ou fluxo para **gerar/conectar instância** (QR Code) usando a API da Evolution ([Instance Connect](https://doc.evolution-api.com/v1/api-reference/instance-controller/instance-connect.md)).

2. **Banco de dados**
   - Estender **canal WhatsApp** para suportar `provider: 'evolution'` além de `provider: 'twilio'`.
   - Nova tabela ou campos (ex.: `agent_channel_whatsapp`) para guardar: `evolution_base_url`, `evolution_instance`, `evolution_api_key` (ou token criptografado).

3. **Documentação**
   - Guia “Conectar WhatsApp via Evolution API” (instalação da Evolution, criação de instância, configurar webhook na Evolution apontando para o Nevo, configurar o agente no Nevo).
   - Aviso claro de que a conexão é **não oficial** e sujeita a políticas do WhatsApp.

4. **UI**
   - Na aba **Canais** do agente: opção “WhatsApp (Twilio)” vs “WhatsApp (Evolution API)”; quando Evolution for escolhido, exibir campos de URL, instância e chave, e instruções para configurar o webhook na Evolution.

---

## Referências

- [Evolution API – Introdução (v2, PT)](https://doc.evolution-api.com/v2/pt/get-started/introduction)
- [Evolution API – Índice da documentação](https://doc.evolution-api.com/llms.txt)
- [Webhooks (configuração e eventos)](https://doc.evolution-api.com/v1/pt/configuration/webhooks.md) – evento `MESSAGES_UPSERT` para mensagens recebidas
- [Instance Connect (QR Code)](https://doc.evolution-api.com/v1/api-reference/instance-controller/instance-connect.md)
- [Send Plain Text](https://doc.evolution-api.com/v1/api-reference/message-controller/send-text.md)
- [Repositório Evolution API](https://github.com/EvolutionAPI/evolution-api)
- [Twilio Sandbox no Nevo](./twilio-sandbox-teste.md) – fluxo atual de WhatsApp via Twilio

---

## Implementação no Nevo (concluída)

O Nevo suporta Evolution API como canal WhatsApp alternativo:

- **Webhook:** `POST /api/webhooks/evolution/[agentId]` – recebe MESSAGES_UPSERT, chama `conversations-turn` e envia resposta via Evolution (`/message/sendText/{instance}`).
- **Banco:** `agent_channel_whatsapp` com `provider: 'evolution'`, colunas `evolution_base_url`, `evolution_instance`, `evolution_api_key_encrypted`.
- **UI:** Aba Canais do agente com abas **Twilio** e **Evolution API**; ao escolher Evolution, campos URL base, instância e API key.
- **QR Code no Nevo:** Após salvar credenciais Evolution, o botão "Conectar WhatsApp" exibe o QR Code direto no Nevo. O cliente escaneia com o celular sem precisar acessar a Evolution.

---

## Instalação local (Docker)

O projeto inclui `docker-compose.evolution.yaml` para subir a Evolution API com PostgreSQL e Redis:

```powershell
docker compose -f docker-compose.evolution.yaml up -d
```

- **API:** http://localhost:8080
- **Manager (criar instância / QR Code):** http://localhost:8080/manager
- **API Key configurada:** `evonevo2025` (use essa chave no Nevo ao configurar o canal Evolution)

Para parar: `docker compose -f docker-compose.evolution.yaml down`

---

## Solução de problemas

### QR Code não aparece nem no Manager nem no Nevo

Se o botão "Get QR Code" no Manager e o "Conectar WhatsApp" no Nevo **não geram QR Code**:

1. **Tipo da instância — causa mais comum**
   - QR Code só existe para **WhatsApp Web (Baileys)**. Instâncias **WhatsApp Cloud API** usam outro fluxo (sem QR).
   - Ao criar a instância no Manager, escolha **"WhatsApp Web"** ou **"Baileys"**, não "Cloud API".
   - Se criou como Cloud API: exclua a instância, crie uma nova e selecione WhatsApp Web/Baileys.

2. **Teste direto na Evolution**
   ```powershell
   # Opção 1: script do projeto
   .\scripts\test-evolution.ps1 -BaseUrl "http://localhost:8080" -Instance "nevo" -ApiKey "evonevo2025"

   # Opção 2: curl
   curl -X GET "http://localhost:8080/instance/connect/nevo" -H "apikey: evonevo2025"
   ```
   - Se retornar JSON com `code` ou `base64` → a Evolution está ok; o problema pode ser no Nevo ou no Manager (browser).
   - Se retornar 404 → instância não existe ou nome incorreto (use o nome exato exibido no Manager).
   - Se retornar 401 → API Key incorreta.
   - Se falhar (conexão recusada) → Evolution não está rodando: `docker compose -f docker-compose.evolution.yaml up -d`.

3. **Logs da Evolution**
   ```powershell
   docker logs evolution_api --tail 50
   ```
   Procure erros (WhatsApp, Baileys, timeout, etc.).

4. **Evolution retorna `{"count":0}` sem QR Code ou RESTART retorna 404**
   - Erro conhecido em imagens atendai/evolution-api. O repositório oficial usa **evoapicloud/evolution-api**.
   - **Solução 1 (imagem evoapicloud):** O docker-compose.evolution.yaml já usa `evoapicloud/evolution-api:latest`. Recrie os containers do zero:
     ```powershell
     docker compose -f docker-compose.evolution.yaml down
     docker compose -f docker-compose.evolution.yaml pull
     docker compose -f docker-compose.evolution.yaml up -d
     ```
   - **Solução 2 (phone version):** Atualize `CONFIG_SESSION_PHONE_VERSION` com a versão atual do WhatsApp Web em https://web.whatsapp.com/check-update?version=0&platform=web (campo `currentVersion`). O docker-compose.evolution.yaml já inclui um valor; atualize se necessário.
   - **Solução 3 (proxy):** Alguns usuários relatam que configurar proxy resolve. No docker-compose, descomente e preencha `PROXY_HOST`, `PROXY_PORT`, `PROXY_PROTOCOL`.
   - Depois exclua a instância no Manager e crie outra (Baileys/WhatsApp Web).

### 502 Bad Gateway no Nevo

Se ao clicar em "Conectar WhatsApp" aparecer **502 Bad Gateway**:

1. **Evolution rodando:** `docker ps` — o container `evolution_api` deve estar ativo.
2. **URL base correta:** Em desenvolvimento local, use `http://localhost:8080` (sem barra no final).
3. **Instância existente:** A instância precisa existir antes de conectar. Crie em http://localhost:8080/manager e use o nome exato (o Manager pode exibir UUID — copie exatamente).
4. **API Key:** Use a **API Key do servidor** (`AUTHENTICATION_API_KEY` do docker-compose — local é `evonevo2025`). O token da instância exibido no Manager *não* é usado no Nevo.
5. **Produção:** Em produção, a Evolution não pode ser `localhost` para o Next.js; use a URL pública da Evolution (ex.: `https://evolution.seudominio.com`).### 401 Unauthorized ao acessar a Evolution em certas URLs

- **Raiz (http://localhost:8080)** → funciona (health check sem auth)
- **Outras rotas** (ex.: `/instance/connect/nevo`, `/manager`) → exigem autenticação

A Evolution API exige a API Key para quase todos os endpoints. Ao abrir a URL no navegador, você não envia o header `apikey`, então recebe 401. Isso é esperado.

O Nevo envia a API Key automaticamente nas chamadas à Evolution. O 401 só aparece no navegador, não nas requisições do Nevo.

### Indicador de digitação ("digitando...") não aparece

O Nevo chama `POST /chat/sendPresence/{instance}` antes de processar a mensagem para exibir os 3 pontinhos no WhatsApp. Se não funcionar:

1. **Verificar logs:** O Nevo registra `[webhooks/evolution] sendPresence falhou:` ou `sendPresence erro:` quando a chamada falha. Confira o status HTTP e a mensagem.
2. **Limitação do Baileys:** O protocolo Baileys (WhatsApp Web não oficial) às vezes não exibe o indicador de digitação corretamente; é uma limitação conhecida do [Baileys](https://github.com/WhiskeySockets/Baileys/issues/866).
3. **Testar direto na Evolution:**
   ```powershell
   curl -X POST "http://localhost:8080/chat/sendPresence/SUA_INSTANCIA" `
     -H "Content-Type: application/json" `
     -H "apikey: evonevo2025" `
     -d '{"number":"5511999999999","options":{"presence":"composing","delay":10000,"number":"5511999999999"}}'
   ```
   Troque `SUA_INSTANCIA` e o número pelo seu. Resposta 201 = sucesso; 4xx/5xx = conferir formato e documentação.