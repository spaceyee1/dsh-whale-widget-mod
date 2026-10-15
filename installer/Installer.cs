using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Derived from the earlier DSH Whale installer. Only plugin directories and
// necessary registration are changed. DSH_HOME secrets and user data stay put.
internal static class Installer {
    const string Plugin="dsh-whale-widget";
    static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static readonly HashSet<string> Media=new HashSet<string>(StringComparer.OrdinalIgnoreCase){".png",".jpg",".jpeg",".gif",".webp",".ico",".mp3",".wav",".ogg",".m4a",".flac"};
    [STAThread] static int Main(string[] args) {
        try {
            if(args.Length==2 && args[0]=="--extract-only"){Extract(args[1]);return 0;}
            if(args.Length==2 && args[0]=="--install"){Install(args[1]);return 0;}
            if(args.Length==2 && args[0]=="--export-guide"){ExportUserGuide(args[1]);return 0;}
            if(args.Length==2 && args[0]=="--render-ui"){
                Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
                string file=Full(args[1]);NoLinks(file);
                using(var form=new InstallForm(true)){
                    form.ShowInTaskbar=false;form.StartPosition=FormStartPosition.Manual;form.Location=new Point(-32000,-32000);
                    try{
                        // Child controls become visible only after Show; keep
                        // this QA-only form off screen and do not activate it.
                        form.Show();Application.DoEvents();form.PerformLayout();form.Update();
                        using(var bitmap=new Bitmap(form.Width,form.Height)){
                            form.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));
                            using(var output=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None))bitmap.Save(output,ImageFormat.Png);
                        }
                    }finally{form.Close();}
                }return 0;
            }
            if(args.Length!=0)throw new Exception("不支持的参数。");
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new InstallForm());return 0;
        }catch(Exception e){if(args.Length==0)MessageBox.Show(e.Message,"DSH 小鲸鱼安装包",MessageBoxButtons.OK,MessageBoxIcon.Error);else Console.Error.WriteLine(e.Message);return 1;}
    }
    static string Full(string value){
        if(String.IsNullOrWhiteSpace(value)||!Path.IsPathRooted(value))throw new Exception("请选择完整的文件夹路径。");
        string full=Path.GetFullPath(value);
        if(String.Equals(full.TrimEnd('\\'),Path.GetPathRoot(full).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))throw new Exception("不能使用磁盘根目录。");
        return full.TrimEnd(Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar);
    }
    static void NoLinks(string value){
        for(string p=Path.GetFullPath(value);!String.IsNullOrEmpty(p);p=Path.GetDirectoryName(p)){
            FileAttributes attributes;
            try{attributes=File.GetAttributes(p);}catch(FileNotFoundException){continue;}catch(DirectoryNotFoundException){continue;}
            if((attributes&FileAttributes.ReparsePoint)!=0)
                throw new Exception("目标或素材路径包含链接／重定向目录，未安装。pnpm 链接安装请先通过 DSH 插件管理器处理。");
        }
    }
    static string Hash(Stream stream){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
    static Dictionary<string,object> Map(object value){return value as Dictionary<string,object>;}
    static object Get(Dictionary<string,object> value,string key){object item;return value!=null&&value.TryGetValue(key,out item)?item:null;}
    static Dictionary<string,object> ReadObject(string file){NoLinks(file);return Map(Json.DeserializeObject(File.ReadAllText(file,Utf8)));}
    static string VersionOf(string folder){string file=Path.Combine(folder,"package.json");NoLinks(file);return File.Exists(file)?Get(ReadObject(file),"version") as string:null;}
    public static string ReadUserGuide(){
        using(var payload=Assembly.GetExecutingAssembly().GetManifestResourceStream("Whale.Payload.zip")){
            if(payload==null||Hash(payload)!=BuildInfo.PayloadHash)throw new Exception("安装包完整性检查失败。");payload.Position=0;
            using(var zip=new ZipArchive(payload,ZipArchiveMode.Read)){
                var entry=zip.GetEntry(Plugin+"/INSTALLER-GUIDE.md");
                if(entry==null||entry.Length<1||entry.Length>131072)throw new Exception("安装使用说明缺失或大小无效。");
                using(var input=entry.Open())using(var reader=new StreamReader(input,Utf8,false))return reader.ReadToEnd();
            }
        }
    }
    static void ExportUserGuide(string destination){string file=Full(destination);NoLinks(file);byte[] bytes=Utf8.GetBytes(ReadUserGuide());using(var output=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None))output.Write(bytes,0,bytes.Length);}
    public static void Extract(string destination){
        string root=Full(destination);NoLinks(root);
        if(File.Exists(root)||(Directory.Exists(root)&&Directory.GetFileSystemEntries(root).Length!=0))throw new Exception("解压目标必须为空文件夹。");
        using(var payload=Assembly.GetExecutingAssembly().GetManifestResourceStream("Whale.Payload.zip")){
            if(payload==null||Hash(payload)!=BuildInfo.PayloadHash)throw new Exception("安装包完整性检查失败。");payload.Position=0;
            using(var zip=new ZipArchive(payload,ZipArchiveMode.Read)){
                var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long total=0;
                if(zip.Entries.Count>2000)throw new Exception("安装包条目过多。");
                foreach(var item in zip.Entries){
                    string relative=item.FullName.Replace('/',Path.DirectorySeparatorChar);
                    if(Path.IsPathRooted(relative)||relative.IndexOf(':')>=0||relative.EndsWith("\\")||relative.EndsWith("."))throw new Exception("安装包路径无效。");
                    foreach(string part in relative.Split(Path.DirectorySeparatorChar))if(part==".."||part=="."||part.Length==0||part.EndsWith(" ")||part.EndsWith("."))throw new Exception("安装包路径无效。");
                    string target=Path.GetFullPath(Path.Combine(root,relative));
                    if(!target.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!relative.StartsWith(Plugin+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!seen.Add(target))throw new Exception("安装包路径越界或重复。");
                    total+=item.Length;if(total>128L*1024*1024)throw new Exception("安装包展开大小超过限制。");
                }
                Directory.CreateDirectory(root);
                foreach(var item in zip.Entries){
                    string target=Path.GetFullPath(Path.Combine(root,item.FullName.Replace('/',Path.DirectorySeparatorChar)));NoLinks(target);Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using(var input=item.Open())using(var output=new FileStream(target,FileMode.CreateNew,FileAccess.Write,FileShare.None))input.CopyTo(output);
                }
            }
        }
    }
    static bool HasBundle(Dictionary<string,object> profile){var bundles=Get(Map(Get(Map(Get(profile,"dsh")),"profile")),"bundles") as IEnumerable;if(bundles!=null)foreach(object item in bundles)if(String.Equals(item as string,Plugin,StringComparison.Ordinal))return true;return false;}
    static bool HasDeclaration(string text){
        // Read only ordinary loader rows and direct insert children. A nested
        // config field named "name" is not a registration. Preserve explicit
        // removal/replacement requests instead of silently undoing them.
        string[] lines=text.Replace("\r","").Split('\n');
        int insertIndent=-1,childIndent=-1,rowIndent=-1,blockedIndent=-1;bool found=false;
        string exact=@"['"" ]*dsh-whale-widget['"" ]*\s*(?:#.*)?$";
        foreach(string line in lines){
            if(String.IsNullOrWhiteSpace(line)||line.TrimStart().StartsWith("#"))continue;
            int indent=line.Length-line.TrimStart(' ').Length;string value=line.TrimStart(' ');
            if(blockedIndent>=0&&indent>blockedIndent){if(line.IndexOf(Plugin,StringComparison.Ordinal)>=0)throw new Exception("现有 patch 显式移除或替换小鲸鱼；请先在 DSH 插件管理中处理，该设置未更改。");continue;}
            blockedIndent=-1;
            if(Regex.IsMatch(value,@"^-\s*(?:remove|replace)\s*:")){
                if(line.IndexOf(Plugin,StringComparison.Ordinal)>=0)throw new Exception("现有 patch 显式移除或替换小鲸鱼；请先在 DSH 插件管理中处理，该设置未更改。");
                blockedIndent=indent;rowIndent=-1;insertIndent=-1;continue;
            }
            if(Regex.IsMatch(value,@"^-\s*insert\s*:")){insertIndent=indent;childIndent=-1;rowIndent=-1;continue;}
            if(insertIndent>=0&&indent<=insertIndent){insertIndent=-1;childIndent=-1;}
            if(value.StartsWith("- ",StringComparison.Ordinal)){
                if(insertIndent>=0&&childIndent<0)childIndent=indent;
                bool row=indent==0||(insertIndent>=0&&indent==childIndent);
                rowIndent=row?indent:-1;
                if(row&&Regex.IsMatch(value,@"^-\s*(?:name|id)\s*:\s*"+exact))found=true;
            }else if(rowIndent>=0&&indent==rowIndent+2&&Regex.IsMatch(value,@"^(?:name|id)\s*:\s*"+exact))found=true;
        }
        return found;
    }
    internal static void EnsureDshStopped(){
        foreach(string name in new[]{"dsh-eac-shell","dsh-desktop"})foreach(var process in Process.GetProcessesByName(name))using(process)
            if(process.SessionId==Process.GetCurrentProcess().SessionId)throw new Exception("请先完全退出 DeepSeek Harness，再安装或更新小鲸鱼。");
    }
    // Match EAC's numeric core + prerelease comparison for valid versions.
    internal static int CompareVersions(string a,string b){
        var aa=Regex.Match(a??"",@"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$");
        var bb=Regex.Match(b??"",@"^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$");
        if(!aa.Success||!bb.Success)throw new Exception("无法识别宿主内置插件版本，未更改文件。");
        for(int i=1;i<=3;i++){long x=Int64.Parse(aa.Groups[i].Value),y=Int64.Parse(bb.Groups[i].Value);if(x!=y)return x<y?-1:1;}
        string preA=aa.Groups[4].Value,preB=bb.Groups[4].Value;
        if(preA.Length==0||preB.Length==0)return preA.Length==preB.Length?0:preA.Length==0?1:-1;
        string[] pa=preA.Split('.'),pb=preB.Split('.');
        for(int i=0;i<Math.Max(pa.Length,pb.Length);i++){
            if(i>=pa.Length)return -1;if(i>=pb.Length)return 1;
            long x,y;bool an=Int64.TryParse(pa[i],out x),bn=Int64.TryParse(pb[i],out y);
            int c=an&&bn?x.CompareTo(y):an!=bn?(an?-1:1):String.CompareOrdinal(pa[i],pb[i]);if(c!=0)return c;
        }return 0;
    }
    static string DesktopOverlayFor(string profile){
        string standard=Full(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".dsh","profiles","web-desktop"));
        if(!String.Equals(profile,standard,StringComparison.OrdinalIgnoreCase))return null;
        string install=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Deepseek Harness EAC");
        if(!File.Exists(Path.Combine(install,"dsh-eac-shell.exe")))return null;
        string app=Path.Combine(install,"dsh-desktop");NoLinks(app);string hostVersion=VersionOf(app);
        if(hostVersion==null||!Regex.IsMatch(hostVersion,@"^5\."))throw new Exception("此桌面端不是已验证的 EAC 5.x 环境。请在对应宿主的插件管理器中安装，或选择实际 profile；本次未更改文件。");
        string bundledVersion=VersionOf(Path.Combine(app,"assets","plugins",Plugin));
        if(bundledVersion!=null&&CompareVersions(bundledVersion,BuildInfo.PackageVersion)>0)
            throw new Exception("宿主内置小鲸鱼 "+bundledVersion+" 高于安装包内部版本 "+BuildInfo.PackageVersion+"，重启会覆盖本次修改。为避免假成功，本次未安装；请使用兼容的宿主或插件管理方案。");
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"Deepseek Harness EAC","builtin-plugin-updates",Plugin);
    }
    public static string Install(string directory){EnsureDshStopped();string profile=Full(directory);NoLinks(profile);return InstallCore(profile,DesktopOverlayFor(profile));}
    static void CopyTree(string source,string destination){
        NoLinks(source);NoLinks(destination);Directory.CreateDirectory(destination);
        foreach(string file in Directory.GetFiles(source)){string output=Path.Combine(destination,Path.GetFileName(file));NoLinks(file);NoLinks(output);File.Copy(file,output,false);}
        foreach(string dir in Directory.GetDirectories(source))CopyTree(dir,Path.Combine(destination,Path.GetFileName(dir)));
    }
    static void CopyLocalMedia(string source,string destination,ref long bytes){
        NoLinks(source);NoLinks(destination);if(!Directory.Exists(source))return;
        foreach(string file in Directory.GetFiles(source)){
            if(!Media.Contains(Path.GetExtension(file)))continue;
            NoLinks(file);string output=Path.Combine(destination,Path.GetFileName(file));NoLinks(output);if(File.Exists(output))continue;
            long length=new FileInfo(file).Length;bytes+=length;
            if(length>64L*1024*1024||bytes>128L*1024*1024)throw new Exception("现有媒体文件过大，未安装。请通过“仅解压”手动更新。");
            Directory.CreateDirectory(destination);File.Copy(file,output,false);
        }
        foreach(string dir in Directory.GetDirectories(source))CopyLocalMedia(dir,Path.Combine(destination,Path.GetFileName(dir)),ref bytes);
    }
    static bool CreateFallbackWhale(string plugin){
        string assets=Path.Combine(plugin,"assets"),first=Path.Combine(assets,"DSniang1.png"),second=Path.Combine(assets,"DSniang02.png");NoLinks(first);NoLinks(second);
        if(File.Exists(first)||File.Exists(second)){if(!File.Exists(first))File.Copy(second,first,false);return false;}
        Directory.CreateDirectory(assets);
        using(var bitmap=new Bitmap(320,320,PixelFormat.Format32bppArgb))using(var g=Graphics.FromImage(bitmap))
        using(var body=new SolidBrush(Color.FromArgb(63,155,225)))using(var belly=new SolidBrush(Color.FromArgb(198,233,255)))
        using(var fin=new SolidBrush(Color.FromArgb(35,119,193)))using(var ink=new SolidBrush(Color.FromArgb(27,57,88)))
        using(var spray=new Pen(Color.FromArgb(105,194,242),10))using(var smile=new Pen(Color.FromArgb(27,57,88),4)){
            g.Clear(Color.Transparent);g.SmoothingMode=SmoothingMode.AntiAlias;
            g.FillEllipse(body,51,101,221,149);g.FillEllipse(belly,69,169,184,76);
            using(var tail=new GraphicsPath()){
                tail.AddBezier(253,175,272,161,286,136,293,121);tail.AddBezier(293,121,309,152,302,179,279,188);
                tail.AddBezier(279,188,303,186,312,198,310,220);tail.AddBezier(310,220,277,224,257,208,253,175);tail.CloseFigure();g.FillPath(body,tail);
            }
            g.FillEllipse(fin,137,188,54,26);g.FillEllipse(ink,89,154,15,19);g.FillEllipse(Brushes.White,92,156,5,6);g.DrawArc(smile,94,172,37,24,12,132);
            spray.StartCap=LineCap.Round;spray.EndCap=LineCap.Round;g.DrawBezier(spray,155,101,150,70,132,58,119,67);g.DrawBezier(spray,156,101,159,64,178,56,190,67);
            using(var output=new FileStream(first,FileMode.CreateNew,FileAccess.Write,FileShare.None))bitmap.Save(output,ImageFormat.Png);
        }return true;
    }
    // Explicit overlay is exposed only to isolated tests through reflection;
    // production CLI installation derives it from the recognized EAC location.
    internal static string InstallCore(string directory,string overlayDirectory){
        string profile=Full(directory);NoLinks(profile);string package=Path.Combine(profile,"package.json");NoLinks(package);
        if(!File.Exists(package))throw new Exception("这里不是 DSH profile：缺少 package.json。请先安装并运行 DSH，然后选择使用中的配置目录。");
        var config=ReadObject(package);string name=Get(config,"name") as string;
        if(name==null||!name.StartsWith("dsh-profile-",StringComparison.Ordinal)||Map(Get(Map(Get(config,"dsh")),"profile"))==null)throw new Exception("所选文件夹不是可识别的 DSH profile，未安装。");
        string modules=Path.Combine(profile,"node_modules"),target=Path.Combine(modules,Plugin),patch=Path.Combine(profile,"cordis.patch.yml");
        string overlay=overlayDirectory==null?null:Full(overlayDirectory);
        NoLinks(modules);NoLinks(target);NoLinks(patch);if(overlay!=null)NoLinks(overlay);
        if(overlay!=null&&(String.Equals(overlay,target,StringComparison.OrdinalIgnoreCase)||overlay.StartsWith(profile+"\\",StringComparison.OrdinalIgnoreCase)||profile.StartsWith(overlay+"\\",StringComparison.OrdinalIgnoreCase)))throw new Exception("覆盖层与 profile 路径不能重叠。");
        byte[] original=File.Exists(patch)?File.ReadAllBytes(patch):null;string patchText=original==null?"":Utf8.GetString(original).TrimStart('\uFEFF');
        string baseFile=Path.Combine(profile,"cordis.yml");NoLinks(baseFile);
        bool registered=HasBundle(config)||HasDeclaration(patchText)||(File.Exists(baseFile)&&HasDeclaration(File.ReadAllText(baseFile,Utf8)));
        string meaningful=Regex.Replace(patchText,@"(?m)^\s*#.*$","").Trim();
        if(!registered&&meaningful.Length>0&&meaningful!="[]"&&!meaningful.StartsWith("-",StringComparison.Ordinal))throw new Exception("现有 patch 格式不适合自动追加。请用“仅解压”后通过 DSH 插件管理器安装。");
        string tag=DateTime.Now.ToString("yyyyMMdd-HHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,8);
        string stage=Path.Combine(profile,".whale-stage-"+tag),backup=Path.Combine(profile,".whale-backups",tag),newPlugin=Path.Combine(stage,Plugin),newOverlay=Path.Combine(stage,"desktop-overlay");
        string oldPlugin=Path.Combine(backup,"profile-plugin"),oldOverlay=Path.Combine(backup,"desktop-overlay");NoLinks(stage);NoLinks(backup);NoLinks(oldPlugin);NoLinks(oldOverlay);
        bool moved=false,installed=false,overlayMoved=false,overlayInstalled=false,patchChanged=false;
        try{
            Extract(stage);
            foreach(string needed in new[]{"package.json","lib/index.js","lib/accounting.mjs","lib/companion-service.mjs","lib/interjection-policy.mjs","lib/companion-presets.mjs","assets/whale-widget.js","INSTALLER-GUIDE.md"})if(!File.Exists(Path.Combine(newPlugin,needed)))throw new Exception("安装包缺少文件："+needed);
            var embedded=ReadObject(Path.Combine(newPlugin,"package.json"));
            if(!String.Equals(Get(embedded,"name") as string,Plugin,StringComparison.Ordinal)||!String.Equals(Get(embedded,"version") as string,BuildInfo.PackageVersion,StringComparison.Ordinal))throw new Exception("安装包内部名称或版本不匹配。");
            // Start both destinations from the same new code, then preserve
            // each destination's own media before filling missing media from
            // the other directory. Existing JavaScript is never copied.
            if(overlay!=null)CopyTree(newPlugin,newOverlay);
            long bytes=0;CopyLocalMedia(Path.Combine(target,"assets"),Path.Combine(newPlugin,"assets"),ref bytes);
            if(overlay!=null){
                CopyLocalMedia(Path.Combine(overlay,"assets"),Path.Combine(newPlugin,"assets"),ref bytes);
                CopyLocalMedia(Path.Combine(overlay,"assets"),Path.Combine(newOverlay,"assets"),ref bytes);
                CopyLocalMedia(Path.Combine(target,"assets"),Path.Combine(newOverlay,"assets"),ref bytes);
            }
            bool fallback=CreateFallbackWhale(newPlugin);bool overlayFallback=overlay!=null&&CreateFallbackWhale(newOverlay);
            Directory.CreateDirectory(modules);Directory.CreateDirectory(backup);
            if(original!=null){string saved=Path.Combine(backup,"cordis.patch.yml");NoLinks(saved);File.WriteAllBytes(saved,original);}
            NoLinks(target);NoLinks(oldPlugin);if(Directory.Exists(target)){Directory.Move(target,oldPlugin);moved=true;}
            NoLinks(newPlugin);Directory.Move(newPlugin,target);installed=true;
            if(overlay!=null){
                NoLinks(overlay);NoLinks(oldOverlay);Directory.CreateDirectory(Path.GetDirectoryName(overlay));
                if(Directory.Exists(overlay)){Directory.Move(overlay,oldOverlay);overlayMoved=true;}
                NoLinks(newOverlay);Directory.Move(newOverlay,overlay);overlayInstalled=true;
            }
            if(!registered){
                string addition="\r\n# DSH Whale installer v"+BuildInfo.Version+"; upstream MeteorNOX; extension spceyee\r\n- insert:\r\n    - id: dsh-whale-widget\r\n      name: dsh-whale-widget\r\n";
                byte[] nextBytes=Utf8.GetBytes(meaningful=="[]"?Regex.Replace(patchText,@"(?m)^\s*\[\]\s*$",addition):patchText+addition);
                string next=Path.Combine(stage,"patch.next");NoLinks(next);NoLinks(patch);
                using(var output=new FileStream(next,FileMode.CreateNew,FileAccess.Write,FileShare.None))output.Write(nextBytes,0,nextBytes.Length);
                if(original!=null)File.Replace(next,patch,null);else File.Move(next,patch);patchChanged=true;
            }
            string receipt=Path.Combine(backup,"receipt.json");NoLinks(receipt);
            File.WriteAllText(receipt,Json.Serialize(new{version=BuildInfo.Version,packageVersion=BuildInfo.PackageVersion,target=target,overlay=overlay,originalPlugin=moved,originalOverlay=overlayMoved,patchChanged=patchChanged,mediaBytesPreserved=bytes,simpleWhaleCreated=fallback,overlaySimpleWhaleCreated=overlayFallback,installedAt=DateTime.UtcNow.ToString("o")}),Utf8);
            // The stage is empty on success. Cleanup failure is not install failure.
            try{NoLinks(stage);Directory.Delete(stage,false);}catch(IOException){}catch(UnauthorizedAccessException){}
            return backup;
        }catch(Exception error){
            var failures=new List<string>();Action<Action> undo=delegate(Action action){try{action();}catch(Exception e){failures.Add(e.Message);}};
            if(patchChanged)undo(delegate{NoLinks(patch);if(original!=null)File.WriteAllBytes(patch,original);else File.Delete(patch);});
            if(overlayInstalled)undo(delegate{NoLinks(overlay);string failed=Path.Combine(backup,"failed-overlay");NoLinks(failed);Directory.Move(overlay,failed);});
            if(overlayMoved)undo(delegate{NoLinks(oldOverlay);NoLinks(overlay);Directory.Move(oldOverlay,overlay);});
            if(installed)undo(delegate{NoLinks(target);string failed=Path.Combine(backup,"failed-plugin");NoLinks(failed);Directory.Move(target,failed);});
            if(moved)undo(delegate{NoLinks(oldPlugin);NoLinks(target);Directory.Move(oldPlugin,target);});
            if(failures.Count!=0)throw new Exception("安装失败："+error.Message+"\r\n部分回滚未完成，请保留备份："+backup+"\r\n"+String.Join("\r\n",failures.ToArray()),error);
            throw;
        }
    }
    sealed class InstallForm:Form{
        readonly TextBox folder=new TextBox();readonly Label status=new Label();readonly Button install=new Button();readonly bool renderOnly;
        protected override bool ShowWithoutActivation{get{return renderOnly;}}
        public InstallForm():this(false){}
        public InstallForm(bool preview){
            renderOnly=preview;
            Text="DSH 小鲸鱼 v"+BuildInfo.Version+" 安装器";ClientSize=new Size(680,470);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;StartPosition=FormStartPosition.CenterScreen;Font=new Font("Microsoft YaHei UI",9F);AutoScaleMode=AutoScaleMode.Dpi;
            Controls.Add(new Label{Text="DSH 小鲸鱼 v"+BuildInfo.Version,Font=new Font(Font.FontFamily,20F,FontStyle.Bold),Location=new Point(24,22),AutoSize=true});
            Controls.Add(new Label{Text="双击安装 / 更新挂件 · 无需 npm 或额外插件安装工具\n需要已安装并运行过 DeepSeek Harness；安装前请完全退出 DSH。",Location=new Point(26,75),Size=new Size(626,52)});
            Controls.Add(new Label{Text="DSH profile 配置目录（不是程序安装目录）",Location=new Point(26,140),AutoSize=true});folder.SetBounds(26,168,536,29);Controls.Add(folder);
            string home=Environment.GetEnvironmentVariable("DSH_HOME");if(String.IsNullOrWhiteSpace(home)||!Path.IsPathRooted(home))home=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".dsh");
            foreach(string profile in new[]{"web-desktop","desktop","web"}){string p=Path.Combine(home,"profiles",profile);if(File.Exists(Path.Combine(p,"package.json"))){folder.Text=p;break;}}
            var browse=new Button{Text="选择…",Location=new Point(572,166),Size=new Size(80,30)};browse.Click+=delegate{using(var picker=new FolderBrowserDialog()){picker.Description="选择 DSH 使用中的 profile 配置目录";picker.SelectedPath=folder.Text;if(picker.ShowDialog(this)==DialogResult.OK)folder.Text=picker.SelectedPath;}};Controls.Add(browse);
            status.SetBounds(26,216,626,90);status.Text="升级会保留已有角色、动画和音效；没有原角色时使用简易蓝鲸。\n保留原有 API Key 和用户配置，安装前自动备份插件文件。\nEAC 5.x 标准目录会同步启动覆盖层；其他环境请选择实际 profile。";Controls.Add(status);
            Controls.Add(new Label{Text="源码：MeteorNOX 及原项目贡献者 · 合作扩展：spceyee\n安装包不包含原角色、GIF 或音效；已有本地素材仅在本机保留。\nDSH 6.x 隔离环境不自动识别；可仅解压后通过宿主插件管理器安装。",Location=new Point(26,322),Size=new Size(626,64)});
            var extract=new Button{Text="仅解压插件文件",Location=new Point(26,410),Size=new Size(160,34)};
            extract.Click+=delegate{using(var picker=new FolderBrowserDialog()){picker.Description="选择存放位置，将创建新子目录";if(picker.ShowDialog(this)!=DialogResult.OK)return;string dest=Path.Combine(picker.SelectedPath,"DSH-Whale-v"+BuildInfo.Version+"-"+DateTime.Now.ToString("yyyyMMdd-HHmmss"));try{Extract(dest);status.Text="已解压公开插件文件（不含原素材）：\n"+dest;}catch(Exception e){MessageBox.Show(this,e.Message,Text,MessageBoxButtons.OK,MessageBoxIcon.Error);}}};Controls.Add(extract);
            var guide=new Button{Text="安装使用说明",Location=new Point(204,410),Size=new Size(150,34)};
            guide.Click+=delegate{try{using(var view=new Form{Text="安装使用说明",StartPosition=FormStartPosition.CenterParent,Size=new Size(800,680)}){view.Controls.Add(new TextBox{Text=ReadUserGuide(),Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,WordWrap=true,Dock=DockStyle.Fill,Font=new Font("Microsoft YaHei UI",10F)});view.ShowDialog(this);}}catch(Exception e){MessageBox.Show(this,e.Message,Text,MessageBoxButtons.OK,MessageBoxIcon.Error);}};Controls.Add(guide);
            install.Text="安装 / 更新到 DSH";install.SetBounds(476,410,176,34);install.Click+=delegate{
                install.Enabled=false;try{string backup=Install(folder.Text);status.Text="安装完成。重新打开 DSH；若挂件未显示，在插件管理中启用小鲸鱼。\n备份："+backup;MessageBox.Show(this,"安装完成，请重新打开 DeepSeek Harness。\n原有启用 / 禁用状态已保留；新装缺少原角色时使用简易蓝鲸。\n这不是 DSH 主程序安装器。",Text,MessageBoxButtons.OK,MessageBoxIcon.Information);}catch(Exception e){MessageBox.Show(this,"安装未完成："+e.Message,Text,MessageBoxButtons.OK,MessageBoxIcon.Error);}finally{install.Enabled=true;}
            };Controls.Add(install);
        }
    }
}
