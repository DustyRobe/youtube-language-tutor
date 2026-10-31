# 视频语言精讲助手

[简体中文](README.md) | [English](README.en.md)

Chrome Manifest V3 扩展，围绕 YouTube 英文视频提供字幕同步、逐句暂停和 AI 分级讲解，也支持 Bilibili 英文 CC 字幕及手动导入 SRT/VTT。

## 功能

- 自动采集字幕，合并碎片字幕为较完整的学习片段，控制过长断句。
- 浮动面板、拖动调整宽度、字幕定位、倍速和逐句暂停；仅展开当前片段的讲解。
- 按 A1–C2 英语水平生成台词释义、词汇、短语、语法、文化背景与使用提示。
- 自动按每批 5 个片段预加载讲解，复用本地缓存。
- 独立设置页，支持按水平和界面语言编辑提示词。
- 讲解语言和界面语言分别设置，支持中文、英语、法语、日语、韩语、俄语、西班牙语、德语、葡萄牙语和阿拉伯语。
- 模型服务预设：OpenAI、DeepSeek、Gemini、Claude、Qwen、Kimi、GLM、豆包、Mistral、Groq、xAI、OpenRouter、SiliconFlow；另有 Codex 和自定义接口配置。
- 支持 Chat Completions、Responses、Anthropic Messages、Gemini generateContent 请求格式。

## 安装

1. 下载或克隆此仓库。
2. 打开 Chrome 的 `chrome://extensions`，启用开发者模式。
3. 选择「加载已解压的扩展程序」，选中包含 `manifest.json` 的仓库目录。
4. 打开 YouTube 视频，必要时开启英文字幕。
5. 点击面板顶部的 ⚙，配置模型服务、API Key、账号可用的模型 ID 和语言偏好。

OpenAI / Codex 预填的模型名称可手动修改，应以实际服务和账号支持的模型 ID 为准。各服务的地址、模型权限、地域及 JSON 模式支持可能不同，需按对应平台调整。

## 数据与调用

API 配置保存在浏览器扩展本地存储，字幕及讲解缓存保存在本地 IndexedDB。生成讲解时，相关台词、少量上下文及教学提示词会发送给用户配置的模型服务；自动预加载也会产生该服务的 API 用量。

项目源码不需要包含真实 API Key，请勿将密钥或导出的个人配置提交到仓库。

Bilibili 自动采集需要播放器提供英文字幕轨道，可能需要登录。直接烧录到画面内的字幕无法通过字幕文件接口读取。分句依据现有字幕时间轴和文本规则，无法保证对无标点或时间轴不准确的字幕完美断句。

## 验证

需要 Node.js，纯逻辑测试无需安装 npm 依赖：

```sh
node --test tests/*.test.cjs
```

布局预览测试需要 macOS 和默认安装位置的 Google Chrome：

```sh
node tests/layout-browser.cjs
```

自动化 API 测试使用模拟响应，不代表已用所有模型平台的真实密钥完成验证。

## 目录

- `src/content`：视频适配、字幕桥接、浮动讲解面板。
- `src/background`：模型请求、消息路由和缓存。
- `src/settings`：独立设置页面。
- `src/popup`：扩展弹窗、模型配置与字幕导入。
- `src/utils`：字幕解析、分句和本地化。
- `assets`：扩展图标。
- `tests`：功能回归测试与浏览器布局预览。
