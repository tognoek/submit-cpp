using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    private const string AppName = "ChamCpp";
    private const string MutexName = "Local\\ChamCppJudgeSingleInstance";
    private const string SharedRoot = "C:\\ChamCpp";
    private const string ResourceName = "Payload.zip";
    private const string LogoResource = "Logo.png";

    [STAThread]
    private static int Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        bool createdNew;
        using (var mutex = new Mutex(true, MutexName, out createdNew))
        {
            SplashForm splash = null;
            try
            {
                if (!createdNew)
                {
                    OpenExistingUi();
                    return 0;
                }

                splash = new SplashForm();
                splash.Show();
                splash.SetStatus("Đang khởi chạy hệ thống…");
                Application.DoEvents();

                var version = GetAppVersion();
                var appRoot = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    AppName,
                    "app",
                    version
                );

                splash.SetStatus("Đang chuẩn bị runtime…");
                Application.DoEvents();
                EnsurePayload(appRoot, version, splash);

                var node = Path.Combine(appRoot, "runtime", "node", "node.exe");
                var entry = Path.Combine(appRoot, "server", "index.js");
                if (!File.Exists(node) || !File.Exists(entry))
                {
                    if (splash != null) splash.Hide();
                    MessageBox.Show(
                        "Không tìm thấy runtime. Hãy tải lại file cài đặt.",
                        "Chấm C++",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return 1;
                }

                Directory.CreateDirectory(Path.Combine(SharedRoot, "data"));
                Directory.CreateDirectory(Path.Combine(SharedRoot, "logs"));
                Directory.CreateDirectory(Path.Combine(SharedRoot, "temp"));

                splash.SetStatus("Đang khởi động máy chủ…");
                Application.DoEvents();

                var psi = new ProcessStartInfo
                {
                    FileName = node,
                    Arguments = "\"" + entry + "\"",
                    WorkingDirectory = appRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                psi.EnvironmentVariables["JUDGE_ROOT"] = appRoot;
                psi.EnvironmentVariables["JUDGE_DATA"] = SharedRoot;
                psi.EnvironmentVariables["JUDGE_PACKAGED"] = "1";
                psi.EnvironmentVariables["JUDGE_OPEN_BROWSER"] = "1";
                psi.EnvironmentVariables["NODE_ENV"] = "production";

                var p = Process.Start(psi);
                if (p == null)
                {
                    if (splash != null) splash.Hide();
                    MessageBox.Show(
                        "Không khởi động được máy chủ.",
                        "Chấm C++",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return 1;
                }

                splash.SetStatus("Sắp xong — đang mở trình duyệt…");
                Application.DoEvents();
                WaitForPort(20000);
                Thread.Sleep(400);

                if (splash != null)
                {
                    splash.Close();
                    splash.Dispose();
                    splash = null;
                }

                p.WaitForExit();
                return p.ExitCode;
            }
            catch (Exception ex)
            {
                if (splash != null)
                {
                    try { splash.Hide(); } catch { /* ignore */ }
                }
                MessageBox.Show(ex.Message, "Chấm C++", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            finally
            {
                if (splash != null)
                {
                    try { splash.Dispose(); } catch { /* ignore */ }
                }
                if (createdNew)
                {
                    try { mutex.ReleaseMutex(); } catch { /* ignore */ }
                }
            }
        }
    }

    private static void WaitForPort(int timeoutMs)
    {
        var portFile = Path.Combine(SharedRoot, "data", ".port");
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            try
            {
                if (File.Exists(portFile))
                {
                    var text = File.ReadAllText(portFile).Trim();
                    if (!string.IsNullOrEmpty(text)) return;
                }
            }
            catch { /* ignore */ }
            Thread.Sleep(150);
            Application.DoEvents();
        }
    }

    private static string GetAppVersion()
    {
        try
        {
            var v = Assembly.GetExecutingAssembly().GetName().Version;
            if (v != null) return v.Major + "." + v.Minor + "." + v.Build;
        }
        catch { /* ignore */ }
        return "1.0.0";
    }

    private static void EnsurePayload(string appRoot, string version, SplashForm splash)
    {
        var marker = Path.Combine(appRoot, ".ready");
        if (File.Exists(marker) && File.Exists(Path.Combine(appRoot, "server", "index.js")))
        {
            return;
        }

        if (splash != null) splash.SetStatus("Lần đầu chạy — đang giải nén (chờ một chút)…");
        Application.DoEvents();

        if (Directory.Exists(appRoot))
        {
            try { Directory.Delete(appRoot, true); } catch { /* ignore */ }
        }
        Directory.CreateDirectory(appRoot);

        var asm = Assembly.GetExecutingAssembly();
        using (var stream = asm.GetManifestResourceStream(ResourceName))
        {
            if (stream == null)
            {
                throw new InvalidOperationException("Thiếu gói runtime trong file EXE.");
            }
            var zipPath = Path.Combine(Path.GetTempPath(), "chamcpp-payload-" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                using (var fs = File.Create(zipPath))
                {
                    var buffer = new byte[81920];
                    int read;
                    while ((read = stream.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        fs.Write(buffer, 0, read);
                    }
                }
                if (splash != null) splash.SetStatus("Đang giải nén runtime…");
                Application.DoEvents();
                ZipFile.ExtractToDirectory(zipPath, appRoot);
                File.WriteAllText(marker, version);
            }
            finally
            {
                try { File.Delete(zipPath); } catch { /* ignore */ }
            }
        }
    }

    private static void OpenExistingUi()
    {
        try
        {
            var portFile = Path.Combine(SharedRoot, "data", ".port");
            var port = "27181";
            if (File.Exists(portFile))
            {
                var text = File.ReadAllText(portFile).Trim();
                if (!string.IsNullOrEmpty(text)) port = text;
            }
            Process.Start(new ProcessStartInfo
            {
                FileName = "http://127.0.0.1:" + port,
                UseShellExecute = true,
            });
        }
        catch
        {
            MessageBox.Show(
                "Chấm C++ đang chạy. Hãy mở lại trình duyệt tới http://127.0.0.1:27181",
                "Chấm C++",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
        }
    }

    private sealed class SplashForm : Form
    {
        private readonly Label _status;
        private readonly PictureBox _logo;

        public SplashForm()
        {
            Text = "Chấm C++";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(420, 220);
            BackColor = Color.FromArgb(18, 16, 13);
            ShowInTaskbar = true;
            TopMost = true;

            _logo = new PictureBox
            {
                Size = new Size(72, 72),
                Location = new Point((Width - 72) / 2, 28),
                SizeMode = PictureBoxSizeMode.Zoom,
                BackColor = Color.Transparent,
            };
            TryLoadLogo(_logo);

            var title = new Label
            {
                Text = "Chấm C++",
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleCenter,
                Font = new Font("Segoe UI Semibold", 14f, FontStyle.Bold),
                ForeColor = Color.FromArgb(244, 234, 215),
                Location = new Point(20, 110),
                Size = new Size(Width - 40, 28),
            };

            _status = new Label
            {
                Text = "Đang khởi chạy hệ thống…",
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleCenter,
                Font = new Font("Segoe UI", 10f, FontStyle.Regular),
                ForeColor = Color.FromArgb(156, 144, 124),
                Location = new Point(20, 148),
                Size = new Size(Width - 40, 40),
            };

            Controls.Add(_logo);
            Controls.Add(title);
            Controls.Add(_status);

            // Viền nhẹ
            Paint += (s, e) =>
            {
                using (var pen = new Pen(Color.FromArgb(50, 44, 36)))
                {
                    e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
                }
            };
        }

        public void SetStatus(string text)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                BeginInvoke(new Action(() => SetStatus(text)));
                return;
            }
            _status.Text = text;
            _status.Refresh();
            Refresh();
        }

        private static void TryLoadLogo(PictureBox box)
        {
            try
            {
                var asm = Assembly.GetExecutingAssembly();
                using (var stream = asm.GetManifestResourceStream(LogoResource))
                {
                    if (stream == null) return;
                    box.Image = Image.FromStream(stream);
                }
            }
            catch { /* ignore */ }
        }
    }
}
