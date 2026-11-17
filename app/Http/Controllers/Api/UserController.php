<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ApiError;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Accounts, for the admin. */
class UserController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(['users' => User::orderBy('id')->get()->map(fn (User $u) => [
            'id' => $u->id, 'username' => $u->username, 'role' => $u->role, 'created_at' => $u->created_at?->format('Y-m-d H:i:s'),
        ])]);
    }

    public function store(Request $request): JsonResponse
    {
        $username = $request->input('username');
        if ($err = User::credentialsError($username, $request->input('password'))) {
            throw ApiError::bad($err);
        }
        if (! in_array($request->input('role'), [User::ADMIN, User::LISTENER], true)) {
            throw ApiError::bad('Kies een rol.');
        }
        if (User::where('username', $username)->exists()) {
            throw ApiError::bad('Die gebruikersnaam bestaat al.');
        }
        $user = User::create($request->only('username', 'password', 'role'));

        return response()->json(['user' => AuthController::userJson($user)], 201);
    }

    /** A new password set by the admin signs that account out everywhere. */
    public function password(Request $request, string $id): JsonResponse
    {
        $user = User::find(Input::id($id)) ?? throw ApiError::notFound('Account niet gevonden.');
        if ($err = User::credentialsError($user->username, $request->input('password'))) {
            throw ApiError::bad($err);
        }
        $user->update(['password' => $request->input('password')]);
        DB::table('sessions')->where('user_id', $user->id)->delete();

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $id = Input::id($id);
        if ($id === $request->user()->id) {
            throw ApiError::bad('Je kunt je eigen account niet verwijderen.');
        }
        $user = User::find($id) ?? throw ApiError::notFound('Account niet gevonden.');
        $user->delete();
        DB::table('sessions')->where('user_id', $id)->delete();

        return response()->json(['ok' => true]);
    }
}
