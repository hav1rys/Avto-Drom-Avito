import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const MAX_PHOTOS = 10; // лимит Telegram на одну медиагруппу

async function fetchDromHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'ru-RU,ru;q=0.9',
    },
  });

  if (!res.ok) {
    throw new Error(`Drom вернул статус ${res.status}`);
  }

  // Node fetch's res.text() всегда декодирует как UTF-8 и игнорирует
  // charset из Content-Type, а drom.ru отдаёт страницы в windows-1251 —
  // без ручного декодирования текст превращается в кашу.
  const contentType = res.headers.get('content-type') || '';
  const charsetMatch = contentType.match(/charset=([^;]+)/i);
  const charset = charsetMatch ? charsetMatch[1].trim().toLowerCase() : 'utf-8';
  const buffer = await res.arrayBuffer();
  return new TextDecoder(charset).decode(buffer);
}

export async function fetchDromListings(url) {
  const html = await fetchDromHtml(url);
  const $ = cheerio.load(html);
  const items = [];

  $('[data-ftid="bulls-list_bull"]').each((_, el) => {
    const card = $(el);
    const link = card.find('a[href]').first().attr('href');
    if (!link) return;

    const idMatch = link.match(/(\d+)\.html/);
    const id = idMatch ? idMatch[1] : link;
    const title = cleanNode(card.find('[data-ftid="bull_title"]').first());
    const subtitle = cleanNode(card.find('[data-ftid="bull_subtitle"]').first());
    const rawPrice = cleanNode(card.find('[data-ftid="bull_price"]').first());
    const price = rawPrice && !rawPrice.includes('₽') ? `${rawPrice} ₽` : rawPrice;
    const location = cleanNode(card.find('[data-ftid="bull_location"]').first());

    items.push({ id, url: link, title, subtitle, price, location });
  });

  return items;
}

// Подробная карточка самого объявления: полное название, цена, характеристики,
// описание, обмен, город и ссылки на все фото из галереи.
export async function fetchDromAdDetails(url) {
  const html = await fetchDromHtml(url);
  const $ = cheerio.load(html);

  const rawTitle = cleanNode($('[data-ftid="page-title"]').first());
  const titleMatch = rawTitle.match(/^Продажа\s+(.+?),\s*(\d{4})\s*год/);
  const title = titleMatch ? titleMatch[1] : rawTitle.replace(/^Продажа\s+/, '');
  const year = titleMatch ? titleMatch[2] : specValue($, 'year');

  const rawPrice = cleanNode($('[data-ftid="bulletin-price"]').first());
  const price = rawPrice && !rawPrice.includes('₽') ? `${rawPrice} ₽` : rawPrice;

  const engineRaw = specValue($, 'engine'); // например "бензин, 1.4 л"
  const [fuel, volume] = engineRaw ? engineRaw.split(',').map((s) => s.trim()) : [null, null];
  const power = specValue($, 'power');
  const transmission = specValue($, 'transmission');
  const drive = specValue($, 'drive');
  const mileage = specValue($, 'mileage');

  const specParts = [];
  if (volume && power) specParts.push(`${volume} (${power})`);
  else if (volume) specParts.push(volume);
  if (fuel) specParts.push(fuel);
  if (transmission) specParts.push(transmission);
  if (drive) specParts.push(drive);
  if (mileage) specParts.push(mileage);
  const specs = specParts.join(', ');

  const description = infoValue($, 'info-full');
  const exchange = infoValue($, 'trade');
  const city = infoValue($, 'city');

  const photos = [];
  $('[data-ftid="bull-page_bull-gallery_thumbnails"] a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && !photos.includes(href)) photos.push(href);
  });

  return {
    url,
    title,
    year,
    price,
    specs,
    description,
    exchange,
    city,
    photos: photos.slice(0, MAX_PHOTOS),
  };
}

function specValue($, key) {
  const node = $(`[data-ftid="specification-${key}"] [data-ftid="value"]`).first();
  return cleanNode(node).replace(/,\s*$/, '');
}

function infoValue($, ftid) {
  const node = $(`[data-ftid="${ftid}"] [data-ftid="value"]`).first();
  if (node.length === 0) return null;
  return cleanNode(node) || null;
}

// cheerio .text() также затягивает содержимое вложенных <style>/<script>/<button>
// (эмоция/css-in-js пихает их прямо внутрь карточки), поэтому вырезаем их,
// а заодно нормализуем неразрывные/узкие пробелы в разделителях тысяч.
function cleanNode(node) {
  const clone = node.clone();
  clone.find('style, script, button').remove();
  return clone
    .text()
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
