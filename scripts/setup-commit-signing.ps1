# scripts/setup-commit-signing.ps1
# ---------------------------------------------------------------------------
# Configure this Windows machine so every git commit is automatically signed
# with your existing SSH key, and (optionally) re-sign the current HEAD when
# a deployment or repository rule requires verified commits.
#
# Some hosts and protected branches reject unsigned or unverified commits.
#
# What this script does, in order:
#
#   1. Confirms git is on PATH and we're inside a git repository.
#   2. Locates an SSH key (id_ed25519, then id_rsa). If none exists it offers
#      to generate a new ed25519 key for you (recommended).
#   3. Sets the three git config values that switch on SSH commit signing
#      globally:
#         gpg.format         = ssh
#         user.signingkey    = <path to public key>
#         commit.gpgsign     = true
#   4. Writes an allowed-signers file so 'git verify-commit' and
#      'git log --show-signature' produce useful output locally. Without it
#      git can sign but cannot verify, so the deploy script's pre-push check
#      cannot work.
#   5. Prints the public key and the exact GitHub setting you must update
#      manually (this part cannot be automated -- it requires authenticating
#      to github.com in a browser).
#   6. If your current HEAD is unsigned, offers to amend it with -S and
#      force-push so the rejected deployment can be retried.
#
# Run from the project root:
#     powershell -ExecutionPolicy Bypass -File .\scripts\setup-commit-signing.ps1
#
# Re-running is safe: every step is idempotent.
#
# Note: this file is intentionally pure ASCII. PowerShell on Windows reads
# scripts in the system code page (usually Windows-1252) unless a BOM is
# present, which means box-drawing characters or em-dashes in a UTF-8 file
# can be misparsed and corrupt the lexer state.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

function Write-Step($n, $text) {
    Write-Host ("[{0}] {1}" -f $n, $text) -ForegroundColor Cyan
}
function Write-Info($text)  { Write-Host "    $text" -ForegroundColor DarkGray }
function Write-Ok($text)    { Write-Host "    $text" -ForegroundColor Green }
function Write-Warn($text)  { Write-Host "    $text" -ForegroundColor Yellow }
function Write-Err($text)   { Write-Host "    $text" -ForegroundColor Red }

# --- 1. Sanity checks ------------------------------------------------------

Write-Step '1/6' 'Checking git availability...'
$gitVersion = & git --version 2>$null
if (-not $gitVersion) {
    Write-Err 'git is not on PATH. Install Git for Windows from https://git-scm.com/download/win and re-run.'
    exit 1
}
Write-Info $gitVersion

$inRepo = (& git rev-parse --is-inside-work-tree 2>$null) -eq 'true'
if (-not $inRepo) {
    Write-Err 'This script must be run from inside a git working tree (cd to your project root first).'
    exit 1
}

# Stale HEAD.lock left behind by a previous crashed git process will block
# every write below ("fatal: cannot lock ref 'HEAD'"). Try to remove it
# silently; if it's actually held by a live process, the Remove-Item will
# fail and we surface a clear message.
$gitDir = (& git rev-parse --git-dir).Trim()
$headLock = Join-Path $gitDir 'HEAD.lock'
if (Test-Path $headLock) {
    try {
        Remove-Item $headLock -Force -ErrorAction Stop
        Write-Info "Cleared stale lock $headLock"
    } catch {
        Write-Err "A git process is holding $headLock. Close any open IDE/git GUI and re-run."
        exit 1
    }
}

# A local repo override of commit.gpgsign silently disables signing for
# this repo only -- the global config we set below cannot reach it.
# Detect and warn (we don't auto-unset, that's potentially destructive on
# repos where the override is intentional).
$localSign = (& git config --local commit.gpgsign 2>$null)
if ($localSign -and $localSign -ne 'true') {
    Write-Warn "Local override detected: commit.gpgsign = $localSign in $gitDir/config"
    Write-Warn '   This will block signing for this repo. To clear it, run:'
    Write-Warn '       git config --local --unset commit.gpgsign'
}

# --- 2. Locate or create an SSH key ----------------------------------------

Write-Step '2/6' 'Locating an SSH key for signing...'
$sshDir = Join-Path $env:USERPROFILE '.ssh'
if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
    Write-Info "Created $sshDir"
}

$ed25519Pub = Join-Path $sshDir 'id_ed25519.pub'
$rsaPub     = Join-Path $sshDir 'id_rsa.pub'

$pubKeyPath = $null
if (Test-Path $ed25519Pub) {
    $pubKeyPath = $ed25519Pub
    Write-Ok "Using existing key: $pubKeyPath"
} elseif (Test-Path $rsaPub) {
    $pubKeyPath = $rsaPub
    Write-Ok "Using existing key: $pubKeyPath"
    Write-Warn 'RSA keys work but ed25519 is recommended. Consider generating a new one.'
} else {
    Write-Warn 'No SSH key found.'
    $generate = Read-Host '    Generate a new ed25519 key now? [Y/n]'
    if ([string]::IsNullOrWhiteSpace($generate) -or $generate -match '^[Yy]') {
        $email = & git config --global user.email
        if ([string]::IsNullOrWhiteSpace($email)) {
            $email = Read-Host '    git user.email is not set. Enter the email to embed in the key'
            & git config --global user.email $email | Out-Null
        }
        # -N "" -> no passphrase. If you want a passphrase, remove that flag
        # and you will be prompted twice.
        & ssh-keygen -t ed25519 -C $email -f (Join-Path $sshDir 'id_ed25519') -N '""'
        $pubKeyPath = $ed25519Pub
        Write-Ok "Generated $pubKeyPath"
    } else {
        Write-Err 'Cannot continue without an SSH key.'
        exit 1
    }
}

