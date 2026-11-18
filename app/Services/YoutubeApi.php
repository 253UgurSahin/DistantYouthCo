<?php

namespace App\Services;

use App\Exceptions\ApiError;
use App\Models\Release;
use App\Models\Setting;
use App\Models\YoutubeUpload;
use App\Support\Input;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Direct upload to YouTube with the artist's own channel: the OAuth connection (the refresh token
 * stays on the server, encrypted), the resumable upload sent one piece per request (so a shared
 * host's time limit never cuts it off, and a dropped connection resumes), the cover as thumbnail,
 * and the video's status. YouTube's rules are checked before anything is sent.
 */
class YoutubeApi
{
    public const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
    public const PRIVACY = ['private', 'unlisted', 'public'];
    private const MUSIC_CATEGORY = '10';
    private const MAX_TITLE = 100;
    private const MAX_DESCRIPTION_BYTES = 5000; // YouTube counts bytes: an emoji is 4
    private const MAX_TAGS = 500;
    private const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
    private const TOKEN_CACHE = 'youtube.access_token';

    private const REASONS = [
        'quotaExceeded' => 'Het dagelijkse YouTube-quotum van je Google-project is op. Na middernacht (Amerikaanse westkusttijd) kan het weer.',
        'uploadLimitExceeded' => 'Je kanaal heeft voor vandaag het maximale aantal uploads bereikt. Probeer het morgen opnieuw.',
        'rateLimitExceeded' => 'YouTube vindt dat er te snel achter elkaar wordt geüpload. Probeer het over een paar minuten opnieuw.',
        'youtubeSignupRequired' => 'Dit Google-account heeft nog geen YouTube-kanaal. Maak er eerst een aan op youtube.com.',
        'invalidTitle' => 'YouTube weigert de titel. Controleer hem in de YouTube-kit (max 100 tekens, geen < of >).',
        'invalidDescription' => 'YouTube weigert de beschrijving. Controleer hem in de YouTube-kit (max 5.000 bytes, geen < of >).',
        'invalidTags' => 'YouTube weigert de tags. Maak de lijst korter of haal vreemde tekens weg.',
        'invalidPublishAt' => 'YouTube weigert het publicatiemoment. Kies een tijd in de toekomst.',
        'forbidden' => 'YouTube gaf geen toestemming voor deze actie. Koppel je kanaal opnieuw bij Instellingen.',
        'insufficientPermissions' => 'De koppeling mist rechten. Koppel je kanaal opnieuw bij Instellingen en vink alles aan.',
        'authorizationRequired' => 'De koppeling met YouTube werkt niet meer. Koppel je kanaal opnieuw bij Instellingen.',
        'accessNotConfigured' => 'De YouTube Data API v3 staat nog niet aan in je Google Cloud-project. Zet hem aan en probeer het opnieuw.',
    ];

    private const THUMBNAIL_REASONS = [
        'forbidden' => 'Eigen thumbnails mogen pas als je kanaal geverifieerd is (met je telefoonnummer, op youtube.com/verify).',
        'invalidImage' => 'YouTube kan je cover niet als thumbnail gebruiken (kapot of onbekend beeldformaat).',
    ];

    // ---------- the connection ----------

    /** The OAuth client: the one saved in Instellingen, else the one from .env. */
    public function client(?array $s = null): array
    {
        $s ??= Setting::current();
        if ($s['youtube_client_id'] !== '' && $s['youtube_client_secret'] !== '') {
            return [$s['youtube_client_id'], $s['youtube_client_secret'], false];
        }

        return [(string) config('studio.youtube_client_id'), (string) config('studio.youtube_client_secret'), true];
    }

    public function redirectUri(): string
    {
        return url('/oauth/youtube/callback');
    }

    public function status(): array
    {
        $s = Setting::current();
        [$id, $secret, $fromEnv] = $this->client($s);

        return [
            'configured' => $id !== '' && $secret !== '',
            'from_env' => $fromEnv && $id !== '',
            'client_id' => $id,
            'connected' => $s['youtube_refresh_token'] !== '',
            'channel_title' => $s['youtube_channel_title'],
            'redirect_uri' => $this->redirectUri(),
            'default_privacy' => $s['youtube_default_privacy'],
            'ai_label' => $s['youtube_ai_label'] === '1',
        ];
    }

    public function authUrl(string $state): string
    {
        [$id, $secret] = $this->client();
        if ($id === '' || $secret === '') {
            throw new ApiError(409, 'Vul eerst de Client ID en het Client secret in en sla ze op.');
        }

        return config('studio.google_auth_url').'?'.http_build_query([
            'client_id' => $id,
            'redirect_uri' => $this->redirectUri(),
            'response_type' => 'code',
            'scope' => implode(' ', self::SCOPES),
            'access_type' => 'offline',
            'prompt' => 'consent',
            'include_granted_scopes' => 'true',
            'state' => $state,
        ]);
    }

    /** The code from Google's redirect: a lasting token on the server, and the channel's name. */
    public function finishAuth(string $code): string
    {
        $tokens = $this->tokenRequest(['grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => $this->redirectUri()]);
        if (empty($tokens['refresh_token'])) {
            throw new ApiError(502, 'Google gaf geen blijvende toegang terug. Probeer het opnieuw.');
        }
        $this->remember($tokens);
        $res = $this->send(fn () => $this->api()->withToken($tokens['access_token'])->get(config('studio.youtube_api_url').'/channels', ['part' => 'snippet', 'mine' => 'true']));
        if (! $res->successful()) {
            throw $this->googleError($res, 'Kon je kanaal niet lezen');
        }
        $channel = $res->json('items.0');
        if (! $channel) {
            throw new ApiError(400, self::REASONS['youtubeSignupRequired']);
        }
        $title = (string) ($channel['snippet']['title'] ?? 'je kanaal');
        Setting::put(['youtube_refresh_token' => $tokens['refresh_token'], 'youtube_channel_id' => (string) $channel['id'], 'youtube_channel_title' => $title]);

        return $title;
    }

    public function disconnect(): void
    {
        $token = Setting::current()['youtube_refresh_token'];
        if ($token !== '') {
            try {
                Http::asForm()->timeout(15)->post(config('studio.google_revoke_url'), ['token' => $token]);
            } catch (ConnectionException) {
                // Forgetting it here is what counts; the token is useless without the client secret.
            }
        }
        $this->forget();
    }

    public function forget(): void
    {
        Cache::forget(self::TOKEN_CACHE);
        Setting::put(['youtube_refresh_token' => '', 'youtube_channel_id' => '', 'youtube_channel_title' => '']);
    }

    private function tokenRequest(array $params): array
    {
        [$id, $secret] = $this->client();
        $res = $this->send(fn () => Http::asForm()->acceptJson()->timeout(30)->post(config('studio.google_token_url'), $params + ['client_id' => $id, 'client_secret' => $secret]));
        if ($res->successful()) {
            return (array) $res->json();
        }
        $error = (string) $res->json('error');

        throw match ($error) {
            'invalid_grant' => new ApiError(409, 'De koppeling met YouTube is verlopen of ingetrokken. Koppel je kanaal opnieuw bij Instellingen.'),
            'invalid_client', 'unauthorized_client' => new ApiError(409, 'Google kent deze Client ID of dit Client secret niet. Controleer ze bij Instellingen.'),
            'redirect_uri_mismatch' => new ApiError(409, 'De omleidings-URI klopt niet. Zet hem precies zoals bij Instellingen staat in je Google OAuth-client.'),
            default => new ApiError(502, 'Google weigerde de aanvraag ('.mb_substr($error !== '' ? $error : (string) $res->status(), 0, 60).').'),
        };
    }

    private function remember(array $tokens): void
    {
        Cache::put(self::TOKEN_CACHE, $tokens['access_token'], max(60, (int) ($tokens['expires_in'] ?? 3600) - 120));
    }

    private function accessToken(): string
    {
        $refresh = Setting::current()['youtube_refresh_token'];
        if ($refresh === '') {
            throw new ApiError(409, 'Je YouTube-kanaal is niet gekoppeld. Koppel het bij Instellingen.');
        }
        if ($token = Cache::get(self::TOKEN_CACHE)) {
            return $token;
        }
        try {
            $tokens = $this->tokenRequest(['grant_type' => 'refresh_token', 'refresh_token' => $refresh]);
        } catch (ApiError $e) {
            if (str_contains($e->getMessage(), 'verlopen of ingetrokken')) {
                $this->forget();
            }
            throw $e;
        }
        $this->remember($tokens);

        return $tokens['access_token'];
    }

    private function api(): PendingRequest
    {
        return Http::acceptJson()->timeout(60)->withOptions(['allow_redirects' => false]);
    }

    /** One call to Google; a network failure becomes a clear message. */
    private function send(callable $call): Response
    {
        try {
            return $call();
        } catch (ConnectionException) {
            throw new ApiError(502, 'Kan YouTube niet bereiken (netwerk). Probeer het zo opnieuw.');
        }
    }

    private function googleError(Response $res, string $what, array $reasons = self::REASONS): ApiError
    {
        $reason = (string) ($res->json('error.errors.0.reason') ?? $res->json('error.status') ?? '');
        $known = $reasons[$reason] ?? self::REASONS[$reason] ?? null;
        $status = $res->status() === 429 || in_array($reason, ['quotaExceeded', 'rateLimitExceeded'], true) ? 429 : 502;

        return new ApiError($status, $known ?? "$what (YouTube: ".($reason !== '' ? $reason : $res->status()).').');
    }

    // ---------- the video ----------

    /** The kit keeps tags comma-separated; YouTube wants a list, without doubles or < > " ,. */
    public static function tagsForApi(?string $field): array
    {
        $tags = [];
        foreach (explode(',', (string) $field) as $t) {
            $t = trim(str_replace(['<', '>', '"'], '', $t));
            if ($t !== '' && ! in_array($t, $tags, true)) {
                $tags[] = $t;
            }
        }

        return $tags;
    }

    /** How YouTube counts the tag list: commas between, and a tag with a space as if it had quotes. */
    public static function tagsLength(array $tags): int
    {
        $n = 0;
        foreach ($tags as $i => $t) {
            $n += mb_strlen($t) + (preg_match('/\s/u', $t) ? 2 : 0) + ($i ? 1 : 0);
        }

        return $n;
    }

    /**
     * The video as YouTube wants it, from the kit's texts, checked against YouTube's rules first: a
     * clear message now instead of a refusal after the whole MP4. Returns [resource, warnings].
     */
    public static function resource(Release $r, string $privacy, ?string $publishAt, bool $aiLabel): array
    {
        $problems = [];
        $title = trim((string) $r->yt_title);
        $description = (string) $r->yt_description;
        if ($title === '') {
            $problems[] = 'Geef de video eerst een titel in de YouTube-kit.';
        }
        if (mb_strlen($title) > self::MAX_TITLE) {
            $problems[] = 'De titel is te lang voor YouTube (max 100 tekens).';
        }
        if (strlen($description) > self::MAX_DESCRIPTION_BYTES) {
            $problems[] = 'De beschrijving is te lang voor YouTube (max 5.000 bytes; een emoji telt als 4).';
        }
        if (preg_match('/[<>]/', $title.$description)) {
            $problems[] = 'YouTube staat de tekens < en > niet toe in de titel en de beschrijving.';
        }
        if (! in_array($privacy, self::PRIVACY, true)) {
            $problems[] = 'Kies of de video privé, verborgen of openbaar wordt.';
        }
        if ($publishAt !== null && $privacy !== 'private') {
            $problems[] = 'Een ingeplande video moet tot dat moment privé zijn.';
        }
        if ($problems) {
            throw ApiError::bad(implode(' ', $problems));
        }
        $tags = self::tagsForApi($r->yt_tags);
        $dropped = 0;
        while ($tags && self::tagsLength($tags) > self::MAX_TAGS) {
            array_pop($tags);
            $dropped++;
        }
        $warnings = $dropped ? [$dropped.' '.($dropped === 1 ? 'tag is' : 'tags zijn').' weggelaten: zo past de lijst in de 500 tekens van YouTube (een tag met een spatie telt met aanhalingstekens).'] : [];
        $status = ['privacyStatus' => $privacy, 'selfDeclaredMadeForKids' => false, 'containsSyntheticMedia' => $aiLabel, 'embeddable' => true];
        if ($publishAt !== null) {
            $status['publishAt'] = $publishAt;
        }

        return [['snippet' => ['title' => $title, 'description' => $description, 'tags' => $tags, 'categoryId' => self::MUSIC_CATEGORY], 'status' => $status], $warnings];
    }

    /** "2026-12-01T20:00" in Amsterdam time (what the form gives) -> RFC 3339 in UTC, in the future. */
    public static function publishAt(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        try {
            $t = new \DateTimeImmutable(is_string($v) ? $v : '', new \DateTimeZone('Europe/Amsterdam'));
        } catch (\Exception) {
            throw ApiError::bad('Kies een geldig moment om live te gaan.');
        }
        if ($t <= new \DateTimeImmutable('+5 minutes')) {
            throw ApiError::bad('Kies een moment in de toekomst (minstens een paar minuten vanaf nu).');
        }

        return $t->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
    }

    /** Opens an upload session at YouTube for the release's MP4. */
    public function start(Release $release, string $privacy, ?string $publishAt): YoutubeUpload
    {
        $current = YoutubeUpload::find($release->id);
        if ($current?->isActive() && $current->updated_at > now()->subHours(6)) {
            throw new ApiError(409, 'Deze release wordt al geüpload. Wacht tot hij klaar is, of laat hem verder gaan.');
        }
        $token = $this->accessToken();
        $file = $release->filePath('video');
        if (! $file) {
            throw ApiError::bad('Deze release heeft nog geen MP4. Upload eerst een video bij de release.');
        }
        [$resource, $warnings] = self::resource($release, $privacy, $publishAt, Setting::current()['youtube_ai_label'] === '1');
        $size = (int) filesize($file);
        $res = $this->send(fn () => $this->api()->withToken($token)
            ->withHeaders(['X-Upload-Content-Length' => (string) $size, 'X-Upload-Content-Type' => 'video/mp4'])
            ->post(config('studio.youtube_upload_url').'/videos?uploadType=resumable&part=snippet,status', $resource));
        if (! $res->successful() || ! $res->header('Location')) {
            throw $this->googleError($res, 'YouTube wilde de upload niet starten');
        }
        YoutubeUpload::where('release_id', $release->id)->delete();

        return YoutubeUpload::create([
            'release_id' => $release->id, 'session_url' => $res->header('Location'), 'size' => $size, 'sent' => 0,
            'state' => 'uploading', 'privacy' => $privacy, 'publish_at' => $publishAt, 'warnings' => $warnings,
        ]);
    }

    /**
     * One step: the next piece of the video, or after the last piece the thumbnail. A dropped
     * connection or a hiccup at YouTube keeps the upload where it was (the next step asks YouTube how
     * far it got); a refusal ends it with the reason.
     */
    public function step(Release $release, YoutubeUpload $up): YoutubeUpload
    {
        if (! $up->isActive()) {
            return $up;
        }
        Input::moreTime(300);
        $lock = cache()->lock("youtube-upload-{$release->id}", 300);
        if (! $lock->get()) {
            return $up; // another step of this upload is on its way
        }
        try {
            $up->refresh();
            if ($up->state === 'uploading') {
                $this->sendPiece($release, $up);
            }
            if ($up->state === 'thumbnail') {
                $this->thumbnail($release, $up);
            }
        } finally {
            $lock->release();
        }

        return $up;
    }

    private function sendPiece(Release $release, YoutubeUpload $up): void
    {
        $token = $this->accessToken();
        // After a step that went wrong, ask YouTube how much it has before sending more.
        if ($up->error !== null) {
            $res = $this->send(fn () => $this->api()->withToken($token)->withHeaders(['Content-Range' => "bytes */{$up->size}"])->withBody('', 'video/mp4')->put($up->session_url));
            if (! $this->handlePieceAnswer($release, $up, $res)) {
                return;
            }
            if ($up->state !== 'uploading') {
                return;
            }
        }
        $file = $release->filePath('video');
        if (! $file || filesize($file) !== $up->size) {
            $this->fail($up, 'De video is tijdens het uploaden veranderd of weggehaald. Start de upload opnieuw.');

            return;
        }
        $length = min((int) config('studio.youtube_chunk'), $up->size - $up->sent);
        $f = fopen($file, 'rb');
        fseek($f, $up->sent);
        $bytes = (string) fread($f, $length);
        fclose($f);
        $end = $up->sent + strlen($bytes) - 1;
        try {
            $res = $this->api()->timeout(240)->withToken($token)->withHeaders(['Content-Range' => "bytes {$up->sent}-{$end}/{$up->size}"])
                ->withBody($bytes, 'video/mp4')->put($up->session_url);
        } catch (ConnectionException) {
            $up->forceFill(['error' => 'De verbinding met YouTube viel even weg; de upload gaat verder.'])->save();

            return;
        }
        $this->handlePieceAnswer($release, $up, $res);
    }

    /** YouTube's answer to a piece: more wanted (308), done (200/201), gone (404/410), or a refusal. */
    private function handlePieceAnswer(Release $release, YoutubeUpload $up, Response $res): bool
    {
        if ($res->status() === 308) {
            $range = (string) $res->header('Range'); // "bytes=0-1234": what YouTube has
            $sent = preg_match('/bytes=0-(\d+)/', $range, $m) ? (int) $m[1] + 1 : 0;
            $up->forceFill(['sent' => $sent, 'error' => null])->save();

            return true;
        }
        if (in_array($res->status(), [200, 201], true) && $res->json('id')) {
            $id = (string) $res->json('id');
            $up->forceFill(['sent' => $up->size, 'video_id' => $id, 'state' => 'thumbnail', 'error' => null])->save();
            $release->forceFill([
                'youtube_video_id' => $id,
                'youtube_url' => "https://youtu.be/$id",
                'youtube_privacy' => $up->privacy,
                'youtube_publish_at' => $up->publish_at,
                'on_youtube' => $up->privacy === 'public',
                'version' => (int) $release->version + 1,
            ])->save();

            return true;
        }
        if (in_array($res->status(), [404, 410], true)) {
            $this->fail($up, 'De uploadsessie bij YouTube is verlopen. Start de upload opnieuw.');

            return false;
        }
        if ($res->status() === 401) {
            Cache::forget(self::TOKEN_CACHE); // the hour of the access token ran out mid-upload: a new one next step
            $up->forceFill(['error' => 'De toegang moest even vernieuwd worden; de upload gaat verder.'])->save();

            return false;
        }
        if ($res->status() >= 500) {
            $up->forceFill(['error' => 'YouTube had even een storing; de upload gaat verder.'])->save();

            return false;
        }
        $this->fail($up, $this->googleError($res, 'YouTube weigerde de upload')->getMessage());

        return false;
    }

    private function thumbnail(Release $release, YoutubeUpload $up): void
    {
        $cover = $release->filePath('cover');
        $warnings = $up->warnings ?? [];
        if ($cover && filesize($cover) <= self::MAX_THUMBNAIL_BYTES && in_array(strtolower(pathinfo($cover, PATHINFO_EXTENSION)), ['jpg', 'png'], true)) {
            $type = str_ends_with(strtolower($cover), '.png') ? 'image/png' : 'image/jpeg';
            try {
                $res = $this->api()->withToken($this->accessToken())->withBody((string) file_get_contents($cover), $type)
                    ->post(config('studio.youtube_upload_url').'/thumbnails/set?videoId='.rawurlencode($up->video_id));
                if (! $res->successful()) {
                    $warnings[] = 'De video staat erop, maar zonder je cover: '.$this->googleError($res, 'de thumbnail werd geweigerd', self::THUMBNAIL_REASONS)->getMessage();
                }
            } catch (ConnectionException) {
                $warnings[] = 'De video staat erop, maar de cover kon niet als thumbnail mee (netwerk). Zet hem in YouTube Studio.';
            }
        } elseif ($cover) {
            $warnings[] = 'Je cover is geen JPG of PNG van maximaal 2 MB: YouTube kiest zelf een thumbnail. Zet hem in YouTube Studio.';
        }
        $up->forceFill(['state' => 'done', 'warnings' => $warnings, 'session_url' => null])->save();
    }

    private function fail(YoutubeUpload $up, string $message): void
    {
        $up->forceFill(['state' => 'failed', 'error' => $message, 'session_url' => null])->save();
    }

    /** The video's status at YouTube now: public turns the moon full; gone takes the link away. */
    public function sync(Release $release): array
    {
        if (! $release->youtube_video_id) {
            throw ApiError::bad('Deze release is niet via de app op YouTube gezet.');
        }
        $token = $this->accessToken();
        $res = $this->send(fn () => $this->api()->withToken($token)->get(config('studio.youtube_api_url').'/videos', ['part' => 'status', 'id' => $release->youtube_video_id]));
        if (! $res->successful()) {
            throw $this->googleError($res, 'Kon de status van je video niet ophalen');
        }
        $item = $res->json('items.0');
        if (! $item) {
            $release->forceFill(['youtube_video_id' => null, 'youtube_url' => '', 'youtube_privacy' => null, 'youtube_publish_at' => null, 'on_youtube' => false, 'version' => (int) $release->version + 1])->save();

            return ['gone' => true];
        }
        $privacy = (string) ($item['status']['privacyStatus'] ?? $release->youtube_privacy);
        $release->forceFill([
            'youtube_privacy' => $privacy,
            'youtube_publish_at' => $item['status']['publishAt'] ?? null,
            'on_youtube' => $privacy === 'public',
            'version' => (int) $release->version + 1,
        ])->save();

        return ['gone' => false, 'privacy' => $privacy, 'upload_status' => $item['status']['uploadStatus'] ?? null];
    }
}
