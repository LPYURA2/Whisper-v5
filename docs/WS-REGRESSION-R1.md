# Whisper: проверка предполагаемой регрессии WS после 1.3J

## Статус

Причина конкретного отказа Android без VPN пока НЕ УСТАНОВЛЕНА. Целевой аудит
проведён; предполагаемое исправление runtime не внесено. Два контрольных клиента
опубликованы с одной и той же пассивной диагностикой. Третья «исправленная» сборка
не создана: выдавать диагностическую копию за исправление было бы неверно.

Main, production, signaling, резервные refs/архивы и подготовленный ExpressTURN
патч не изменены. В этой ветке изменяются только документация и отдельные тестовые
материалы. Переход к Merge/production требует нового решения владельца.

## Проверенная история

1. До1.3J: `6ca7510fb9134198c3244e47d08a698d9d27eb57`.
2. Первая1.3J: `1764559abae33ac5dab009a63d518606409da8f2`.
3. Принятая1.3J-1: `bd1b216c70c9070e7949c13abdc27eeeb3cc3e8c`.
4. Production merge: `9657faaaa59c31d3b3c2c489fc9a20a61e6fe5b0`.

6ca→176 меняет только network/ws-client.js, network/rtc-manager.js,
peers/peer-manager.js. 176→bd меняет только PeerManager. bd и merge имеют
одинаковый tree `280e55d3cea2e316513908ceb438ed565db18411`; код побайтно совпадает.
WSClient одинаков в176/bd/9657. Signaling и bootstrap не менялись.

Во всех четырёх версиях сохранены прежние WSS
`wss://whisper-signaling.onrender.com` и STUN `stun:stun.l.google.com:19302`.
TURN не включён. FireChat не использовался как контрольная предыдущая версия.

## Установленные факты

В Signaling.init порядок одинаков: new WSClient (конструктор не подключается),
затем window.wsClient=instance, затем connect(). Нативный open асинхронен и при
обычном запуске не опережает синхронное назначение глобального владельца.
Штатная цепочка owner→connect→open→join→ready работает на всех четырёх исходниках.

Новые guards стоят до app-логирования open/message/close. При замене глобального
клиента поздний open старого экземпляра игнорируется. Для актуального клиента
такая потеря события не воспроизвелась. Guards защищают новую операцию;
удалять их ради подключения оснований нет.

CONNECTING без собственного открытия watchdog, отсутствие retry на error без
последующего close и отсутствие отдельного VPN/online recovery существовали до
1.3J. Одно это не устанавливает новую регрессию.

Новая точка риска введена в176: WSClient.connect вызывает
PeerManager.setSignalingState(this,false) перед установкой socket handlers.
Смешанная загрузка нового WSClient и старого PeerManager без этого метода даёт
TypeError; socket уже создан и может дойти до native OPEN, но обработчик open не
установлен, app-open отсутствует, join не отправлен. Это воспроизведено в VM и
Chromium. Coherent6ca и coherent9657 такого отказа не имеют.

Смешанные assets или такое исключение на устройстве владельца НЕ ПОДТВЕРЖДЕНЫ.
Искусственная подмена PeerManager/внедрение throw не являются доказательством
причины реального инцидента. Защитный if с пропуском метода тоже не является
обоснованным исправлением: он мог бы отключить обязательный lifecycle.

Ещё одна условная чувствительность: peers до signaling-ready новый PeerManager
отбрасывает; readiness не переигрывает этот старый список. Для актуального сервера
такой порядок не подтверждён. Отсутствие app-open это не объясняет.

Из фрагмента `[WS] connecting...` нельзя определить native readyState, наличие
open, Join, ACK или стадию ICE. Сетевой оператор, Render и VPN причиной не объявлены.

## Опубликованные контроли

**Whisper до1.3J / before13j-control-r1**

https://whisper-before13j-control-r1.frostyskunk66.chatgpt.site

Runtime:6ca7510. Hosting source:e6b43218f5249fd8a50b37fd072750657481dd6f.
Deployment:appgdep_6ae49e3a9b6c8191afd663cf40446726, succeeded.

**Принятая1.3J-1 / accepted13j-diagnostic-r1**

https://whisper13j-ws-diagnostic-r1.frostyskunk66.chatgpt.site

Runtime:9657faaa (равенbd1b216). Hosting source:59f4de500c3022334f7f2c2a13d838a33a96a9db.
Deployment:appgdep_6ae49e51bf1081918f71f879cb553024, succeeded.

Площадки Sites, отдельные origin, audience public. Новые платные услуги не
подключались. Обязательная авторизация ChatGPT в access-policy не требуется.
Проверка свежим Chromium с0cookies, без Authorization и bypass token проведена,
но оба GET завершились до ответа сайта `net::ERR_TUNNEL_CONNECTION_FAILED` через
обязательный proxy. Поэтому фактический anonymous HTTP/browser PASS НЕ заявляется.
Проверка обычным Android нужна отдельно; owner-only ссылки не использованы.

19 исходных файлов каждого клиента побайтно сохранены, включая все runtime JS.
В index изменены title и подключение диагностики; добавлены3 diagnostic assets. Никакие WS/RTC/PeerManager
модули не патчились. Прежний STUN не расширен. Манифест каждой публикации доступен
на /diagnostics/SHA256-MANIFEST.json .

## Что наблюдает диагностика

Нативные WS readyState/open/error/close отдельно от app-open/ready маркеров;
успешное принятие join браузерным send (не доказательство доставки серверу);
тип signaling-ready при native message отдельно от client.connected и
PeerManager.signalingReady/presenceFresh. Ownership передаётся только булевыми
сравнениями; setSignalingStateAvailable помогает отличить несовместимую загрузку.
Post-handler состояние снимается следующей задачей: microtask может исполниться
между callback браузера и не доказывает завершённую обработку приложением.

