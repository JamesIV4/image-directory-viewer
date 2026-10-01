  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 runtimeFailed
  IfFileExists "$INSTDIR\resources\app.asar" 0 runtimeFailed
  IfFileExists "$INSTDIR\icudtl.dat" 0 runtimeFailed
  ClearErrors
  FileOpen $9 "$INSTDIR\.complete" w
  IfErrors runtimeFailed
  FileWrite $9 "${UNPACK_DIR_NAME}"
  FileClose $9
  IfErrors runtimeFailed

runtimeReady:
  SetOutPath $INSTDIR
  System::Call 'kernel32::ReleaseMutex(p $runtimeMutex)'
  System::Call 'kernel32::CloseHandle(p $runtimeMutex)'
  Goto launchRuntime

runtimeFailed:
  # No completion marker is written on failure; the next launch retries.
  MessageBox MB_OK|MB_ICONEXCLAMATION "Lumen could not prepare its runtime cache. Close other launches and try again."
  SetErrorLevel 1
  Quit

launchRuntime:
