// Agenda UM unico post no Instagram via Meta Graph API.
// Uso:
//   node schedule-post.js \
//     --client=studio-wv2 \
//     --image="C:/path/to/0804.jpg" \
//     --caption="Texto da legenda" \
//     --schedule="2026-04-08T18:30:00-03:00"
//
// O que faz:
//   1. Carrega config do cliente (clients.json)
//   2. Sobe a imagem pro catbox.moe
//   3. Cria media container no IG (com user_tags e scheduled_publish_time)
//   4. Publica o container (que entra como agendado)
//   5. Loga em scheduled-log.json
//
// Limitacoes do IG:
//   - scheduled_publish_time: minimo 10 min, maximo 75 dias no futuro
//   - user_tags so funcionam em fotos do feed (single image / carrossel)
//   - caption maxima 2200 caracteres

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./lib/env');
const { metaPost } = require('./lib/meta-client');
const { uploadImage } = require('./lib/upload-image');

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
  const clientsPath = path.join(__dirname, 'clients.json');
  if (!fs.existsSync(clientsPath)) {
    throw new Error('clients.json nao encontrado em ' + clientsPath);
  }
  return JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
}

function appendLog(entry) {
  const logPath = path.join(__dirname, 'scheduled-log.json');
  let log = [];
  if (fs.existsSync(logPath)) {
    try {
      log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    } catch (e) {
      log = [];
    }
  }
  log.push(entry);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
}

async function schedulePost({ client, clientKey, imagePath, caption, scheduledIso }) {
  // Validacoes
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Imagem nao encontrada: ${imagePath}`);
  }
  if (caption.length > 2200) {
    throw new Error(`Caption tem ${caption.length} caracteres, maximo permitido pelo IG e 2200`);
  }

  const scheduledDate = new Date(scheduledIso);
  if (isNaN(scheduledDate.getTime())) {
    throw new Error(`Data invalida: ${scheduledIso}`);
  }
  const scheduledUnix = Math.floor(scheduledDate.getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  const diffMin = (scheduledUnix - now) / 60;

  if (diffMin < 10) {
    throw new Error(`Agendamento precisa ser pelo menos 10 min no futuro (atual: ${diffMin.toFixed(1)} min). REGRA: nunca postar imediato.`);
  }
  if (diffMin > 75 * 24 * 60) {
    throw new Error(`Agendamento precisa ser ate 75 dias no futuro (atual: ${(diffMin / (24 * 60)).toFixed(1)} dias)`);
  }

  // Etapa 1: subir imagem
  console.log(`📤 [${path.basename(imagePath)}] Subindo imagem pro host...`);
  const imageUrl = await uploadImage(imagePath);
  console.log(`   ✅ Hospedada: ${imageUrl}`);

  // Etapa 2: montar user_tags em posicoes distribuidas
  const userTags = (client.default_user_tags || []).map((username, i, arr) => ({
    username,
    x: 0.2 + (i * (0.6 / Math.max(arr.length - 1, 1))),
    y: 0.5
  }));

  // Etapa 3: criar media container
  console.log(`📦 [${path.basename(imagePath)}] Criando container no IG...`);
  const containerParams = {
    image_url: imageUrl,
    caption,
    published: 'false',
    scheduled_publish_time: scheduledUnix,
    access_token: client.page_access_token
  };
  if (userTags.length > 0) {
    containerParams.user_tags = JSON.stringify(userTags);
  }

  const container = await metaPost(`${client.ig_user_id}/media`, containerParams);
  console.log(`   ✅ Container: ${container.id}`);

  // Etapa 4: publicar (entra agendado)
  console.log(`🚀 [${path.basename(imagePath)}] Publicando container (agendado)...`);
  const publish = await metaPost(`${client.ig_user_id}/media_publish`, {
    creation_id: container.id,
    access_token: client.page_access_token
  });

  const result = {
    media_id: publish.id,
    container_id: container.id,
    image_url: imageUrl,
    image_local: imagePath,
    caption,
    scheduled_iso: scheduledIso,
    scheduled_unix: scheduledUnix,
    scheduled_pretty: scheduledDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    user_tags: userTags.map(t => t.username),
    client: clientKey,
    client_name: client.name,
    ig_handle: client.instagram_handle,
    created_at: new Date().toISOString()
  };

  appendLog(result);

  console.log(`\n✅ AGENDADO`);
  console.log(`   Data: ${result.scheduled_pretty}`);
  console.log(`   Conta: ${result.ig_handle}`);
  console.log(`   Marcacoes: @${result.user_tags.join(', @')}`);
  console.log(`   Media ID: ${result.media_id}`);
  return result;
}

async function main() {
  const args = parseArgs();
  const required = ['client', 'image', 'caption', 'schedule'];
  for (const k of required) {
    if (!args[k]) {
      console.error(`❌ Faltando --${k}`);
      console.error('Uso: node schedule-post.js --client=studio-wv2 --image=path --caption="..." --schedule="2026-04-08T18:30:00-03:00"');
      process.exit(1);
    }
  }

  const clients = loadClients();
  const client = clients[args.client];
  if (!client) {
    console.error(`❌ Cliente desconhecido: ${args.client}`);
    console.error(`Clientes disponiveis: ${Object.keys(clients).join(', ')}`);
    process.exit(1);
  }

  await schedulePost({
    client,
    clientKey: args.client,
    imagePath: args.image,
    caption: args.caption,
    scheduledIso: args.schedule
  });
}

if (require.main === module) {
  main().catch(err => {
    console.error(`\n❌ ERRO: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { schedulePost };
