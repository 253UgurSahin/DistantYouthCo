<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ApiError;
use App\Http\Controllers\Controller;
use App\Services\Stats;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** "De stand van de nacht", over the releases this user may see. */
class StatsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $m = $request->query('months', '12');
        $months = is_string($m) && preg_match('/^\d+$/', $m) ? (int) $m : -1;
        if (! in_array($months, Stats::PERIODS, true)) {
            throw ApiError::bad('Kies een periode van '.implode(', ', Stats::PERIODS).' maanden.');
        }

        return response()->json(Stats::compute(ReleaseController::visible($request)->get(), $months, $request->user()->isAdmin()));
    }
}
