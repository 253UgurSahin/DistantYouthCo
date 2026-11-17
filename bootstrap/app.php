<?php

use App\Exceptions\ApiError;
use App\Http\Middleware\EnsureAdmin;
use App\Http\Middleware\EnsureSignedIn;
use App\Http\Middleware\RequireAppHeader;
use App\Http\Middleware\SecureCookieOnHttps;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\StartSession;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Behind a proxy (Cloudflare, Nginx): the visitor's address is the one the proxy added.
        if (env('TRUST_PROXY')) {
            $middleware->trustProxies(at: '*');
        }
        $middleware->prepend(SecureCookieOnHttps::class);
        $middleware->append(SecurityHeaders::class);
        // The API shares the session cookie of the app (signing in) and needs the app's header for changes.
        $middleware->api(
            prepend: [EncryptCookies::class, AddQueuedCookiesToResponse::class, StartSession::class],
            append: [RequireAppHeader::class],
        );
        $middleware->alias(['signed.in' => EnsureSignedIn::class, 'admin' => EnsureAdmin::class]);
        // Passwords are never trimmed (a space at the end is part of it).
        $middleware->trimStrings(except: ['current', 'password']);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->dontReport(ApiError::class);
        $json = fn (string $message, int $status) => response()->json(['error' => $message], $status);
        $exceptions->render(fn (ApiError $e) => $json($e->getMessage(), $e->status));
        $exceptions->render(fn (NotFoundHttpException|MethodNotAllowedHttpException $e, Request $r) => $json($r->is('api/*') ? 'Onbekende API-route.' : 'Niet gevonden', 404));
        $exceptions->render(fn (PostTooLargeException $e) => $json('Te veel gegevens in één keer voor deze server (max '.ini_get('post_max_size').').', 413));
        $exceptions->render(function (Throwable $e, Request $r) use ($json) {
            if (config('app.debug') || ! ($r->is('api/*') || $r->is('media/*') || $r->is('downloads/*'))) {
                return null;
            }

            return $json('Er ging iets mis op de server.', 500);
        });
    })->create();