# --- 3. Configure git to sign with that key --------------------------------

Write-Step '3/6' 'Configuring git to sign commits with this key...'
& git config --global gpg.format ssh
& git config --global user.signingkey $pubKeyPath
& git config --global commit.gpgsign true
& git config --global tag.gpgsign   true
Write-Ok  'gpg.format = ssh'
Write-Ok  "user.signingkey = $pubKeyPath"
Write-Ok  'commit.gpgsign = true'
Write-Ok  'tag.gpgsign    = true'

# --- 4. allowed_signers (so verification works locally) --------------------

Write-Step '4/6' 'Writing allowed_signers file...'
$allowedSigners = Join-Path $sshDir 'allowed_signers'
$pubKeyContent  = (Get-Content $pubKeyPath -Raw).Trim()
$signerEmail    = & git config --global user.email
if ([string]::IsNullOrWhiteSpace($signerEmail)) { $signerEmail = '*' }

$entry = "$signerEmail $pubKeyContent"
$existing = if (Test-Path $allowedSigners) { Get-Content $allowedSigners -Raw } else { '' }
if ($existing -notmatch [regex]::Escape($pubKeyContent)) {
    Add-Content -Path $allowedSigners -Value $entry
    Write-Ok "Added entry to $allowedSigners"
} else {
    Write-Info 'Entry already present; leaving file unchanged.'
}
& git config --global gpg.ssh.allowedSignersFile $allowedSigners
Write-Ok "gpg.ssh.allowedSignersFile = $allowedSigners"

# --- 5. GitHub-side instructions (manual) ----------------------------------

Write-Step '5/6' 'Register this key as a SIGNING key on GitHub (manual step).'
Write-Host ''
Write-Host '    Open:   https://github.com/settings/keys'                  -ForegroundColor White
Write-Host '    Click:  New SSH key'                                       -ForegroundColor White
Write-Host '    Type:   Signing Key   (NOT Authentication Key)'            -ForegroundColor Yellow
Write-Host '    Title:  e.g. "<your-machine> commit signing"'              -ForegroundColor White
Write-Host '    Key:    paste the public key shown below'                  -ForegroundColor White
Write-Host ''
Write-Host '    --- BEGIN PUBLIC KEY (copy the entire line) ---'           -ForegroundColor DarkGray
Write-Host $pubKeyContent                                                  -ForegroundColor Green
Write-Host '    --- END PUBLIC KEY ---'                                    -ForegroundColor DarkGray
Write-Host ''

# Try to copy to clipboard so the user can paste straight into GitHub.
try {
    Set-Clipboard -Value $pubKeyContent
    Write-Ok 'Public key copied to your clipboard.'
} catch {
    Write-Warn 'Could not copy to clipboard automatically; copy the line above manually.'
}

Read-Host '    Press Enter once you have added the key to GitHub as a SIGNING key'

# --- 6. Recover the current unverified HEAD --------------------------------

Write-Step '6/6' 'Checking the current HEAD commit...'
$headSha = (& git rev-parse --short HEAD).Trim()
cmd /c "git verify-commit HEAD >nul 2>nul"
$verifyExit = $LASTEXITCODE

if ($verifyExit -eq 0) {
    Write-Ok "HEAD ($headSha) is already verified. Nothing to fix."
} else {
    Write-Warn "HEAD ($headSha) is not signed; this can be rejected by protected deploys."
    Write-Host ''
    Write-Host '    Two options:'                                                          -ForegroundColor White
    Write-Host '      [a] Amend HEAD in place and force-push   (fastest, rewrites history)' -ForegroundColor White
    Write-Host '      [s] Skip and handle it yourself later'                                -ForegroundColor White
    $choice = Read-Host '    Choose [a/s]'
    if ($choice -match '^[Aa]') {
        Write-Info 'Re-signing HEAD with --amend --no-edit -S ...'
        & git commit --amend --no-edit -S
        if ($LASTEXITCODE -ne 0) {
            Write-Err 'git commit --amend failed. See the error above.'
            exit 1
        }

        $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
        Write-Info "Force-pushing $branch (with --force-with-lease for safety)..."
        & git push --force-with-lease origin $branch
        if ($LASTEXITCODE -ne 0) {
            Write-Err 'git push --force-with-lease failed. Inspect the error and retry manually.'
            exit 1
        }

        cmd /c "git verify-commit HEAD >nul 2>nul"
        if ($LASTEXITCODE -eq 0) {
            Write-Ok 'HEAD is now signed and pushed. Re-run your deployment.'
        } else {
            Write-Warn 'Local verification still failed. Check that:'
            Write-Warn '   - the SSH key was added on GitHub as a *Signing* key (not Auth)'
            Write-Warn '   - the email in (git config user.email) matches the key'
            Write-Warn '   - the allowed_signers file lists this key'
        }
    } else {
        Write-Info 'Skipped. To fix later, run:'
        Write-Host  '        git commit --amend --no-edit -S'
        Write-Host  '        git push --force-with-lease'
    }
}

Write-Host ''
Write-Host 'Setup complete. Future commits will be signed automatically.'              -ForegroundColor Green
Write-Host 'Unsigned commits will now be caught locally before a protected deploy.'    -ForegroundColor Green
