<?php
/**
 * Forwards /plug-dj-bridge/proxy.php/<path> → http://127.0.0.1:3000/<path>
 * Used when ngrok points at Apache :80 instead of Node :3000.
 */
declare(strict_types=1);

// CORS preflight (ngrok / mixed tools)
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, Bypass-Tunnel-Reminder');
    header('Access-Control-Max-Age: 86400');
    http_response_code(204);
    exit;
}


$targetBase = 'http://127.0.0.1:3000';

$uri = $_SERVER['REQUEST_URI'] ?? '/';
$prefix = '/plug-dj-bridge/proxy.php';
$path = $uri;
if (str_starts_with($path, $prefix)) {
    $path = substr($path, strlen($prefix)) ?: '/';
}
// PATH_INFO style: /plug-dj-bridge/proxy.php/api/rooms/...
if (!empty($_SERVER['PATH_INFO'])) {
    $path = $_SERVER['PATH_INFO'];
}
if ($path === '' || $path[0] !== '/') {
    $path = '/' . $path;
}

// Only proxy API (and health). Never proxy arbitrary paths.
if (!preg_match('#^/api(/|$)#', $path)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'Bridge only proxies /api/*']);
    exit;
}

$url = $targetBase . $path;
if (!empty($_SERVER['QUERY_STRING'])) {
    $url .= '?' . $_SERVER['QUERY_STRING'];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = file_get_contents('php://input');

$headers = [];
foreach ($_SERVER as $key => $value) {
    if (str_starts_with($key, 'HTTP_')) {
        $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($key, 5)))));
        if (in_array(strtolower($name), ['host', 'content-length', 'connection'], true)) {
            continue;
        }
        $headers[] = $name . ': ' . $value;
    }
}
if (isset($_SERVER['CONTENT_TYPE'])) {
    $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_POSTFIELDS => ($method === 'GET' || $method === 'HEAD') ? null : $body,
    CURLOPT_TIMEOUT => 30,
]);

$response = curl_exec($ch);
if ($response === false) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => 'Bridge could not reach Node on :3000. Is npm run dev running?']);
    exit;
}

$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$rawHeaders = substr($response, 0, $headerSize);
$rawBody = substr($response, $headerSize);
curl_close($ch);

http_response_code($status);
foreach (explode("\r\n", $rawHeaders) as $line) {
    if ($line === '' || stripos($line, 'HTTP/') === 0) continue;
    if (stripos($line, 'Transfer-Encoding:') === 0) continue;
    if (stripos($line, 'Connection:') === 0) continue;
    header($line, false);
}
header('Access-Control-Allow-Origin: *');
echo $rawBody;
