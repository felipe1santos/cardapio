; Build de TESTE LOCAL do Beta: sem inicio automatico; ao desinstalar, fecha so o executavel
; deste build e apaga so a pasta de dados propria dele.
!macro customUnInit
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "Assistente Menuzia Beta TESTE LOCAL.exe"'
  Sleep 1500
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\menuzia-assistente-beta-teste-local"
    SetOutPath $TEMP
    RMDir "$INSTDIR"
  ${endIf}
!macroend
