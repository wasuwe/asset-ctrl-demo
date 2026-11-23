# Porting asset_ctrl_v2 (PHP + MySQL) to AssetCtrl.Web (.NET Framework 4.8 Web Forms + PostgreSQL)

The browser app (index.html + assets/js) is reused unchanged except `core.js` calls `api.ashx` instead of `api.php`.
So every API route must return **the same JSON** as the PHP version. Port the PHP code file by file, keep the
same structure, names (PascalCase methods), comments and behaviour. Do not redesign.

## Layout

| PHP | C# |
|---|---|
| `app/Core/*` | `AssetCtrl.Web/Core/*` (namespace `AssetCtrl.Core`) |
| `app/Api/ApiController.php`, `Kernel.php`, `Meta.php`, routes | `AssetCtrl.Web/Api/*` (`AssetCtrl.Api`) |
| `app/Api/Controllers/X.php` | `AssetCtrl.Web/Api/Controllers/X.cs` (`AssetCtrl.Api.Controllers`) |
| `app/Repositories/X.php` | `AssetCtrl.Web/Repositories/X.cs` (`AssetCtrl.Repositories`) |
| `app/Services/X.php` | `AssetCtrl.Web/Services/X.cs` (`AssetCtrl.Services`) |
| `app/Models/X.php` | `AssetCtrl.Web/Models/*` (`AssetCtrl.Models`) |

Ignore `app/Controllers/*` and `views/*` (old server-rendered pages, not used by the API).
The csproj lists every file (`<Compile Include="..." />`), so add each new .cs file to it.

## Core types (already written — read them first)

- `Row` (`Core/Row.cs`): ordered `Dictionary<string, object>` = PHP associative array. Helpers: `Str(k)`, `Int(k)`,
  `Long(k)`, `Empty(k)` (PHP `empty`), `IsNull(k)`, `Get(k, def)`, `Set(k, v)`, `Copy()`.
- `Php` helpers: `ToStr`, `ToInt`, `ToLong`, `IsNumeric`, `IsEmpty`, `CleanText` (clean_text), `CleanCode` (clean_code),
  `MbLen`, `MbLeft`, `NumberFormat`, `RandomToken`.
- `Database` (`Core/Database.cs`): `All`, `One`, `Value` (string or null), `Column` (List<string>), `Pairs` (Row),
  `Execute`, `Insert` (returns id), `InsertMany`, `Update`, `Transaction(() => ...)`, static `InClause`, `Now()`
  (string "yyyy-MM-dd HH:mm:ss"), `NowDate()` (DateTime), `LikeEscape`.
  Params: `new Row { { "id", 5 }, { "q", "x" } }`, SQL placeholders `:name` exactly like the PHP.
  **Every value in a returned row is a string or null** (same as PDO/MySQL), so JSON output matches PHP.
  When PHP casts `(int) $row['x']`, use `row.Int("x")`; when it passes the raw row to JSON, pass the Row.
  String params are sent untyped, so `'12'` works for int columns and `'2026-01-01 00:00:00'` for timestamps.
  **Never pass `''` for an integer/timestamp column** (PostgreSQL rejects it; MySQL did not) — use null or an int.
- `Request`: `Query/Post/Input` (string), `Int`, `Arr` (List<string>), `All()` (Row of POST/JSON body; values are
  string, `List<object>` or `Row`), `PostUntrimmed`, `File`.
- `Auth`: `Check`, `User()` (Row), `Id()` (int?), `Role`, `Name`, `IsAdmin`, `SeesAll`, `WcIds`, `CoversWorkCenter`,
  `ScopeSql(p, col)`, `Can(ability)`.
- `ApiController` base: `Respond(data)`, `Ok(message, data)`, `Fail(errors|error, status)`, `NotFound`, `Forbidden`,
  `Paged(rows, pager)`, static `Pager(p)`, `RequireLogin/RequireAdmin/RequireAbility`, fields `App, Request, Db, Auth, Route`.
  `Respond/Ok/Fail` **end the action** (they throw `ResponseSentException`, like PHP `exit`), so code after them does not run.
  Override `public override void Before()`. Actions are `public void Index()` etc. (PHP name with first letter upper-cased).
