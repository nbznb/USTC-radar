[English](README.md) | **中文**

# USTC 雷达

一个轻量的信息雷达流水线，自动搜寻对 USTC 用户有价值的信息，并整理成每日简报。

## 第一版范围

当前 MVP 先覆盖三类内容：

- 校内通知
- 社区信息
- 科技信息

目前写死的数据源包括：
- 中国科大官方通知
- 中国科大新闻网
- 量子位等科技新闻站点

## 它现在做什么

1. 从配置好的信息源抓取最近内容
2. 跨运行去重
3. 统一整理成一个雷达 feed
4. 为 LLM 准备摘要输入 JSON
5. 通过 stdout、Telegram 或邮件投递最终简报

## 核心文件

- `scripts/generate-feed.js` - 抓取并生成 `feed-radar.json`
- `scripts/prepare-digest.js` - 生成给模型的输入 JSON
- `scripts/deliver.js` - 投递最终摘要
- `config/default-sources.json` - 当前写死的数据源列表
- `prompts/` - 摘要和最终简报 prompt

## 输出结构

生成结果写入 `feed-radar.json`，每条 item 统一为：

- `sourceName`
- `category`
- `title`
- `url`
- `publishedAt`
- `excerpt`
- `content`

## 本地运行

```bash
cd scripts && npm install
node generate-feed.js
node prepare-digest.js
```

## 分类说明

- `campus_notices` - 校内通知和官方公告
- `community` - 校园新闻和社区动态
- `tech_news` - 值得关注的外部科技资讯

## 投递方式

当前仍支持：
- stdout
- Telegram
- email

## 说明

这个 MVP 故意先用少量写死数据源，先验证整条流水线可用。后续再继续扩展 source schema 和抓取逻辑。
