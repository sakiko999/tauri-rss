; NSIS 安装钩子 —— 桌面快捷方式。
;
; Tauri 2 的 NSIS 只创建开始菜单快捷方式（`NsisConfig` 没有 Tauri 1 的
; `createDesktopShortcut` 选项），桌面图标只能在这里补。
; 图标取自 exe 内嵌资源（第 0 个），与任务栏/开始菜单一致。

!macro NSIS_HOOK_POSTINSTALL
  CreateShortcut "$DESKTOP\Amoeba.lnk" "$INSTDIR\amoeba.exe" "" "$INSTDIR\amoeba.exe" 0
!macroend

; 卸载时删掉桌面快捷方式（不存在时跳过；Delete 对不存在文件本身是 no-op，
; 这里保留 IfFileExists 只是让意图明确）。
!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$DESKTOP\Amoeba.lnk" 0 +2
  Delete "$DESKTOP\Amoeba.lnk"
!macroend
