# Tools

## Available Tools

### get_user_info
- **Description**: Ambil informasi user dari database
- **Parameters**: phoneNumber (string)
- **Returns**: User data termasuk nama, label, dan memori

### save_note
- **Description**: Simpan catatan/fakta baru tentang user ke memori
- **Parameters**: key (string), value (string)
- **Returns**: Konfirmasi data tersimpan

### fetch_smartscholar_endpoint
- **Description**: Ambil data endpoint SmartScholar via HTTP (mirip curl/browser)
- **Parameters**:
  - `method` (string, opsional): `GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS` (default: `GET`)
  - `endpoint` (string, wajib): path atau URL endpoint. Contoh: `/api/plans`, `/admin_api/orders`
  - `query` (string, opsional): query string, contoh `page=1&limit=20`
  - `authMode` (string, opsional): `auto` | `none` | `bearer` | `cookie` | `api_key`
  - `headersJson` (string, opsional): JSON object string untuk header tambahan
  - `bodyJson` (string, opsional): JSON string untuk body request method non-GET
  - `bodyText` (string, opsional): raw text body request method non-GET
- **Returns**: Status HTTP, URL final, dan preview body response
