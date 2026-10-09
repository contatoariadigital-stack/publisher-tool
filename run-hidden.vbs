' Roda o dispatcher local sem abrir janela (usado pela tarefa "PublisherTool WV2 dispatch")
Set sh = CreateObject("WScript.Shell")
cmd = "cmd /c cd /d C:\Users\gabri\publisher-tool && git pull -q --rebase origin main && node scripts\dispatch-due.js && git add queue && git commit -qm dispatch-local && git push -q origin main"
sh.Run cmd, 0, False
