// Parser do formato de data que o Gabriel manda:
//   "0804" 8 de abril 18h30
//   0804 8 abril 18h30
//   "0804" 8 de abril 18:30
//
// Aceita aspas opcionais, "de" opcional, "h" ou ":" como separador de hora.

const MESES = {
  janeiro: 0, fevereiro: 1, marco: 2, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11
};

function normalizeMonth(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseScheduleLine(line, defaultYear) {
  if (!line || typeof line !== 'string') return null;
  const cleaned = line.trim();
  if (!cleaned) return null;

  // Regex: nome (4 digitos), dia, mes (palavra), hora h/: minuto
  const m = cleaned.match(/"?(\d{4})"?\s+(\d{1,2})\s+(?:de\s+)?(\w+)\s+(\d{1,2})[h:](\d{2})/i);
  if (!m) return null;

  const [, name, dayStr, monthName, hourStr, minuteStr] = m;
  const day = parseInt(dayStr, 10);
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  const monthKey = normalizeMonth(monthName);
  const month = MESES[monthKey];
  if (month === undefined) {
    throw new Error(`Mes nao reconhecido: "${monthName}" na linha "${cleaned}"`);
  }

  const year = defaultYear || new Date().getFullYear();
  // ISO em fuso de Brasilia (-03:00)
  const isoStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-03:00`;
  const date = new Date(isoStr);

  if (isNaN(date.getTime())) {
    throw new Error(`Data invalida: "${cleaned}"`);
  }

  return {
    name,           // ex: "0804" — nome do arquivo sem extensao
    day,
    month: month + 1,
    year,
    hour,
    minute,
    iso: isoStr,
    unix: Math.floor(date.getTime() / 1000),
    pretty: date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
  };
}

function parseScheduleText(text, defaultYear) {
  const results = [];
  for (const rawLine of text.split('\n')) {
    const parsed = parseScheduleLine(rawLine, defaultYear);
    if (parsed) results.push(parsed);
  }
  return results;
}

module.exports = { parseScheduleLine, parseScheduleText };
