<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<User> */
class UserFactory extends Factory
{
    public function definition(): array
    {
        return [
            'username' => 'user_'.Str::lower(Str::random(8)),
            'password' => Str::random(20),
            'role' => User::LISTENER,
        ];
    }

    public function admin(): static
    {
        return $this->state(['role' => User::ADMIN]);
    }
}
