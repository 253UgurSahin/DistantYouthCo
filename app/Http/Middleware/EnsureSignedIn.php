<?php

namespace App\Http\Middleware;

use App\Exceptions\ApiError;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureSignedIn
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user()) {
            throw new ApiError(401, 'Niet ingelogd');
        }

        return $next($request);
    }
}
