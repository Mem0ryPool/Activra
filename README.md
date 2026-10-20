# Activra

**Action · Progress · Achievement（行动 · 推进 · 成就）**

[English](README.en.md)

Activra 是一款离线优先的桌面效率应用，把任务、计划、习惯和专注记录整理成清晰的行动与成就。核心功能不需要账号或云服务；应用数据保存在本机。

本仓库是从已审计的 `1.0.0-rc.3` 候选基线 `b1f65184cb3ad21beac9b0f33174243000489403` 准备的开源 staging。它不是已发布版本，也不包含下载链接、签名安装包或自动发布配置。

现有 Windows RC.3 安装包来自上述冻结基线，未被本仓库修改。本 staging 在基线之后增加了开源许可证/公开文档、第三方通知和开发服务器来源校验修复，因此其最终 Git 提交不是该安装包的逐字源码快照，也不能据此声称安装包可字节复现。若以后发布新的二进制，应从本仓库重新构建并单独完成安装、升级、卸载、签名和哈希验收。

## 功能

- 任务、重复规则、截止提醒、撤销和成就通知
- 离线规则驱动的智能计划，不调用 AI 或网络服务
- 习惯打卡、连续纪录和本地周报
- 专注计时、日历、统计和桌面小组件
- 简体中文与英文界面

## 开发

要求 Node.js 22 LTS（≥ 22.12）和 npm。

```bash
npm ci
npm run dev
```

常用检查：

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Windows 与 macOS 构建说明分别见 [docs/windows-release.md](docs/windows-release.md) 和 [docs/macos.md](docs/macos.md)。安装包默认不签名；构建配置中的 `publish: null` 禁止 electron-builder 自动上传产物。

## 数据与隐私

应用数据位于系统的 `Life Unlocked` user-data 目录；公开名称改为 Activra 后仍保留该目录名，以兼容旧数据。格式、备份和迁移见 [docs/data-migration.md](docs/data-migration.md)。

测试和贡献必须使用合成数据或隔离目录。请勿提交真实任务、日志、用户数据、凭据、安装包或其他个人信息。

## 参与贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [SECURITY.md](SECURITY.md)。提交变更前至少运行与变更相关的类型检查、lint 和测试。

## 许可证

Activra 的原创源代码与原创文档使用 [MIT License](LICENSE)：

`Copyright (c) 2026 Mem0ry`

`private: true` 仅用于防止误发到 npm registry，不限制本仓库依据 MIT License 使用源代码。

MIT License 不覆盖第三方组件，也不自动授予 Activra 名称、Logo 或派生品牌素材的使用权。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [BRANDING.md](BRANDING.md)。
