import { chromium } from 'playwright';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export class AvitoBlockedError extends Error {}

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

export async function closeAvitoBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

// Avito блокирует запросы без настоящего браузера (антибот по IP/фингерпринту),
// поэтому открываем страницу через headless Chromium, а не через fetch.
export async function fetchAvitoListings(url) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'ru-RU',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/доступ ограничен|подтвердите.*человек|капч/i.test(bodyText)) {
      throw new AvitoBlockedError('Avito показал страницу блокировки или капчу');
    }

    await page.waitForSelector('[data-marker="item"]', { timeout: 15000 }).catch(() => {});

    const items = await page.$$eval('[data-marker="item"]', (nodes) =>
      nodes.map((node) => {
        const titleLink = node.querySelector('a[data-marker="item-title"]') || node.querySelector('a[href]');
        const href = titleLink ? titleLink.getAttribute('href') : null;
        const title = titleLink ? titleLink.textContent.trim() : '';
        const priceMarker = node.querySelector('[data-marker="item-price"]');
        const priceMeta = node.querySelector('meta[itemprop="price"]');
        const price = priceMarker
          ? priceMarker.textContent.trim()
          : priceMeta
            ? `${priceMeta.getAttribute('content')} ₽`
            : '';
        const id = node.getAttribute('data-item-id');
        return { id, href, title, price };
      }),
    );

    return items
      .filter((it) => it.id && it.href)
      .map((it) => ({
        id: it.id,
        url: it.href.startsWith('http') ? it.href : `https://www.avito.ru${it.href}`,
        title: it.title,
        price: it.price,
      }));
  } finally {
    await context.close();
  }
}
