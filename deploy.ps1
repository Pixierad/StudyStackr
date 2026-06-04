# Deploy script: commit + push to GitHub, then export for Cloudflare Pages.
# Run from the project root:  .\deploy.ps1
#
# Preferred Cloudflare setup: connect this GitHub repo to Cloudflare Pages.
# After this script pushes to GitHub, Cloudflare Pages will build from the
# latest commit using:
#
#     Build command: npm run build:web
#     Build output directory: dist
#
# Optional direct deploy: set CLOUDFLARE_PAGES_DIRECT=1 and either sign in with
# `npx wrangler login` or provide CLOUDFLARE_API_TOKEN. The script will deploy
# the local dist/ folder with Wrangler.
#
# Optional project override:
#     $env:CLOUDFLARE_PAGES_PROJECT = "schoolapp"

$ErrorActionPreference = 'Stop'

Write-Host "[1/6] Staging changes..." -ForegroundColor Cyan
git add -A

Write-Host "[2/6] Committing..." -ForegroundColor Cyan
$msg = "Deploy: latest changes"
if ($args.Count -gt 0) { $msg = $args -join ' ' }

# git commit exits non-zero if nothing is staged; treat that as OK.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
git commit -m $msg
$commitExit = $LASTEXITCODE
$ErrorActionPreference = $prevEAP

if ($commitExit -ne 0) {
    $pending = (& git status --porcelain)
    if ($pending) {
        Write-Host ""
        Write-Host "    Commit failed while changes are still staged." -ForegroundColor Red
        Write-Host "    Resolve the Git error above, then run .\deploy.ps1 again." -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
    Write-Host ""
    Write-Host "    No staged changes to commit; continuing with current HEAD." -ForegroundColor Yellow
    Write-Host ""
}

$headSha = (& git rev-parse --short HEAD).Trim()
Write-Host "    Deploying HEAD $headSha." -ForegroundColor Green

Write-Host "[4/6] Pushing to GitHub..." -ForegroundColor Cyan
$originUrl = (& git remote get-url origin 2>$null)
if ($LASTEXITCODE -eq 0 -and $originUrl) {
    $originUrl = $originUrl.Trim()
} else {
    $originUrl = ""
}
if ($LASTEXITCODE -ne 0 -or -not $originUrl) {
    Write-Host ""
    Write-Host "    Could not read the GitHub remote named 'origin'." -ForegroundColor Red
    Write-Host "    Fix:" -ForegroundColor Yellow
    Write-Host "      git remote add origin https://github.com/Pixierad/SchoolApp.git" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$pushRemote = "origin"
$pushRef = $null
if ($originUrl -match '^https://[^/]+@github\.com/' -or $originUrl -match 'gh[pousr]_[A-Za-z0-9_]+') {
    $currentBranch = (& git branch --show-current).Trim()
    if (-not $currentBranch) {
        Write-Host ""
        Write-Host "    Your GitHub remote has an old username/token embedded in it, and Git cannot detect the current branch." -ForegroundColor Red
        Write-Host ""
        Write-Host "    Fix:" -ForegroundColor Yellow
        Write-Host "      git remote set-url origin https://github.com/Pixierad/SchoolApp.git" -ForegroundColor Yellow
        Write-Host "      git push" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }

    Write-Host ""
    Write-Host "    Your saved GitHub remote has an old username/token embedded in it." -ForegroundColor Yellow
    Write-Host "    Using a clean GitHub URL for this push so Git Credential Manager can sign you in." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    After this deploy, clean up the saved remote with:" -ForegroundColor Yellow
    Write-Host "      git remote set-url origin https://github.com/Pixierad/SchoolApp.git" -ForegroundColor Yellow
    Write-Host ""

    $pushRemote = "https://github.com/Pixierad/SchoolApp.git"
    $pushRef = "HEAD:$currentBranch"
}

if ($pushRef) {
    git push $pushRemote $pushRef
} else {
    git push
}
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "    GitHub rejected the push." -ForegroundColor Red
    Write-Host ""
    Write-Host "    Fix:" -ForegroundColor Yellow
    Write-Host '      "protocol=https`nhost=github.com`n`n" | git credential-manager erase' -ForegroundColor Yellow
    Write-Host "      git push" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    When Git Credential Manager prompts you, sign in to GitHub in the browser." -ForegroundColor Yellow
    Write-Host "    Then run .\deploy.ps1 again." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "[5/6] Building web bundle..." -ForegroundColor Cyan

# Bake the current commit into the bundle so the app can show its live version.
# Expo's dotenv loader only inlines vars it finds in .env* files -- shell-set
# env vars get ignored. So we write them to .env.production.local just for the
# build, then delete the file so they never hang around. The file pattern
# .env*.local is gitignored, so this never leaks.
$gitShort = (& git rev-parse --short HEAD 2>$null)
$envFile = ".\.env.production.local"
if ($gitShort) {
    $ver = $gitShort.Trim()
    $built = Get-Date -Format "yyyy-MM-dd HH:mm"
    @(
        "EXPO_PUBLIC_APP_VERSION=$ver"
        "EXPO_PUBLIC_APP_BUILT=$built"
    ) | Set-Content -Path $envFile -Encoding utf8
    Write-Host "    Baked version: $ver ($built)" -ForegroundColor DarkGray
}

try {
    # --clear wipes Metro's transform cache so changes to env vars actually
    # produce a new bundle (otherwise Metro reuses the cached one).
    npx expo export --platform web --clear
    node .\scripts\copy-web-static.mjs
} finally {
    if (Test-Path $envFile) { Remove-Item $envFile -Force }
}

Write-Host "[6/6] Cloudflare Pages handoff..." -ForegroundColor Cyan

$cloudflareProject = $env:CLOUDFLARE_PAGES_PROJECT
if (-not $cloudflareProject) { $cloudflareProject = "schoolapp" }

if ($env:CLOUDFLARE_PAGES_DIRECT -eq "1") {
    Write-Host "    Direct deploy enabled for Cloudflare Pages project '$cloudflareProject'." -ForegroundColor Cyan
    $deployBranch = (& git branch --show-current).Trim()
    if (-not $deployBranch) { $deployBranch = "main" }
    npx wrangler pages deploy dist --project-name $cloudflareProject --branch $deployBranch
} else {
    Write-Host "    Built dist/ and pushed HEAD $headSha to GitHub." -ForegroundColor Green
    Write-Host "    Cloudflare Pages should now deploy from the connected GitHub repo." -ForegroundColor Green
    Write-Host ""
    Write-Host "    To deploy dist/ directly instead, run:" -ForegroundColor Yellow
    Write-Host "      `$env:CLOUDFLARE_PAGES_DIRECT='1'" -ForegroundColor Yellow
    Write-Host "      `$env:CLOUDFLARE_PAGES_PROJECT='$cloudflareProject'" -ForegroundColor Yellow
    Write-Host "      .\deploy.ps1" -ForegroundColor Yellow
}

Write-Host "Done." -ForegroundColor Green
