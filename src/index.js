import { Telegraf } from 'telegraf';
import { BOT_TOKEN, POLL_INTERVAL_MINUTES } from './config.js';
import { initDb } from './storage/db.js';
import { registerBotHandlers } from './bot.js';
import { startScheduler } from './scheduler.js';

async function main() {
  await initDb();

  const bot = new Telegraf(BOT_TOKEN);
  registerBotHandlers(bot);

  await bot.launch();
  console.log(`Бот запущен. Проверка фильтров каждые ${POLL_INTERVAL_MINUTES} мин.`);

  const timer = startScheduler(bot, POLL_INTERVAL_MINUTES);

  const shutdown = (signal) => {
    console.log(`Получен сигнал ${signal}, останавливаюсь...`);
    clearInterval(timer);
    bot.stop(signal);
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Фатальная ошибка запуска:', err);
  process.exit(1);
});
