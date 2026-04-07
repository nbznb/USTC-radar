**English** | [中文](README.zh-CN.md)

# USTC Radar

A lightweight radar pipeline that automatically discovers useful information for USTC users and turns it into a daily brief.

## MVP Scope

This first version focuses on three categories:

- Campus notices
- Community information
- Tech news

The current hardcoded sources include:
- USTC official notices
- USTC news
- Tech news sites such as QbitAI

## What It Does

1. Fetches recent items from configured sources
2. Deduplicates them across runs
3. Normalizes them into one radar feed
4. Prepares a digest payload for an LLM
5. Delivers the final brief through stdout, Telegram, or email

## Main Files

- `scripts/generate-feed.js` - fetch and generate `feed-radar.json`
- `scripts/prepare-digest.js` - prepare the LLM input JSON
- `scripts/deliver.js` - deliver the final digest
- `config/default-sources.json` - hardcoded source list
- `prompts/` - digest and summary prompts

## Output Shape

The generated feed is written to `feed-radar.json` with normalized items like:

- `sourceName`
- `category`
- `title`
- `url`
- `publishedAt`
- `excerpt`
- `content`

## Run Locally

```bash
cd scripts && npm install
node generate-feed.js
node prepare-digest.js
```

## Categories

- `campus_notices` - school notices and official announcements
- `community` - campus news and community activity
- `tech_news` - external technology news worth tracking

## Delivery

Delivery still supports:
- stdout
- Telegram
- email

## Notes

This MVP intentionally uses a small hardcoded source list so the pipeline can be validated first. Later versions can expand the source schema and scraping logic.
