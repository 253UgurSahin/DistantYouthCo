<?php

namespace App\Exceptions;

use RuntimeException;

/** An error with a message safe to show in the app, answered as {"error": "..."} with its status. */
class ApiError extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }

    public static function bad(string $message): self
    {
        return new self(400, $message);
    }

    public static function notFound(string $message = 'Niet gevonden'): self
    {
        return new self(404, $message);
    }
}
