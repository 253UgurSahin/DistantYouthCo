<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ApiError;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;

/** The session: who is signed in, the first account, signing in and out, your own password. */
class AuthController extends Controller
{
    /** Failed attempts per address: 20 in 15 minutes, then a pause. */
    private const MAX_FAILED = 20;
    private const WINDOW = 900;

    public function session(Request $request): JsonResponse
    {
        return response()->json([
            'user' => self::userJson($request->user()),
            'needsSetup' => User::count() === 0,
            'version' => config('studio.version'),
            'upload_chunk' => Input::uploadChunk(),
        ]);
    }

    public function setup(Request $request): JsonResponse
    {
        // One at a time, so two visitors of a fresh install can never both become the admin.
        return Cache::lock('studio-setup', 30)->block(10, fn () => $this->guarded($request, function () use ($request) {
            if (User::exists()) {
                throw new ApiError(403, 'De admin bestaat al.');
            }
            $username = $request->input('username');
            $password = $request->input('password');
            if ($err = User::credentialsError($username, $password)) {
                throw ApiError::bad($err);
            }
            $user = User::create(['username' => $username, 'password' => $password, 'role' => User::ADMIN]);
            $this->signIn($request, $user);

            return response()->json(['user' => self::userJson($user)], 201);
        }));
    }

    public function login(Request $request): JsonResponse
    {
        return $this->guarded($request, function () use ($request) {
            $username = $request->input('username');
            $password = $request->input('password');
            if (! is_string($username) || ! is_string($password)) {
                throw ApiError::bad('Vul je gebruikersnaam en wachtwoord in.');
            }
            $user = User::where('username', $username)->first();
            if (! $user || ! Hash::check($password, $user->password)) {
                throw new ApiError(401, 'Gebruikersnaam of wachtwoord klopt niet.');
            }
            $this->signIn($request, $user);

            return response()->json(['user' => self::userJson($user)]);
        });
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['ok' => true]);
    }

    public function password(Request $request): JsonResponse
    {
        $user = $request->user();
        $current = $request->input('current');
        if (! is_string($current) || ! Hash::check($current, $user->password)) {
            throw ApiError::bad('Je huidige wachtwoord klopt niet.');
        }
        if ($err = User::credentialsError($user->username, $request->input('password'))) {
            throw ApiError::bad($err);
        }
        $user->update(['password' => $request->input('password')]);
        // Signed out everywhere else (a lost phone), not here.
        DB::table('sessions')->where('user_id', $user->id)->where('id', '!=', $request->session()->getId())->delete();

        return response()->json(['ok' => true]);
    }

    public static function userJson(?User $u): ?array
    {
        return $u ? ['id' => $u->id, 'username' => $u->username, 'role' => $u->role] : null;
    }

    private function signIn(Request $request, User $user): void
    {
        Auth::guard('web')->login($user);
        $request->session()->regenerate(); // a new session id: no fixation
    }

    /** Runs a sign-in step under the rate limit: only failures count. */
    private function guarded(Request $request, callable $step): JsonResponse
    {
        $key = 'login|'.$request->ip();
        if (RateLimiter::tooManyAttempts($key, self::MAX_FAILED)) {
            throw new ApiError(429, 'Te veel pogingen, probeer het later opnieuw.');
        }
        try {
            return $step();
        } catch (ApiError $e) {
            RateLimiter::hit($key, self::WINDOW);
            throw $e;
        }
    }
}
