# Data Migration To Koodo Reader Personal

Koodo Reader Personal deliberately uses a new local data directory. Migrate through the application's backup and restore functions instead of copying internal database files while either application is running.

## Migration

1. Close Koodo Reader Personal if it is running.
2. Open the old Koodo Reader installation and create a complete local backup containing books, covers, shelves, notes, highlights, bookmarks, and settings.
3. Close the old application completely.
4. Open Koodo Reader Personal and restore the backup.
5. Verify book count, several covers, shelf membership, notes, highlights, and representative settings before deleting the old backup.

## Data Locations

- Koodo Reader Personal release: `%APPDATA%\KoodoReaderPersonal`
- Koodo Reader Personal development: `%APPDATA%\KoodoReaderPersonal-dev`
- Original Koodo Reader: determined by the installed upstream version

The Personal edition retains the cloud synchronization directory name `KoodoReader`. When the old and Personal applications point to the same remote directory, keep only one application open and synchronizing at a time to avoid concurrent writes.

Keep the migration backup until the Personal library has been checked and synchronized successfully.
