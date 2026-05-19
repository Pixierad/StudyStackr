# Deploy script: commit + push to GitHub, then export + deploy to Vercel.
# Run from the project root:  .\deploy.ps1
#
# First run only: you'll be asked to log in to Vercel and pick/create a project.
# That info is saved into .vercel\project.json, and every run after this one
# is fully non-interactive (no Enter mashing).
#
# This script enforces verified commits because the Vercel project policy
# rejects deployments whose head commit isn't signed:
#
#     The Deployment was canceled because it was created with an unverified commit
#
# Step [2/6] explicitly signs the deploy commit with -S, and step [3/6] runs
# `git verify-commit HEAD` before pushing. If verification fails the script
# bails out and points at scripts/setup-commit-signing.ps1, which performs
# the one-time SSH-signing setup.

$ErrorActionPreference = 'Stop'

Write-Host "[1/6] Staging changes..." -ForegroundColor Cyan
git add -A

Write-Host "[2/6] Committing (signed)..." -ForegroundColor Cyan
$msg = "Deploy: latest changes"
if ($args.Count -gt 0) { $msg = $args -join ' ' }

# Always pass -S explicitly. -S is idempotent: if commit.gpgsign is already
# true globally git would sign anyway, and if it isn't (e.g. a fresh clone
# on another machine) -S guarantees this deploy commit is still signed.
# This removes the dependency on global config being correct.

# git commit exits non-zero if nothing is staged; treat that as OK.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
git commit -S -m $msg
$ErrorActionPreference = $prevEAP

Write-Host "[3/6] Verifying HEAD signature..." -ForegroundColor Cyan
# git verify-commit emits its success message on stderr by convention.
# Under Windows PowerShell 5.x with $ErrorActionPreference = 'Stop',
# native-command stderr is wrapped in NativeCommandError BEFORE the
# PowerShell-level redirection (2>$null, 2>&1 | Out-Null) takes effect,
# so it still trips Stop. The robust workaround is to do the redirection
# at the Windows level via cmd.exe -- PowerShell never sees the bytes,
# so it cannot wrap them. $LASTEXITCODE is still propagated.
cmd /c "git verify-commit HEAD >nul 2>nul"
if ($LASTEXITCODE -ne 0) {
    $head = (& git rev-parse --short HEAD).Trim()
    Write-Host ""
    Write-Host "    HEAD ($head) is NOT a verified commit."                  -ForegroundColor Red
    Write-Host "    Vercel will cancel the deployment with the message:"     -ForegroundColor Red
    Write-Host "      'The Deployment was canceled because it was created"   -ForegroundColor Red
    Write-Host "       with an unverified commit'"                            -ForegroundColor Red
    Write-Host ""
    Write-Host "    Fix:"                                                     -ForegroundColor Yellow
    Write-Host "      1. Run the signing setup once:"                         -ForegroundColor Yellow
    Write-Host "           powershell -ExecutionPolicy Bypass -File .\scripts\setup-commit-signing.ps1" -ForegroundColor Yellow
    Write-Host "         (it walks you through SSH-signing config + the GitHub side)" -ForegroundColor Yellow
    Write-Host "      2. Re-sign this commit and retry:"                      -ForegroundColor Yellow
    Write-Host "           git commit --amend --no-edit -S"                   -ForegroundColor Yellow
    Write-Host "           .\deploy.ps1"                                      -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
$verifiedSha = (& git rev-parse --short HEAD).Trim()
Write-Host "    HEAD $verifiedSha is signed and verified." -ForegroundColor Green

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
} finally {
    if (Test-Path $envFile) { Remove-Item $envFile -Force }
}

Write-Host "[6/6] Deploying to Vercel..." -ForegroundColor Cyan

# Force dist/ to deploy to the schoolapp project, not auto-link to a new "dist" project.
if (-not (Test-Path ".\.vercel\project.json")) {
    Write-Host "    Missing .\.vercel\project.json - run 'vercel link' once first." -ForegroundColor Yellow
    exit 1
}
New-Item -ItemType Directory -Force -Path ".\dist\.vercel" | Out-Null
Copy-Item ".\.vercel\project.json" ".\dist\.vercel\project.json" -Force

if ($env:VERCEL_TOKEN) {
    npx vercel deploy dist --prod --yes --token $env:VERCEL_TOKEN
} else {
    npx vercel deploy dist --prod --yes
}

Write-Host "Done." -ForegroundColor Green
