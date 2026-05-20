# Test requests endpoint with all modes
$baseUrl = "http://localhost:3000/api"

# Login
$body = @{email="admin@volunteer.ua"; password="Password123!"} | ConvertTo-Json
$login = Invoke-RestMethod -Uri "$baseUrl/auth/login" -Method Post -Body $body -ContentType "application/json"
$token = $login.accessToken
Write-Host "Token: $token"

$headers = @{Authorization = "Bearer $token"}

# Test 1: Without lat/lng (simulates 'bounds' or 'all' mode)
Write-Host "`n=== Test 1: GET /requests without lat/lng ==="
try {
    $r = Invoke-RestMethod -Uri "$baseUrl/requests" -Headers $headers -Method Get
    Write-Host "OK: $($r.data.count) requests"
} catch {
    Write-Host "ERROR: $($_.Exception.Response.StatusCode.value__)"
    Write-Host $_.Exception.Message
}

# Test 2: With lat/lng (simulates 'radius' mode)
Write-Host "`n=== Test 2: GET /requests with lat=50.45&lng=30.52 ==="
try {
    $r = Invoke-RestMethod -Uri "$baseUrl/requests?latitude=50.45&longitude=30.52&radius=50000" -Headers $headers -Method Get
    Write-Host "OK: $($r.data.count) requests"
} catch {
    Write-Host "ERROR: $($_.Exception.Response.StatusCode.value__)"
    Write-Host $_.Exception.Message
}

# Test 3: With limit only (no location params)
Write-Host "`n=== Test 3: GET /requests?limit=5 ==="
try {
    $r = Invoke-RestMethod -Uri "$baseUrl/requests?limit=5" -Headers $headers -Method Get
    Write-Host "OK: $($r.data.count) requests"
} catch {
    Write-Host "ERROR: $($_.Exception.Response.StatusCode.value__)"
    Write-Host $_.Exception.Message
}