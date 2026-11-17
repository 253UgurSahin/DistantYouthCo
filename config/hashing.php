<?php

// Argon2id where PHP has it (no 72-byte limit on passwords), bcrypt otherwise.
// Everything else comes from the framework's defaults.
return [
    'driver' => env('HASH_DRIVER', defined('PASSWORD_ARGON2ID') ? 'argon2id' : 'bcrypt'),
];
