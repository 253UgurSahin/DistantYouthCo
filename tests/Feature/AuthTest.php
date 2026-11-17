<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AuthTest extends TestCase
{
    public function test_the_first_visit_asks_for_the_admin_and_setup_works_once(): void
    {
        $this->getJson('/api/session')->assertOk()->assertJson(['user' => null, 'needsSetup' => true]);
        $this->app_()->postJson('/api/setup', ['username' => 'ad', 'password' => 'x'])->assertStatus(400);
        $this->app_()->postJson('/api/setup', ['username' => 'admin', 'password' => self::pw('admin')])
            ->assertCreated()->assertJson(['user' => ['username' => 'admin', 'role' => 'admin']]);
        $this->assertAuthenticated();
        $this->app_()->postJson('/api/setup', ['username' => 'evil', 'password' => self::pw('admin')])
            ->assertForbidden()->assertJson(['error' => 'De admin bestaat al.']);
    }

    public function test_the_session_tells_the_version_and_the_size_of_upload_pieces(): void
    {
        $version = trim(file_get_contents(base_path('VERSION')));
        $this->assertMatchesRegularExpression('/^\d+\.\d+\.\d+$/', $version);
        $this->assertStringContainsString("## $version ", file_get_contents(base_path('CHANGELOG.md')), 'CHANGELOG.md has this version');
        $s = $this->getJson('/api/session')->assertOk()->json();
        $this->assertSame($version, $s['version']);
        $this->assertGreaterThan(0, $s['upload_chunk']);
    }

    public function test_a_change_without_the_app_header_is_refused(): void
    {
        $this->actingAs($this->admin())->postJson('/api/folders', ['name' => 'X'])->assertForbidden()->assertJson(['error' => 'Ongeldig verzoek']);
    }

    public function test_sign_in_and_out_with_a_case_insensitive_name(): void
    {
        User::factory()->create(['username' => 'Luisteraar', 'password' => self::pw('listener')]);
        $this->app_()->postJson('/api/login', ['username' => 'luisteraar', 'password' => self::pw('wrong')])
            ->assertStatus(401)->assertJson(['error' => 'Gebruikersnaam of wachtwoord klopt niet.']);
        $this->app_()->postJson('/api/login', ['username' => 'luisteraar', 'password' => self::pw('listener')])->assertOk()->assertJsonPath('user.role', 'listener');
        $this->assertAuthenticated();
        $this->app_()->postJson('/api/logout')->assertOk();
        $this->assertGuest();
    }

    public function test_twenty_wrong_passwords_block_the_login_but_correct_ones_never_count(): void
    {
        User::factory()->create(['username' => 'luisteraar', 'password' => self::pw('listener')]);
        for ($i = 0; $i < 25; $i++) {
            $this->app_()->postJson('/api/login', ['username' => 'luisteraar', 'password' => self::pw('listener')])->assertOk();
        }
        for ($i = 0; $i < 20; $i++) {
            $this->app_()->postJson('/api/login', ['username' => 'luisteraar', 'password' => "fout$i"]);
        }
        $this->app_()->postJson('/api/login', ['username' => 'luisteraar', 'password' => self::pw('listener')])->assertStatus(429);
    }

    public function test_roles_a_listener_gets_no_admin_routes_and_a_guest_nothing(): void
    {
        $this->getJson('/api/releases')->assertStatus(401)->assertJson(['error' => 'Niet ingelogd']);
        $this->actingAs($this->listener());
        foreach (['/api/users', '/api/settings', '/api/downloads'] as $path) {
            $this->getJson($path)->assertForbidden()->assertJson(['error' => 'Alleen voor admin']);
        }
        $this->app_()->postJson('/api/releases', ['title' => 'x'])->assertForbidden();
        $this->get('/downloads/videos.zip')->assertForbidden();
    }

    public function test_accounts_a_new_password_from_the_admin_signs_that_account_out(): void
    {
        $this->actingAs($admin = $this->admin());
        $id = $this->app_()->postJson('/api/users', ['username' => 'luisteraar', 'password' => self::pw('listener'), 'role' => 'listener'])->assertCreated()->json('user.id');
        $this->app_()->postJson('/api/users', ['username' => 'LUISTERAAR', 'password' => self::pw('listener'), 'role' => 'listener'])->assertStatus(400)->assertJson(['error' => 'Die gebruikersnaam bestaat al.']);
        DB::table('sessions')->insert(['id' => 'abc', 'user_id' => $id, 'payload' => '', 'last_activity' => time()]);
        $this->app_()->postJson("/api/users/$id/password", ['password' => self::pw('new')])->assertOk();
        $this->assertSame(0, DB::table('sessions')->where('user_id', $id)->count());
        $this->app_()->deleteJson("/api/users/{$admin->id}")->assertStatus(400);
        $this->app_()->deleteJson("/api/users/$id")->assertOk();
    }

    public function test_your_own_password_needs_the_current_one(): void
    {
        $this->actingAs(User::factory()->create(['password' => self::pw('old')]));
        $this->app_()->postJson('/api/me/password', ['current' => self::pw('wrong'), 'password' => self::pw('new')])->assertStatus(400);
        $this->app_()->postJson('/api/me/password', ['current' => self::pw('old'), 'password' => self::pw('new')])->assertOk();
    }

    public function test_a_post_naming_another_method_acts_as_it_for_hosts_that_block_put_and_delete(): void
    {
        $this->actingAs($this->admin());
        $id = $this->app_()->postJson('/api/folders', ['name' => 'Tijdelijk'])->json('folder.id');
        $this->app_()->withHeader('X-HTTP-Method-Override', 'DELETE')->postJson("/api/folders/$id")->assertOk();
        $this->getJson("/api/folders/$id")->assertNotFound();
    }

    public function test_security_headers_and_an_unknown_route(): void
    {
        $r = $this->get('/');
        $r->assertOk()->assertSee('Distant Youth Studio');
        $this->assertStringContainsString("script-src 'self'", $r->headers->get('Content-Security-Policy'));
        $this->assertSame('nosniff', $r->headers->get('X-Content-Type-Options'));
        $this->assertNull($r->headers->get('Strict-Transport-Security'), 'no HSTS over plain http');
        $this->getJson('/api/bestaat-niet')->assertNotFound()->assertJson(['error' => 'Onbekende API-route.']);
    }

    public function test_over_https_the_cookie_is_secure_and_hsts_is_sent(): void
    {
        $r = $this->get('https://localhost/api/session');
        $this->assertSame('max-age=31536000; includeSubDomains', $r->headers->get('Strict-Transport-Security'));
        $cookie = collect($r->headers->getCookies())->firstWhere(fn ($c) => $c->getName() === 'dyc_session');
        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isSecure());
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('lax', $cookie->getSameSite());
    }
}
