# Бот «Проверка техосмотра»

Telegram-бот по той же схеме, что `oracle`: `index.js` на polling, кнопка Mini App, страница на VPS за nginx.

«Сайт» открывает сайт в Mini App. «Услуги» открывает экран КАСКО, ОСАГО, ДКП и проверки техосмотра.

Оплата как на сайте, через Т-Банк:

- проверка техосмотра — 30 ₽, только если данные найдены;
- договор купли-продажи — 1 000 ₽, бланк после оплаты;
- КАСКО и ОСАГО — заявка, полис оплачивается после расчёта.

## Быстрый старт

Нужны Node.js 18+ и токен от [@BotFather](https://t.me/BotFather).

```powershell
cd "C:\Users\it13\Desktop\тгпроверкатех"
Copy-Item env .env
npm install
npm start
```

В `.env`:

```
TELEGRAM_BOT_TOKEN=токен
WEB_APP_URL=https://ваш-домен/
SITE_URL=https://проверка-техосмотра.рф/
PORT=8791
ADMIN_CHAT_ID=
TINKOFF_TERMINAL_KEY=
TINKOFF_PASSWORD=
AUTO_API_KEY=
```

`npm start` поднимает бота и страницу на `http://127.0.0.1:8791`. В Telegram кнопка откроется только если адрес начинается с `https://`.

`ADMIN_CHAT_ID` — чат, куда падают заявки. Если поле пустое, бот пишет id в консоль на `/start`.

`AUTO_API_KEY` — ключ auto-api.ru с сайта. Без него проверка не берёт оплату и принимает заявку с телефоном.

Цены: `CHECK_PRICE=30`, `DKP_PRICE=1000`.

## VPS

```bash
sudo mkdir -p /var/www/tehosmotr
# скопируйте проект в /var/www/tehosmotr
cd /var/www/tehosmotr
npm install --omit=dev
cp env .env
```

Сайт и API идут через один процесс, nginx только проксирует:

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/tehosmotr
# замените «ваш-домен»
sudo ln -s /etc/nginx/sites-available/tehosmotr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ваш-домен
```

Бот:

```bash
sudo cp deploy/tehosmotr-bot.service /etc/systemd/system/tehosmotr-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now tehosmotr-bot
```

В BotFather: `/setdomain` на ваш домен, `/setmenubutton` на `https://ваш-домен/`. В кабинете Т-Банка Notification URL можно не прописывать отдельно: бот передаёт его в каждом платеже, `https://ваш-домен/api/tinkoff/notification`.

DNS-запись `A` должна указывать на VPS до выпуска сертификата. Порты 80 и 443 открыты. Токен и ключи лежат только в `.env`.
