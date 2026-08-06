<#
.SYNOPSIS
  Xóa các tags cũ trên Docker Hub, chỉ giữ lại v3.6 và v4.3.
.DESCRIPTION
  Script này xóa 12 tags cũ khỏi repo dieuhaukieuhanh/gpuvietnam-comfyui,
  chỉ giữ lại 2 tags mới nhất: v3.6 và v4.3.

  Cần Docker Hub Personal Access Token (PAT) để chạy.
  Tạo PAT tại: https://hub.docker.com/settings/security
.PARAMETER DryRun
  Nếu true, chỉ hiển thị tags sẽ bị xóa mà không thực sự xóa.
.EXAMPLE
  .\scripts\cleanup-dockerhub-tags.ps1
  .\scripts\cleanup-dockerhub-tags.ps1 -DryRun
#>

param(
  [switch]$DryRun = $false
)

$REPO = "dieuhaukieuhanh/gpuvietnam-comfyui"
$KEEP_TAGS = @("v3.6", "v4.3")

# ============================================================================
# 1. Nhập credentials
# ============================================================================
Write-Host "=== Docker Hub Tag Cleanup ===" -ForegroundColor Cyan
Write-Host "Repo: $REPO"
Write-Host "Keep: $($KEEP_TAGS -join ', ')"
Write-Host ""

$username = $env:DOCKER_HUB_USERNAME
$password = $env:DOCKER_HUB_TOKEN

if (-not $username) {
  $username = Read-Host "Docker Hub username (hoặc set DOCKER_HUB_USERNAME env var)"
}
if (-not $password) {
  $password = Read-Host "Docker Hub PAT / password (hoặc set DOCKER_HUB_TOKEN env var)"
}

if (-not $username -or -not $password) {
  Write-Host "ERROR: Cần username và PAT/password để xóa tags." -ForegroundColor Red
  Write-Host "Tạo PAT tại: https://hub.docker.com/settings/security" -ForegroundColor Yellow
  exit 1
}

# ============================================================================
# 2. Lấy token từ Docker Hub
# ============================================================================
Write-Host "`n[1/4] Authenticating with Docker Hub..." -ForegroundColor Cyan

$authBody = @{ username = $username; password = $password } | ConvertTo-Json
try {
  $authResp = Invoke-RestMethod -Uri "https://hub.docker.com/v2/users/login" -Method Post -Body $authBody -ContentType "application/json"
  $hubToken = $authResp.token
  Write-Host "  OK: Logged in as $($authResp.user.username)" -ForegroundColor Green
} catch {
  Write-Host "  ERROR: Login failed — $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$hubHeaders = @{ Authorization = "JWT $hubToken" }

# ============================================================================
# 3. Lấy danh sách tags
# ============================================================================
Write-Host "`n[2/4] Fetching all tags..." -ForegroundColor Cyan

$allTags = @()
$page = 1
do {
  $url = "https://hub.docker.com/v2/repositories/$REPO/tags?page_size=100&page=$page"
  $resp = Invoke-RestMethod -Uri $url -Headers $hubHeaders
  $allTags += $resp.results
  $page++
} while ($resp.next)

Write-Host "  Found $($allTags.Count) tags" -ForegroundColor White
foreach ($t in $allTags) {
  $keep = if ($KEEP_TAGS -contains $t.name) { "[KEEP]" } else { "[DEL]" }
  $color = if ($KEEP_TAGS -contains $t.name) { "Green" } else { "DarkGray" }
  $sizeGB = [math]::Round($t.full_size / 1GB, 2)
  Write-Host "  $keep $($t.name.PadRight(12)) $($sizeGB.ToString().PadLeft(6)) GB  $($t.last_updated.Substring(0,10))" -ForegroundColor $color
}

# ============================================================================
# 4. Xóa tags (trừ KEEP_TAGS)
# ============================================================================
$deleteTags = $allTags | Where-Object { $KEEP_TAGS -notcontains $_.name }

if ($DryRun) {
  Write-Host "`n[3/4] DRY RUN — would delete $($deleteTags.Count) tags:" -ForegroundColor Yellow
  foreach ($t in $deleteTags) {
    Write-Host "  WOULD DELETE: $($t.name) ($($t.id))" -ForegroundColor Yellow
  }
  Write-Host "`n  Run without -DryRun to actually delete." -ForegroundColor Yellow
  exit 0
}

Write-Host "`n[3/4] Deleting $($deleteTags.Count) old tags..." -ForegroundColor Cyan

$deleted = 0
$failed = 0
foreach ($t in $deleteTags) {
  try {
    $deleteUrl = "https://hub.docker.com/v2/repositories/$REPO/tags/$($t.name)/"
    Invoke-RestMethod -Uri $deleteUrl -Headers $hubHeaders -Method Delete | Out-Null
    Write-Host "  DELETED: $($t.name)" -ForegroundColor Gray
    $deleted++
  } catch {
    Write-Host "  FAILED: $($t.name) — $($_.Exception.Message)" -ForegroundColor Red
    $failed++
  }
}

# ============================================================================
# 5. Kết quả
# ============================================================================
Write-Host "`n[4/4] Done!" -ForegroundColor Cyan
Write-Host "  Deleted: $deleted" -ForegroundColor Green
if ($failed -gt 0) {
  Write-Host "  Failed: $failed" -ForegroundColor Red
}
Write-Host "`n  Tags giữ lại: $($KEEP_TAGS -join ', ')" -ForegroundColor Green
Write-Host "`n  Tiếp theo:" -ForegroundColor Yellow
Write-Host "  1. Build Salad IPv6 images: docker build -f docker/salad-ipv6/Dockerfile.v3 -t $REPO`:v3.6-salad ."
Write-Host "  2. Push: docker push $REPO`:v3.6-salad"
Write-Host "  3. Tag latest: docker tag $REPO`:v3.6 $REPO`:latest && docker push $REPO`:latest"
