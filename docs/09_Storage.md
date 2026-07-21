# 09 — Storage

## 1. The Bucket

One Supabase Storage bucket, named **`deepflow`**, serves the entire project. There is no separate bucket per app, per data type, or per environment.

## 2. Folder Structure & Naming Convention

```
deepflow/
└── jobs/
    └── <job id>/
        └── <upload timestamp>-<random 4-character code>.<file extension>
```

- **`<job id>`** matches whatever ID that job was assigned at creation — which is **not** a consistent format. Office-created jobs get a random UUID; jobs created from the Employee App's "Add New Job" feature get a different, custom string (e.g. `job-eng-<timestamp>-<random>`), confirmed by directly listing real folder names in the live bucket.
- **File names are always generated, never user-supplied** — this avoids filename collisions and keeps every file traceable back to its upload moment, without needing to preserve the original camera filename.
- **Before/after paired photos use the exact same path convention** as standalone photos — the *only* difference is extra metadata (`photo_slot`, `photo_role`) recorded on the corresponding `attachments` database row, not anything in the file's path or name.

## 3. Who Uploads, Downloads, and Deletes

| Action | Office App | Employee App | Client Portal |
|---|---|---|---|
| Upload | Never | **Yes — the only uploader in the system** | Never |
| Download/view | Yes | Yes | Yes (certificates/documents only) |
| Delete | Yes (from a job's attachment view) | Yes (for photos it just uploaded, within the same session) | Never |

## 4. The Upload Pipeline (Employee App only)

1. Engineer selects/takes a photo.
2. The browser reads the photo's embedded EXIF data (capture time, GPS coordinates if present) — done by manually parsing the raw file bytes; no EXIF library is used.
3. **Unless "HD mode" is switched on**, the image is resized to a maximum of 1200 pixels (width and height) and re-encoded as JPEG at 80% quality, using the browser's own `<canvas>` element. **If HD mode is on, this step is skipped entirely** — the original, unmodified camera file is uploaded as-is.
4. A visible watermark (job address, engineer's name, and a timestamp) is drawn onto the image, also via `<canvas>`, regardless of the HD-mode setting.
5. The finished file is uploaded directly to Storage with a `POST` request, authenticated with the engineer's own logged-in session token.
6. A matching row is written to the `attachments` database table, recording the file's path, its public URL, who uploaded it, and (for before/after pairs) which slot/role it represents.

## 5. Image Processing & Compression — Exact Rules

Full detail: [13_Business_Rules.md](13_Business_Rules.md) Section 12. In summary: 1200px / 80% quality is the default ceiling; HD mode removes any ceiling at all, meaning a modern phone photo in that mode can be several megabytes, with a direct, uncapped effect on both Storage cost and upload time on a poor connection. See [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) Section 9 for the corresponding performance discussion (no thumbnail generation, same full file served to every context regardless of how small it's actually displayed).

## 6. PDF Generation

**PDFs are never stored in Storage.** Every PDF (invoices, certificate reports, engineer payslips) is generated fresh, entirely in the requesting browser, using the jsPDF library, and exists only as a transient download in that one session — there is no `pdf_url` ever populated, no PDF file ever uploaded, and no server-side PDF rendering anywhere in this system. (The `invoices.pdf_url` database column exists but was confirmed unused by any application code — see [05_Database.md](05_Database.md).)

## 7. Replacement Rules

There is no "replace this file" feature anywhere in the system — every upload creates a brand-new file at a brand-new generated path. To change a photo, the old one must be explicitly deleted and a new one uploaded separately.

## 8. Deletion Rules

- Deleting an attachment **from within the app** (via the ✕ button on a photo) correctly removes **both** the database row **and** the underlying Storage file, together, in one action.
- Deleting the **job** the attachment belongs to does **not** cascade — the attachment row and its Storage file both become permanently orphaned, with no interface path left to find or clean them up. See [../AUDIT.md](../AUDIT.md) Section 14.1.

## 9. Retention Rules

🔴 **None exist.** There is no expiry, no archival tier, and no automatic cleanup of orphaned files (Section 8) anywhere in this system. Every file uploaded since the project began, including any accidental or orphaned ones, is expected to remain in the same storage tier indefinitely unless manually deleted.

## 10. Public vs. Private Access

The bucket is configured public, and — critically, confirmed by direct, safe live testing (see [15_Security.md](15_Security.md) Section 5) — its contents can currently be **listed, uploaded to, and deleted from by anyone, with no login of any kind**, not just read. This is the single most severe finding in the entire security review of this project. Full remediation guidance: [15_Security.md](15_Security.md) Section 15, Recommendation 1.

## 11. Dependencies

- **Depends on:** the `attachments` database table (Section 4, step 6) — a file with no matching `attachments` row is invisible to every app's normal interface, even though it still physically exists in the bucket.
- **Depended on by:** every job-photo feature in the Employee App; the Office App's job-attachment viewer and admin Storage-usage dashboard (which itself has a confirmed bug — it queries a `certificates` table that doesn't exist for one of its stats, see [05_Database.md](05_Database.md)); the Client Portal's certificate/document display.

## 12. Cross-References

Security testing and findings specific to Storage: [15_Security.md](15_Security.md) Section 5. Performance implications of the current upload/compression approach: [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) Sections 8–9. The upload workflow traced step by step: [12_Workflows.md](12_Workflows.md) B12–B13.
