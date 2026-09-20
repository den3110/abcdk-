# Cài phụ thuộc cho PickleTour Live (Windows): Python deps (ImouPkg) + kiểm ffmpeg.
$ErrorActionPreference = "Stop"
$Dir = Split-Path -Parent $PSScriptRoot
Write-Host "== PickleTour Live setup =="

$py = $null
foreach ($c in @("python", "py")) {
  if (Get-Command $c -ErrorAction SilentlyContinue) { $py = $c; break }
}
if (-not $py) { Write-Host "Chua co Python 3. Tai tai https://www.python.org/downloads/ (tick 'Add to PATH')"; exit 1 }
Write-Host "OK Python: $(& $py --version)"

Write-Host "-> Cai ImouPkg + deps..."
& $py -m pip install --upgrade pip | Out-Null
& $py -m pip install "$Dir\vendor\imou-pkg" requests pycryptodomex
& $py -c "import imou; print('OK ImouPkg')"

if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
  Write-Host "OK ffmpeg co san"
  ffmpeg -hide_banner -encoders 2>$null | Select-String "h264_nvenc|h264_qsv|h264_vaapi" | ForEach-Object { Write-Host "   GPU: $_" }
} else {
  Write-Host "Chua co ffmpeg. Tai https://www.gyan.dev/ffmpeg/builds/ va them vao PATH (khuyen nghi ban co NVENC)."
}
Write-Host "== Xong. Chay app: npm start =="
