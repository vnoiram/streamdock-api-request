# streamdock-api-request

Mirabox Stream Dock JavaScript/HTML plugin for sending HTTP/API requests directly from a Stream Dock button.

This v1 plugin does not include a helper, proxy, or native component. Requests are sent with browser/runtime `fetch()` from `plugin.js`, so normal browser restrictions still apply.

## Version

Current version: `0.2.0`.

Notable `0.2.0` updates:

- Added run-on-appear, feedback modes, retry settings, pretty JSON display, and Property Inspector request testing.
- Added `npm run clean` and `npm run release:zip`.
- Release zips include the manifest version in the filename.

## Actions

- `API Request`: sends one configured request when the key/touch action is pressed.
- `API Poll`: sends the configured request while the action is visible, using `Poll sec`.
- `Diagnostics`: shows the last endpoint, method, status, error, and duration recorded by the plugin.

## Settings

- `Method`: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, or a custom method.
- `URL`: target request URL.
- `Headers JSON`: JSON object string, for example `{"Authorization":"Bearer token"}`.
- `Body`: raw request body. It is not sent for `GET` or `HEAD`.
- `Content-Type`: added as a `Content-Type` header when set and when the header is not already present.
- `Timeout ms`: request timeout via `AbortController`.
- `Poll sec`: interval used by the `API Poll` action.
- `Result path`: dot path for extracting a value from JSON, for example `data.temperature`.
- `Template`: button display template. Supported placeholders are `{status}`, `{ok}`, `{value}`, `{body}`, `{error}`, and `{durationMs}`.
- `Max chars`: truncates the displayed title.
- `Success`: optional comma-separated status allowlist such as `200,201,204`. Empty means any `2xx` status succeeds.
- `Run appear`: for `API Request`, also sends the request when the action appears.
- `Feedback`: controls Stream Dock `showOk` / `showAlert` feedback. Use `Failures only` or `None` for quiet polling.
- `Retries`: retries timeout, network/CORS, and `5xx` failures.
- `Retry delay`: delay between retries in milliseconds.
- `Pretty JSON`: formats object/array `{value}` and `{body}` output before applying `Max chars`.
- `Presets JSON`: named settings objects for quick reuse.

Preset examples:

```json
{
  "Health": {
    "method": "GET",
    "url": "http://127.0.0.1:8080/health",
    "resultPath": "status",
    "displayTemplate": "{status}\n{value}"
  },
  "Toggle": {
    "method": "POST",
    "url": "https://api.example.com/toggle",
    "contentType": "application/json",
    "body": "{\"enabled\":true}",
    "successStatuses": "200,204"
  }
}
```

## Behavior

- JSON responses are parsed when the response content type contains `json`, or when the body looks like JSON.
- When `Result path` is set, the extracted value becomes `{value}`.
- Non-JSON responses are treated as text. `Result path` requires a JSON response.
- Successful requests call `showOk`.
- Failed requests call `showAlert` and write a Stream Dock log message.
- The Property Inspector `Test` button sends the current request and shows status/duration without pressing the Stream Dock key.
- Timeout, invalid headers JSON, invalid response JSON, missing `Result path`, and CORS/network errors are shown on the button.

## Important Limits

Because v1 has no helper, it cannot bypass CORS. If an API does not allow the Stream Dock plugin runtime origin, the request may fail as `CORS/network error`.

Secrets such as API keys and bearer tokens are stored in Stream Dock action settings as plain text when placed in `Headers JSON`. Use this only for endpoints and tokens where that storage model is acceptable.

Possible v2 work:

- Optional local helper/proxy for CORS-restricted APIs.
- Secret storage outside Stream Dock settings.
- Local file logging.

## Repository Layout

- `manifest.json`: Stream Dock plugin manifest.
- `plugin.html` / `plugin.js`: Stream Dock runtime plugin.
- `property-inspector.*`: Stream Dock settings UI.
- `icons/`: plugin icon assets.
- `scripts/package-plugin.js`: creates a distributable `.sdPlugin` directory.
- `scripts/release.ps1`: packages and zips a release on Windows/PowerShell.

## Build

Run local checks:

```bash
npm run check
```

Build a distributable plugin folder:

```bash
npm run package
```

Clean build output:

```bash
npm run clean
```

The output is written to:

```text
dist/stream-dock-api-request.sdPlugin
```

Create a release zip on Windows/PowerShell:

```powershell
npm run release:zip
```
