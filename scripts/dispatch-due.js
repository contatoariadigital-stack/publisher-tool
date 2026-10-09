// Dispatcher: roda no GitHub Actions a cada 15 min.
// Le queue/pending.json, encontra posts cujo horario ja venceu, publica via API IG nova
// (graph.instagram.com), move pra queue/published.json e comita de volta.
//
// Uso (Actions ou local):
//   node scripts/dispatch-due.js
//
// Variaveis de ambiente esperadas (uma das duas por cliente):
//   FB_PAGE_TOKEN_<CLIENT_KEY_UPPER> (ex: FB_PAGE_TOKEN_STUDIO_WV2) -> modo Facebook Login:
//       graph.facebook.com + client.ig_user_id (token de pagina derivado de user token
//       long-lived, nao expira). Preferido desde 09/10/2026.
//   IG_TOKEN_<CLIENT_KEY_UPPER>      (ex: IG_TOKEN_STUDIO_WV2) -> modo Instagram Login:
//       graph.instagram.com + client.ig_user_id_v2 (vence em 60 dias).
//
// Saida:
//   - Atualiza queue/pending.json (remove posts publicados)
//   - Atualiza queue/published.json (acrescenta com resultado)

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../lib/env');

loadEnv();

const ROOT = path.resolve(__dirname, '..');

// Fora do GitHub Actions (Task Scheduler local) espelha o console em state/local-dispatch.log
if (!process.env.GITHUB_ACTIONS) {
  const logFile = path.join(ROOT, 'state', 'local-dispatch.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const origLog = console.log, origErr = console.error;
  const EOL = String.fromCharCode(10);
  const w = (lvl, a) => { try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + lvl + ' ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + EOL); } catch (_) {} };
  console.log = (...a) => { origLog(...a); w('INFO', a); };
  console.error = (...a) => { origErr(...a); w('ERR', a); };
  console.log('--- run local');
}
const IG_API_BASE = 'https://graph.instagram.com/v21.0';
const FB_API_BASE = 'https://graph.facebook.com/v21.0';

// Quanto tempo no passado a gente ainda aceita postar (evita catch-up catastrofico)
const MAX_LATE_MINUTES = 720; // 12h: o cron do GitHub dispara esporadico; melhor atrasar que pular

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

function fbTokenEnvName(clientKey) {
  return 'FB_PAGE_TOKEN_' + clientKey.toUpperCase().replace(/-/g, '_');
}

// Decide modo e credenciais do cliente. FB (page token) tem prioridade.
function resolveAuth(post, client) {
  const fbName = client.fb_token_secret_name || fbTokenEnvName(post.client);
  const fbToken = process.env[fbName];
  if (fbToken) {
    if (!client.ig_user_id) throw new Error(`Cliente ${post.client} sem ig_user_id (modo FB)`);
    return { mode: 'fb', base: FB_API_BASE, token: fbToken, igUserId: client.ig_user_id };
  }
  const igName = client.ig_token_secret_name || tokenEnvName(post.client);
  const igToken = process.env[igName];
  if (!igToken) throw new Error(`Token ausente em env: ${fbName} ou ${igName}`);
  if (!client.ig_user_id_v2) throw new Error(`Cliente ${post.client} sem ig_user_id_v2 configurado (modo IG)`);
  return { mode: 'ig', base: IG_API_BASE, token: igToken, igUserId: client.ig_user_id_v2 };
}

// Repo publico — serve a imagem direto via raw.githubusercontent.com.
// A imagem ja esta commitada em assets/ antes do dispatcher rodar (add-to-queue
// + git push pelo Gabriel), entao aqui so montamos a URL publica.
function buildRawImageUrl(relPath) {
  const repo = process.env.GITHUB_REPOSITORY || 'contatoariadigital-stack/publisher-tool';
  const branch = process.env.GITHUB_REF_NAME || 'main';
  const normalized = relPath.split(path.sep).join('/');
  return `https://raw.githubusercontent.com/${repo}/${branch}/${encodeURI(normalized)}`;
}

async function igPost(igUserId, endpoint, params, token, base = IG_API_BASE) {
  const url = `${base}/${igUserId}/${endpoint}`;
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

async function igGet(node, params, token, base = IG_API_BASE) {
  const url = new URL(`${base}/${node}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('access_token', token);
  const res = await fetch(url.toString());
  const json = await res.json();
  if (json.error) {
    throw new Error(`IG API GET [${node}]: ${json.error.message} (code ${json.error.code})`);
  }
  return json;
}

async function waitContainerReady(containerId, token, { maxWaitMs = 60000, intervalMs = 2000, base = IG_API_BASE } = {}) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const info = await igGet(containerId, { fields: 'status_code' }, token, base);
    if (info.status_code === 'FINISHED') return;
    if (info.status_code === 'ERROR' || info.status_code === 'EXPIRED') {
      throw new Error(`Container ${containerId} status ${info.status_code}`);
    }
    // IN_PROGRESS / PUBLISHED -> aguarda
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Container ${containerId} nao ficou pronto em ${maxWaitMs}ms`);
}

async function publishPost(post, client, { dryRun = false } = {}) {
  const { mode, base, token, igUserId } = resolveAuth(post, client);
  console.log(`  modo: ${mode} (${base})`);

  const absImage = path.join(ROOT, post.image);
  if (!fs.existsSync(absImage)) throw new Error(`Imagem nao encontrada: ${post.image}`);

  const imageUrl = buildRawImageUrl(post.image);
  console.log(`  image_url: ${imageUrl}`);

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
  const container = await igPost(igUserId, 'media', containerParams, token, base);
  console.log(`    container ${container.id}`);

  console.log(`  aguarda container ficar pronto...`);
  await waitContainerReady(container.id, token, { base });
  console.log(`    pronto`);

  if (dryRun) {
    console.log(`  DRY-RUN: container OK, NAO publicado (expira sozinho em 24h)`);
    return { dry_run: true, container_id: container.id, image_url: imageUrl };
  }

  console.log(`  publica...`);
  const publish = await igPost(igUserId, 'media_publish', {
    creation_id: container.id
  }, token, base);
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

  // --test=<id>: valida token + imagem + container do post <id> SEM publicar e SEM mexer na fila.
  const testArg = process.argv.find(a => a.startsWith('--test='));
  if (testArg) {
    const id = testArg.split('=')[1];
    const q = loadJson(queuePath, { posts: [] });
    const post = (q.posts || []).find(p => p.id === id);
    if (!post) throw new Error(`Post ${id} nao esta em pending.json`);
    const client = clients[post.client];
    if (!client) throw new Error(`Cliente ${post.client} nao existe em clients.json`);
    console.log(`TESTE [${post.id}] ${path.basename(post.image)}`);
    const r = await publishPost(post, client, { dryRun: true });
    console.log(JSON.stringify(r));
    return;
  }
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
