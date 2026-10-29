import { Markup } from 'telegraf';
import { addFilter, listFilters, removeFilter, markSeen } from './storage/db.js';
import { fetchDromListings } from './scrapers/drom.js';
import { fetchAvitoListings, AvitoBlockedError } from './scrapers/avito.js';

// Простое in-memory состояние диалогов по chatId. Бот личный и однопроцессный,
// поэтому полноценная сцена/сессия (telegraf scenes) была бы лишней сложностью.
const pending = new Map();

const HELP_TEXT = `Слежу за новыми объявлениями на Drom.ru и Avito.ru и присылаю их сюда.

/add — добавить фильтр по ссылке. Настрой марку/цену/год на drom.ru или avito.ru, скопируй адрес страницы и пришли мне.
/add_form — добавить фильтр через короткую анкету (марка, модель, цена).
/list — список твоих фильтров, оттуда же можно удалить.
/cancel — отменить текущее добавление фильтра.
/help — это сообщение.

Я проверяю твои фильтры по расписанию и присылаю только те объявления, которых раньше не было.`;

export function registerBotHandlers(bot) {
  bot.start((ctx) => ctx.reply(`Привет!\n\n${HELP_TEXT}`));
  bot.help((ctx) => ctx.reply(HELP_TEXT));

  bot.command('cancel', (ctx) => {
    pending.delete(ctx.chat.id);
    ctx.reply('Ок, отменил.');
  });

  bot.command('add', (ctx) => {
    pending.set(ctx.chat.id, { type: 'await_link' });
    ctx.reply(
      'Пришли ссылку на страницу с уже настроенными фильтрами на drom.ru или avito.ru.\n\n' +
        'Например: открой сайт, выбери марку/цену/год через фильтры на самом сайте и скопируй адрес из адресной строки сюда.',
    );
  });

  bot.command('add_form', (ctx) => {
    pending.set(ctx.chat.id, { type: 'form_platform', data: {} });
    ctx.reply(
      'Выбери площадку:',
      Markup.inlineKeyboard([
        Markup.button.callback('Drom.ru', 'form_platform:drom'),
        Markup.button.callback('Avito.ru', 'form_platform:avito'),
      ]),
    );
  });

  bot.command('list', async (ctx) => {
    const filters = listFilters(ctx.chat.id);
    if (filters.length === 0) {
      return ctx.reply('Пока нет ни одного фильтра. Добавь через /add или /add_form.');
    }
    for (const f of filters) {
      await ctx.reply(
        `${f.platform === 'drom' ? 'Drom' : 'Avito'} — «${f.label}»\n${f.url}`,
        Markup.inlineKeyboard([Markup.button.callback('🗑 Удалить', `delete:${f.id}`)]),
      );
    }
  });

  bot.action(/^delete:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const ok = await removeFilter(id, ctx.chat.id);
    await ctx.answerCbQuery(ok ? 'Удалено' : 'Не нашёл такой фильтр');
    if (ok) await ctx.editMessageText('Фильтр удалён.');
  });

  bot.action(/^form_platform:(drom|avito)$/, async (ctx) => {
    const platform = ctx.match[1];
    pending.set(ctx.chat.id, { type: 'form_brand', data: { platform } });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Площадка: ${platform === 'drom' ? 'Drom.ru' : 'Avito.ru'}\n\nНапиши марку автомобиля (например: Toyota).`,
    );
  });

  bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text.trim();
    const state = pending.get(chatId);
    if (!state) return; // нет активного диалога — не реагируем на произвольный текст

    try {
      await handleDialogStep(ctx, chatId, text, state);
    } catch (err) {
      console.error('Ошибка диалога:', err);
      pending.delete(chatId);
      await ctx.reply('Что-то пошло не так. Попробуй снова: /add или /add_form.');
    }
  });
}

async function handleDialogStep(ctx, chatId, text, state) {
  switch (state.type) {
    case 'await_link': {
      const platform = detectPlatform(text);
      if (!platform) {
        return ctx.reply(
          'Это не похоже на ссылку с drom.ru или avito.ru. Пришли корректный адрес страницы или /cancel для отмены.',
        );
      }
      pending.set(chatId, { type: 'await_link_label', data: { platform, url: text } });
      return ctx.reply('Как назвать этот фильтр? Например: «Камри до 2 млн». Или пришли "-" для автоназвания.');
    }

    case 'await_link_label': {
      const label = text === '-' ? defaultLabel(state.data.platform) : text;
      pending.delete(chatId);
      return saveAndConfirm(ctx, chatId, state.data.platform, state.data.url, label);
    }

    case 'form_brand': {
      state.data.brand = text;
      state.type = 'form_model';
      pending.set(chatId, state);
      return ctx.reply('Теперь модель (например: Camry). Если не важно — пришли "-".');
    }

    case 'form_model': {
      state.data.model = text === '-' ? '' : text;
      state.type = 'form_price_min';
      pending.set(chatId, state);
      return ctx.reply('Цена от (в рублях), или "-" чтобы не ограничивать снизу.');
    }

    case 'form_price_min': {
      state.data.priceMin = parsePrice(text);
      state.type = 'form_price_max';
      pending.set(chatId, state);
      return ctx.reply('Цена до (в рублях), или "-" чтобы не ограничивать сверху.');
    }

    case 'form_price_max': {
      state.data.priceMax = parsePrice(text);
      state.type = 'form_label';
      pending.set(chatId, state);
      return ctx.reply('Как назвать фильтр? Или "-" для автоназвания.');
    }

    case 'form_label': {
      const { platform, brand, model, priceMin, priceMax } = state.data;
      const label = text === '-' ? [brand, model].filter(Boolean).join(' ') || defaultLabel(platform) : text;
      const url = buildFormUrl({ platform, brand, model, priceMin, priceMax });
      pending.delete(chatId);
      return saveAndConfirm(ctx, chatId, platform, url, label);
    }

    default:
      pending.delete(chatId);
  }
}

function detectPlatform(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)drom\.ru$/.test(u.hostname)) return 'drom';
    if (/(^|\.)avito\.ru$/.test(u.hostname)) return 'avito';
  } catch {
    return null;
  }
  return null;
}

function defaultLabel(platform) {
  return platform === 'drom' ? 'Drom фильтр' : 'Avito фильтр';
}

function parsePrice(text) {
  if (text === '-') return null;
  const n = Number(text.replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '');
}

function buildFormUrl({ platform, brand, model, priceMin, priceMax }) {
  if (platform === 'avito') {
    const q = [brand, model].filter(Boolean).join(' ');
    const params = new URLSearchParams({ q });
    if (priceMin) params.set('pmin', String(priceMin));
    if (priceMax) params.set('pmax', String(priceMax));
    return `https://www.avito.ru/rossiya/avtomobili?${params.toString()}`;
  }

  const brandSlug = slugify(brand);
  const modelSlug = slugify(model);
  const pathParts = ['https://auto.drom.ru', brandSlug, modelSlug].filter(Boolean);
  const params = new URLSearchParams();
  if (priceMin) params.set('minprice', String(priceMin));
  if (priceMax) params.set('maxprice', String(priceMax));
  const qs = params.toString();
  return `${pathParts.join('/')}/${qs ? `?${qs}` : ''}`;
}

