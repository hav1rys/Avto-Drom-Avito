import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../config.js';

const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_SEEN_PER_FILTER = 500;

let state = null;
let writeQueue = Promise.resolve();

function emptyState() {
  return { filters: [] };
}

export async function initDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    state = JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      state = emptyState();
      await persist();
    } else {
      throw err;
    }
  }
  return state;
}

function persist() {
  writeQueue = writeQueue.then(async () => {
    const tmpFile = `${DB_FILE}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(tmpFile, DB_FILE);
  });
  return writeQueue;
}

export function listFilters(chatId) {
  return state.filters.filter((f) => f.chatId === chatId);
}

export function getFilter(id) {
  return state.filters.find((f) => f.id === id);
}

export function allActiveFilters() {
  return state.filters.filter((f) => f.active);
}

export async function addFilter({ chatId, platform, url, label }) {
  const filter = {
    id: randomUUID(),
    chatId,
    platform,
    url,
    label,
    active: true,
    createdAt: new Date().toISOString(),
    lastRun: null,
    seen: [],
  };
  state.filters.push(filter);
  await persist();
  return filter;
}

export async function removeFilter(id, chatId) {
  const idx = state.filters.findIndex((f) => f.id === id && f.chatId === chatId);
  if (idx === -1) return false;
  state.filters.splice(idx, 1);
  await persist();
  return true;
}

export async function markSeen(filterId, ids) {
  const filter = getFilter(filterId);
  if (!filter) return;
  const set = new Set(filter.seen);
  for (const id of ids) set.add(id);
  filter.seen = [...set].slice(-MAX_SEEN_PER_FILTER);
  filter.lastRun = new Date().toISOString();
  await persist();
}
