<?php

// A stand-in for Google's OAuth and the YouTube Data API, for the end-to-end tests only. Run it with
//   php -S 127.0.0.1:3299 tests/e2e/fake-google.php
// and point the test instance's .env at it (GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, GOOGLE_REVOKE_URL,
// YOUTUBE_API_URL, YOUTUBE_UPLOAD_URL). It keeps the bytes of each upload session in the temp dir.

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
$dir = sys_get_temp_dir().'/fake-google';
@mkdir($dir);
$json = function (array $body, int $status = 200, array $headers = []) {
    header('Content-Type: application/json');
    foreach ($headers as $k => $v) {
        header("$k: $v");
    }
    http_response_code($status); // after the headers: PHP turns a Location header into a 302 otherwise
    echo json_encode($body);
};

// The consent screen: "allow" at once, back to the app with a code.
if ($path === '/o/oauth2/v2/auth') {
    $to = $_GET['redirect_uri'].'?'.http_build_query(['code' => 'fake-code', 'state' => $_GET['state'] ?? '']);
    header("Location: $to", true, 302);

    return;
}
if ($path === '/token' && $method === 'POST') {
    if (($_POST['client_secret'] ?? '') === '') {
        $json(['error' => 'invalid_client'], 401);

        return;
    }
    // New random tokens each time, all starting with "stand-in-" so a test can look for them.
    $made = fn () => 'stand-in-'.bin2hex(random_bytes(8));
    $json(['access_token' => $made(), 'refresh_token' => $made(), 'expires_in' => 3600]);

    return;
}
if ($path === '/revoke') {
    $json([]);

    return;
}
if ($path === '/youtube/v3/channels') {
    $json(['items' => [['id' => 'UCfake', 'snippet' => ['title' => 'Fake Channel']]]]);

    return;
}
if ($path === '/upload/youtube/v3/videos' && $method === 'POST') {
    $id = bin2hex(random_bytes(4));
    file_put_contents("$dir/$id.size", $_SERVER['HTTP_X_UPLOAD_CONTENT_LENGTH'] ?? '0');
    file_put_contents("$dir/$id.got", '0');
    $json([], 200, ['Location' => "http://{$_SERVER['HTTP_HOST']}/upload/session/$id"]);

    return;
}
if (preg_match('#^/upload/session/(\w+)$#', $path, $m) && $method === 'PUT') {
    $id = $m[1];
    if (! is_file("$dir/$id.size")) {
        $json(['error' => ['code' => 404]], 404);

        return;
    }
    $size = (int) file_get_contents("$dir/$id.size");
    $got = (int) file_get_contents("$dir/$id.got");
    $range = $_SERVER['HTTP_CONTENT_RANGE'] ?? '';
    if (preg_match('#bytes (\d+)-(\d+)/(\d+)#', $range, $r)) {
        $body = file_get_contents('php://input');
        if ((int) $r[1] === $got && strlen($body) === (int) $r[2] - (int) $r[1] + 1) {
            $got = (int) $r[2] + 1;
            file_put_contents("$dir/$id.got", (string) $got);
        }
    }
    if ($got >= $size) {
        $json(['id' => 'FAKE'.$id], 201);

        return;
    }
    http_response_code(308);
    if ($got > 0) {
        header('Range: bytes=0-'.($got - 1));
    }

    return;
}
if ($path === '/upload/youtube/v3/thumbnails/set') {
    $json(['items' => [['default' => ['url' => 'x']]]]);

    return;
}
if ($path === '/youtube/v3/videos') {
    $json(['items' => [['id' => $_GET['id'] ?? '', 'status' => ['privacyStatus' => 'public', 'uploadStatus' => 'processed']]]]);

    return;
}
$json(['error' => ['message' => "fake-google: no route for $method $path"]], 404);
