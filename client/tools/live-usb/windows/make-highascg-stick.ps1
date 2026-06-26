#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Write a HighAsCG (or any) live .iso to a USB you choose, then add an exFAT
  data partition labelled HIGHASCGEXF (WO-47) and seed operator folders.

.DESCRIPTION
  - Lists removable / USB-class physical disks only (you pick by number).
  - Double confirmation before overwriting the whole disk.
  - Raw block copy of the ISO (similar to dd), then diskpart: new primary in
    unallocated space, format exFAT quick label=HIGHASCGEXF.
  - Creates layout for GitHub release drops, media, templates, configs, rear-panel snapshots.

  NOTE: The stick must be larger than the ISO image; there must be unallocated
  space at the end after the hybrid ISO layout. If Windows reports no free
  space, use a bigger stick or run tools/eggs/live-usb/add-exfat-data-partition.sh
  from Linux.

.PARAMETER IsoPath
  Full path to the .iso file.

.PARAMETER SkipExfat
  Only write the ISO; do not create the exFAT partition or folders.

.PARAMETER DryRun
  Show chosen disk and actions only; do not write.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\make-highascg-stick.ps1 -IsoPath C:\path\highascg_amd64.iso `
    -TarGzPath C:\path\highascg_2026-01-01T120000Z.tar.gz
#>
param(
    [Parameter(Mandatory = $true)]
    [string] $IsoPath,

    [string] $TarGzPath = '',
    [string] $AppSourceDirectory = '',

    [switch] $SkipExfat,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$ExfatLabel = 'HIGHASCGEXF'  # 11 chars max — fixed for HighAsCG WO-47 systemd mount

$SeedDirs = @(
    'sim\highascg',
    'drop-config',
    'media',
    'templates',
    'configs',
    'snapshots\rear-panels'
)

function Get-CandidateUsbDisks {
    # Prefer strict USB bus disks only (safest visible choice).
    $usb = @(Get-Disk | Where-Object { $_.BusType -eq 'USB' -and $_.Size -gt 0 })
    if ($usb.Count -eq 0) {
        Write-Warning 'No Get-Disk entries with BusType=USB.'
        Write-Warning 'Showing disks whose FriendlyName mentions USB — verify model/serial manually.'
        $usb = @(Get-Disk | Where-Object { $_.FriendlyName -match 'USB|UAS' })
    }
    if ($usb.Count -eq 0) {
        return @()
    }
    return @($usb | Sort-Object Number -Unique)
}

function Show-DiskMenu {
    param([array] $Disks)
    Write-Host ''
    Write-Host '=== Visible USB / external candidates (whole PhysicalDrive) ===' -ForegroundColor Cyan
    $i = 1
    $script:MenuMap = @{}
    foreach ($d in $Disks) {
        $sizeGiB = [math]::Round($d.Size / 1GB, 2)
        $serial = if ($d.SerialNumber) { $d.SerialNumber.Trim() } else { '(no serial)' }
        Write-Host ("  {0,2}) Disk {1,-3}  {2,8} GiB  Model: {3}  Serial: {4}" -f $i, $d.Number, $sizeGiB, $d.FriendlyName, $serial)
        $MenuMap[$i.ToString()] = $d
        $i++
    }
    Write-Host ''
}

function Write-IsoToRawDisk {
    param([string] $ImagePath, [int] $DiskNumber)
    $rawPath = "\\.\PhysicalDrive$DiskNumber"
    if (-not (Test-Path -LiteralPath $ImagePath)) {
        throw "ISO not found: $ImagePath"
    }
    $isoInfo = Get-Item -LiteralPath $ImagePath
    Write-Host "Writing $($isoInfo.Length) bytes from ISO to $rawPath ..." -ForegroundColor Yellow

    $inStream = [System.IO.File]::OpenRead((Resolve-Path -LiteralPath $ImagePath))
    try {
        $outStream = New-Object System.IO.FileStream(
            $rawPath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::ReadWrite,
            4MB,
            [System.IO.FileOptions]::WriteThrough
        )
        try {
            $buf = New-Object byte[] (4MB)
            $total = 0L
            while (($read = $inStream.Read($buf, 0, $buf.Length)) -gt 0) {
                $outStream.Write($buf, 0, $read)
                $total += $read
                if (($total % (64MB)) -eq 0 -or $read -lt $buf.Length) {
                    Write-Host ("  ... {0:N0} MiB" -f ($total / 1MB)) -ForegroundColor DarkGray
                }
            }
            $outStream.Flush()
        }
        finally {
            $outStream.Dispose()
        }
    }
    finally {
        $inStream.Dispose()
    }
    Write-Host 'ISO write complete; flushing...' -ForegroundColor Green
}

function Wait-DiskRescan {
    param([int] $DiskNumber)
    Update-Disk -Number $DiskNumber -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    foreach ($attempt in 1..8) {
        try {
            $d = Get-Disk -Number $DiskNumber -ErrorAction Stop
            $parts = @(Get-Partition -DiskNumber $DiskNumber -ErrorAction SilentlyContinue)
            Write-Host ("Rescan OK: PartitionStyle={0} partitions={1}" -f $d.PartitionStyle, $parts.Count) -ForegroundColor DarkGray
            return
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }
}

function Test-UnallocatedTail {
    param([int] $DiskNumber)
    $disk = Get-Disk -Number $DiskNumber -ErrorAction Stop
    $parts = @(Get-Partition -DiskNumber $DiskNumber -ErrorAction SilentlyContinue)
    $sum = ($parts | Measure-Object -Property Size -Sum).Sum
    # Some layouts leave a gap; Prefer explicit Size - Allocated if available:
    $free = [int64]$disk.Size - [int64]$sum
    if ($disk.AllocatedSize) {
        $fa = [math]::Abs([int64]$disk.Size - [int64]$disk.AllocatedSize)
        if ($fa -lt [int64]$disk.Size -and $fa -gt 0) { $free = $fa }
    }
    return @{ FreeBytes = $free; PartitionCount = $parts.Count }
}

function New-DataPartitionDiskPart {
    param([int] $DiskNumber)
    $scriptLines = @(
        'SELECT DISK ' + $DiskNumber,
        'ATTRIBUTES DISK CLEAR READONLY',
        'ONLINE DISK NOERR',
        'CREATE PARTITION PRIMARY',
        'FORMAT FS=EXFAT QUICK LABEL=' + $ExfatLabel,
        'ASSIGN',
        'EXIT'
    )
    $diskPartScript = ($scriptLines -join "`r`n")
    Write-Host 'Running diskpart (create exFAT HIGHASCGEXF on first unallocated extent)...' -ForegroundColor Yellow
    $diskPartScript | diskpart | Out-Host
}

function Expand-SeedLayout {
    param([char] $DriveLetter)
    $root = "$($DriveLetter):\"
    if (-not (Test-Path -LiteralPath $root)) {
        throw "Drive $root not available after format."
    }
    foreach ($rel in $SeedDirs) {
        $p = Join-Path $root $rel
        New-Item -ItemType Directory -Force -Path $p | Out-Null
    }
    $readme = @"
HighAsCG operator data (exFAT volume label: $ExfatLabel)

sim\highascg     — Unzip a GitHub release / sync a clone here; Linux boot syncs mtime -> ~/highascg (see WO-47).
drop-config      — Optional highascg.config.json for exFAT sync map.
media            — Large media; bind-mounted under ~/highascg/media/exfat on Linux image.
templates        — Extra templates you carry between machines.
configs          — Site config exports.
snapshots\rear-panels — Device / rear-panel snapshot JSON or images.

Boot the stick with your HighAsCG live image; exFAT mounts at /home/casparcg/exfat.
"@
    Set-Content -LiteralPath (Join-Path $root 'README-HIGHASCG-EXFAT.txt') -Value $readme -Encoding UTF8
    Write-Host "Seeded folders under ${root}" -ForegroundColor Green
}

function Install-AppPayload {
	param(
		[Parameter(Mandatory = $true)][char] $DriveLetter,
		[string] $TarPath = '',
		[string] $AppDir = ''
	)
	$dest = "$($DriveLetter):\sim\highascg"
    if ($TarPath -and $AppDir) { throw 'Internal: supply only one of TarPath or AppDir' }
    if ($TarPath) {
        if (-not (Test-Path -LiteralPath $TarPath)) {
            throw "Tarball not found: $TarPath"
        }
        $tarCmd = Get-Command tar.exe -ErrorAction SilentlyContinue
        if (-not $tarCmd) {
            throw 'tar.exe not on PATH (bundled with Windows 10+ — enable or install tar).'
        }
        Get-ChildItem -LiteralPath $dest -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
        Write-Host "Extracting tarball → $dest …" -ForegroundColor Yellow
        & tar.exe -xzf $TarPath -C $dest
        if ($LASTEXITCODE -ne 0) { throw "tar extract failed (exit $LASTEXITCODE)" }
    }
    elseif ($AppDir) {
        if (-not (Test-Path -LiteralPath $AppDir)) {
            throw "App directory not found: $AppDir"
        }
        $pkg = Join-Path $AppDir 'package.json'
        if (-not (Test-Path -LiteralPath $pkg)) {
            throw "No package.json under $AppDir"
        }
        Get-ChildItem -LiteralPath $dest -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
        Write-Host "Copying app tree → $dest …" -ForegroundColor Yellow
        Copy-Item -Path (Join-Path $AppDir '*') -Destination $dest -Recurse -Force
    }
}

# --- main ---
if ($SkipExfat -and ($TarGzPath -or $AppSourceDirectory)) {
	throw 'Do not use -SkipExfat together with -TarGzPath / -AppSourceDirectory (exFAT is required for the copy target).'
}
if (-not (Test-Path -LiteralPath $IsoPath)) {
    throw "ISO not found: $IsoPath"
}

$candidates = @(Get-CandidateUsbDisks)
if ($candidates.Count -eq 0) {
    throw 'No candidate USB disks found. Attach a USB stick and re-run as Administrator.'
}

Show-DiskMenu -Disks $candidates
$choice = Read-Host 'Enter the menu number of the USB stick to wipe (no default)'
if (-not $MenuMap.ContainsKey($choice)) {
    throw 'Invalid selection.'
}
$selected = $MenuMap[$choice]
$diskNum = $selected.Number

Write-Host ''
Write-Host "YOU SELECTED: Disk $diskNum  $($selected.FriendlyName)  $([math]::Round($selected.Size/1GB,2)) GiB" -ForegroundColor Red
Write-Host "ISO: $IsoPath"
Write-Host ''
$w1 = Read-Host 'Type YES to destroy all data on this disk'
if ($w1 -ne 'YES') { throw 'Aborted.' }
$w2 = Read-Host "Type the disk number again to confirm ($diskNum)"
if ([string]$w2 -ne [string]$diskNum) { throw 'Confirmation mismatch. Aborted.' }

if ($DryRun) {
    Write-Host 'Dry run only — no changes.' -ForegroundColor Cyan
    exit 0
}

Write-IsoToRawDisk -ImagePath $IsoPath -DiskNumber $diskNum
Wait-DiskRescan -DiskNumber $diskNum

if ($SkipExfat) {
    Write-Host 'SkipExfat: done after ISO write.' -ForegroundColor Yellow
    exit 0
}

$ua = Test-UnallocatedTail -DiskNumber $diskNum
$minFree = 400MB
if ($ua.FreeBytes -lt $minFree) {
    Write-Warning ("Little or no unallocated space reported ({0:N0} MiB). exFAT step skipped. Use a larger stick or Linux add-exfat-data-partition.sh." -f ($ua.FreeBytes/1MB))
    exit 2
}

New-DataPartitionDiskPart -DiskNumber $diskNum
Start-Sleep -Seconds 2
Update-Disk -Number $diskNum -ErrorAction SilentlyContinue

# Typical assign letter=P from diskpart; allow automount catching other letters
$partsVol = @(Get-Partition -DiskNumber $diskNum | Get-Volume -ErrorAction SilentlyContinue |
    Where-Object { $_.FileSystemLabel -eq $ExfatLabel -and $_.DriveLetter })
if ($partsVol.Count -eq 0) {
    $partsVol = @(Get-Partition -DiskNumber $diskNum | Get-Volume -ErrorAction SilentlyContinue |
        Where-Object { $_.FileSystem -eq 'exFAT' -and $_.DriveLetter })
}
if ($partsVol.Count -eq 0) {
    throw 'exFAT created but volume not enumerated — open Disk Management (assign letter / rescan), then re-run with -SkipExfat after manual format, or seed folders by hand.'
}
$letter = $partsVol[-1].DriveLetter
if (-not $letter) {
    throw 'exFAT volume has no drive letter — assign one in Disk Management and run folder creation manually.'
}
Expand-SeedLayout -DriveLetter $letter

if ($TarGzPath) {
    Install-AppPayload -DriveLetter $letter -TarPath $TarGzPath
}
elseif ($AppSourceDirectory) {
    Install-AppPayload -DriveLetter $letter -AppDir $AppSourceDirectory
}

Write-Host ''
Write-Host 'Done. The exFAT volume may have a temporary drive letter in Explorer (diskpart ASSIGN).' -ForegroundColor Cyan
Write-Host 'On Linux boots, this volume attaches as LABEL=HIGHASCGEXF -> /home/casparcg/exfat' -ForegroundColor Cyan
