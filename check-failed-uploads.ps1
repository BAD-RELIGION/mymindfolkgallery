# Check for failed uploads
$jsonPath = "E:\Tralha\Stuff\crypto design\MY MINDFOLK\mindfolkgallery\arweave_image_mapping.json"
$sourceFolder = "E:\Tralha\Stuff\crypto design\MY MINDFOLK\Mindfolk Images"

Write-Host "🔍 Checking for failed uploads..." -ForegroundColor Cyan
Write-Host ""

# Load uploaded files from JSON
$json = Get-Content $jsonPath | ConvertFrom-Json
$uploadedFiles = $json.PSObject.Properties.Name
$uploadedCount = $uploadedFiles.Count

Write-Host "✅ Files uploaded: $uploadedCount" -ForegroundColor Green

# Get all image files from source folder
Write-Host "📁 Scanning source folder..." -ForegroundColor Cyan
$allImageFiles = Get-ChildItem -Path $sourceFolder -Recurse -Include *.png,*.jpg,*.jpeg,*.gif,*.webp | ForEach-Object { $_.Name }
$totalCount = $allImageFiles.Count

Write-Host "📁 Total image files: $totalCount" -ForegroundColor Cyan
Write-Host ""

# Find missing files
$missingFiles = @()
foreach ($file in $allImageFiles) {
    if ($uploadedFiles -notcontains $file) {
        $missingFiles += $file
    }
}

if ($missingFiles.Count -eq 0) {
    Write-Host "✨ All files uploaded successfully! No failures detected." -ForegroundColor Green
} else {
    Write-Host "❌ Missing/Failed uploads: $($missingFiles.Count)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Failed files (first 20):" -ForegroundColor Yellow
    $missingFiles | Select-Object -First 20 | ForEach-Object { Write-Host "  - $_" }
    if ($missingFiles.Count -gt 20) {
        Write-Host "  ... and $($missingFiles.Count - 20) more" -ForegroundColor Yellow
    }
    
    # Save to file
    $missingFiles | Out-File "failed_uploads.txt"
    Write-Host ""
    Write-Host "📄 Failed file list saved to: failed_uploads.txt" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "📊 Summary:" -ForegroundColor Magenta
Write-Host "  Uploaded: $uploadedCount / $totalCount"
Write-Host "  Missing: $($missingFiles.Count)"
if ($totalCount -gt 0) {
    $successRate = [math]::Round(($uploadedCount / $totalCount) * 100, 2)
    Write-Host "  Success rate: $successRate%"
}










