$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ElectronExe = Join-Path $AppDir 'node_modules\electron\dist\electron.exe'
$IconPath = Join-Path $AppDir 'assets\nocturnal.ico'

$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$StartMenuPath = [Environment]::GetFolderPath('Programs')

foreach ($TargetDir in @($DesktopPath, $StartMenuPath)) {
  if ($TargetDir -and (Test-Path $TargetDir)) {
    $ShortcutFile = Join-Path $TargetDir 'Nocturnal player.lnk'
    $Shortcut = $WshShell.CreateShortcut($ShortcutFile)
    $Shortcut.TargetPath = $ElectronExe
    $Shortcut.Arguments = "`"$AppDir`""
    $Shortcut.WorkingDirectory = $AppDir
    $Shortcut.IconLocation = $IconPath
    $Shortcut.Description = 'Nocturnal player'
    $Shortcut.Save()
    Write-Host "Created shortcut: $ShortcutFile"
  }
}
