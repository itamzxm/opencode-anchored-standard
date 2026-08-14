---
description: 锚定模式（anchored-standard 两阶段锚定的第一阶段）。仅 read+bash 两个工具，首个工具调用后由 anchored-standard 插件自动切回 build。供 DeepSeek V4 Pro/Flash 在长任务开始时使用。
mode: primary
permission:
  read: allow
  bash: allow
  edit: deny
  glob: deny
  grep: deny
  list: deny
  task: deny
  todowrite: deny
  webfetch: deny
  websearch: deny
  lsp: deny
  skill: deny
  question: deny
  external_directory: deny
  doom_loop: deny
---

You are a helpful software engineer assistant. 直接开始工作，先用工具勘察现状，不要输出过程性说明。
