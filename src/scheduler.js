import { allActiveFilters, markSeen } from './storage/db.js';
import { fetchDromListings, fetchDromAdDetails } from './scrapers/drom.js';
import { buildCaption, buildMediaGroup } from './format.js';

const MAX_MESSAGES_PER_CYCLE = 15; // защита от флуда, если за цикл набежало много новых объявлений
const PAUSE_BETWEEN_FILTERS_MS = 2000; // не долбим сайт частыми подряд запросами
const PAUSE_BETWEEN_MESSAGES_MS = 800;

export function startScheduler(bot, intervalMinutes) {
  const run = () => checkAllFilters(bot).catch((err) => console.error('Ошибка планировщика:', err));
  run();
  return setInterval(run, intervalMinutes * 60 * 1000);
}

async function checkAllFilters(bot) {
  for (const filter of allActiveFilters()) {
    try {
      await checkFilter(bot, filter);
    } catch (err) {
      console.error(`Ошибка проверки фильтра ${filter.id}:`, err.message);
    }
    await sleep(PAUSE_BETWEEN_FILTERS_MS);
  }
}

async function checkFilter(bot, filter) {
  const isFirstRun = filter.lastRun === null;
  const items = await fetchDromListings(filter.url);

  if (isFirstRun) {
    await markSeen(filter.id, items.map((i) => i.id));
    await safeSend(
      bot,
      filter.chatId,
      `✅ Фильтр «${filter.label}» подключён. Нашёл ${items.length} текущих объявлений, беру их за точку отсчёта. Буду присылать только новые.`,
    );
    return;
  }

  const seenSet = new Set(filter.seen);
  const newItems = items.filter((it) => !seenSet.has(it.id));

  if (newItems.length > 0) {
    const toSend = newItems.slice(0, MAX_MESSAGES_PER_CYCLE);
    for (const item of toSend) {
      await sendNewItem(bot, filter, item);
      await sleep(PAUSE_BETWEEN_MESSAGES_MS);
    }
    if (newItems.length > toSend.length) {
      await safeSend(
        bot,
        filter.chatId,
        `…и ещё ${newItems.length - toSend.length} новых объявлений по фильтру «${filter.label}» (показаны не все, чтобы не спамить).`,
      );
    }
  }

  await markSeen(filter.id, items.map((i) => i.id));
}

async function sendNewItem(bot, filter, item) {
  try {
    const details = await fetchDromAdDetails(item.url);
    const mediaGroup = buildMediaGroup(details, filter.label);
    if (mediaGroup) {
      await bot.telegram.sendMediaGroup(filter.chatId, mediaGroup);
    } else {
      await bot.telegram.sendMessage(filter.chatId, buildCaption(details, filter.label));
    }
  } catch (err) {
    console.error(`Не удалось открыть карточку объявления ${item.url}:`, err.message);
    // откат к короткой версии из списка, чтобы объявление не потерялось совсем
    const fallbackPrice = item.price ? `\n💰 ${item.price}` : '';
    await safeSend(bot, filter.chatId, `Фильтр: ${filter.label}\n🚘 ${item.title || 'Новое объявление'}${fallbackPrice}\n${item.url}`);
  }
}

async function safeSend(bot, chatId, text) {
  try {
    await bot.telegram.sendMessage(chatId, text);
  } catch (err) {
    console.error(`Не удалось отправить сообщение в чат ${chatId}:`, err.message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
