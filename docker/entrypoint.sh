#!/bin/sh
# .env lives in the storage volume, so the key the app makes on its first visit survives a rebuild.
set -e
cd /var/www/html
mkdir -p storage/app/private storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs
[ -f storage/.env ] || cp .env.example storage/.env
ln -sf storage/.env .env
chown -R www-data:www-data storage bootstrap/cache
exec "$@"
