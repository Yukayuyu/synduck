param([string] $OriginalFolder)
$ErrorActionPreference = 'Stop'

try {
    Write-Host 'Stop the old Context Canvas window with Ctrl+C before updating.'
    if (-not $OriginalFolder) {
        $OriginalFolder = Read-Host 'Enter the OLD ContextCanvas-Windows folder (the folder containing app and Start-ContextCanvas.cmd)'
    }
    $targetRoot = (Resolve-Path -LiteralPath $OriginalFolder.Trim('"')).Path
    if ($targetRoot -eq $PSScriptRoot) { throw 'Choose the OLD installation, not this extracted update folder.' }
    if (Test-Path (Join-Path $targetRoot '.runtime\install.json')) { throw 'This installation already has automatic updates. Import the new ZIP in the application update dialog.' }
    $packagePath = Join-Path $targetRoot 'app\package.json'
    if (-not (Test-Path -LiteralPath $packagePath)) { throw 'The selected folder does not contain app\package.json.' }
    $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($package.name -ne 'ai-context-canvas') { throw 'The selected folder is not a Context Canvas installation.' }
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $entries = @()
    foreach ($entry in @($manifest.files) + @($manifest.bootstrap_files)) {
        $relative = [string] $entry.path
        if ($relative -match '(^|/)\.\.?(/|$)' -or $relative -match '(^|/)(data|node_modules|\.git|\.runtime)(/|$)' -or $relative -match '(^|/)\.env$' -or [IO.Path]::IsPathRooted($relative)) {
            throw 'Update manifest contains an invalid destination.'
        }
        $source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $relative))
        $destination = [IO.Path]::GetFullPath((Join-Path $targetRoot $relative))
        if (-not $source.StartsWith($PSScriptRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $destination.StartsWith($targetRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Update manifest escapes the installation folder.'
        }
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing update file: $relative" }
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Update checksum mismatch: $relative" }
        if (Test-Path -LiteralPath $destination -PathType Container) { throw "A folder conflicts with update file: $relative" }
        $entries += [pscustomobject] @{ Relative = $relative; Source = $source; Destination = $destination }
    }
    $backupDir = Join-Path $targetRoot ('.source-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
    foreach ($entry in $entries) {
        if (Test-Path -LiteralPath $entry.Destination -PathType Leaf) {
            $backupFile = Join-Path $backupDir $entry.Relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force | Out-Null
            Copy-Item -LiteralPath $entry.Destination -Destination $backupFile
        }
    }
    foreach ($entry in $entries) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $entry.Destination) -Force | Out-Null
        Copy-Item -LiteralPath $entry.Source -Destination $entry.Destination -Force
    }
    Write-Host "Updated to $($manifest.version). Your .env, data, login and runtime were preserved."
    Write-Host "Previous source files are backed up in: $backupDir"
    Write-Host 'Starting the ORIGINAL installation with its existing workspace...'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $targetRoot 'Start-ContextCanvas.ps1')
    exit $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
