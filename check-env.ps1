<#
  Peryx development environment self-check
  Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File .\check-env.ps1
  Read-only: installs nothing, changes nothing.
#>
$ErrorActionPreference = 'Continue'
$ok = 0
$bad = 0

function Report($state, $name, $detail) {
    switch ($state) {
        'ok'   { Write-Host ("[ OK ] {0,-22} {1}" -f $name, $detail) -ForegroundColor Green; $script:ok++ }
        'warn' { Write-Host ("[WARN] {0,-22} {1}" -f $name, $detail) -ForegroundColor Yellow }
        'miss' { Write-Host ("[MISS] {0,-22} {1}" -f $name, $detail) -ForegroundColor Red; $script:bad++ }
        'info' { Write-Host ("[INFO] {0,-22} {1}" -f $name, $detail) -ForegroundColor DarkGray }
    }
}

function FirstLine($cmd) {
    try {
        $out = & $cmd 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -and $out.Trim()) { return ($out.Trim() -split "`n")[0].Trim() }
    } catch { }
    return $null
}

Write-Host "=== 1. 基础工具 ===" -ForegroundColor Cyan
foreach ($item in @(
    @{ name = 'Node.js'; file = 'node.exe';  cmd = { node -v } },
    @{ name = 'npm';     file = 'npm.cmd';   cmd = { cmd /c npm.cmd -v } },
    @{ name = 'pnpm';    file = 'pnpm.cmd';  cmd = { cmd /c pnpm.cmd -v } }
)) {
    if (Get-Command $item.file -ErrorAction SilentlyContinue) {
        $v = FirstLine $item.cmd
        if ($v) { Report 'ok' $item.name $v } else { Report 'miss' $item.name '无法执行' }
    } else {
        Report 'miss' $item.name '未安装'
    }
}

Write-Host "`n=== 2. Rust 工具链 ===" -ForegroundColor Cyan
if (Get-Command rustc -ErrorAction SilentlyContinue) {
    foreach ($item in @(
        @{ name = 'rustc';  cmd = { rustc --version } },
        @{ name = 'cargo';  cmd = { cargo --version } },
        @{ name = 'rustup'; cmd = { rustup --version } }
    )) {
        $v = FirstLine $item.cmd
        if ($v) { Report 'ok' $item.name $v }
        else { Report 'miss' $item.name '存在但无法运行（工具链不完整，执行: rustup toolchain uninstall stable; rustup toolchain install stable）' }
    }
    $tc = FirstLine { rustup show active-toolchain }
    if ($tc) { Report 'ok' 'default toolchain' $tc }
    else { Report 'miss' 'default toolchain' '执行: rustup default stable' }
} else {
    Report 'miss' 'Rust' '未安装，下载 https://win.rustup.rs/x86_64'
}

Write-Host "`n=== 3. MSVC C++ 构建工具 ===" -ForegroundColor Cyan
$vswhereCandidates = @(
    'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe',
    'C:\Program Files\Microsoft Visual Studio\Installer\vswhere.exe'
)
$vswhere = $vswhereCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($vswhere) {
    $vcPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($vcPath) {
        $vcPath = ($vcPath | Out-String).Trim()
        $vcvars = Join-Path $vcPath 'VC\Auxiliary\Build\vcvars64.bat'
        if (Test-Path $vcvars) { Report 'ok' 'MSVC C++ toolchain' $vcPath }
        else { Report 'warn' 'MSVC C++ toolchain' "组件不完整（缺 vcvars64.bat）: $vcPath" }
    } else {
        Report 'miss' 'MSVC C++ toolchain' '没有实例包含「使用 C++ 的桌面开发」工作负载'
    }
} else {
    Report 'miss' 'MSVC C++ toolchain' '未找到 VS Installer，安装 https://visualstudio.microsoft.com/visual-cpp-build-tools/'
}

Write-Host "`n=== 4. WebView2 Runtime ===" -ForegroundColor Cyan
$wv2Keys = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
$wv2 = @($wv2Keys | Where-Object { Test-Path $_ })
if ($wv2.Count -gt 0) {
    Report 'ok' 'WebView2 Runtime' (Get-ItemProperty -Path $wv2[0]).pv
} else {
    Report 'miss' 'WebView2 Runtime' '未检测到，Win10 1803+ 通常自带'
}

Write-Host "`n=== 5. PowerShell 执行策略 ===" -ForegroundColor Cyan
$ep = (Get-ExecutionPolicy -List | Where-Object Scope -eq 'CurrentUser').ExecutionPolicy
if ($ep -in @('RemoteSigned', 'Unrestricted', 'Bypass')) {
    Report 'ok' 'CurrentUser policy' $ep
} else {
    Report 'warn' 'CurrentUser policy' "为 $ep，建议执行: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned"
}

Write-Host "`n=== 6. 网络（依赖下载）===" -ForegroundColor Cyan
foreach ($t in @(
    @{ name = 'crates.io';    url = 'https://static.crates.io/crates/serde/serde-1.0.0.crate' },
    @{ name = 'npm registry'; url = 'https://registry.npmjs.org/@tauri-apps/cli' }
)) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Invoke-WebRequest -Uri $t.url -Method Head -TimeoutSec 20 -UseBasicParsing | Out-Null
        Report 'ok' $t.name "$($sw.ElapsedMilliseconds)ms"
    } catch {
        Report 'miss' $t.name '不可达，首次构建会卡住'
    }
}

Write-Host "`n=== 7. 项目状态 ===" -ForegroundColor Cyan
$projRoot = Split-Path -Parent $PSCommandPath
if (Test-Path (Join-Path $projRoot 'node_modules')) { Report 'ok' 'node_modules' '已安装' }
else { Report 'warn' 'node_modules' '未安装，执行: npm install' }

$exe = Join-Path $projRoot 'src-tauri\target\debug\peryx.exe'
if (Test-Path $exe) {
    Report 'ok' 'built binary' ("{0:N1} MB" -f ((Get-Item $exe).Length / 1MB))
} else {
    Report 'info' 'built binary' '尚未构建，执行: npx tauri build --debug --no-bundle'
}

Write-Host "`n=========================================" -ForegroundColor Cyan
$color = 'Yellow'
if ($bad -eq 0) { $color = 'Green' }
Write-Host ("检测结果：{0} 项通过，{1} 项待处理" -f $ok, $bad) -ForegroundColor $color
if ($bad -eq 0) {
    Write-Host "环境已就绪。启动开发：npx tauri dev" -ForegroundColor Green
} else {
    Write-Host "请先处理上面标红的项目。" -ForegroundColor Yellow
}
