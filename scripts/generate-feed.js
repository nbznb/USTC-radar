#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const LOOKBACK_HOURS = 72;
const MAX_ITEMS_PER_SOURCE = 8;
const DEFAULT_FALLBACK_MIN_ITEMS = 0;
const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = join(SCRIPT_DIR, '..');
const STATE_PATH = join(ROOT_DIR, 'state-feed.json');
const SOURCES_PATH = join(ROOT_DIR, 'config', 'default-sources.json');
const FEED_PATH = join(ROOT_DIR, 'feed-radar.json');
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { seenItems: {} };
  }

  try {
    const state = JSON.parse(await readFile(STATE_PATH, 'utf-8'));
    if (state.seenItems) return state;

    const seenItems = {};
    for (const key of Object.keys(state.seenTweets || {})) seenItems[key] = state.seenTweets[key];
    for (const key of Object.keys(state.seenVideos || {})) seenItems[key] = state.seenVideos[key];
    for (const key of Object.keys(state.seenArticles || {})) seenItems[key] = state.seenArticles[key];
    return { seenItems };
  } catch {
    return { seenItems: {} };
  }
}

async function saveState(state) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(state.seenItems)) {
    if (ts < cutoff) delete state.seenItems[id];
  }
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

async function loadSources() {
  return JSON.parse(await readFile(SOURCES_PATH, 'utf-8'));
}

function stripHtml(html) {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function normalizeUrl(url, baseUrl) {
  if (!url) return null;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return null;
  }
}

