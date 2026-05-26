# 专属邀约 Private Invitation

[English](README_EN.md)

一款 SillyTavern 扩展，把主页变成角色邀约入口。它会随机展示你选中的角色，用整张角色封面、回忆台词、故事钩子和可选挽留文案，把角色重新带回视野。

这个插件解决的不是“没有角色”，而是角色库变大后，用户忘了该回去找谁。

---

## 功能亮点

- **主页随机邀约** — 从邀约角色池里随机展示角色。
- **三种展示方式** — 弹幕、气泡、电影横幅。
- **每角色独立文案池** — 主邀约文案和挽留文案分开保存。
- **AI 批量草稿** — 可读取角色卡、聊天记录、指定聊天文件、世界书和世界书条目，先生成草稿，再由用户挑选加入文案池。
- **主页不临时调用 AI** — 真实弹出只读取已保存文案，速度稳定，行为可控。
- **上下文控制** — 支持楼层范围、每批楼层数、包含标签、排除标签、聊天文件、世界书、世界书条目细选。
- **视觉定制** — 封面动效、封面适配、9 宫格气泡位置、微调偏移、透明度、内置 CSS 模板、自定义 CSS 模板、AI 写 CSS。
- **共享 / 独立 API** — 可用 SillyTavern 当前 API，也可配置独立 OpenAI 兼容接口，支持档案管理和模型列表拉取。
- **中英双语 i18n** — 自动按界面语言加载。
- **移动端兜底** — 小屏下操作按钮保持可见可点，避免被自定义 CSS 挤出视口。

---

## 安装

**方法一 — 从酒馆界面安装**

1. 打开 **扩展** → **安装扩展**。
2. 输入仓库地址：`https://github.com/Asobi-123/private-invitation`。
3. 刷新 SillyTavern。

**方法二 — 手动安装**

```bash
cd SillyTavern/data/default-user/extensions/
git clone https://github.com/Asobi-123/private-invitation.git
```

安装后刷新 SillyTavern 页面。

---

## 使用方式

1. 在 SillyTavern 的 extension menu 打开 **专属邀约**。
2. 在 **邀约角色** 中勾选会出现在主页邀约里的角色。
3. 在 **文案** 中选择当前角色，管理主邀约文案池和挽留文案池。
4. 在 **AI 生成** 中读取角色卡、聊天记录和世界书，批量生成草稿。
5. 在 **风格** 和 **外观** 中调整封面、气泡、横幅和自定义 CSS。
6. 按需要启用主页自动弹出。

AI 生成只产生草稿。主页邀约只读取已保存文案池，不会在弹出时临时请求模型。

---

## 部署兼容性

插件使用相对模块导入和同源 SillyTavern API 请求，可在这些环境使用：

- `localhost`
- 普通 HTTP
- HTTPS
- 纯 IP VPS，例如 `http://203.0.113.10:8000`

独立 API 模式经由 SillyTavern 后端请求用户填写的接口，不由浏览器直接请求 API URL。因此 HTTPS 酒馆页面也可以配置 HTTP 独立 API 地址。

---

## 项目结构

```text
manifest.json          — SillyTavern 扩展清单
index.js               — 扩展入口
settings.html          — 扩展设置入口
console.html           — 居中控制台
menu-item.html         — extension menu 模板
style.css              — 扩展样式
i18n/                  — 中英文文案
src/
  bootstrap.js         — 启动
  constants.js         — 常量
  i18n.js              — 自包含 i18n 加载器
  utils.js             — 共享工具
  core/
    app.js             — 主逻辑和 UI 绑定
    ui.js              — 模板挂载辅助
docs/                  — 架构、数据模型、测试、排障
```

---

## 相关文档

- [更新日志](CHANGELOG.md)
- [发布前手动检查](docs/MANUAL_TESTING.md)
- [常见问题排查](docs/TROUBLESHOOTING.md)
- [架构说明](docs/ARCHITECTURE.md)
- [数据模型](docs/DATA_MODEL.md)

---

## 许可证

[AGPL-3.0](LICENSE)
