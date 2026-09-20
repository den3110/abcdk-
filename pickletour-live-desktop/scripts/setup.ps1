# Cài phụ thuộc cho PickleTour Live (Windows): Python 3.10+ deps (ImouPkg) + kiểm ffmpeg.
$ErrorActionPreference = "Stop"
$Dir = Split-Path -Parent $PSScriptRoot
Write-Host "== PickleTour Live setup =="

function Get-Py {
  foreach ($c in @("python3.13","python3.12","python3.11","python3.10","python","py")) {
    if (Get-Command $c -ErrorAction SilentlyContinue) {
      try {
        $v = & $c -c "import sys;print('%d.%d'%sys.version_info[:2])"
        $parts = $v.Split('.'); if ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 10) { return $c }
      } catch {}
    }
  }
  return $null
}
$py = Get-Py
if (-not $py) {
  Write-Host "Khong tim thay Python >= 3.10. Tai https://www.python.org/downloads/ (tick 'Add to PATH')"
  exit 1
}
Write-Host "OK Python: $(& $py --version) ($py)"

$Venv = Join-Path $Dir ".venv"
Write-Host "-> Tao venv: $Venv"
& $py -m venv $Venv
$VPy = Join-Path $Venv "Scripts\python.exe"
& $VPy -m pip install --upgrade pip | Out-Null
Write-Host "-> Cai ImouPkg + deps vao venv..."
& $VPy -m pip install "$Dir\vendor\imou-pkg" requests pycryptodomex
& $VPy -c "import imou; print('OK ImouPkg')"
Set-Content -Path "$Dir\.python-path" -Value $VPy
Write-Host "OK ghi .python-path = $VPy"

if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
  Write-Host "OK ffmpeg co san"
  ffmpeg -hide_banner -encoders 2>$null | Select-String "h264_nvenc|h264_qsv|h264_vaapi" | ForEach-Object { Write-Host "   GPU: $_" }
} else {
  Write-Host "Chua co ffmpeg. Tai https://www.gyan.dev/ffmpeg/builds/ va them vao PATH (khuyen nghi may co NVENC)."
}
Write-Host "== Xong. Chay app: npm start =="
