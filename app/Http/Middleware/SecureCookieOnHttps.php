<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Over HTTPS the sign-in cookie is Secure, without a setting (it runs before the session starts). */
class SecureCookieOnHttps
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isSecure() && config('session.secure') === null) {
            config(['session.secure' => true]);
        }

        return $next($request);
    }
}
