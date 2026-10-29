const CAPTION_LIMIT = 1024; // лимит Telegram на подпись к фото/медиагруппе

export function buildCaption(details, label) {
  const lines = [];
  lines.push(`Фильтр: ${label}`);

  const titleLine = [details.title, details.year].filter(Boolean).join(', ');
  lines.push(`🚘 ${titleLine || 'Новое объявление'}`);

  if (details.price) lines.push(`💰 ${details.price}`);
  if (details.specs) lines.push(details.specs);
  if (details.description) lines.push(`📝 ${details.description}`);
  if (details.exchange) lines.push(`🔄 Обмен: ${details.exchange}`);
  if (details.city) lines.push(`📍 ${details.city}`);

  lines.push(details.url);

  let caption = lines.join('\n');
  if (caption.length > CAPTION_LIMIT) {
    caption = `${caption.slice(0, CAPTION_LIMIT - 1)}…`;
  }
  return caption;
}

// Для media group подпись можно повесить только на первое фото — так и делаем.
export function buildMediaGroup(details, label) {
  const caption = buildCaption(details, label);
  if (!details.photos || details.photos.length === 0) return null;

  return details.photos.map((photoUrl, i) => ({
    type: 'photo',
    media: photoUrl,
    ...(i === 0 ? { caption } : {}),
  }));
}