async function saveAndConfirm(ctx, chatId, platform, url, label) {
  await ctx.reply(`Проверяю фильтр «${label}»…`);
  try {
    const items = platform === 'drom' ? await fetchDromListings(url) : await fetchAvitoListings(url);
    const filter = await addFilter({ chatId, platform, url, label });
    // Запоминаем текущие объявления как уже увиденные, чтобы не заспамить
    // пользователя сотней старых объявлений сразу после подключения фильтра.
    await markSeen(filter.id, items.map((i) => i.id));
    await ctx.reply(
      `Готово! Фильтр «${label}» (${platform === 'drom' ? 'Drom' : 'Avito'}) добавлен.\n` +
        `Сейчас по нему ${items.length} объявлений — беру их за точку отсчёта и дальше буду присылать только новые.\n\n${url}`,
    );
  } catch (err) {
    if (err instanceof AvitoBlockedError) {
      await addFilter({ chatId, platform, url, label });
      await ctx.reply(
        'Avito сейчас не пускает автоматическую проверку (антибот). Фильтр всё равно сохранён, попробую проверить его на следующем цикле.',
      );
      return;
    }
    console.error('Ошибка при первой проверке фильтра:', err);
    await ctx.reply(`Не получилось открыть эту ссылку (${err.message}). Проверь её и попробуй снова через /add или /add_form.`);
  }
}
