# Deploy script: commit + push to GitHub production branch, then export for Cloudflare Pages.
# Run from the project root:  .\deploy.ps1
#
# Preferred Cloudflare setup: connect this GitHub repo to Cloudflare Pages.
# After this script pushes to the production branch on GitHub, Cloudflare Pages
# will build from the latest commit using:
#
#     Build command: npm run build:web
#     Build output directory: dist
#
# Optional direct deploy: set CLOUDFLARE_PAGES_DIRECT=1 and either sign in with
# `npx wrangler login` or provide CLOUDFLARE_API_TOKEN. The script will deploy
# the local dist/ folder with Wrangler.
#
# Optional project override:
#     $env:CLOUDFLARE_PAGES_PROJECT = "studystackr"
#
# Optional production branch override:
#     $env:CLOUDFLARE_PAGES_PRODUCTION_BRANCH = "main"

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

$productionBranch = $env:CLOUDFLARE_PAGES_PRODUCTION_BRANCH
if (-not $productionBranch) { $productionBranch = "main" }

$currentBranch = (& git branch --show-current).Trim()
if (-not $currentBranch) { $currentBranch = "HEAD" }
if ($currentBranch -ne $productionBranch) {
    Write-Host ""
    Write-Host "    Current branch is '$currentBranch'." -ForegroundColor Yellow
    Write-Host "    Cloudflare production deploys come from '$productionBranch', so this script will push HEAD to '$productionBranch'." -ForegroundColor Yellow
    Write-Host "    Cloudflare preview deployments are created from non-production branches." -ForegroundColor Yellow
    Write-Host ""
}

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
    Write-Host "      git remote add origin https://github.com/Pixierad/StudyStackr.git" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$pushRemote = "origin"
$pushRef = "HEAD:$productionBranch"
if ($originUrl -match '^https://[^/]+@github\.com/' -or $originUrl -match 'gh[pousr]_[A-Za-z0-9_]+') {
    Write-Host ""
    Write-Host "    Your saved GitHub remote has an old username/token embedded in it." -ForegroundColor Yellow
    Write-Host "    Using a clean GitHub URL for this push so Git Credential Manager can sign you in." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    After this deploy, clean up the saved remote with:" -ForegroundColor Yellow
    Write-Host "      git remote set-url origin https://github.com/Pixierad/StudyStackr.git" -ForegroundColor Yellow
    Write-Host ""

    $pushRemote = "https://github.com/Pixierad/StudyStackr.git"
}

git push $pushRemote $pushRef
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "    GitHub rejected the push." -ForegroundColor Red
    Write-Host ""
    Write-Host "    Fix:" -ForegroundColor Yellow
    Write-Host '      "protocol=https`nhost=github.com`n`n" | git credential-manager erase' -ForegroundColor Yellow
    Write-Host "      git fetch origin $productionBranch" -ForegroundColor Yellow
    Write-Host "      git merge origin/$productionBranch" -ForegroundColor Yellow
    Write-Host "      .\deploy.ps1" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    When Git Credential Manager prompts you, sign in to GitHub in the browser." -ForegroundColor Yellow
    Write-Host "    If the branch moved on GitHub, merge it first so pushing HEAD to '$productionBranch' can fast-forward." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "[5/6] Building web bundle..." -ForegroundColor Cyan

# --clear wipes Metro's transform cache so changes to env vars actually produce
# a new bundle. The export helper owns the temporary dotenv file and build stamp.
node .\scripts\export-web.mjs --clear
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[6/6] Cloudflare Pages handoff..." -ForegroundColor Cyan

$cloudflareProject = $env:CLOUDFLARE_PAGES_PROJECT
if (-not $cloudflareProject) { $cloudflareProject = "studystackr" }

if ($env:CLOUDFLARE_PAGES_DIRECT -eq "1") {
    Write-Host "    Direct deploy enabled for Cloudflare Pages project '$cloudflareProject'." -ForegroundColor Cyan
    $deployBranch = $productionBranch
    npx wrangler pages deploy dist --project-name $cloudflareProject --branch $deployBranch
} else {
    Write-Host "    Built dist/ and pushed HEAD $headSha to GitHub branch '$productionBranch'." -ForegroundColor Green
    Write-Host "    Cloudflare Pages should now create a Production deployment from the connected GitHub repo." -ForegroundColor Green
    Write-Host ""
    Write-Host "    To deploy dist/ directly instead, run:" -ForegroundColor Yellow
    Write-Host "      `$env:CLOUDFLARE_PAGES_DIRECT='1'" -ForegroundColor Yellow
    Write-Host "      `$env:CLOUDFLARE_PAGES_PROJECT='$cloudflareProject'" -ForegroundColor Yellow
    Write-Host "      .\deploy.ps1" -ForegroundColor Yellow
}

Write-Host "Done." -ForegroundColor Green
