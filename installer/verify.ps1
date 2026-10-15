param(
    [Parameter(Mandatory=$true)][string]$Exe,
    [Parameter(Mandatory=$true)][string]$SourceZip,
    [string]$TestRoot
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Run this verifier with Windows PowerShell 5.1 (powershell.exe), because the installer reflection tests use .NET Framework.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$utf8 = New-Object Text.UTF8Encoding($false)
$Exe = (Resolve-Path -LiteralPath $Exe).Path
$SourceZip = (Resolve-Path -LiteralPath $SourceZip).Path
if (-not $TestRoot) {
    $TestRoot = Join-Path $PSScriptRoot ('installer-test-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
}
$TestRoot = [IO.Path]::GetFullPath($TestRoot)
if (Test-Path -LiteralPath $TestRoot) { throw 'TestRoot must be a new directory; existing files are never overwritten.' }
# Refuse tests inside real DSH data or a redirected parent. All tests create their own fixtures.
$realDsh = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.dsh')).TrimEnd('\')
if ($TestRoot -eq $realDsh -or $TestRoot.StartsWith($realDsh + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'TestRoot cannot be inside the real DSH home.' }
for ($ancestor = $TestRoot; $ancestor; $ancestor = [IO.Path]::GetDirectoryName($ancestor)) {
    if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'TestRoot cannot use a redirected parent.' }
}
[IO.Directory]::CreateDirectory($TestRoot) | Out-Null
$checks = New-Object 'System.Collections.Generic.List[string]'
function Assert-True([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Write-Text([string]$Path,[string]$Text) {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
    [IO.File]::WriteAllText($Path,$Text,$utf8)
}
function File-Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Stream-Hash($Stream) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { [BitConverter]::ToString($sha.ComputeHash($Stream)).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Snapshot([string]$Directory) {
    $items = New-Object 'System.Collections.Generic.List[string]'
    if (-not (Test-Path -LiteralPath $Directory)) { return '<absent>' }
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($Directory)
    while ($pending.Count) {
        $current = $pending.Pop()
        foreach ($item in Get-ChildItem -LiteralPath $current -Force) {
            $relative = $item.FullName.Substring($Directory.TrimEnd('\').Length + 1)
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $items.Add('LINK ' + $relative); continue }
            if ($item.PSIsContainer) { $items.Add('DIR ' + $relative); $pending.Push($item.FullName) }
            else { $items.Add('FILE ' + $relative + ' ' + (File-Hash $item.FullName)) }
        }
    }
    return (($items | Sort-Object) -join "`n")
}
function Run-Package([string]$Action,[string]$Target,[bool]$ShouldFail=$false) {
    Assert-True (-not $Target.Contains('"')) 'Invalid test target quote.'
    $proc = Start-Process -FilePath $Exe -ArgumentList @($Action,('"' + $Target + '"')) -WindowStyle Hidden -Wait -PassThru
    try {
        if ($ShouldFail) { Assert-True ($proc.ExitCode -ne 0) ('Expected rejection: ' + $Action) }
        else { Assert-True ($proc.ExitCode -eq 0) ('Installer exit code ' + $proc.ExitCode + ' for ' + $Action) }
    } finally { $proc.Dispose() }
}
function New-Profile([string]$Name) {
    $profile = Join-Path $TestRoot ($Name + '\.dsh\profiles\web-desktop')
    Write-Text (Join-Path $profile 'package.json') '{"name":"dsh-profile-web-desktop","private":true,"dependencies":{"fixture-other-plugin":"1.0.0"},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","fixture-other-plugin"]}}}'
    Write-Text (Join-Path $profile 'cordis.patch.yml') "# fixture: retain unrelated plugin`r`n- insert:`r`n    - id: fixture-other-plugin`r`n      name: fixture-other-plugin`r`n      config:`r`n        greeting: fixture-user-value`r`n"
    Write-Text (Join-Path $profile 'personal-setting.json') '{"fixtureUserValue":"keep-personal-settings"}'
    $dshHome = [IO.Directory]::GetParent([IO.Directory]::GetParent($profile).FullName).FullName
    Write-Text (Join-Path $dshHome '.dshw-companion.json') '{"fixtureOnly":true,"persona":"keep-my-persona","key":"fixture-not-a-real-secret"}'
    Write-Text (Join-Path $dshHome '.dshw-usage.json') '{"fixtureOnly":true,"lastBalance":123.45}'
    return $profile
}
function Verify-Source([string]$PluginRoot) {
    foreach ($relative in $sourceHashes.Keys) {
        $path = Join-Path $PluginRoot $relative
        Assert-True ([IO.File]::Exists($path)) ('Source file missing: ' + $relative)
        Assert-True ((File-Hash $path) -eq $sourceHashes[$relative]) ('Source file differs: ' + $relative)
    }
    $package = [IO.File]::ReadAllText((Join-Path $PluginRoot 'package.json')) | ConvertFrom-Json
    Assert-True ($package.version -eq '0.3.16-companion.14') 'Internal plugin version mismatch.'
}
function New-OldPlugin([string]$PluginRoot,[string]$Marker) {
    Write-Text (Join-Path $PluginRoot 'package.json') '{"name":"dsh-whale-widget","version":"0.3.16-companion.12"}'
    Write-Text (Join-Path $PluginRoot 'assets\whale-widget.js') ('// obsolete executable code: ' + $Marker)
    Write-Text (Join-Path $PluginRoot 'lib\index.js') ('// obsolete backend: ' + $Marker)
    Write-Text (Join-Path $PluginRoot 'assets\custom-role.png') ('fixture-image-preserve-' + $Marker)
    Write-Text (Join-Path $PluginRoot 'assets\nested\custom-sound.wav') ('fixture-sound-preserve-' + $Marker)
    # A valid one-pixel PNG ensures image decoding cannot discard a preserved role.
    [IO.File]::WriteAllBytes((Join-Path $PluginRoot 'assets\DSniang1.png'),[Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMmkAAAAASUVORK5CYII='))
}

# Validate the executable itself before ever running it.
$binary = [IO.File]::ReadAllBytes($Exe)
Assert-True ($binary.Length -gt 128 -and $binary[0] -eq 77 -and $binary[1] -eq 90) 'Missing MZ signature.'
$peOffset = [BitConverter]::ToInt32($binary,0x3c)
Assert-True ($peOffset -gt 0 -and $peOffset + 6 -lt $binary.Length) 'Invalid PE header offset.'
Assert-True ([BitConverter]::ToUInt32($binary,$peOffset) -eq 0x4550) 'Missing PE signature.'
Assert-True ([BitConverter]::ToUInt16($binary,$peOffset+4) -eq 0x8664) 'Installer is not Windows x64.'
$versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($Exe)
Assert-True ($versionInfo.FileVersion -match '^1\.0\.3(?:\.0)?$') 'Executable file version is not 1.0.3.'
$checks.Add('pe-x64-and-file-version')

# Every released source file must be byte-for-byte identical in the embedded payload.
$sourceHashes = @{}
$zip = [IO.Compression.ZipFile]::OpenRead($SourceZip)
try {
    foreach ($entry in $zip.Entries) {
        if ($entry.FullName.EndsWith('/')) { continue }
        $sourcePrefix = 'dsh-whale-widget-mod/'
        Assert-True ($entry.FullName.StartsWith($sourcePrefix,[StringComparison]::Ordinal)) 'Unexpected source archive layout.'
        $relative = $entry.FullName.Substring($sourcePrefix.Length).Replace('/','\')
        Assert-True (-not $sourceHashes.ContainsKey($relative)) 'Duplicate source path.'
        $input = $entry.Open()
        try { $sourceHashes[$relative] = Stream-Hash $input } finally { $input.Dispose() }
    }
} finally { $zip.Dispose() }
$unpacked = Join-Path $TestRoot 'extracted'
Run-Package '--extract-only' $unpacked
$plugin = Join-Path $unpacked 'dsh-whale-widget'
Verify-Source $plugin
$payloadFiles = @(Get-ChildItem -LiteralPath $unpacked -File -Recurse -Force)
Assert-True ($payloadFiles.Count -eq $sourceHashes.Count + 1) 'Payload includes unexpected files.'
Assert-True ([IO.File]::Exists((Join-Path $plugin 'INSTALLER-GUIDE.md'))) 'Missing installer guide.'
foreach ($file in $payloadFiles) {
    if ($file.Name -match '(?i)^(auth\.json|config\.toml|\.env(\..*)?|credentials?\.(yaml|yml|json)|\.credentials.*|companion-secret\.json|companion-settings\.json|\.dshw-.*|.*\.log|.*\.sqlite|.*\.db)$') { throw ('Private runtime/config file in payload: ' + $file.Name) }
    if ($file.Extension -match '^\.(m?js|cjs|json|toml|ya?ml|md|txt|ps1|cs|html)$') {
        $contents = [IO.File]::ReadAllText($file.FullName)
        foreach ($candidate in [regex]::Matches($contents,'\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b')) {
            $isTestFixture = $file.FullName.StartsWith((Join-Path $plugin 'tests') + '\',[StringComparison]::OrdinalIgnoreCase) -and $candidate.Value -match '^sk-fixture-only-not-a-real-key-(first|second)$'
            Assert-True $isTestFixture ('Possible credential in payload: ' + $file.Name)
        }
    }
}
$beforeExtract = Snapshot $unpacked
Run-Package '--extract-only' $unpacked $true
Assert-True ((Snapshot $unpacked) -ceq $beforeExtract) 'Rejected extraction modified existing files.'
$guide = Join-Path $TestRoot 'exported-guide.md'
Run-Package '--export-guide' $guide
Assert-True ((File-Hash $guide) -eq (File-Hash (Join-Path $plugin 'INSTALLER-GUIDE.md'))) 'Exported guide differs from embedded guide.'
Assert-True ([IO.File]::ReadAllText($guide) -match 'v?1\.0\.3') 'Guide does not identify v1.0.3.'
$checks.Add('released-source-hashes-and-exact-payload-file-list')
$checks.Add('no-runtime-secrets-or-private-config-in-payload')
$checks.Add('extract-refuses-overwrite-and-embedded-guide-matches')

$fresh = New-Profile 'fresh'
$homeDirectory = [IO.Directory]::GetParent([IO.Directory]::GetParent($fresh).FullName).FullName
$markers = @((Join-Path $fresh 'package.json'),(Join-Path $fresh 'personal-setting.json'),(Join-Path $homeDirectory '.dshw-companion.json'),(Join-Path $homeDirectory '.dshw-usage.json'))
$markerHashes = @{}; foreach ($marker in $markers) { $markerHashes[$marker] = File-Hash $marker }
$oldPatch = [IO.File]::ReadAllText((Join-Path $fresh 'cordis.patch.yml'))
Run-Package '--install' $fresh
$freshPlugin = Join-Path $fresh 'node_modules\dsh-whale-widget'
Verify-Source $freshPlugin
$newPatch = [IO.File]::ReadAllText((Join-Path $fresh 'cordis.patch.yml'))
Assert-True ($newPatch.Contains($oldPatch)) 'Unrelated patch content changed.'
Assert-True ([regex]::Matches($newPatch,'(?m)^\s*name:\s*dsh-whale-widget\s*$').Count -eq 1) 'Whale patch declaration missing or duplicated.'
$freshImage = Join-Path $freshPlugin 'assets\DSniang1.png'
Assert-True ([IO.File]::Exists($freshImage)) 'Fresh install has no fallback character image.'
$png = [IO.File]::ReadAllBytes($freshImage)
Assert-True ($png.Length -gt 32 -and [BitConverter]::ToString($png,0,8) -eq '89-50-4E-47-0D-0A-1A-0A') 'Fallback character is not a PNG.'
$fallbackHash = File-Hash $freshImage
$firstPatchHash = File-Hash (Join-Path $fresh 'cordis.patch.yml')
Run-Package '--install' $fresh
Verify-Source $freshPlugin
Assert-True ((File-Hash (Join-Path $fresh 'cordis.patch.yml')) -eq $firstPatchHash) 'Repeated installation changed/duplicated registration.'
Assert-True ((File-Hash $freshImage) -eq $fallbackHash) 'Repeated installation changed existing fallback media.'
foreach ($marker in $markers) { Assert-True ((File-Hash $marker) -eq $markerHashes[$marker]) 'User settings, ledger or profile configuration changed.' }
$checks.Add('fresh-install-with-fallback-png')
$checks.Add('repeat-install-is-idempotent-and-preserves-user-data')

$upgrade = New-Profile 'upgrade'
$oldPlugin = Join-Path $upgrade 'node_modules\dsh-whale-widget'
New-OldPlugin $oldPlugin 'old-target'
$mediaNames = @('assets\DSniang1.png','assets\custom-role.png','assets\nested\custom-sound.wav')
$mediaHashes = @{}; foreach ($name in $mediaNames) { $mediaHashes[$name] = File-Hash (Join-Path $oldPlugin $name) }
Run-Package '--install' $upgrade
Verify-Source $oldPlugin
foreach ($name in $mediaNames) { Assert-True ((File-Hash (Join-Path $oldPlugin $name)) -eq $mediaHashes[$name]) ('Old media not preserved: ' + $name) }
$checks.Add('upgrade-preserves-custom-media-with-new-code')

# All malformed profiles must fail before creating backups, stage dirs or node_modules.
foreach ($case in @('missing-package','broken-json','wrong-profile','wrong-patch')) {
    $bad = Join-Path $TestRoot ('invalid-' + $case)
    [IO.Directory]::CreateDirectory($bad) | Out-Null
    Write-Text (Join-Path $bad 'marker.txt') 'untouched-fixture'
    if ($case -eq 'broken-json') { Write-Text (Join-Path $bad 'package.json') '{this-is-invalid' }
    if ($case -eq 'wrong-profile') { Write-Text (Join-Path $bad 'package.json') '{"name":"unrelated-project","private":true}' }
    if ($case -eq 'wrong-patch') {
        Write-Text (Join-Path $bad 'package.json') '{"name":"dsh-profile-web","dsh":{"profile":{"bundles":[]}}}'
        Write-Text (Join-Path $bad 'cordis.patch.yml') "invalid: mapping-not-a-patch-list`r`n"
    }
    $before = Snapshot $bad
    Run-Package '--install' $bad $true
    Assert-True ((Snapshot $bad) -ceq $before) ('Rejected profile was modified: ' + $case)
}
$checks.Add('malformed-profile-and-patch-rejected-with-no-writes')

$linked = New-Profile 'junction'
$external = Join-Path $TestRoot 'junction-external-marker'
New-OldPlugin $external 'junction-external'
[IO.Directory]::CreateDirectory((Join-Path $linked 'node_modules')) | Out-Null
New-Item -ItemType Junction -Path (Join-Path $linked 'node_modules\dsh-whale-widget') -Target $external | Out-Null
$beforeLink = Snapshot $linked
$beforeExternal = Snapshot $external
Run-Package '--install' $linked $true
Assert-True ((Snapshot $linked) -ceq $beforeLink -and (Snapshot $external) -ceq $beforeExternal) 'Junction rejection altered linked data.'
$checks.Add('junction-target-rejected-with-no-external-writes')

# Exercise production's overlay transaction on fixture paths through its internal method.
# This avoids a dangerous public CLI parameter that could redirect real AppData updates.
$assembly = [Reflection.Assembly]::LoadFile($Exe)
$installer = $assembly.GetType('Installer',$true)
$binding = [Reflection.BindingFlags]::Static -bor [Reflection.BindingFlags]::NonPublic -bor [Reflection.BindingFlags]::Public
$core = $installer.GetMethod('InstallCore',$binding,$null,[Type[]]@([string],[string]),$null)
Assert-True ($null -ne $core) 'Missing testable two-directory installer transaction.'
$dual = New-Profile 'dual-directory'
$dualPlugin = Join-Path $dual 'node_modules\dsh-whale-widget'
$overlay = Join-Path $TestRoot 'fixture-appdata\builtin-plugin-updates\dsh-whale-widget'
New-OldPlugin $dualPlugin 'target-before'
New-OldPlugin $overlay 'overlay-before'
$targetMedia = @{}; $overlayMedia = @{}
foreach ($name in $mediaNames) { $targetMedia[$name] = File-Hash (Join-Path $dualPlugin $name); $overlayMedia[$name] = File-Hash (Join-Path $overlay $name) }
$dualArguments = New-Object 'System.Object[]' 2
$dualArguments[0] = [string]$dual
$dualArguments[1] = [string]$overlay
$null = $core.Invoke($null,$dualArguments)
Verify-Source $dualPlugin
Verify-Source $overlay
foreach ($name in $mediaNames) {
    Assert-True ((File-Hash (Join-Path $dualPlugin $name)) -eq $targetMedia[$name]) ('Target media changed during overlay update: ' + $name)
    Assert-True ((File-Hash (Join-Path $overlay $name)) -eq $overlayMedia[$name]) ('Overlay media changed during overlay update: ' + $name)
}
$checks.Add('target-and-startup-overlay-updated-with-own-media-preserved')

$rollback = New-Profile 'rollback'
$rollbackPlugin = Join-Path $rollback 'node_modules\dsh-whale-widget'
$lockedOverlay = Join-Path $TestRoot 'fixture-locked-overlay\dsh-whale-widget'
New-OldPlugin $rollbackPlugin 'rollback-target'
New-OldPlugin $lockedOverlay 'rollback-overlay'
$beforeTarget = Snapshot $rollbackPlugin
$beforeOverlay = Snapshot $lockedOverlay
$beforePatch = File-Hash (Join-Path $rollback 'cordis.patch.yml')
$lock = [IO.File]::Open((Join-Path $lockedOverlay 'package.json'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
$rejected = $false
$rollbackArguments = New-Object 'System.Object[]' 2
$rollbackArguments[0] = [string]$rollback
$rollbackArguments[1] = [string]$lockedOverlay
try { try { $null = $core.Invoke($null,$rollbackArguments) } catch { $rejected = $true } } finally { $lock.Dispose() }
Assert-True $rejected 'Locked overlay unexpectedly succeeded; rollback fixture did not induce failure.'
Assert-True ((Snapshot $rollbackPlugin) -ceq $beforeTarget) 'Failed overlay update did not restore original target.'
Assert-True ((Snapshot $lockedOverlay) -ceq $beforeOverlay) 'Failed overlay update changed original overlay.'
Assert-True ((File-Hash (Join-Path $rollback 'cordis.patch.yml')) -eq $beforePatch) 'Failed overlay update changed profile registration.'
$checks.Add('locked-overlay-failure-preserves-target-overlay-and-registration')

$result = [ordered]@{ passed=$true; version='1.0.3'; internalVersion='0.3.16-companion.14'; executable=$Exe; executableSha256=(File-Hash $Exe); sourceZipSha256=(File-Hash $SourceZip); sourceFiles=$sourceHashes.Count; embeddedFiles=$payloadFiles.Count; checks=@($checks); testRoot=$TestRoot; checkedAt=(Get-Date).ToUniversalTime().ToString('o') }
$json = $result | ConvertTo-Json -Depth 5
Write-Text (Join-Path $TestRoot 'verification.json') $json
$json
