$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$runtimeDir = Join-Path $PSScriptRoot '.runtime'
$appDir = Join-Path $PSScriptRoot 'app'
$nodeVersion = '24.19.0'

function Invoke-Pnpm {
    param([string[]] $Arguments)
    & $script:npxPath --yes --cache (Join-Path $runtimeDir 'npm-cache') --package=pnpm@11.19.0 pnpm @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm $($Arguments -join ' ') failed (exit $LASTEXITCODE)."
    }
}

try {
    if (-not (Test-Path (Join-Path $appDir 'package.json'))) {
        throw 'Extract the complete ZIP before running Start-ContextCanvas.cmd.'
    }
    $nodeDir = $null
    $installedNode = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($installedNode) {
        $installedVersion = & $installedNode.Source --version
        $candidateDir = Split-Path -Parent $installedNode.Source
        if ($LASTEXITCODE -eq 0 -and $installedVersion -match '^v24\.' -and (Test-Path (Join-Path $candidateDir 'npx.cmd'))) {
            $nodeDir = $candidateDir
        }
    }
    if (-not $nodeDir) {
        $architecture = $env:PROCESSOR_ARCHITEW6432
        if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
        switch ($architecture.ToUpperInvariant()) {
            'AMD64' {
                $nodeArch = 'x64'
                $expectedHash = '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73'
            }
            'ARM64' {
                $nodeArch = 'arm64'
                $expectedHash = '8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f'
            }
            default { throw 'Windows x64 or ARM64 is required.' }
        }
        $archiveName = "node-v$nodeVersion-win-$nodeArch.zip"
        $archivePath = Join-Path $runtimeDir $archiveName
        $nodeDir = Join-Path $runtimeDir "node-v$nodeVersion-win-$nodeArch"
        New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
        if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
            if (-not (Test-Path $archivePath)) {
                Write-Host "Downloading portable Node.js $nodeVersion (no administrator rights needed)..."
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                $partialPath = "$archivePath.partial"
                Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/$archiveName" -OutFile $partialPath
                if ((Get-FileHash -Algorithm SHA256 -Path $partialPath).Hash.ToLowerInvariant() -ne $expectedHash) {
                    throw 'Node.js download checksum mismatch. Download was not executed.'
                }
                Move-Item -LiteralPath $partialPath -Destination $archivePath -Force
            }
            if ((Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash.ToLowerInvariant() -ne $expectedHash) {
                throw 'Cached Node.js archive checksum mismatch. Remove the archive and retry.'
            }
            Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimeDir -Force
        }
    }
    $nodePath = Join-Path $nodeDir 'node.exe'
    $script:npxPath = Join-Path $nodeDir 'npx.cmd'
    $env:PATH = "$nodeDir;$env:PATH"
    $pendingPath = Join-Path $runtimeDir 'pending-install.json'
    $installPath = Join-Path $runtimeDir 'install.json'
    if (Test-Path $pendingPath) {
        $saved = (Get-Content -LiteralPath $pendingPath -Raw -Encoding UTF8 | ConvertFrom-Json).previous
    } elseif (Test-Path $installPath) {
        $saved = Get-Content -LiteralPath $installPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    if ($saved) {
        $relativeApp = [string] $saved.active_directory
        if ($relativeApp -ne 'app' -and $relativeApp -notmatch '^versions/[0-9A-Za-z.-]+$') { throw 'Invalid installed application directory.' }
        $appDir = Join-Path $PSScriptRoot $relativeApp
    }
    Set-Location -LiteralPath $appDir
    Write-Host 'Installing dependencies...'
    Invoke-Pnpm -Arguments @('install', '--frozen-lockfile', '--store-dir', (Join-Path $runtimeDir 'pnpm-store'))
    Write-Host 'Starting Context Canvas. Keep this window open. Press Ctrl+C to stop.'
    & $nodePath (Join-Path $PSScriptRoot 'launch.mjs')
    if ($LASTEXITCODE -ne 0) { throw "Context Canvas stopped with exit code $LASTEXITCODE." }
    exit 0
} catch {
    Write-Host ''
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'Check your Internet connection and the error above, then retry.'
    exit 1
}
