; Build de TESTE LOCAL do Beta: sem inicio automatico; ao desinstalar, apaga so a pasta
; de dados propria deste build.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\menuzia-assistente-beta-teste-local"
  ${endIf}
!macroend
