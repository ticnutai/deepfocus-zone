$ErrorActionPreference = 'Stop'
$logPath = Join-Path $env:TEMP 'set-chrome-vscode-policy.log'

try {
	"START $(Get-Date -Format s)" | Out-File -FilePath $logPath -Encoding ASCII

	$policyValue = '[{"protocol":"vscode","allowed_origins":["https://vscode.dev","https://.vscode.dev","http://127.0.0.1:*","http://localhost:*"]}]'

	$args = @(
		'add',
		'HKLM\SOFTWARE\Policies\Google\Chrome',
		'/v',
		'AutoLaunchProtocolsFromOrigins',
		'/t',
		'REG_SZ',
		'/d',
		$policyValue,
		'/f'
	)

	$output = & reg.exe @args 2>&1
	if ($output) {
		Add-Content -Path $logPath -Value ($output -join [Environment]::NewLine)
	}

	if ($LASTEXITCODE -ne 0) {
		throw "reg.exe failed with exit code $LASTEXITCODE"
	}

	Add-Content -Path $logPath -Value 'SUCCESS'
	Add-Content -Path $logPath -Value $policyValue
	Write-Output 'Chrome policy updated successfully.'
}
catch {
	Add-Content -Path $logPath -Value "ERROR: $($_.Exception.Message)"
	throw
}
