export function formatItem(platform, item, label) {
  const parts = [];
  parts.push(`Фильтр: ${label}`);
  parts.push(`🚘 ${item.title || 'Новое объявление'}`.trim());
  if (item.subtitle) parts.push(item.subtitle);
  if (item.price) parts.push(`💰 ${item.price}`);
  if (item.location) parts.push(`📍 ${item.location}`);
  parts.push(item.url);
  return parts.join('\n');
}
