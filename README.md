# publisher-tool

Tool de agendamento de posts em Instagram via Meta Graph API. Usado pela skill `/poster` do time virtual do Gabriel.

## Por que existe

A skill `/criator` ja gera as artes. O `/calendario` planeja o mes. Mas pra **agendar de verdade no Business Suite**, voce precisa entrar la manualmente, fazer upload, escrever legenda, marcar pessoas, escolher data. Esse tool elimina isso.

## Como funciona (alto nivel)

1. Voce deixa as artes prontas na pasta do cliente (ex: `Studio wv2/2026/Abril/0804.jpg`)
2. A skill `/poster` ve as artes, gera as legendas, manda pra voce aprovar
3. Voce manda lista de datas no formato: `0804 8 de abril 18h30`
4. A skill chama `schedule-batch.js` que pra cada arte:
   - Sobe a imagem pro catbox.moe (host gratuito) pra ter URL publica
   - Cria media container no Instagram via Graph API com legenda + user_tags + scheduled_publish_time
   - Publica o container (que entra como agendado no IG)

## Estrutura

```
publisher-tool/
├── package.json          (sem deps externas, Node 18+ nativo)
├── .env                  (META_APP_ID, META_APP_SECRET, META_API_VERSION)
├── .gitignore            (ignora .env, clients.json, scheduled-log.json)
├── clients.json          (mapa cliente → page_id, ig_user_id, page_token, user_tags) — SENSIVEL
├── lib/
│   ├── env.js            (loader minimo de .env)
│   ├── meta-client.js    (wrapper de fetch pra Graph API)
│   ├── upload-image.js   (sobe pro catbox.moe)
│   └── parse-dates.js    (parser do formato "0804 8 de abril 18h30")
├── schedule-post.js      (agenda 1 post)
├── schedule-batch.js     (agenda varios via batch.json)
├── test-token.js         (valida que token de cada cliente funciona)
└── scheduled-log.json    (log local de tudo que foi agendado, para auditoria)
```

## Setup

Requer Node 18+ (testado em Node 24). Sem `npm install`, sem dependencias.

`.env` ja vem preenchido com:
- `META_APP_ID` — id do app Gabriel Trafego API
- `META_APP_SECRET` — secret do mesmo app (necessario pra renovar tokens)
- `META_API_VERSION` — v21.0

`clients.json` tem o page token e ig user id de cada cliente. **Sensivel — nao versionar**.

## Uso

### Validar tokens
```bash
cd /c/Users/gabri/publisher-tool
PATH="/c/Program Files/nodejs:$PATH" node test-token.js
```

### Agendar 1 post
```bash
PATH="/c/Program Files/nodejs:$PATH" node schedule-post.js \
  --client=studio-wv2 \
  --image="C:/Users/gabri/Desktop/Gabriel Ramos/Materiais de Criação/Studio wv2/2026/Abril/0804.jpg" \
  --caption="Hidrate-se! Sua performance comeca antes do treino." \
  --schedule="2026-04-08T18:30:00-03:00"
```

### Agendar lote
```bash
PATH="/c/Program Files/nodejs:$PATH" node schedule-batch.js --file=batch-abril.json
```

Formato do batch JSON:
```json
{
  "client": "studio-wv2",
  "posts": [
    {
      "image": "C:\\Users\\gabri\\Desktop\\Gabriel Ramos\\Materiais de Criação\\Studio wv2\\2026\\Abril\\0804.jpg",
      "caption": "Texto da legenda",
      "schedule": "2026-04-08T18:30:00-03:00"
    }
  ]
}
```

## Limitacoes do Instagram Graph API

- **Agendamento**: minimo 10 minutos no futuro, maximo 75 dias
- **Caption**: maximo 2200 caracteres
- **user_tags (marcacao de pessoa)**: SO funciona em fotos do feed (single image / carrossel). NAO funciona em Reels nem Stories.
- **Stories**: API nao agenda — apenas publicacao imediata
- **Reels**: agenda, mas sem marcacao de pessoa via API

## REGRAS DURAS

- ❌ **NUNCA postar imediato.** Sempre `scheduled_publish_time` no futuro. O Gabriel decidiu isso explicitamente.
- ❌ **NUNCA modificar/deletar post ja publicado** sem ordem direta.
- ✅ Sempre logar agendamento em `scheduled-log.json`.

## Futuro (proximas iteracoes, nao implementado)

- `list-scheduled.js` — listar tudo agendado (vai ler do log local)
- `cancel-scheduled.js` — cancelar agendamento (limitado pela API, talvez precise via Business Suite manual)
- Suporte a **carrossel** (multiplas imagens em 1 post)
- Suporte a **Reels** (vai precisar `media_type=REELS` + cover image)
- `refresh-token.js` — renovar long-lived token automaticamente antes de expirar

## Token

O token long-lived do user dura 60 dias. Page tokens derivados de long-lived user tokens **nao expiram** (no caso normal). O page token de cada cliente esta no `clients.json`. Se algum dia der erro de token expirado, rode:

```bash
# 1. Vai pro Graph API Explorer e gera novo user token
# 2. Faz a troca pra long-lived (precisa do META_APP_SECRET no .env):
curl "https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=$META_APP_ID&client_secret=$META_APP_SECRET&fb_exchange_token=NOVO_TOKEN_CURTO"
# 3. Pega o long-lived
# 4. Roda GET /me/accounts pra pegar os novos page tokens
# 5. Atualiza clients.json
```

## Referencia tecnica

- [Instagram Content Publishing API](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
- [Long-lived Access Tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/)
- [Page Access Tokens](https://developers.facebook.com/docs/pages/access-tokens/)
