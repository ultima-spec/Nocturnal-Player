/**
 * Build Script for Nocturnal player Standalone App & Single-File Windows Installer (.exe)
 * Produces:
 *   1. dist/Nocturnal player-win32-x64/Nocturnal player.exe (Standalone packaged app)
 *   2. dist/Nocturnal-Player-Setup.exe                      (Self-contained GUI Installer .exe)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const DIST_DIR = path.join(ROOT, 'dist');
const APP_STAGE_DIR = path.join(DIST_DIR, 'Nocturnal player-win32-x64');
const PAYLOAD_ZIP = path.join(DIST_DIR, 'payload.zip');
const SETUP_EXE = path.join(DIST_DIR, 'Nocturnal-Player-Setup.exe');
const ICON_PATH = path.join(ROOT, 'assets', 'nocturnal.ico');
const CSC_PATH = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

function log(msg) {
  console.log(`[Build] ${msg}`);
}

function copyRecursiveSync(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function buildUninstallerCs() {
  return `
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace NocturnalUninstaller
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            DialogResult res = MessageBox.Show(
                "Are you sure you want to uninstall Nocturnal player from your computer?",
                "Uninstall Nocturnal player",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );

            if (res != DialogResult.Yes) return;

            string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\\\');

            try
            {
                string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Nocturnal player.lnk");
                if (File.Exists(desktopLnk)) File.Delete(desktopLnk);

                string startMenuLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Nocturnal player.lnk");
                if (File.Exists(startMenuLnk)) File.Delete(startMenuLnk);

                Registry.CurrentUser.DeleteSubKeyTree(@"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NocturnalPlayer", false);
            }
            catch { }

            MessageBox.Show(
                "Nocturnal player shortcuts and registry entries have been removed. The application files will now be cleaned up.",
                "Uninstall Complete",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );

            // Self-delete install directory via background cmd after process exits
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/C ping 127.0.0.1 -n 3 > nul & rmdir /s /q \\"" + installDir + "\\"");
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            psi.CreateNoWindow = true;
            Process.Start(psi);
        }
    }
}
`;
}

function buildInstallerCs() {
  return `
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace NocturnalInstaller
{
    public class SetupForm : Form
    {
        private TextBox txtInstallDir;
        private Button btnBrowse;
        private CheckBox chkDesktop;
        private CheckBox chkStartMenu;
        private CheckBox chkLaunch;
        private ProgressBar progressBar;
        private Label lblStatus;
        private Button btnInstall;
        private Button btnCancel;
        private bool isInstalling = false;

        public SetupForm(bool silentMode)
        {
            this.Text = "Nocturnal player Setup";
            this.Size = new Size(540, 390);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(9, 9, 12);
            this.ForeColor = Color.FromArgb(242, 242, 247);
            this.Font = new Font("Consolas", 9.5f, FontStyle.Regular);

            try
            {
                using (Stream iconStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("NocturnalIcon.ico"))
                {
                    if (iconStream != null)
                    {
                        this.Icon = new Icon(iconStream);
                    }
                }
            }
            catch { }

            string defaultDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "Nocturnal player"
            );

            Panel headerPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 68,
                BackColor = Color.FromArgb(18, 18, 24),
                Padding = new Padding(16, 12, 16, 10)
            };

            Label lblTitle = new Label
            {
                Text = "[::] NOCTURNAL PLAYER — INSTALLER",
                Font = new Font("Consolas", 13f, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(16, 12),
                AutoSize = true
            };

            Label lblSubtitle = new Label
            {
                Text = "Install Nocturnal player v1.0.0 to your computer",
                Font = new Font("Consolas", 9f, FontStyle.Regular),
                ForeColor = Color.FromArgb(176, 176, 190),
                Location = new Point(16, 38),
                AutoSize = true
            };

            headerPanel.Controls.Add(lblTitle);
            headerPanel.Controls.Add(lblSubtitle);
            this.Controls.Add(headerPanel);

            Label lblDir = new Label
            {
                Text = "INSTALLATION FOLDER:",
                Font = new Font("Consolas", 9.5f, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(20, 84),
                AutoSize = true
            };
            this.Controls.Add(lblDir);

            txtInstallDir = new TextBox
            {
                Text = defaultDir,
                Location = new Point(20, 106),
                Width = 395,
                BackColor = Color.FromArgb(18, 18, 24),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle
            };
            this.Controls.Add(txtInstallDir);

            btnBrowse = new Button
            {
                Text = "Browse...",
                Location = new Point(423, 104),
                Size = new Size(85, 25),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(26, 26, 34),
                ForeColor = Color.White
            };
            btnBrowse.FlatAppearance.BorderColor = Color.White;
            btnBrowse.Click += (s, e) =>
            {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.SelectedPath = txtInstallDir.Text;
                    fbd.Description = "Select destination folder for Nocturnal player";
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        string chosen = fbd.SelectedPath;
                        if (!chosen.EndsWith("Nocturnal player", StringComparison.OrdinalIgnoreCase))
                        {
                            chosen = Path.Combine(chosen, "Nocturnal player");
                        }
                        txtInstallDir.Text = chosen;
                    }
                }
            };
            this.Controls.Add(btnBrowse);

            chkDesktop = new CheckBox
            {
                Text = "Create Desktop Shortcut (Nocturnal player.lnk)",
                Checked = true,
                Location = new Point(20, 146),
                AutoSize = true,
                ForeColor = Color.White
            };
            this.Controls.Add(chkDesktop);

            chkStartMenu = new CheckBox
            {
                Text = "Create Start Menu Shortcut",
                Checked = true,
                Location = new Point(20, 174),
                AutoSize = true,
                ForeColor = Color.White
            };
            this.Controls.Add(chkStartMenu);

            chkLaunch = new CheckBox
            {
                Text = "Launch Nocturnal player after installation",
                Checked = true,
                Location = new Point(20, 202),
                AutoSize = true,
                ForeColor = Color.White
            };
            this.Controls.Add(chkLaunch);

            lblStatus = new Label
            {
                Text = "Ready to install Nocturnal player.",
                Location = new Point(20, 240),
                Size = new Size(488, 20),
                ForeColor = Color.FromArgb(190, 190, 205)
            };
            this.Controls.Add(lblStatus);

            progressBar = new ProgressBar
            {
                Location = new Point(20, 264),
                Size = new Size(488, 22),
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Style = ProgressBarStyle.Continuous
            };
            this.Controls.Add(progressBar);

            btnInstall = new Button
            {
                Text = "INSTALL",
                Font = new Font("Consolas", 10f, FontStyle.Bold),
                Location = new Point(292, 304),
                Size = new Size(110, 32),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(38, 38, 50),
                ForeColor = Color.White
            };
            btnInstall.FlatAppearance.BorderColor = Color.White;
            btnInstall.Click += async (s, e) => await RunInstallationAsync(false);
            this.Controls.Add(btnInstall);

            btnCancel = new Button
            {
                Text = "CLOSE",
                Font = new Font("Consolas", 10f, FontStyle.Regular),
                Location = new Point(412, 304),
                Size = new Size(96, 32),
                FlatStyle = FlatStyle.Flat,
                BackColor = Color.FromArgb(20, 20, 28),
                ForeColor = Color.White
            };
            btnCancel.FlatAppearance.BorderColor = Color.FromArgb(140, 140, 155);
            btnCancel.Click += (s, e) =>
            {
                if (!isInstalling) this.Close();
            };
            this.Controls.Add(btnCancel);

            if (silentMode)
            {
                this.Shown += async (s, e) => await RunInstallationAsync(true);
            }
        }

        private void UpdateProgress(int pct, string status)
        {
            if (this.InvokeRequired)
            {
                this.Invoke(new Action(() => UpdateProgress(pct, status)));
                return;
            }
            progressBar.Value = Math.Max(0, Math.Min(100, pct));
            lblStatus.Text = status;
        }

        private static void CreateShortcut(string shortcutPath, string targetExe, string workDir, string iconPath)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            dynamic shell = Activator.CreateInstance(shellType);
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = targetExe;
            shortcut.WorkingDirectory = workDir;
            shortcut.IconLocation = iconPath;
            shortcut.Description = "Nocturnal player";
            shortcut.Save();
        }

        private async Task RunInstallationAsync(bool silentMode)
        {
            if (isInstalling) return;
            isInstalling = true;

            string targetDir = txtInstallDir.Text.Trim();
            bool makeDesktop = chkDesktop.Checked;
            bool makeStartMenu = chkStartMenu.Checked;
            bool launchAfter = chkLaunch.Checked;

            txtInstallDir.Enabled = false;
            btnBrowse.Enabled = false;
            chkDesktop.Enabled = false;
            chkStartMenu.Enabled = false;
            chkLaunch.Enabled = false;
            btnInstall.Enabled = false;
            btnCancel.Enabled = false;

            try
            {
                await Task.Run(() =>
                {
                    UpdateProgress(5, "Preparing target directory...");

                    // Close any running instance of Nocturnal player in targetDir so files can be overwritten
                    foreach (Process p in Process.GetProcessesByName("Nocturnal player"))
                    {
                        try { p.Kill(); p.WaitForExit(2000); } catch { }
                    }

                    Directory.CreateDirectory(targetDir);

                    using (Stream payloadStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("NocturnalPayload.zip"))
                    {
                        if (payloadStream == null)
                        {
                            throw new Exception("Embedded application payload not found.");
                        }

                        using (ZipArchive archive = new ZipArchive(payloadStream, ZipArchiveMode.Read))
                        {
                            int total = Math.Max(1, archive.Entries.Count);
                            int count = 0;

                            foreach (ZipArchiveEntry entry in archive.Entries)
                            {
                                count++;
                                string fullPath = Path.Combine(targetDir, entry.FullName.Replace('/', Path.DirectorySeparatorChar));

                                if (string.IsNullOrEmpty(entry.Name))
                                {
                                    Directory.CreateDirectory(fullPath);
                                    continue;
                                }

                                Directory.CreateDirectory(Path.GetDirectoryName(fullPath));
                                entry.ExtractToFile(fullPath, true);

                                if (count % 5 == 0 || count == total)
                                {
                                    int pct = 8 + (int)((count / (double)total) * 78.0);
                                    UpdateProgress(pct, "Installing: " + entry.Name);
                                }
                            }
                        }
                    }

                    string exePath = Path.Combine(targetDir, "Nocturnal player.exe");
                    string iconPath = Path.Combine(targetDir, "resources", "app", "assets", "nocturnal.ico");
                    if (!File.Exists(iconPath)) iconPath = exePath;

                    if (makeDesktop)
                    {
                        UpdateProgress(90, "Creating Desktop shortcut...");
                        string desktopLnk = Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                            "Nocturnal player.lnk"
                        );
                        CreateShortcut(desktopLnk, exePath, targetDir, iconPath);
                    }

                    if (makeStartMenu)
                    {
                        UpdateProgress(94, "Creating Start Menu shortcut...");
                        string startMenuLnk = Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                            "Nocturnal player.lnk"
                        );
                        CreateShortcut(startMenuLnk, exePath, targetDir, iconPath);
                    }

                    UpdateProgress(97, "Registering in Windows Installed Apps...");
                    string uninstallExe = Path.Combine(targetDir, "Uninstall Nocturnal player.exe");
                    using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NocturnalPlayer"))
                    {
                        if (key != null)
                        {
                            key.SetValue("DisplayName", "Nocturnal player");
                            key.SetValue("DisplayVersion", "1.0.0");
                            key.SetValue("Publisher", "Nocturnal");
                            key.SetValue("DisplayIcon", iconPath);
                            key.SetValue("InstallLocation", targetDir);
                            key.SetValue("UninstallString", "\\"" + uninstallExe + "\\"");
                            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                        }
                    }

                    UpdateProgress(100, "Installation complete! Nocturnal player is ready.");
                });

                btnCancel.Enabled = true;
                btnCancel.Text = "FINISH";

                string installedExe = Path.Combine(targetDir, "Nocturnal player.exe");
                if (launchAfter && File.Exists(installedExe))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = installedExe,
                        WorkingDirectory = targetDir,
                        UseShellExecute = true
                    });
                }

                if (!silentMode)
                {
                    MessageBox.Show(
                        "Nocturnal player has been installed to:\\n" + targetDir,
                        "Nocturnal player Setup",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                }

                this.Close();
            }
            catch (Exception ex)
            {
                UpdateProgress(0, "Error: " + ex.Message);
                MessageBox.Show(
                    "Installation failed:\\n" + ex.Message,
                    "Nocturnal player Setup Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                btnInstall.Enabled = true;
                btnCancel.Enabled = true;
                isInstalling = false;
            }
        }
    }

    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool silent = false;
            foreach (string a in args)
            {
                if (string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase))
                {
                    silent = true;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm(silent));
        }
    }
}
`;
}

function main() {
  if (!fs.existsSync(CSC_PATH)) {
    throw new Error(`C# compiler not found at ${CSC_PATH}`);
  }

  log('Cleaning previous build output in dist/ ...');
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(APP_STAGE_DIR, { recursive: true });

  // 1. Copy Electron runtime distribution
  const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  log(`Copying Electron runtime from ${electronDist} ...`);
  copyRecursiveSync(electronDist, APP_STAGE_DIR);

  // Rename electron.exe -> Nocturnal player.exe
  const oldExe = path.join(APP_STAGE_DIR, 'electron.exe');
  const newExe = path.join(APP_STAGE_DIR, 'Nocturnal player.exe');
  if (fs.existsSync(oldExe)) {
    fs.renameSync(oldExe, newExe);
  }

  // Remove default_app.asar so Electron loads resources/app
  const defaultAsar = path.join(APP_STAGE_DIR, 'resources', 'default_app.asar');
  if (fs.existsSync(defaultAsar)) {
    fs.rmSync(defaultAsar, { force: true });
  }

  // 2. Populate resources/app with Nocturnal player files
  const resourcesAppDir = path.join(APP_STAGE_DIR, 'resources', 'app');
  fs.mkdirSync(resourcesAppDir, { recursive: true });

  const appFiles = [
    'package.json',
    'main.js',
    'preload.js',
    'renderer.js',
    'index.html',
    'styles.css',
    'discord-rpc.js'
  ];

  log('Copying application source files & assets...');
  for (const file of appFiles) {
    fs.copyFileSync(path.join(ROOT, file), path.join(resourcesAppDir, file));
  }
  copyRecursiveSync(path.join(ROOT, 'assets'), path.join(resourcesAppDir, 'assets'));

  // Copy ffmpeg-static into resources/app/node_modules/ffmpeg-static
  const ffmpegModuleSrc = path.join(ROOT, 'node_modules', 'ffmpeg-static');
  if (fs.existsSync(ffmpegModuleSrc)) {
    log('Bundling ffmpeg-static for YT Music conversion...');
    copyRecursiveSync(
      ffmpegModuleSrc,
      path.join(resourcesAppDir, 'node_modules', 'ffmpeg-static')
    );
  }

  // 3. Compile Uninstall Nocturnal player.exe inside APP_STAGE_DIR
  log('Compiling Uninstall Nocturnal player.exe ...');
  const uninstallCsPath = path.join(DIST_DIR, 'Uninstaller.cs');
  const uninstallExePath = path.join(APP_STAGE_DIR, 'Uninstall Nocturnal player.exe');
  fs.writeFileSync(uninstallCsPath, buildUninstallerCs(), 'utf-8');
  execFileSync(CSC_PATH, [
    '/nologo',
    '/target:winexe',
    `/out:${uninstallExePath}`,
    `/win32icon:${ICON_PATH}`,
    '/r:System.dll',
    '/r:System.Windows.Forms.dll',
    uninstallCsPath
  ]);
  fs.rmSync(uninstallCsPath, { force: true });

  // 4. Create payload.zip from APP_STAGE_DIR using .NET ZipFile via PowerShell
  log('Compressing standalone application into payload.zip ...');
  const psCompress = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path '${PAYLOAD_ZIP.replace(/'/g, "''")}') { Remove-Item '${PAYLOAD_ZIP.replace(/'/g, "''")}' -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory('${APP_STAGE_DIR.replace(/'/g, "''")}', '${PAYLOAD_ZIP.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Fastest, $false)
`;
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    psCompress
  ]);

  // 5. Compile single-file Nocturnal-Player-Setup.exe with embedded payload.zip and nocturnal.ico
  log('Compiling single-file installer dist/Nocturnal-Player-Setup.exe ...');
  const installerCsPath = path.join(DIST_DIR, 'Installer.cs');
  fs.writeFileSync(installerCsPath, buildInstallerCs(), 'utf-8');

  execFileSync(CSC_PATH, [
    '/nologo',
    '/target:winexe',
    `/out:${SETUP_EXE}`,
    `/win32icon:${ICON_PATH}`,
    `/resource:${PAYLOAD_ZIP},NocturnalPayload.zip`,
    `/resource:${ICON_PATH},NocturnalIcon.ico`,
    '/r:System.dll',
    '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll',
    '/r:System.IO.Compression.dll',
    '/r:System.IO.Compression.FileSystem.dll',
    installerCsPath
  ]);

  // Clean up temporary build artifacts
  fs.rmSync(installerCsPath, { force: true });
  fs.rmSync(PAYLOAD_ZIP, { force: true });

  const sizeMb = (fs.statSync(SETUP_EXE).size / (1024 * 1024)).toFixed(1);
  log(`SUCCESS! Built standalone installer: ${SETUP_EXE} (${sizeMb} MB)`);

  // Also build the macOS installer zip inside dist/
  const macBuildScript = path.join(ROOT, 'build-mac-installer.js');
  if (fs.existsSync(macBuildScript)) {
    require(macBuildScript);
  }
}

main();
