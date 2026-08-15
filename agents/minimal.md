---
description: 官方对齐锚定模式（anchored-standard v5.4 极简内部载体，由插件自动路由，用户无需切换）。权限 read/bash/edit/write + webfetch（网页抓取；websearch 已移除——实测需 Exa/Parallel API key 才启用，本机无 key 不注册，webfetch 抓搜索页即可覆盖）。glob/grep 等保持 deny（报告实测 glob 破坏轨迹）。
mode: primary
permission:
  read: allow
  bash: allow
  edit: allow
  write: allow
  webfetch: allow
  glob: deny
  grep: deny
  list: deny
  task: deny
  todowrite: deny
  websearch: deny
  lsp: deny
  skill: deny
  question: deny
  doom_loop: deny
  describe_image: deny
  html2read: deny
  invalid: deny
---
