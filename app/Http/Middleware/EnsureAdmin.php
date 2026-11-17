<?php

namespace App\Http\Middleware;

use App\Exceptions\ApiError;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user()) {
            throw new ApiError(401, 'Niet ingelogd');
        }
        if (! $request->user()->isAdmin()) {
            throw new ApiError(403, 'Alleen voor admin');
        }

        return $next($request);
    }
}
