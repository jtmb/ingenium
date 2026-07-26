[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$DashboardPort = 3000,

    [ValidateRange(1, 65535)]
    [int]$ApiPort = 4097,

    [ValidateRange(1, 30)]
    [int]$TimeoutSeconds = 5
)

function Invoke-GatewayProbe {
    param(
        [Parameter(Mandatory = $true)] [string] $Name,
        [Parameter(Mandatory = $true)] [string] $Uri,
        [string] $HostHeader
    )

    $request = $null
    $response = $null
    try {
        $request = [System.Net.WebRequest]::Create($Uri)
        $request.Method = "GET"
        $request.AllowAutoRedirect = $false
        $request.Proxy = $null
        if ($HostHeader) {
            $request.Host = $HostHeader
        }
        $response = $request.GetResponse()
    } catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if (-not $response) {
            return [PSCustomObject]@{
                Name = $Name
                Uri = $Uri
                Host = $HostHeader
                Status = $null
                Server = $null
                Authentication = $null
                Error = $_.Exception.GetBaseException().Message
            }
        }
    } catch {
        return [PSCustomObject]@{
            Name = $Name
            Uri = $Uri
            Host = $HostHeader
            Status = $null
            Server = $null
            Authentication = $null
            Error = $_.Exception.GetBaseException().Message
        }
    }

    try {
        return [PSCustomObject]@{
            Name = $Name
            Uri = $Uri
            Host = $HostHeader
            Status = [int]$response.StatusCode
            Server = $response.Headers["Server"]
            Authentication = $response.Headers["WWW-Authenticate"]
            Error = $null
        }
    } finally {
        if ($response) {
            $response.Close()
        }
    }
}

function Get-WslLoopbackApiStatus {
    param(
        [Parameter(Mandatory = $true)] [int] $Port
    )

    # Docker binds 4097 to the Linux loopback interface. Some Windows↔WSL
    # forwarding configurations intentionally do not expose that listener to
    # native Windows localhost, so verify the bearer boundary in its owning
    # WSL network namespace without publishing or forwarding the port.
    $status = & wsl.exe --exec /usr/bin/curl --silent --output /dev/null --write-out "%{http_code}" --max-time 5 "http://127.0.0.1:$Port/api/v1/health"
    if ($LASTEXITCODE -ne 0 -or $status -notmatch '^\d{3}$') {
        return $null
    }

    return [int]$status
}

$probes = @(
    @{ Name = "dashboard-ipv4"; Uri = "http://127.0.0.1:$DashboardPort/tasks"; HostHeader = "localhost:$DashboardPort" },
    @{ Name = "dashboard-ipv6"; Uri = "http://[::1]:$DashboardPort/tasks"; HostHeader = "localhost:$DashboardPort" },
    @{ Name = "dashboard-forwarded-host"; Uri = "http://127.0.0.1:$DashboardPort/tasks"; HostHeader = "host.docker.internal:$DashboardPort" },
    @{ Name = "dashboard-api-same-origin"; Uri = "http://127.0.0.1:$DashboardPort/api/v1/projects"; HostHeader = "localhost:$DashboardPort" },
    @{ Name = "opencode-web-root"; Uri = "http://opencode.localhost:$DashboardPort/"; HostHeader = $null },
    @{ Name = "opencode-cli-root"; Uri = "http://cli.localhost:$DashboardPort/"; HostHeader = $null }
)

$results = foreach ($probe in $probes) {
    Invoke-GatewayProbe @probe
}
$results | Format-Table -AutoSize

$failures = @($results | Where-Object { $_.Status -ne 200 -or $_.Authentication })
if ($failures.Count -gt 0) {
    Write-Error "Expected HTTP 200 without a Basic-auth challenge for every Windows gateway probe. Rebuild with docker compose up --build -d, then investigate the listed transport errors without exposing private ports."
    exit 1
}

$privatePortResults = foreach ($port in 4098, 4099) {
    Invoke-GatewayProbe -Name "private-port-$port" -Uri "http://127.0.0.1:$port/" -HostHeader $null
}
$privatePortResults | Format-Table -AutoSize

$exposedPrivatePorts = @($privatePortResults | Where-Object { $null -ne $_.Status })
if ($exposedPrivatePorts.Count -gt 0) {
    Write-Error "An internal OpenCode port returned an HTTP response on Windows localhost. Remove its host publication instead of bypassing the local gateway."
    exit 1
}

$apiBoundary = Invoke-GatewayProbe -Name "api-boundary-without-bearer" -Uri "http://127.0.0.1:$ApiPort/api/v1/health" -HostHeader $null
$apiBoundary | Format-Table -AutoSize
$apiBoundaryStatus = $apiBoundary.Status
if ($null -eq $apiBoundaryStatus) {
    $apiBoundaryStatus = Get-WslLoopbackApiStatus -Port $ApiPort
    Write-Output "Native Windows localhost did not expose the Linux-loopback API boundary; verified its WSL loopback response instead."
}
if ($apiBoundaryStatus -ne 401) {
    Write-Error "Expected HTTP 401 from the loopback API boundary without a bearer token."
    exit 1
}

Write-Output "Windows IPv4/IPv6, forwarded-host, same-origin API, and OpenCode gateway probes returned 200 with no Basic-auth challenge."
Write-Output "The bearer-less API boundary returned 401 and OpenCode upstream ports remain unexposed. This verifier does not create a network listener, forwarding rule, firewall exception, or send credentials."
