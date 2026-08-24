# Claude Code Speedometer — statusline capture
#
# Claude Code pipes a JSON payload (model, workspace, context_window, rate_limits, ...)
# to the statusline command on stdin at render time, then discards it. This script
# tees the live rate_limits (the true 5h/7d usage % + reset times) to a small cache
# file the widget reads, then reproduces the user's original statusline output so
# their status bar looks exactly the same.
#
# It is deliberately best-effort: any failure in the capture step must NEVER break
# the statusline.

$ErrorActionPreference = 'SilentlyContinue'

# Read all of stdin.
$raw = [Console]::In.ReadToEnd()
$j = $null
if ($raw) { try { $j = $raw | ConvertFrom-Json } catch { $j = $null } }

# --- Capture live rate limits (only overwrite when we actually have them) ---
try {
    if ($j -and $j.rate_limits) {
        $out = [ordered]@{
            capturedAt     = (Get-Date).ToUniversalTime().ToString("o")
            rate_limits    = $j.rate_limits
            context_window = $j.context_window
        }
        $path = Join-Path $env:USERPROFILE ".claude\cc-speedometer-live.json"
        $json = $out | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
    }
} catch { }

# --- Reproduce the original statusline output (dir | model | NN% ctx left) ---
$dir = '?'
if ($j -and $j.workspace -and $j.workspace.current_dir) { $dir = Split-Path $j.workspace.current_dir -Leaf }
elseif ($j -and $j.cwd) { $dir = Split-Path $j.cwd -Leaf }

$model = '?'
if ($j -and $j.model -and $j.model.display_name) { $model = $j.model.display_name }

$ctx = ''
if ($j -and $j.context_window) {
    $used = $j.context_window.used_percentage
    $rem = $j.context_window.remaining_percentage
    if ($rem -ne $null) { $ctx = [string][int][math]::Round($rem) + '% ctx left' }
    elseif ($used -ne $null) { $ctx = [string](100 - [int][math]::Round($used)) + '% ctx left' }
}

if ($ctx) { Write-Output ('{0} | {1} | {2}' -f $dir, $model, $ctx) }
else { Write-Output ('{0} | {1}' -f $dir, $model) }