function decodeHtmlEntities(text) {
  return (text || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanText(text) {
  return decodeHtmlEntities(text || '')
    .replace(/[\u00a0\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[|｜]+/g, ' ')
    .replace(/^(点我查看|查看全文|阅读原文)\s*/g, '')
    .trim();
}

function isLikelyAssetUrl(url) {
  return /\.(?:jpg|jpeg|png|gif|webp|svg|css|js|ico|woff2?)(?:\?|$)/i.test(url || '');
}

function isLikelyArticleUrl(source, url) {
  if (!url || isLikelyAssetUrl(url) || url.includes('#') || /javascript:/i.test(url)) return false;

  if (source.id === 'ustc-notices') {
    return /(?:tzggcontent\.jsp|\/info\/13\d{2}\/\d+\.htm|\/\d{4}\/\d{4}\/c\d+a\d+\/page\.psp)/i.test(url);
  }

  if (source.id === 'ustc-news') {
    return /\/info\/\d+\/\d+\.htm$/i.test(url);
  }

  if (source.id === 'aiera-news') {
    return /aiera\.com\.cn\/20\d{2}\/\d{2}\/\d{2}\//i.test(url);
  }

  return true;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildItemId(source, url, title) {
  return `${source.id}:${url || slugify(title || 'item')}`;
}

function extractTitleFromAnchor(anchorHtml) {
  const titleMatch = anchorHtml.match(/title=["']([^"']+)["']/i);
  if (titleMatch?.[1]) return cleanText(titleMatch[1]).slice(0, 160);

  const text = stripHtml(anchorHtml)
    .replace(/^(更多|详情|附件|下载)\s*/g, '')
    .trim();
  return text.slice(0, 160).trim();
}

function extractDateNearby(block) {
  const isoLike = block.match(/(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2})/);
  if (!isoLike) return null;

  const normalized = isoLike[1]
    .replace(/年|\//g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/\./g, '-');

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractStructuredDate(context) {
  const dayMatch = context.match(/<div[^>]*class=["'][^"']*day[^"']*["'][^>]*>\s*(\d{1,2})\s*<\/div>/i);
  const monthMatch = context.match(/<div[^>]*class=["'][^"']*month[^"']*["'][^>]*>\s*(20\d{2})[.-](\d{1,2})\s*<\/div>/i);

  if (!dayMatch || !monthMatch) return null;

  const year = Number(monthMatch[1]);
  const month = Number(monthMatch[2]);
  const day = Number(dayMatch[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getSourceLookbackMs(source) {
  const hours = Number(source.lookbackHours ?? LOOKBACK_HOURS);
  return Math.max(0, hours) * 60 * 60 * 1000;
}

function getFallbackMinItems(source) {
  const count = Number(source.fallbackMinItems ?? DEFAULT_FALLBACK_MIN_ITEMS);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}


function looksLikeContentUrl(url) {
  return !!url && !url.includes('#') && !/javascript:/i.test(url);
}

function parseUstcNotices(source, html) {
  const items = [];
  const sectionMatch = html.match(/<div id="wp_news_w2">([\s\S]*?)<\/table>/i);
  const section = sectionMatch?.[1] || html;
  const rowRegex = /<tr>[\s\S]*?<td[^>]*width=["']290["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>[\s\S]*?<td[^>]*width=["']40["'][^>]*>[\s\S]*?<font[^>]*>\s*(\d{2})-(\d{2})\s*<\/font>[\s\S]*?<\/tr>/gi;
  let match;

  while ((match = rowRegex.exec(section)) !== null) {
    const href = normalizeUrl(match[1], source.listUrl || source.url);
    if (!isLikelyArticleUrl(source, href)) continue;

    const title = cleanText(match[2]).replace(/\.\.\.$/, '').trim();
    if (!title || title.length < 6) continue;

    const month = Number(match[3]);
    const day = Number(match[4]);
    const now = new Date();
    let year = now.getUTCFullYear();
    if (month > now.getUTCMonth() + 1) {
      year -= 1;
    }

    const publishedAt = new Date(Date.UTC(year, month - 1, day)).toISOString();

    items.push({
      id: buildItemId(source, href, title),
      sourceId: source.id,
      sourceName: source.name,
      category: source.category,
      title,
      url: href,
      publishedAt,
      excerpt: '',
      content: ''
    });
  }

  return items;
}

function parseUstcNews(source, html) {
  const items = [];
  const sectionMatch = html.match(/<div[^>]*class=["'][^"']*list row[^"']*["'][^>]*>([\s\S]*?)<script>/i);
  const section = sectionMatch?.[1] || html;
  const blockRegex = /<div[^>]*class=["'][^"']*news-item[^"']*["'][^>]*>[\s\S]*?<a[^>]*class=["'][^"']*news-img-index[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<div[^>]*class=["'][^"']*info[^"']*["'][^>]*>\s*<a[^>]*href=["'][^"']+["'][^>]*>([\s\S]*?)<\/a>\s*<\/div>[\s\S]*?<div[^>]*class=["'][^"']*day[^"']*["'][^>]*>\s*(\d{1,2})\s*<\/div>[\s\S]*?<div[^>]*class=["'][^"']*month[^"']*["'][^>]*>\s*(20\d{2})\.(\d{2})\s*<\/div>[\s\S]*?<\/div>/gi;
  let match;

  while ((match = blockRegex.exec(section)) !== null) {
    const href = normalizeUrl(match[1], source.listUrl || source.url);
    if (!isLikelyArticleUrl(source, href)) continue;

    const title = cleanText(stripHtml(match[2])).replace(/\.\.\.$/, '').trim();
    if (!title || title.length < 6) continue;

    const day = Number(match[3]);
    const year = Number(match[4]);
    const month = Number(match[5]);
    const publishedAt = new Date(Date.UTC(year, month - 1, day)).toISOString();

    items.push({
      id: buildItemId(source, href, title),
      sourceId: source.id,
      sourceName: source.name,
      category: source.category,
      title,
      url: href,
      publishedAt,
      excerpt: '',
      content: ''
    });
  }

  return items;
}

function parseAieraNews(source, html) {
  const items = [];
  const blockRegex = /<article[^>]*class=["'][^"']*entry-card[^"']*["'][^>]*>[\s\S]*?<h2[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>[\s\S]*?<time[^>]*datetime=["']([^"']+)["'][^>]*>[\s\S]*?<\/time>[\s\S]*?<\/article>/gi;
  let match;

  while ((match = blockRegex.exec(html)) !== null) {
    const href = normalizeUrl(match[1], source.listUrl || source.url);
    if (!isLikelyArticleUrl(source, href)) continue;

    const title = cleanText(stripHtml(match[2]));
    if (!title || title.length < 6) continue;

    const publishedAt = new Date(match[3]).toISOString();

    items.push({
      id: buildItemId(source, href, title),
      sourceId: source.id,
      sourceName: source.name,
      category: source.category,
      title,
      url: href,
      publishedAt,
      excerpt: '',
      content: ''
    });
  }

  return items;
}

function parseHtmlList(source, html) {
  let items;

  if (source.id === 'ustc-notices') {
    items = parseUstcNotices(source, html);
  } else if (source.id === 'ustc-news') {
    items = parseUstcNews(source, html);
  } else if (source.id === 'aiera-news') {
    items = parseAieraNews(source, html);
  } else {
    items = [];
    const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = anchorRegex.exec(html)) !== null) {
      const href = normalizeUrl(match[1], source.listUrl || source.url);
      if (!looksLikeContentUrl(href) || !isLikelyArticleUrl(source, href)) continue;

      const title = extractTitleFromAnchor(match[0]);
      if (!title || title.length < 6) continue;
      if (/^(首页|上一页|下一页|尾页|更多|专题|English)$/i.test(title)) continue;

      const contextStart = Math.max(0, match.index - 240);
      const contextEnd = Math.min(html.length, match.index + match[0].length + 240);
      const context = html.slice(contextStart, contextEnd);
      const excerpt = buildExcerptFromContext(context, title);
      const publishedAt = extractStructuredDate(context) || extractDateNearby(context);

      items.push({
        id: buildItemId(source, href, title),
        sourceId: source.id,
        sourceName: source.name,
        category: source.category,
        title,
        url: href,
        publishedAt,
        excerpt,
        content: excerpt
      });
    }
  }

  const unique = [];
  const seen = new Set();
  const cutoff = Date.now() - getSourceLookbackMs(source);
  const fallbackMinItems = getFallbackMinItems(source);

  for (const item of items.sort((a, b) => {
    if (a.publishedAt && b.publishedAt) return new Date(b.publishedAt) - new Date(a.publishedAt);
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return 0;
  })) {
    const key = `${item.url}::${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const itemTs = item.publishedAt ? new Date(item.publishedAt).getTime() : null;
    if (itemTs && itemTs < cutoff && unique.length >= fallbackMinItems) continue;

    unique.push(item);
    if (unique.length >= MAX_ITEMS_PER_SOURCE) break;
  }

  return unique;
}

function parseRssItems(source, xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) || block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    const descMatch = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) || block.match(/<description>([\s\S]*?)<\/description>/i);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

    const title = titleMatch ? stripHtml(titleMatch[1]) : '';
    const url = linkMatch ? normalizeUrl(linkMatch[1].trim(), source.url) : null;
    const excerpt = descMatch ? stripHtml(descMatch[1]).slice(0, 240) : '';
    const publishedAt = pubDateMatch ? new Date(pubDateMatch[1].trim()).toISOString() : null;

    if (!title || !url) continue;

    items.push({
      id: buildItemId(source, url, title),
      sourceId: source.id,
      sourceName: source.name,
      category: source.category,
      title,
      url,
      publishedAt,
      excerpt,
      content: excerpt
    });

    if (items.length >= MAX_ITEMS_PER_SOURCE) break;
  }

  return items;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.text();
}

function extractMetaContent(html, name) {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["'][^"']*${name}[^"']*["'][^>]+content=["']([^"']+)["']`, 'i');
  return cleanText(pattern.exec(html)?.[1] || '');
}

function extractDocumentTitle(html) {
  const title = cleanText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
  return title
    .replace(/[\-_|｜].*$/, '')
    .replace(/\s+[–—-]\s*新智元$/i, '')
    .trim();
}

async function enrichHtmlItems(items, source, errors) {
  const enriched = [];

  for (const item of items) {
    if (!item.url || (!item.title.endsWith('...') && item.excerpt)) {
      enriched.push(item);
      continue;
    }

    try {
      const html = await fetchText(item.url);
      const fullTitle = extractDocumentTitle(html);
      const excerpt = extractMetaContent(html, 'description');

      enriched.push({
        ...item,
        title: fullTitle || item.title,
        excerpt: excerpt || item.excerpt,
        content: excerpt || item.content
      });
    } catch (err) {
      errors.push(`${source.name} detail: ${item.url} (${err.message})`);
      enriched.push(item);
    }
  }

  return enriched;
}

async function fetchSourceItems(source, state, errors) {
  try {
    const text = await fetchText(source.listUrl || source.url);
    let items = source.type === 'rss'
      ? parseRssItems(source, text)
      : parseHtmlList(source, text);

    if (source.type === 'html') {
      items = await enrichHtmlItems(items, source, errors);
    }

    const cutoff = Date.now() - getSourceLookbackMs(source);
    const fallbackMinItems = getFallbackMinItems(source);
    const freshItems = [];

    for (const item of items) {
      if (state.seenItems[item.id] || state.seenItems[item.url]) continue;

      const itemTs = item.publishedAt ? new Date(item.publishedAt).getTime() : null;
      if (itemTs && itemTs < cutoff && freshItems.length >= fallbackMinItems) continue;

      state.seenItems[item.id] = Date.now();
      state.seenItems[item.url] = Date.now();
      freshItems.push(item);
    }

    return freshItems;
  } catch (err) {
    errors.push(`${source.name}: ${err.message}`);
    return [];
  }
}

async function fetchRadarContent(sources, state, errors) {
  const results = [];

  for (const source of sources.filter(s => s.enabled !== false)) {
    console.error(`Fetching ${source.name}...`);
    const items = await fetchSourceItems(source, state, errors);
    results.push(...items);
  }

  return results.sort((a, b) => {
    if (a.publishedAt && b.publishedAt) return new Date(b.publishedAt) - new Date(a.publishedAt);
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return a.sourceName.localeCompare(b.sourceName, 'zh-CN');
  });
}

function buildStats(items) {
  const byCategory = {
    campus_notices: 0,
    community: 0,
    tech_news: 0
  };

  for (const item of items) {
    if (byCategory[item.category] !== undefined) {
      byCategory[item.category] += 1;
    }
  }

  return {
    totalItems: items.length,
    byCategory
  };
}

async function main() {
  const sourcesConfig = await loadSources();
  const state = await loadState();
  const errors = [];
  const items = await fetchRadarContent(sourcesConfig.sources || [], state, errors);

  const feed = {
    generatedAt: new Date().toISOString(),
    lookbackHours: LOOKBACK_HOURS,
    items,
    stats: buildStats(items),
    errors: errors.length > 0 ? errors : undefined
  };

  await writeFile(FEED_PATH, JSON.stringify(feed, null, 2));
  await saveState(state);

  console.error(`feed-radar.json: ${items.length} items`);
  if (errors.length > 0) {
    console.error(`${errors.length} non-fatal errors`);
  }
}

main().catch(err => {
  console.error('Feed generation failed:', err.message);
  process.exit(1);
});
