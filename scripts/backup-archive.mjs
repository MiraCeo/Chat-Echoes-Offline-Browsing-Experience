#!/usr/bin/env node
// Manually create a durable archive snapshot without deleting anything.
import { resolve } from 'node:path';
import { snapshotArchive } from './chat-store.mjs';

const root = resolve(import.meta.dirname, '..');
const folder = await snapshotArchive(root, {
  id: `manual-${Date.now()}`,
  title: '手动 archive 快照',
});
console.log(folder);
