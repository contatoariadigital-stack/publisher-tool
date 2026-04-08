// Sobe uma imagem local pra catbox.moe e retorna URL publica.
// Catbox e gratuito, sem auth, URL permanente. Necessario porque o Instagram
// Graph API nao aceita upload direto de arquivo — exige image_url HTTP publica.

const fs = require('fs');
const path = require('path');

async function uploadImage(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo nao encontrado: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  const filename = path.basename(filePath);

  // Detecta mime type pelo extension
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp'
  };
  const mimeType = mimeTypes[ext];
  if (!mimeType) {
    throw new Error(`Formato nao suportado: ${ext}. Use .jpg, .jpeg, .png ou .webp.`);
  }

  const blob = new Blob([buffer], { type: mimeType });
  const formData = new FormData();
  formData.append('reqtype', 'fileupload');
  formData.append('fileToUpload', blob, filename);

  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: formData
  });

  const text = (await res.text()).trim();
  if (!text.startsWith('https://')) {
    throw new Error(`Catbox upload falhou: ${text}`);
  }
  return text;
}

module.exports = { uploadImage };
