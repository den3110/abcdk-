# Chuẩn bị thư mục bin/ cho bản Windows TỰ CHỨA (không cần cài Python/ffmpeg):
#   - bin/ffmpeg.exe + bin/ffprobe.exe  (từ npm ffmpeg-static / ffprobe-static)
#   - bin/ptlive-worker.exe             (PyInstaller onefile, kèm ImouPkg)
# Chạy trên Windows TRƯỚC `npm run dist:win`.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)   # → thư mục app
$Root = (Get-Location).Path
$Bin  = Join-Path $Root 'bin'

if (Test-Path $Bin) { Remove-Item -Recurse -Force $Bin }
New-Item -ItemType Directory -Path $Bin | Out-Null

Write-Host '==> ffmpeg / ffprobe tĩnh'
$Ffmpeg  = node -e "process.stdout.write(require('ffmpeg-static'))"
$Ffprobe = node -e "process.stdout.write(require('ffprobe-static').path)"
Copy-Item $Ffmpeg  (Join-Path $Bin 'ffmpeg.exe')  -Force
Copy-Item $Ffprobe (Join-Path $Bin 'ffprobe.exe') -Force

Write-Host '==> Đóng gói worker (PyInstaller + ImouPkg)'
$Py = $null
foreach ($c in @('py -3.13','py -3.12','py -3.11','py -3.10','python3.13','python3.12','python3.11','python3.10','python')) {
  try {
    $ver = & cmd /c "$c -c ""import sys;print(sys.version_info[0],sys.version_info[1])"" 2>NUL"
    if ($LASTEXITCODE -eq 0 -and $ver) {
      $parts = $ver.Trim().Split(' ')
      if ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 10) { $Py = $c; break }
    }
  } catch {}
}
if (-not $Py) { throw 'Cần Python 3.10+ trên máy build (không tìm thấy).' }
Write-Host "   Python: $Py"

$Venv = Join-Path $Root '.buildvenv'
if (Test-Path $Venv) { Remove-Item -Recurse -Force $Venv }
& cmd /c "$Py -m venv `"$Venv`""
$VenvPy = Join-Path $Venv 'Scripts\python.exe'
& $VenvPy -m pip install --upgrade pip --quiet
& $VenvPy -m pip install --quiet (Join-Path $Root 'vendor\imou-pkg') pyinstaller

$Dist = Join-Path $Root '.builddist'
$Work = Join-Path $Root '.buildwork'
if (Test-Path $Dist) { Remove-Item -Recurse -Force $Dist }
if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
& $VenvPy -m PyInstaller --onefile --name ptlive-worker `
  --collect-all imou --collect-all Cryptodome `
  --distpath $Dist --workpath $Work `
  (Join-Path $Root 'worker\worker.py')

Copy-Item (Join-Path $Dist 'ptlive-worker.exe') (Join-Path $Bin 'ptlive-worker.exe') -Force

Remove-Item -Recurse -Force $Work, $Dist -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $Root 'ptlive-worker.spec') -ErrorAction SilentlyContinue

Write-Host '==> Tailscale (tailscaled.exe + tailscale.exe) de nhung app (tu vao tailnet)'
$tsdExe = Join-Path $Bin 'tailscaled.exe'
$tsExe  = Join-Path $Bin 'tailscale.exe'
# 1) Uu tien binary da kem san trong vendor (git) -> khong can Go, khong copy tay.
$Vend = Join-Path $Root 'vendor\tailscale\windows-amd64'
if ((Test-Path (Join-Path $Vend 'tailscaled.exe')) -and (Test-Path (Join-Path $Vend 'tailscale.exe'))) {
  Copy-Item (Join-Path $Vend 'tailscaled.exe') $tsdExe -Force
  Copy-Item (Join-Path $Vend 'tailscale.exe')  $tsExe  -Force
  Write-Host '  -> copy tu vendor/tailscale/windows-amd64 (tailscaled.exe, tailscale.exe)'
}
# 2) Neu chua co + co Go -> build tu nguon (ban moi nhat).
if ((-not (Test-Path $tsdExe)) -or (-not (Test-Path $tsExe))) {
  $go = Get-Command go -ErrorAction SilentlyContinue
  if ($go) {
    $env:GOBIN = $Bin; $env:GOFLAGS = '-trimpath'; $env:CGO_ENABLED = '0'
    go install tailscale.com/cmd/tailscaled@latest
    go install tailscale.com/cmd/tailscale@latest
    if (Test-Path $tsdExe) { Write-Host '  -> build tu Go: bin/tailscaled.exe, bin/tailscale.exe' }
  } else {
    Write-Host '  !! Khong co binary trong vendor va chua cai Go -> BO QUA Tailscale'
  }
}

Write-Host '==> Xong. bin/:'
Get-ChildItem $Bin | Format-Table Name, Length -AutoSize
Write-Host 'Giờ chạy: npm run dist:win'
