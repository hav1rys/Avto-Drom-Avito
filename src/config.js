import 'dotenv/config';

export const BOT_TOKEN = process.env.BOT_TOKEN;
export const POLL_INTERVAL_MINUTES = Number(process.env.POLL_INTERVAL_MINUTES || 5);
export const DATA_DIR = process.env.DATA_DIR || './data';

if (!BOT_TOKEN) {
  throw new Error('Не задан BOT_TOKEN в .env (возьми токен у @BotFather в Telegram)');
}
