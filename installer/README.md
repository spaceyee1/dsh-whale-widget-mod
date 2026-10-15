# v1.0.3 Windows x64 安装器

安装器只包装已发布的 v1.0.3 插件（内部版本 0.3.16-companion.14），不修改插件运行代码。源码 ZIP 通过固定 SHA-256 和逐文件清单校验后嵌入 EXE；附加安装说明不覆盖原文档。

Windows 10/11 的 .NET Framework C# 编译器即可构建，不需要下载编译依赖：

```powershell
.\build.ps1 -SourceZip 'C:\Downloads\dsh-whale-widget-mod-v1.0.3-source.zip' -OutDirectory 'C:\build-output' -BuildDirectory 'C:\build-temp-v103'
```

构建目录与 EXE 目标必须不存在，避免混入旧文件。请先下载发布页的源码 ZIP，SHA-256 应为 `00c83b62f76f7a7c5381bcb412e7f57b07def7457abfed0fa8403a34078f77f6`。

使用 Windows PowerShell 5.1 运行 `verify.ps1`，传入 `-Exe`、`-SourceZip`，可在临时模拟 profile 检查解压、安装、重复安装、双目录同步、失败回滚、素材与设置保留以及非法路径拒绝。请先退出真实 DSH，安装器的命令行入口同样拒绝在 DSH 运行期间修改插件。

用户操作见 [安装说明](INSTALLER-GUIDE.md)。EXE 使用当前用户权限，不请求管理员权限，不下载 DSH，不运行 API 请求。原始媒体不会打包；升级保留本地媒体，首次缺图时以几何代码生成简易蓝鲸占位。
