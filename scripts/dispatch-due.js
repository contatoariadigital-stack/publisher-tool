// Dispatcher: roda no GitHub Actions a cada 15 min.
// Le queue/pending.json, encontra posts cujo horario ja venceu, publica via API IG nova
// (graph.instagram.com), move pra queue/published.json e comita de volta.
//
// Uso (Actions ou local):
//   node scripts/dispatch-due.js
//
// Variaveis de ambiente esperadas:
//   IG_TOKEN_<CLIENT_KEY_UPPER>  (ex: IG_TOKEN_STUDIO_WV2)
//
// Saida:
//   - Atualiza queue/pending.json (remove posts publicados)
//   - Atualiza queue/published.json (acrescenta com resultado)

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../lib/env');

loadEnv();

const ROOT = path.resolve(__dirname, '..');
const IG_API_BASE = 'https://graph.instagram.com/v21.0';

// Quanto tempo no passado a gente ainda aceita postar (evita catch-up catastrofico)
const MAX_LATE_MINUTES = 120;

function loadJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function tokenEnvName(clientKey) {
  return 'IG_TOKEN_' + clientKey.toUpperCase().replace(/-/g, '_');
}

async function uploadImageToCatbox(absPath) {
  const buffer = fs.readFileSync(absPath);
  const filename = path.basename(absPath);
  const ext = path.extname(filename).toLowerCase();
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext];
  if (!mime) throw new Error(`Formato nao suportado: ${ext}`);

  const blob = new Blob([buffer], { type: mime });
  const fd = new FormData();
  fd.append('reqtype', 'fileupload');
  fd.append('fileToUpload', blob, filename);

  const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: fd });
  const text = (await res.text()).trim();
  if (!text.startsWith('https://')) throw new Error(`Catbox falhou: ${text}`);
  return text;
}

async function igPost(igUserId, endpoint, params, token) {
  const url = `${IG_API_BASE}/${igUserId}/${endpoint}`;
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));
  body.set('access_token', token);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`IG API [${endpoint}]: ${json.error.message} (code ${json.error.code})`);
  }
  return json;
}

async function igGet(node, params, token) {
  const url = new URL(`${IG_API_BASE}/${node}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('access_token', token);
  const res = await fetch(url.toString());
  const json = await res.json();
  if (json.error) {
    throw new Error(`IG API GET [${node}]: ${json.error.message} (code ${json.error.code})`);
  }
  return json;
}

async function waitContainerReady(containerId, token, { maxWaitMs = 60000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const info = await igGet(containerId, { fields: 'status_code' }, token);
    if (info.status_code === 'FINISHED') return;
    if (info.status_code === 'ERROR' || info.status_code === 'EXPIRED') {
      throw new Error(`Container ${containerId} status ${info.status_code}`);
    }
    // IN_PROGRESS / PUBLISHED -> aguarda
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Container ${containerId} nao ficou pronto em ${maxWaitMs}ms`);
}

async function publishPost(post, client) {
  const tokenName = client.ig_token_secret_name || tokenEnvName(post.client);
  const token = process.env[tokenName];
  if (!token) throw new Error(`Token ausente em env: ${tokenName}`);

  const igUserId = client.ig_user_id_v2;
  if (!igUserId) throw new Error(`Cliente ${post.client} sem ig_user_id_v2 configurado`);

  const absImage = path.join(ROOT, post.image);
  if (!fs.existsSync(absImage)) throw new Error(`Imagem nao encontrada: ${post.image}`);

  console.log(`  upload imagem...`);
  const imageUrl = await uploadImageToCatbox(absImage);
  console.log(`    ${imageUrl}`);

  // Monta user_tags em posicoes distribuidas (mesma logica do schedule-post.js antigo)
  const tagsList = client.default_user_tags || [];
  const userTags = tagsList.map((username, i, arr) => ({
    username,
    x: 0.2 + (i * (0.6 / Math.max(arr.length - 1, 1))),
    y: 0.5
  }));

  console.log(`  cria container...`);
  const containerParams = {
    image_url: imageUrl,
    caption: post.caption
  };
  if (userTags.length > 0) {
    containerParams.user_tags = JSON.stringify(userTags);
  }
  const container = await igPost(igUserId, 'media', containerParams, token);
  console.log(`    container ${container.id}`);

  console.log(`  aguarda container ficar pronto...`);
  await waitContainerReady(container.id, token);
  console.log(`    pronto`);

  console.log(`  publica...`);
  const publish = await igPost(igUserId, 'media_publish', {
    creation_id: container.id
  }, token);
  console.log(`    media ${publish.id}`);

  return {
    media_id: publish.id,
    container_id: container.id,
    image_url: imageUrl,
    published_at: new Date().toISOString()
  };
}

async function main() {
  const clients = loadJson(path.join(ROOT, 'clients.json'), {});
  const queuePath = path.join(ROOT, 'queue', 'pending.json');
  const publishedPath = path.join(ROOT, 'queue', 'published.json');

  const queue = loadJson(queuePath, { posts: [] });
  const published = loadJson(publishedPath, { posts: [] });

  if (!Array.isArray(queue.posts)) queue.posts = [];
  if (!Array.isArray(published.posts)) published.posts = [];

  const now = Date.now();
  const due = [];
  const remaining = [];

  for (const p of queue.posts) {
    const sched = new Date(p.scheduled).getTime();
    const ageMin = (now - sched) / 60000;
    if (ageMin >= 0 && ageMin <= MAX_LATE_MINUTES) {
      due.push(p);
    } else if (ageMin > MAX_LATE_MINUTES) {
      // Muito atrasado — marca como skipped pra nao tentar postar conteudo velho
      console.log(`SKIP [${p.id}] muito atrasado (${ageMin.toFixed(0)} min)`);
      published.posts.push({
        ...p,
        status: 'skipped_too_late',
        skipped_at: new Date().toISOString()
      });
    } else {
      remaining.push(p);
    }
  }

  console.log(`Queue: ${queue.posts.length} total | due: ${due.length} | remaining: ${remaining.length}`);

  let publishedNow = 0;
  let failures = 0;

  for (const post of due) {
    console.log(`\n[${post.id}] ${path.basename(post.image)} (agendado ${post.scheduled})`);
    const client = clients[post.client];
    if (!client) {
      console.log(`  ERRO: cliente ${post.client} nao existe em clients.json`);
      remaining.push(post);
      failures++;
      continue;
    }

    try {
      const result = await publishPost(post, client);
      published.posts.push({
        ...post,
        status: 'published',
        result
      });
      publishedNow++;
      console.log(`  OK`);
    } catch (err) {
      console.log(`  FALHA: ${err.message}`);
      // Mantem no pending pra tentar de novo na proxima execucao (ate vencer MAX_LATE_MINUTES)
      remaining.push(post);
      failures++;
    }
  }

  // Reescreve pending so com o que sobrou
  saveJson(queuePath, { posts: remaining });
  saveJson(publishedPath, published);

  console.log(`\nResumo: publicados=${publishedNow} falhas=${failures} pending=${remaining.length}`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(`ERRO FATAL: ${err.message}`);
  process.exit(1);
});
