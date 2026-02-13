# Testar WhatsApp com Twilio Sandbox

Este guia explica como conectar o Nevo ao **sandbox do WhatsApp da Twilio** para testar envio e recebimento de mensagens sem precisar de um número WhatsApp Business aprovado.

---

## Onde pegar cada informação (mapeamento da interface Twilio)

Se você está vendo a tela da Twilio de envio de mensagem (formulário + exemplo de código Node.js), use este mapeamento:

| O que você vê na Twilio | Onde pegar | Onde colocar no Nevo |
|------------------------|------------|----------------------|
| **Account SID** | No código Node.js: `const accountSid = 'AC...'` ou no [Console Twilio](https://console.twilio.com/) → home / Account | **Agentes** → seu agente → aba **Canais** → campo **Account SID (Twilio)** |
| **Auth Token** | **Não** está na imagem (aparece como `[AuthToken]`). Pegue no [Console Twilio](https://console.twilio.com/) → **Account** → “Auth Token” (ou **Account** → API keys) | **Canais** → campo **Auth Token (Twilio)** |
| **From** (ex.: `whatsapp:+14155238886`) | Formulário “From” ou no código `from: 'whatsapp:+14155238886'` — é o número do sandbox/número Twilio | Para o fluxo de **conversa** (webhook) o Nevo usa o número que a Twilio envia no request; o campo **Número de telefone** (opcional) no Nevo pode ser preenchido com `+14155238886` só para referência. |
| **Content SID** / **contentVariables** | Aparecem quando você envia **template** (ex.: “Appointment Reminders”) | O Nevo hoje responde com **texto livre** (Body). Envio de templates (Content SID + variáveis) ainda não tem tela no Nevo; quando houver, será em configuração de mensagens/templates. |

Resumo prático para configurar **agora** no Nevo:

1. **Account SID** → copie do código na imagem (`AC4a57...`) ou do Console Twilio → cole no Nevo em **Canais** → **Account SID**.
2. **Auth Token** → pegue só no Console Twilio (Account / API keys), nunca na imagem → cole no Nevo em **Canais** → **Auth Token**.
3. Clique em **Salvar credenciais** no Nevo.
4. **Se a URL do webhook não aparecer:** o Nevo só gera a URL quando a variável **`NEXT_PUBLIC_APP_URL`** (ou `VERCEL_URL`) está definida. Em desenvolvimento local, defina no `.env.local` por exemplo `NEXT_PUBLIC_APP_URL=https://sua-url-ngrok.ngrok.io`, reinicie o servidor, salve de novo as credenciais e a URL será exibida. Se preferir não configurar a variável, use o **modelo** que a tela de Canais mostra (ex.: `https://SEU-DOMINIO/api/webhooks/twilio/{id-do-agente}`), substitua `SEU-DOMINIO` pela sua URL pública (ex. ngrok) e copie.
5. Copie a **URL do webhook** (gerada ou montada) e configure na Twilio em **Sandbox settings** → “When a message comes in”.

---

## 1. Cadastro e ativação do sandbox (Twilio Console)

1. Acesse [Twilio Console](https://console.twilio.com/) e faça login.
2. No menu lateral: **Messaging** → **Try it out** → **Send a WhatsApp message** (ou **Messaging** → **WhatsApp** → **Sandbox**).
3. Na página do **WhatsApp Sandbox** você verá:
   - Um **número Twilio** (ex.: `+1 415 523 8886`) e um **código de ativação** (ex.: `join <palavra>-<outra>`).
   - Instruções para “join” (entrar no sandbox).
4. No seu **WhatsApp pessoal** (celular):
   - Adicione o número do sandbox como contato (ex.: +1 415 523 8886).
   - Envie exatamente a mensagem que a Twilio mostra, algo como: `join palavra-outra`.
   - A Twilio confirma que você entrou no sandbox.
5. Anote:
   - **Account SID** e **Auth Token** (em [Console → Account](https://console.twilio.com/) ou na home).
   - O **número do sandbox** no formato que a Twilio usar (ex.: `whatsapp:+14155238886`).

---

## 2. Configurar o agente no Nevo (Canais → WhatsApp)

1. No Nevo, vá em **Agentes** → abra o agente que vai usar o WhatsApp.
2. Aba **Canais**.
3. Em **Twilio**:
   - **Account SID**: cole o Account SID da Twilio.
   - **Auth Token**: cole o Auth Token da Twilio.
4. Clique em **Salvar credenciais**.
5. A aplicação vai gerar a **URL do webhook** (ex.: `https://seu-dominio.com/api/webhooks/twilio/{id-do-agente}`).
   - Para isso, em produção/staging é preciso ter `NEXT_PUBLIC_APP_URL` (ou `VERCEL_URL`) configurado; em desenvolvimento local use um túnel (ngrok, etc.) e essa URL pública.
6. **Copie a URL do webhook** exibida na tela (ela já inclui o `agentId` correto).

---

## 3. Configurar o webhook na Twilio

1. No Twilio Console: **Messaging** → **Try it out** → **Send a WhatsApp message** (ou **Sandbox**).
2. Na seção **Sandbox settings** (ou configuração do sandbox):
   - Procure por **“When a message comes in”** (URL do webhook para mensagens recebidas).
   - Cole a URL que você copiou do Nevo, ex.:
     `https://seu-dominio.com/api/webhooks/twilio/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
   - Método: **POST** (a Twilio envia POST com `application/x-www-form-urlencoded`).
3. Salve a configuração.

Assim, toda mensagem que alguém enviar para o número do sandbox será encaminhada para essa URL; o Nevo processa e responde usando o agente configurado.

---

## 4. Testando

1. No seu WhatsApp (o mesmo que fez `join` no sandbox), envie uma mensagem **para o número do sandbox** (ex.: +1 415 523 8886).
2. Exemplo: “Olá” ou “Quero agendar”.
3. O fluxo do agente (respostas, fluxo de atendimento, etc.) deve rodar e a resposta deve voltar pelo WhatsApp.

Se não receber resposta:

- Confira se a URL do webhook está correta (incluindo o `agentId` no final).
- Em ambiente local, use **ngrok** (ou similar) e configure na Twilio a URL pública (ex.: `https://abc123.ngrok.io/api/webhooks/twilio/{agentId}`).
- Verifique os logs do servidor (Next.js) e do Supabase (Edge Function `conversations-turn`) para erros.

---

## 5. Usar o sandbox com o app em localhost

**Sim, dá para usar o sandbox com o Nevo rodando em localhost.** A Twilio não acessa seu computador; ela precisa de uma URL pública para enviar as mensagens. Use um **túnel** (ex.: ngrok) que expõe seu `localhost` na internet em HTTPS.

1. Deixe o Nevo rodando: `npm run dev` (porta 3000).
2. Em outro terminal, rode o túnel: `npm run tunnel` (ou, se tiver ngrok instalado globalmente, `ngrok http 3000`). O ngrok mostra uma URL pública (ex.: `https://abc123.ngrok-free.app`).
3. No projeto Nevo, crie ou edite `.env.local` e defina `NEXT_PUBLIC_APP_URL=https://abc123.ngrok-free.app` (use a URL que o ngrok mostrou).
4. Reinicie o `npm run dev`. No Nevo: **Agentes** → seu agente → **Canais** → **Salvar credenciais**. A URL do webhook deve aparecer.
5. Copie essa URL e, no Twilio Console → **Messaging** → **Sandbox** → **Sandbox settings**, no campo "When a message comes in", cole e salve.

Se você reiniciar o ngrok, a URL pode mudar (plano gratuito); aí basta atualizar `NEXT_PUBLIC_APP_URL`, reiniciar o dev, salvar as credenciais de novo no Nevo e atualizar a URL na Twilio.

---

## 6. Opções (botões) no WhatsApp

No **simulador**, as respostas podem vir com botões (datas, dias, serviços, "Quero agendar", etc.). No WhatsApp hoje:

- **Comportamento atual:** as mesmas opções são enviadas **em texto** no final da mensagem, por exemplo:
  - _Opções (responda com o texto):_
  - • Quero agendar
  - • Só queria saber  
  O usuário responde digitando o texto da opção (ex.: "Quero agendar"); o fluxo interpreta igual ao simulador.

- **Botões nativos (futuro):** a Twilio suporta **Quick Reply** (até 3 botões na sessão) e **List** (até 10 itens) via **Content Template Builder** e envio com `ContentSid`. Exige criar e, em alguns casos, aprovar templates no Console Twilio. Quando quiser usar botões nativos, crie um template do tipo `twilio/quick-reply` ou `twilio/list-picker` e adapte o webhook para enviar com Content API em vez de só `Body`.

---

## 7. Encerrar / reiniciar conversa (testes)

Para **reiniciar o atendimento** e testar do zero (WhatsApp ou simulador), envie uma destas mensagens:

- **encerrar** ou **encerrar teste**
- **reiniciar** ou **resetar**
- **encerrar conversa** ou **reiniciar conversa**

O agente responde: *"Conversa encerrada. Quando quiser, é só mandar uma mensagem para começar de novo."* e o estado da conversa é zerado. A próxima mensagem inicia o fluxo do início (saudação, etc.).

---

## Resumo do fluxo

1. Usuário envia mensagem no WhatsApp para o número do sandbox.
2. Twilio envia **POST** para `https://seu-dominio/api/webhooks/twilio/{agentId}` (body `application/x-www-form-urlencoded` com `From`, `To`, `Body`, etc.).
3. O Nevo identifica o agente pelo `agentId` na URL, carrega configuração e credenciais, chama a Edge Function `conversations-turn` com `channel: 'whatsapp'` e `from: <número do usuário>`.
4. A Edge Function processa a mensagem (mesma lógica do simulador) e devolve a resposta.
5. O webhook envia a resposta de volta ao usuário via API da Twilio (Messages.create).
6. A Twilio entrega a mensagem no WhatsApp do usuário.

---

## Variáveis de ambiente necessárias

- **Next.js (API / webhook):**
  - `NEXT_PUBLIC_SUPABASE_URL` – URL do projeto Supabase.
  - `SUPABASE_SERVICE_ROLE_KEY` – chave de serviço (para o webhook carregar agente e credenciais e chamar a Edge Function).
  - `NEXT_PUBLIC_APP_URL` (ou `VERCEL_URL`) – URL pública do app (para montar o webhook e exibir na tela de Canais).

Credenciais Twilio (Account SID e Auth Token) são armazenadas por agente no banco (`agent_channel_whatsapp`), não em variáveis de ambiente.
