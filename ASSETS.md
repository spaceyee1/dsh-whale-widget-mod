# 素材来源与本次发布范围

适用版本：**dsh whale 改版挂件 v1.0.0**。记录日期：2026-10-12。

这份源码快照来自本机已安装的 `0.3.16-companion.11`；采集时未发现运行中的 DSH 进程。公开仓库和源码包未包含下表 12 个媒体文件；本机安装中的文件没有删除或替换。运行源码保持原样，因此源码和保留的历史文档仍可能引用这些路径。**本次不是带齐媒体的即用安装包**；角色、气泡图片或声音在资源缺失时可能不可用。

## 来源与许可边界

感谢原项目作者及维护者 **[MeteorNOX（月匠）](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/commits?author=MeteorNOX)**、[DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的贡献者和各素材创作者。本地合作扩展的历史署名 `spceyee` 保留于 [ATTRIBUTION.md](ATTRIBUTION.md)，不代替原项目或素材作者。

本机随附 [PROVENANCE.md](PROVENANCE.md) 明确把图片、GIF、音效排除在代码 MIT 范围外；[当前上游来源说明](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/blob/main/PROVENANCE.md) 仍保留这一边界。12 个文件没有随本次公开包分发，原因均为：**现有证据尚未确认这些媒体在 spaceyee1 新改版仓库中的再分发权限**。这是发布范围和证据限制，并非已经认定素材侵权。

原始 `PROVENANCE.md`、`ATTRIBUTION.md`、`UPSTREAM-SOURCE.md` 和历史 README 保留原文，其中“内置”“随安装器提供”等措辞描述历史安装版，不是本次公开源码包的文件清单。代码 MIT、同字节哈希和署名均不扩大媒体权利。

## 未包含的 12 个文件

原始字节数、SHA-256 与排除原因见 [SOURCE-SNAPSHOT.json](SOURCE-SNAPSHOT.json) 的 `files` 数组，按完整 `sourcePath` 查找。以下文件的 `publishedPath` 均为 `null`。哈希只记录采集时文件身份，不证明授权。

| 原路径 | 已知来源与鸣谢 | 未包含原因 |
| --- | --- | --- |
| `assets/DSniang1.png` | MeteorNOX 提供的上游角色图；原文记为 AI 生成后挑选、裁切，具体生成工具与原始出处未能确定。 | 未确认本改版公开再分发权限。 |
| `assets/DSniang02.png` | 同系列备用角色图；具体生成工具与原始出处未能确定。 | 同上。 |
| `assets/DSH2.png` | 上游展示图，来源说明记为 MeteorNOX 自行设计与排版，使用在线设计工具；未明确工具名称。 | 同上。 |
| `assets/rua.gif` | MeteorNOX 提供的内置动图；Codex 上游补充资料记为由提供者使用网站工具制作，未给出工具名称。 | 同上；其他项目的分发说明不能自动覆盖本仓库。 |
| `assets/bubble-petpet.gif` | 上游内置动图，提供者与工具线索同上；在本快照中与 `rua.gif` 同 SHA-256。 | 同上。 |
| `assets/bubble-money1.gif` | MeteorNOX 上游内置余额预警泡泡图；现有原文未确定其具体创作者、制作工具和原始素材地址。 | 未确认本改版公开再分发权限。 |
| `assets/D1.mp3` | MeteorNOX 上游内置按压／松开音效；现有记录未确定具体录音制作人和原始素材地址。 | 同上。 |
| `assets/D2.mp3` | 同组内置音效；具体录音作者与原始素材地址未能确定。 | 同上。 |
| `assets/Ya1.mp3` | MeteorNOX 上游内置按压／松开音效；具体录音作者与原始素材地址未能确定。 | 同上。 |
| `assets/Ya2.mp3` | 同组内置音效；具体录音作者与原始素材地址未能确定。 | 同上。 |
| `assets/minecraft-exp-orb.wav` | 上游标注为 **Minecraft 经验球**音效；鸣谢 Minecraft 原作及相关音效创作者，品牌与游戏来源为 **Mojang Studios / Microsoft**。现有记录未明确此 WAV 的提取者、版本和具体音效作者，不将它署为挂件作者原创。 | 代码 MIT 不覆盖游戏声音；未确认该 WAV 在本改版中的再分发许可。 |
| `assets/task-end-a.wav` | 上游内置任务结束音“预设 A”；具体创作者、制作工具和原始素材地址未能确定。 | 未确认本改版公开再分发权限。 |

补充来源线索：Yang 的 [For-Codex 素材分发说明](https://github.com/Yang-huai406/Codex-Whale-Public/blob/main/docs/MATERIALS-PERMISSION.md) 记录了提供者对动图的说明及其维护者继续保留四个 MP3 的决定，范围针对该 For-Codex 发布线，不为这个 DSH 改版授予新权利。其中用 **EmoteLab** 制作的是 `bubble-yue-money.gif`，本 DSH 快照没有这个文件，不能据此推断 `bubble-money1.gif` 也来自 EmoteLab。Minecraft 的独立使用条件见 [官方使用指南](https://www.minecraft.net/en-us/usage-guidelines)，本仓库没有从该指南推导出单独分发此声音文件的许可。

## 在自己的本地副本恢复素材

1. 保留现有 DSH 安装与挂件目录。先把本源码解压到独立目录，避免拿缺失媒体的目录覆盖正在使用的版本。
2. 从**自己有权使用的本地安装或备份**中，按表逐个复制相应文件，恢复到新副本 `assets/` 下的同名路径。只取媒体，不复制账号凭据、配置、插件 Key、聊天、账本或运行日志。
3. 如需严格复现采集素材，按 `SOURCE-SNAPSHOT.json` 的 `sourcePath`、`sha256` 核对。例如：`Get-FileHash -Algorithm SHA256 -LiteralPath '.\assets\DSniang1.png'`。不同哈希不能宣称与采集快照同字节。
4. 本仓库不自动下载媒体，也不通过网友图库寻找替代品。无权使用或没有相应文件时，保留缺失状态；若后续使用自己创作或明确获许的替代媒体，需要按实际格式另行验证资源兼容性。

本地恢复不自动授予公开转载权限；以后分享自己的包时仍按各素材实际许可判断。DSH 的安装条件和源码包使用范围见 [README.md](README.md)。

