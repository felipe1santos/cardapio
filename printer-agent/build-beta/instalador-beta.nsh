; Assistente Menuzia Beta: ao desinstalar, tira SO o que e do Beta — a entrada propria de
; inicio automatico e a pasta de dados propria. Nao toca no Assistente de Impressao atual
; (outra pasta, outro appId, outra entrada "electron.app.Assistente de Impressao Menuzia").
; Em atualizacao do proprio Beta (isUpdated) nada e apagado.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Assistente Menuzia Beta"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Assistente Menuzia Beta"
    RMDir /r "$APPDATA\menuzia-assistente-beta"
  ${endIf}
!macroend
