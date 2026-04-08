// Agenda VARIOS posts em sequencia, lendo de um JSON file.
// Uso:
//   node schedule-batch.js --file=batch.json
//
// Formato do batch.json:
// {
//   "client": "studio-wv2",
//   "posts": [
//     {
//       "image": "C:\\Users\\gabri\\Desktop\\Gabriel Ramos\\Materiais de Criação\\Studio wv2\\2026\\Abril\\0804.jpg",
//       "caption": "Texto da legenda",
//       "schedule": "2026-04-08T18:30:00-03:00"
//     },
//     ...
//   ]
// }

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./lib/env');
const { schedulePost } = require('./schedule-post');

loadEnv();

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return args;
}

function loadClients() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'clients.json'), 'utf8'));
}

async function main() {
  const args = parseArgs();
  if (!args.file) {
    console.error('❌ Faltando --file=batch.json');
    process.exit(1);
  }

  const batchPath = path.resolve(args.file);
  if (!fs.existsSync(batchPath)) {
    console.error(`❌ Arquivo nao encontrado: ${batchPath}`);
    process.exit(1);
  }

  const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
  if (!batch.client || !Array.isArray(batch.posts)) {
    console.error('❌ JSON invalido. Esperado: { client: string, posts: array }');
    process.exit(1);
  }

  const clients = loadClients();
  const client = clients[batch.client];
  if (!client) {
    console.error(`❌ Cliente desconhecido: ${batch.client}`);
    process.exit(1);
  }

  console.log(`\n📋 BATCH: ${batch.posts.length} posts pra ${client.name} (${client.instagram_handle})\n`);

  const results = { sucessos: [], falhas: [] };

  for (let i = 0; i < batch.posts.length; i++) {
    const post = batch.posts[i];
    console.log(`\n━━━ Post ${i + 1}/${batch.posts.length} ━━━`);
    try {
      const result = await schedulePost({
        client,
        clientKey: batch.client,
        imagePath: post.image,
        caption: post.caption,
        scheduledIso: post.schedule
      });
      results.sucessos.push({ image: post.image, media_id: result.media_id, scheduled: result.scheduled_pretty });
    } catch (err) {
      console.error(`❌ FALHA: ${err.message}`);
      results.falhas.push({ image: post.image, erro: err.message });
    }

    // Pequena pausa entre posts pra nao bater rate limit
    if (i < batch.posts.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 RESUMO`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Sucessos: ${results.sucessos.length}`);
  console.log(`❌ Falhas:   ${results.falhas.length}`);

  if (results.sucessos.length > 0) {
    console.log(`\n✅ AGENDADOS:`);
    for (const s of results.sucessos) {
      console.log(`   • ${path.basename(s.image)} → ${s.scheduled} (id ${s.media_id})`);
    }
  }

  if (results.falhas.length > 0) {
    console.log(`\n❌ FALHAS:`);
    for (const f of results.falhas) {
      console.log(`   • ${path.basename(f.image)}: ${f.erro}`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`\n❌ ERRO FATAL: ${err.message}`);
  process.exit(1);
});