PC/ICE/DC наблюдаются пассивно. Маршрут определяется только по выбранной активной
паре getStats transport.selectedCandidatePairId с типами обоих кандидатов.
Нет новых connect/close/restartIce/setConfiguration, WS timeout/retry, recovery
или вмешательства в25/60/15. Диагностические sampling timers не управляют peers.

Экспорт schema whitelist: счётчики, состояния, времена, локальные ws1/pc1/dc1.
Нет packet bodies, реальных peer/profile/session IDs, SDP/ICE/IP, сообщений,
ключей, credentials, Error.message/stack или URLfragment. Старые подробные логи
самого приложения по-прежнему могут содержать чувствительные поля: использовать
кнопку «Копировать безопасную диагностику» из верхней синей панели.

Observer SHA-256:
`24cc19968d5d0e34f140eddadfcfda84285857969dd32723051a0d03c02ccb04`.

## Фактические проверки

- Трассы WSClient/Signaling/PeerManager четырёх snapshots:28PASS/0FAIL (модельный WS).
- Независимая Signaling/init проверка четырёх версий и stale/exception случаев:PASS.
- Mixed-module воспроизведение: два coherent контроля проходят; смешанный набор
  намеренно воспроизводит TypeError/nohandler/nojoin. Это negative reproduction.
- Оригинальные M1–M55:55PASS/0FAIL; адаптирована только строка пути fixture.
- Boundary1.3J:209PASS/0FAIL, исходный файл выполнен напрямую.
- Настоящий localhost WebSocket/TCP:3PASS/0FAIL — new/new, old6ca/new и new/old6ca.
  PC/DC в этих проверках модельные; server process локальный, не Render.
- Chromium412x915:43PASS/0FAIL, оба полных клиента, реальные module/bootstrap/UI,
  синтетические WS/PC. Сохранение профилей/контактов/сообщений при reload PASS.
  Нормальные страницы не дали page errors/внешних запросов. Преднамеренная
  mixed-module ошибка проверена отдельно. Синтаксис всех JS обеих сборок PASS.
- Safe-export проверен синтетическими чувствительными marker strings, без
  использования действительных пользовательских данных.
- Старые дополнительные25 оригинальных сценариев недоступны; повтор не заявляется.

Remote Render WS:BLOCKED для этой среды (`CONNECT tunnel failed, response403` на
проверке endpoint до server response); настоящий remote WS handshake NOT RUN.
Настоящий WebRTC/Android/VPN:NOT RUN. Модельные PASS не доказывают реальную связь.

## Следующая физическая проверка без USB

1. На обоих Android открыть один и тот же контрольный сайт в Chrome без VPN,
   создать разные тестовые профили, добавить друг друга. Рабочие профили не
   импортировать; общий signaling не разделён по origin. Другие тестовые вкладки
   на время прогона закрыть. Сохранить одинаковую мобильную сеть/браузер/телефоны.
2. При сбое скопировать безопасный JSON обоих телефонов через30с и90с, без reload.
   Записать рядом build, время, Wi-Fi/mobile и VPN off/on. Учитывать возможное
   время старта сервера; не считать первый холодный запрос честным сравнением
   со следующим прогретым. Повторить A/B и B/A в сопоставимых условиях.
3. Повторить другой контроль. При соединении проверить по3 сообщения в обе
   стороны. Сначала зафиксировать результат безVPN, затем включитьVPN и снова
   скопировать оба журнала. После сменыVPN наблюдать безперезагрузки, чтобы
   увидеть прежнийsocket/close/штатнуюповторнуюпопытку.
4. Проверить потерю/возврат сети и двусторонние сообщения после восстановления.
   Не менять одновременно сеть, версию иVPN: отдельный прогон для каждого фактора.

## Как решить следующий шаг по данным

- native CONNECTING, open0: собирать время/попытки/сеть; по этому состоянию guards
  open не доказаны причиной. No-watchdog — прежнее ограничение, не новая регрессия.
- native OPEN, app-open0, join0: проверить ownerflags, bootstrapfatal и наличие
  setSignalingState. Ownerfalse может означать корректное игнорирование старого
  экземпляра; ownertrue+TypeError требует проверить фактически загруженные модули.
- joinSent>0, receivedReady0: подтверждён лишь browser send, не серверная регистрация.
- receivedReady>0, clientnotready: анализировать обработку/ID mismatch/stale owner,
  не переходить сразу кICE. Нужен синхронизированный снимок второй стороны.
- readytrue, presencefalse/noPC: проверить peers/contact gate и порядок ACK/presence.
- signalingready+PC/ICEchecking: это уже отдельная стадияWebRTC; не лечить WS наугад.

При доказанном lifecycle дефекте — минимальный targeted patch, воспроизведение
before/after, те же регрессии и отдельный третий исправленный сайт. Пока такого
доказательства нет. Расширение STUN/TURN не подменяет этот разбор.

## Отмена теста и откат

Production не обновлялся; боевой откат не требуется. Для отключения тестов снять
публичный доступ/отключить только два новых Site через hosting, сохранив их IDs,
source commits, архивы и доказательства. Не трогать существующие сайты/Pages.
Тестовые профили принадлежат отдельным origin, production localStorage не очищать.
Резервные ветки и архивы прежних этапов сохранены. Любой будущий runtime patch
будет отдельным commit; его отмена — отдельное решение владельца, без force push.
