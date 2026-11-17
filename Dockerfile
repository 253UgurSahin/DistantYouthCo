# Distant Youth Studio (Laravel) met Apache, PHP 8.3 en ffmpeg (voor de MP3 uit je WAV en de cover uit je video).
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --no-interaction --prefer-dist
COPY . .
RUN composer dump-autoload --no-dev --optimize --no-scripts

FROM php:8.3-apache
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libzip-dev libicu-dev \
 && docker-php-ext-install zip intl \
 && rm -rf /var/lib/apt/lists/* \
 && a2enmod rewrite headers \
 && sed -ri 's!/var/www/html!/var/www/html/public!g' /etc/apache2/sites-available/000-default.conf \
 && sed -ri 's!AllowOverride None!AllowOverride All!g' /etc/apache2/apache2.conf \
 && printf 'upload_max_filesize=64M\npost_max_size=72M\nmemory_limit=256M\nmax_execution_time=300\n' > /usr/local/etc/php/conf.d/studio.ini

WORKDIR /var/www/html
COPY --from=vendor /app /var/www/html
COPY docker/entrypoint.sh /usr/local/bin/studio-entrypoint
RUN chmod +x /usr/local/bin/studio-entrypoint \
 && rm -rf tests forge-work node_modules .env \
 && chown -R www-data:www-data storage bootstrap/cache

# De database, je bestanden en .env (met de sleutel) staan in dit volume: maak er een back-up van.
VOLUME ["/var/www/html/storage"]
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD php -r "exit(@file_get_contents('http://127.0.0.1/api/session') === false ? 1 : 0);"
ENTRYPOINT ["studio-entrypoint"]
CMD ["apache2-foreground"]
