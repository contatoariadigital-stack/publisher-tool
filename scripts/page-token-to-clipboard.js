// Deriva o token de PAGINA do cliente a partir do user token do meta-ads-tool (META_ACCESS_TOKEN,
// long-lived, nao expira) e copia pro clipboard do Windows SEM imprimir na tela.
// Uso: node scripts/page-token-to-clipboard.js studio-wv2
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const key = process.argv[2] || 'studio-wv2';
const clients = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'clients.json'), 'utf8'));
const client = clients[key];
if (!client) { console.error(`Cliente ${key} nao existe em clients.json`); process.exit(1); }

const envTxt = fs.readFileSync('C:/Users/gabri/meta-ads-tool/.env', 'utf8');
const m = envTxt.match(/^META_ACCESS_TOKEN=(.+)$/m);
if (!m) { console.error('META_ACCESS_TOKEN nao encontrado em meta-ads-tool/.env'); process.exit(1); }
const userToken = m[1].trim();

(async () => {
  const r = await fetch(`https://graph.facebook.com/v21.0/${client.page_id}?fields=access_token,name&access_token=${userToken}`);
  const j = await r.json();
  if (j.error) { console.error('Erro Meta:', j.error.message); process.exit(1); }
  const check = await (await fetch(`https://graph.facebook.com/v21.0/${client.ig_user_id}?fields=username&access_token=${j.access_token}`)).json();
  if (check.error) { console.error('Page token nao le o IG:', check.error.message); process.exit(1); }
  const clip = spawnSync('clip', { input: j.access_token });
  if (clip.status !== 0) { console.error('Falha ao copiar pro clipboard'); process.exit(1); }
  const secret = 'FB_PAGE_TOKEN_' + key.toUpperCase().replace(/-/g, '_');
  console.log(`OK: token da pagina "${j.name}" (le @${check.username}) copiado pro clipboard (${j.access_token.length} chars). Cole no secret ${secret}.`);
})();
