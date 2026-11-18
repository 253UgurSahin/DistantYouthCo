<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\ApiError;
use App\Http\Controllers\Controller;
use App\Http\Resources\ReleaseResource;
use App\Models\Release;
use App\Models\YoutubeUpload;
use App\Services\YoutubeApi;
use App\Support\Input;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/** Direct upload to YouTube (admin): connect the channel, upload a release piece by piece, its status. */
class YoutubeUploadController extends Controller
{
    public function __construct(private readonly YoutubeApi $yt) {}

    public function status(): JsonResponse
    {
        return response()->json(['youtube' => $this->yt->status()]);
    }

    /** The address of Google's consent screen, with a one-time state kept in this session. */
    public function connect(Request $request): JsonResponse
    {
        $state = Str::random(40);
        $request->session()->put('youtube_oauth', ['state' => $state, 'at' => time()]);

        return response()->json(['url' => $this->yt->authUrl($state)]);
    }

    /** Google sends the admin back here; the answer goes to Instellingen as a message. */
    public function callback(Request $request): RedirectResponse
    {
        $saved = $request->session()->pull('youtube_oauth');
        $back = fn (string $key, string $text) => redirect('/#/instellingen?'.http_build_query([$key => $text]));
        if (! is_array($saved) || ! hash_equals((string) $saved['state'], (string) $request->query('state')) || time() - $saved['at'] > 600) {
            return $back('youtube_error', 'Deze koppelpoging is verlopen of hoort niet bij deze sessie. Klik nog een keer op Koppel.');
        }
        if ($request->query('error')) {
            return $back('youtube_error', $request->query('error') === 'access_denied' ? 'Je gaf geen toestemming bij Google; er is niets gekoppeld.' : 'Google gaf een fout terug. Probeer het opnieuw.');
        }
        $code = $request->query('code');
        if (! is_string($code) || $code === '') {
            return $back('youtube_error', 'Google gaf geen code terug. Probeer het opnieuw.');
        }
        try {
            return $back('youtube', $this->yt->finishAuth($code));
        } catch (ApiError $e) {
            return $back('youtube_error', $e->getMessage());
        }
    }

    public function disconnect(): JsonResponse
    {
        $this->yt->disconnect();

        return response()->json(['ok' => true]);
    }

    private function release(string $id): Release
    {
        return Release::find(Input::id($id)) ?? throw ApiError::notFound('Release niet gevonden.');
    }

    public function show(string $id): JsonResponse
    {
        return response()->json(['upload' => YoutubeUpload::find($this->release($id)->id)?->toPublic()]);
    }

    public function start(Request $request, string $id): JsonResponse
    {
        $release = $this->release($id);
        $privacy = (string) $request->input('privacy', '');
        $publishAt = YoutubeApi::publishAt($request->input('publish_at'));
        if ($publishAt !== null) {
            $privacy = 'private'; // until that moment
        }
        $up = $this->yt->start($release, $privacy, $publishAt);

        return response()->json(['upload' => $up->toPublic()], 201);
    }

    public function step(string $id): JsonResponse
    {
        $release = $this->release($id);
        $up = YoutubeUpload::find($release->id) ?? throw ApiError::notFound('Er loopt geen upload voor deze release.');
        $up = $this->yt->step($release, $up);

        return response()->json(['upload' => $up->toPublic(), 'release' => $up->state === 'done' ? new ReleaseResource($release->fresh('folder')) : null]);
    }

    public function sync(string $id): JsonResponse
    {
        $release = $this->release($id);
        $out = $this->yt->sync($release);

        return response()->json($out + ['release' => new ReleaseResource($release->fresh('folder'))]);
    }
}
