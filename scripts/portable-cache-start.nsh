  # Serialize extraction only. An abandoned mutex permits crash recovery.
  Var /GLOBAL runtimeMutex
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\Lumen-runtime-${UNPACK_DIR_NAME}") p .r9'
  StrCpy $runtimeMutex $9
  StrCmp $runtimeMutex 0 runtimeFailed
  System::Call 'kernel32::WaitForSingleObject(p $runtimeMutex, i 60000) i .r9'
  StrCmp $9 0 runtimeLocked
  StrCmp $9 128 runtimeLocked runtimeFailed

runtimeLocked:
  IfFileExists "$INSTDIR\.complete" 0 extractRuntime
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 extractRuntime
  IfFileExists "$INSTDIR\resources\app.asar" 0 extractRuntime
  IfFileExists "$INSTDIR\icudtl.dat" runtimeReady extractRuntime

extractRuntime:
  # Only this build's incomplete cache is removed, while holding its mutex.
  RMDir /r $INSTDIR
  ClearErrors
  SetOutPath $INSTDIR
  IfErrors runtimeFailed
