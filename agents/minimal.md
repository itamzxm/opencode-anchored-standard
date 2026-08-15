---
description: 官方对齐锚定模式（anchored-standard v4 首轮内部载体，由插件自动路由，用户无需切换）。权限仅 read/bash/edit/write 四工具（官方 minimal 两工具 bash+str_replace_editor 的功能等价），其余工具描述全部拦截（含插件自定义工具）。glob 是报告实测的轨迹破坏分界，保持 deny。
mode: primary
permission:
  read: allow
  bash: allow
  edit: allow
  write: allow
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
  doom_loop: deny
  describe_image: deny
  html2read: deny
  invalid: deny
---
