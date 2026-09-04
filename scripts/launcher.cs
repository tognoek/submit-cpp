using System;
using System.Diagnostics;
using System.IO;

internal static class Program
{
    private static int Main()
    {
        try
        {
            var root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar
            );
            var node = Path.Combine(root, "runtime", "node", "node.exe");
            var entry = Path.Combine(root, "server", "index.js");

            if (!File.Exists(node))
            {
                Console.Error.WriteLine("Missing runtime\\node\\node.exe");
                Console.Error.WriteLine("Press Enter to exit...");
                Console.ReadLine();
                return 1;
            }
            if (!File.Exists(entry))
            {
                Console.Error.WriteLine("Missing server\\index.js");
                Console.Error.WriteLine("Press Enter to exit...");
                Console.ReadLine();
                return 1;
            }

            var psi = new ProcessStartInfo
            {
                FileName = node,
                Arguments = "\"" + entry + "\"",
                WorkingDirectory = root,
                UseShellExecute = false,
            };
            psi.EnvironmentVariables["JUDGE_ROOT"] = root;
            psi.EnvironmentVariables["JUDGE_OPEN_BROWSER"] = "1";
            psi.EnvironmentVariables["NODE_ENV"] = "production";

            using (var p = Process.Start(psi))
            {
                if (p == null) return 1;
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            Console.Error.WriteLine("Press Enter to exit...");
            Console.ReadLine();
            return 1;
        }
    }
}
