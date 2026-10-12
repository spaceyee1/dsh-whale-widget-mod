# 署名与鸣谢

原项目：DSH 小鲸鱼记账挂件（DeepSeek Balance Whale Widget）。

- 原项目作者/维护者：[MeteorNOX](https://github.com/MeteorNOX)。
- 上游仓库：[https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。
- 保留的上游基线：v0.3.16，提交 `86af3f2d90870d14742d2083e532b98a16b7b25c`。
- AI 插话、模式与提示词、通用 API 和隐私功能合作扩展：spceyee。
- 本合作扩展版本：0.3.16-companion.11。合作关系按 spceyee 的说明标注，本文不代替上游作发布或审核声明。

感谢 MeteorNOX 的原始设计、代码和维护，感谢上游社区的报告、修复及贡献。现有安装包 README 的上游说明与原有贡献者鸣谢完整保留；v0.3.16 标签的未改动 README 另存为 `UPSTREAM-README-v0.3.16.md`。没有把原项目或素材改署为 spceyee 的原创作品。

原始 `LICENSE` 中 `Copyright (c) 2026 MeteorNOX` 完整保留，未替换、删减或重写。原 `LICENSE` 的 MIT 条款适用于上游代码；图片、动图和音效不适用这份代码许可。原 `PROVENANCE.md` 的来源及范围说明原字节保留，本版不把素材改署为合作扩展作者原创，也不另行授予素材或其他第三方内容的权利。署名、保留来源或“原样提供”不等于已核实全部第三方授权，不构成版权豁免。

图片、动图、音效与上游字节一致只佐证来源，不能推出本次再分发已获授权。220 项技术回归不属于授权审查，也不能代替权利人许可证明。

原版完整源码与 npm 原包单独封存；扩展源码、差异补丁与逐文件校验清单另存。新增功能已经修改了 `lib/index.js` 与 `assets/whale-widget.js`，不能把运行中的扩展源码宣称为未修改的上游源码。

`.11` 仅修正文档和版本元数据，运行 JavaScript 与 `.10` 逐字节相同，不新增许可证或替换上游许可。`.10` 已实现缺失与不可读取 Key 的状态区分、成功清除后的同一进程恢复，这些行为继续保留。用户说明单独另存并随 EXE 内嵌为“用户使用方式.md”。群文件采用严格四段名 dsh-小鲸鱼AI插话防火墙增强-0.3.16c11-spceyee.exe。

本扩展 API 认证使用单独配置的插件 Key，不自动携带或注入 DSH 主聊天凭据；本机取值、解密与 API 认证发送是不同步骤。两处由用户填入同一串 Key 时值相同，配置来源分开不代表秘密不同。此项行为说明不改变原作者署名或许可范围。
