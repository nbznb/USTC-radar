#!/usr/bin/env node

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const USER_DIR = join(homedir(), '.follow-builders');
const CONFIG_PATH = join(USER_DIR, 'config.json');
const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = join(SCRIPT_DIR, '..');
const FEED_PATH = join(ROOT_DIR, 'feed-radar.json');

const PROMPT_FILES = [
  'summarize-podcast.md',
  'summarize-tweets.md',
  'summarize-blogs.md',
  'digest-intro.md',
  'translate.md'
];

function groupByCategory(items) {
  return {
    campus_notices: items.filter(item => item.category === 'campus_notices'),
    community: items.filter(item => item.category === 'community'),
    tech_news: items.filter(item => item.category === 'tech_news')
  };
}

async function main() {
  const errors = [];

  let config = {
    language: 'zh',
    frequency: 'daily',
    delivery: { method: 'stdout' }
  };

  if (existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
    } catch (err) {
      errors.push(`Could not read config: ${err.message}`);
    }
  }

  let feed = {
    generatedAt: null,
    items: [],
    stats: { totalItems: 0, byCategory: {} }
  };

  if (existsSync(FEED_PATH)) {
    try {
      feed = JSON.parse(await readFile(FEED_PATH, 'utf-8'));
    } catch (err) {
      errors.push(`Could not read radar feed: ${err.message}`);
    }
  } else {
    errors.push('Could not find feed-radar.json. Run generate-feed.js first.');
  }

  const prompts = {};
  const localPromptsDir = join(ROOT_DIR, 'prompts');
  const userPromptsDir = join(USER_DIR, 'prompts');

  for (const filename of PROMPT_FILES) {
    const key = filename.replace('.md', '').replace(/-/g, '_');
    const userPath = join(userPromptsDir, filename);
    const localPath = join(localPromptsDir, filename);

    if (existsSync(userPath)) {
      prompts[key] = await readFile(userPath, 'utf-8');
      continue;
    }

    if (existsSync(localPath)) {
      prompts[key] = await readFile(localPath, 'utf-8');
      continue;
    }

    errors.push(`Could not load prompt: ${filename}`);
  }

  const items = feed.items || [];
  const grouped = groupByCategory(items);

  const output = {
    status: 'ok',
    generatedAt: new Date().toISOString(),
    config: {
      language: config.language || 'zh',
      frequency: config.frequency || 'daily',
      delivery: config.delivery || { method: 'stdout' }
    },
    items,
    grouped,
    stats: {
      totalItems: feed.stats?.totalItems || items.length,
      byCategory: feed.stats?.byCategory || {
        campus_notices: grouped.campus_notices.length,
        community: grouped.community.length,
        tech_news: grouped.tech_news.length
      },
      feedGeneratedAt: feed.generatedAt || null
    },
    prompts,
    errors: errors.length > 0 ? errors : undefined
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({
    status: 'error',
    message: err.message
  }));
  process.exit(1);
});
