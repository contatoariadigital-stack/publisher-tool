// Valida que o page access token de cada cliente em clients.json funciona.
// Roda: node test-token.js

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./lib/env');
const { metaGet } = require('./lib/meta-client');

loadEnv();

async function main() {
  const clients = JSON.parse(fs.readFileSync(path.join(__dirname, 'clients.json'), 'utf8'));

  console.log(`🧪 Testando ${Object.keys(clients).length} cliente(s)...\n`);

  let ok = 0;
  let fail = 0;

  for (const [key, client] of Object.entries(clients)) {
    try {
      // Testa: GET na page
      const page = await metaGet(client.page_id, {
        fields: 'id,name',
        access_token: client.page_access_token
      });

      // Testa: GET na conta IG
      const ig = await metaGet(client.ig_user_id, {
        fields: 'id,username,name,profile_picture_url,followers_count,media_count',
        access_token: client.page_access_token
      });

      console.log(`✅ ${key}`);
      console.log(`   Page: ${page.name} (${page.id})`);
      console.log(`   IG:   @${ig.username} — ${ig.followers_count} seguidores, ${ig.media_count} posts`);
      console.log('');
      ok++;
    } catch (err) {
      console.log(`❌ ${key}`);
      console.log(`   ${err.message}`);
      console.log('');
      fail++;
    }
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ ${ok} ok | ❌ ${fail} falhas`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`Erro fatal: ${err.message}`);
  process.exit(1);
});
