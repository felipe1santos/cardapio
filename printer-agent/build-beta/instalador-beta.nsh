; Assistente Menuzia Beta: ao desinstalar, tira SO o que e do Beta - a entrada propria de
; inicio automatico e a pasta de dados propria. Nao toca no Assistente de Impressao atual
; (outra pasta, outro appId, outro executavel, outra entrada de inicio automatico).
; Em atualizacao do proprio Beta (isUpdated) nada e apagado.

; Fecha o Beta aberto antes de apagar os arquivos: no modo silencioso o desinstalador
; padrao nao fecha o app e os arquivos ficam presos. Nome EXATO do executavel do Beta -
; o Assistente de Impressao atual tem outro executavel e nao e tocado.
!macro customUnInit
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /IM "Assistente Menuzia Beta.exe"'
  Sleep 1500
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Assistente Menuzia Beta"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Assistente Menuzia Beta"
    RMDir /r "$APPDATA\menuzia-assistente-beta"
  ${endIf}
!macroend
