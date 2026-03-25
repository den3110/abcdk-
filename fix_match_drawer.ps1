$path = "frontend\src\screens\PickleBall\match\ResponsiveMatchViewer.jsx"
$content = Get-Content $path -Raw
$newCode = @"
  if (isMobile) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        keepMounted
        sx={{ ...(zIndex ? { zIndex } : {}) }}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            height: "92vh",
            maxHeight: "100vh",
            minHeight: "80vh",
          },
        }}
      >
        <Box
          sx={{
            p: 2,
            pt: 1.25,
            maxWidth: 1000,
            mx: "auto",
            width: "100%",
            pb: 6,
          }}
        >
          <Box
"@

$oldCodeRegex = [regex]::Escape("            width: `"100%`",`r`n            pb: 6,`r`n          }}`r`n        >`r`n          <Box")
$newContent = $content -replace $oldCodeRegex, $newCode

if ($newContent -eq $content) {
    $oldCodeRegex2 = [regex]::Escape("            width: `"100%`",`n            pb: 6,`n          }}`n        >`n          <Box")
    $newContent = $content -replace $oldCodeRegex2, $newCode
}

Set-Content -Path $path -Value $newContent -NoNewline
