// Adiciona posts ao queue/pending.json a partir de um arquivo de batch.
// Roda LOCAL — voce comita o resultado e empurra pro GitHub.
//
// Uso:
//   node scripts/add-to-queue.js --batch=batch-abril-studio-wv2.json
//
// O que faz:
//   1. Le o batch JSON
//   2. Valida cliente, imagens, datas
//   3. Copia cada imagem pra assets/<client>/<YYYY-MM>/<filename>
//   4. Adiciona entradas no queue/pending.json (gera id unico, normaliza paths relativos)
//   5. Pronto pra commitar

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return args;
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

function main() {
  const args = parseArgs();
  if (!args.batch) {
    console.error('Faltando --batch=arquivo.json');
    process.exit(1);
  }

  const batchPath = path.resolve(args.batch);
  if (!fs.existsSync(batchPath)) {
    console.error(`Batch nao encontrado: ${batchPath}`);
    process.exit(1);
  }

  const batch = loadJson(batchPath);
  if (!batch.client || !Array.isArray(batch.posts)) {
    console.error('JSON invalido. Esperado: { client, posts: [] }');
    process.exit(1);
  }

  const clients = loadJson(path.join(ROOT, 'clients.json'));
  const client = clients[batch.client];
  if (!client) {
    console.error(`Cliente desconhecido: ${batch.client}`);
    process.exit(1);
  }

  const queuePath = path.join(ROOT, 'queue', 'pending.json');
  let queue = { posts: [] };
  if (fs.existsSync(queuePath)) {
    queue = loadJson(queuePath);
    if (!Array.isArray(queue.posts)) queue.posts = [];
  }

  const added = [];

  for (const post of batch.posts) {
    if (!post.image || !post.caption || !post.schedule) {
      console.error(`Post invalido (faltando image/caption/schedule):`, post);
      process.exit(1);
    }

    const srcImage = post.image;
    if (!fs.existsSync(srcImage)) {
      console.error(`Imagem nao encontrada: ${srcImage}`);
      process.exit(1);
    }

    const scheduledDate = new Date(post.schedule);
    if (isNaN(scheduledDate.getTime())) {
      console.error(`Data invalida: ${post.schedule}`);
      process.exit(1);
    }

    // Copia imagem pra assets/<client>/<YYYY-MM>/<filename>
    const yyyyMm = `${scheduledDate.getUTCFullYear()}-${String(scheduledDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const filename = path.basename(srcImage);
    const destDir = path.join(ROOT, 'assets', batch.client, yyyyMm);
    ensureDir(destDir);
    const destImage = path.join(destDir, filename);
    fs.copyFileSync(srcImage, destImage);
    const relImage = path.relative(ROOT, destImage).split(path.sep).join('/');

    const id = shortId();
    const entry = {
      id,
      client: batch.client,
      image: relImage,
      caption: post.caption,
      scheduled: scheduledDate.toISOString(),
      status: 'pending',
      added_at: new Date().toISOString()
    };

    queue.posts.push(entry);
    added.push(entry);
  }

  // Ordena queue por horario
  queue.posts.sort((a, b) => new Date(a.scheduled) - new Date(b.scheduled));

  saveJson(queuePath, queue);

  console.log(`\nAdicionados ${added.length} posts ao queue.`);
  for (const e of added) {
    const local = new Date(e.scheduled).toLocaleString('pt-BR', { timeZone: client.timezone || 'America/Sao_Paulo' });
    console.log(`  [${e.id}] ${path.basename(e.image)} -> ${local}`);
  }
  console.log(`\nQueue total: ${queue.posts.length} posts pending.`);
  console.log(`\nProximo passo: git add . && git commit -m "queue: +${added.length} posts" && git push`);
}

main();
