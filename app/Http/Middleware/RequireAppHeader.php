<?php

namespace App\Http\Middleware;

use App\Exceptions\ApiError;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Every change through the API carries X-Requested-With: dyc. A form on another site cannot add that
 * header, so this blocks cross-site requests on top of the SameSite=Lax cookie. API answers are not cached.
 */
class RequireAppHeader
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! in_array($request->getRealMethod(), ['GET', 'HEAD', 'OPTIONS'], true) && $request->header('X-Requested-With') !== 'dyc') {
            throw new ApiError(403, 'Ongeldig verzoek');
        }
        $response = $next($request);
        $response->headers->set('Cache-Control', 'no-store');

        return $response;
    }
}
