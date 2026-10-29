import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export async function fetchDromListings(url) {
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
  const html = new TextDecoder(charset).decode(buffer);

  const $ = cheerio.load(html);
  const items = [];

  $('[data-ftid="bulls-list_bull"]').each((_, el) => {
    const card = $(el);
    const link = card.find('a[href]').first().attr('href');
    if (!link) return;

    const idMatch = link.match(/(\d+)\.html/);
    const id = idMatch ? idMatch[1] : link;
    const title = cleanText(card, '[data-ftid="bull_title"]');
    const subtitle = cleanText(card, '[data-ftid="bull_subtitle"]');
    const rawPrice = cleanText(card, '[data-ftid="bull_price"]');
    const price = rawPrice && !rawPrice.includes('₽') ? `${rawPrice} ₽` : rawPrice;
    const location = cleanText(card, '[data-ftid="bull_location"]');

    items.push({ id, url: link, title, subtitle, price, location });
  });

  return items;
}

// cheerio .text() также затягивает содержимое вложенных <style>/<script>
// (эмоция/css-in-js пихает их прямо внутрь карточки), поэтому вырезаем их,
// а заодно нормализуем неразрывные/узкие пробелы в разделителях тысяч.
function cleanText(card, selector) {
  const node = card.find(selector).first().clone();
  node.find('style, script').remove();
  return node
    .text()
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
