# Планер: безопасное подключение API на Zomro

**До настройки Google входа локальные задачи продолжают храниться в браузере. Не удаляйте их.**

## 1. Google OAuth

Создайте OAuth 2.0 Client ID типа **Web application** в Google Cloud Console.
В Authorized JavaScript origins добавьте `https://planer.fizmat-course.com`.
Используйте именно Client ID, **не Client Secret**. OAuth consent screen также необходимо настроить; если приложение в тестовом режиме, включите свой Google-аккаунт в список тестовых пользователей.

## 2. API на VPS

После `git pull`:

```bash
python3 -m venv /opt/planer-api/venv
/opt/planer-api/venv/bin/pip install -r /opt/planer-source/server/requirements.txt
install -d -m 700 /opt/planer-api/data
```

Создайте файл `/etc/planer-api.env` с режимом 0600:

```ini
GOOGLE_CLIENT_ID=ВАШ_WEB_CLIENT_ID.apps.googleusercontent.com
PLANER_DB=/opt/planer-api/data/planer.sqlite3
```

Поместите `server/planer-api.service` в `/etc/systemd/system/`, выполните `systemctl daemon-reload` и `systemctl enable --now planer-api`. **Никакие службы торгового бота не перезапускайте.**

## 3. Только для Nginx-сайта Планера

Внутри существующего HTTPS `server { server_name planer.fizmat-course.com; }` добавьте до `location / {`:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
    client_max_body_size 2m;
}
```

Проверьте `nginx -t` и только после успеха `systemctl reload nginx`.

## 4. Frontend

```bash
cd /opt/planer-source
VITE_GOOGLE_CLIENT_ID='ВАШ_WEB_CLIENT_ID.apps.googleusercontent.com' npm run build -- --base=/
cp -a dist/. /var/www/planer/
```

Проверьте `curl http://127.0.0.1:3001/api/health`, затем `curl https://planer.fizmat-course.com/api/health`.

## 5. Миграция задач

Сначала откройте старый сайт на телефоне и **экспортируйте/сохраните резервную копию localStorage** (через инструменты браузера, либо отдельный механизм экспорта). Данные с разных доменов не передаются автоматически.

На старом устройстве после подключения Google выберите **«Объединить местные задачи с облачными»**. Импорт добавляет только отсутствующие ID и не перезаписывает существующие записи. Затем на другом устройстве откройте облачные задачи. Не нажимайте «Открыть облачные задачи» на устройстве с единственной копией ещё не импортированных задач.

**Важно:** автоматическое продолжение сессии Google требует повторного входа после истечения срока действия ID-токена. Встроенное хранение токена ограничено одной вкладкой. Конфликты одновременных правок останавливают синхронизацию вместо перезаписи. Для большого количества устройств понадобится более развитая очередь изменений и обработка конфликтов.
