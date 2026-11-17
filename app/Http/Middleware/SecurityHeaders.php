<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** The same strict headers on every answer: no outside scripts or styles; only YouTube's privacy player as a frame. */
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $h = $response->headers;
        $h->set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; frame-src https://www.youtube-nocookie.com; media-src 'self' blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        $h->set('X-Content-Type-Options', 'nosniff');
        $h->set('Referrer-Policy', 'same-origin');
        $h->set('X-Frame-Options', 'DENY');
        $h->set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        $h->set('Cross-Origin-Opener-Policy', 'same-origin');
        if ($request->isSecure()) {
            $h->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
        $h->remove('X-Powered-By');

        return $response;
    }
}
