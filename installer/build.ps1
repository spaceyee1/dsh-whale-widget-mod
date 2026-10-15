param(
    [string]$SourceZip = (Join-Path $PSScriptRoot '..\..\..\outputs\dsh-whale-widget-mod-v1.0.3-source.zip'),
    [string]$OutDirectory = (Join-Path $PSScriptRoot '..\..\..\outputs'),
    [string]$BuildDirectory = (Join-Path $PSScriptRoot 'build')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem
$expectedSourceHash = '00c83b62f76f7a7c5381bcb412e7f57b07def7457abfed0fa8403a34078f77f6'
$source = (Resolve-Path -LiteralPath $SourceZip).Path
if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedSourceHash) { throw 'The source ZIP is not the verified v1.0.3 release' }
$build = [IO.Path]::GetFullPath($BuildDirectory)
$out = [IO.Path]::GetFullPath($OutDirectory)
if(Test-Path -LiteralPath $build) { throw 'Build directory already exists; use a new empty build directory' }
New-Item -ItemType Directory -Path $build,$out -Force | Out-Null
$payload = Join-Path $build 'payload'
$plugin = Join-Path $payload 'dsh-whale-widget'
New-Item -ItemType Directory -Path $plugin -Force | Out-Null
$archive = [IO.Compression.ZipFile]::OpenRead($source)
try {
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach($entry in $archive.Entries) {
        $prefix = 'dsh-whale-widget-mod/'
        if(!$entry.FullName.StartsWith($prefix,[StringComparison]::Ordinal)) { throw 'Unexpected source ZIP prefix' }
        $relative = $entry.FullName.Substring($prefix.Length)
        if(!$relative -or $relative.Contains('\') -or $relative.Contains(':') -or $relative.Split('/') -contains '..' -or !$seen.Add($relative)) { throw 'Unsafe or duplicate ZIP entry' }
        $destination = [IO.Path]::GetFullPath((Join-Path $plugin $relative))
        if(!$destination.StartsWith($plugin+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP path escapes package' }
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$false)
    }
} finally { $archive.Dispose() }
$manifest = Get-Content -LiteralPath (Join-Path $plugin 'SOURCE-SNAPSHOT.json') -Raw -Encoding utf8 | ConvertFrom-Json
if($manifest.release -ne 'v1.0.3' -or $manifest.sourceVersion -ne '0.3.16-companion.14') { throw 'Source version mismatch' }
foreach($file in $manifest.files) {
    $actual = Get-FileHash -LiteralPath (Join-Path $plugin $file.publishedPath) -Algorithm SHA256
    if($actual.Hash.ToLowerInvariant() -ne $file.sha256) { throw ('Source manifest mismatch: '+$file.publishedPath) }
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'INSTALLER-GUIDE.md') -Destination $plugin
$zip = Join-Path $build 'payload.zip'
$bundle = [IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach($file in Get-ChildItem -LiteralPath $payload -File -Recurse | Sort-Object FullName) {
        $entryName = $file.FullName.Substring($payload.Length + 1).Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($bundle,$file.FullName,$entryName,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $bundle.Dispose() }
$payloadHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$info = 'using System.Reflection; [assembly: AssemblyTitle("DSH Whale Widget Installer")] [assembly: AssemblyProduct("DSH Whale Widget v1.0.3")] [assembly: AssemblyVersion("1.0.3.0")] [assembly: AssemblyFileVersion("1.0.3.0")] internal static class BuildInfo { public const string Version="1.0.3"; public const string PackageVersion="0.3.16-companion.14"; public const string PayloadHash="'+$payloadHash+'"; }'
[IO.File]::WriteAllText((Join-Path $build 'BuildInfo.cs'),$info,[Text.UTF8Encoding]::new($false))
$exe = Join-Path $out 'DSHWhale-v1.0.3-Setup-x64.exe'
if(Test-Path -LiteralPath $exe) { throw 'Installer output already exists; use a fresh output directory' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll ('/win32manifest:'+(Join-Path $PSScriptRoot 'app.manifest')) ('/resource:'+$zip+',Whale.Payload.zip') ('/out:'+$exe) (Join-Path $build 'BuildInfo.cs') (Join-Path $PSScriptRoot 'Installer.cs')
if($LASTEXITCODE -ne 0) { throw 'C# compilation failed' }
$hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($exe+'.sha256'),$hash+'  '+[IO.Path]::GetFileName($exe)+[Environment]::NewLine,[Text.Encoding]::ASCII)
$report = [ordered]@{version='v1.0.3';packageVersion='0.3.16-companion.14';file=[IO.Path]::GetFileName($exe);bytes=(Get-Item -LiteralPath $exe).Length;sha256=$hash;payloadSha256=$payloadHash;sourceZipSha256=$expectedSourceHash;architecture='Windows x64';requiresDsh=$true;containsUserConfiguration=$false;containsUpstreamMedia=$false}
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'DSHWhale-v1.0.3-build.json') -Encoding utf8
$report | ConvertTo-Json
