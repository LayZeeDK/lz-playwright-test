# Serves Stryker's kept sandbox of the demo app and drives it with playwright-cli, once without a mutant and once
# per mutant below, each in its own browser session with the mutant set by an init script before the app loads.
# Exit 0 when every observation matches its expectation; the expectations were written before the first run.
param(
  [Parameter(Mandatory)] [string] $Sandbox,
  [int] $Port = 4700
)

$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'out'
New-Item -ItemType Directory -Force $out | Out-Null
$url = "http://127.0.0.1:$Port/"

# Each row: mutant id ('' for none), what it changes (from the e2e-ui report), and the expected page.
$cases = @(
  @{ id = ''; what = 'no mutant'; dts = 'Subtotal|Shipping|Total'; labels = 'Mug|Poster|Discount code'; code = '' },
  @{ id = '23'; what = 'LzTextLiteral empties <dt>Subtotal</dt> (survived)'; dts = '|Shipping|Total'; labels = 'Mug|Poster|Discount code'; code = '' },
  @{ id = '16'; what = 'LzChildExpression nulls {line.name} in the line label (survived)'; dts = 'Subtotal|Shipping|Total'; labels = '||Discount code'; code = '' },
  @{ id = '6'; what = "StringLiteral sets useState('') to 'Stryker was here!' (survived)"; dts = 'Subtotal|Shipping|Total'; labels = 'Mug|Poster|Discount code'; code = 'Stryker was here!' }
)

$vite = Start-Process -FilePath node -ArgumentList 'node_modules/vite/bin/vite.js', '--config', 'apps/demo-app/vite.config.mts', '--port', "$Port", '--strictPort', '--host', '127.0.0.1' `
  -WorkingDirectory $Sandbox -PassThru -WindowStyle Hidden -RedirectStandardOutput "$out/vite.out" -RedirectStandardError "$out/vite.err"
"vite pid $($vite.Id)"
$failed = 0

try {
  $ready = $false

  for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 5 | Out-Null
      $ready = $true
    } catch {
      Start-Sleep 1
    }
  }

  if (-not $ready) {
    throw "vite did not answer on $url"
  }

  foreach ($case in $cases) {
    $name = if ($case.id) { "m$($case.id)" } else { 'none' }
    $init = if ($case.id) { "await page.context().addInitScript(() => { globalThis.__stryker__ = { activeMutant: '$($case.id)' }; });" } else { '' }
    $probe = "$out/probe-$name.js"
    Set-Content -Encoding utf8 $probe @"
async page => {
  $init
  await page.goto('$url');
  await page.getByRole('heading', { name: 'Cart' }).waitFor();
  const text = (sel) => page.locator(sel).evaluateAll((els) => els.map((e) => e.childNodes[0]?.textContent?.trim() ?? ''));
  const dts = await page.locator('dt').allTextContents();
  const labels = await text('label');
  const code = await page.locator('label', { hasText: 'Discount code' }).locator('input').inputValue();
  return JSON.stringify({ dts: dts.join('|'), labels: labels.join('|'), code });
}
"@
    $session = "live-$name"
    playwright-cli "-s=$session" open about:blank | Out-Null
    $raw = (playwright-cli "-s=$session" run-code "--filename=$probe") -join "`n"
    playwright-cli "-s=$session" screenshot "--filename=$out/$name.png" | Out-Null
    playwright-cli "-s=$session" close | Out-Null
    Set-Content -Encoding utf8 "$out/$name.txt" $raw
    $json = [regex]::Match($raw, '\{\\?"dts.*?\}').Value -replace '\\"', '"'
    $seen = $json | ConvertFrom-Json
    $ok = ($seen.dts -eq $case.dts) -and ($seen.labels -eq $case.labels) -and ($seen.code -eq $case.code)

    if (-not $ok) {
      $failed++
    }

    '{0} {1}: {2}; saw dts [{3}] labels [{4}] code [{5}]' -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $name, $case.what, $seen.dts, $seen.labels, $seen.code
  }
} finally {
  Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep 1
  'port {0} listening after stop: {1}' -f $Port, (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count
}

exit $failed
