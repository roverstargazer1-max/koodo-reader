!macro customInit
!macroend

!macro customInstall
  ; Kill the Personal process before installation to prevent file locking
  nsExec::ExecToLog 'taskkill /f /im "Koodo Reader Personal.exe"'
  ; Wait for the OS to release file handles after process termination
  Sleep 3000
!macroend

!macro customUnInstall
  MessageBox MB_YESNO "Delete all Koodo Reader Personal data, including books, notes, highlights, bookmarks, and settings?" /SD IDNO IDNO SkipRemoval
    SetShellVarContext current
    RMDir /r "$APPDATA\KoodoReaderPersonal"
  SkipRemoval:
!macroend