- Exceptions: `ValidationException(list)` -> 422, `ApiException(status, msg, code)`, `Core.HttpException`.
- `Lang.T(text, vars)` translates; messages passed to `Ok/Fail` are translated automatically (keep English).
- `Paginator(total, perPage, page)` with `.Total .PerPage .Page .Pages .Offset() .From() .To()`.
- Already ported: `Models/Role.cs` (Role, AssetStatus, TicketStatus), `Models/AssetFields.cs`,
  `Repositories/HistoryRepository.cs`, `Repositories/TicketRepository.cs`, `Api/Meta.cs`, `Api/Controllers/SessionController.cs`.
  Repository `Search(...)` methods return `Row { rows: List<Row>, pager: Paginator }`.

## JSON shape rules

- PHP `array('a' => 1)` -> `new Row { { "a", 1 } }`; PHP list -> `List<...>`.
- PHP `(object) $arr` (forces `{}` when empty) -> a `Row` (always serialises as an object).
- PHP `(int)` / `(bool)` casts in the response -> C# int / bool. Uncast DB values stay strings.
- `array_values`, `array_map('intval', ...)` -> `List<int>` etc.
- PHP float results (`round(x, 1)`) -> double.

## MySQL -> PostgreSQL SQL rules

- `IFNULL(a,b)` -> `COALESCE(a,b)`. `CONCAT`, `TRIM`, `COALESCE`, `LIMIT/OFFSET` work as is. No backticks.
- `SUM(cond)` -> `SUM(CASE WHEN cond THEN 1 ELSE 0 END)`. A bare boolean in SELECT is returned as "1"/"0" (ok).
- `CAST(x AS SIGNED)` -> `CAST(x AS BIGINT)`. Never use `::` casts (clashes with `:name` params).
- `NOW()`, `DATE_SUB(NOW(), INTERVAL n DAY)` -> compute in C# with `Database.NowDate().AddDays(-n)` and pass as a param
  (the app time zone is set in Web.config). `CURDATE()` -> param `Database.NowDate().Date`.
- `TIMESTAMPDIFF(MINUTE, a, b)` -> `FLOOR(EXTRACT(EPOCH FROM (b - a)) / 60)`; HOUR -> `/ 3600`; DAY -> `/ 86400`.
- `DATE(x)` -> `CAST(x AS DATE)`; `DATE_FORMAT(x, '%Y-%m')` -> `to_char(x, 'YYYY-MM')`.
- `GROUP_CONCAT(x)` -> `string_agg(x, ',')`; `GROUP_CONCAT(DISTINCT x ORDER BY x SEPARATOR ', ')` -> `string_agg(DISTINCT x, ', ' ORDER BY x)`.
- Text search `LIKE` -> `ILIKE` (MySQL's collation was case-insensitive). Equality on codes stays `=` (codes are upper-cased).
- PostgreSQL does **not** allow output column aliases inside expressions in ORDER BY / WHERE / HAVING
  (`ORDER BY queue_no IS NULL` fails). Wrap: `SELECT * FROM (...) x ORDER BY (x.queue_no IS NULL), x.queue_no`
  (see `TicketRepository.Wrapped`). A plain `ORDER BY alias` is fine.
- `GROUP BY` must list every non-aggregated column unless grouping by the table's primary key.
- `int / int` truncates in PostgreSQL; MySQL gave a decimal. Use `CAST(x AS NUMERIC) / y` where a fraction is wanted.
- `INSERT IGNORE` -> `INSERT ... ON CONFLICT DO NOTHING`; `ON DUPLICATE KEY UPDATE` -> `ON CONFLICT (cols) DO UPDATE SET ...`.
- `lastInsertId()` -> `Db.Insert(...)` already returns the id (`RETURNING id`).
- Boolean flags are SMALLINT 0/1 as before (`is_active = 1` still works).
- Schema: `AssetCtrl.Web/Database/schema.pg.sql`.

## Done check

`"C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe" AssetCtrl.Web\AssetCtrl.Web.csproj -p:Configuration=Debug -v:minimal -nologo -clp:ErrorsOnly`
must build with no errors.
