# 가계부 전용 파워쉘 웹 서버 (호환성 개선)
$port = 3000
$listener = New-Object System.Net.HttpListener

# 여러 로컬 주소 지원
try {
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Prefixes.Add("http://127.0.0.1:$port/")
} catch {}

try {
    $listener.Start()
    Write-Host "🚀 가계부 로컬 서버가 시작되었습니다! (포트: $port)" -ForegroundColor Cyan
    Write-Host "-------------------------------------------"
    Write-Host "접속 주소: http://localhost:$port"
    Write-Host "⚠️ 이 창을 닫으면 가계부 DB 연결이 끊어집니다." -ForegroundColor Yellow
    Write-Host "-------------------------------------------"
} catch {
    Write-Host "❌ 서버 시작 실패: $_" -ForegroundColor Red
    if ($_.Exception.Message -match "Access is denied") {
         Write-Host "권한 문제: 관리자 권한으로 실행하거나 포트를 바꿔야 할 수 있습니다." -ForegroundColor Yellow
    }
    pause
    exit
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $urlPath = $request.Url.LocalPath
        if ($urlPath -eq "/") { $urlPath = "/index.html" }
        
        $localPath = Join-Path $PSScriptRoot $urlPath.Replace("/", "\").TrimStart("\")

        if (Test-Path $localPath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($localPath).ToLower()
            $contentType = switch ($ext) {
                ".html" { "text/html; charset=utf-8" }
                ".css"  { "text/css; charset=utf-8" }
                ".js"   { "application/javascript; charset=utf-8" }
                ".json" { "application/json; charset=utf-8" }
                ".png"  { "image/png" }
                ".jpg"  { "image/jpeg" }
                ".jpeg" { "image/jpeg" }
                ".svg"  { "image/svg+xml" }
                default { "application/octet-stream" }
            }

            $content = [System.IO.File]::ReadAllBytes($localPath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $content.Length
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
        }
    } catch {
        # Silent fail on single requests
    } finally {
        if ($null -ne $response) { $response.Close() }
    }
}
